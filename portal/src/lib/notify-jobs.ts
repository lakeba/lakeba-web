import { serviceClient } from './admin';
import { memberIds, notifyAdmins, notifyMembers } from './notify';
import { processOutbox, pushEnabled } from './push';
import { pollMailboxes, sendDueAutoReplies } from './shareholder-email';

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

/** Keeps the delivery log to 30 days. */
async function cleanup(now = new Date()) {
  const svc = serviceClient();
  const t = sydney(now);
  if (!(await claim(svc, `cleanup:${t.year}-${t.month}-${t.day}`))) return;
  const before = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();
  await svc.from('notification_outbox').delete().lt('created_at', before);
  await svc.from('notification_jobs').delete().lt('ran_at', before);
}

declare global { var __lakebaNotifyWorker: ReturnType<typeof setInterval> | undefined }

/** Starts once per process: pushes every 15 seconds (retries), scheduled jobs every 10 minutes. */
export function startNotificationWorker() {
  if (globalThis.__lakebaNotifyWorker) return;
  let ticks = 0;
  const run = async () => {
    try {
      if (pushEnabled()) await processOutbox();
      if (ticks % 4 === 0) await pollMailboxes(lastOrigin); // shareholder mailboxes, every minute
      await sendDueAutoReplies(lastOrigin); // automatic replies whose 5-minute undo window has passed
      if (ticks++ % 40 === 0) { await proxyReminders(); await votesSummary(); await cleanup(); }
    } catch (e) {
      console.error('notification worker', (e as Error).message);
    }
  };
  // unref: never keeps a process (e.g. a build) alive on its own.
  globalThis.__lakebaNotifyWorker = setInterval(run, 15_000);
  globalThis.__lakebaNotifyWorker.unref?.();
  setTimeout(run, 5_000).unref?.();
}
