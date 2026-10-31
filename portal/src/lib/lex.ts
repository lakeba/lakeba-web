import { ELEVENLABS_API_BASE, ELEVENLABS_API_KEY, ELEVENLABS_MODEL, ELEVENLABS_SPEED, ELEVENLABS_VOICE_ID } from 'astro:env/server';
import type { Access } from './access';
import type { serviceClient } from './admin';
import { boardFacts, SPOKEN_BREAK, type MeetingFacts } from './board-ask';
import { outbound } from './outbound';

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
/** Text as Lex says it: no references, markdown or symbols. */
export const clean = (t: string) => t.replace(/\[[^\]]{1,80}\]/g, '').replace(/[*_#`>|]/g, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim().slice(0, MAX_SPOKEN);

/**
 * A sentence Lex can say while it is still writing: the spoken part's complete sentences
 * (a sentence ends with . ! or ? and a space after it), until the line that ends the spoken part.
 * Returns where the spoken part has got to and whether it is finished.
 */
export function spokenSoFar(draft: string) {
  const lines = draft.split('\n');
  const at = lines.findIndex((l) => l.trim() === SPOKEN_BREAK);
  const head = (at >= 0 ? lines.slice(0, at) : lines).join('\n');
  if (at >= 0) return { upto: head.length, head, finished: true };
  let upto = 0;
  for (const m of head.matchAll(/[.!?]+["”’)]*\s+/g)) upto = m.index! + m[0].length;
  return { upto, head, finished: false };
}

// --- Meeting facts -------------------------------------------------------------
// Gathered once per meeting (when recording starts, or at the first question) and kept for
// 20 minutes, so most questions at the table are answered without a lookup.
type Svc = ReturnType<typeof serviceClient>;
const FACTS_FOR = 20 * 60_000;
const factsKept = new Map<string, { at: number; facts: Promise<MeetingFacts> }>();
const timeNow = () => new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' }).format(new Date());

export function meetingFacts(svc: Svc, access: Access, central: string, userId: string, m: { id: string; entity_id: string; title: string; held_at: string; agenda?: string | null }) {
  const key = `${m.id}:${userId}`;
  const kept = factsKept.get(key);
  if (kept && Date.now() - kept.at < FACTS_FOR) return kept.facts;
  for (const [k, v] of factsKept) if (Date.now() - v.at >= FACTS_FOR) factsKept.delete(k);
  const facts = (async (): Promise<MeetingFacts> => {
    const { data: c } = await svc.from('entities').select('code, relationship').eq('id', m.entity_id).single().throwOnError();
    const group = c!.relationship === 'group';
    const code = c!.code as string;
    const f = await boardFacts(svc, access, central, group ? undefined : [m.entity_id], [
      ['companies', {}],
      ['financials', { company: group ? 'GROUP' : code }],
      ...(group ? [['legal', {}] as [string, Record<string, unknown>]] : []),
      ['legal', { company: code }],
      ['register', { company: code }],
      ['people', { company: code }],
      ['shareholders', { company: code, days: 90 }],
    ], 15_000);
    const meeting = `This meeting: "${m.title}", ${m.held_at.slice(0, 10)}.${m.agenda?.trim() ? `\nAgenda:\n${m.agenda.trim().slice(0, 3000)}` : ''}`;
    return { text: `${meeting}\n\n---\n\n${f.text}`, state: f.state, at: timeNow() };
  })();
  facts.catch(() => factsKept.delete(key));
  factsKept.set(key, { at: Date.now(), facts });
  return facts;
}

let voice: Promise<string> | null = null;
/** The voice: as set, or the account's first Australian stock voice, or its first voice. */
export function voiceId() {
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

const VOICE_SETTINGS = () => ({ stability: 0.55, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, ELEVENLABS_SPEED)) });

// Short fixed phrases ("That is the end of the presentation") are kept, so they play at once.
const said = new Map<string, Buffer>();

/**
 * Lex's voice as it is made: raw 16-bit mono PCM at 16 or 24 kHz, handed over piece by piece,
 * so the tablet starts playing (or the face starts moving) before the sentence is finished.
 */
export async function speakStream(text: string, rate: 16000 | 24000, onData: (chunk: Buffer) => void, voiceFor?: string) {
  const t = text.trim().slice(0, MAX_SPOKEN);
  if (!t) throw new Error('Nothing to say.');
  const key = `pcm${rate}:${voiceFor ?? ''}:${t}`;
  const kept = said.get(key);
  if (kept) { onData(kept); return; }
  const res = await outbound('POST', `${ELEVENLABS_API_BASE}/v1/text-to-speech/${voiceFor ?? await voiceId()}/stream?output_format=pcm_${rate}`, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY ?? '', 'content-type': 'application/json', accept: 'audio/pcm' },
    body: JSON.stringify({ text: t, model_id: ELEVENLABS_MODEL, voice_settings: VOICE_SETTINGS() }),
    max: 10_000_000, timeout: 60_000, onData,
  });
  if (res.status >= 400) throw new Error(`ElevenLabs: ${res.status} ${res.text.slice(0, 200)}`);
  if (t.length <= 40) { if (said.size > 50) said.clear(); said.set(key, res.bytes); }
}
