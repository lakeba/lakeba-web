import { createHash, randomBytes } from 'node:crypto';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import type { serviceClient } from './admin';
import { brandOf } from './brand';
import { shortDate } from './format';
import { sendMail } from './mail';

type Svc = ReturnType<typeof serviceClient>;

export const DEFAULT_NDA = `By opening this data room you agree that:
• the documents and everything in them are confidential and are shared only so you can consider an investment;
• you won't copy, forward or share them, or their contents, with anyone except your professional advisers, who must keep them confidential too;
• you'll delete or destroy any copies if asked, or if you decide not to invest;
• each document is marked with your name, and every time you open one it is recorded.
The documents are not an offer of securities and may change. They are provided without any promise that they are complete or accurate.`;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** A new personal guest link: the token goes in the email, only its hash is stored. */
export function newGuestToken() {
  const token = randomBytes(24).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export type Guest = { id: string; room_id: string; name: string; email: string; organisation: string; expires_at: string; nda_accepted_at: string | null; revoked_at: string | null; is_test: boolean };
export type Room = { id: string; entity_id: string; name: string; description: string; nda_text: string; closed_at: string | null };

/** The guest and room for a link, or why it can't be used. */
export async function guestForToken(svc: Svc, token: string) {
  if (!token || token.length > 100) return { problem: 'invalid' as const };
  const { data: guest } = await svc.from('data_room_guests').select('id, room_id, name, email, organisation, expires_at, nda_accepted_at, revoked_at, is_test').eq('token_hash', hashToken(token)).maybeSingle();
  if (!guest) return { problem: 'invalid' as const };
  const { data: room } = await svc.from('data_rooms').select('id, entity_id, name, description, nda_text, closed_at').eq('id', guest.room_id).single();
  if (!room || room.closed_at || guest.revoked_at) return { problem: 'closed' as const };
  if (new Date(guest.expires_at) < new Date()) return { problem: 'expired' as const };
  return { guest: guest as Guest, room: room as Room };
}

export const requestIp = (request: Request, clientAddress?: string) =>
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || null;

/** Stamps every page with the guest's name, email and the date (a line along the foot and a faint diagonal mark). */
export async function watermarkPdf(bytes: Uint8Array, guest: { name: string; email: string; organisation: string }, company: string) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const when = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Sydney' }).format(new Date());
  const who = `${guest.name}${guest.organisation ? ` (${guest.organisation})` : ''} · ${guest.email}`;
  const foot = `Confidential · ${company} data room · ${who} · ${when}`;
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(6, Math.min(8, width / 90));
    page.drawText(foot, { x: 24, y: 12, size, font, color: rgb(0.45, 0.45, 0.5), opacity: 0.9 });
    const mark = `${guest.name} · ${guest.email}`;
    const big = Math.min(36, (Math.hypot(width, height) * 0.7) / Math.max(10, mark.length) * 1.8);
    const w = font.widthOfTextAtSize(mark, big);
    const angle = Math.atan2(height, width);
    page.drawText(mark, {
      x: width / 2 - (w / 2) * Math.cos(angle), y: height / 2 - (w / 2) * Math.sin(angle),
      size: big, font, color: rgb(0.5, 0.5, 0.55), opacity: 0.12, rotate: degrees((angle * 180) / Math.PI),
    });
  }
  pdf.setProducer('Lakeba investor portal');
  return pdf.save();
}

/**
 * Invites a guest: a personal link (only its hash is kept) and, unless `send` is false, the email.
 * Used by the Data rooms page, the company API and HubSpot data room requests.
 */
export async function inviteGuest(svc: Svc, a: {
  room: { id: string; entity_id: string; name: string }; company: { display_name: string; relationship: string; brand_color?: string | null } | null;
  guest: { name: string; email: string; organisation: string }; days: number; origin: string; invitedBy: string | null; send?: boolean;
  log: (action: string, detail: Record<string, unknown>) => Promise<unknown>;
}) {
  const { token, tokenHash } = newGuestToken();
  const expires = new Date(Date.now() + a.days * 86_400_000).toISOString();
  const { data: row, error } = await svc.from('data_room_guests').insert({ room_id: a.room.id, ...a.guest, token_hash: tokenHash, expires_at: expires, invited_by: a.invitedBy }).select('id').single();
  if (error || !row) return { error: error?.message ?? 'Could not add the guest.' };
  const link = `${a.origin}/room/${token}`;
  if (a.send !== false) {
    await sendMail({
      to: a.guest.email, subject: `${a.company?.display_name ?? 'Lakeba'}: confidential data room – ${a.room.name}`, brand: brandOf(a.company as never),
      text: `Hello ${a.guest.name},\n\nYou have been invited to the ${a.room.name} data room. It holds confidential documents for you to review. Please read and agree to the confidentiality terms when you open it.\n\nThis link is personal to you; please don't forward it. It works until ${shortDate.format(new Date(expires))}.`,
      link, linkLabel: 'Open the data room',
      footer: 'You receive this because you were invited to a confidential data room. Documents you open are marked with your name.',
    });
  }
  await a.log('data_room_guest_invited', { room_id: a.room.id, guest_id: row.id, email: a.guest.email, name: a.guest.name, days: a.days, emailed: a.send !== false });
  return { link, guestId: row.id };
}
