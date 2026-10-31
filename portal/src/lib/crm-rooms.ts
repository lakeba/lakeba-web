import { createHash, randomBytes } from 'node:crypto';
import type { serviceClient } from './admin';
import { open, seal } from './secret-box';
import { logActivity } from './crm';

// Deal rooms (CRM → a deal → Deal room): one private link per deal for the buyer, no account needed. It shows
// the quote to accept, the files the salesperson put there and a box for questions; every visit and download
// lands on the deal's timeline. The link works for 90 days and can be switched off at any time.

type Svc = ReturnType<typeof serviceClient>;
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export type Room = { id: string; entity_id: string; deal_id: string; token_sealed: string; message: string; expires_at: string; revoked_at: string | null; last_viewed_at: string | null; views: number; created_at: string };

export async function roomOf(svc: Svc, dealId: string) {
  const { data } = await svc.from('crm_rooms').select('id, entity_id, deal_id, token_sealed, message, expires_at, revoked_at, last_viewed_at, views, created_at').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data as Room | null) ?? null;
}
export const roomLink = (origin: string, r: Pick<Room, 'token_sealed'>) => `${origin}/deal/${open(r.token_sealed)}`;
export const roomLive = (r: Room | null) => Boolean(r && !r.revoked_at && Date.parse(r.expires_at) > Date.now());

/** The deal's room (made now if it has none, or a fresh link when the old one was switched off or ran out). */
export async function ensureRoom(svc: Svc, deal: { id: string; entity_id: string }, by: string) {
  const r = await roomOf(svc, deal.id);
  if (r && roomLive(r)) return r;
  const token = randomBytes(24).toString('base64url');
  const { data } = await svc.from('crm_rooms').insert({ entity_id: deal.entity_id, deal_id: deal.id, token_hash: hashToken(token), token_sealed: seal(token), expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(), created_by: by })
    .select('id, entity_id, deal_id, token_sealed, message, expires_at, revoked_at, last_viewed_at, views, created_at').single().throwOnError();
  // Files of an earlier room come along.
  if (r) await svc.from('crm_room_files').update({ room_id: data!.id }).eq('room_id', r.id);
  return data as Room;
}

/** The room a buyer's link opens (null when it's wrong, switched off or out of date). */
export async function roomForToken(svc: Svc, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data } = await svc.from('crm_rooms').select('id, entity_id, deal_id, token_sealed, message, expires_at, revoked_at, last_viewed_at, views, created_at').eq('token_hash', hashToken(token)).maybeSingle();
  const r = (data as Room | null) ?? null;
  return roomLive(r) ? r : null;
}

/** A buyer's visit: counted, and on the timeline at most once an hour (downloads always). */
export async function recordVisit(svc: Svc, r: Room, what: { kind: 'view' | 'download' | 'question' | 'accept'; detail?: string; ip?: string }) {
  const now = new Date();
  if (what.kind === 'view') {
    const recent = r.last_viewed_at && now.getTime() - Date.parse(r.last_viewed_at) < 3_600_000;
    await svc.from('crm_rooms').update({ views: r.views + 1, last_viewed_at: now.toISOString() }).eq('id', r.id);
    if (recent) return;
  }
  const subject = what.kind === 'view' ? 'Deal room opened' : what.kind === 'download' ? `Downloaded: ${what.detail}` : what.kind === 'question' ? 'A question in the deal room' : `Accepted ${what.detail}`;
  await logActivity(svc, { entity_id: r.entity_id, kind: 'room', direction: 'in', deal_id: r.deal_id, subject, body: what.kind === 'question' ? what.detail ?? '' : '', meta: { ip: what.ip ?? null } });
}
