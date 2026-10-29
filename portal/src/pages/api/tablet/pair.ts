import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { TABLET_COOKIE, pairingState, releaseTablet, startPairing, tabletOf } from '../../../lib/tablets';

/**
 * The boardroom tablet's pairing (lib/tablets.ts), for the /tablet page and the Lex app:
 *   GET                       what to show: new | waiting {expiresAt} | expired | connected {meeting, url} | released {why}
 *   POST {action: "code", device_name}   a new six-digit code to show (sets the tablet's secret cookie)
 *   POST {action: "leave"}               the tablet lets go of its meeting
 */
export const GET: APIRoute = async ({ cookies }) =>
  Response.json(await pairingState(serviceClient(), cookies.get(TABLET_COOKIE)?.value), { headers: { 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request, cookies, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const svc = serviceClient();
  const b = await request.json().catch(() => ({})) as { action?: unknown; device_name?: unknown };
  if (b.action === 'leave') {
    const t = await tabletOf(svc, cookies.get(TABLET_COOKIE)?.value ?? '');
    if (t?.meeting_id && !t.released_at) await releaseTablet(svc, t.id, 'Disconnected on the tablet.');
    return Response.json({ ok: true });
  }
  if (b.action !== 'code') return Response.json({ error: 'Unknown action.' }, { status: 400 });
  try {
    const name = typeof b.device_name === 'string' ? b.device_name.replace(/[^\p{L}\p{N} ._()-]/gu, '').trim() : '';
    const { code, expiresAt } = await startPairing(svc, cookies, url.protocol === 'https:' || url.hostname === 'localhost', name);
    return Response.json({ code, expiresAt }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
};
