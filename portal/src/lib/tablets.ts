import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { AstroCookies } from 'astro';
import type { serviceClient } from './admin';

// Boardroom tablets (the Lex app, or a browser at /tablet): the tablet asks for
// a six-digit code and shows it; the company secretary enters it on the
// meeting's page; from then on the tablet reaches that meeting's Observer, and
// nothing else, acting for the secretary who connected it. The tablet keeps a
// random secret in a cookie; the portal keeps only hashes.

type Svc = ReturnType<typeof serviceClient>;
export const TABLET_COOKIE = 'lk_tablet';
const CODE_MINUTES = 5;
const PAIRED_HOURS = 12;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export type Tablet = { id: string; meeting_id: string | null; entity_id: string | null; paired_by: string | null; paired_at: string | null; expires_at: string | null; released_at: string | null; released_why: string | null; device_name: string; code_expires_at: string | null; last_seen_at: string | null };
const COLUMNS = 'id, meeting_id, entity_id, paired_by, paired_at, expires_at, released_at, released_why, device_name, code_expires_at, last_seen_at';

/** The pages and requests a connected tablet may reach: its meeting's Observer and what that page calls. */
export const TABLET_PATH = /^\/admin\/legal\/meetings\/([0-9a-f-]{36})\/(observe|observer|audio|lex|lex-voice|presenter|face)$/;

/** A new code for this tablet (a new tablet when it has no secret yet, or its old one was used). */
export async function startPairing(svc: Svc, cookies: AstroCookies, secure: boolean, deviceName: string) {
  let secret = cookies.get(TABLET_COOKIE)?.value ?? '';
  let tablet = secret ? await tabletOf(svc, secret) : null;
  // A tablet that was connected to a meeting starts afresh, with a new secret.
  if (!tablet || tablet.meeting_id) {
    secret = randomBytes(32).toString('base64url');
    const { data } = await svc.from('board_tablets').insert({ secret_hash: hash(secret), device_name: deviceName.slice(0, 80) }).select(COLUMNS).single().throwOnError();
    tablet = data as Tablet;
    cookies.set(TABLET_COOKIE, secret, { path: '/', httpOnly: true, secure, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
  }
  // A code nobody else is waiting with.
  for (let i = 0; i < 20; i++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const { count } = await svc.from('board_tablets').select('id', { count: 'exact', head: true }).eq('code_hash', hash(code)).is('meeting_id', null).gt('code_expires_at', new Date().toISOString());
    if (count) continue;
    const expires = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();
    await svc.from('board_tablets').update({ code_hash: hash(code), code_expires_at: expires, device_name: deviceName.slice(0, 80) || tablet.device_name, last_seen_at: new Date().toISOString() }).eq('id', tablet.id).throwOnError();
    return { code, expiresAt: expires };
  }
  throw new Error('Couldn’t make a code. Try again.');
}

export async function tabletOf(svc: Svc, secret: string) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(secret)) return null;
  const { data } = await svc.from('board_tablets').select(COLUMNS).eq('secret_hash', hash(secret)).maybeSingle();
  return (data as Tablet | null) ?? null;
}

/** Is this tablet connected now (connected, not let go, not past its 12 hours)? */
export const connected = (t: Tablet | null): t is Tablet & { meeting_id: string; paired_by: string } =>
  Boolean(t?.meeting_id && t.paired_by && !t.released_at && (!t.expires_at || Date.parse(t.expires_at) > Date.now()));

/** What the tablet's pairing screen shows next. */
export async function pairingState(svc: Svc, secret: string | undefined) {
  const t = secret ? await tabletOf(svc, secret) : null;
  if (!t) return { status: 'new' as const };
  await svc.from('board_tablets').update({ last_seen_at: new Date().toISOString() }).eq('id', t.id);
  if (connected(t)) {
    const { data: m } = await svc.from('board_meetings').select('id, title, recording_status, entities(display_name)').eq('id', t.meeting_id).maybeSingle();
    if (!m) return { status: 'released' as const, why: 'The meeting was deleted.' };
    if (['processing', 'done'].includes(m.recording_status as string)) {
      await releaseTablet(svc, t.id, 'The meeting is finished.');
      return { status: 'released' as const, why: 'The meeting is finished.' };
    }
    return { status: 'connected' as const, meeting: { id: m.id as string, title: m.title as string, company: (m.entities as unknown as { display_name: string }).display_name }, url: `/admin/legal/meetings/${m.id}/observe` };
  }
  if (t.released_at || t.meeting_id) return { status: 'released' as const, why: t.released_why ?? 'The tablet was disconnected.' };
  if (t.code_expires_at && Date.parse(t.code_expires_at) > Date.now()) return { status: 'waiting' as const, expiresAt: t.code_expires_at };
  return { status: 'expired' as const };
}

// Codes typed in the portal, per person: at most 10 wrong ones in 10 minutes.
const tries = new Map<string, number[]>();

/** The secretary enters a tablet's code on a meeting's page: the tablet is connected to that meeting. */
export async function connectTablet(svc: Svc, code: string, meeting: { id: string; entity_id: string }, userId: string) {
  const now = Date.now();
  const mine = (tries.get(userId) ?? []).filter((t) => now - t < 600_000);
  if (mine.length >= 10) throw new Error('Too many wrong codes. Wait a few minutes, then try the code the tablet shows now.');
  const digits = code.replace(/\D/g, '');
  const { data } = digits.length === 6 ? await svc.from('board_tablets').select(COLUMNS).eq('code_hash', hash(digits)).is('meeting_id', null).gt('code_expires_at', new Date().toISOString()).maybeSingle() : { data: null };
  if (!data) {
    tries.set(userId, [...mine, now]);
    throw new Error('That code isn’t showing on any tablet now. Check it, or press “New code” on the tablet.');
  }
  const t = data as Tablet;
  await svc.from('board_tablets').update({
    meeting_id: meeting.id, entity_id: meeting.entity_id, paired_by: userId, paired_at: new Date().toISOString(),
    expires_at: new Date(now + PAIRED_HOURS * 3_600_000).toISOString(), code_hash: null, code_expires_at: null,
  }).eq('id', t.id).is('meeting_id', null).throwOnError();
  return t;
}

export async function releaseTablet(svc: Svc, id: string, why: string) {
  await svc.from('board_tablets').update({ released_at: new Date().toISOString(), released_why: why }).eq('id', id).is('released_at', null);
}

/** The tablets connected to a meeting now, for its page. */
export async function tabletsOf(svc: Svc, meetingId: string) {
  const { data } = await svc.from('board_tablets').select(COLUMNS).eq('meeting_id', meetingId).is('released_at', null).gt('expires_at', new Date().toISOString()).order('paired_at');
  return (data ?? []) as Tablet[];
}

/** An audit entry for a request: the person's own session, or a tablet acting for the secretary who connected it. */
export async function logAs(locals: App.Locals, svc: Svc, action: string, detail: Record<string, unknown>) {
  if (locals.tablet) {
    await svc.from('audit_log').insert({ user_id: locals.user?.id ?? null, action, detail: { ...detail, via: 'tablet', tablet_id: locals.tablet.id } });
    return;
  }
  await locals.supabase.rpc('log_event', { event_action: action, event_detail: detail });
}
