import { serviceClient } from './admin';
import { MAILBOXES_READ_ONLY } from 'astro:env/server';
import { getMessage, graph, graphConfigured, newMessages, sendReply, setCategory } from './graph';
import { getGmailMessage, gmailConfigured, gmailInboxCount, newGmailMessages, sendGmailReply, setGmailLabel } from './gmail';

/*
 * Shareholder mailboxes are in Microsoft 365 (Lakeba's, or a venture's own:
 * graph.ts) or in a venture's Google Workspace (gmail.ts). The shareholder-email
 * code works with these, and each call goes to the right one: a mailbox is in
 * Google once its venture's Google administrator allowed the portal and the
 * portal could open it (entities.google_mailbox_verified_at).
 */
let google = new Set<string>();
let at = 0;
async function inGoogle(mailbox: string) {
  if (Date.now() - at > 60_000) {
    at = Date.now();
    const { data } = await serviceClient().from('entities').select('shareholder_mailbox').not('google_mailbox_verified_at', 'is', null).not('shareholder_mailbox', 'is', null);
    google = new Set((data ?? []).map((e) => String(e.shareholder_mailbox).toLowerCase()));
  }
  return google.has(mailbox.toLowerCase());
}
/** After a venture's Google mailbox is checked or disconnected. */
export const forgetMailboxes = () => { at = 0; };

export const mailboxReady = async (mailbox: string) => ((await inGoogle(mailbox)) ? gmailConfigured() : graphConfigured());
export const anyMailboxes = () => graphConfigured() || gmailConfigured();
/** Staging: mailboxes are read only, so nothing is labelled and no reply (automatic or not) is sent. */
export const mailboxesReadOnly = MAILBOXES_READ_ONLY;

export const newMailboxMessages = async (mailbox: string, delta: string | null) => ((await inGoogle(mailbox)) ? newGmailMessages(mailbox, delta) : newMessages(mailbox, delta));
export const getMailboxMessage = async (mailbox: string, id: string) => ((await inGoogle(mailbox)) ? getGmailMessage(mailbox, id) : getMessage(mailbox, id));
export const labelMessage = async (mailbox: string, id: string, label: string, existing: string[] = []) => (MAILBOXES_READ_ONLY ? undefined : (await inGoogle(mailbox)) ? setGmailLabel(mailbox, id, label) : setCategory(mailbox, id, label, existing));
export const replyToMessage = async (mailbox: string, id: string, to: { address: string; name?: string }, html: string) => ((await inGoogle(mailbox)) ? sendGmailReply(mailbox, id, to, html) : sendReply(mailbox, id, to, html));
/** How many emails are in the Inbox (a connection test). */
export async function inboxCount(mailbox: string) {
  if (await inGoogle(mailbox)) return gmailInboxCount(mailbox);
  return (await graph<{ totalItemCount: number }>(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox?$select=totalItemCount`)).totalItemCount;
}
