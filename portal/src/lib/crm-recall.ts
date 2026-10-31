import type { serviceClient } from './admin';
import { api, botActive, failure, platformOf, recallReady, STATUS_OF } from './recall';
import { fileMeetingNotes } from './crm-ai';
import { logActivity } from './crm';
import { notifyMembers } from './notify';
import { outbound } from './outbound';

// Sales meetings recorded by Recall's meeting bot (CRM → a deal → Record a meeting). A notetaker named after the
// company joins the call, says in the chat that it records with everyone's consent, and Recall transcribes it
// with the meeting's own captions. When the call ends, Lakeba AI writes the notes, next steps and a suggested
// stage onto the deal, and Recall's copy of the media is deleted.

type Svc = ReturnType<typeof serviceClient>;

export async function sendNotetaker(svc: Svc, o: { entityId: string; dealId: string; link: string; userId: string; company: string }) {
  if (!recallReady()) throw new Error('Recording meetings isn’t set up on the server yet (Recall).');
  if (!platformOf(o.link)) throw new Error('Paste the meeting’s link from Teams, Zoom, Google Meet or Webex (https://…).');
  const { data: active } = await svc.from('crm_recordings').select('id, status').eq('deal_id', o.dealId).in('status', ['sent', 'joining', 'lobby', 'in_call']).limit(1);
  if (active?.length && botActive({ status: active[0].status } as never)) throw new Error('A notetaker is already on its way to a meeting for this deal.');
  const res = await api('POST', 'bot/', {
    meeting_url: o.link.trim(),
    bot_name: `${o.company} notes`.slice(0, 100),
    recording_config: { transcript: { provider: { meeting_captions: {} } } },
    automatic_leave: { waiting_room_timeout: 900, noone_joined_timeout: 900, everyone_left_timeout: { timeout: 30 } },
    chat: { on_bot_join: { send_to: 'everyone', message: `Hello, I take notes for ${o.company} so nobody has to type during the call. The meeting is recorded and transcribed only with everyone’s agreement: say so now if you’d rather not, and I’ll leave.`.slice(0, 480) } },
    metadata: { crm_deal_id: o.dealId },
  });
  if (res.status >= 300) throw failure(res.status, res.text);
  const bot = JSON.parse(res.text) as { id: string };
  await svc.from('crm_recordings').insert({ entity_id: o.entityId, deal_id: o.dealId, bot_id: bot.id, meeting_url: o.link.trim().slice(0, 1000), sent_by: o.userId });
  await logActivity(svc, { entity_id: o.entityId, kind: 'system', deal_id: o.dealId, subject: 'Notetaker sent to the meeting', created_by: o.userId });
}

/** Recall's webhook for a CRM notetaker (returns false when the bot isn't one of the CRM's). */
export async function crmRecallEvent(svc: Svc, origin: string, event: { event?: string; data?: { bot?: { id?: string }; data?: { sub_code?: string | null } } }) {
  const botId = event.data?.bot?.id;
  const status = STATUS_OF[event.event ?? ''];
  if (!botId || !status) return false;
  const { data: rec } = await svc.from('crm_recordings').select('id, entity_id, deal_id, sent_by, status').eq('bot_id', botId).maybeSingle();
  if (!rec) return false;
  if (rec.status === 'done') return true;
  await svc.from('crm_recordings').update({ status, ...(['failed', 'refused'].includes(status) ? { error: event.data?.data?.sub_code ?? status } : {}) }).eq('id', rec.id);
  if (status !== 'done') return true;
  try {
    // The transcript Recall made from the meeting's captions, then its copy deleted.
    const b = await api('GET', `bot/${encodeURIComponent(botId)}/`);
    const bot = JSON.parse(b.text) as { recordings?: { media_shortcuts?: { transcript?: { data?: { download_url?: string } } } }[] };
    const url = bot.recordings?.[0]?.media_shortcuts?.transcript?.data?.download_url;
    if (!url) throw new Error('Recall made no transcript (were captions on?).');
    const t = await outbound('GET', url, { timeout: 60_000 });
    const parts = JSON.parse(t.text) as { participant?: { name?: string }; words?: { text: string }[] }[];
    const transcript = parts.map((p) => `${p.participant?.name ?? 'Someone'}: ${(p.words ?? []).map((w) => w.text).join(' ')}`).join('\n');
    await svc.from('crm_recordings').update({ transcript: transcript.slice(0, 500_000) }).eq('id', rec.id);
    await fileMeetingNotes(svc, rec, transcript);
    await api('POST', `bot/${encodeURIComponent(botId)}/delete_media/`, {}).catch(() => null);
    if (rec.sent_by) await notifyMembers({ kind: 'crm', origin, link: rec.deal_id ? `/admin/crm/deals/${rec.deal_id}` : '/admin/crm', title: 'Meeting notes are ready', body: 'Lakeba AI wrote the notes and next steps from your recorded meeting.', userIds: [rec.sent_by], entityId: rec.entity_id }).catch(() => 0);
  } catch (e) {
    await svc.from('crm_recordings').update({ status: 'failed', error: (e as Error).message.slice(0, 500) }).eq('id', rec.id);
  }
  return true;
}
