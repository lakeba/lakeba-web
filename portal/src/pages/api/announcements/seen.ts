import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';

/** An announcement's pop-up was closed or followed (components/Tour.astro): it won't show to this person again. */
export const POST: APIRoute = async ({ request, url, locals }) => {
  if (!locals.user || request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const id = ((await request.json().catch(() => null)) as { id?: string } | null)?.id ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Unknown announcement', { status: 400 });
  const svc = serviceClient();
  const { data } = await svc.from('announcements').select('id').eq('id', id).eq('popup', true).maybeSingle();
  if (!data) return new Response('Unknown announcement', { status: 400 });
  await svc.from('announcement_views').upsert({ announcement_id: id, user_id: locals.user.id }, { ignoreDuplicates: true }).throwOnError();
  return new Response(null, { status: 204 });
};
