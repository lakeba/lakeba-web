import type { Access } from './access';
import type { serviceClient } from './admin';
import { mayMeeting } from './boardroom';
import type { Attendee, Meeting } from './legal-board';
import { PROVIDERS, transcribeRecording, type Provider, type Segment } from './transcription';

// The Observer (Admin → Legal → a meeting → Record): a tablet at the board
// table records a directors' meeting once the chair confirms everyone present
// agreed. Audio arrives in pieces every few seconds and is kept in the legal
// bucket; each start after a pause is a new "take". Live text from the tablet
// is kept as it comes; after the meeting the whole recording gets a full pass
// with speakers, which becomes the meeting's transcript (with the names the
// secretary gives the speakers). The audio is deleted once the minutes are signed.

type Svc = ReturnType<typeof serviceClient>;
export type Take = { take: number; started_at: string; ended_at: string | null; chunks: number; path: string | null; bytes: number; mime: string };
export type Consent = { at: string; by: string; by_name: string; chair: string; wording: string; present: string[]; agreed: string[] };
export type RecordingMeeting = Meeting & { recording_status: string; recording_consent: Consent | null; recording_takes: Take[]; recording_error: string | null; audio_deleted_at: string | null; transcript_source: string | null; speaker_names: Record<string, Record<string, string>> };
export const RECORDING_COLUMNS = 'recording_status, recording_consent, recording_takes, recording_error, audio_deleted_at, transcript_source, speaker_names';
export const MAX_CHUNK = 5 * 1024 * 1024;
export const SOURCE_LABEL = (s: string) => `${s.startsWith('live') ? 'Live' : 'Full pass'}, ${PROVIDERS[s.split(':')[1] as Provider]?.name ?? s}`;

/** What the chair reads out and confirms before recording. Wording approved by Lakeba's legal team. */
export const consentWording = (company: string) =>
  `This meeting of the directors of ${company} will be recorded and transcribed by the portal's Observer, to prepare the minutes. The recording is kept privately in the company's records and deleted once the minutes are signed; the transcript stays with the meeting's records. Everyone present must agree before recording starts, and anyone may ask for the recording to be paused at any time.`;

const audioFolder = (m: Pick<Meeting, 'entity_id' | 'id'>) => `${m.entity_id}/meetings/${m.id}/audio`;
const pad = (n: number) => String(n).padStart(6, '0');

/**
 * Words the speech to text listens for at this company's meetings, so names come out right
 * ("DoxAI", not "Doc AI"): Lex, the group's companies, the people at the meeting and the
 * company's own words (Admin → Companies → Board assistant).
 */
export async function meetingTerms(svc: Svc, entityId: string, attendees: Attendee[]) {
  const { data } = await svc.from('entities').select('id, display_name, speech_terms').order('sort');
  const companies = data ?? [];
  const own = companies.find((c) => c.id === entityId);
  // "Lakeba Group" also as "Lakeba": the first word of a company's name is often said on its own.
  const names = companies.flatMap((c) => [c.display_name, ...(c.display_name.includes(' ') && c.display_name.split(' ')[0].length > 3 ? [c.display_name.split(' ')[0]] : [])]);
  return ['Lex', ...(own?.speech_terms ?? []), ...attendees.map((a) => a.name), ...names];
}

/** Keeps a piece of audio as it arrives from the tablet. */
export async function storeChunk(svc: Svc, m: RecordingMeeting, take: number, seq: number, bytes: Uint8Array, mime: string) {
  if (bytes.length > MAX_CHUNK) throw new Error('That piece of audio is too large.');
  const path = `${audioFolder(m)}/take-${take}/${pad(seq)}.part`;
  const { error } = await svc.storage.from('legal').upload(path, bytes, { contentType: mime || 'audio/webm', upsert: true });
  if (error) throw new Error(`The audio could not be stored (${error.message}).`);
}

/** Joins a take's pieces into one file (pieces from one recorder join into a playable file) and removes the pieces. */
async function assembleTake(svc: Svc, m: RecordingMeeting, t: Take): Promise<Take> {
  if (t.path) return t;
  const folder = `${audioFolder(m)}/take-${t.take}`;
  const { data: list } = await svc.storage.from('legal').list(folder, { limit: 10_000, sortBy: { column: 'name', order: 'asc' } });
  const names = (list ?? []).map((f) => f.name).filter((n) => n.endsWith('.part')).sort();
  if (!names.length) return { ...t, chunks: 0, bytes: 0 };
  const parts: Buffer[] = [];
  for (const n of names) {
    const { data } = await svc.storage.from('legal').download(`${folder}/${n}`);
    if (data) parts.push(Buffer.from(await data.arrayBuffer()));
  }
  const file = Buffer.concat(parts);
  const ext = t.mime.includes('mp4') ? 'm4a' : t.mime.includes('ogg') ? 'ogg' : 'webm';
  const path = `${audioFolder(m)}/take-${t.take}.${ext}`;
  const { error } = await svc.storage.from('legal').upload(path, file, { contentType: t.mime || 'audio/webm', upsert: true });
  if (error) throw new Error(`The recording could not be stored (${error.message}).`);
  await svc.storage.from('legal').remove(names.map((n) => `${folder}/${n}`));
  return { ...t, path, bytes: file.length, chunks: names.length };
}

/** Milliseconds from the first take's start to this one's, so all takes share one clock. */
const offsetOf = (takes: Take[], t: Take) => Math.max(0, Date.parse(t.started_at) - Date.parse(takes[0].started_at));

export async function saveSegments(svc: Svc, meetingId: string, source: string, take: number, segments: (Segment & { seq: number })[]) {
  if (!segments.length) return;
  await svc.from('board_meeting_segments').upsert(segments.map((s) => ({ meeting_id: meetingId, source, take, seq: s.seq, start_ms: Math.max(0, Math.round(s.start_ms)), end_ms: Math.max(0, Math.round(s.end_ms)), speaker: s.speaker.slice(0, 40), text: s.text.slice(0, 20_000) })), { onConflict: 'meeting_id,source,take,seq' }).throwOnError();
}

/**
 * After the meeting: joins each take's audio, sends it for the full pass with
 * speakers, keeps the result and makes it the meeting's transcript. Runs in
 * the background; the meeting's state says how it went.
 */
export async function transcribeMeeting(svc: Svc, meetingId: string, provider: Provider) {
  const { data } = await svc.from('board_meetings').select(`id, entity_id, attendees, transcript, speaker_names, ${RECORDING_COLUMNS}`).eq('id', meetingId).single();
  const m = data as unknown as RecordingMeeting;
  try {
    if (m.audio_deleted_at) throw new Error('The recording was deleted when the minutes were signed.');
    const takes: Take[] = [];
    for (const t of m.recording_takes) takes.push(await assembleTake(svc, m, t));
    await svc.from('board_meetings').update({ recording_takes: takes }).eq('id', m.id);
    const speakers = m.attendees.filter((a) => a.present).length;
    const source = `batch:${provider}`;
    const terms = await meetingTerms(svc, m.entity_id, m.attendees);
    await svc.from('board_meeting_segments').delete().eq('meeting_id', m.id).eq('source', source);
    for (const t of takes.filter((x) => x.path && x.bytes)) {
      const { data: blob } = await svc.storage.from('legal').download(t.path!);
      if (!blob) throw new Error(`Take ${t.take}'s recording is missing.`);
      const segments = await transcribeRecording(provider, Buffer.from(await blob.arrayBuffer()), t.mime, speakers, terms);
      const offset = offsetOf(takes, t);
      await saveSegments(svc, m.id, source, t.take, segments.map((s, i) => ({ ...s, start_ms: s.start_ms + offset, end_ms: s.end_ms + offset, seq: i })));
    }
    // The first full pass becomes the transcript; another provider's pass is kept for comparing.
    const use = !m.transcript_source || m.transcript_source.startsWith('live') ? source : m.transcript_source;
    await useTranscript(svc, m.id, use);
    await svc.from('board_meetings').update({ recording_status: 'done', recording_error: null, updated_at: new Date().toISOString() }).eq('id', m.id);
  } catch (e) {
    await svc.from('board_meetings').update({ recording_status: 'failed', recording_error: (e as Error).message.slice(0, 500) }).eq('id', m.id);
    throw e;
  }
}

const clock = (ms: number) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** A transcript as text: "[00:12:30] Jane Smith: …", one line per turn, consecutive turns of one speaker joined. */
export function transcriptOf(segments: Pick<Segment, 'start_ms' | 'speaker' | 'text'>[], names: Record<string, string> = {}) {
  const lines: { at: number; who: string; text: string }[] = [];
  for (const s of segments) {
    const who = names[s.speaker] || s.speaker || 'Unknown';
    const last = lines.at(-1);
    if (last && last.who === who && last.text.length < 2000) last.text += ` ${s.text}`;
    else lines.push({ at: s.start_ms, who, text: s.text });
  }
  return lines.map((l) => `[${clock(l.at)}] ${l.who}: ${l.text}`).join('\n');
}

export async function segmentsOf(svc: Svc, meetingId: string, source: string) {
  const { data } = await svc.from('board_meeting_segments').select('take, seq, start_ms, end_ms, speaker, text').eq('meeting_id', meetingId).eq('source', source).order('take').order('seq');
  return (data ?? []) as (Segment & { take: number; seq: number })[];
}

/** Makes one transcript (a provider's full pass, or the live text) the meeting's transcript, with the speakers' names. */
export async function useTranscript(svc: Svc, meetingId: string, source: string) {
  const { data: m } = await svc.from('board_meetings').select('speaker_names').eq('id', meetingId).single();
  const names = ((m?.speaker_names ?? {}) as Record<string, Record<string, string>>)[source] ?? {};
  const text = transcriptOf(await segmentsOf(svc, meetingId, source), names);
  await svc.from('board_meetings').update({ transcript: text.slice(0, 200_000), transcript_source: source, updated_at: new Date().toISOString() }).eq('id', meetingId).throwOnError();
}

/** The speakers a transcript found, with how much each said and a first line, for naming them. */
export function speakersOf(segments: Segment[]) {
  const map = new Map<string, { label: string; words: number; sample: string }>();
  for (const s of segments) {
    const k = s.speaker || 'Unknown';
    const e = map.get(k) ?? { label: k, words: 0, sample: '' };
    e.words += s.text.split(/\s+/).length;
    if (!e.sample && s.text.length > 30) e.sample = s.text.slice(0, 160);
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.words - a.words);
}

/** The people at the meeting, for naming speakers. */
export const peopleAt = (attendees: Attendee[]) => attendees.filter((a) => a.present).map((a) => a.name);

/** Removes all of a meeting's audio files (joined takes and loose pieces). */
export async function removeAudio(svc: Svc, m: Pick<Meeting, 'entity_id' | 'id'>) {
  const folder = audioFolder(m);
  const { data: top } = await svc.storage.from('legal').list(folder, { limit: 1000 });
  const paths: string[] = [];
  for (const f of top ?? []) {
    if (f.id) paths.push(`${folder}/${f.name}`);
    else { const { data: inner } = await svc.storage.from('legal').list(`${folder}/${f.name}`, { limit: 10_000 }); paths.push(...(inner ?? []).map((x) => `${folder}/${f.name}/${x.name}`)); }
  }
  for (let i = 0; i < paths.length; i += 500) await svc.storage.from('legal').remove(paths.slice(i, i + 500));
  return paths.length;
}

/**
 * Daily: deletes the audio of meetings whose minutes are signed (the
 * transcript stays). Pieces of takes never joined are removed too.
 */
export async function deleteSignedAudio(svc: Svc) {
  const { data: meetings } = await svc.from('board_meetings').select('id, entity_id, recording_takes').is('audio_deleted_at', null).neq('recording_takes', '[]');
  let n = 0;
  for (const m of meetings ?? []) {
    const { data: minutes } = await svc.from('board_papers').select('status').eq('meeting_id', m.id).eq('kind', 'minutes').eq('status', 'signed').limit(1);
    if (!minutes?.length) continue;
    await removeAudio(svc, m);
    await svc.from('board_meetings').update({ audio_deleted_at: new Date().toISOString(), recording_takes: (m.recording_takes as Take[]).map((t) => ({ ...t, path: null })) }).eq('id', m.id);
    n++;
  }
  return n;
}

/** The meeting, for the Observer's requests: only for those who do legal work for its company. */
export async function observerMeeting(svc: Svc, access: Access, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data } = await svc.from('board_meetings').select(`id, entity_id, title, held_at, location, attendees, chair_officer_id, agenda, notes, transcript, transcript_path, ${RECORDING_COLUMNS}, entities(board_assistant)`).eq('id', id).maybeSingle();
  // The company's Legal or Boardroom people, and only where the board assistant is switched on.
  if (!data || !mayMeeting(access, data.entity_id as string, 'do') || !(data.entities as unknown as { board_assistant: boolean } | null)?.board_assistant) return null;
  return data as unknown as RecordingMeeting;
}
