/*
 * What a company is called to its investors and where its emails come from
 * (Admin → Companies → a company → Venture settings). Every setting left
 * empty falls back to what the portal used before ventures had settings:
 * "Lakeba" for the group, the company's display name otherwise, and Lakeba's
 * addresses. So a company with nothing filled in looks as it always did.
 */

export const LAKEBA_BLUE = '#276ae7';
export const LAKEBA_CONTACT = 'info@lakeba.com';

export type BrandSource = {
  code?: string; display_name: string; legal_name?: string | null; relationship: 'group' | 'controlled' | 'portfolio';
  brand_color?: string | null; sender_name?: string | null; reply_to?: string | null; contact_email?: string | null;
  ask_name?: string | null; email_footer?: string | null; document_footer?: string | null;
  ms_tenant_id?: string | null; mail_from?: string | null; mail_from_verified_at?: string | null;
};

export type Brand = {
  /** "Lakeba" for the group, else the company's name. */
  name: string;
  isGroup: boolean;
  legalName: string;
  /** "Lakeba Investor Portal", "Ezifin Investor Portal". */
  portalName: string;
  /** "Ask Lakeba", "Ask Ezifin", or the company's own name for it. */
  askName: string;
  color: string;
  /** Where investors write with questions. */
  contactEmail: string;
  /** The name emails come from; null keeps the server's default sender. */
  senderName: string | null;
  replyTo: string | null;
  /** A line at the foot of the company's emails, instead of the standard one. */
  emailFooter: string | null;
  /** A line at the foot of the company's PDFs (statements, tax packs). */
  documentFooter: string | null;
  /** Its own address in its own Microsoft 365, once a test email went through; emails then go from there. */
  sendFrom: string | null;
};

const clean = (s: string | null | undefined) => (s ?? '').trim() || null;

export function brandOf(c: BrandSource | null | undefined): Brand {
  const isGroup = !c || c.relationship === 'group';
  const name = isGroup ? 'Lakeba' : c!.display_name;
  return {
    name, isGroup,
    legalName: clean(c?.legal_name) ?? c?.display_name ?? 'Lakeba Group Limited',
    portalName: `${name} Investor Portal`,
    askName: clean(c?.ask_name) ?? `Ask ${name}`,
    color: isGroup ? LAKEBA_BLUE : clean(c!.brand_color) ?? LAKEBA_BLUE,
    contactEmail: clean(c?.contact_email) ?? LAKEBA_CONTACT,
    senderName: clean(c?.sender_name),
    replyTo: clean(c?.reply_to),
    emailFooter: clean(c?.email_footer),
    documentFooter: clean(c?.document_footer),
    sendFrom: !isGroup && c?.ms_tenant_id && c.mail_from_verified_at ? clean(c.mail_from) : null,
  };
}

/**
 * A venture's colour as the portal's accent (buttons, links, highlights) for its
 * investors: only when white text on it stays readable (contrast 3:1 or more);
 * otherwise null, and the portal keeps Lakeba's blue. Never for Lakeba itself.
 */
export function accentOf(c: { relationship: string; brand_color?: string | null } | null | undefined) {
  const hex = c && c.relationship !== 'group' ? clean(c.brand_color) : null;
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const [r, g, b] = [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05) >= 3 ? hex : null;
}

/** The columns brandOf reads, for selects of entities. */
export const BRAND_COLUMNS = 'code, display_name, legal_name, relationship, brand_color, sender_name, reply_to, contact_email, ask_name, email_footer, document_footer, ms_tenant_id, mail_from, mail_from_verified_at';
