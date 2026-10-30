import type { APIRoute } from 'astro';
import { serviceClient } from '../../lib/admin';
import { tourByKey } from '../../lib/tours';

/** A guided tour finished or closed (components/Tour.astro): remembered so it doesn't start by itself again. */
export const POST: APIRoute = async ({ request, url, locals }) => {
  if (!locals.user || request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const body = (await request.json().catch(() => null)) as { key?: string } | null;
  const tour = tourByKey(body?.key);
  if (!tour) return new Response('Unknown tour', { status: 400 });
  const seen = locals.profile?.tours_seen ?? [];
  if (!seen.includes(tour.key)) await serviceClient().from('profiles').update({ tours_seen: [...seen, tour.key] }).eq('id', locals.user.id).throwOnError();
  return new Response(null, { status: 204 });
};
