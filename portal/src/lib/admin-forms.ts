/** Helpers shared by the admin pages. */

/**
 * Reads a `datetime-local` value. It is interpreted in the server's time zone,
 * which is acceptable while all admins work from Sydney.
 */
export const parseLocal = (value: string) => (value ? new Date(value).toISOString() : null);

/** Formats a timestamp for a `datetime-local` input (server time zone). */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/** A name with the email as fallback. */
export const displayName = (p: { first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined) =>
  p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || '—' : '—';

export const roles = ['investor', 'board', 'admin'] as const;
export const holderKindValues = ['individual', 'company', 'trust', 'super_fund'] as const;
