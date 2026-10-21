import type { APIRoute } from 'astro';
import { loadPositions, loadPrices } from '../../lib/holdings';
import { holdingStatementPdf } from '../../lib/statement';

/** Personal holding statement PDF for one of the user's holders. */
export const GET: APIRoute = async ({ params, url, locals }) => {
  const supabase = locals.supabase;
  const positions = await loadPositions(supabase, locals.user!.id);
  const shareClass = url.searchParams.get('class');
  const position = positions.find((p) => p.holder.id === params.holderId && (!shareClass || p.row.share_class_id === shareClass));
  if (!position) return new Response('Not found', { status: 404 });

  const price = (await loadPrices(supabase, position.row.share_class_id)).at(-1);
  const pdf = await holdingStatementPdf(position, price, locals.profile?.email ?? '');
  await supabase.rpc('log_event', { event_action: 'statement_downloaded', event_detail: { holder_id: position.holder.id } });

  const name = `Lakeba-holding-statement-${position.holder.name.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`;
  return new Response(pdf, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'no-store' },
  });
};
