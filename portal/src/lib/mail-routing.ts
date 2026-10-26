/*
 * Several companies can share one shareholders@ mailbox, each with its own
 * address on it (mist.shareholders@lakeba.com, an alias of shareholders@).
 * An email is filed to the company whose own address it was sent to (To or
 * Cc), else to the mailbox's owner: the company with no address of its own,
 * or the first.
 */
type Recipients = { toRecipients?: { emailAddress: { address: string } }[]; ccRecipients?: { emailAddress: { address: string } }[] };

export function companyFor<C extends { id: string; shareholder_address: string | null }>(m: Recipients, mailbox: string, sharing: C[]): C {
  const to = new Set([...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map((r) => r.emailAddress.address.toLowerCase()));
  return sharing.find((c) => c.shareholder_address && to.has(c.shareholder_address.toLowerCase()))
    ?? sharing.find((c) => !c.shareholder_address || c.shareholder_address.toLowerCase() === mailbox) ?? sharing[0];
}
