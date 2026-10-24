import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { recipientByToken } from '../../../lib/newsletter';

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Open tracking (a 1-pixel image). Approximate: some mail apps load images for everyone, others never. */
export const GET: APIRoute = async ({ params }) => {
  const token = (params.file ?? '').replace(/\.gif$/, '');
  const svc = serviceClient();
  const r = await recipientByToken(svc, token);
  if (r) await svc.from('newsletter_recipients').update({ opened_at: r.opened_at ?? new Date().toISOString(), open_count: r.open_count + 1 }).eq('id', r.id);
  return new Response(GIF, { headers: { 'content-type': 'image/gif', 'cache-control': 'no-store' } });
};
