import { createHmac, timingSafeEqual } from 'node:crypto';
import { RECALL_API_BASE, RECALL_API_KEY, RECALL_WEBHOOK_SECRET } from 'astro:env/server';
import type { serviceClient } from './admin';
import { consentWording, tellBoardroom, transcribeMeeting, type Take } from './observer';
import { outbound } from './outbound';
import { botPass, releaseTablet } from './tablets';
import { readyProviders } from './transcription';

// Lex in online meetings (Teams, Zoom, Google Meet, Webex), through Recall.ai's meeting bot. The company
// secretary sends Lex to the meeting's link; a bot called "Lex (Lakeba)" joins, and its camera is the
// portal's own Lex page (the Observer in bot mode), which hears the call through the browser's
// microphone and speaks into it: live text, Lex's answers, its face and the recording work as on the
// boardroom tablet. Recall keeps nothing (zero data retention): the recording is the portal's own.
// Recall tells the portal how the bot is getting on (in the lobby, in the call, ended) by webhook.

type Svc = ReturnType<typeof serviceClient>;
export const recallReady = () => Boolean(RECALL_API_KEY);
export const BOT_NAME = 'Lex (Lakeba)';

export type OnlineBot = { bot_id: string; tablet_id: string; meeting_url: string; platform: string; status: string; status_at: string; sent_by: string; sent_at: string; error?: string | null };
export const BOT_STATES: Record<string, string> = {
  sent: 'On its way', joining: 'Joining the meeting', lobby: 'In the lobby: admit “Lex (Lakeba)”', in_call: 'In the meeting',
  refused: 'Not allowed to record', ended: 'Left the meeting', done: 'Left the meeting', failed: 'Couldn’t join',
};
export const botActive = (b: OnlineBot | null | undefined) => Boolean(b && ['sent', 'joining', 'lobby', 'in_call'].includes(b.status));

/** Which service a meeting link is for, or null. */
export function platformOf(link: string) {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  const is = (d: string) => h === d || h.endsWith(`.${d}`);
  if (is('teams.microsoft.com') || is('teams.live.com') || is('teams.cloud.microsoft')) return 'Microsoft Teams';
  if (is('zoom.us') || is('zoom.com') || is('zoomgov.com')) return 'Zoom';
  if (h === 'meet.google.com') return 'Google Meet';
  if (is('webex.com')) return 'Webex';
  return null;
}

export const api = (method: string, path: string, body?: unknown) => outbound(method, `${RECALL_API_BASE}/api/v1/${path}`, {
  headers: { authorization: `Token ${RECALL_API_KEY ?? ''}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body), timeout: 30_000,
});
export const failure = (status: number, text: string) => {
  let detail = text.slice(0, 200);
  try { const j = JSON.parse(text); detail = j.detail ?? j.message ?? JSON.stringify(j).slice(0, 200); } catch { /* not JSON */ }
  return new Error(status === 507 ? 'Recall has no bot free just now: try again in a minute.' : `Recall: ${status} ${detail}`);
};

/** Lex's greeting as it joins, said aloud by the page and posted in the meeting's chat. */
export const greeting = (company: string) => `Hello everyone, I'm Lex, the board's assistant. ${consentWording(company)} To ask me something, say “Lex” and your question.`;

/**
 * Sends Lex to an online meeting: a one-meeting pass for the bot's browser, then the bot itself, with the
 * Lex page as its camera. The meeting's recording consent must already be recorded.
 */
export async function sendLex(svc: Svc, meeting: { id: string; entity_id: string; online_bot: OnlineBot | null }, link: string, userId: string, central: string, company: string) {
  if (!recallReady()) throw new Error('Lex can’t join online meetings yet: Recall isn’t set up on the server.');
  const platform = platformOf(link);
  if (!platform) throw new Error('Paste the meeting’s link from Teams, Zoom, Google Meet or Webex (https://…).');
  if (botActive(meeting.online_bot)) throw new Error('Lex is already on its way to this meeting.');
  const pass = await botPass(svc, meeting, userId);
  const res = await api('POST', 'bot/', {
    meeting_url: link.trim(),
    bot_name: BOT_NAME,
    // Its camera is the Lex page; the page hears the meeting and its sound goes into the meeting.
    output_media: { camera: { kind: 'webpage', config: { url: `${central}/tablet/join/${pass.secret}` } } },
    variant: { zoom: 'web_4_core', google_meet: 'web_4_core', microsoft_teams: 'web_4_core' },
    automatic_leave: { waiting_room_timeout: 1200, noone_joined_timeout: 1200, everyone_left_timeout: { timeout: 30 } },
    // Recall keeps no recording or transcript: the portal records the meeting itself, as on the tablet.
    recording_config: { retention: null },
    chat: { on_bot_join: { send_to: 'everyone', message: greeting(company).slice(0, 480) } },
    metadata: { meeting_id: meeting.id, tablet_id: pass.id },
  });
  if (res.status >= 300) { await releaseTablet(svc, pass.id, 'The bot couldn’t be sent.'); throw failure(res.status, res.text); }
  const bot = JSON.parse(res.text) as { id: string };
  const now = new Date().toISOString();
  const online: OnlineBot = { bot_id: bot.id, tablet_id: pass.id, meeting_url: link.trim().slice(0, 1000), platform, status: 'sent', status_at: now, sent_by: userId, sent_at: now, error: null };
  await svc.from('board_meetings').update({ online_bot: online, updated_at: now }).eq('id', meeting.id).throwOnError();
  return online;
}

/** Asks Lex to leave the call (the meeting's recording then finishes, as Recall reports the call ended). */
export async function leaveLex(svc: Svc, meeting: { id: string; online_bot: OnlineBot | null }) {
  const b = meeting.online_bot;
  if (!b || !botActive(b)) throw new Error('Lex isn’t in this meeting.');
  const res = await api('POST', `bot/${encodeURIComponent(b.bot_id)}/leave_call/`, {});
  if (res.status >= 300 && res.status !== 404) throw failure(res.status, res.text);
}

/**
 * Recall's webhooks are signed (Svix): "webhook-*" headers (or "svix-*" on older accounts), an HMAC-SHA256 of
 * "<id>.<timestamp>.<body>" with the secret after "whsec_", base64; several "v1,<sig>" may be sent.
 */
export function signedByRecall(headers: Headers, body: string) {
  if (!RECALL_WEBHOOK_SECRET?.startsWith('whsec_')) return false;
  const h = (n: string) => headers.get(`webhook-${n}`) ?? headers.get(`svix-${n}`) ?? '';
  const id = h('id'), ts = h('timestamp'), sigs = h('signature');
  if (!id || !/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = createHmac('sha256', Buffer.from(RECALL_WEBHOOK_SECRET.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest();
  return sigs.split(' ').some((s) => {
    const [v, sig] = s.split(',');
    const got = Buffer.from(sig ?? '', 'base64');
    return v === 'v1' && got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export const STATUS_OF: Record<string, string> = {
  'bot.joining_call': 'joining', 'bot.in_waiting_room': 'lobby', 'bot.in_call_not_recording': 'in_call', 'bot.recording_permission_allowed': 'in_call',
  'bot.in_call_recording': 'in_call', 'bot.recording_permission_denied': 'refused', 'bot.call_ended': 'ended', 'bot.done': 'done', 'bot.fatal': 'failed',
};

/** A status change from Recall: the meeting page shows it; when the call is over, the recording finishes and the pass ends. */
export async function recallEvent(svc: Svc, origin: string, event: { event?: string; data?: { data?: { code?: string; sub_code?: string | null; updated_at?: string }; bot?: { id?: string } } }) {
  const status = STATUS_OF[event.event ?? ''];
  const botId = event.data?.bot?.id;
  if (!status || !botId) return { ignored: true };
  const { data: m } = await svc.from('board_meetings').select('id, entity_id, online_bot, recording_status, recording_takes').eq('online_bot->>bot_id', botId).maybeSingle();
  if (!m) return { ignored: true };
  const bot = m.online_bot as OnlineBot;
  // Late or repeated events never undo an end.
  if (['ended', 'done', 'failed'].includes(bot.status) && !['done', 'failed'].includes(status)) return { ok: true };
  const sub = event.data?.data?.sub_code ?? null;
  const error = status === 'refused' ? 'The meeting’s host didn’t allow recording.' : status === 'failed' ? `Lex couldn’t join${sub ? ` (${sub.replaceAll('_', ' ')})` : ''}.` : bot.error ?? null;
  await svc.from('board_meetings').update({ online_bot: { ...bot, status, status_at: new Date().toISOString(), error } }).eq('id', m.id).throwOnError();
  if (['failed', 'refused'].includes(status) && bot.status !== status) await tellBoardroom(svc, m.id, origin, (title) => ({ title: `Lex couldn’t stay in the online meeting: ${title}`, body: error ?? 'Lex left the meeting.' }));
  if (['ended', 'done', 'failed', 'refused'].includes(status)) {
    await releaseTablet(svc, bot.tablet_id, 'Lex left the online meeting.');
    // The call is over: the recording finishes and the full transcript is made, as "Finish" does on the tablet.
    if (['recording', 'paused'].includes(m.recording_status as string)) {
      const now = new Date().toISOString();
      const takes = (m.recording_takes as Take[]).map((t) => (t.ended_at ? t : { ...t, ended_at: now }));
      await svc.from('board_meetings').update({ recording_status: 'processing', recording_takes: takes, updated_at: now }).eq('id', m.id).throwOnError();
      await svc.from('audit_log').insert({ user_id: bot.sent_by, action: 'admin_finished_meeting_recording', detail: { entity_id: m.entity_id, meeting_id: m.id, takes: takes.length, via: 'online_meeting' } });
      const provider = readyProviders()[0];
      if (provider) void transcribeMeeting(svc, m.id, provider, origin).catch((e) => console.error('observer transcription', e));
    }
  }
  return { ok: true, status };
}
