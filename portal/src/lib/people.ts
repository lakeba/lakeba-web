import type { serviceClient } from './admin';
import { sendInvite } from './admin-auth';
import type { Brand } from './brand';

type Svc = ReturnType<typeof serviceClient>;

// Adding an investor: the person's account (made if new) and their access to
// a holder, with or without the invitation email. Used by Admin → Investors,
// the company API and the HubSpot connection, so the rules are the same
// everywhere. The caller has already checked who may do it and that the
// holder belongs to the company.

export type AddInvestor = {
  email: string; firstName?: string; lastName?: string; holderId: string; access?: 'owner' | 'viewer';
  invite: boolean; origin: string; brand: Brand;
  /** How it's logged: an admin's own session (log_event), or another source's audit entry. */
  log: (action: string, detail: Record<string, unknown>) => Promise<unknown>;
};
export type Added = { userId: string; existing: boolean; invited: boolean; inviteUrl: string | null };

export const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

export async function addInvestor(svc: Svc, a: AddInvestor): Promise<Added | { error: string }> {
  const email = a.email.trim().toLowerCase();
  if (!validEmail(email)) return { error: 'That isn’t an email address.' };
  const access = a.access === 'viewer' ? 'viewer' : 'owner';
  const { data: existing } = await svc.from('profiles').select('id').eq('email', email).maybeSingle();
  let userId = existing?.id ?? null;
  let inviteUrl: string | null = null;
  if (!userId && a.invite) {
    const sent = await sendInvite(email, a.origin, { first_name: a.firstName ?? '', last_name: a.lastName ?? '' }, a.brand);
    if (sent.error || !sent.userId) return { error: sent.error ?? 'Could not send the invitation.' };
    userId = sent.userId; inviteUrl = sent.url;
  } else if (!userId) {
    const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { first_name: a.firstName ?? '', last_name: a.lastName ?? '' } });
    if (error || !data.user) return { error: error?.message ?? 'Could not add them.' };
    userId = data.user.id;
  }
  if (!existing && (a.firstName || a.lastName)) await svc.from('profiles').update({ first_name: a.firstName ?? '', last_name: a.lastName ?? '' }).eq('id', userId).throwOnError();
  await svc.from('holder_members').upsert({ holder_id: a.holderId, user_id: userId, access }).throwOnError();
  const invited = Boolean(inviteUrl);
  await a.log(invited ? 'admin_invited_user' : 'admin_added_investor', { email, role: 'investor', holder_id: a.holderId, user_id: userId, existing: Boolean(existing) });
  return { userId, existing: Boolean(existing), invited, inviteUrl };
}
