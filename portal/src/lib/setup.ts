import { createHash, randomBytes } from 'node:crypto';
import { MS_CLIENT_ID, MS_LOGIN_BASE, PORTAL_DOMAIN } from 'astro:env/server';
import { serviceClient } from './admin';
import { brandOf } from './brand';
import { COLUMNS, type Company } from './companies';
import { domainStatus, placeOf } from './domains';
import { forgetTenants, sendAs } from './graph';
import { gmailInboxCount } from './gmail';
import { sendMail, sendViaGoogle } from './mail';
import { forgetMailboxes } from './mailboxes';
import { adminIds, notifyMembers } from './notify';
import { forgetVentureSites, refreshOwnDomains } from './sites';

/*
 * The guided set-up of a venture's own domain and email (Admin → a company →
 * Domain and mail), shared by the admin page and the page its IT person opens
 * from a hand-off link (/setup/<token>), which needs no portal account. Both
 * run the same steps; only the venture's own admins can stop or disconnect
 * things, send the link or ask Lakeba for help.
 */
export type SetupCompany = Company & { shareholder_mailbox: string | null };
export const SETUP_COLUMNS = `${COLUMNS}, shareholder_mailbox`;
export const HANDOFF_DAYS = 7;

export type Who = {
  /** The signed-in admin, or null on a hand-off page. */
  userId: string | null;
  /** Where test emails go: the admin's or the hand-off recipient's address. */
  email: string;
  /** For the audit log and notifications: "Jo Smith (jo@example.com) through the set-up link". */
  label: string;
  handoffId?: string;
  /** The venture's admin (or a group admin): may stop, disconnect, send the link and ask for help (and, like the IT person, choose the address). */
  manage: boolean;
  group: boolean;
};

export type Outcome = { notice?: string; error?: string; consentUrl?: string; redirect?: string };

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export async function loadSetupCompany(by: { code?: string; id?: string }) {
  const q = serviceClient().from('entities').select(SETUP_COLUMNS);
  const { data } = await (by.id ? q.eq('id', by.id) : q.eq('code', (by.code ?? '').toUpperCase())).maybeSingle();
  return data as SetupCompany | null;
}

async function audit(c: SetupCompany, who: Who, action: string, detail: Record<string, unknown> = {}) {
  await serviceClient().from('audit_log').insert({ action, user_id: who.userId, entity_id: c.id, detail: { company: c.code, by: who.label, ...detail } });
}

/** Tells the venture's admins and Lakeba's group admins that a set-up step finished (or help is wanted). */
async function tellAdmins(c: SetupCompany, origin: string, title: string, body: string, groupOnly = false) {
  try {
    await notifyMembers({ kind: 'admin_setup', title, body, link: `/admin/companies/${c.code}/domain`, origin, userIds: await adminIds(groupOnly ? null : c.id) });
  } catch (e) {
    console.error('setup notice failed', (e as Error).message);
  }
}

/** Plain words for what Microsoft or Google said when a step failed. */
export function plainError(provider: 'microsoft' | 'google' | 'gmail', message: string, address?: string) {
  const m = message.toLowerCase();
  if (provider === 'microsoft') {
    if (/aadsts7000229|aadsts700016|aadsts650051|aadsts7000215|sign-in failed/.test(m)) return 'Microsoft says the portal isn’t approved in this Microsoft 365 any more. Ask the administrator to approve it again (step 2).';
    if (/accessdenied|access is denied|403/.test(m)) return `Microsoft refused access to ${address ?? 'this mailbox'}. If the portal was limited to some mailboxes (step 4), add this address to that list; changes there can take up to 2 hours.`;
    if (/notfound|404|mailboxnotenabled|resource could not be discovered|invaliduser/.test(m)) return `There’s no mailbox ${address ?? ''} in this Microsoft 365, or it has no mailbox yet. Check the spelling, or create it as a shared mailbox (step 1).`;
    return `Microsoft said: ${message}`;
  }
  if (provider === 'google') {
    if (/5\.7\.0|5\.7\.1|relay|not allowed|invalid credentials/.test(m)) return `Google didn’t let the portal send as ${address ?? 'this address'}. Check the SMTP relay setting: Lakeba’s server address must be allowed, and “Only addresses in my domains” must include ${address?.split('@')[1] ?? 'this domain'}. Changes can take up to an hour.`;
    if (/tls|certificate/.test(m)) return 'Google and the portal couldn’t agree on encryption. In the SMTP relay setting, keep “Require TLS encryption” ticked.';
    return `Google said: ${message}`;
  }
  if (/unauthorized_client|not authorized|invalid_grant/.test(m)) return 'Google says the portal isn’t allowed yet. Check the domain-wide delegation: the Client ID and the scope must be exactly as shown (changes can take a few minutes).';
  if (/failedprecondition|precondition|not found|404|invalid.*user/.test(m)) return `Google can’t find a Gmail mailbox ${address ?? ''}. It must be a user mailbox in Google Workspace (not a group).`;
  return `Google said: ${message}`;
}

/**
 * Checks a waiting own domain and puts it in use once it points to the portal.
 * Returns the check's plain-words result.
 */
export async function checkDomain(c: SetupCompany, who: Who, origin: string) {
  if (!c.custom_domain) return null;
  const r = await domainStatus(c.custom_domain);
  if (r.ok && !c.custom_domain_verified_at) {
    const { data } = await serviceClient().from('entities').update({ custom_domain_verified_at: new Date().toISOString() }).eq('id', c.id).is('custom_domain_verified_at', null).select('id');
    if (data?.length) {
      forgetVentureSites(); await refreshOwnDomains();
      await audit(c, who, 'company_domain_verified', { domain: c.custom_domain, found: r.found });
      await tellAdmins(c, origin, `${c.display_name}’s portal now opens at ${c.custom_domain}`, `Its DNS record points to the portal, so investors now open ${c.display_name}’s portal at ${c.custom_domain}. investors.lakeba.com keeps working too.`);
    }
  }
  return r;
}

/** What changed since a page was opened: the page reloads when this differs. */
export const setupStamp = (c: SetupCompany) => [c.custom_domain, c.custom_domain_verified_at, c.ms_tenant_id, c.mail_from_verified_at, c.mail_via, c.google_mailbox_verified_at].join('|');

/** The link a Microsoft 365 administrator approves the portal with (7 days, used once). */
async function consentLink(c: SetupCompany, who: Who, central: string) {
  const state = randomBytes(24).toString('base64url');
  const { data: handoff } = who.handoffId ? await serviceClient().from('setup_handoffs').select('created_by').eq('id', who.handoffId).single() : { data: null };
  await serviceClient().from('ms_consent_requests').insert({
    state_hash: hash(state), entity_id: c.id, created_by: who.userId ?? handoff?.created_by ?? null, handoff_id: who.handoffId ?? null,
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  }).throwOnError();
  return `${MS_LOGIN_BASE}/organizations/v2.0/adminconsent?${new URLSearchParams({ client_id: MS_CLIENT_ID ?? '', scope: 'https://graph.microsoft.com/.default', redirect_uri: `${central}/auth/ms-consent`, state })}`;
}

/** Sends the set-up steps to whoever looks after the venture's domain or email. */
async function sendHandoff(c: SetupCompany, who: Who, form: FormData, central: string): Promise<Outcome> {
  const email = String(form.get('handoff_email') ?? '').trim().toLowerCase();
  const name = String(form.get('handoff_name') ?? '').trim().slice(0, 120) || null;
  const note = String(form.get('handoff_note') ?? '').trim().slice(0, 1000) || null;
  if (!EMAIL.test(email)) return { error: 'Enter the email address of the person who looks after your domain or email.' };
  const svc = serviceClient();
  const { count } = await svc.from('setup_handoffs').select('id', { count: 'exact', head: true }).eq('entity_id', c.id).is('revoked_at', null).gt('expires_at', new Date().toISOString());
  if ((count ?? 0) >= 10) return { error: 'There are already 10 links working. Stop one you don’t need first.' };
  const token = randomBytes(24).toString('base64url');
  await svc.from('setup_handoffs').insert({ token_hash: hash(token), entity_id: c.id, recipient_name: name, recipient_email: email, note, created_by: who.userId, expires_at: new Date(Date.now() + HANDOFF_DAYS * 86_400_000).toISOString() }).throwOnError();
  const sender = who.label.replace(/ \(.*$/, '');
  try {
    await sendMail({
      to: email, brand: brandOf(c),
      subject: `${sender} asked you to help connect ${c.display_name}’s investor portal`,
      text: `Hello${name ? ` ${name}` : ''},\n\n${sender} at ${c.display_name} would like ${c.display_name}’s investor portal (run by Lakeba) to use ${c.display_name}’s own web address and email. They asked you because you look after ${c.display_name}’s domain or email.\n\n${note ? `Their note: “${note}”\n\n` : ''}The button opens the steps, with everything to copy and paste. Most steps take a few minutes; the page checks your work and tells ${sender} as each part is done. Nothing changes for ${c.display_name}’s own website or everyone’s email.\n\nThe link works for ${HANDOFF_DAYS} days and only shows these set-up steps.`,
      link: `${central}/setup/${token}`, linkLabel: 'Open the set-up steps',
      footer: `${sender} sent you this from ${c.display_name}’s investor portal, run by Lakeba. If it isn’t for you, ignore it.`,
    });
  } catch (e) {
    await svc.from('setup_handoffs').update({ revoked_at: new Date().toISOString() }).eq('token_hash', hash(token));
    return { error: `The email to ${email} couldn’t be sent: ${(e as Error).message}` };
  }
  await audit(c, who, 'company_setup_link_sent', { to: email });
  return { notice: `The steps went to ${name ? `${name} (${email})` : email}. Their link works for ${HANDOFF_DAYS} days; you’ll see here when they open it and as each part is done.` };
}

/**
 * Why an address can't be this venture's sending address, if it can't: it is
 * Lakeba's, or on a domain another company uses. Microsoft and Google only
 * check that the portal may send for that organisation, not for which company.
 */
async function senderProblem(c: SetupCompany, from: string) {
  const domain = from.split('@')[1] ?? '';
  const portal = (PORTAL_DOMAIN ?? 'investors.lakeba.com').toLowerCase();
  if (/(^|\.)lakeba\.com$/.test(domain) || domain === portal || domain.endsWith(`.${portal}`)) return `${from} is a Lakeba address. Use an address on ${c.display_name}’s own domain.`;
  const { data } = await serviceClient().from('entities').select('mail_from, shareholder_mailbox, contact_email, reply_to, website, custom_domain').neq('id', c.id);
  const hostOf = (v: string | null) => (v ? (v.includes('@') ? v.split('@')[1] : v.replace(/^https?:\/\//, '').replace(/[/:?#].*$/, '')).toLowerCase().replace(/^www\./, '') : '');
  const FREE = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|bigpond|proton|protonmail)\.(com|com\.au|net|me)$/;
  const theirs = new Set((data ?? []).flatMap((e) => [e.mail_from, e.shareholder_mailbox, e.contact_email, e.reply_to, e.website, e.custom_domain].map(hostOf)).filter((d) => d && !FREE.test(d)));
  if ([...theirs].some((d) => domain === d || domain.endsWith(`.${d}`) || d.endsWith(`.${domain}`))) return `${domain} is used by another company on the portal. Use an address on ${c.display_name}’s own domain, or ask Lakeba for help.`;
  return null;
}

/** Runs one set-up step. `intent` comes from the button pressed. */
export async function runSetupAction(c: SetupCompany, who: Who, form: FormData, central: string): Promise<Outcome> {
  const svc = serviceClient();
  const intent = String(form.get('intent') ?? '');
  const from = String(form.get('mail_from') ?? '').trim().toLowerCase();
  const subject = `Test from ${c.display_name}’s investor portal`;

  switch (intent) {
    case 'check-dns': {
      const r = await checkDomain(c, who, central);
      if (!r) return { error: 'There’s no own domain to check yet.' };
      return r.ok ? { notice: `${c.custom_domain} points to the portal. ${c.display_name}’s portal now opens there.` } : { error: r.problem ?? `${c.custom_domain} doesn’t point to the portal yet.` };
    }
    case 'set-domain': {
      // The venture's own admins, or the person they sent the steps to, choose the address; it's used only once its DNS points here.
      if (!who.manage && !who.handoffId) break;
      const domain = String(form.get('custom_domain') ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:?#].*$/, '').replace(/\.$/, '') || null;
      if (domain === c.custom_domain) return {};
      if (domain) {
        if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) return { error: 'Enter just the address, like investors.mist.com.' };
        const portal = (PORTAL_DOMAIN ?? 'investors.lakeba.com').toLowerCase();
        if (/(^|\.)lakeba\.com$/.test(domain) || domain === portal || domain.endsWith(`.${portal}`)) return { error: 'Use an address on your own domain, like investors.mist.com.' };
        const place = await placeOf(domain);
        if (place.label === '@') return { error: `${domain} is your main domain, which can’t point to the portal. Use an address like investors.${domain}.` };
        const { data: taken } = await svc.from('entities').select('id').eq('custom_domain', domain).neq('id', c.id).maybeSingle();
        if (taken) return { error: `${domain} is already used by another company.` };
      }
      await svc.from('entities').update({ custom_domain: domain, custom_domain_verified_at: null }).eq('id', c.id).throwOnError();
      forgetVentureSites(); await refreshOwnDomains();
      await audit(c, who, 'company_domain_set', { domain, was: c.custom_domain });
      if (!who.userId && domain) await tellAdmins(c, central, `${c.display_name}’s web address will be ${domain}`, `${who.label} chose it. Investors move there once its DNS record is in place; investors.lakeba.com keeps working too.`);
      return { notice: domain ? `Saved. Now add the DNS record below for ${domain}.` : `${c.display_name}’s portal stays on Lakeba’s address only.` };
    }
    case 'stop-domain': {
      if (!who.manage || !who.userId) break;
      await svc.from('entities').update({ custom_domain_verified_at: null }).eq('id', c.id).throwOnError();
      forgetVentureSites();
      await audit(c, who, 'company_domain_stopped', { domain: c.custom_domain });
      return { notice: `${c.display_name}’s portal is back on Lakeba’s address only.` };
    }
    case 'consent-link': {
      if (!MS_CLIENT_ID) return { error: 'The portal’s Microsoft 365 app isn’t set up on this server yet (Lakeba’s side).' };
      const url = await consentLink(c, who, central);
      await audit(c, who, 'company_microsoft365_link_made');
      return who.userId ? { consentUrl: url } : { redirect: url };
    }
    case 'disconnect': {
      if (!who.manage) break;
      await svc.from('entities').update({ ms_tenant_id: null, ms_connected_at: null, mail_from_verified_at: null, ...(c.mail_via === 'microsoft' ? { mail_via: null } : {}) }).eq('id', c.id).throwOnError();
      forgetTenants(); forgetMailboxes();
      await audit(c, who, 'company_microsoft365_disconnected');
      return { notice: 'Disconnected. Emails go out through Lakeba again.' };
    }
    case 'send-from': {
      if (!c.ms_tenant_id) return { error: 'Approve the portal in Microsoft 365 first (step 2).' };
      if (!EMAIL.test(from)) return { error: 'Enter the address emails should come from, e.g. investors@mist.com.' };
      const notMine = await senderProblem(c, from);
      if (notMine) return { error: notMine };
      // Saved first, so the mailbox is known to be in this venture's Microsoft 365; used once a test email went through.
      await svc.from('entities').update({ mail_from: from, mail_from_verified_at: null }).eq('id', c.id).throwOnError();
      forgetTenants();
      try {
        await sendAs(from, { to: who.email, subject, html: `<p>This test email came from ${from} through ${c.display_name}’s own Microsoft 365. Emails from the portal to ${c.display_name}’s investors now come from this address.</p>` });
      } catch (e) {
        return { error: plainError('microsoft', (e as Error).message, from) };
      }
      await svc.from('entities').update({ mail_from_verified_at: new Date().toISOString(), mail_via: 'microsoft' }).eq('id', c.id).throwOnError();
      await audit(c, who, 'company_send_from_verified', { address: from, via: 'microsoft' });
      if (!who.userId) await tellAdmins(c, central, `${c.display_name}’s emails now come from ${from}`, `${who.label} connected it. Emails from the portal to ${c.display_name}’s investors now come from ${from}, through its Microsoft 365.`);
      return { notice: `A test email went from ${from} to ${who.email}. ${c.display_name}’s emails now come from there.` };
    }
    case 'google-send': {
      if (!EMAIL.test(from)) return { error: 'Enter the address emails should come from, e.g. investors@mist.com.' };
      const notMine = await senderProblem(c, from);
      if (notMine) return { error: notMine };
      try {
        await sendViaGoogle({ from, name: c.sender_name ?? c.display_name, to: who.email, subject, html: `<p>This test email came from ${from} through Google’s relay. Emails from the portal to ${c.display_name}’s investors now come from this address.</p>` });
      } catch (e) {
        return { error: plainError('google', (e as Error).message, from) };
      }
      await svc.from('entities').update({ mail_from: from, mail_via: 'google', mail_from_verified_at: new Date().toISOString() }).eq('id', c.id).throwOnError();
      await audit(c, who, 'company_send_from_verified', { address: from, via: 'google' });
      if (!who.userId) await tellAdmins(c, central, `${c.display_name}’s emails now come from ${from}`, `${who.label} connected it. Emails from the portal to ${c.display_name}’s investors now come from ${from}, through Google.`);
      return { notice: `A test email went from ${from} to ${who.email} through Google. ${c.display_name}’s emails now come from there.` };
    }
    case 'google-mailbox': {
      if (!c.shareholder_mailbox) return { error: 'The shareholder mailbox address isn’t saved yet. Your colleague sets it in Shareholder emails.' };
      try {
        const count = await gmailInboxCount(c.shareholder_mailbox);
        await svc.from('entities').update({ google_mailbox_verified_at: new Date().toISOString() }).eq('id', c.id).throwOnError();
        forgetMailboxes();
        await audit(c, who, 'company_google_mailbox_connected', { mailbox: c.shareholder_mailbox });
        if (!who.userId) await tellAdmins(c, central, `${c.display_name}’s shareholder mailbox is connected`, `${who.label} connected ${c.shareholder_mailbox} in Gmail. Set it to Review in Shareholder emails.`);
        return { notice: `The portal can open ${c.shareholder_mailbox} in Gmail (its Inbox has ${count} emails).` };
      } catch (e) {
        return { error: plainError('gmail', (e as Error).message, c.shareholder_mailbox) };
      }
    }
    case 'google-disconnect': {
      if (!who.manage) break;
      await svc.from('entities').update({ google_mailbox_verified_at: null, ...(c.mail_via === 'google' ? { mail_via: null, mail_from_verified_at: null } : {}) }).eq('id', c.id).throwOnError();
      forgetMailboxes();
      await audit(c, who, 'company_google_disconnected');
      return { notice: 'Disconnected from Google. Emails go out through Lakeba again.' };
    }
    case 'handoff-send':
      if (!who.manage) break;
      return sendHandoff(c, who, form, central);
    case 'handoff-stop': {
      if (!who.manage) break;
      const id = String(form.get('handoff') ?? '');
      await svc.from('setup_handoffs').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('entity_id', c.id).throwOnError();
      await audit(c, who, 'company_setup_link_stopped');
      return { notice: 'That link no longer works.' };
    }
    case 'help': {
      if (!who.manage) break;
      const message = String(form.get('help_message') ?? '').trim().slice(0, 2000);
      await audit(c, who, 'company_setup_help_asked', { message });
      await tellAdmins(c, central, `${c.display_name} asked for help with its domain or email`, `${who.label}${message ? ` wrote: “${message}”` : ' asked for help setting up its own domain or email.'}`, true);
      return { notice: 'Lakeba’s team has your message and will get back to you by email.' };
    }
  }
  return { error: 'That isn’t possible from here.' };
}

/** A hand-off link's details, when it still works. */
export async function handoffByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data } = await serviceClient().from('setup_handoffs').select('*').eq('token_hash', hash(token)).is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  return data as { id: string; entity_id: string; recipient_name: string | null; recipient_email: string; note: string | null; created_by: string | null; opened_at: string | null; expires_at: string } | null;
}

export async function loadHandoffs(entityId: string) {
  const { data } = await serviceClient().from('setup_handoffs').select('id, recipient_name, recipient_email, created_at, expires_at, opened_at, last_seen_at, revoked_at').eq('entity_id', entityId).order('created_at', { ascending: false }).limit(10);
  return data ?? [];
}
