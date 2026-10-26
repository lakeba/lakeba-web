import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GMAIL_API_BASE, GOOGLE_SERVICE_ACCOUNT_FILE, GOOGLE_TOKEN_URL } from 'astro:env/server';
import type { GraphMessage } from './graph';

// Gmail for ventures on Google Workspace: their shareholder mailbox, read with
// Lakeba's Google service account, which the venture's Google administrator
// allows for Gmail only (Security → API controls → Domain-wide delegation, with
// the scope below). The portal acts as the mailbox it was given, never another.
// The same four things as with Outlook (graph.ts): new emails since the last
// look, one email, a label, and a reply in the same thread. Emails come back in
// the shape graph.ts uses, so the shareholder-email code doesn't change.

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

type ServiceAccount = { client_email: string; private_key: string; client_id: string };
let account: ServiceAccount | null = null;
function serviceAccount() {
  if (!GOOGLE_SERVICE_ACCOUNT_FILE) throw new Error('Google isn’t set up on this server.');
  account ??= JSON.parse(readFileSync(GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8')) as ServiceAccount;
  return account;
}
export const gmailConfigured = () => Boolean(GOOGLE_SERVICE_ACCOUNT_FILE);
/** What a venture's Google administrator enters for domain-wide delegation. */
export const gmailClientId = () => (gmailConfigured() ? serviceAccount().client_id : null);

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const tokens = new Map<string, { token: string; expires: number }>();
/** A token to act as one mailbox (a signed assertion for the service account, RFC 7523). */
async function tokenFor(mailbox: string) {
  const cached = tokens.get(mailbox);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({ iss: sa.client_email, sub: mailbox, scope: GMAIL_SCOPE, aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 3600 }));
  const assertion = `${head}.${claims}.${b64u(createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.private_key))}`;
  const res = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in failed: ${data.error_description ?? data.error ?? res.status}`);
  tokens.set(mailbox, { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

async function gmail<T = unknown>(mailbox: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GMAIL_API_BASE}/users/${encodeURIComponent(mailbox)}${path}`, {
    ...init, headers: { authorization: `Bearer ${await tokenFor(mailbox)}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Gmail ${res.status}: ${(data as { error?: { message?: string } }).error?.message ?? res.statusText}`), { status: res.status });
  return data as T;
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };
type GmailMessage = { id: string; threadId: string; internalDate: string; labelIds?: string[]; payload: Part };

const decode = (s?: string) => (s ? Buffer.from(s, 'base64url').toString('utf8') : '');
function textPart(p: Part, type: string): string | null {
  if (p.mimeType === type && p.body?.data) return decode(p.body.data);
  for (const c of p.parts ?? []) { const t = textPart(c, type); if (t) return t; }
  return null;
}
/** "Erin Example <erin@example.com>, b@x.com" → addresses with names. */
function addresses(value: string | undefined) {
  return (value ?? '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((a) => a.trim()).filter(Boolean).map((a) => {
    const m = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/.exec(a);
    return { emailAddress: { address: (m ? m[2] : a).trim(), name: m?.[1]?.trim() || undefined } };
  });
}

/** One Gmail message, in the shape graph.ts uses. */
function toMessage(m: GmailMessage): GraphMessage {
  const headers = m.payload.headers ?? [];
  const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value;
  const html = textPart(m.payload, 'text/html');
  return {
    id: m.id, conversationId: m.threadId, internetMessageId: h('Message-ID') ?? h('Message-Id'), subject: h('Subject') ?? '',
    receivedDateTime: new Date(Number(m.internalDate)).toISOString(),
    from: addresses(h('From'))[0], toRecipients: addresses(h('To')), ccRecipients: addresses(h('Cc')),
    body: { contentType: 'text', content: textPart(m.payload, 'text/plain') ?? (html ? html.replace(/<[^>]+>/g, ' ') : '') },
    internetMessageHeaders: headers, categories: [],
  };
}

export const getGmailMessage = async (mailbox: string, id: string) => toMessage(await gmail<GmailMessage>(mailbox, `/messages/${encodeURIComponent(id)}?format=full`));

/**
 * New emails in the Inbox since the last look (Gmail's history). The first look
 * only notes where the mailbox is now, as with Outlook: older emails aren't
 * processed. The "delta" stored is Gmail's history position.
 */
export async function newGmailMessages(mailbox: string, delta: string | null) {
  const position = async () => (await gmail<{ historyId: string }>(mailbox, '/profile')).historyId;
  if (!delta) return { messages: [] as GraphMessage[], deltaLink: await position() };
  const ids: string[] = [];
  let next: string | undefined;
  let latest = delta;
  try {
    do {
      const page = await gmail<{ history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; historyId: string; nextPageToken?: string }>(mailbox,
        `/history?startHistoryId=${encodeURIComponent(delta)}&historyTypes=messageAdded&labelId=INBOX${next ? `&pageToken=${encodeURIComponent(next)}` : ''}`);
      for (const h of page.history ?? []) for (const a of h.messagesAdded ?? []) if (!ids.includes(a.message.id)) ids.push(a.message.id);
      latest = page.historyId ?? latest;
      next = page.nextPageToken;
    } while (next);
  } catch (e) {
    // Too old a position (Gmail keeps about a week): start again from now.
    if ((e as { status?: number }).status === 404) return { messages: [], deltaLink: await position() };
    throw e;
  }
  const messages = await Promise.all(ids.map((id) => getGmailMessage(mailbox, id)));
  return { messages, deltaLink: latest };
}

/** Labels instead of Outlook categories: one "Portal: …" label at a time. */
const labels = new Map<string, { id: string; name: string }[]>();
export async function setGmailLabel(mailbox: string, id: string, label: string) {
  let list = labels.get(mailbox) ?? (await gmail<{ labels: { id: string; name: string }[] }>(mailbox, '/labels')).labels;
  let mine = list.find((l) => l.name === label);
  if (!mine) {
    mine = await gmail<{ id: string; name: string }>(mailbox, '/labels', { method: 'POST', body: JSON.stringify({ name: label, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) });
    list = [...list, mine];
  }
  labels.set(mailbox, list);
  const others = list.filter((l) => l.name.startsWith('Portal: ') && l.id !== mine!.id).map((l) => l.id);
  await gmail(mailbox, `/messages/${encodeURIComponent(id)}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: [mine.id], removeLabelIds: others }) });
}

/** Replies in the same Gmail thread, to the given address only, from the mailbox. */
export async function sendGmailReply(mailbox: string, id: string, to: { address: string; name?: string }, html: string) {
  const original = await gmail<GmailMessage>(mailbox, `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=References`);
  const h = (n: string) => original.payload.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? '';
  const subject = /^re:/i.test(h('Subject')) ? h('Subject') : `Re: ${h('Subject')}`;
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');
  const mime = [
    `From: ${mailbox}`, `To: ${to.name ? `"${clean(to.name).replace(/"/g, '')}" ` : ''}<${clean(to.address)}>`,
    `Subject: =?UTF-8?B?${Buffer.from(clean(subject)).toString('base64')}?=`,
    ...(h('Message-ID') ? [`In-Reply-To: ${clean(h('Message-ID'))}`, `References: ${clean(`${h('References')} ${h('Message-ID')}`.trim())}`] : []),
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(html).toString('base64').replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');
  await gmail(mailbox, '/messages/send', { method: 'POST', body: JSON.stringify({ raw: b64u(mime), threadId: original.threadId }) });
}

/** How many emails are in the Inbox: the check that the portal may open the mailbox. */
export const gmailInboxCount = async (mailbox: string) => (await gmail<{ messagesTotal: number }>(mailbox, '/labels/INBOX')).messagesTotal;
