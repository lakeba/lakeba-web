import { ASSEMBLYAI_API_BASE, ASSEMBLYAI_API_KEY, ASSEMBLYAI_STREAMING_BASE, DEEPGRAM_API_BASE, DEEPGRAM_API_KEY, DEEPGRAM_LANGUAGE } from 'astro:env/server';
import { outbound } from './outbound';

// Speech to text for the Observer (board meetings), from Deepgram or
// AssemblyAI. Live: the tablet streams 16 kHz audio straight to the provider
// with a short-lived token from here (the key never leaves this server), and
// shows the text as it comes. After the meeting: the whole recording is sent
// from here for a full pass with speakers, which becomes the transcript.

export type Provider = 'deepgram' | 'assemblyai';
export const PROVIDERS: Record<Provider, { name: string; ready: () => boolean }> = {
  deepgram: { name: 'Deepgram', ready: () => Boolean(DEEPGRAM_API_KEY) },
  assemblyai: { name: 'AssemblyAI', ready: () => Boolean(ASSEMBLYAI_API_KEY) },
};
export const readyProviders = () => (Object.keys(PROVIDERS) as Provider[]).filter((p) => PROVIDERS[p].ready());
export type Segment = { start_ms: number; end_ms: number; speaker: string; text: string };
export const SAMPLE_RATE = 16_000;
const ws = (base: string) => base.replace(/^http/, 'ws');

/** Key terms (company and people's names) the services should listen for: at most 100, each a few words. */
export const MAX_TERMS = 100;
const cleanTerms = (terms: string[]) => [...new Map(terms.map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 50)).filter((t) => t.length >= 2).map((t) => [t.toLowerCase(), t])).values()].slice(0, MAX_TERMS);

const json = (text: string) => { try { return JSON.parse(text); } catch { return null; } };
function failed(provider: Provider, status: number, text: string) {
  const j = json(text) as { err_msg?: string; error?: string; message?: string } | null;
  return new Error(`${PROVIDERS[provider].name}: ${status} ${j?.err_msg ?? j?.error ?? j?.message ?? text.slice(0, 200)}`);
}

/** Where and how the tablet connects for live text: the address (with its settings) and, for Deepgram, the WebSocket protocols carrying the token. */
export async function liveSession(provider: Provider, speakers: number, terms: string[] = []) {
  const keyterms = cleanTerms(terms);
  if (provider === 'deepgram') {
    const res = await outbound('POST', `${DEEPGRAM_API_BASE}/v1/auth/grant`, { headers: { authorization: `Token ${DEEPGRAM_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ ttl_seconds: 60 }) });
    if (res.status >= 400) throw failed(provider, res.status, res.text);
    const q = new URLSearchParams({ model: 'nova-3', language: DEEPGRAM_LANGUAGE, diarize: 'true', punctuate: 'true', smart_format: 'true', interim_results: 'true', utterance_end_ms: '1500', endpointing: '500', encoding: 'linear16', sample_rate: String(SAMPLE_RATE), channels: '1' });
    for (const t of keyterms) q.append('keyterm', t);
    return { url: `${ws(DEEPGRAM_API_BASE)}/v1/listen?${q}`, protocols: ['bearer', json(res.text).access_token as string] };
  }
  const res = await outbound('GET', `${ASSEMBLYAI_STREAMING_BASE}/v3/token?expires_in_seconds=600&max_session_duration_seconds=10800`, { headers: { authorization: ASSEMBLYAI_API_KEY ?? '' } });
  if (res.status >= 400) throw failed(provider, res.status, res.text);
  const q = new URLSearchParams({ token: json(res.text).token as string, sample_rate: String(SAMPLE_RATE), encoding: 'pcm_s16le', format_turns: 'true', speaker_labels: 'true', ...(speakers >= 1 && speakers <= 10 ? { max_speakers: String(speakers) } : {}), ...(keyterms.length ? { keyterms_prompt: JSON.stringify(keyterms) } : {}) });
  return { url: `${ws(ASSEMBLYAI_STREAMING_BASE)}/v3/ws?${q}`, protocols: [] as string[] };
}

/** The whole recording, with speakers: a list of who said what, when. */
export async function transcribeRecording(provider: Provider, audio: Buffer, mime: string, speakers: number, terms: string[] = []): Promise<Segment[]> {
  const keyterms = cleanTerms(terms);
  if (provider === 'deepgram') {
    const q = new URLSearchParams({ model: 'nova-3', language: DEEPGRAM_LANGUAGE, diarize: 'true', utterances: 'true', punctuate: 'true', smart_format: 'true', paragraphs: 'true' });
    for (const t of keyterms) q.append('keyterm', t);
    const res = await outbound('POST', `${DEEPGRAM_API_BASE}/v1/listen?${q}`, { headers: { authorization: `Token ${DEEPGRAM_API_KEY}`, 'content-type': mime }, body: audio, max: 50_000_000, timeout: 900_000 });
    if (res.status >= 400) throw failed(provider, res.status, res.text);
    const u = (json(res.text)?.results?.utterances ?? []) as { start: number; end: number; speaker?: number; transcript: string }[];
    return u.filter((x) => x.transcript?.trim()).map((x) => ({ start_ms: Math.round(x.start * 1000), end_ms: Math.round(x.end * 1000), speaker: x.speaker == null ? '' : `Speaker ${x.speaker + 1}`, text: x.transcript.trim() }));
  }
  const key = ASSEMBLYAI_API_KEY ?? '';
  const up = await outbound('POST', `${ASSEMBLYAI_API_BASE}/v2/upload`, { headers: { authorization: key, 'content-type': 'application/octet-stream' }, body: audio, timeout: 900_000 });
  if (up.status >= 400) throw failed(provider, up.status, up.text);
  const created = await outbound('POST', `${ASSEMBLYAI_API_BASE}/v2/transcript`, { headers: { authorization: key, 'content-type': 'application/json' }, body: JSON.stringify({ audio_url: json(up.text).upload_url, speaker_labels: true, language_code: 'en_au', punctuate: true, format_text: true, ...(speakers >= 2 && speakers <= 10 ? { speakers_expected: speakers } : {}), ...(keyterms.length ? { keyterms_prompt: keyterms } : {}) }) });
  if (created.status >= 400) throw failed(provider, created.status, created.text);
  const id = json(created.text).id as string;
  // A meeting takes AssemblyAI a fraction of its length; wait up to an hour.
  for (let i = 0; i < 720; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await outbound('GET', `${ASSEMBLYAI_API_BASE}/v2/transcript/${id}`, { headers: { authorization: key }, max: 50_000_000, timeout: 60_000 });
    if (res.status >= 400) throw failed(provider, res.status, res.text);
    const t = json(res.text) as { status: string; error?: string; utterances?: { start: number; end: number; speaker: string; text: string }[] };
    if (t.status === 'error') throw new Error(`AssemblyAI: ${t.error ?? 'the transcription failed'}`);
    if (t.status === 'completed') return (t.utterances ?? []).filter((x) => x.text?.trim()).map((x) => ({ start_ms: x.start, end_ms: x.end, speaker: `Speaker ${x.speaker}`, text: x.text.trim() }));
  }
  throw new Error('AssemblyAI took more than an hour.');
}
