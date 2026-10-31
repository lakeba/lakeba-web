import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { recallEvent, signedByRecall } from '../../../lib/recall';
import { crmRecallEvent } from '../../../lib/crm-recall';

/** Recall.ai's bot status webhooks (lib/recall.ts): signed; answered at once, as Recall asks. */
export const POST: APIRoute = async ({ request, url, locals }) => {
  const body = await request.text();
  if (!signedByRecall(request.headers, body)) return new Response('Bad signature', { status: 401 });
  let event: Parameters<typeof recallEvent>[2];
  try { event = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400 }); }
  // A CRM notetaker's (lib/crm-recall.ts), else Lex's in a board meeting.
  const origin = locals.site?.central ?? url.origin;
  void crmRecallEvent(serviceClient(), origin, event as never).then((crm) => (crm ? null : recallEvent(serviceClient(), origin, event))).catch((e) => console.error('recall event', e));
  return new Response(null, { status: 204 });
};
