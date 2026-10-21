import { serviceClient } from './admin';
import { sendMail } from './mail';

/**
 * Invites and password resets are sent by the portal rather than Supabase's
 * templates, so the link carries a token hash that /auth/confirm verifies on
 * the server.
 */
async function emailLink(kind: 'invite' | 'recovery', email: string, origin: string, data?: Record<string, string>) {
  const svc = serviceClient();
  const { data: link, error } = await svc.auth.admin.generateLink(
    kind === 'invite' ? { type: 'invite', email, options: { data } } : { type: 'recovery', email },
  );
  if (error || !link.properties?.hashed_token) return { error: error?.message ?? 'Could not create the link.', userId: null, url: null };
  const url = `${origin}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=${kind}`;
  await sendMail(
    kind === 'invite'
      ? { to: email, subject: 'Your Lakeba Investor Portal invitation', text: 'You have been invited to the Lakeba Investor Portal. Use the button below to choose a password. The link expires in 24 hours.', link: url, linkLabel: 'Set up my account' }
      : { to: email, subject: 'Reset your Lakeba Investor Portal password', text: 'Use the button below to choose a new password. The link expires in 1 hour. If you did not ask for this, you can ignore this email.', link: url, linkLabel: 'Choose a new password' },
  );
  // The link is also returned so an admin can pass it on directly.
  return { error: null, userId: link.user.id, url };
}

export const sendInvite = (email: string, origin: string, data: Record<string, string>) => emailLink('invite', email, origin, data);
export const sendPasswordReset = (email: string, origin: string) => emailLink('recovery', email, origin);
