import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/admin';
import { receive } from '../../../../lib/integrations/inbound';

/**
 * POST /api/hooks/in/{token} — an incoming webhook (see lib/integrations/inbound.ts). The sender proves it's
 * them with a signature or shared secret; the message is kept and answered with 202, then handled.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const token = params.token ?? '';
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return Response.json({ error: 'Unknown address.' }, { status: 404 });
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 30 * 1024 * 1024) return Response.json({ error: 'Too large.' }, { status: 413 });
  const raw = Buffer.from(await request.arrayBuffer());
  const r = await receive(serviceClient(), token, request.headers, raw, request.headers.get('content-type') ?? '');
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
};
