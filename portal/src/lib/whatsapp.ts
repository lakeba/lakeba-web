import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { ELEVENLABS_API_BASE, ELEVENLABS_API_KEY, ELEVENLABS_MODEL, WHATSAPP_API_BASE, WHATSAPP_APP_SECRET, WHATSAPP_NUMBER, WHATSAPP_PHONE_ID, WHATSAPP_TOKEN } from 'astro:env/server';
import type { serviceClient } from './admin';
import { outbound } from './outbound';
import { voiceId } from './lex';
import { askCrm, aiBudget } from './crm-ai';
import { applyProposal, interpret, transcribeNote } from './crm-voice';

// The CRM's WhatsApp assistant (docs/crm.md, phase 4), on Meta's WhatsApp Business Cloud API with one Lakeba
// number. A salesperson links their own WhatsApp number once (they send the CRM a code), then texts or sends
// voice notes: "Just left Harbour, budget approved, follow up Wednesday" updates the deal; "What's my day
// tomorrow?" is answered from the CRM. Replies come back as text, and as a voice note when they spoke. Only
// people's own deals change; nothing goes to a buyer or Xero from WhatsApp. Replies are within the 24 hours
// after their message, so no paid templates are needed.

type Svc = ReturnType<typeof serviceClient>;
export const whatsappReady = () => Boolean(WHATSAPP_TOKEN && WHATSAPP_PHONE_ID);
export const whatsappNumber = () => (WHATSAPP_NUMBER ?? '').replace(/[^0-9]/g, '');

/** Meta signs each webhook with the app secret (X-Hub-Signature-256: sha256=<hex HMAC of the body>). */
export function signedByMeta(header: string | null, body: string) {
  if (!WHATSAPP_APP_SECRET || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', WHATSAPP_APP_SECRET).update(body).digest('hex'));
  const got = Buffer.from(header.slice(7));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const api = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => outbound(method, `${WHATSAPP_API_BASE}/${path}`, {
  headers: { authorization: `Bearer ${WHATSAPP_TOKEN ?? ''}`, ...(body !== undefined && !(body instanceof Buffer) ? { 'content-type': 'application/json' } : {}), ...extra },
  body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body), timeout: 30_000,
});

async function logOut(svc: Svc, to: string, kind: string, text: string, id: string | null, who?: { user_id: string | null; entity_id: string | null }) {
  await svc.from('crm_whatsapp').insert({ message_id: id ?? `out:${Date.now()}:${randomInt(1e9)}`, phone: to, direction: 'out', kind, text: text.slice(0, 4000), user_id: who?.user_id ?? null, entity_id: who?.entity_id ?? null });
}

export async function sendText(svc: Svc, to: string, text: string, who?: { user_id: string | null; entity_id: string | null }) {
  const res = await api('POST', `${WHATSAPP_PHONE_ID}/messages`, { messaging_product: 'whatsapp', to, type: 'text', text: { body: text.slice(0, 4000), preview_url: false } });
  if (res.status >= 300) throw new Error(`WhatsApp ${res.status}: ${res.text.slice(0, 200)}`);
  await logOut(svc, to, 'text', text, (JSON.parse(res.text) as { messages?: { id: string }[] }).messages?.[0]?.id ?? null, who);
}

/** A spoken reply (ElevenLabs), sent as a WhatsApp voice message. */
async function sendVoice(svc: Svc, to: string, text: string, who: { user_id: string | null; entity_id: string | null }) {
  if (!ELEVENLABS_API_KEY) return;
  const tts = await outbound('POST', `${ELEVENLABS_API_BASE}/v1/text-to-speech/${await voiceId()}?output_format=mp3_44100_64`, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' }, body: JSON.stringify({ text: text.slice(0, 600), model_id: ELEVENLABS_MODEL }), timeout: 60_000,
  });
  if (tts.status >= 300) return;
  const boundary = `----lakeba${randomInt(1e9)}`;
  const form = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp\r\n--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\naudio/mpeg\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="reply.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`),
    tts.bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const up = await api('POST', `${WHATSAPP_PHONE_ID}/media`, form, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  if (up.status >= 300) return;
  const mediaId = (JSON.parse(up.text) as { id: string }).id;
  const res = await api('POST', `${WHATSAPP_PHONE_ID}/messages`, { messaging_product: 'whatsapp', to, type: 'audio', audio: { id: mediaId } });
  if (res.status < 300) await logOut(svc, to, 'audio', text, (JSON.parse(res.text) as { messages?: { id: string }[] }).messages?.[0]?.id ?? null, who);
}

/** A voice message's audio (WhatsApp keeps media briefly; the portal keeps only the words). */
async function mediaOf(id: string) {
  const meta = await api('GET', id);
  if (meta.status >= 300) throw new Error('Couldn’t fetch the voice message.');
  const m = JSON.parse(meta.text) as { url: string; mime_type: string };
  const file = await outbound('GET', m.url, { headers: { authorization: `Bearer ${WHATSAPP_TOKEN ?? ''}` }, max: 20_000_000, timeout: 60_000 });
  if (file.status >= 300) throw new Error('Couldn’t download the voice message.');
  return { bytes: file.bytes, mime: m.mime_type.split(';')[0] };
}

/** A six-digit code the salesperson sends to the CRM's number to link their WhatsApp. */
export async function linkCode(svc: Svc, userId: string, entityId: string) {
  const code = String(randomInt(100000, 1000000));
  await svc.from('crm_phones').upsert({ user_id: userId, entity_id: entityId, link_code: code, code_expires_at: new Date(Date.now() + 30 * 60_000).toISOString() }, { onConflict: 'user_id,entity_id' }).throwOnError();
  return code;
}

type Incoming = { from: string; id: string; type: string; text?: { body: string }; audio?: { id: string }; voice?: { id: string }; timestamp?: string };

/** One message from WhatsApp: link a number, answer a question or update the CRM, then reply. */
export async function handleMessage(svc: Svc, m: Incoming, origin: string) {
  const { error: dup } = await svc.from('crm_whatsapp').insert({ message_id: m.id, phone: m.from, direction: 'in', kind: m.type, text: m.text?.body?.slice(0, 4000) ?? '' });
  if (dup) return; // Meta sends some messages twice.
  const body = (m.text?.body ?? '').trim();
  // Linking: "LINK 123456" (or just the code).
  const code = /^(?:link\s*)?(\d{6})$/i.exec(body)?.[1];
  if (code) {
    const { data: p } = await svc.from('crm_phones').select('id, user_id, entity_id, code_expires_at').eq('link_code', code).maybeSingle();
    if (!p || Date.parse(p.code_expires_at ?? '') < Date.now()) return sendText(svc, m.from, 'That code isn’t right or has expired. Get a new one in the CRM (My phone).');
    await svc.from('crm_phones').update({ phone: null }).eq('phone', m.from);
    await svc.from('crm_phones').update({ phone: m.from, linked_at: new Date().toISOString(), link_code: null, code_expires_at: null }).eq('id', p.id);
    await svc.from('audit_log').insert({ user_id: p.user_id, action: 'crm_whatsapp_linked', detail: { entity_id: p.entity_id } });
    return sendText(svc, m.from, 'Linked. Tell me what happened after a meeting or call (text or a voice note) and I’ll update your deals; or ask me things like “what’s my day tomorrow?”.');
  }
  const { data: phone } = await svc.from('crm_phones').select('user_id, entity_id').eq('phone', m.from).not('linked_at', 'is', null).maybeSingle();
  if (!phone) return sendText(svc, m.from, 'This number isn’t linked to a CRM yet. Open the CRM, go to My phone, and send the code shown there.');
  const who = { user_id: phone.user_id, entity_id: phone.entity_id };
  await svc.from('crm_whatsapp').update(who).eq('message_id', m.id);
  // Still allowed: the person has the CRM's "do" for that company (roles can be taken away).
  const { count } = await svc.from('user_roles').select('id', { count: 'exact', head: true }).eq('user_id', phone.user_id).or(`entity_id.is.null,entity_id.eq.${phone.entity_id}`);
  if (!count) return sendText(svc, m.from, 'Your CRM access has ended, so I can’t help here any more.', who);
  if (!(await aiBudget(svc, phone.entity_id)).ok) return sendText(svc, m.from, 'Lakeba AI is paused for your CRM this month. Please update the deal in the CRM.', who);
  const media = m.audio ?? m.voice;
  const spoken = Boolean(media);
  let text = body;
  if (media) {
    const a = await mediaOf(media.id);
    text = await transcribeNote(a.bytes, a.mime);
    await svc.from('crm_whatsapp').update({ text: text.slice(0, 4000) }).eq('message_id', m.id);
  }
  if (!text) return sendText(svc, m.from, 'I couldn’t hear anything in that. Try again?', who);
  const p = await interpret(svc, { entityId: phone.entity_id, userId: phone.user_id, text, feature: 'whatsapp' });
  let reply: string;
  if (p.intent === 'question' || (p.intent === 'other' && /\?\s*$/.test(text))) {
    const a = await askCrm(svc, { entityId: phone.entity_id, userId: phone.user_id, question: p.question || text, via: 'whatsapp' });
    reply = a.answer;
    await svc.from('crm_whatsapp').update({ result: { asked: true } }).eq('message_id', m.id);
  } else if (!p.deal_id && !p.contact && !p.task) {
    reply = p.reply || 'Which deal is this about? Say the company’s name.';
  } else {
    // From WhatsApp: notes, next step, task, a new contact and an open stage. Value changes wait for the CRM.
    const r = await applyProposal(svc, { entityId: phone.entity_id, userId: phone.user_id, p, parts: new Set(['note', 'next', 'stage', 'task', 'contact']), source: 'whatsapp', raw: text });
    reply = `${p.deal_label ? `Updated ${p.deal_label}:` : 'Done:'}\n• ${r.done.join('\n• ') || 'nothing to change'}${p.amount ? `\nThe new value (${p.amount}) is waiting for you to confirm in the CRM.` : ''}`;
    await svc.from('crm_whatsapp').update({ result: { deal_id: p.deal_id, done: r.done } }).eq('message_id', m.id);
  }
  await sendText(svc, m.from, reply, who);
  if (spoken) await sendVoice(svc, m.from, reply.replace(/•/g, '').replace(/\n+/g, '. '), who).catch(() => null);
  void origin;
}
