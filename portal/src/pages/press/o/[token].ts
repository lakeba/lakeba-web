import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { pitchByToken, recordOpen } from '../../../lib/press-outreach';

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Pitch open tracking (a 1-pixel image). Approximate: some mail apps load images for everyone, others never. */
export const GET: APIRoute = async ({ params }) => {
  const svc = serviceClient();
  const p = await pitchByToken(svc, params.token ?? '');
  if (p) await recordOpen(svc, p);
  return new Response(GIF, { headers: { 'content-type': 'image/gif', 'cache-control': 'no-store' } });
};
