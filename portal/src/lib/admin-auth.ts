import { serviceClient } from './admin';
import { sendMail } from './mail';
import { brandOf, type Brand } from './brand';

/**
 * Invites and password resets are sent by the portal rather than Supabase's
 * templates, so the link carries a token hash that /auth/confirm verifies on
 * the server.
 */

async function emailLink(kind: 'invite' | 'recovery', email: string, origin: string, opts: { data?: Record<string, string>; brand?: Brand; welcome?: boolean } = {}) {
  const svc = serviceClient();
  const { data: link, error } = await svc.auth.admin.generateLink(
    kind === 'invite' ? { type: 'invite', email, options: { data: opts.data } } : { type: 'recovery', email },
  );
  if (error || !link.properties?.hashed_token) return { error: error?.message ?? 'Could not create the link.', userId: null, url: null };
  const url = `${origin}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=${kind}`;
  const brand = opts.brand ?? brandOf(null);
  const name = brand.portalName;
  const mail = { brand };
  // An account created by an import gets a "welcome" email (a set-password link valid for 1 hour).
  await sendMail(
    kind === 'invite'
      ? { ...mail, to: email, subject: `Your ${name} invitation`, text: `You have been invited to the ${name}. Use the button below to choose a password. The link expires in 24 hours.`, link: url, linkLabel: 'Set up my account' }
      : opts.welcome
        ? { ...mail, to: email, subject: `Your ${name} is ready`, text: `Your shareholding can now be viewed in the ${name}: documents, meetings, your holding statement and questions for the board. Use the button below to choose your password. The link expires in 1 hour; if it has expired, use “Forgot password” on the sign-in page.`, link: url, linkLabel: 'Choose my password' }
        : { ...mail, to: email, subject: `Reset your ${name} password`, text: 'Use the button below to choose a new password. The link expires in 1 hour. If you did not ask for this, you can ignore this email.', link: url, linkLabel: 'Choose a new password' },
  );
  // The link is also returned so an admin can pass it on directly.
  return { error: null, userId: link.user.id, url };
}

export const sendInvite = (email: string, origin: string, data: Record<string, string>, brand?: Brand) => emailLink('invite', email, origin, { data, brand });
export const sendPasswordReset = (email: string, origin: string, brand?: Brand) => emailLink('recovery', email, origin, { brand });
/** For accounts that already exist (e.g. from an import): a welcome email with a set-password link. */
export const sendWelcome = (email: string, origin: string, brand?: Brand) => emailLink('recovery', email, origin, { brand, welcome: true });
