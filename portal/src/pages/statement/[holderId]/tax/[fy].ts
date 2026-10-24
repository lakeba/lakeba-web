import type { APIRoute } from 'astro';
import { myHolderIds } from '../../../../lib/scope';
import { taxPackPdf } from '../../../../lib/tax-pack';

/** Tax-time pack PDF (one financial year) for one of the user's holders. */
export const GET: APIRoute = async ({ params, locals }) => {
  const supabase = locals.supabase;
  const fy = Number(params.fy);
  if (!Number.isInteger(fy) || fy < 2000 || fy > 2100) return new Response('Not found', { status: 404 });
  if (!(await myHolderIds(supabase, locals.user!.id)).includes(params.holderId!)) return new Response('Not found', { status: 404 });
  const { data: holder } = await supabase.from('holders').select('id, name, registry_ref').eq('id', params.holderId!).single();
  if (!holder) return new Response('Not found', { status: 404 });

  const pdf = await taxPackPdf(supabase, holder, fy, locals.profile?.email ?? '');
  await supabase.rpc('log_event', { event_action: 'tax_pack_downloaded', event_detail: { holder_id: holder.id, fy } });
  const name = `Lakeba-tax-pack-FY${String(fy).slice(2)}-${holder.name.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`;
  return new Response(pdf, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'no-store' },
  });
};
