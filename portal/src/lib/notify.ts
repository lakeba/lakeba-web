import { serviceClient } from './admin';
import { sendMail } from './mail';
import { BRAND_COLUMNS, brandOf } from './brand';
import { DIGESTED, categoryOf, pushText } from './notification-events';
import { preferences, queuePush } from './push';
import { createSignInLink } from './sign-in-links';

/** How long the one-time buttons in notification emails work. */
const NOTIFY_LINK_HOURS = 72;

type Svc = ReturnType<typeof serviceClient>;

/**
 * Everyone the portal notifies by default for a company: people linked to a
 * holder with shares in it, plus its board. Without a company: every member
 * of every company (shareholders and the group board).
 */
export async function memberIds(entityId?: string) {
  const svc = serviceClient();
  if (!entityId) {
    const [{ data: members }, { data: board }, { data: boards }] = await Promise.all([
      svc.from('holder_members').select('user_id'),
      svc.from('profiles').select('id').eq('role', 'board'),
      svc.from('entity_board').select('user_id'),
    ]);
    return [...new Set([...(members ?? []).map((m) => m.user_id), ...(board ?? []).map((b) => b.id), ...(boards ?? []).map((b) => b.user_id)])];
  }
  const [{ data: entity }, { data: classes }, { data: boards }] = await Promise.all([
    svc.from('entities').select('relationship').eq('id', entityId).single(),
    svc.from('share_classes').select('id').eq('entity_id', entityId),
    svc.from('entity_board').select('user_id, ends_on').eq('entity_id', entityId),
  ]);
  const holderIds = new Set<string>();
  const classIds = (classes ?? []).map((c) => c.id);
  for (let from = 0; classIds.length; from += 1000) {
    const { data } = await svc.from('holdings').select('holder_id').in('share_class_id', classIds).range(from, from + 999);
    for (const h of data ?? []) holderIds.add(h.holder_id);
    if ((data ?? []).length < 1000) break;
  }
  const { data: members } = holderIds.size ? await svc.from('holder_members').select('user_id').in('holder_id', [...holderIds]) : { data: [] };
  const groupBoard = entity?.relationship === 'group' ? (await svc.from('profiles').select('id').eq('role', 'board')).data ?? [] : [];
  const today = new Date().toISOString().slice(0, 10);
  return [...new Set([
    ...(members ?? []).map((m) => m.user_id),
    ...(boards ?? []).filter((b) => !b.ends_on || b.ends_on >= today).map((b) => b.user_id),
    ...groupBoard.map((b) => b.id),
  ])];
}

async function companyOf(svc: Svc, entityId?: string) {
  if (!entityId) return null;
  const { data } = await svc.from('entities').select(BRAND_COLUMNS).eq('id', entityId).single();
  return data;
}

/**
 * Tells a company's members (or the given users) about something new: an
 * Inbox entry for each, plus an email and a browser notification for those
 * who chose them for this kind (Profile → Notifications).
 * With entityId, links open the portal on that company and emails carry its
 * name. `emailLink` lets the email carry a different link (e.g. a tracked one).
 * `pushDetail` is a public line for the browser notification (e.g. a document
 * title); push texts are otherwise generic, as they can show on a locked screen.
 */
export async function notifyMembers({ title, body, link, kind, userIds, origin, emailLink, email = true, entityId, pushDetail, inbox = true }: {
  title: string; body: string; link: string; kind: string; userIds?: string[]; origin: string; emailLink?: string; email?: boolean; entityId?: string; pushDetail?: string; inbox?: boolean;
}) {
  const svc = serviceClient();
  const recipients = userIds ?? (await memberIds(entityId));
  if (!recipients.length) return 0;
  const company = await companyOf(svc, entityId);
  // Open the portal on the right company first (tracked /go/ links work signed out, so they stay as they are).
  const via = (href: string) => (company && href.startsWith('/') && !href.startsWith('/go/') ? `/company/${company.code}?next=${encodeURIComponent(href)}` : href);
  const brand = brandOf(company);

  if (inbox) await svc.from('notifications').insert(recipients.map((user_id) => ({ user_id, kind, title, body, link: via(link), entity_id: entityId ?? null }))).throwOnError();
  if (!categoryOf(kind)?.emailOnly) await queuePush(svc, recipients, kind, { ...pushText(kind, brand.name, pushDetail), url: via(link), tag: kind });
  if (!email) return recipients.length;
  const category = categoryOf(kind);
  const prefs = category ? await preferences(svc, recipients, category.key) : null;
  let emailTo = recipients.filter((id) => !prefs || prefs.get(id)?.email);
  // People on the weekly digest get these in Monday's email instead.
  if (category && DIGESTED.includes(category.key) && emailTo.length) {
    const digest = await preferences(svc, emailTo, 'digest');
    emailTo = emailTo.filter((id) => !digest.get(id)?.email);
  }
  if (!emailTo.length) return recipients.length;
  const { data: profiles } = await svc.from('profiles').select('id, email').in('id', emailTo);
  // A personal one-time button that signs them in and opens it (not for tracked links, security or admin emails).
  const personal = !emailLink && link.startsWith('/') && category?.audience === 'investor' && !category.locked;
  await Promise.allSettled(
    (profiles ?? []).map(async (p) => sendMail({
      to: p.email, subject: title, brand,
      text: personal ? `${body}\n\nThe button below signs you in once, within ${NOTIFY_LINK_HOURS / 24} days, and only for you.` : body,
      link: personal ? await createSignInLink(svc, { userId: p.id, origin, next: via(link), hours: NOTIFY_LINK_HOURS }) : new URL(via(emailLink ?? link), origin).href,
      linkLabel: personal ? 'Open in the portal' : undefined,
    })),
  );
  return recipients.length;
}

/** Group admins, plus the company admins of entityId when given. */
export async function adminIds(entityId?: string | null) {
  const svc = serviceClient();
  const [{ data: admins }, { data: companyAdmins }] = await Promise.all([
    svc.from('profiles').select('id').eq('role', 'admin'),
    entityId ? svc.from('entity_admins').select('user_id').eq('entity_id', entityId) : Promise.resolve({ data: [] as { user_id: string }[] }),
  ]);
  return [...new Set([...(admins ?? []).map((a) => a.id), ...(companyAdmins ?? []).map((a) => a.user_id)])];
}

/** Staff with one of these permissions for this company (group roles count for every company), now. */
export async function staffIds(permissions: string[], entityId: string | null) {
  const svc = serviceClient();
  const { data: perms } = await svc.from('role_permissions').select('role_key').in('permission', permissions);
  const keys = [...new Set(['admin', ...(perms ?? []).map((p) => p.role_key)])];
  let q = svc.from('user_roles').select('user_id').in('role_key', keys).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  q = entityId ? q.or(`entity_id.is.null,entity_id.eq.${entityId}`) : q.is('entity_id', null);
  const { data } = await q;
  return [...new Set((data ?? []).map((r) => r.user_id as string))];
}

/** Tells admins (and that company's admins) about something investors did. Never throws: it must not break the investor's action. */
export async function notifyAdmins({ kind, title, body, link, origin, entityId, pushDetail }: {
  kind: string; title: string; body: string; link: string; origin: string; entityId?: string | null; pushDetail?: string;
}) {
  try {
    const userIds = await adminIds(entityId);
    return await notifyMembers({ kind, title, body, link, origin, userIds, pushDetail });
  } catch (e) {
    console.error('notifyAdmins failed', kind, (e as Error).message);
    return 0;
  }
}

/** A security notice to one person: Inbox, email and push, whatever their choices. */
export async function notifySecurity({ userId, title, body, origin, pushDetail }: { userId: string; title: string; body: string; origin: string; pushDetail?: string }) {
  try {
    return await notifyMembers({ kind: 'security', userIds: [userId], title, body, link: '/account/security', origin, pushDetail });
  } catch (e) {
    console.error('notifySecurity failed', (e as Error).message);
    return 0;
  }
}
