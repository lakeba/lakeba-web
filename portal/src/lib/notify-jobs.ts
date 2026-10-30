import { serviceClient } from './admin';
import { memberIds, notifyAdmins, notifyMembers } from './notify';
import { CATEGORIES, DIGESTED } from './notification-events';
import { processOutbox, pushEnabled } from './push';
import { pollMailboxes, sendDueAutoReplies } from './shareholder-email';
import { requestWebsiteDeploy } from './news-cms';
import { sendQueued, startScheduled } from './newsletter';
import { publishDue } from './press';
import { sendQueuedPitches } from './press-outreach';
import { pollPressMailbox } from './press-inbox';
import { monitorJobs } from './press-coverage';
import { createSignInLink } from './sign-in-links';
import { cleanupIntegrations, deliverWebhooks } from './integrations/events';
import { syncConnections } from './integrations/worker';
import { processInbound } from './integrations/inbound';
import { legalReminders } from './legal';
import { reportingReminders } from './reporting';
import { hrJobs } from './hr';
import { kpiJobs } from './kpis';
import { deleteSignedAudio } from './observer';

// The notification worker inside the portal process: sends queued pushes and
// runs the scheduled notifications. Each scheduled job claims a key in
// notification_jobs first, so it runs once even across restarts.

type Svc = ReturnType<typeof serviceClient>;

// Emails sent by scheduled jobs need the portal's address: the last one it was
// reached on (not localhost), else production's.
let lastOrigin = 'https://investors.lakeba.com';
export function rememberOrigin(origin: string) {
  if (!/\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)) lastOrigin = origin;
}

async function claim(svc: Svc, key: string) {
  const { data } = await svc.from('notification_jobs').upsert({ key }, { onConflict: 'key', ignoreDuplicates: true }).select('key');
  return Boolean(data?.length);
}

const sydney = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));

/** "Proxy voting closes tomorrow", about 24 hours before the deadline, to those who haven't voted. */
export async function proxyReminders(now = new Date()) {
  const svc = serviceClient();
  const { data: meetings } = await svc.from('meetings').select('id, title, entity_id, proxy_deadline')
    .eq('status', 'open').gt('proxy_deadline', new Date(now.getTime() + 20 * 3600_000).toISOString()).lte('proxy_deadline', new Date(now.getTime() + 26 * 3600_000).toISOString());
  let sent = 0;
  for (const m of meetings ?? []) {
    if (!(await claim(svc, `proxy_reminder:${m.id}`))) continue;
    const { data: resolutions } = await svc.from('resolutions').select('id').eq('meeting_id', m.id);
    const { data: voters } = resolutions?.length ? await svc.from('proxy_votes').select('lodged_by').in('resolution_id', resolutions.map((r) => r.id)) : { data: [] };
    const voted = new Set((voters ?? []).map((v) => v.lodged_by));
    const userIds = (await memberIds(m.entity_id ?? undefined)).filter((id) => !voted.has(id));
    if (!userIds.length) continue;
    sent += await notifyMembers({
      kind: 'proxy_reminder', entityId: m.entity_id ?? undefined, userIds, origin: lastOrigin, link: `/agm/${m.id}`, pushDetail: m.title,
      title: `Reminder: proxy voting for ${m.title} closes tomorrow`,
      body: 'If you haven’t lodged your proxy votes yet, there’s about a day left. It only takes a minute in the portal.',
    });
  }
  return sent;
}

/** Each morning (from 8am Sydney), how many proxy votes were lodged the day before, per meeting. */
export async function votesSummary(now = new Date(), { force = false } = {}) {
  const t = sydney(now);
  if (!force && Number(t.hour) < 8) return 0;
  const svc = serviceClient();
  // A manual run (Admin → Notifications) doesn't use up the day's automatic summary.
  if (!(await claim(svc, force ? `votes_summary:manual:${now.toISOString()}` : `votes_summary:${t.year}-${t.month}-${t.day}`))) return 0;
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const { data: votes } = await svc.from('proxy_votes').select('holder_id, lodged_at, resolutions!inner(meeting_id, meetings!inner(id, title, entity_id))').gte('lodged_at', since);
  const perMeeting = new Map<string, { title: string; entityId: string | null; holders: Set<string> }>();
  for (const v of votes ?? []) {
    const m = (v.resolutions as unknown as { meetings: { id: string; title: string; entity_id: string | null } }).meetings;
    const entry = perMeeting.get(m.id) ?? { title: m.title, entityId: m.entity_id, holders: new Set<string>() };
    entry.holders.add(v.holder_id);
    perMeeting.set(m.id, entry);
  }
  let sent = 0;
  for (const [id, m] of perMeeting) {
    const n = m.holders.size;
    sent += await notifyAdmins({
      kind: 'admin_votes_summary', entityId: m.entityId, origin: lastOrigin, link: `/admin/agm/${id}`,
      title: `Proxy votes in the last day: ${n} holder${n === 1 ? '' : 's'} for ${m.title}`,
      body: `${n} holder${n === 1 ? '' : 's'} lodged or changed proxy votes for ${m.title} in the last 24 hours. See the tally in Admin → Meetings.`,
      pushDetail: `${n} holder${n === 1 ? '' : 's'} voted · ${m.title}`,
    });
  }
  return sent;
}

/** Monday from 8am Sydney: one email per person on the digest, with the week's updates from their Inbox. */
export async function weeklyDigest(now = new Date(), { force = false } = {}) {
  const t = sydney(now);
  const monday = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short' }).format(now) === 'Mon';
  if (!force && (!monday || Number(t.hour) < 8)) return 0;
  const svc = serviceClient();
  if (!(await claim(svc, force ? `digest:manual:${now.toISOString()}` : `digest:${t.year}-${t.month}-${t.day}`))) return 0;
  const { data: subscribers } = await svc.from('notification_preferences').select('user_id').eq('category', 'digest').eq('email', true);
  const kinds = CATEGORIES.filter((c) => DIGESTED.includes(c.key)).flatMap((c) => c.kinds);
  const since = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
  let sent = 0;
  for (const { user_id } of subscribers ?? []) {
    const { data: items } = await svc.from('notifications').select('title, created_at').eq('user_id', user_id).in('kind', kinds).gte('created_at', since).order('created_at');
    if (!items?.length) continue;
    const lines = items.slice(0, 25).map((i) => `• ${i.title}`).join('\n') + (items.length > 25 ? `\n• …and ${items.length - 25} more` : '');
    await notifyMembers({
      kind: 'digest', userIds: [user_id], origin: lastOrigin, link: '/inbox', inbox: false,
      title: `Your week at Lakeba: ${items.length} update${items.length === 1 ? '' : 's'}`,
      body: `Here’s what was new for you in the investor portal this week:\n\n${lines}`,
    });
    sent++;
  }
  return sent;
}

/**
 * News: tells shareholders about posts whose scheduled time has come, and
 * rebuilds the public website two minutes after public news last changed (so a
 * burst of edits makes one rebuild). Scheduled public posts count as a change
 * when their time comes.
 */
export async function newsJobs(now = new Date()) {
  const svc = serviceClient();
  await publishDue(svc); // approved press releases whose time has come
  const { data: due } = await svc.from('posts').select('id, entity_id, title, excerpt, slug').eq('notify_on_publish', true).is('notified_at', null).lte('published_at', now.toISOString());
  for (const p of due ?? []) {
    const { data: claimed } = await svc.from('posts').update({ notified_at: now.toISOString() }).eq('id', p.id).is('notified_at', null).select('id');
    if (!claimed?.length) continue;
    await svc.from('audit_log').insert({ action: 'news_published', detail: { post_id: p.id, slug: p.slug, title: p.title } });
    await notifyMembers({ kind: 'news', entityId: p.entity_id, title: p.title, body: p.excerpt || 'A new update is available in the investor portal.', link: `/news/${p.slug}`, origin: lastOrigin, pushDetail: p.title });
  }

  const { data: row } = await svc.from('portal_settings').select('value').eq('key', 'website_sync').maybeSingle();
  const sync = (row?.value ?? {}) as { changed_at?: string | null; requested_at?: string | null; error?: string | null };
  let changed = sync.changed_at ?? null;
  const since = sync.requested_at ?? '1970-01-01T00:00:00Z';
  const { data: scheduled } = await svc.from('posts').select('published_at').eq('visibility', 'public').eq('on_lakeba_site', true).gt('published_at', since).lte('published_at', now.toISOString()).order('published_at', { ascending: false }).limit(1);
  const went = scheduled?.[0]?.published_at;
  if (went && (!changed || went > changed)) changed = went;
  if (!changed || (sync.requested_at && changed <= sync.requested_at)) return;
  if (now.getTime() - new Date(changed).getTime() < 120_000) return;
  const problem = await requestWebsiteDeploy();
  if (problem === 'no GitHub token') return; // admins rebuild by hand; the page says so
  await svc.from('portal_settings').upsert({ key: 'website_sync', value: { ...sync, changed_at: changed, requested_at: problem ? sync.requested_at ?? null : now.toISOString(), error: problem }, updated_at: now.toISOString() });
  if (problem) console.error('website rebuild', problem);
}

/** Newsletters: scheduled issues start, and queued copies go out a few at a time (about 20 a minute). */
async function newsletterJobs() {
  const svc = serviceClient();
  await startScheduled(svc, lastOrigin, (userId) => createSignInLink(svc, { userId, origin: lastOrigin, next: '/?from=newsletter', hours: 24 * 14 }));
  await sendQueued(svc, lastOrigin);
}

/** Keeps the delivery log to 30 days. */
async function cleanup(now = new Date()) {
  const svc = serviceClient();
  const t = sydney(now);
  if (!(await claim(svc, `cleanup:${t.year}-${t.month}-${t.day}`))) return;
  const before = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();
  await svc.from('notification_outbox').delete().lt('created_at', before);
  await svc.from('notification_jobs').delete().lt('ran_at', before);
  // Ask Lakeba conversations are kept for 12 months (people can reopen them on the Ask page).
  const year = new Date(now.getTime() - 365 * 24 * 3600_000).toISOString();
  await svc.from('ask_exchanges').delete().lt('created_at', year);
  await cleanupIntegrations(svc);
}

declare global { var __lakebaNotifyWorker: ReturnType<typeof setInterval> | undefined }

/** Starts once per process: pushes every 15 seconds (retries), scheduled jobs every 10 minutes. */
export function startNotificationWorker() {
  if (globalThis.__lakebaNotifyWorker) return;
  let ticks = 0;
  const run = async () => {
    try {
      if (pushEnabled()) await processOutbox();
      if (ticks % 4 === 0) { await pollMailboxes(lastOrigin); await pollPressMailbox(serviceClient(), lastOrigin); await newsJobs(); await monitorJobs(serviceClient()); await syncConnections(lastOrigin); } // mailboxes (shareholders@, press@) and news, every minute
      await sendDueAutoReplies(lastOrigin); // automatic replies whose 5-minute undo window has passed
      await newsletterJobs();
      await sendQueuedPitches(serviceClient(), lastOrigin); // press pitches to journalists, a few at a time
      await deliverWebhooks(lastOrigin); // integrations: outgoing webhooks that are due
      await processInbound(lastOrigin); // integrations: incoming webhooks just received
      if (ticks++ % 40 === 0) { await proxyReminders(); await votesSummary(); await weeklyDigest(); await legalReminders(serviceClient(), lastOrigin); await reportingReminders(serviceClient(), lastOrigin); await hrJobs(serviceClient(), lastOrigin); await kpiJobs(serviceClient(), lastOrigin).catch((e) => console.error('kpi jobs', e)); await deleteSignedAudio(serviceClient()).catch((e) => console.error('observer audio', e)); await cleanup(); }
    } catch (e) {
      console.error('notification worker', (e as Error).message);
    }
  };
  // unref: never keeps a process (e.g. a build) alive on its own.
  globalThis.__lakebaNotifyWorker = setInterval(run, 15_000);
  globalThis.__lakebaNotifyWorker.unref?.();
  setTimeout(run, 5_000).unref?.();
}
