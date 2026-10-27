import type { APIRoute } from 'astro';
import { serviceClient } from '../../lib/admin';
import { token } from '../../lib/integrations/oauth';

/** POST /oauth/token — authorization_code (with the client secret or PKCE) and refresh_token grants. */
export const POST: APIRoute = async ({ request }) => {
  const type = request.headers.get('content-type') ?? '';
  let p: URLSearchParams;
  if (type.startsWith('application/json')) { try { p = new URLSearchParams(Object.entries(await request.json()).map(([k, v]) => [k, String(v)])); } catch { p = new URLSearchParams(); } }
  else p = new URLSearchParams(await request.text());
  const basic = request.headers.get('authorization')?.match(/^Basic\s+(.+)$/i)?.[1] ?? null;
  const r = await token(serviceClient(), p, basic);
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
};
