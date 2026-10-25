import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { audPrecise, aud, longDate, shares as fmtShares } from './format';
import { companyIdentity } from './companies';

// Tax-time pack: one PDF per holder and financial year (1 July – 30 June) with,
// per share class, the shares at the start and end of the year, the changes
// during it, and the reference price and indicative value at 30 June.
// Facts from the register only: not tax advice.

const INK = rgb(0.043, 0.114, 0.216);
const MUTED = rgb(0.42, 0.48, 0.56);

export const fyLabel = (fy: number) => `FY${String(fy).slice(2)} (1 July ${fy - 1} – 30 June ${fy})`;
export const fyBounds = (fy: number) => ({ start: `${fy - 1}-07-01`, end: `${fy}-06-30` });
/** The financial year a date falls in (FY2026 ends 30 June 2026). */
export const fyOf = (date: string) => (Number(date.slice(5, 7)) >= 7 ? Number(date.slice(0, 4)) + 1 : Number(date.slice(0, 4)));

type Row = { shares: number; as_at: string; share_class_id: string; share_classes: { code: string; name: string; kind: string; entity_id: string; entities: { display_name: string; legal_name: string | null; company_number: string | null; country: string | null } | null } | null };

/** Financial years in which this holder had shares (up to the current one). */
export async function taxYears(supabase: SupabaseClient, holderId: string) {
  const { data } = await supabase.from('holdings').select('as_at').eq('holder_id', holderId).order('as_at');
  if (!data?.length) return [];
  const first = fyOf(data[0].as_at);
  const current = fyOf(new Date().toISOString().slice(0, 10));
  return Array.from({ length: current - first + 1 }, (_, i) => current - i);
}

export async function taxPackPdf(supabase: SupabaseClient, holder: { id: string; name: string; registry_ref: string | null }, fy: number, recipient: string) {
  const { start, end } = fyBounds(fy);
  const { data } = await supabase.from('holdings').select('shares, as_at, share_class_id, share_classes(code, name, kind, entity_id, entities(display_name, legal_name, company_number, country))').eq('holder_id', holder.id).lte('as_at', end).order('as_at');
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.share_classes);
  const byClass = Map.groupBy(rows, (r) => r.share_class_id);
  const classIds = [...byClass.keys()];
  const { data: priceRows } = classIds.length ? await supabase.from('reference_prices').select('share_class_id, price, priced_on, source').in('share_class_id', classIds).lte('priced_on', end).order('priced_on') : { data: [] };

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Tax-time pack ${fyLabel(fy)} – ${holder.name}`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  const left = 56, right = 595.28 - 56;
  let y = 841.89 - 64;
  const text = (s: string, x: number, opts: { size?: number; font?: typeof regular; color?: ReturnType<typeof rgb>; alignRight?: boolean } = {}) => {
    const size = opts.size ?? 10, font = opts.font ?? regular;
    page.drawText(s, { x: opts.alignRight ? x - font.widthOfTextAtSize(s, size) : x, y, size, font, color: opts.color ?? INK });
  };
  const need = (h: number) => { if (y - h < 70) { page = pdf.addPage([595.28, 841.89]); y = 841.89 - 64; } };

  text('Tax-time pack', left, { size: 18, font: bold });
  text(fyLabel(fy), right, { size: 11, alignRight: true, color: MUTED });
  y -= 30;
  text(holder.name, left, { size: 12, font: bold });
  text(`Registry reference: ${holder.registry_ref ?? '—'}`, right, { alignRight: true, color: MUTED });
  y -= 30;

  let total = 0;
  let any = false;
  for (const [classId, list] of byClass) {
    const cls = list[0].share_classes!;
    const opening = [...list].filter((r) => r.as_at < start).at(-1)?.shares ?? 0;
    const closing = list.at(-1)!.shares;
    const moves = list.filter((r) => r.as_at >= start);
    if (!opening && !closing && !moves.length) continue;
    any = true;
    const price = (priceRows ?? []).filter((p) => p.share_class_id === classId).at(-1);
    const value = price ? closing * Number(price.price) : null;
    if (value) total += value;

    need(110 + moves.length * 14);
    page.drawRectangle({ x: left, y: y - 6, width: right - left, height: 22, color: rgb(0.94, 0.96, 1) });
    const identity = companyIdentity(cls.entities);
    text(`${cls.entities?.legal_name || cls.entities?.display_name || ''} · ${cls.name}`, left + 8, { font: bold });
    if (identity) text(identity, right - 8, { alignRight: true, size: 9, color: MUTED });
    y -= 26;
    const line = (label: string, val: string) => { text(label, left + 8, { color: MUTED }); text(val, right - 8, { alignRight: true, font: bold }); y -= 15; };
    line(`Held at 1 July ${fy - 1}`, fmtShares.format(opening));
    let prev = opening;
    for (const m of moves) {
      const diff = m.shares - prev;
      if (diff !== 0) line(`Change on ${longDate.format(new Date(m.as_at))}`, `${diff > 0 ? '+' : ''}${fmtShares.format(diff)}`);
      prev = m.shares;
    }
    line(`Held at 30 June ${fy}`, fmtShares.format(closing));
    line('Reference price at 30 June', price ? `${audPrecise.format(Number(price.price))} (${longDate.format(new Date(price.priced_on))})` : 'none');
    line('Indicative value at 30 June', value != null ? aud.format(value) : '—');
    y -= 12;
  }
  if (!any) { text('No holdings in this financial year.', left, { color: MUTED }); y -= 20; }
  else {
    need(40);
    text('Total indicative value at 30 June', left, { font: bold });
    text(aud.format(total), right, { alignRight: true, font: bold });
    y -= 30;
  }
  need(60);
  for (const l of [
    'From the share register kept in the Lakeba investor portal. Reference prices and values are indicative only and are not',
    'a valuation, and this is not tax advice. Dividends and other payments are not included. Please check with your accountant.',
    `Prepared for ${recipient} on ${longDate.format(new Date())}.`,
  ]) { text(l, left, { size: 8, color: MUTED }); y -= 11; }
  return pdf.save();
}
