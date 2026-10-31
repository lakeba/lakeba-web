import type { serviceClient } from './admin';
import { graph, type GraphMessage } from './graph';
import { getGmailMessage, gmail } from './gmail';
import { companyDomainOf, logActivity } from './crm';

// The salespeople's own mailboxes and calendars in the CRM (CRM → My mailbox): each person connects theirs, and
// every few minutes the CRM reads what's new in their Inbox and Sent Items. An email to or from someone the
// company's CRM knows lands on that person's timeline, their company's and their open deal's; nobody types it.
// An email from a business address that matches nobody goes to "Found in your inbox" (it may be a sale). Meetings
// with known people come from the Microsoft 365 calendar. Mailboxes are only read, never changed.

type Svc = ReturnType<typeof serviceClient>;
export type Mailbox = { id: string; entity_id: string; user_id: string; address: string; provider: 'microsoft' | 'google'; status: string; delta_inbox: string | null; delta_sent: string | null; last_sync_at: string | null; last_error: string | null };
type Msg = GraphMessage & { sentDateTime?: string };

const SELECT = 'id,internetMessageId,conversationId,subject,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,body,internetMessageHeaders';
const TEXT = 'outlook.body-content-type="text"';
const emailsOf = (m: Msg) => [m.from?.emailAddress?.address, ...(m.toRecipients ?? []).map((r) => r.emailAddress.address), ...(m.ccRecipients ?? []).map((r) => r.emailAddress.address)].filter(Boolean).map((e) => e!.toLowerCase());
/** The text of an email without the earlier messages quoted under it. */
export function cleanBody(text: string) {
  const cut = text.search(/\n(?:-{2,}\s*Original Message|From: .+\n(?:Sent|Date): |On .+wrote:|_{10,})/i);
  return (cut > 0 ? text.slice(0, cut) : text).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}
/** Newsletters, notifications and no-reply senders aren't sales. */
const automated = (m: Msg) => /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|newsletter|news|info|marketing|bounce)/i.test((m.from?.emailAddress?.address ?? '').split('@')[0]) || (m.internetMessageHeaders ?? []).some((h) => /^(list-unsubscribe|precedence)$/i.test(h.name) && !/^first-class$/i.test(h.value));

/** Whether the CRM can read this mailbox (and which way). */
export async function checkMailbox(address: string, provider: Mailbox['provider'], tenant?: string) {
  if (provider === 'google') await gmail(address, '/profile');
  else await graph(`/users/${encodeURIComponent(address)}/mailFolders/inbox?$select=id`, { tenant });
}

// ---------------------------------------------------------------------------
// Reading new mail
// ---------------------------------------------------------------------------
async function msDelta(address: string, folder: 'inbox' | 'sentitems', delta: string | null, tenant?: string) {
  const out: Msg[] = [];
  const first = !delta;
  let next: string | null = delta ?? `/users/${encodeURIComponent(address)}/mailFolders/${folder}/messages/delta?$select=${SELECT}`;
  let newDelta: string | null = null;
  while (next) {
    const page: { value: Msg[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string } = await graph(next, { prefer: `${TEXT}, odata.maxpagesize=50`, tenant });
    if (!first) out.push(...page.value.filter((m) => !m['@removed']));
    next = page['@odata.nextLink'] ?? null;
    newDelta = page['@odata.deltaLink'] ?? newDelta;
  }
  return { messages: out, delta: newDelta ?? delta };
}
async function gDelta(address: string, label: 'INBOX' | 'SENT', delta: string | null) {
  const position = async () => (await gmail<{ historyId: string }>(address, '/profile')).historyId;
  if (!delta) return { messages: [] as Msg[], delta: await position() };
  const ids: string[] = [];
  let next: string | undefined;
  let latest = delta;
  try {
    do {
      const page = await gmail<{ history?: { messagesAdded?: { message: { id: string } }[] }[]; historyId: string; nextPageToken?: string }>(address, `/history?startHistoryId=${encodeURIComponent(delta)}&historyTypes=messageAdded&labelId=${label}${next ? `&pageToken=${encodeURIComponent(next)}` : ''}`);
      for (const h of page.history ?? []) for (const a of h.messagesAdded ?? []) if (!ids.includes(a.message.id)) ids.push(a.message.id);
      latest = page.historyId ?? latest;
      next = page.nextPageToken;
    } while (next);
  } catch (e) {
    if ((e as { status?: number }).status === 404) return { messages: [], delta: await position() };
    throw e;
  }
  return { messages: await Promise.all(ids.slice(0, 200).map((id) => getGmailMessage(address, id))) as Msg[], delta: latest };
}

/** The last 30 days of a newly connected mailbox (Microsoft 365), so the timeline starts with history. */
async function msRecent(address: string, tenant?: string) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const out: Msg[] = [];
  let next: string | null = `/users/${encodeURIComponent(address)}/messages?$filter=receivedDateTime ge ${since}&$select=${SELECT}&$top=50&$orderby=receivedDateTime desc`;
  while (next && out.length < 500) {
    const page: { value: Msg[]; '@odata.nextLink'?: string } = await graph(next, { prefer: TEXT, tenant });
    out.push(...page.value);
    next = page['@odata.nextLink'] ?? null;
  }
  return out;
}

/** Files emails onto the CRM: known people's timelines, or "Found in your inbox". Returns how many were filed. */
export async function fileMessages(svc: Svc, box: Mailbox, messages: Msg[], teamEmails: Set<string>) {
  const own = box.address.split('@')[1];
  let filed = 0;
  for (const m of messages) {
    const from = m.from?.emailAddress?.address?.toLowerCase() ?? '';
    const out = from === box.address || teamEmails.has(from);
    const external = [...new Set(emailsOf(m))].filter((e) => e !== box.address && !teamEmails.has(e) && e.split('@')[1] !== own);
    if (!external.length) continue;
    const ref = `mail:${m.internetMessageId ?? m.id}`;
    const when = m.sentDateTime ?? m.receivedDateTime;
    const { data: people } = await svc.from('crm_people').select('id, company_id, email, other_emails').in('email', external).is('merged_into', null);
    const { data: rels } = (people ?? []).length ? await svc.from('crm_relationships').select('person_id').eq('entity_id', box.entity_id).in('person_id', (people ?? []).map((p) => p.id)) : { data: [] };
    const known = (people ?? []).filter((p) => (rels ?? []).some((r) => r.person_id === p.id));
    if (known.length) {
      for (const p of known) {
        // Their latest open deal (as the main contact or in the buying group).
        const { data: dp } = await svc.from('crm_deal_people').select('deal_id').eq('person_id', p.id);
        const { data: deal } = await svc.from('crm_deals').select('id').eq('entity_id', box.entity_id).eq('status', 'open').or(`person_id.eq.${p.id},id.in.(${(dp ?? []).map((x) => x.deal_id).join(',') || '00000000-0000-0000-0000-000000000000'})`).order('updated_at', { ascending: false }).limit(1).maybeSingle();
        const id = await logActivity(svc, {
          entity_id: box.entity_id, kind: 'email', direction: out ? 'out' : 'in', subject: m.subject ?? '(no subject)', body: cleanBody(m.body?.content ?? ''),
          person_id: p.id, company_id: p.company_id, deal_id: deal?.id ?? null, source_ref: known.length > 1 ? `${ref}:${p.id}` : ref, occurred_at: when, created_by: box.user_id,
          meta: { from, to: (m.toRecipients ?? []).map((r) => r.emailAddress.address), mailbox: box.address, conversation: m.conversationId ?? null },
        });
        if (id) filed++;
      }
    } else if (!out && !automated(m) && companyDomainOf(from)) {
      // Someone from a business wrote and nobody knows them yet: maybe a sale.
      await svc.from('crm_inbox').upsert({
        entity_id: box.entity_id, user_id: box.user_id, message_ref: ref, from_email: from, from_name: m.from?.emailAddress?.name ?? '', subject: (m.subject ?? '').slice(0, 300),
        snippet: cleanBody(m.body?.content ?? '').slice(0, 600), received_at: when,
      }, { onConflict: 'entity_id,message_ref', ignoreDuplicates: true });
    }
  }
  return filed;
}

/** Meetings in the next week (and yesterday's) with people the CRM knows, from the Microsoft 365 calendar. */
async function syncCalendar(svc: Svc, box: Mailbox, tenant: string | undefined, teamEmails: Set<string>) {
  type Ev = { id: string; subject?: string; isCancelled?: boolean; start: { dateTime: string; timeZone: string }; end: { dateTime: string }; attendees?: { emailAddress: { address: string; name?: string } }[]; onlineMeeting?: { joinUrl?: string } | null; bodyPreview?: string };
  const from = new Date(Date.now() - 86_400_000).toISOString(), to = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const res = await graph<{ value: Ev[] }>(`/users/${encodeURIComponent(box.address)}/calendarView?startDateTime=${from}&endDateTime=${to}&$select=id,subject,isCancelled,start,end,attendees,onlineMeeting,bodyPreview&$top=100`, { prefer: 'outlook.timezone="UTC"', tenant });
  const own = box.address.split('@')[1];
  for (const ev of res.value ?? []) {
    if (ev.isCancelled) continue;
    const ext = (ev.attendees ?? []).map((a) => a.emailAddress.address.toLowerCase()).filter((e) => e.split('@')[1] !== own && !teamEmails.has(e));
    if (!ext.length) continue;
    const { data: people } = await svc.from('crm_people').select('id, company_id').in('email', ext).is('merged_into', null);
    const { data: rels } = (people ?? []).length ? await svc.from('crm_relationships').select('person_id').eq('entity_id', box.entity_id).in('person_id', (people ?? []).map((p) => p.id)) : { data: [] };
    const p = (people ?? []).find((x) => (rels ?? []).some((r) => r.person_id === x.id));
    if (!p) continue;
    const { data: deal } = await svc.from('crm_deals').select('id').eq('entity_id', box.entity_id).eq('status', 'open').eq('company_id', p.company_id ?? '00000000-0000-0000-0000-000000000000').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    await logActivity(svc, {
      entity_id: box.entity_id, kind: 'meeting', subject: ev.subject ?? 'Meeting', body: (ev.bodyPreview ?? '').slice(0, 1000), person_id: p.id, company_id: p.company_id, deal_id: deal?.id ?? null,
      source_ref: `cal:${ev.id}`, occurred_at: `${ev.start.dateTime.replace(/Z?$/, 'Z')}`, created_by: box.user_id,
      meta: { user: box.user_id, end: `${ev.end.dateTime.replace(/Z?$/, 'Z')}`, attendees: ext, join_url: ev.onlineMeeting?.joinUrl ?? null },
    });
  }
}

/** Reads every connected mailbox (the CRM's jobs, every few minutes). */
export async function syncMailboxes(svc: Svc) {
  const { data } = await svc.from('crm_mailboxes').select('*, entities(ms_tenant_id, crm_enabled)').eq('status', 'connected');
  const boxes = (data ?? []) as (Mailbox & { entities: { ms_tenant_id: string | null; crm_enabled: boolean } | null })[];
  for (const box of boxes) {
    if (!box.entities?.crm_enabled) continue;
    try {
      const tenant = box.entities.ms_tenant_id ?? undefined;
      const { data: team } = await svc.from('crm_mailboxes').select('address').eq('entity_id', box.entity_id);
      const teamEmails = new Set((team ?? []).map((t) => t.address as string));
      const first = !box.delta_inbox && !box.delta_sent;
      const [inbox, sent] = box.provider === 'google'
        ? [await gDelta(box.address, 'INBOX', box.delta_inbox), await gDelta(box.address, 'SENT', box.delta_sent)]
        : [await msDelta(box.address, 'inbox', box.delta_inbox, tenant), await msDelta(box.address, 'sentitems', box.delta_sent, tenant)];
      const recent = first && box.provider === 'microsoft' ? await msRecent(box.address, tenant).catch(() => []) : [];
      await fileMessages(svc, box, [...recent, ...inbox.messages, ...sent.messages], teamEmails);
      if (box.provider === 'microsoft') await syncCalendar(svc, box, tenant, teamEmails).catch(() => null);
      await svc.from('crm_mailboxes').update({ delta_inbox: inbox.delta, delta_sent: sent.delta, last_sync_at: new Date().toISOString(), last_error: null }).eq('id', box.id);
    } catch (e) {
      await svc.from('crm_mailboxes').update({ last_error: (e as Error).message.slice(0, 500), last_sync_at: new Date().toISOString() }).eq('id', box.id);
    }
  }
}
