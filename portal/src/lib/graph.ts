import { createHash, createSign, randomUUID, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { serviceClient } from './admin';
import { MAILBOXES_READ_ONLY, MS_CLIENT_CERT_FILE, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_GRAPH_BASE, MS_LOGIN_BASE, MS_TENANT_ID } from 'astro:env/server';

// Microsoft Graph for the shareholder mailboxes. The app ("Lakeba Investor
// Portal – Mail") is limited in Exchange to those mailboxes only. It signs in
// with a certificate (production) or a client secret. A venture whose own
// Microsoft 365 administrator approved the app (entities.ms_tenant_id) has its
// mailboxes there: each call signs in to the Microsoft 365 the mailbox belongs to.

export const graphConfigured = () => Boolean(MS_TENANT_ID && MS_CLIENT_ID && (MS_CLIENT_CERT_FILE || MS_CLIENT_SECRET));

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** A signed client assertion (RFC 7523) from the certificate file. */
function clientAssertion(tokenUrl: string) {
  const pem = readFileSync(MS_CLIENT_CERT_FILE!, 'utf8');
  const cert = new X509Certificate(pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)![0]);
  const key = pem.match(/-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+?-----END (RSA )?PRIVATE KEY-----/)![0];
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', x5t: b64u(createHash('sha1').update(cert.raw).digest()) }));
  const payload = b64u(JSON.stringify({ aud: tokenUrl, iss: MS_CLIENT_ID, sub: MS_CLIENT_ID, jti: randomUUID(), nbf: now - 60, exp: now + 600 }));
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(key);
  return `${header}.${payload}.${b64u(signature)}`;
}

const tokens = new Map<string, { token: string; expires: number }>();
async function accessToken(tenant = MS_TENANT_ID!) {
  const cached = tokens.get(tenant);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const tokenUrl = `${MS_LOGIN_BASE}/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({ client_id: MS_CLIENT_ID!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  if (MS_CLIENT_CERT_FILE) {
    body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    body.set('client_assertion', clientAssertion(tokenUrl));
  } else body.set('client_secret', MS_CLIENT_SECRET!);
  const res = await fetch(tokenUrl, { method: 'POST', body });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Microsoft sign-in failed: ${data.error_description?.split('\n')[0] ?? res.status}`);
  tokens.set(tenant, { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

const domainTenants = new Map<string, { at: number; tenant: string | null }>();
/**
 * Whether a domain's email is in Lakeba's own Microsoft 365 (Microsoft publishes
 * which organisation a domain belongs to). Ventures there, like Ezifin, send and
 * receive through the portal's app as Lakeba does: no approval of their own.
 */
export async function inLakebaMicrosoft(domain: string) {
  if (!MS_TENANT_ID || !domain) return false;
  const key = domain.toLowerCase();
  let hit = domainTenants.get(key);
  if (!hit || Date.now() - hit.at > 3_600_000) {
    const res = await fetch(`${MS_LOGIN_BASE}/${encodeURIComponent(key)}/v2.0/.well-known/openid-configuration`).catch(() => null);
    const issuer = res?.ok ? ((await res.json().catch(() => ({}))) as { issuer?: string }).issuer ?? '' : '';
    hit = { at: Date.now(), tenant: issuer.match(/\/([^/]+)\/v2\.0\/?$/)?.[1]?.toLowerCase() ?? null };
    domainTenants.set(key, hit);
  }
  return hit.tenant === MS_TENANT_ID.toLowerCase();
}

/** Whether the portal's app is approved in a Microsoft 365 (Microsoft only signs it in where it was approved). */
export const approvedIn = async (tenant: string) => { try { await accessToken(tenant); return true; } catch { return false; } };

// Which Microsoft 365 a mailbox is in: a venture's (its shareholder mailbox or sending address) or Lakeba's.
let tenants = new Map<string, string>();
let tenantsAt = 0;
async function tenantOf(mailbox: string | null) {
  if (!mailbox) return undefined;
  if (Date.now() - tenantsAt > 60_000) {
    tenantsAt = Date.now();
    const { data } = await serviceClient().from('entities').select('ms_tenant_id, shareholder_mailbox, mail_from').not('ms_tenant_id', 'is', null);
    tenants = new Map((data ?? []).flatMap((e) => [e.shareholder_mailbox, e.mail_from].filter(Boolean).map((m) => [String(m).toLowerCase(), e.ms_tenant_id as string])));
  }
  return tenants.get(mailbox.toLowerCase());
}
/** After a venture connects or disconnects its Microsoft 365. */
export const forgetTenants = () => { tenantsAt = 0; };

/** Staging (MAILBOXES_READ_ONLY): mailboxes are read, never sent from or changed. */
export const READ_ONLY_MESSAGE = 'This server only reads mailboxes: it doesn’t send from them or change them.';

export async function graph<T = unknown>(path: string, init: RequestInit & { prefer?: string; tenant?: string } = {}): Promise<T> {
  if (MAILBOXES_READ_ONLY && (init.method ?? 'GET').toUpperCase() !== 'GET') throw new Error(READ_ONLY_MESSAGE);
  const url = path.startsWith('http') ? path : `${MS_GRAPH_BASE}${path}`;
  const mailbox = /\/users\/([^/?]+)/.exec(new URL(url).pathname)?.[1];
  const headers: Record<string, string> = { authorization: `Bearer ${await accessToken(init.tenant ?? await tenantOf(mailbox ? decodeURIComponent(mailbox) : null))}`, ...(init.body ? { 'content-type': 'application/json' } : {}) };
  if (init.prefer) headers.prefer = init.prefer;
  const { tenant: _tenant, prefer: _prefer, ...rest } = init;
  const res = await fetch(url, { ...rest, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  if (res.status === 202 || res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft Graph ${res.status}: ${(data as { error?: { message?: string } }).error?.message ?? res.statusText}`);
  return data as T;
}

export type GraphMessage = {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  receivedDateTime: string;
  from?: { emailAddress: { address: string; name?: string } };
  toRecipients?: { emailAddress: { address: string } }[];
  ccRecipients?: { emailAddress: { address: string } }[];
  body?: { contentType: string; content: string };
  internetMessageHeaders?: { name: string; value: string }[];
  categories?: string[];
  '@removed'?: unknown;
};

const SELECT = 'id,internetMessageId,conversationId,subject,receivedDateTime,from,toRecipients,ccRecipients,body,internetMessageHeaders,categories';
const TEXT_BODY = 'outlook.body-content-type="text"';

/**
 * New messages in a mailbox's Inbox since the last check (Graph delta query).
 * The first run only notes where the Inbox is now: older emails aren't processed.
 */
export async function newMessages(mailbox: string, deltaLink: string | null) {
  const messages: GraphMessage[] = [];
  const first = !deltaLink;
  let next: string | null = deltaLink ?? `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages/delta?$select=${SELECT}`;
  let newDelta: string | null = null;
  while (next) {
    const page: { value: GraphMessage[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string } = await graph(next, { prefer: `${TEXT_BODY}, odata.maxpagesize=50` });
    if (!first) messages.push(...page.value.filter((m) => !m['@removed']));
    next = page['@odata.nextLink'] ?? null;
    newDelta = page['@odata.deltaLink'] ?? newDelta;
  }
  return { messages, deltaLink: newDelta ?? deltaLink };
}

/** Headers aren't returned by delta queries: fetch the full message. */
export const getMessage = (mailbox: string, id: string) =>
  graph<GraphMessage>(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}?$select=${SELECT}`, { prefer: TEXT_BODY });

/** Outlook categories, so people working in Outlook see what the portal did. */
export async function setCategory(mailbox: string, id: string, category: string, existing: string[] = []) {
  const keep = existing.filter((c) => !c.startsWith('Portal: '));
  await graph(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ categories: [...keep, category] }) });
}

/** Sends an email from a mailbox (a venture's own address, in its own Microsoft 365). */
export async function sendAs(from: string, m: { to: string; subject: string; html: string; replyTo?: string | null }) {
  await graph(`/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({ message: { subject: m.subject, body: { contentType: 'HTML', content: m.html }, toRecipients: [{ emailAddress: { address: m.to } }],
      ...(m.replyTo ? { replyTo: [{ emailAddress: { address: m.replyTo } }] } : {}) }, saveToSentItems: true }),
  });
}

/** Replies in the same Outlook thread, to the given address only. */
export async function sendReply(mailbox: string, id: string, to: { address: string; name?: string }, html: string) {
  await graph(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ message: { toRecipients: [{ emailAddress: to }] }, comment: html }),
  });
}
