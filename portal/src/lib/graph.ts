import { createHash, createSign, randomUUID, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MS_CLIENT_CERT_FILE, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_GRAPH_BASE, MS_LOGIN_BASE, MS_TENANT_ID } from 'astro:env/server';

// Microsoft Graph for the shareholder mailboxes. The app ("Lakeba Investor
// Portal – Mail") is limited in Exchange to those mailboxes only. It signs in
// with a certificate (production) or a client secret.

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

let cached: { token: string; expires: number } | null = null;
async function accessToken() {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const tokenUrl = `${MS_LOGIN_BASE}/${MS_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({ client_id: MS_CLIENT_ID!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  if (MS_CLIENT_CERT_FILE) {
    body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    body.set('client_assertion', clientAssertion(tokenUrl));
  } else body.set('client_secret', MS_CLIENT_SECRET!);
  const res = await fetch(tokenUrl, { method: 'POST', body });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Microsoft sign-in failed: ${data.error_description?.split('\n')[0] ?? res.status}`);
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export async function graph<T = unknown>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${MS_GRAPH_BASE}${path}`;
  const headers: Record<string, string> = { authorization: `Bearer ${await accessToken()}`, ...(init.body ? { 'content-type': 'application/json' } : {}) };
  if (init.prefer) headers.prefer = init.prefer;
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
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
  body?: { contentType: string; content: string };
  internetMessageHeaders?: { name: string; value: string }[];
  categories?: string[];
  '@removed'?: unknown;
};

const SELECT = 'id,internetMessageId,conversationId,subject,receivedDateTime,from,body,internetMessageHeaders,categories';
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

/** Replies in the same Outlook thread, to the given address only. */
export async function sendReply(mailbox: string, id: string, to: { address: string; name?: string }, html: string) {
  await graph(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ message: { toRecipients: [{ emailAddress: to }] }, comment: html }),
  });
}
