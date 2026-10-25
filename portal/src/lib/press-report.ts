import type { serviceClient } from './admin';
import type { Coverage } from './press-coverage';

type Svc = ReturnType<typeof serviceClient>;

// Numbers for the press reports: per release, and for a period (e.g. a quarter for the board).

export type ReleaseStats = {
  pitches: number; opened: number; read: number; replied: number; bounced: number; unsubscribed: number;
  coverage: Coverage[]; toReview: number; outlets: string[]; tone: Record<string, number>;
  social: { channel: string; url: string; posted_at: string }[]; wires: { target: string; url: string; cost: number | null; currency: string; posted_at: string }[];
  cost: Map<string, number>;
};

export async function releaseStats(svc: Svc, releaseIds: string[]): Promise<Map<string, ReleaseStats>> {
  const out = new Map<string, ReleaseStats>();
  if (!releaseIds.length) return out;
  const [{ data: dists }, { data: cov }, { data: chans }] = await Promise.all([
    svc.from('press_distributions').select('id, release_id').in('release_id', releaseIds),
    svc.from('press_coverage').select('*').in('release_id', releaseIds).neq('status', 'dismissed'),
    svc.from('press_channel_posts').select('release_id, channel, target, url, cost, currency, status, posted_at').in('release_id', releaseIds).neq('status', 'failed'),
  ]);
  const distIds = (dists ?? []).map((d) => d.id);
  const { data: pitches } = distIds.length ? await svc.from('press_pitches').select('distribution_id, status, opened_at, previewed_at, clicked_at, replied_at, bounced_at, unsubscribed_at').in('distribution_id', distIds).eq('status', 'sent') : { data: [] };
  for (const id of releaseIds) {
    const mine = new Set((dists ?? []).filter((d) => d.release_id === id).map((d) => d.id));
    const ps = (pitches ?? []).filter((p) => mine.has(p.distribution_id));
    const c = ((cov ?? []) as Coverage[]).filter((x) => x.release_id === id);
    const confirmed = c.filter((x) => x.status === 'confirmed');
    const ch = (chans ?? []).filter((x) => x.release_id === id);
    const cost = new Map<string, number>();
    for (const x of ch) if (x.cost) cost.set(x.currency, (cost.get(x.currency) ?? 0) + Number(x.cost));
    out.set(id, {
      pitches: ps.length, opened: ps.filter((p) => p.opened_at).length, read: ps.filter((p) => p.previewed_at || p.clicked_at).length, replied: ps.filter((p) => p.replied_at).length,
      bounced: ps.filter((p) => p.bounced_at).length, unsubscribed: ps.filter((p) => p.unsubscribed_at).length,
      coverage: confirmed.sort((a, b) => (b.published_at ?? b.found_at).localeCompare(a.published_at ?? a.found_at)), toReview: c.filter((x) => x.status === 'new').length,
      outlets: [...new Set(confirmed.map((x) => x.outlet || x.domain))], tone: Object.fromEntries(['positive', 'neutral', 'negative', 'mixed'].map((t) => [t, confirmed.filter((x) => x.sentiment === t).length])),
      social: ch.filter((x) => x.channel !== 'wire').map((x) => ({ channel: x.channel, url: x.url, posted_at: x.posted_at })),
      wires: ch.filter((x) => x.channel === 'wire').map((x) => ({ target: x.target, url: x.url, cost: x.cost === null ? null : Number(x.cost), currency: x.currency, posted_at: x.posted_at })),
      cost,
    });
  }
  return out;
}

export const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '–');
const cell = (v: unknown) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
/** Coverage as CSV (formulas neutralised for spreadsheets). */
export const coverageCsv = (rows: (Coverage & { release?: string })[]) => [
  ['Date', 'Outlet', 'Title', 'Link', 'Release', 'Tone', 'Summary', 'Found by'].join(','),
  ...rows.map((c) => [c.published_at?.slice(0, 10) ?? c.found_at.slice(0, 10), c.outlet || c.domain, c.title, c.url, c.release ?? '', c.sentiment, c.summary, c.source].map((v) => `"${cell(v).replace(/"/g, '""')}"`).join(',')),
].join('\n');
