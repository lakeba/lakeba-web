import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { BS_LINES, IC_FIELDS, PL_LINES, periodLabel, totals, type BsLine, type PlLine } from '../../../lib/reporting';
import { consolidate, consolidatedItems, groupItems, matchPairs } from '../../../lib/reporting-group';
import { writeXlsx } from '../../../lib/xlsx-write';

/** The group for a period as an Excel workbook: every company's lines, the consolidated view, what is between them. */
export const GET: APIRoute = async ({ url, locals }) => {
  const period = url.searchParams.get('period') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) return new Response('Choose a period.', { status: 400 });
  const svc = serviceClient();
  const items = (await groupItems(svc, period)).filter((i) => i.figures);
  const c = consolidate(consolidatedItems(items));
  const header = ['Line', ...items.map((i) => `${i.name}${i.currency !== 'AUD' ? ` (${i.currency})` : ''}`), 'Consolidated (AUD)'];
  const pl = (w: 'period' | 'ytd') => [header, ...(Object.entries(PL_LINES) as [PlLine, string][]).map(([k, l]) => [l, ...items.map((i) => i.figures!.pl?.[k]?.[w] ?? null), c.figures.pl?.[k]?.[w] ?? null])];
  const bs = [header, ...(Object.entries(BS_LINES) as [BsLine, string][]).map(([k, l]) => [l, ...items.map((i) => i.figures!.bs?.[k] ?? null), c.figures.bs?.[k] ?? null]),
    ['Net assets', ...items.map((i) => totals(i.figures!).netAssets), c.netAssets]];
  const nameOf = new Map(items.map((i) => [i.id, i.name]));
  const ic = [['Company', 'With', ...Object.values(IC_FIELDS)], ...items.flatMap((i) => (i.figures!.ic ?? []).map((r) => [i.name, nameOf.get(r.entity_id) ?? r.entity_id, r.receivable, r.payable, r.income, r.expense]))];
  const pairs = [['What', 'First', 'Says', 'Second', 'Says', 'Difference'], ...matchPairs(items).map((p) => [p.what, p.a, p.aSays, p.b, p.bSays, p.difference])];
  const packs = [['Company', 'Pack period', 'State'], ...items.map((i) => [i.name, periodLabel(i.pack!.period_end, i.pack!.cadence), i.pack!.status === 'accepted' ? 'Accepted' : 'Sent, not reviewed'])];
  const widths = [34, ...items.map(() => 16), 20];
  const xlsx = await writeXlsx([
    { name: 'P&L period', rows: pl('period'), widths }, { name: 'P&L year to date', rows: pl('ytd'), widths }, { name: 'Balance sheet', rows: bs, widths },
    { name: 'Intercompany', rows: ic, widths: [24, 24, 18, 18, 22, 22] }, { name: 'Matching', rows: pairs, widths: [44, 20, 14, 20, 14, 14] }, { name: 'Packs', rows: packs, widths: [24, 22, 20] },
  ]);
  await locals.supabase.rpc('log_event', { event_action: 'admin_exported_group_accounts', event_detail: { period } });
  return new Response(xlsx, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="lakeba-group-${period}.xlsx"` } });
};
