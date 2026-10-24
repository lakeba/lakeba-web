import type { serviceClient } from './admin';

type Svc = ReturnType<typeof serviceClient>;

// Secondary trading board (see the secondary_trading migration). Interests are
// non-binding; admins pair sellers with buyers and complete the transfer.

export type TradingSettings = { entity_id: string; enabled: boolean; window_opens: string | null; window_closes: string | null; rules: string; show_book: boolean };
export type Interest = { id: string; entity_id: string; share_class_id: string; holder_id: string; user_id: string | null; side: 'buy' | 'sell'; shares: number; price: number; note: string; status: string; created_at: string };
export type Match = { id: string; sell_id: string; buy_id: string; shares: number; price: number; status: string; share_class_id: string; created_at: string; completed_on: string | null; admin_note: string };

/** Classes people can trade: shares, not options, notes or SAFEs. */
export const TRADABLE_KINDS = ['ordinary', 'preference'];
export const LIVE = ['open', 'matched'];

const cache = new Map<string, { at: number; on: boolean }>();
/** Whether a company's trading board is switched on (cached for a minute; cleared when an admin saves). */
export async function tradingEnabled(svc: Svc, entityId: string) {
  const hit = cache.get(entityId);
  if (hit && Date.now() - hit.at < 60_000) return hit.on;
  const { data } = await svc.from('trading_settings').select('enabled').eq('entity_id', entityId).maybeSingle();
  cache.set(entityId, { at: Date.now(), on: Boolean(data?.enabled) });
  return Boolean(data?.enabled);
}
export const forgetTradingSetting = (entityId: string) => cache.delete(entityId);

export async function tradingSettings(svc: Svc, entityId: string): Promise<TradingSettings> {
  const { data } = await svc.from('trading_settings').select('entity_id, enabled, window_opens, window_closes, rules, show_book').eq('entity_id', entityId).maybeSingle();
  return (data as TradingSettings | null) ?? { entity_id: entityId, enabled: false, window_opens: null, window_closes: null, rules: '', show_book: true };
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
/** 'open' when interests can be registered now; otherwise why not. */
export function windowState(s: TradingSettings): 'off' | 'before' | 'after' | 'open' {
  if (!s.enabled) return 'off';
  const t = today();
  if (s.window_opens && t < s.window_opens) return 'before';
  if (s.window_closes && t > s.window_closes) return 'after';
  return 'open';
}

/** Shares of each interest already paired (approved or completed matches) and completed. */
export function fills(matches: Match[]) {
  const paired = new Map<string, number>(), done = new Map<string, number>();
  for (const m of matches) {
    if (m.status === 'cancelled') continue;
    for (const id of [m.sell_id, m.buy_id]) {
      paired.set(id, (paired.get(id) ?? 0) + Number(m.shares));
      if (m.status === 'completed') done.set(id, (done.get(id) ?? 0) + Number(m.shares));
    }
  }
  return { paired, done, available: (i: Interest) => Math.max(0, Number(i.shares) - (paired.get(i.id) ?? 0)) };
}

export async function latestShares(svc: Svc, holderId: string, classId: string) {
  const { data } = await svc.from('holdings').select('shares').eq('holder_id', holderId).eq('share_class_id', classId).order('as_at', { ascending: false }).limit(1).maybeSingle();
  return Number(data?.shares ?? 0);
}

/** Shares a holder can still offer: what they hold minus live sell interests not yet completed. */
export async function sellable(svc: Svc, holderId: string, classId: string) {
  const [held, { data: live }] = await Promise.all([
    latestShares(svc, holderId, classId),
    svc.from('trade_interests').select('id, shares').eq('holder_id', holderId).eq('share_class_id', classId).eq('side', 'sell').in('status', LIVE),
  ]);
  if (!live?.length) return held;
  const { data: matches } = await svc.from('trade_matches').select('sell_id, buy_id, shares, status').in('sell_id', live.map((l) => l.id)).eq('status', 'completed');
  const done = new Map<string, number>();
  for (const m of matches ?? []) done.set(m.sell_id, (done.get(m.sell_id) ?? 0) + Number(m.shares));
  const committed = live.reduce((n, l) => n + Number(l.shares) - (done.get(l.id) ?? 0), 0);
  return Math.max(0, held - committed);
}

/** After matches change: open while shares remain, matched when all are paired, completed when all are done. */
export async function refreshStatus(svc: Svc, interestIds: string[]) {
  const { data: rows } = await svc.from('trade_interests').select('id, shares, status').in('id', interestIds);
  const { data: matches } = await svc.from('trade_matches').select('sell_id, buy_id, shares, status').or(`sell_id.in.(${interestIds.join(',')}),buy_id.in.(${interestIds.join(',')})`);
  const { paired, done } = fills((matches ?? []) as Match[]);
  for (const r of rows ?? []) {
    if (!LIVE.includes(r.status) && r.status !== 'completed') continue;
    const total = Number(r.shares);
    const status = (done.get(r.id) ?? 0) >= total ? 'completed' : (paired.get(r.id) ?? 0) >= total ? 'matched' : 'open';
    if (status !== r.status) await svc.from('trade_interests').update({ status, updated_at: new Date().toISOString() }).eq('id', r.id).throwOnError();
  }
}

/** Anonymous order book: shares available at each price, by side (best prices first). */
export function orderBook(interests: Interest[], matches: Match[]) {
  const { available } = fills(matches);
  const level = (side: 'buy' | 'sell') => {
    const m = new Map<number, { shares: number; count: number }>();
    for (const i of interests.filter((x) => x.side === side && x.status === 'open')) {
      const a = available(i);
      if (!a) continue;
      const k = Number(i.price);
      const e = m.get(k) ?? { shares: 0, count: 0 };
      m.set(k, { shares: e.shares + a, count: e.count + 1 });
    }
    return [...m].map(([price, v]) => ({ price, ...v })).sort((a, b) => (side === 'buy' ? b.price - a.price : a.price - b.price));
  };
  return { buy: level('buy'), sell: level('sell') };
}
