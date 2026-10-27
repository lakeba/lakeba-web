import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { serviceClient } from '../admin';
import { notifyAdmins } from '../notify';
import { validEmail } from '../people';
import { open } from '../secret-box';
import { addDraftDocument, keepRegisterPdf, subscribe, updatePerson, type Company } from './actions';

type Svc = ReturnType<typeof serviceClient>;

// Incoming webhooks (Admin → Companies → Integrations → Incoming webhooks).
// Another tool posts to /api/hooks/in/<token>; the sender is checked (its
// signature, or a shared secret), the message is kept and answered at once,
// and the worker handles it. Changes to who is an investor, data room access
// and registers wait for an Admin ("Needs review"); the rest is done at once.

export const KINDS: Record<string, { label: string; review: boolean; help: string }> = {
  'newsletter.subscribe': { label: 'Newsletter sign-ups', review: false, help: 'A website or form tool sends sign-ups: they’re added to the newsletter list straight away.' },
  'person.update': { label: 'Investors’ contact details', review: false, help: 'A CRM sends name or phone changes for existing investors (matched by email). Only investors of this company alone are changed.' },
  'person.add': { label: 'New investors', review: true, help: 'A CRM or form proposes a new investor for a holder (by register reference). An Admin approves each one.' },
  'data_room.request': { label: 'Data room requests', review: true, help: 'A website form asks for data room access. An Admin approves each one; the guest then gets their link.' },
  'register.pdf': { label: 'Register of members (PDF)', review: true, help: 'The company secretary’s system sends the register PDF. An Admin checks and applies it, as with an upload.' },
  'document.signed': { label: 'Signed documents (DocuSign)', review: false, help: 'A completed DocuSign envelope is filed in Documents as a draft, for an Admin to publish.' },
};
export const AUTHS: Record<string, string> = {
  lakeba: 'Lakeba signature (Lakeba-Signature: t=…,v1=…, like our outgoing webhooks)',
  hmac_hex: 'HMAC-SHA256 hex (X-Signature: sha256=…)',
  typeform: 'Typeform (Typeform-Signature)',
  docusign: 'DocuSign Connect HMAC (X-DocuSign-Signature-1)',
  bearer: 'A shared secret (Authorization: Bearer …)',
};
/** Default field paths, changeable per endpoint. */
export const DEFAULT_MAP: Record<string, Record<string, string>> = {
  'newsletter.subscribe': { email: 'email', name: 'name' },
  'person.update': { email: 'email', first_name: 'first_name', last_name: 'last_name', phone: 'phone' },
  'person.add': { email: 'email', first_name: 'first_name', last_name: 'last_name', holder_ref: 'holder_ref' },
  'data_room.request': { email: 'email', name: 'name', organisation: 'organisation' },
};

export const newInboundToken = () => randomBytes(18).toString('base64url');
export const newInboundSecret = () => `whin_${randomBytes(24).toString('base64url')}`;

const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Is this really from the sender? */
export function verified(auth: string, secret: string, headers: Headers, raw: Buffer) {
  const h = (n: string) => headers.get(n) ?? '';
  const mac = (enc: 'hex' | 'base64', data: Buffer | string = raw) => createHmac('sha256', secret).update(data).digest(enc);
  if (auth === 'bearer') return eq(h('authorization').replace(/^Bearer\s+/i, ''), secret);
  if (auth === 'hmac_hex') return eq(h('x-signature').replace(/^sha256=/, ''), mac('hex'));
  if (auth === 'typeform') return eq(h('typeform-signature').replace(/^sha256=/, ''), mac('base64'));
  if (auth === 'docusign') return eq(h('x-docusign-signature-1'), mac('base64'));
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(h('lakeba-signature'));
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  return eq(m[2], createHmac('sha256', secret).update(`${m[1]}.${raw.toString('utf8')}`).digest('hex'));
}

/** "data.contact.email" → the value in the JSON. */
export const pick = (obj: unknown, path: string) => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

type Endpoint = { id: string; entity_id: string; name: string; kind: string; auth: string; secret_enc: string; settings: Record<string, unknown>; active: boolean };
type Message = { id: string; endpoint_id: string | null; entity_id: string; kind: string; body: string | null; file_path: string | null; attempts: number; result: Record<string, unknown> };

/** Receives one message: checks it, keeps it, says whether it was accepted. */
export async function receive(svc: Svc, token: string, headers: Headers, raw: Buffer, contentType: string) {
  const { data: ep } = await svc.from('inbound_endpoints').select('id, entity_id, name, kind, auth, secret_enc, settings, active, entities(code, display_name, relationship, integrations_enabled)').eq('token', token).maybeSingle();
  const company = ep?.entities as unknown as (Company & { integrations_enabled: boolean }) | undefined;
  if (!ep || !ep.active || !company?.integrations_enabled) return { status: 404, body: { error: 'Unknown or switched-off address.' } };
  if (!verified(ep.auth, open(ep.secret_enc), headers, raw)) return { status: 401, body: { error: 'The signature or secret doesn’t match.' } };
  const dedupe = (headers.get('idempotency-key') ?? headers.get('lakeba-event-id') ?? headers.get('x-request-id') ?? '').slice(0, 200) || null;
  let body: string | null = null, filePath: string | null = null;
  if (ep.kind === 'register.pdf') {
    let bytes = new Uint8Array(raw);
    if (contentType.startsWith('application/json')) { try { bytes = new Uint8Array(Buffer.from(String(JSON.parse(raw.toString('utf8')).file_base64 ?? ''), 'base64')); } catch { bytes = new Uint8Array(); } }
    const kept = await keepRegisterPdf(svc, { ...company, id: ep.entity_id }, bytes);
    if ('error' in kept) return { status: 422, body: { error: kept.error } };
    filePath = kept.path!;
  } else {
    if (raw.length > 30 * 1024 * 1024) return { status: 413, body: { error: 'Too large.' } };
    try { JSON.parse(raw.toString('utf8')); } catch { return { status: 400, body: { error: 'Send JSON.' } }; }
    body = raw.toString('utf8');
  }
  const keepHeaders = Object.fromEntries([...headers].filter(([k]) => /^(content-type|user-agent|x-request-id|idempotency-key|lakeba-event|lakeba-event-id)$/i.test(k)));
  const { data: msg, error } = await svc.from('inbound_messages').insert({ endpoint_id: ep.id, entity_id: ep.entity_id, kind: ep.kind, dedupe, headers: keepHeaders, body, file_path: filePath }).select('id').single();
  if (error?.code === '23505') return { status: 200, body: { received: true, duplicate: true } };
  if (error || !msg) return { status: 500, body: { error: 'Couldn’t keep it; please send it again.' } };
  await svc.from('inbound_endpoints').update({ last_received_at: new Date().toISOString() }).eq('id', ep.id);
  await svc.from('audit_log').insert({ action: 'inbound_received', detail: { company: company.code, message_id: msg.id, endpoint: ep.name, kind: ep.kind } });
  return { status: 202, body: { received: true, id: msg.id } };
}

const finish = (svc: Svc, id: string, status: string, summary: string, result: Record<string, unknown> = {}, error: string | null = null) =>
  svc.from('inbound_messages').update({ status, summary, result, error, processed_at: new Date().toISOString() }).eq('id', id);

/** What to do with one message (done now, or waiting for review). */
async function handle(svc: Svc, m: Message, ep: Endpoint | null, company: Company, origin: string) {
  const json = m.body ? JSON.parse(m.body) as Record<string, unknown> : {};
  const map = { ...(DEFAULT_MAP[m.kind] ?? {}), ...((ep?.settings.map as Record<string, string>) ?? {}) };
  const field = (k: string) => text(pick(json, map[k] ?? k));
  const audit = (action: string, detail: Record<string, unknown>) => svc.from('audit_log').insert({ action, detail: { ...detail, company: company.code, via: 'webhook', message_id: m.id } });
  switch (m.kind) {
    case 'newsletter.subscribe': {
      const email = field('email').toLowerCase();
      if (!validEmail(email)) return finish(svc, m.id, 'failed', 'No valid email in it.', {}, `The email (${map.email}) is missing or not an email.`);
      const r = await subscribe(svc, company, { email, name: field('name'), source: 'integration' });
      if ('error' in r) return finish(svc, m.id, 'failed', `Couldn’t subscribe ${email}.`, {}, r.error);
      if (r.was !== 'subscribed') await audit('newsletter_subscribed', { subscriber_id: r.id, email });
      return finish(svc, m.id, 'done', r.was === 'subscribed' ? `${email} was already subscribed.` : `${email} subscribed to the newsletter.`, { subscriber_id: r.id });
    }
    case 'person.update': {
      const email = field('email').toLowerCase();
      const { data: p } = validEmail(email) ? await svc.from('profiles').select('id').eq('email', email).maybeSingle() : { data: null };
      if (!p) return finish(svc, m.id, 'ignored', `${email || 'No email'}: not an investor in the portal.`);
      const next = Object.fromEntries((['first_name', 'last_name', 'phone'] as const).map((k) => [k, field(k)]).filter(([, v]) => v));
      const r = await updatePerson(svc, [company.id], p.id, next);
      if ('error' in r) return finish(svc, m.id, r.error === 'shared' ? 'failed' : 'ignored', r.error === 'shared' ? `${email} is also an investor in another company: change them in the portal.` : r.error === 'not_found' ? `${email} isn’t an investor of ${company.display_name}.` : 'Nothing to change.');
      await audit('webhook_updated_person', { user_id: p.id, from: r.before, to: r.after });
      return finish(svc, m.id, 'done', `${email}: ${Object.keys(r.after).join(', ').replace(/_/g, ' ')} updated.`, { user_id: p.id });
    }
    case 'person.add': {
      const email = field('email').toLowerCase(); const ref = field('holder_ref');
      const { data: h } = ref ? await svc.from('holders').select('id, name').eq('registry_ref', ref).maybeSingle() : { data: null };
      const inCompany = h ? (await svc.rpc('holder_in_entity', { target_holder: h.id, target_entity: company.id })).data : false;
      if (!validEmail(email)) return finish(svc, m.id, 'failed', 'No valid email in it.');
      if (!h || !inCompany) return finish(svc, m.id, 'failed', `${email}: holder “${ref || '—'}” isn’t a holder of ${company.display_name}.`);
      const invite = ep?.settings.invite === true;
      return finish(svc, m.id, 'needs_review', `Add ${[field('first_name'), field('last_name')].filter(Boolean).join(' ') || email} (${email}) for ${h.name}${invite ? ', and invite them' : ', without inviting'}.`, { email, first_name: field('first_name'), last_name: field('last_name'), holder_id: h.id, invite });
    }
    case 'data_room.request': {
      const email = field('email').toLowerCase();
      const roomId = String(ep?.settings.room_id ?? '');
      const { data: room } = roomId ? await svc.from('data_rooms').select('id, name, closed_at').eq('id', roomId).eq('entity_id', company.id).maybeSingle() : { data: null };
      if (!validEmail(email)) return finish(svc, m.id, 'failed', 'No valid email in it.');
      if (!room || room.closed_at) return finish(svc, m.id, 'failed', `${email} asked for a data room that is closed or not chosen.`);
      return finish(svc, m.id, 'needs_review', `${field('name') || email}${field('organisation') ? ` (${field('organisation')})` : ''} asks for access to “${room.name}”.`, { email, name: field('name') || email, organisation: field('organisation'), room_id: room.id });
    }
    case 'register.pdf':
      return finish(svc, m.id, 'needs_review', 'A register of members arrived: check and apply it.', { file_name: 'register.pdf' });
    case 'document.signed': {
      // DocuSign Connect (JSON, with documents included), or { title, file_base64 }.
      const env = (pick(json, 'data.envelopeSummary') ?? {}) as Record<string, unknown>;
      const docs = (env.envelopeDocuments as { name?: string; PDFBytes?: string; documentIdGuid?: string; type?: string }[] | undefined)?.filter((d) => d.PDFBytes && d.type !== 'summary') ?? [];
      const files = docs.length ? docs.map((d) => ({ name: d.name ?? 'Signed document', b64: d.PDFBytes! })) : text(json.file_base64) ? [{ name: text(json.title) || 'Signed document', b64: text(json.file_base64) }] : [];
      if (json.event && json.event !== 'envelope-completed') return finish(svc, m.id, 'ignored', `DocuSign event “${String(json.event)}”: only completed envelopes are filed.`);
      if (!files.length) return finish(svc, m.id, 'failed', 'No document in it (in DocuSign Connect, include the documents).');
      const ids: string[] = [];
      for (const f of files) {
        const title = `${text(env.emailSubject) ? `${text(env.emailSubject)} – ` : ''}${f.name.replace(/\.pdf$/i, '')} (signed)`.slice(0, 200);
        const r = await addDraftDocument(svc, company, { title, category: String(ep?.settings.category ?? 'governance'), audience: ep?.settings.audience === 'all_investors' ? 'all_investors' : 'board', bytes: new Uint8Array(Buffer.from(f.b64, 'base64')), fileName: `${f.name.replace(/\.pdf$/i, '')}.pdf`, contentType: 'application/pdf' });
        if ('error' in r) return finish(svc, m.id, 'failed', `Couldn’t file “${f.name}”.`, {}, r.error ?? null);
        ids.push(r.id!);
        await audit('api_added_document', { document_id: r.id, title });
      }
      return finish(svc, m.id, 'done', `Filed ${ids.length} signed document${ids.length === 1 ? '' : 's'} in Documents as draft${ids.length === 1 ? '' : 's'}.`, { document_ids: ids });
    }
  }
  return finish(svc, m.id, 'failed', `Unknown kind ${m.kind}.`);
}

/** The worker's turn: new messages, a few at a time. */
export async function processInbound(origin: string, max = 20) {
  const svc = serviceClient();
  const { data: todo } = await svc.from('inbound_messages').select('id, endpoint_id, entity_id, kind, body, file_path, attempts, result').eq('status', 'received').lt('attempts', 5).order('received_at').limit(max);
  for (const m of (todo ?? []) as Message[]) {
    const { data: claimed } = await svc.from('inbound_messages').update({ attempts: m.attempts + 1 }).eq('id', m.id).eq('attempts', m.attempts).eq('status', 'received').select('id');
    if (!claimed?.length) continue;
    const [{ data: ep }, { data: company }] = await Promise.all([
      m.endpoint_id ? svc.from('inbound_endpoints').select('id, entity_id, name, kind, auth, secret_enc, settings, active').eq('id', m.endpoint_id).maybeSingle() : Promise.resolve({ data: null }),
      svc.from('entities').select('id, code, display_name, relationship').eq('id', m.entity_id).single(),
    ]);
    try {
      await handle(svc, m, ep as Endpoint | null, company as Company, origin);
      const { data: after } = await svc.from('inbound_messages').select('status, summary').eq('id', m.id).single();
      if (after?.status === 'needs_review') {
        await notifyAdmins({ kind: 'admin_integrations', entityId: m.entity_id, title: `${company!.display_name}: something received needs your review`, body: after.summary ?? 'An incoming webhook needs a look.', link: `/admin/companies/${company!.code}/integrations?tab=incoming`, origin });
      }
    } catch (e) {
      await svc.from('inbound_messages').update({ status: m.attempts + 1 >= 5 ? 'failed' : 'received', error: (e as Error).message.slice(0, 500) }).eq('id', m.id);
    }
  }
}
