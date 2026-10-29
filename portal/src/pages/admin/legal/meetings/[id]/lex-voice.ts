import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../../lib/admin';
import { faceVoice } from '../../../../../lib/face';
import { MAX_SPOKEN, speakStream, voiceReady } from '../../../../../lib/lex';
import { observerMeeting } from '../../../../../lib/observer';

/**
 * Lex's voice for a piece of text (JSON {text}), for the Observer tablet: raw 16-bit mono PCM
 * (?rate=24000 for the tablet's speaker, 16000 for its face), streamed as ElevenLabs makes it,
 * so it starts playing at once; ?face=anam|simli for the voice that suits that face. The key stays on this server.
 */
export const POST: APIRoute = async ({ request, params, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  if (!voiceReady()) return Response.json({ error: 'Lex’s voice isn’t set up (ElevenLabs key).' }, { status: 503 });
  const m = await observerMeeting(serviceClient(), locals.access, params.id ?? '');
  if (!m) return Response.json({ error: 'Not found.' }, { status: 404 });
  const b = await request.json().catch(() => ({})) as { text?: unknown };
  const text = typeof b.text === 'string' ? b.text.slice(0, MAX_SPOKEN) : '';
  if (!text.trim()) return Response.json({ error: 'Nothing to say.' }, { status: 400 });
  const rate = url.searchParams.get('rate') === '16000' ? 16000 : 24000;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await speakStream(text, rate, (chunk) => { try { controller.enqueue(new Uint8Array(chunk)); } catch { /* the tablet went away */ } }, faceVoice(url.searchParams.get('face')));
        controller.close();
      } catch (e) {
        console.error('lex-voice', (e as Error).message);
        try { controller.error(e); } catch { /* closed already */ }
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
};
