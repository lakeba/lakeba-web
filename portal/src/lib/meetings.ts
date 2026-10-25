/**
 * Where a meeting stands, the same everywhere (dashboard, Meetings list,
 * meeting page): proxies can be lodged while it is upcoming or open and the
 * proxy deadline hasn't passed; then voting is closed until results.
 */
export type MeetingLike = { status: string; starts_at: string; proxy_deadline: string };
export type MeetingPhase = 'voting' | 'proxy-closed' | 'held' | 'results';

export function meetingPhase(m: MeetingLike, now = new Date()): MeetingPhase {
  if (m.status === 'results') return 'results';
  if (m.status === 'closed' || new Date(m.starts_at) < now) return 'held';
  if (new Date(m.proxy_deadline) <= now) return 'proxy-closed';
  return 'voting';
}

/** The badge in the Meetings list. */
export const PHASE_LABEL: Record<MeetingPhase, string> = { voting: 'Proxy voting open', 'proxy-closed': 'Proxy voting closed', held: 'Voting closed', results: 'Results available' };

/** Upcoming meetings first (soonest first), then past ones (latest first). */
export function meetingOrder<T extends MeetingLike>(list: T[], now = new Date()) {
  const ahead = list.filter((m) => new Date(m.starts_at) >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = list.filter((m) => new Date(m.starts_at) < now).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return [...ahead, ...past];
}
