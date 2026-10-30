import { createHash } from 'node:crypto';
import { XERO_API_BASE } from 'astro:env/server';
import type { serviceClient } from '../admin';
import { holdersIn } from '../api/data';
import { outboundJson } from '../outbound';
import { accessToken, raiseIssue, type Connection } from './connections';
import { figuresFromXero, groupLines, type XeroRow } from '../reporting-xero';

type Svc = ReturnType<typeof serviceClient>;

// Xero for one company. Xero holds the money; the portal holds who owns what.
//  - Holders become Xero contacts (ContactNumber = the register reference),
//    with the register's address, so they can be paid.
//  - Share capital check: paid-up capital from the register of members
//    against the share capital accounts chosen in Xero's balance sheet.
//  - Dividends and distributions: each holder's entitlement at a record date
//    becomes a DRAFT bill in Xero. Finance reviews and pays in Xero; the
//    portal never approves or pays anything.

export type XeroSettings = { tenant_id: string; capital_accounts: string[]; contacts: boolean };
export const xeroSettings = (s: Record<string, unknown>): XeroSettings => ({
  tenant_id: typeof s.tenant_id === 'string' ? s.tenant_id : '', capital_accounts: Array.isArray(s.capital_accounts) ? (s.capital_accounts as string[]) : [],
  // Holders' names and addresses go to Xero only once someone switches this on.
  contacts: s.contacts === true,
});

type Ctx = { svc: Svc; c: Connection; company: { id: string; code: string; display_name: string }; token: string; tenant: string };
const xr = <T = unknown>(x: Ctx, method: string, path: string, body?: unknown) =>
  outboundJson<T>(method, `${XERO_API_BASE}/api.xro/2.0${path}`, body, { authorization: `Bearer ${x.token}`, 'xero-tenant-id': x.tenant });
const aud = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hashOf = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);

/** The organisations this connection may reach. */
export async function xeroTenants(token: string) {
  const list = await outboundJson<{ tenantId: string; tenantName: string; tenantType: string }[]>('GET', `${XERO_API_BASE}/connections`, undefined, { authorization: `Bearer ${token}` });
  return (list ?? []).filter((t) => t.tenantType === 'ORGANISATION').map((t) => ({ id: t.tenantId, name: t.tenantName }));
}

async function ctxOf(svc: Svc, c: Connection, company: Ctx['company'], central: string): Promise<Ctx> {
  const token = await accessToken(svc, c, central);
  const tenant = xeroSettings(c.settings).tenant_id || c.account_id || '';
  if (!tenant) throw new Error('Choose the Xero organisation first.');
  return { svc, c, company, token, tenant };
}

/** Holders as Xero contacts; returns holder id → ContactID. Only changed ones are sent. */
async function syncContacts(x: Ctx, onlyHolderIds?: string[]) {
  const { holders } = await holdersIn(x.svc, [x.company.id], { holderIds: onlyHolderIds });
  const { data: linkRows } = await x.svc.from('external_links').select('local_id, external_id, synced_hash').eq('entity_id', x.company.id).eq('local_type', 'holder').eq('system', 'xero');
  const links = new Map((linkRows ?? []).map((l) => [l.local_id, l]));
  // The register's address (and the person who owns it, for an email).
  const { data: names } = await x.svc.from('register_names').select('holder_id, address').eq('entity_id', x.company.id).in('holder_id', holders.map((h) => h.id).concat('00000000-0000-0000-0000-000000000000'));
  const addressOf = new Map((names ?? []).filter((n) => n.address).map((n) => [n.holder_id, n.address as string]));
  const contacts = holders.map((h) => {
    const lines = (addressOf.get(h.id) ?? '').split(/,\s*|\n/).map((l) => l.trim()).filter(Boolean);
    const body: Record<string, unknown> = {
      Name: h.name, ContactNumber: (h.registry_ref ?? h.id.slice(0, 8)).slice(0, 50),
      ...(lines.length ? { Addresses: [{ AddressType: 'POBOX', AddressLine1: lines[0] ?? '', AddressLine2: lines[1] ?? '', AddressLine3: lines.slice(2).join(', ') }] } : {}),
    };
    return { h, body };
  });
  const out = new Map([...links].map(([k, v]) => [k, v.external_id]));
  const changed = contacts.filter(({ h, body }) => links.get(h.id)?.synced_hash !== hashOf(body));
  for (let i = 0; i < changed.length; i += 50) {
    const batch = changed.slice(i, i + 50);
    const res = await xr<{ Contacts: { ContactID: string; ContactNumber: string; HasValidationErrors?: boolean; ValidationErrors?: { Message: string }[] }[] }>(x, 'POST', '/Contacts?summarizeErrors=false', { Contacts: batch.map(({ h, body }) => ({ ...(links.get(h.id) ? { ContactID: links.get(h.id)!.external_id } : {}), ...body })) });
    for (const ct of res.Contacts ?? []) {
      const b = batch.find(({ body }) => body.ContactNumber === ct.ContactNumber);
      if (!b) continue;
      if (ct.HasValidationErrors) { await raiseIssue(x.svc, x.c, 'contact_failed', `${b.h.name}: Xero didn’t accept the contact (${ct.ValidationErrors?.map((e) => e.Message).join('; ')}).`, `contact:${b.h.id}`); continue; }
      await x.svc.from('external_links').upsert({ entity_id: x.company.id, local_type: 'holder', local_id: b.h.id, system: 'xero', external_id: ct.ContactID, synced_hash: hashOf(b.body), synced_at: new Date().toISOString() });
      out.set(b.h.id, ct.ContactID);
    }
  }
  return { out, sent: changed.length };
}

/** Paid-up capital from the register of members: shares allotted or subscribed × amount paid per share. */
export async function registerPaidUp(svc: Svc, entityId: string) {
  const { data } = await svc.from('register_movements').select('kind, shares, paid_per_share').eq('entity_id', entityId).in('kind', ['Allotment', 'Subscription']);
  return Math.round((data ?? []).reduce((a, m) => a + Number(m.shares) * Number(m.paid_per_share ?? 0), 0) * 100) / 100;
}

type ReportCell = { Value?: string; Attributes?: { Id: string; Value: string }[] };
type ReportRow = { RowType: string; Cells?: ReportCell[]; Rows?: ReportRow[] };

/** Xero's equity accounts (to choose the share capital ones) and the balance sheet balances by account. */
export async function equityAccounts(x: Ctx) {
  const acc = await xr<{ Accounts: { AccountID: string; Code: string; Name: string; Type: string; Status: string }[] }>(x, 'GET', '/Accounts?where=Type%3D%3D%22EQUITY%22');
  return (acc.Accounts ?? []).filter((a) => a.Status !== 'ARCHIVED').map((a) => ({ id: a.AccountID, code: a.Code, name: a.Name }));
}

async function capitalCheck(x: Ctx, s: XeroSettings) {
  if (!s.capital_accounts.length) return null;
  const accounts = await equityAccounts(x);
  const chosen = accounts.filter((a) => s.capital_accounts.includes(a.code));
  const today = new Date().toISOString().slice(0, 10);
  const report = await xr<{ Reports: { Rows: ReportRow[] }[] }>(x, 'GET', `/Reports/BalanceSheet?date=${today}`);
  const balances = new Map<string, number>();
  const walk = (rows: ReportRow[]) => { for (const r of rows ?? []) { if (r.Rows) walk(r.Rows); if (r.RowType === 'Row' && r.Cells?.length) { const id = r.Cells[0].Attributes?.find((a) => a.Id === 'account')?.Value; if (id) balances.set(id, Number(String(r.Cells[1]?.Value ?? '0').replace(/,/g, '')) || 0); } } };
  walk(report.Reports?.[0]?.Rows ?? []);
  const xero = Math.round(chosen.reduce((a, acc) => a + (balances.get(acc.id) ?? 0), 0) * 100) / 100;
  const register = await registerPaidUp(x.svc, x.company.id);
  const result = { as_at: today, register, xero, difference: Math.round((register - xero) * 100) / 100, accounts: chosen.map((a) => `${a.code} ${a.name}`) };
  x.c.cursor.capital_check = result;
  if (Math.abs(result.difference) >= 1) {
    await raiseIssue(x.svc, x.c, 'capital_mismatch', `Share capital differs: the register says ${aud(register)} paid up, Xero (${result.accounts.join(', ')}) shows ${aud(xero)}.`, `capital:${today}:${register}:${xero}`, result);
  }
  return result;
}

/** One sync for one company: contacts and the share capital check. */
export async function syncXero(svc: Svc, c: Connection, company: Ctx['company'], central: string) {
  const x = await ctxOf(svc, c, company, central);
  const s = xeroSettings(c.settings);
  const contacts = s.contacts ? (await syncContacts(x)).sent : 0;
  const capital = await capitalCheck(x, s);
  await svc.from('connections').update({ cursor: c.cursor, last_sync_at: new Date().toISOString(), last_error: null, status: 'connected' }).eq('id', c.id);
  return { contacts, capital };
}

/** Each holder's entitlement at the record date, as draft bills in Xero. */
export async function prepareDividend(svc: Svc, c: Connection, company: Ctx['company'], central: string, run: { id: string; share_class_id: string; record_date: string; per_share: number; account_code: string; description: string }) {
  const x = await ctxOf(svc, c, company, central);
  // Balances on the record date: the latest dated holding on or before it.
  const rows: { holder_id: string; shares: number; as_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await svc.from('holdings').select('holder_id, shares, as_at').eq('share_class_id', run.share_class_id).lte('as_at', run.record_date).order('as_at', { ascending: false }).range(from, from + 999);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const at = new Map<string, number>();
  for (const r of rows) if (!at.has(r.holder_id)) at.set(r.holder_id, Number(r.shares));
  const entitled = [...at].filter(([, n]) => n > 0);
  const { out: contactOf } = await syncContacts(x, entitled.map(([h]) => h));
  const results: { holder_id: string; shares: number; amount: number; invoice_id?: string; error?: string }[] = [];
  const { data: cls } = await svc.from('share_classes').select('code').eq('id', run.share_class_id).single();
  for (let i = 0; i < entitled.length; i += 50) {
    const batch = entitled.slice(i, i + 50).filter(([h]) => contactOf.get(h));
    if (!batch.length) continue;
    const res = await xr<{ Invoices: { InvoiceID: string; Reference: string; HasErrors?: boolean; ValidationErrors?: { Message: string }[]; Contact: { ContactID: string } }[] }>(x, 'POST', '/Invoices?summarizeErrors=false', {
      Invoices: batch.map(([h, shares]) => ({
        Type: 'ACCPAY', Status: 'DRAFT', Contact: { ContactID: contactOf.get(h) }, Date: new Date().toISOString().slice(0, 10), DueDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
        Reference: `${run.description} – ${cls?.code} ${run.record_date}`.slice(0, 255), LineAmountTypes: 'NoTax',
        LineItems: [{ Description: `${run.description}: ${shares.toLocaleString('en-AU')} ${cls?.code} shares held on ${run.record_date} × $${run.per_share}`, Quantity: shares, UnitAmount: run.per_share, AccountCode: run.account_code }],
      })),
    });
    for (const [h, shares] of batch) {
      const inv = (res.Invoices ?? []).find((v) => v.Contact?.ContactID === contactOf.get(h));
      results.push({ holder_id: h, shares, amount: Math.round(shares * run.per_share * 100) / 100, ...(inv && !inv.HasErrors ? { invoice_id: inv.InvoiceID } : { error: inv?.ValidationErrors?.map((e) => e.Message).join('; ') ?? 'Not created' }) });
    }
  }
  for (const [h, shares] of entitled) if (!contactOf.get(h)) results.push({ holder_id: h, shares, amount: Math.round(shares * run.per_share * 100) / 100, error: 'No Xero contact' });
  const ok = results.filter((r) => r.invoice_id);
  await svc.from('dividend_runs').update({ status: ok.length === results.length ? 'done' : 'failed', holders: ok.length, total: Math.round(ok.reduce((a, r) => a + r.amount, 0) * 100) / 100, results }).eq('id', run.id);
  return { created: ok.length, failed: results.length - ok.length, total: ok.reduce((a, r) => a + r.amount, 0) };
}

export { ctxOf as xeroContext };

/**
 * A reporting pack's figures from Xero (Accounting, phase 2): the period's and
 * the year to date's profit and loss and the balance sheet at period end.
 */
export async function xeroPackFigures(svc: Svc, c: Connection, company: Ctx['company'], central: string, p: { start: string; end: string; yearStart: string }) {
  const x = await ctxOf(svc, c, company, central);
  type Report = { Reports: { Rows: XeroRow[] }[] };
  const [period, ytd, balance] = await Promise.all([
    xr<Report>(x, 'GET', `/Reports/ProfitAndLoss?fromDate=${p.start}&toDate=${p.end}&standardLayout=true`),
    p.yearStart === p.start ? Promise.resolve(null) : xr<Report>(x, 'GET', `/Reports/ProfitAndLoss?fromDate=${p.yearStart}&toDate=${p.end}&standardLayout=true`),
    xr<Report>(x, 'GET', `/Reports/BalanceSheet?date=${p.end}&standardLayout=true`),
  ]);
  const periodRows = period.Reports?.[0]?.Rows ?? [];
  const balanceRows = balance.Reports?.[0]?.Rows ?? [];
  // Accounts named after a group company, to point out for the intercompany table.
  const { data: group } = await svc.from('entities').select('id, display_name, legal_name').in('relationship', ['group', 'controlled']).neq('id', company.id);
  const named = groupLines(balanceRows, (group ?? []).map((g) => ({ id: g.id as string, names: [g.display_name, g.legal_name].filter(Boolean) as string[] })));
  return { figures: figuresFromXero(periodRows, ytd ? ytd.Reports?.[0]?.Rows ?? [] : periodRows, balanceRows), named };
}

// ---------------------------------------------------------------------------
// Commissions (Finance → Commissions): sales invoices and contacts, read only
// ---------------------------------------------------------------------------
type XeroInvoice = {
  InvoiceID: string; InvoiceNumber?: string; Type: string; Status: string; DateString?: string; Date?: string;
  Contact?: { ContactID: string; Name: string }; SubTotal?: number; Total?: number; AmountCredited?: number; CurrencyCode?: string; CurrencyRate?: number;
};
/** A sales invoice as commissions use it: the amount excluding GST, net of credit notes on it, in the organisation's currency. */
export type SalesInvoice = { id: string; number: string; contact_id: string | null; contact_name: string; date: string; amount: number; status: string; note: string };

const xeroDate = (v: XeroInvoice) => {
  if (v.DateString) return v.DateString.slice(0, 10);
  const ms = Number(/\/Date\((-?\d+)/.exec(v.Date ?? '')?.[1]);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
};
const cents = (n: number) => Math.round(n * 100) / 100;
function salesInvoice(v: XeroInvoice): SalesInvoice {
  const sub = Number(v.SubTotal ?? 0), total = Number(v.Total ?? 0), credited = Number(v.AmountCredited ?? 0);
  // Credit notes allocated to it take their share off (AmountCredited includes GST, like Total).
  const net = total > 0 ? sub * Math.max(0, 1 - credited / total) : sub;
  // Another currency: Xero's rate is that currency per unit of the organisation's.
  const rate = Number(v.CurrencyRate ?? 1);
  const amount = cents(rate && rate !== 1 ? net / rate : net);
  const notes = [credited > 0 ? `credited ${cents(credited)} incl. GST` : '', rate && rate !== 1 ? `${v.CurrencyCode} ${cents(net)} at ${rate}` : ''].filter(Boolean);
  return { id: v.InvoiceID, number: v.InvoiceNumber ?? '', contact_id: v.Contact?.ContactID ?? null, contact_name: v.Contact?.Name ?? '', date: xeroDate(v), amount, status: v.Status, note: notes.join('; ') };
}
const ymd = (d: string) => `DateTime(${Number(d.slice(0, 4))},${Number(d.slice(5, 7))},${Number(d.slice(8, 10))})`;

/** The period's sales invoices (ACCREC, AUTHORISED or PAID) by invoice date, every page. */
export async function xeroSalesInvoices(svc: Svc, c: Connection, company: Ctx['company'], central: string, p: { start: string; end: string }) {
  const x = await ctxOf(svc, c, company, central);
  const where = encodeURIComponent(`Type=="ACCREC" AND Date>=${ymd(p.start)} AND Date<=${ymd(p.end)}`);
  const out: SalesInvoice[] = [];
  for (let page = 1; page <= 200; page++) {
    const res = await xr<{ Invoices?: XeroInvoice[] }>(x, 'GET', `/Invoices?where=${where}&Statuses=AUTHORISED,PAID&order=Date&page=${page}&pageSize=100&summaryOnly=true`);
    const list = res.Invoices ?? [];
    out.push(...list.filter((v) => v.Type === 'ACCREC' && ['AUTHORISED', 'PAID'].includes(v.Status)).map(salesInvoice));
    if (list.length < 100) break;
  }
  return out;
}

/** Earlier invoices as they are now (for clawback: VOIDED or DELETED, or credited since). */
export async function xeroInvoicesById(svc: Svc, c: Connection, company: Ctx['company'], central: string, ids: string[]) {
  if (!ids.length) return [];
  const x = await ctxOf(svc, c, company, central);
  const out: SalesInvoice[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const res = await xr<{ Invoices?: XeroInvoice[] }>(x, 'GET', `/Invoices?IDs=${ids.slice(i, i + 40).join(',')}&summaryOnly=true`);
    out.push(...(res.Invoices ?? []).map(salesInvoice));
  }
  return out;
}

/** Contacts whose name matches (to attribute a client to a rep). */
export async function xeroContactSearch(svc: Svc, c: Connection, company: Ctx['company'], central: string, term: string) {
  const x = await ctxOf(svc, c, company, central);
  const res = await xr<{ Contacts?: { ContactID: string; Name: string; ContactStatus?: string }[] }>(x, 'GET', `/Contacts?searchTerm=${encodeURIComponent(term)}&summaryOnly=true&page=1`);
  return (res.Contacts ?? []).filter((ct) => ct.ContactStatus !== 'ARCHIVED').slice(0, 25).map((ct) => ({ id: ct.ContactID, name: ct.Name }));
}
