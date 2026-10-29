import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../../lib/admin';
import { MAX_CHUNK, observerMeeting, storeChunk } from '../../../../../lib/observer';

/** A piece of the meeting's audio from the Observer tablet (?take=1&seq=12), kept as it arrives. */
export const POST: APIRoute = async ({ request, params, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const svc = serviceClient();
  const m = await observerMeeting(svc, locals.access, params.id ?? '');
  if (!m) return new Response('Not found', { status: 404 });
  const take = Number(url.searchParams.get('take')), seq = Number(url.searchParams.get('seq'));
  const t = m.recording_takes.find((x) => x.take === take);
  if (!t || t.ended_at || !Number.isInteger(seq) || seq < 0 || seq > 99_999) return new Response('Not recording', { status: 409 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_CHUNK) return new Response('Bad audio', { status: 400 });
  await storeChunk(svc, m, take, seq, bytes, request.headers.get('content-type') ?? 'audio/webm');
  return new Response(null, { status: 204 });
};
