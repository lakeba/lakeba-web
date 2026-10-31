import { createHmac, randomBytes } from 'node:crypto';
import { serviceClient } from '../admin';
import { notifyAdmins } from '../notify';
import { outbound } from '../outbound';
import { open, seal } from '../secret-box';

type Svc = ReturnType<typeof serviceClient>;

// Events for other tools. Every logged action that matters outside the portal
// becomes an event of its company (the audit_to_event trigger), and a delivery
// for each of the company's webhook endpoints that wants it. The worker below
// sends deliveries: signed like Stripe's ("Lakeba-Signature: t=…,v1=…"),
// retried for about three days, then the endpoint is switched off and the
// company's Admins are told.

export const EVENTS: Record<string, string> = {
  'holder.created': 'A holder (holding entity) was added',
  'holder.updated': 'A holder’s details changed',
  'holder.deleted': 'A holder was deleted',
  'holdings.changed': 'Holdings changed (an import, an edit or a deletion)',
  'register.imported': 'A register of members was imported and applied',
  'share_class.updated': 'Official shares on issue were set',
  'person.added': 'An investor was added (not invited yet)',
  'person.invited': 'An investor was invited to the portal',
  'person.deleted': 'An investor’s account was deleted',
  'person.signed_in': 'An investor signed in',
  'holder_access.added': 'A person was given access to a holder',
  'holder_access.removed': 'A person’s access to a holder was removed',
  'document.added': 'A document was uploaded (it may still be a draft)',
  'document.published': 'A document was published to investors',
  'document.deleted': 'A document was deleted',
  'news.published': 'A news post was published',
  'meeting.created': 'A meeting was created',
  'meeting.opened': 'Proxy voting opened for a meeting',
  'meeting.results_published': 'A meeting’s results were published',
  'meeting.deleted': 'A meeting was deleted',
  'proxy.lodged': 'An investor lodged proxy votes',
  'query.created': 'An investor asked the board a question (Board Q&A)',
  'query.answered': 'The board answered a question',
  'data_room.guest_invited': 'A data room guest was invited',
  'data_room.terms_accepted': 'A data room guest accepted the terms',
  'data_room.document_viewed': 'A data room guest opened a document',
  'newsletter.subscribed': 'Someone subscribed to the newsletter',
  'newsletter.unsubscribed': 'Someone unsubscribed from the newsletter',
  'approval.requested': 'An approval was requested',
  'approval.decided': 'An approval was given or changes were asked for',
  'trade_interest.registered': 'An investor registered a trading interest',
  'inbound.received': 'An incoming webhook was received',
  'company_record.updated': 'The company’s legal record changed (by hand or from an ASIC extract)',
  'officer.appointed': 'A director or secretary was added to the officers register',
  'officer.updated': 'An officer’s details changed',
  'officer.removed': 'An officer was removed from the register',
  'deadline.done': 'A legal deadline was marked done',
  'deadline.not_needed': 'A legal deadline was marked not needed',
  'contract.added': 'A contract was added and read',
  'reporting_pack.sent': 'A reporting pack was sent to Lakeba',
  'reporting_pack.accepted': 'Lakeba accepted a reporting pack',
  'reporting_pack.returned': 'Lakeba sent a reporting pack back with a question',
  'board_meeting.created': 'A directors’ meeting was added',
  'board_meeting.recorded': 'A directors’ meeting finished recording (the transcript follows)',
  'board_paper.signed': 'A board paper (minutes or a resolution) was signed',
  'employee.added': 'A person was added in HR',
  'employee.left': 'A person was marked as having left',
  'equity.granted': 'An equity grant was made',
  'deal.created': 'A deal was created in the CRM',
  'deal.stage_changed': 'A deal moved to another stage',
  'deal.won': 'A deal was won',
  'deal.lost': 'A deal was lost (with the reason)',
  'lead.added': 'Someone was added to the CRM (a new lead, or someone already known to the group)',
  'quote.sent': 'A quote was sent to the buyer (in the deal room)',
  'quote.accepted': 'A buyer accepted a quote',
  'invoice.paid': 'A deal’s invoice was paid in Xero (the deal is won)',
};

/** The scope a key needs to see an event of this type (GET /api/v1/events, Zapier subscriptions). */
export function eventScope(type: string) {
  const area = type.split('.')[0];
  return ({ holder: 'investors.view', holdings: 'investors.view', register: 'investors.view', share_class: 'investors.view', person: 'investors.view', holder_access: 'investors.view',
    document: 'documents.view', data_room: 'documents.view', news: 'news.view', meeting: 'meetings.view', proxy: 'meetings.view', query: 'inbox.view',
    newsletter: 'newsletters.view', trade_interest: 'capital.view', approval: 'investors.view', inbound: 'investors.view',
    company_record: 'legal.view', officer: 'legal.view', deadline: 'legal.view', contract: 'legal.view', reporting_pack: 'reporting.view',
    board_meeting: 'boardroom.view', board_paper: 'boardroom.view', employee: 'hr.view', equity: 'hr.view', deal: 'crm.view', lead: 'crm.view', quote: 'crm.view', invoice: 'crm.view' } as Record<string, string>)[area] ?? 'investors.view';
}

const PERSONAL = /^(email|name|full_name|holder_name|first_name|last_name|phone|address|guest_name|subscriber|to|from|officer|person)$/i;
/** Event data without personal details, unless the endpoint may have them. */
export function eventData(data: Record<string, unknown>, personal: boolean) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (['via', 'key_id', 'company'].includes(k)) continue;
    if (!personal && PERSONAL.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export type EventRow = { id: number; event_id: string; entity_id: string; type: string; data: Record<string, unknown>; occurred_at: string };

export function payloadOf(e: EventRow, company: { code: string; display_name: string }, personal: boolean, origin: string) {
  return { id: e.event_id, type: e.type, occurred_at: e.occurred_at, company: { code: company.code, name: company.display_name }, description: EVENTS[e.type] ?? e.type, data: eventData(e.data, personal), api: `${origin}/api/v1` };
}

const human = (p: ReturnType<typeof payloadOf>) => {
  const d = p.data as Record<string, string>;
  const bits = [d.title, d.name, d.email, d.status].filter(Boolean).join(' · ');
  return `${p.company.name}: ${p.description}${bits ? ` — ${bits}` : ''}`;
};

/** The body for an endpoint's format: the event itself, or a Slack / Teams message. */
export function bodyFor(format: string, p: ReturnType<typeof payloadOf>) {
  if (format === 'slack') return { text: human(p) };
  if (format === 'teams') return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text: human(p), wrap: true }] } }] };
  return p;
}

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;
export const sealSecret = (s: string) => seal(s);

/** "t=<seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">" */
export function signature(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/** Minutes to wait after each failed attempt: about three days in all. */
const BACKOFF = [1, 5, 15, 60, 180, 360, 720, 1440, 1440];

type Endpoint = { id: string; entity_id: string; name: string; url: string; format: string; secret_enc: string; personal_data: boolean; active: boolean };

/** Sends one delivery now; returns whether it worked. */
export async function deliver(svc: Svc, d: { id: number; attempts: number }, ep: Endpoint, e: EventRow, company: { code: string; display_name: string }, origin: string) {
  const payload = payloadOf(e, company, ep.personal_data, origin);
  const body = JSON.stringify(bodyFor(ep.format, payload));
  let status = 0, error: string | null = null, excerpt = '';
  try {
    const res = await outbound('POST', ep.url, { body, headers: { 'content-type': 'application/json', 'lakeba-event': e.type, 'lakeba-event-id': e.event_id, 'lakeba-signature': signature(open(ep.secret_enc), body), 'lakeba-delivery': String(d.id) }, max: 2000 });
    status = res.status; excerpt = res.text.slice(0, 500);
    if (status < 200 || status >= 300) error = `Answered ${status}`;
  } catch (err) { error = (err as Error).message; }
  const attempts = d.attempts + 1;
  if (!error) {
    await svc.from('webhook_deliveries').update({ status: 'delivered', attempts, last_status: status, last_error: null, response_excerpt: excerpt, delivered_at: new Date().toISOString() }).eq('id', d.id);
    await svc.from('webhook_endpoints').update({ failures: 0 }).eq('id', ep.id);
    return true;
  }
  const gaveUp = attempts > BACKOFF.length;
  await svc.from('webhook_deliveries').update({ status: gaveUp ? 'gave_up' : 'failed', attempts, last_status: status || null, last_error: error, response_excerpt: excerpt, next_attempt_at: new Date(Date.now() + (BACKOFF[attempts - 1] ?? 1440) * 60_000).toISOString() }).eq('id', d.id);
  const { data: epNow } = await svc.from('webhook_endpoints').select('failures').eq('id', ep.id).single();
  await svc.from('webhook_endpoints').update({ failures: (epNow?.failures ?? 0) + 1 }).eq('id', ep.id);
  if (gaveUp && ep.active) {
    await svc.from('webhook_endpoints').update({ active: false, disabled_reason: `Switched off on ${new Date().toISOString().slice(0, 10)}: deliveries kept failing for three days (${error}).` }).eq('id', ep.id);
    await svc.from('audit_log').insert({ action: 'webhook_switched_off', detail: { entity_id: ep.entity_id, endpoint_id: ep.id, name: ep.name, error } });
    await notifyAdmins({ kind: 'admin_integrations', entityId: ep.entity_id, title: `Webhook “${ep.name}” was switched off`, body: `Deliveries to ${ep.url} kept failing for three days (${error}). Fix the receiving end, then switch it back on in Integrations.`, link: `/admin/companies/${company.code}/integrations?tab=webhooks`, origin }).catch(() => {});
  }
  return false;
}

/** The worker's turn: due deliveries, a few at a time. */
export async function deliverWebhooks(origin: string, max = 40) {
  const svc = serviceClient();
  const { data: due } = await svc.from('webhook_deliveries').select('id, attempts, endpoint_id, event_id')
    .in('status', ['pending', 'failed']).lte('next_attempt_at', new Date().toISOString()).order('next_attempt_at').limit(max);
  if (!due?.length) return 0;
  const [{ data: eps }, { data: evs }] = await Promise.all([
    svc.from('webhook_endpoints').select('id, entity_id, name, url, format, secret_enc, personal_data, active, entities(code, display_name, integrations_enabled)').in('id', [...new Set(due.map((d) => d.endpoint_id))]),
    svc.from('integration_events').select('id, event_id, entity_id, type, data, occurred_at').in('id', [...new Set(due.map((d) => d.event_id))]),
  ]);
  const epBy = new Map((eps ?? []).map((e) => [e.id, e]));
  const evBy = new Map((evs ?? []).map((e) => [e.id, e as EventRow]));
  let sent = 0;
  for (const d of due) {
    const ep = epBy.get(d.endpoint_id); const ev = evBy.get(d.event_id);
    const company = ep?.entities as unknown as { code: string; display_name: string; integrations_enabled: boolean } | undefined;
    if (!ep || !ev || !company) continue;
    // Paused endpoints and companies keep their deliveries waiting (they go out when switched back on).
    if (!ep.active || !company.integrations_enabled) { await svc.from('webhook_deliveries').update({ next_attempt_at: new Date(Date.now() + 10 * 60_000).toISOString() }).eq('id', d.id); continue; }
    // Claim it, so two workers never send the same delivery.
    const { data: claimed } = await svc.from('webhook_deliveries').update({ next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString() }).eq('id', d.id).eq('attempts', d.attempts).in('status', ['pending', 'failed']).select('id');
    if (!claimed?.length) continue;
    if (await deliver(svc, d, ep as unknown as Endpoint, ev, company, origin)) sent++;
  }
  return sent;
}

/** A sample event, straight away, to check an endpoint (not queued, not retried). */
export async function sendTest(svc: Svc, ep: Endpoint, company: { code: string; display_name: string }, origin: string) {
  const e: EventRow = { id: 0, event_id: crypto.randomUUID(), entity_id: ep.entity_id, type: 'test.ping', data: { message: 'A test from the Lakeba portal. If you can read this, the webhook works.' }, occurred_at: new Date().toISOString() };
  const payload = { ...payloadOf(e, company, ep.personal_data, origin), description: 'Test event' };
  const body = JSON.stringify(bodyFor(ep.format, payload));
  const res = await outbound('POST', ep.url, { body, headers: { 'content-type': 'application/json', 'lakeba-event': 'test.ping', 'lakeba-event-id': e.event_id, 'lakeba-signature': signature(open(ep.secret_enc), body) }, max: 2000 });
  return res.status;
}

/** Keeps events and deliveries for 30 days, idempotent answers for a day. */
export async function cleanupIntegrations(svc: Svc) {
  await svc.from('integration_events').delete().lt('occurred_at', new Date(Date.now() - 30 * 86_400_000).toISOString());
  await svc.from('api_idempotency').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString());
}
