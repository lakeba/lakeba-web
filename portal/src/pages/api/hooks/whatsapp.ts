import type { APIRoute } from 'astro';
import { WHATSAPP_VERIFY_TOKEN } from 'astro:env/server';
import { serviceClient } from '../../../lib/admin';
import { handleMessage, signedByMeta, whatsappReady } from '../../../lib/whatsapp';

/**
 * Meta's WhatsApp webhook (lib/whatsapp.ts). GET: Meta checks the address once, with the verify token set on
 * the server. POST: messages, signed with the app secret; answered at once, handled after.
 */
export const GET: APIRoute = ({ url }) => {
  const ok = WHATSAPP_VERIFY_TOKEN && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === WHATSAPP_VERIFY_TOKEN;
  return ok ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 }) : new Response('Forbidden', { status: 403 });
};

export const POST: APIRoute = async ({ request, locals, url }) => {
  if (!whatsappReady()) return new Response(null, { status: 404 });
  const body = await request.text();
  if (!signedByMeta(request.headers.get('x-hub-signature-256'), body)) return new Response('Bad signature', { status: 401 });
  let event: { entry?: { changes?: { value?: { messages?: Parameters<typeof handleMessage>[1][] } }[] }[] };
  try { event = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400 }); }
  const svc = serviceClient();
  const origin = locals.site?.central ?? url.origin;
  for (const e of event.entry ?? []) for (const c of e.changes ?? []) for (const m of c.value?.messages ?? []) {
    void handleMessage(svc, m, origin).catch((err) => console.error('whatsapp', (err as Error).message));
  }
  return new Response(null, { status: 200 });
};
