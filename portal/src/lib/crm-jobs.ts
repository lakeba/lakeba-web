import type { serviceClient } from './admin';
import { syncMailboxes } from './crm-mail';
import { crmXero, syncDeal } from './crm-xero';
import { money } from './crm';
import { notifyMembers } from './notify';
import { aiBudget, briefMeeting, classifyInbox, reviewDeal } from './crm-ai';
import { sequenceJobs } from './crm-marketing';

// The CRM's background work, from the notification worker every minute: the salespeople's mailboxes and
// calendars every 5 minutes, Xero's quotes, invoices and payments every 15.

type Svc = ReturnType<typeof serviceClient>;
let mailAt = 0;
let xeroAt = 0;
let aiAt = 0;
const reviewedOn = new Map<string, string>();

export async function crmJobs(svc: Svc, origin: string) {
  const now = Date.now();
  if (now - mailAt > 5 * 60_000) {
    mailAt = now;
    await syncMailboxes(svc).catch((e) => console.error('crm mail', (e as Error).message));
    await sequenceJobs(svc, origin).catch((e) => console.error('crm sequences', (e as Error).message));
  }
  if (now - aiAt > 30 * 60_000) {
    aiAt = now;
    await aiJobs(svc).catch((e) => console.error('crm ai', (e as Error).message));
  }
  if (now - xeroAt > 15 * 60_000) {
    xeroAt = now;
    await syncXero(svc, origin).catch((e) => console.error('crm xero', (e as Error).message));
  }
}

/** Deals with a Xero client that aren't settled yet: their quotes, invoices and payments. */
async function syncXero(svc: Svc, origin: string) {
  const { data: ents } = await svc.from('entities').select('id, code, display_name').eq('crm_enabled', true);
  for (const e of ents ?? []) {
    const x = await crmXero(svc, e, origin).catch(() => null);
    if (!x) continue;
    const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const { data: deals } = await svc.from('crm_deals').select('id, entity_id, title, owner_id, amount, currency, xero_contact_id, xero_invoice_ids, invoiced_amount, paid_amount, status, pipeline_id, stage_id')
      .eq('entity_id', e.id).not('xero_contact_id', 'is', null).neq('status', 'lost').gte('updated_at', since).limit(200);
    for (const d of deals ?? []) {
      if (d.status === 'won' && Number(d.paid_amount) >= Number(d.invoiced_amount) && Number(d.invoiced_amount) > 0) continue;
      const r = await syncDeal(svc, x, d as never).catch(() => null);
      if (r?.won && d.owner_id) await notifyMembers({ kind: 'crm', origin, link: `/admin/crm/deals/${d.id}`, title: `Paid: ${d.title}`, body: `Paid in full in Xero. The deal is won (${money(Number(d.amount), d.currency)}).`, userIds: [d.owner_id], entityId: e.id }).catch(() => 0);
    }
  }
}

/**
 * Lakeba AI's routine work, within each company's budget: sorting new inbox finds, briefs for meetings in the
 * next three hours, and each morning (6 to 9 am Sydney) a fresh review of every salesperson's biggest open deals.
 */
async function aiJobs(svc: Svc) {
  const { data: ents } = await svc.from('entities').select('id').eq('crm_enabled', true);
  const sydney = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const part = (t: string) => sydney.find((p) => p.type === t)?.value ?? '';
  const today = `${part('year')}-${part('month')}-${part('day')}`, hour = Number(part('hour'));
  for (const e of ents ?? []) {
    if (!(await aiBudget(svc, e.id)).ok) continue;
    await classifyInbox(svc, e.id).catch(() => 0);
    const soon = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const { data: meetings } = await svc.from('crm_activities').select('id, meta').eq('entity_id', e.id).eq('kind', 'meeting').gte('occurred_at', new Date().toISOString()).lte('occurred_at', soon).limit(20);
    for (const m of (meetings ?? []).filter((m) => !(m.meta as { brief?: unknown }).brief)) await briefMeeting(svc, m.id, null).catch(() => null);
    if (hour >= 6 && hour < 9 && reviewedOn.get(e.id) !== today) {
      reviewedOn.set(e.id, today);
      const { data: deals } = await svc.from('crm_deals').select('id, owner_id, ai_review, updated_at, last_activity_at').eq('entity_id', e.id).eq('status', 'open').not('owner_id', 'is', null).order('amount', { ascending: false }).limit(200);
      const perOwner = new Map<string, number>();
      for (const d of deals ?? []) {
        const at = (d.ai_review as { at?: string } | null)?.at;
        const changed = !at || [d.updated_at, d.last_activity_at].some((t) => t && t > at) || Date.now() - Date.parse(at) > 7 * 86_400_000;
        const n = perOwner.get(d.owner_id as string) ?? 0;
        if (!changed || n >= 5) continue;
        perOwner.set(d.owner_id as string, n + 1);
        await reviewDeal(svc, d.id, null).catch(() => null);
        if (!(await aiBudget(svc, e.id)).ok) break;
      }
    }
  }
}
