import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/admin';
import { loadRelease, pressAccess, pressSettings } from '../../../../lib/press';
import { wirePackage } from '../../../../lib/press-channels';

/** The release's wire package (text, HTML, PDF, images) as a zip. Approved or published releases only. */
export const GET: APIRoute = async ({ params, locals, url }) => {
  if (!pressAccess(locals)) return new Response('Forbidden', { status: 403 });
  const svc = serviceClient();
  const r = await loadRelease(svc, params.id!);
  if (!r || !['approved', 'published'].includes(r.status)) return new Response('Not found', { status: 404 });
  const { data: post } = r.post_id ? await svc.from('posts').select('slug').eq('id', r.post_id).maybeSingle() : { data: null };
  const p = await wirePackage(svc, r, await pressSettings(svc), post?.slug ?? null, url.origin);
  await locals.supabase.rpc('log_event', { event_action: 'press_wire_package_downloaded', event_detail: { id: r.id } });
  return new Response(new Uint8Array(p.bytes), { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${p.name}.zip"`, 'cache-control': 'no-store' } });
};
