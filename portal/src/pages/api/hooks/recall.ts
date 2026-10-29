import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { recallEvent, signedByRecall } from '../../../lib/recall';

/** Recall.ai's bot status webhooks (lib/recall.ts): signed; answered at once, as Recall asks. */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.text();
  if (!signedByRecall(request.headers, body)) return new Response('Bad signature', { status: 401 });
  let event: Parameters<typeof recallEvent>[1];
  try { event = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400 }); }
  void recallEvent(serviceClient(), event).catch((e) => console.error('recall event', e));
  return new Response(null, { status: 204 });
};
