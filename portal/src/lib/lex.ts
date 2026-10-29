import { ELEVENLABS_API_BASE, ELEVENLABS_API_KEY, ELEVENLABS_MODEL, ELEVENLABS_SPEED, ELEVENLABS_VOICE_ID } from 'astro:env/server';
import { outbound } from './outbound';
import { SPOKEN_BREAK } from './board-ask';

// Lex, the board assistant in the room (Observer tablet, phase 3): called by
// name in the live transcript ("Lex, what's our cash runway?") or with the
// Ask button, it answers aloud in a few sentences with an ElevenLabs voice
// and shows the detail with its sources. The brain is Board Ask, limited to
// the meeting company's records (or the whole group for Lakeba's own board).

export const LEX = 'Lex';
export const voiceReady = () => Boolean(ELEVENLABS_API_KEY);
/** "Lex, …", "Hey Lex …", and how speech recognition tends to spell it. */
export const WAKE = /\b(?:hey\s+|ok(?:ay)?\s+)?(?:lex|lexx|lecks|lexi)\b[\s,.:!?-]*/i;
export const MAX_SPOKEN = 600;

/** The answer split into what Lex says aloud and the detail for the screen. */
export function splitAnswer(answer: string) {
  const at = answer.split('\n').findIndex((l) => l.trim() === SPOKEN_BREAK);
  if (at >= 0) {
    const lines = answer.split('\n');
    return { spoken: clean(lines.slice(0, at).join(' ')), detail: lines.slice(at + 1).join('\n').trim() };
  }
  // No break: the first sentences, without references, are said aloud.
  const plain = clean(answer);
  const sentences = plain.match(/[^.!?]+[.!?]+/g) ?? [plain];
  return { spoken: sentences.slice(0, 3).join(' ').trim(), detail: answer.trim() };
}
const clean = (t: string) => t.replace(/\[[^\]]{1,80}\]/g, '').replace(/[*_#`>|]/g, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim().slice(0, MAX_SPOKEN);

let voice: Promise<string> | null = null;
/** The voice: as set, or the account's first Australian stock voice, or its first voice. */
function voiceId() {
  if (ELEVENLABS_VOICE_ID) return Promise.resolve(ELEVENLABS_VOICE_ID);
  voice ??= (async () => {
    const res = await outbound('GET', `${ELEVENLABS_API_BASE}/v1/voices`, { headers: { 'xi-api-key': ELEVENLABS_API_KEY ?? '' } });
    if (res.status >= 400) { voice = null; throw new Error(`ElevenLabs: ${res.status} ${res.text.slice(0, 200)}`); }
    const list = (JSON.parse(res.text).voices ?? []) as { voice_id: string; name: string; labels?: Record<string, string> }[];
    const aussie = list.find((v) => /austral/i.test(`${v.labels?.accent ?? ''} ${v.labels?.description ?? ''}`));
    if (!list.length) throw new Error('ElevenLabs: this account has no voices.');
    return (aussie ?? list[0]).voice_id;
  })();
  return voice;
}

const said = new Map<string, Buffer>();
/**
 * Lex's voice for a piece of text: MP3, or raw 16 kHz 16-bit mono PCM for a
 * lifelike face to lip-sync. Short fixed phrases are kept, so "One moment" plays at once.
 */
export async function speak(text: string, format: 'mp3' | 'pcm' = 'mp3') {
  const t = text.trim().slice(0, MAX_SPOKEN);
  if (!t) throw new Error('Nothing to say.');
  const key = `${format}:${t}`;
  const kept = said.get(key);
  if (kept) return kept;
  const res = await outbound('POST', `${ELEVENLABS_API_BASE}/v1/text-to-speech/${await voiceId()}?output_format=${format === 'pcm' ? 'pcm_16000' : 'mp3_44100_128'}`, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY ?? '', 'content-type': 'application/json', accept: format === 'pcm' ? 'audio/pcm' : 'audio/mpeg' },
    body: JSON.stringify({ text: t, model_id: ELEVENLABS_MODEL, voice_settings: { stability: 0.55, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, ELEVENLABS_SPEED)) } }),
    max: 10_000_000, timeout: 60_000,
  });
  if (res.status >= 400) throw new Error(`ElevenLabs: ${res.status} ${res.text.slice(0, 200)}`);
  if (t.length <= 40) { if (said.size > 50) said.clear(); said.set(key, res.bytes); }
  return res.bytes;
}
