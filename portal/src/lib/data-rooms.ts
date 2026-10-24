import { createHash, randomBytes } from 'node:crypto';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import type { serviceClient } from './admin';

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

export type Guest = { id: string; room_id: string; name: string; email: string; organisation: string; expires_at: string; nda_accepted_at: string | null; revoked_at: string | null };
export type Room = { id: string; entity_id: string; name: string; description: string; nda_text: string; closed_at: string | null };

/** The guest and room for a link, or why it can't be used. */
export async function guestForToken(svc: Svc, token: string) {
  if (!token || token.length > 100) return { problem: 'invalid' as const };
  const { data: guest } = await svc.from('data_room_guests').select('id, room_id, name, email, organisation, expires_at, nda_accepted_at, revoked_at').eq('token_hash', hashToken(token)).maybeSingle();
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
