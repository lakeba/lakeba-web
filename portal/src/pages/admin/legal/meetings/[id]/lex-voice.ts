import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../../lib/admin';
import { MAX_SPOKEN, speak, voiceReady } from '../../../../../lib/lex';
import { observerMeeting } from '../../../../../lib/observer';

/** Lex's voice for a piece of text (JSON {text}), as MP3 (or ?format=pcm for its face), for the Observer tablet. The key stays on this server. */
export const POST: APIRoute = async ({ request, params, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  if (!voiceReady()) return Response.json({ error: 'Lex’s voice isn’t set up (ElevenLabs key).' }, { status: 503 });
  const m = await observerMeeting(serviceClient(), locals.access, params.id ?? '');
  if (!m) return Response.json({ error: 'Not found.' }, { status: 404 });
  const b = await request.json().catch(() => ({})) as { text?: unknown };
  const text = typeof b.text === 'string' ? b.text.slice(0, MAX_SPOKEN) : '';
  if (!text.trim()) return Response.json({ error: 'Nothing to say.' }, { status: 400 });
  try {
    // ?format=pcm: raw 16 kHz 16-bit mono, for Lex's lifelike face to lip-sync.
    const pcm = url.searchParams.get('format') === 'pcm';
    const audio = await speak(text, pcm ? 'pcm' : 'mp3');
    return new Response(new Uint8Array(audio), { headers: { 'Content-Type': pcm ? 'application/octet-stream' : 'audio/mpeg', 'Cache-Control': 'private, max-age=600' } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
};
