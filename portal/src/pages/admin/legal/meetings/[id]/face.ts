import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../../lib/admin';
import { FACES, faceSession, type FaceProvider } from '../../../../../lib/face';
import { observerMeeting } from '../../../../../lib/observer';

/** A session token for Lex's lifelike face on the Observer tablet (JSON {provider}). */
export const POST: APIRoute = async ({ request, params, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const m = await observerMeeting(serviceClient(), locals.access, params.id ?? '');
  if (!m) return Response.json({ error: 'Not found.' }, { status: 404 });
  const b = await request.json().catch(() => ({})) as { provider?: string };
  if (!b.provider || !(b.provider in FACES)) return Response.json({ error: 'Choose Anam or Simli.' }, { status: 400 });
  try {
    return Response.json(await faceSession(b.provider as FaceProvider));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
};
