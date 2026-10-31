import type { serviceClient } from './admin';
import { ask } from './crm-ai';
import { cleanEmail, companyDomainOf, ensureRelationship, findOrCreateCompany, findOrCreatePerson, logActivity, money, validEmail } from './crm';
import { readyProviders, transcribeRecording } from './transcription';

// Updating the CRM in a few words (docs/crm.md, phase 4): a WhatsApp message, a voice note after a call, or a
// photo of a business card. Lakeba AI reads it against the salesperson's own open deals and proposes the
// changes: a note on the right deal, its next step, a stage it has clearly reached, a task, a new contact. The
// app shows the proposal to tick; WhatsApp applies the safe parts and says what it did. Winning, losing,
// quotes and anything sent to a buyer stay with the salesperson in the CRM.

type Svc = ReturnType<typeof serviceClient>;
export type Proposal = {
  intent: 'update' | 'question' | 'other';
  deal_id: string | null; deal_label: string;
  note: string; next_step: string; next_step_on: string | null; stage: string; amount: number | null;
  task: string; task_due: string | null;
  contact: { name: string; email: string; job_title: string; company: string; phone: string } | null;
  question: string; reply: string;
};

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['intent', 'deal_id', 'note', 'next_step', 'next_step_on', 'stage', 'amount', 'task', 'task_due', 'contact', 'question', 'reply'],
  properties: {
    intent: { type: 'string', enum: ['update', 'question', 'other'] }, deal_id: { type: 'string' }, note: { type: 'string' },
    next_step: { type: 'string' }, next_step_on: { type: 'string' }, stage: { type: 'string' }, amount: { type: 'number' }, task: { type: 'string' }, task_due: { type: 'string' },
    contact: { type: 'object', additionalProperties: false, required: ['name', 'email', 'job_title', 'company', 'phone'], properties: { name: { type: 'string' }, email: { type: 'string' }, job_title: { type: 'string' }, company: { type: 'string' }, phone: { type: 'string' } } },
    question: { type: 'string' }, reply: { type: 'string' },
  },
} as const;

/** The salesperson's words, read against their open deals: what to change. */
export async function interpret(svc: Svc, o: { entityId: string; userId: string; text: string; feature: 'whatsapp' | 'voice' }): Promise<Proposal> {
  const { data: deals } = await svc.from('crm_deals').select('id, title, amount, currency, next_step, crm_stages(name), crm_pipelines(crm_stages(name, kind, sort)), crm_companies!crm_deals_company_id_fkey(name), crm_people!crm_deals_person_id_fkey(full_name)').eq('entity_id', o.entityId).eq('owner_id', o.userId).eq('status', 'open').order('updated_at', { ascending: false }).limit(40);
  type D = { id: string; title: string; amount: number; currency: string; next_step: string; crm_stages: { name: string } | null; crm_pipelines: { crm_stages: { name: string; kind: string; sort: number }[] } | null; crm_companies: { name: string } | null; crm_people: { full_name: string } | null };
  const list = (deals ?? []) as unknown as D[];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
  const weekday = new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'Australia/Sydney' }).format(new Date());
  const out = await ask<Proposal & { amount: number; next_step_on: string; task_due: string }>(svc, {
    entityId: o.entityId, userId: o.userId, feature: o.feature, effort: 'low', maxTokens: 1200, schema: SCHEMA,
    system: [
      'A salesperson tells their CRM assistant, in a quick message or voice note, what happened or what they want. Work out what to change in the CRM.',
      'intent: update (news about a deal or contact), question (they ask something), other.',
      'deal_id: the id of the deal they mean, from the list (match by company, person or deal name), or "" if none fits. Never invent an id.',
      'note: what happened, cleaned up as a short note for the deal\'s timeline, in their words (no facts added). ""if nothing.',
      `next_step and next_step_on (YYYY-MM-DD; today is ${weekday} ${today}, so "Wednesday" or "next Wednesday" means the coming Wednesday, and "next week" the coming Monday): the next action they said, else "".`,
      'stage: a stage name from that deal\'s pipeline if they clearly said the deal reached it (only open stages, never won or lost), else "".',
      'amount: a new deal value if they said one (a number), else 0. task and task_due: a follow-up task if they asked for a reminder, else "".',
      'contact: a new person they met (name, email, job_title, company, phone), or all "" if none.',
      'question: their question, if intent is question, else "".',
      'reply: one short friendly line confirming what you understood (it will be followed by the list of changes), or asking which deal if unclear.',
    ].join('\n'),
    content: `Their open deals:\n${list.map((d) => `- id ${d.id}: ${d.crm_companies?.name ? `${d.crm_companies.name} — ` : ''}${d.title}${d.crm_people ? ` (${d.crm_people.full_name})` : ''}, ${money(Number(d.amount), d.currency)}, stage ${d.crm_stages?.name}; stages: ${(d.crm_pipelines?.crm_stages ?? []).filter((s) => s.kind === 'open').sort((a, b) => a.sort - b.sort).map((s) => s.name).join(', ')}`).join('\n') || '(none)'}\n\n<message>\n${o.text.slice(0, 6000)}\n</message>`,
  }) as Proposal & { amount: number; next_step_on: string; task_due: string };
  const deal = list.find((d) => d.id === out.deal_id);
  const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const c = out.contact;
  return {
    ...out, deal_id: deal?.id ?? null, deal_label: deal ? (deal.crm_companies?.name ? `${deal.crm_companies.name} — ${deal.title}` : deal.title) : '',
    next_step_on: date(out.next_step_on), task_due: date(out.task_due), amount: out.amount > 0 ? out.amount : null,
    stage: deal && (deal.crm_pipelines?.crm_stages ?? []).some((s) => s.kind === 'open' && s.name === out.stage) ? out.stage : '',
    contact: c && (c.name || c.email) ? c : null,
  };
}

/** Applies the chosen parts of a proposal; returns what was done, in words. */
export async function applyProposal(svc: Svc, o: { entityId: string; userId: string; p: Proposal; parts: Set<string>; source: 'whatsapp' | 'voice' | 'card'; raw: string }) {
  const { p, parts } = o;
  const done: string[] = [];
  const deal = p.deal_id ? (await svc.from('crm_deals').select('id, title, pipeline_id, stage_id, owner_id, amount, currency, company_id').eq('id', p.deal_id).eq('entity_id', o.entityId).maybeSingle()).data : null;
  if (deal && deal.owner_id && deal.owner_id !== o.userId) throw new Error('That deal belongs to someone else.');
  if (deal && parts.has('note') && (p.note || o.raw)) {
    await logActivity(svc, { entity_id: o.entityId, kind: o.source === 'whatsapp' ? 'whatsapp' : 'note', direction: null, deal_id: deal.id, company_id: deal.company_id, subject: o.source === 'whatsapp' ? 'WhatsApp from the salesperson' : o.source === 'voice' ? 'Voice note' : 'Note', body: p.note || o.raw, created_by: o.userId, meta: { raw: o.raw.slice(0, 4000) } });
    done.push('notes saved');
  }
  const changes: Record<string, unknown> = {};
  if (deal && parts.has('next') && p.next_step) { changes.next_step = p.next_step.slice(0, 300); changes.next_step_on = p.next_step_on; done.push(`next step: ${p.next_step}${p.next_step_on ? ` (${p.next_step_on})` : ''}`); }
  if (deal && parts.has('amount') && p.amount) { changes.amount = p.amount; done.push(`value ${money(p.amount, deal.currency)}`); }
  if (deal && parts.has('stage') && p.stage) {
    const { data: s } = await svc.from('crm_stages').select('id, name, kind').eq('pipeline_id', deal.pipeline_id).eq('name', p.stage).eq('kind', 'open').maybeSingle();
    if (s && s.id !== deal.stage_id) {
      const { data: from } = await svc.from('crm_stages').select('name').eq('id', deal.stage_id).single();
      Object.assign(changes, { stage_id: s.id, stage_changed_at: new Date().toISOString() });
      await logActivity(svc, { entity_id: o.entityId, kind: 'stage', deal_id: deal.id, subject: `${from?.name} → ${s.name}`, created_by: o.userId });
      await svc.from('audit_log').insert({ user_id: o.userId, action: 'crm_deal_stage_changed', detail: { entity_id: o.entityId, deal_id: deal.id, stage: s.name, via: o.source } });
      done.push(`moved to ${s.name}`);
    }
  }
  if (deal && Object.keys(changes).length) await svc.from('crm_deals').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', deal.id);
  if (parts.has('task') && p.task) {
    await svc.from('crm_tasks').insert({ entity_id: o.entityId, deal_id: deal?.id ?? null, owner_id: o.userId, title: p.task.slice(0, 300), due_on: p.task_due ?? p.next_step_on, created_by: o.userId });
    done.push(`task: ${p.task}`);
  }
  if (parts.has('contact') && p.contact) {
    const email = cleanEmail(p.contact.email);
    const domain = companyDomainOf(email);
    const org = p.contact.company || domain ? await findOrCreateCompany(svc, { name: p.contact.company || domain!, domain, source: o.source, createdBy: o.userId }) : null;
    const person = await findOrCreatePerson(svc, { full_name: p.contact.name || email, email: validEmail(email) ? email : null, job_title: p.contact.job_title, phone: p.contact.phone, company_id: org?.id ?? deal?.company_id ?? null, source: o.source, createdBy: o.userId });
    await ensureRelationship(svc, o.entityId, { person_id: person.id }, { kind: 'lead', owner_id: o.userId, createdBy: o.userId });
    if (org) await ensureRelationship(svc, o.entityId, { company_id: org.id }, { kind: 'lead', owner_id: o.userId, createdBy: o.userId });
    if (deal) await svc.from('crm_deal_people').upsert({ deal_id: deal.id, person_id: person.id, part: 'involved' });
    done.push(`${person.created ? 'added' : 'found'} ${p.contact.name || email}`);
  }
  return { done, deal };
}

/** A voice note's words (Deepgram or AssemblyAI, as set on the server; Deepgram hears several languages). */
export async function transcribeNote(audio: Buffer, mime: string) {
  const provider = readyProviders()[0];
  if (!provider) throw new Error('Voice notes need a transcription service on the server (Deepgram or AssemblyAI).');
  const segments = await transcribeRecording(provider, audio, mime, 1);
  return segments.map((s) => s.text).join(' ').trim();
}

/** A business card's details from its photo (Lakeba AI reads the picture). */
export async function readCard(svc: Svc, o: { entityId: string; userId: string; image: Buffer; mime: string }) {
  const out = await ask<{ name: string; email: string; job_title: string; company: string; phone: string; website: string }>(svc, {
    entityId: o.entityId, userId: o.userId, feature: 'card', effort: 'low', maxTokens: 500,
    schema: { type: 'object', additionalProperties: false, required: ['name', 'email', 'job_title', 'company', 'phone', 'website'], properties: { name: { type: 'string' }, email: { type: 'string' }, job_title: { type: 'string' }, company: { type: 'string' }, phone: { type: 'string' }, website: { type: 'string' } } },
    system: 'Read the business card in the photo: the person\'s name, email, job title, company, phone and website exactly as printed ("" for what isn\'t there).',
    content: [{ type: 'image', source: { type: 'base64', media_type: o.mime, data: o.image.toString('base64') } }, { type: 'text', text: 'The card.' }],
  }) as { name: string; email: string; job_title: string; company: string; phone: string; website: string };
  return out;
}
