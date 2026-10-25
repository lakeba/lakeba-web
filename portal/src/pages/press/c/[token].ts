import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { pitchByToken, recordClick } from '../../../lib/press-outreach';

/** A link in a pitch: counted, then on to its address (only addresses that are in that pitch). */
export const GET: APIRoute = async ({ params, url }) => {
  const svc = serviceClient();
  const target = url.searchParams.get('u') ?? '';
  const p = await pitchByToken(svc, params.token ?? '');
  if (!p || !/^https?:\/\//.test(target) || !(await recordClick(svc, p, target))) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store' } });
};
