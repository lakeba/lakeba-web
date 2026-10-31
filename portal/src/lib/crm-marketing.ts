import { createHmac } from 'node:crypto';
import { INTEGRATIONS_KEY, MAILBOXES_READ_ONLY } from 'astro:env/server';
import type { serviceClient } from './admin';
import { cleanEmail, companyDomainOf, ensureRelationship, findOrCreateCompany, findOrCreatePerson, logActivity, salesTeam, toBase, validEmail } from './crm';
import { graph } from './graph';
import { gmail } from './gmail';
import { notifyMembers } from './notify';
import { crmXero } from './crm-xero';
import { xeroCall } from './integrations/xero';

// Marketing and lead generation in the CRM (docs/crm.md, phase 5): website forms and hosted landing pages that
// bring leads in (with the campaign they came from), lead scores by fit and behaviour, email sequences sent from
// the salesperson's own mailbox that stop as soon as the person replies, one opt-out list for the whole group,
// and campaigns measured in cash paid in Xero.

type Svc = ReturnType<typeof serviceClient>;
export type FormField = { key: string; label: string; type: 'text' | 'email' | 'phone' | 'textarea' | 'select'; required: boolean; options?: string[] };
export type Form = { id: string; entity_id: string; name: string; headline: string; intro: string; fields: FormField[]; button: string; thank_you: string; redirect_url: string | null; allowed_origins: string[]; create_deal: boolean; pipeline_id: string | null; owner_rule: 'round_robin' | 'fixed'; owner_id: string | null; campaign_id: string | null; sequence_id: string | null; consent_text: string; active: boolean; submissions: number };
export type Step = { day: number; subject: string; body: string };
export const CAMPAIGN_KINDS: Record<string, string> = { webinar: 'Webinar', event: 'Event', landing: 'Landing page', paid: 'Paid ads', referral: 'Referrals', press: 'Press', newsletter: 'Newsletter', email: 'Email', partner: 'Partner', other: 'Other' };
export const DEFAULT_FIELDS: FormField[] = [
  { key: 'name', label: 'Your name', type: 'text', required: true },
  { key: 'email', label: 'Work email', type: 'email', required: true },
  { key: 'company', label: 'Company', type: 'text', required: false },
  { key: 'job_title', label: 'Your role', type: 'text', required: false },
  { key: 'message', label: 'How can we help?', type: 'textarea', required: false },
];

// ---------------------------------------------------------------------------
// One opt-out list
// ---------------------------------------------------------------------------
/** Whether someone said no to sales emails: in the CRM, the newsletters or the press office (any company). */
export async function optedOut(svc: Svc, email: string, personId?: string | null) {
  const e = cleanEmail(email);
  const [{ data: c }, { data: n }, { data: m }] = await Promise.all([
    personId ? svc.from('crm_consents').select('status').eq('person_id', personId).eq('channel', 'sales_email').maybeSingle() : Promise.resolve({ data: null }),
    svc.from('newsletter_subscribers').select('id').eq('email', e).eq('status', 'unsubscribed').limit(1),
    svc.from('media_optouts').select('email').eq('email', e).limit(1),
  ]);
  return c?.status === 'no' || Boolean(n?.length) || Boolean(m?.length);
}
/** A signed link to opt out of sales emails (in each sequence email). */
export const optOutToken = (personId: string, entityId: string) => `${personId}.${entityId}.${createHmac('sha256', INTEGRATIONS_KEY ?? 'crm').update(`optout:${personId}:${entityId}`).digest('base64url').slice(0, 22)}`;
export function readOptOut(token: string) {
  const [personId, entityId, sig] = token.split('.');
  if (!personId || !entityId || !sig || optOutToken(personId, entityId) !== token) return null;
  return { personId, entityId };
}
export async function optOut(svc: Svc, personId: string, entityId: string, source: string) {
  await svc.from('crm_consents').upsert({ person_id: personId, channel: 'sales_email', status: 'no', source, entity_id: entityId, at: new Date().toISOString() });
  await svc.from('crm_enrolments').update({ status: 'stopped', stopped_reason: 'opted out', next_at: null }).eq('person_id', personId).eq('status', 'active');
  await svc.from('audit_log').insert({ user_id: null, action: 'crm_opted_out', detail: { entity_id: entityId, person_id: personId, source } });
}

// ---------------------------------------------------------------------------
// Lead scores: fit (the company's ideal customer) and behaviour (what they did lately)
// ---------------------------------------------------------------------------
type Ideal = { industries: string[]; sizes: string[]; countries: string[]; titles: string[] };
export async function scoreLead(svc: Svc, entityId: string, personId: string) {
  const [{ data: e }, { data: p }, { data: acts }] = await Promise.all([
    svc.from('entities').select('crm_ideal').eq('id', entityId).single(),
    svc.from('crm_people').select('job_title, crm_companies(industry, size_band, country)').eq('id', personId).single(),
    svc.from('crm_activities').select('kind, direction, occurred_at').eq('entity_id', entityId).eq('person_id', personId).gte('occurred_at', new Date(Date.now() - 60 * 86_400_000).toISOString()).limit(200),
  ]);
  const ideal = (e?.crm_ideal ?? {}) as Ideal;
  const person = p as unknown as { job_title: string; crm_companies: { industry: string; size_band: string; country: string } | null } | null;
  const reasons: string[] = [];
  let fit = 0, behaviour = 0;
  const has = (list: string[] | undefined, v: string | undefined) => Boolean(v && list?.some((x) => v.toLowerCase().includes(x.toLowerCase())));
  if (has(ideal.industries, person?.crm_companies?.industry)) { fit += 15; reasons.push(`industry: ${person!.crm_companies!.industry}`); }
  if (ideal.sizes?.includes(person?.crm_companies?.size_band ?? '')) { fit += 10; reasons.push(`size: ${person!.crm_companies!.size_band}`); }
  if (has(ideal.countries, person?.crm_companies?.country)) { fit += 5; reasons.push(`country: ${person!.crm_companies!.country}`); }
  if (has(ideal.titles, person?.job_title)) { fit += 15; reasons.push(`role: ${person!.job_title}`); }
  const recent = (a: { occurred_at: string }) => Date.now() - Date.parse(a.occurred_at) < 14 * 86_400_000;
  for (const a of (acts ?? []) as { kind: string; direction: string | null; occurred_at: string }[]) {
    const w = recent(a) ? 1 : 0.5;
    if (a.kind === 'form') { behaviour += 20 * w; reasons.push('filled in a form'); }
    else if (a.kind === 'room') behaviour += 6 * w;
    else if (a.kind === 'email' && a.direction === 'in') behaviour += 8 * w;
    else if (a.kind === 'meeting') behaviour += 12 * w;
  }
  const score = Math.min(100, Math.round(fit + Math.min(55, behaviour)));
  await svc.from('crm_relationships').update({ score, score_reasons: [...new Set(reasons)].slice(0, 6) }).eq('entity_id', entityId).eq('person_id', personId);
  return score;
}

// ---------------------------------------------------------------------------
// Website forms and landing pages
// ---------------------------------------------------------------------------
/** Who gets the next lead from a form: one person, or the sales team in turn. */
async function nextOwner(svc: Svc, f: Form) {
  if (f.owner_rule === 'fixed' && f.owner_id) return f.owner_id;
  const team = await salesTeam(svc, f.entity_id);
  if (!team.length) return null;
  const { data: e } = await svc.from('entities').select('crm_rr_index').eq('id', f.entity_id).single();
  const i = (e?.crm_rr_index ?? 0) % team.length;
  await svc.from('entities').update({ crm_rr_index: (e?.crm_rr_index ?? 0) + 1 }).eq('id', f.entity_id);
  return team[i].id;
}

/** A form sent from a website or landing page: the person (and company) found or added, the lead given to someone. */
export async function submitForm(svc: Svc, f: Form, values: Record<string, string>, meta: { origin: string; page: string; utm: Record<string, string>; ip: string; central: string }) {
  const email = cleanEmail(values.email ?? '');
  if (!validEmail(email)) throw new Error('Please give a valid email address.');
  for (const fld of f.fields) if (fld.required && !(values[fld.key] ?? '').trim()) throw new Error(`Please fill in “${fld.label}”.`);
  const domain = companyDomainOf(email);
  const orgName = (values.company ?? '').trim().slice(0, 200);
  // The campaign: the form's own, or the one named in the page's utm_campaign.
  let campaignId = f.campaign_id;
  if (!campaignId && meta.utm.utm_campaign) {
    const { data: c } = await svc.from('crm_campaigns').select('id').eq('entity_id', f.entity_id).eq('utm', meta.utm.utm_campaign.toLowerCase().slice(0, 60)).maybeSingle();
    campaignId = c?.id ?? null;
  }
  const org = orgName || domain ? await findOrCreateCompany(svc, { name: orgName || domain!, domain, source: 'form' }) : null;
  const person = await findOrCreatePerson(svc, { full_name: (values.name ?? '').trim().slice(0, 200) || email, email, phone: (values.phone ?? '').slice(0, 50), job_title: (values.job_title ?? '').slice(0, 200), company_id: org?.id ?? null, source: 'form' });
  const { data: existing } = await svc.from('crm_relationships').select('owner_id').eq('entity_id', f.entity_id).eq('person_id', person.id).maybeSingle();
  const owner = existing?.owner_id ?? await nextOwner(svc, f);
  await ensureRelationship(svc, f.entity_id, { person_id: person.id }, { kind: 'lead', owner_id: owner });
  if (campaignId) await svc.from('crm_relationships').update({ campaign_id: campaignId }).eq('entity_id', f.entity_id).eq('person_id', person.id).is('campaign_id', null);
  if (org) await ensureRelationship(svc, f.entity_id, { company_id: org.id }, { kind: 'lead', owner_id: owner });
  await svc.from('crm_consents').upsert({ person_id: person.id, channel: 'sales_email', status: 'yes', source: `form: ${f.name}`, entity_id: f.entity_id, at: new Date().toISOString() });
  const details = f.fields.filter((x) => !['name', 'email'].includes(x.key) && values[x.key]).map((x) => `${x.label}: ${values[x.key].slice(0, 2000)}`).join('\n');
  let dealId: string | null = null;
  if (f.create_deal) {
    let pq = svc.from('crm_pipelines').select('id, crm_stages(id, kind, sort)').eq('entity_id', f.entity_id).is('archived_at', null);
    if (f.pipeline_id) pq = pq.eq('id', f.pipeline_id);
    const { data: p } = await pq.order('sort').limit(1).maybeSingle();
    const stage = ((p as unknown as { crm_stages: { id: string; kind: string; sort: number }[] } | null)?.crm_stages ?? []).filter((s) => s.kind === 'open').sort((a, b) => a.sort - b.sort)[0];
    const { data: ent } = await svc.from('entities').select('crm_currency').eq('id', f.entity_id).single();
    if (p && stage) {
      const { data: d } = await svc.from('crm_deals').insert({ entity_id: f.entity_id, pipeline_id: p.id, stage_id: stage.id, title: `${orgName || domain || person.id.slice(0, 6)} — ${f.name}`.slice(0, 200), company_id: org?.id ?? null, person_id: person.id, owner_id: owner, currency: ent?.crm_currency ?? 'AUD', source: 'Website', campaign_id: campaignId }).select('id').single();
      dealId = d?.id ?? null;
      if (dealId) await svc.from('crm_deal_people').insert({ deal_id: dealId, person_id: person.id, part: 'champion' });
    }
  }
  await logActivity(svc, { entity_id: f.entity_id, kind: 'form', direction: 'in', subject: `Form: ${f.name}`, body: details, person_id: person.id, company_id: org?.id ?? null, deal_id: dealId, meta: { page: meta.page.slice(0, 500), origin: meta.origin, utm: meta.utm, ip: meta.ip } });
  await svc.from('crm_forms').update({ submissions: f.submissions + 1 }).eq('id', f.id);
  await svc.from('audit_log').insert({ user_id: null, action: 'crm_person_added', detail: { entity_id: f.entity_id, person_id: person.id, existing: !person.created, via: 'form', form: f.name } });
  await scoreLead(svc, f.entity_id, person.id);
  if (f.sequence_id) await enrol(svc, { sequenceId: f.sequence_id, entityId: f.entity_id, personId: person.id, ownerId: owner });
  if (owner) await notifyMembers({ kind: 'crm', origin: meta.central, link: dealId ? `/admin/crm/deals/${dealId}` : `/admin/crm/people/${person.id}`, title: `New lead: ${values.name || email}`, body: `${f.name}${orgName ? ` · ${orgName}` : ''}${values.message ? ` · “${values.message.slice(0, 120)}”` : ''}`, userIds: [owner], entityId: f.entity_id }).catch(() => 0);
  return { personId: person.id, dealId };
}

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------
export async function enrol(svc: Svc, o: { sequenceId: string; entityId: string; personId: string; ownerId: string | null }) {
  const { data: s } = await svc.from('crm_sequences').select('steps, active').eq('id', o.sequenceId).eq('entity_id', o.entityId).maybeSingle();
  if (!s?.active) throw new Error('That sequence isn’t active.');
  const steps = s.steps as Step[];
  if (!steps.length) throw new Error('That sequence has no emails yet.');
  const { data: p } = await svc.from('crm_people').select('email').eq('id', o.personId).single();
  if (!p?.email) throw new Error('They have no email address.');
  if (await optedOut(svc, p.email, o.personId)) throw new Error('They asked not to receive sales emails.');
  const next = new Date(Date.now() + steps[0].day * 86_400_000).toISOString();
  await svc.from('crm_enrolments').upsert({ sequence_id: o.sequenceId, entity_id: o.entityId, person_id: o.personId, owner_id: o.ownerId, step: 0, next_at: next, status: 'active', stopped_reason: '', enrolled_at: new Date().toISOString() }, { onConflict: 'sequence_id,person_id' });
}

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(first_name|company|sender)\}/g, (_m, k) => v[k] ?? '');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Sends due sequence emails from each owner's own mailbox; stops on a reply, a meeting, an opt-out or a closed deal. */
export async function sequenceJobs(svc: Svc, central: string) {
  const { data: due } = await svc.from('crm_enrolments').select('*, crm_sequences(name, steps, active), crm_people(full_name, email, crm_companies(name))').eq('status', 'active').lte('next_at', new Date().toISOString()).limit(50);
  type E = { id: string; entity_id: string; person_id: string; owner_id: string | null; step: number; enrolled_at: string; crm_sequences: { name: string; steps: Step[]; active: boolean } | null; crm_people: { full_name: string; email: string | null; crm_companies: { name: string } | null } | null };
  for (const e of (due ?? []) as unknown as E[]) {
    const stop = (reason: string) => svc.from('crm_enrolments').update({ status: 'stopped', stopped_reason: reason, next_at: null }).eq('id', e.id);
    const steps = e.crm_sequences?.steps ?? [];
    const email = e.crm_people?.email;
    if (!e.crm_sequences?.active || !email) { await stop('sequence off or no email'); continue; }
    // A reply or a meeting since they were enrolled: the salesperson takes over.
    const { count: replied } = await svc.from('crm_activities').select('id', { count: 'exact', head: true }).eq('entity_id', e.entity_id).eq('person_id', e.person_id).gte('occurred_at', e.enrolled_at).or('and(kind.eq.email,direction.eq.in),kind.eq.meeting,kind.eq.whatsapp');
    if (replied) { await stop('they replied'); continue; }
    if (await optedOut(svc, email, e.person_id)) { await stop('opted out'); continue; }
    const step = steps[e.step];
    if (!step) { await svc.from('crm_enrolments').update({ status: 'finished', next_at: null }).eq('id', e.id); continue; }
    const { data: box } = e.owner_id ? await svc.from('crm_mailboxes').select('address, provider, entities(ms_tenant_id)').eq('entity_id', e.entity_id).eq('user_id', e.owner_id).eq('status', 'connected').maybeSingle() : { data: null };
    if (!box) { await stop('the owner has no connected mailbox'); continue; }
    const { data: owner } = await svc.from('profiles').select('first_name, last_name').eq('id', e.owner_id!).single();
    const vars = { first_name: (e.crm_people!.full_name ?? '').split(' ')[0], company: e.crm_people!.crm_companies?.name ?? '', sender: `${owner?.first_name ?? ''} ${owner?.last_name ?? ''}`.trim() };
    const subject = fill(step.subject, vars).slice(0, 200);
    const text = fill(step.body, vars);
    const optLink = `${central}/optout/${optOutToken(e.person_id, e.entity_id)}`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${esc(text).replace(/\n/g, '<br>')}<p style="color:#888;font-size:11px;margin-top:24px">Not interested? <a href="${optLink}" style="color:#888">Don’t email me about this again</a>.</p></div>`;
    try {
      if (MAILBOXES_READ_ONLY) throw new Error('this server only reads mailboxes (staging)');
      if (box.provider === 'google') {
        const raw = Buffer.from(`To: ${email}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\nList-Unsubscribe: <${optLink}>\r\n\r\n${html}`).toString('base64url');
        await gmail(box.address, '/messages/send', { method: 'POST', body: JSON.stringify({ raw }), headers: { 'content-type': 'application/json' } });
      } else {
        await graph(`/users/${encodeURIComponent(box.address)}/sendMail`, { method: 'POST', tenant: (box as unknown as { entities: { ms_tenant_id: string | null } | null }).entities?.ms_tenant_id ?? undefined, body: JSON.stringify({ message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: email } }], internetMessageHeaders: [{ name: 'X-Lakeba-Sequence', value: e.id }] }, saveToSentItems: true }) });
      }
      await logActivity(svc, { entity_id: e.entity_id, kind: 'email', direction: 'out', person_id: e.person_id, subject, body: text, source_ref: `seq:${e.id}:${e.step}`, created_by: e.owner_id, meta: { sequence: e.crm_sequences.name } });
      const next = steps[e.step + 1];
      await svc.from('crm_enrolments').update(next ? { step: e.step + 1, next_at: new Date(Date.parse(e.enrolled_at) + next.day * 86_400_000).toISOString() } : { step: e.step + 1, status: 'finished', next_at: null }).eq('id', e.id);
    } catch (err) {
      // Staging only reads mailboxes; a mailbox the portal can't send from stops the sequence with the reason.
      await stop(`couldn’t send: ${(err as Error).message.slice(0, 200)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Campaign results, in cash
// ---------------------------------------------------------------------------
export async function campaignResults(svc: Svc, entityId: string, company: { id: string; code: string; display_name: string; crm_currency: string; crm_fx: Record<string, number> }, central: string) {
  const [{ data: camps }, { data: rels }, { data: deals }] = await Promise.all([
    svc.from('crm_campaigns').select('*').eq('entity_id', entityId).order('created_at', { ascending: false }),
    svc.from('crm_relationships').select('campaign_id').eq('entity_id', entityId).not('campaign_id', 'is', null).not('person_id', 'is', null),
    svc.from('crm_deals').select('campaign_id, status, amount, currency, paid_amount').eq('entity_id', entityId).not('campaign_id', 'is', null),
  ]);
  // Spend from Xero bills tagged with a campaign's tracking option (this year), where the CRM can read Xero.
  const xeroSpend = new Map<string, number>();
  const tagged = (camps ?? []).filter((c) => c.xero_tracking);
  if (tagged.length) {
    const x = await crmXero(svc, company, central).catch(() => null);
    if (x) {
      const since = `DateTime(${new Date().getUTCFullYear()},1,1)`;
      const res = await xeroCall<{ Invoices?: { LineItems?: { LineAmount?: number; Tracking?: { Option?: string }[] }[] }[] }>(x, 'GET', `/Invoices?where=${encodeURIComponent(`Type=="ACCPAY" AND Date>=${since}`)}&Statuses=AUTHORISED,PAID&page=1`).catch(() => null);
      for (const inv of res?.Invoices ?? []) for (const l of inv.LineItems ?? []) for (const c of tagged) if ((l.Tracking ?? []).some((t) => t.Option === c.xero_tracking)) xeroSpend.set(c.id, (xeroSpend.get(c.id) ?? 0) + Number(l.LineAmount ?? 0));
    }
  }
  return (camps ?? []).map((c) => {
    const ds = (deals ?? []).filter((d) => d.campaign_id === c.id);
    const paid = ds.filter((d) => d.status === 'won').reduce((s, d) => s + toBase(Number(d.paid_amount) || Number(d.amount), d.currency, company), 0);
    const spend = Number(c.spend) + (xeroSpend.get(c.id) ?? 0);
    return { ...c, leads: (rels ?? []).filter((r) => r.campaign_id === c.id).length, deals: ds.length, won: ds.filter((d) => d.status === 'won').length, paid, spend, ret: spend > 0 ? paid / spend : null };
  });
}
