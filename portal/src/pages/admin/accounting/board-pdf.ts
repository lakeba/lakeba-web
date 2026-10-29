import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { boardSummaryPdf, groupItems } from '../../../lib/reporting-group';

/** The board summary for a period as a PDF, with the saved commentary. */
export const GET: APIRoute = async ({ url }) => {
  const period = url.searchParams.get('period') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) return new Response('Choose a period.', { status: 400 });
  const svc = serviceClient();
  const { data: saved } = await svc.from('board_summaries').select('commentary').eq('period_end', period).maybeSingle();
  const pdf = await boardSummaryPdf(period, await groupItems(svc, period), (saved?.commentary as string) ?? '');
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="board-summary-${period}.pdf"` } });
};
