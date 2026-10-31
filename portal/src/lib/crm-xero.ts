import type { serviceClient } from './admin';
import { xeroContext, xeroCall, type XeroCtx } from './integrations/xero';
import { xeroConnected } from './reporting';
import { logActivity } from './crm';

// The CRM and Xero (docs/crm.md, "Xero end to end"). Xero holds the money; the CRM never keeps a second set of
// numbers. Quotes are built from the company's Xero items, prices, tax rates and tracking categories, copied to
// Xero as quotes once approved, and turned into draft invoices for Finance. What Xero says back (quote accepted,
// invoice raised, part paid, paid) is read onto the deal: paid in full means won.

type Svc = ReturnType<typeof serviceClient>;
export type XeroItem = { code: string; name: string; description: string; price: number | null; account: string; taxType: string };
export type TaxRate = { type: string; name: string; rate: number };
export type Tracking = { name: string; options: string[] };

/** The company's Xero, or null when it isn't connected. */
export async function crmXero(svc: Svc, company: { id: string; code: string; display_name: string }, central: string): Promise<XeroCtx | null> {
  const c = await xeroConnected(svc, company.id);
  return c ? xeroContext(svc, c, company, central) : null;
}

// Items, tax rates and tracking change rarely: kept for ten minutes per company.
const cache = new Map<string, { at: number; items: XeroItem[]; taxes: TaxRate[]; tracking: Tracking[] }>();
export async function xeroCatalogue(x: XeroCtx, fresh = false) {
  const hit = cache.get(x.company.id);
  if (hit && !fresh && Date.now() - hit.at < 600_000) return hit;
  type I = { Code: string; Name?: string; Description?: string; IsSold?: boolean; SalesDetails?: { UnitPrice?: number; AccountCode?: string; TaxType?: string } };
  const [items, taxes, tracking] = await Promise.all([
    xeroCall<{ Items?: I[] }>(x, 'GET', '/Items'),
    xeroCall<{ TaxRates?: { TaxType: string; Name: string; EffectiveRate?: number; Status?: string; CanApplyToRevenue?: boolean }[] }>(x, 'GET', '/TaxRates'),
    xeroCall<{ TrackingCategories?: { Name: string; Status?: string; Options?: { Name: string; Status?: string }[] }[] }>(x, 'GET', '/TrackingCategories'),
  ]);
  const out = {
    at: Date.now(),
    items: (items.Items ?? []).filter((i) => i.IsSold !== false).map((i) => ({ code: i.Code, name: i.Name ?? i.Code, description: i.Description ?? i.Name ?? '', price: i.SalesDetails?.UnitPrice ?? null, account: i.SalesDetails?.AccountCode ?? '', taxType: i.SalesDetails?.TaxType ?? '' })),
    taxes: (taxes.TaxRates ?? []).filter((t) => t.Status !== 'DELETED' && t.Status !== 'ARCHIVED' && t.CanApplyToRevenue !== false).map((t) => ({ type: t.TaxType, name: t.Name, rate: Number(t.EffectiveRate ?? 0) })),
    tracking: (tracking.TrackingCategories ?? []).filter((t) => t.Status !== 'ARCHIVED').map((t) => ({ name: t.Name, options: (t.Options ?? []).filter((o) => o.Status !== 'ARCHIVED').map((o) => o.Name) })),
  };
  cache.set(x.company.id, out);
  return out;
}

/** The deal's Xero contact: the one already linked, one with the same name or email, or a new one. */
export async function ensureXeroContact(svc: Svc, x: XeroCtx, deal: { id: string; entity_id: string; xero_contact_id: string | null; company_id: string | null; person_id: string | null; title: string }) {
  if (deal.xero_contact_id) return deal.xero_contact_id;
  const [{ data: org }, { data: person }] = await Promise.all([
    deal.company_id ? svc.from('crm_companies').select('id, name').eq('id', deal.company_id).maybeSingle() : Promise.resolve({ data: null }),
    deal.person_id ? svc.from('crm_people').select('id, full_name, email').eq('id', deal.person_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // The relationship may already know it.
  const { data: rel } = deal.company_id ? await svc.from('crm_relationships').select('id, xero_contact_id').eq('entity_id', deal.entity_id).eq('company_id', deal.company_id).maybeSingle() : { data: null };
  let id = rel?.xero_contact_id ?? null;
  const name = org?.name ?? person?.full_name ?? deal.title;
  if (!id) {
    const found = await xeroCall<{ Contacts?: { ContactID: string; Name: string; EmailAddress?: string; ContactStatus?: string }[] }>(x, 'GET', `/Contacts?searchTerm=${encodeURIComponent(name)}&summaryOnly=true&page=1`);
    id = (found.Contacts ?? []).find((c) => c.ContactStatus !== 'ARCHIVED' && c.Name.toLowerCase() === name.toLowerCase())?.ContactID ?? null;
  }
  if (!id) {
    const made = await xeroCall<{ Contacts: { ContactID: string }[] }>(x, 'POST', '/Contacts', { Contacts: [{ Name: name.slice(0, 255), ...(person?.email ? { EmailAddress: person.email, FirstName: person.full_name.split(' ')[0], LastName: person.full_name.split(' ').slice(1).join(' ') } : {}) }] });
    id = made.Contacts[0]!.ContactID;
  }
  await svc.from('crm_deals').update({ xero_contact_id: id }).eq('id', deal.id);
  if (rel && !rel.xero_contact_id) await svc.from('crm_relationships').update({ xero_contact_id: id }).eq('id', rel.id);
  return id;
}

type QuoteRow = { id: string; number: string; version: number; title: string; summary: string; terms: string; currency: string; issue_date: string; expiry_date: string | null; amounts_are: string; xero_quote_id: string | null };
type LineRow = { item_code: string; description: string; quantity: number; unit_price: number; discount: number; account_code: string; tax_type: string; tracking: { name: string; option: string }[] };
const lineItems = (lines: LineRow[]) => lines.map((l) => ({
  Description: l.description || l.item_code, Quantity: Number(l.quantity), UnitAmount: Number(l.unit_price),
  ...(l.item_code ? { ItemCode: l.item_code } : {}), ...(Number(l.discount) ? { DiscountRate: Number(l.discount) } : {}),
  ...(l.account_code ? { AccountCode: l.account_code } : {}), ...(l.tax_type ? { TaxType: l.tax_type } : {}),
  ...(l.tracking?.length ? { Tracking: l.tracking.map((t) => ({ Name: t.name, Option: t.option })) } : {}),
}));

/** Creates (or updates) the quote in Xero as a draft; returns Xero's id, number and totals. */
export async function pushQuote(x: XeroCtx, q: QuoteRow, lines: LineRow[], contactId: string, reference: string) {
  const body = { Quotes: [{
    ...(q.xero_quote_id ? { QuoteID: q.xero_quote_id } : {}), Contact: { ContactID: contactId }, Date: q.issue_date, ...(q.expiry_date ? { ExpiryDate: q.expiry_date } : {}),
    Status: 'DRAFT', LineAmountTypes: q.amounts_are, CurrencyCode: q.currency, Title: (q.title || '').slice(0, 100), Summary: q.summary.slice(0, 3000), Terms: q.terms.slice(0, 4000),
    Reference: `${q.number}${q.version > 1 ? ` v${q.version}` : ''} · ${reference}`.slice(0, 255), LineItems: lineItems(lines),
  }] };
  const res = await xeroCall<{ Quotes: { QuoteID: string; QuoteNumber: string; Status: string; SubTotal: number; TotalTax: number; Total: number }[] }>(x, 'POST', '/Quotes', body);
  return res.Quotes[0]!;
}

/** Moves the Xero quote along (SENT when it goes to the buyer, ACCEPTED or DECLINED when they answer). */
export async function setXeroQuoteStatus(x: XeroCtx, quoteId: string, contactId: string, status: 'SENT' | 'ACCEPTED' | 'DECLINED') {
  await xeroCall(x, 'POST', '/Quotes', { Quotes: [{ QuoteID: quoteId, Contact: { ContactID: contactId }, Status: status }] });
}

/** A draft invoice from an accepted quote, for Finance to approve in Xero. */
export async function draftInvoice(x: XeroCtx, q: QuoteRow, lines: LineRow[], contactId: string) {
  const res = await xeroCall<{ Invoices: { InvoiceID: string; InvoiceNumber?: string }[] }>(x, 'POST', '/Invoices', { Invoices: [{
    Type: 'ACCREC', Contact: { ContactID: contactId }, Status: 'DRAFT', LineAmountTypes: q.amounts_are, CurrencyCode: q.currency,
    Reference: `${q.number}${q.version > 1 ? ` v${q.version}` : ''}`, LineItems: lineItems(lines),
  }] });
  return res.Invoices[0]!;
}

type XInv = { InvoiceID: string; InvoiceNumber?: string; Status: string; Reference?: string; Total?: number; AmountPaid?: number; AmountDue?: number; FullyPaidOnDate?: string; DateString?: string; CurrencyCode?: string };
const xeroDay = (v: string | undefined) => { const ms = Number(/\/Date\((-?\d+)/.exec(v ?? '')?.[1]); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; };

type DealRow = { id: string; entity_id: string; title: string; owner_id: string | null; xero_contact_id: string | null; xero_invoice_ids: string[]; invoiced_amount: number; paid_amount: number; status: string; pipeline_id: string; stage_id: string };
type QuoteRef = { id: string; deal_id: string; number: string; xero_quote_id: string | null; xero_status: string | null; status: string; xero_invoice_id: string | null };
const QUOTE_COLUMNS = 'id, deal_id, number, xero_quote_id, xero_status, status, xero_invoice_id';
const INVOICE_STATUSES = 'DRAFT,SUBMITTED,AUTHORISED,PAID';

/**
 * Reads a deal's Xero quote and invoices onto it, on demand (the deal page): the deal's own invoices (raised from
 * its quote, or whose reference names its quote number) and their payments. Fully paid: the deal is won.
 */
export async function syncDeal(svc: Svc, x: XeroCtx, deal: DealRow) {
  if (!deal.xero_contact_id) return null;
  const { data: quotes } = await svc.from('crm_quotes').select(QUOTE_COLUMNS).eq('deal_id', deal.id);
  const statuses = new Map<string, string>();
  for (const q of (quotes ?? []).filter((q) => q.xero_quote_id)) {
    const r = await xeroCall<{ Quotes?: { Status: string }[] }>(x, 'GET', `/Quotes/${q.xero_quote_id}`).catch(() => null);
    if (r?.Quotes?.[0]?.Status) statuses.set(q.xero_quote_id!, r.Quotes[0].Status);
  }
  const res = await xeroCall<{ Invoices?: XInv[] }>(x, 'GET', `/Invoices?ContactIDs=${deal.xero_contact_id}&Statuses=${INVOICE_STATUSES}&summaryOnly=true&page=1`);
  return applyXero(svc, deal, (quotes ?? []) as QuoteRef[], statuses, res.Invoices ?? []);
}

/** Every page of a Xero list (100 a page), optionally only what changed since a time (If-Modified-Since). */
async function allPages<T>(x: XeroCtx, path: string, key: string, since?: Date) {
  const out: T[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await xeroCall<Record<string, T[]>>(x, 'GET', `${path}${path.includes('?') ? '&' : '?'}page=${page}`, undefined, since ? { 'if-modified-since': since.toUTCString() } : {});
    const rows = r?.[key] ?? [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

/**
 * The background sync for one company, in a handful of calls whatever the number of deals (Xero's Core tier
 * allows 5,000 calls a day per organisation): the quotes and invoices changed since the last run, then all the
 * invoices of the clients they belong to (and of deals changed in the CRM since), applied to their deals.
 */
export async function syncDeals(svc: Svc, x: XeroCtx, deals: (DealRow & { updated_at: string })[], since: Date) {
  const linked = deals.filter((d) => d.xero_contact_id);
  if (!linked.length) return [];
  const { data: quoteRows } = await svc.from('crm_quotes').select(QUOTE_COLUMNS).in('deal_id', linked.map((d) => d.id));
  const quotes = (quoteRows ?? []) as QuoteRef[];
  const statuses = new Map<string, string>();
  if (quotes.some((q) => q.xero_quote_id)) {
    const ours = new Set(quotes.map((q) => q.xero_quote_id).filter(Boolean));
    for (const q of await allPages<{ QuoteID: string; Status: string }>(x, '/Quotes', 'Quotes', since)) if (ours.has(q.QuoteID)) statuses.set(q.QuoteID, q.Status);
  }
  const contacts = [...new Set(linked.map((d) => d.xero_contact_id!))];
  const chunks = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 40) }, (_, i) => ids.slice(i * 40, i * 40 + 40));
  const touched = new Set<string>();
  for (const c of chunks(contacts)) for (const v of await allPages<XInv & { Contact?: { ContactID: string } }>(x, `/Invoices?ContactIDs=${c.join(',')}&Statuses=${INVOICE_STATUSES}&summaryOnly=true`, 'Invoices', since)) if (v.Contact?.ContactID) touched.add(v.Contact.ContactID);
  for (const d of linked) if (new Date(d.updated_at) > since || quotes.some((q) => q.deal_id === d.id && q.xero_quote_id && statuses.has(q.xero_quote_id))) touched.add(d.xero_contact_id!);
  const byContact = new Map<string, XInv[]>();
  for (const c of chunks([...touched])) for (const v of await allPages<XInv & { Contact?: { ContactID: string } }>(x, `/Invoices?ContactIDs=${c.join(',')}&Statuses=${INVOICE_STATUSES}&summaryOnly=true`, 'Invoices')) {
    const id = v.Contact?.ContactID ?? '';
    byContact.set(id, [...(byContact.get(id) ?? []), v]);
  }
  const results: { deal: DealRow; result: Awaited<ReturnType<typeof applyXero>> }[] = [];
  for (const d of linked.filter((d) => touched.has(d.xero_contact_id!))) {
    const result = await applyXero(svc, d, quotes.filter((q) => q.deal_id === d.id), statuses, byContact.get(d.xero_contact_id!) ?? []);
    results.push({ deal: d, result });
  }
  return results;
}

/** What Xero says about a deal's quotes and invoices, written onto it (no calls to Xero). */
async function applyXero(svc: Svc, deal: DealRow, quotes: QuoteRef[], statuses: Map<string, string>, invoices: XInv[]) {
  const numbers = quotes.map((q) => q.number);
  // Quotes' status in Xero (accepted there by Finance, for example).
  for (const q of quotes.filter((q) => q.xero_quote_id && statuses.has(q.xero_quote_id))) {
    const st = statuses.get(q.xero_quote_id!)!;
    if (st !== q.xero_status) {
      await svc.from('crm_quotes').update({ xero_status: st, ...(st === 'ACCEPTED' && q.status !== 'accepted' ? { status: 'accepted', accepted_at: new Date().toISOString(), accepted_name: 'in Xero' } : {}) }).eq('id', q.id);
      if (st === 'ACCEPTED' && q.status !== 'accepted') await logActivity(svc, { entity_id: deal.entity_id, kind: 'xero', deal_id: deal.id, subject: `Quote ${q.number} accepted in Xero` });
    }
  }
  const mine = invoices.filter((v) => deal.xero_invoice_ids.includes(v.InvoiceID) || (quotes ?? []).some((q) => q.xero_invoice_id === v.InvoiceID) || numbers.some((n) => (v.Reference ?? '').includes(n)));
  if (!mine.length) return null;
  const live = mine.filter((v) => ['AUTHORISED', 'PAID'].includes(v.Status));
  const invoiced = live.reduce((s, v) => s + Number(v.Total ?? 0), 0);
  const paid = live.reduce((s, v) => s + Number(v.AmountPaid ?? 0), 0);
  const fully = live.length > 0 && live.every((v) => v.Status === 'PAID');
  const ids = mine.map((v) => v.InvoiceID);
  const changed = Math.round(invoiced * 100) !== Math.round(Number(deal.invoiced_amount) * 100) || Math.round(paid * 100) !== Math.round(Number(deal.paid_amount) * 100) || ids.length !== deal.xero_invoice_ids.length;
  if (!changed && !(fully && deal.status !== 'won')) return null;
  const paidAt = fully ? live.map((v) => xeroDay(v.FullyPaidOnDate)).filter(Boolean).sort().pop() ?? new Date().toISOString() : null;
  await svc.from('crm_deals').update({ xero_invoice_ids: ids, invoiced_amount: invoiced, paid_amount: paid, paid_at: paidAt, updated_at: new Date().toISOString() }).eq('id', deal.id);
  const numbersText = mine.map((v) => v.InvoiceNumber).filter(Boolean).join(', ');
  if (invoiced > Number(deal.invoiced_amount)) await logActivity(svc, { entity_id: deal.entity_id, kind: 'xero', deal_id: deal.id, subject: `Invoiced in Xero: ${numbersText}`, body: `Total ${invoiced.toFixed(2)} ${mine[0]?.CurrencyCode ?? ''}`.trim(), source_ref: `xero-invoiced:${ids.join(',')}:${invoiced}` });
  if (paid > Number(deal.paid_amount)) await logActivity(svc, { entity_id: deal.entity_id, kind: 'xero', deal_id: deal.id, subject: fully ? `Paid in full in Xero (${numbersText})` : `Part paid in Xero: ${paid.toFixed(2)} of ${invoiced.toFixed(2)}`, source_ref: `xero-paid:${ids.join(',')}:${paid}` });
  let won = false;
  if (fully && deal.status !== 'won') {
    const { data: wonStage } = await svc.from('crm_stages').select('id, name').eq('pipeline_id', deal.pipeline_id).eq('kind', 'won').maybeSingle();
    if (wonStage) {
      await svc.from('crm_deals').update({ stage_id: wonStage.id, status: 'won', won_at: paidAt, stage_changed_at: new Date().toISOString(), lost_at: null, lost_reason: '' }).eq('id', deal.id);
      await logActivity(svc, { entity_id: deal.entity_id, kind: 'stage', deal_id: deal.id, subject: `→ ${wonStage.name} (paid in Xero)` });
      await svc.from('audit_log').insert({ user_id: null, action: 'crm_invoice_paid', detail: { entity_id: deal.entity_id, deal_id: deal.id, invoices: numbersText, via: 'xero' } });
      won = true;
    }
  }
  return { invoiced, paid, fully, won };
}
