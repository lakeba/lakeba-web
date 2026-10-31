import type { serviceClient } from './admin';
import { syncMailboxes } from './crm-mail';
import { crmXero, syncDeal } from './crm-xero';
import { money } from './crm';
import { notifyMembers } from './notify';

// The CRM's background work, from the notification worker every minute: the salespeople's mailboxes and
// calendars every 5 minutes, Xero's quotes, invoices and payments every 15.

type Svc = ReturnType<typeof serviceClient>;
let mailAt = 0;
let xeroAt = 0;

export async function crmJobs(svc: Svc, origin: string) {
  const now = Date.now();
  if (now - mailAt > 5 * 60_000) {
    mailAt = now;
    await syncMailboxes(svc).catch((e) => console.error('crm mail', (e as Error).message));
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
