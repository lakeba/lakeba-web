import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { serviceClient } from './admin';
import { getApproval } from './approvals';
import { money, namesOf } from './crm';

// Quotes (CRM → a deal → Quotes): lines from the company's Xero items, totals as Xero works them out, a
// branded PDF, and the approval a discount over the company's limit needs before the quote goes out.

type Svc = ReturnType<typeof serviceClient>;
export type Quote = {
  id: string; entity_id: string; deal_id: string; number: string; version: number; status: 'draft' | 'ready' | 'sent' | 'accepted' | 'declined' | 'expired';
  title: string; summary: string; terms: string; currency: string; issue_date: string; expiry_date: string | null; amounts_are: 'Exclusive' | 'Inclusive' | 'NoTax';
  subtotal: number; tax: number; total: number; max_discount: number; xero_quote_id: string | null; xero_quote_number: string | null; xero_status: string | null; xero_invoice_id: string | null;
  accepted_at: string | null; accepted_name: string; accepted_title: string; declined_reason: string; created_by: string | null; created_at: string; updated_at: string;
};
export type Line = { id?: string; sort: number; item_code: string; description: string; quantity: number; unit_price: number; discount: number; account_code: string; tax_type: string; tax_rate: number; tracking: { name: string; option: string }[]; amount: number };
export const QUOTE_STATES: Record<Quote['status'], string> = { draft: 'Draft', ready: 'Ready to send', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', expired: 'Expired' };

const c2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** A line's amount (after its discount) and the tax in it, as Xero rounds them. */
export function lineTotals(l: Pick<Line, 'quantity' | 'unit_price' | 'discount' | 'tax_rate'>, amountsAre: Quote['amounts_are']) {
  const amount = c2(Number(l.quantity) * Number(l.unit_price) * (1 - Number(l.discount) / 100));
  const rate = amountsAre === 'NoTax' ? 0 : Number(l.tax_rate) / 100;
  const tax = amountsAre === 'Inclusive' ? c2(amount - amount / (1 + rate)) : c2(amount * rate);
  return { amount, tax };
}
export function quoteTotals(lines: Line[], amountsAre: Quote['amounts_are']) {
  let amount = 0, tax = 0;
  for (const l of lines) { const t = lineTotals(l, amountsAre); amount += t.amount; tax += t.tax; }
  const subtotal = amountsAre === 'Inclusive' ? c2(amount - tax) : c2(amount);
  return { subtotal, tax: c2(tax), total: amountsAre === 'Inclusive' ? c2(amount) : c2(amount + tax), max_discount: Math.max(0, ...lines.map((l) => Number(l.discount))) };
}

/** The company's next quote number: QU-0001, QU-0002… */
export async function nextNumber(svc: Svc, entityId: string, prefix: string) {
  const { data } = await svc.from('crm_quotes').select('number').eq('entity_id', entityId).like('number', `${prefix}-%`);
  const n = Math.max(0, ...(data ?? []).map((q) => Number(String(q.number).split('-').pop()) || 0)) + 1;
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

/** Why the quote can't go out yet (null when it can): a discount over the limit needs a sales lead's approval. */
export async function holdUp(svc: Svc, q: Pick<Quote, 'id' | 'max_discount'>, limit: number) {
  if (Number(q.max_discount) <= Number(limit)) return null;
  const a = await getApproval(svc, 'quote', q.id);
  if (a?.status === 'approved') return null;
  if (a?.status === 'pending') return `A discount of ${q.max_discount}% is over the ${limit}% limit: waiting for a sales lead’s approval.`;
  if (a?.status === 'changes_requested') return `The sales lead asked for changes: ${a.decision_note}`;
  return `A discount of ${q.max_discount}% is over the ${limit}% limit: ask a sales lead to approve it.`;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
const INK = rgb(0.043, 0.114, 0.216);
const MUTED = rgb(0.42, 0.48, 0.56);
const LINE = rgb(0.85, 0.87, 0.9);
const plain = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff“”‘’–—…•€™\n]/g, '?');
function hex(c: string | null) {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? '');
  if (!m) return rgb(0.153, 0.416, 0.906);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const para of plain(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = w; } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** The quote as the buyer sees it: the company's name and colour, the lines, totals and terms. */
export async function quotePdf(q: Quote, lines: Line[], o: { company: { display_name: string; legal_name: string | null; brand_color: string | null; website: string | null }; buyer: string; contact: string; preparedBy: string }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${o.company.display_name} quote ${q.number}${q.version > 1 ? ` v${q.version}` : ''}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = hex(o.company.brand_color);
  const W = 595.28, H = 841.89, M = 48;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const text = (s: string, x: number, size = 10, f = font, color = INK) => page.drawText(plain(s), { x, y, size, font: f, color });
  const right = (s: string, xRight: number, size = 10, f = font, color = INK) => page.drawText(plain(s), { x: xRight - f.widthOfTextAtSize(plain(s), size), y, size, font: f, color });
  const room = (h: number) => { if (y - h < M + 40) { page = pdf.addPage([W, H]); y = H - M; } };

  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: accent });
  text(o.company.display_name, M, 18, bold); right('QUOTE', W - M, 18, bold, accent); y -= 18;
  text(o.company.legal_name ?? '', M, 9, font, MUTED); right(`${q.number}${q.version > 1 ? ` · version ${q.version}` : ''}`, W - M, 10, bold); y -= 13;
  if (o.company.website) text(o.company.website.replace(/^https?:\/\//, ''), M, 9, font, MUTED);
  right(`Date ${q.issue_date}${q.expiry_date ? ` · valid to ${q.expiry_date}` : ''}`, W - M, 9, font, MUTED); y -= 34;
  text('For', M, 9, font, MUTED); y -= 14; text(o.buyer, M, 12, bold); y -= 14; if (o.contact) { text(o.contact, M, 10); y -= 14; }
  y -= 16;
  if (q.title) { text(q.title, M, 14, bold); y -= 20; }
  if (q.summary) { for (const l of wrap(q.summary, font, 10, W - 2 * M)) { room(14); text(l, M, 10); y -= 14; } y -= 8; }

  // Lines
  const cols = { desc: M, qty: 322, price: 405, disc: 450, amount: W - M };
  room(30);
  page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: rgb(0.95, 0.96, 0.98) });
  y += 1; text('Description', cols.desc + 6, 9, bold, MUTED); right('Qty', cols.qty, 9, bold, MUTED); right('Price', cols.price, 9, bold, MUTED); right('Disc.', cols.disc, 9, bold, MUTED); right('Amount', cols.amount - 6, 9, bold, MUTED); y -= 24;
  for (const l of lines) {
    const desc = wrap([l.item_code, l.description].filter(Boolean).join(' · '), font, 9.5, cols.qty - cols.desc - 40);
    room(14 * desc.length + 10);
    const top = y;
    desc.forEach((d, i) => { page.drawText(plain(d), { x: cols.desc + 6, y: top - i * 13, size: 9.5, font, color: INK }); });
    right(String(Number(l.quantity)), cols.qty, 9.5); right(money(Number(l.unit_price), q.currency, true), cols.price, 9.5); right(Number(l.discount) ? `${Number(l.discount)}%` : '', cols.disc, 9.5); right(money(lineTotals(l, q.amounts_are).amount, q.currency, true), cols.amount - 6, 9.5);
    y = top - 13 * desc.length - 6;
    page.drawLine({ start: { x: M, y: y + 3 }, end: { x: W - M, y: y + 3 }, thickness: 0.5, color: LINE });
    y -= 6;
  }
  room(70);
  y -= 6;
  const totals: [string, string, boolean][] = [
    [q.amounts_are === 'Inclusive' ? 'Total excluding tax' : 'Subtotal', money(Number(q.subtotal), q.currency, true), false],
    ...(q.amounts_are === 'NoTax' ? [] : [[q.amounts_are === 'Inclusive' ? 'Includes tax' : 'Tax', money(Number(q.tax), q.currency, true), false] as [string, string, boolean]]),
    [`Total ${q.currency}`, money(Number(q.total), q.currency, true), true],
  ];
  for (const [label, value, strong] of totals) { right(label, cols.price + 20, strong ? 11 : 10, strong ? bold : font, strong ? INK : MUTED); right(value, cols.amount - 6, strong ? 12 : 10, strong ? bold : font); y -= strong ? 20 : 15; }
  if (q.terms) {
    y -= 16; room(30); text('Terms', M, 10, bold); y -= 14;
    for (const l of wrap(q.terms, font, 9, W - 2 * M)) { room(12); text(l, M, 9, font, MUTED); y -= 12; }
  }
  for (const p of pdf.getPages()) p.drawText(plain(`Prepared by ${o.preparedBy} · ${o.company.display_name}`), { x: M, y: 28, size: 8, font, color: MUTED });
  return Buffer.from(await pdf.save());
}

/** The quote's PDF, with its company, buyer and the deal's owner. */
export async function renderQuote(svc: Svc, q: Quote) {
  const [{ data: lines }, { data: ent }, { data: deal }] = await Promise.all([
    svc.from('crm_quote_lines').select('*').eq('quote_id', q.id).order('sort'),
    svc.from('entities').select('display_name, legal_name, brand_color, website').eq('id', q.entity_id).single(),
    svc.from('crm_deals').select('title, owner_id, crm_companies!crm_deals_company_id_fkey(name), crm_people!crm_deals_person_id_fkey(full_name, job_title)').eq('id', q.deal_id).single(),
  ]);
  const d = deal as unknown as { title: string; owner_id: string | null; crm_companies: { name: string } | null; crm_people: { full_name: string; job_title: string } | null };
  const names = await namesOf(svc, [d.owner_id]);
  return quotePdf(q, (lines ?? []) as Line[], {
    company: ent as { display_name: string; legal_name: string | null; brand_color: string | null; website: string | null },
    buyer: d.crm_companies?.name ?? d.crm_people?.full_name ?? d.title, contact: d.crm_people ? [d.crm_people.full_name, d.crm_people.job_title].filter(Boolean).join(', ') : '',
    preparedBy: (d.owner_id && names.get(d.owner_id)) || (ent as { display_name: string }).display_name,
  });
}
