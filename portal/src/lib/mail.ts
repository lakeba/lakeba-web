import nodemailer from 'nodemailer';
import { MAIL_FROM, SMTP_URL } from 'astro:env/server';

const transport = SMTP_URL ? nodemailer.createTransport(SMTP_URL) : null;

/** Sends a fully built email (newsletters). Returns false when SMTP isn't configured. */
export async function sendRaw(message: { to: string; subject: string; html: string; text: string; replyTo?: string; headers?: Record<string, string>; from?: string; messageId?: string; attachments?: { filename: string; content: Buffer; contentType?: string }[] }) {
  if (!transport) return false;
  await transport.sendMail({ ...message, from: message.from || MAIL_FROM });
  return true;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Sends a short branded email. Without SMTP configured, it is skipped.
 * brand: the company it is from ("Lakeba" by default, e.g. "Ezifin" for a venture).
 */
export async function sendMail({ to, subject, text, link, linkLabel, brand = 'Lakeba', color = '#276ae7', footer }: { to: string; subject: string; text: string; link?: string; linkLabel?: string; brand?: string; color?: string; footer?: string }) {
  const isLakeba = brand === 'Lakeba';
  if (!transport) return;
  const button = link
    ? `<p style="margin:28px 0"><a href="${escape(link)}" style="background:${escape(color)};color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${escape(linkLabel ?? 'Open the portal')}</a></p>`
    : '';
  await transport.sendMail({
    from: MAIL_FROM,
    to,
    subject,
    text: link ? `${text}\n\n${link}` : text,
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;color:#0b1d37">
      <p style="font-weight:700;font-size:18px">${isLakeba ? 'lakeba · Investors' : `${escape(brand)} · Investors <span style="font-weight:400;font-size:12px;color:#6b7a90">powered by Lakeba</span>`}</p>
      <p style="line-height:1.6">${escape(text).replace(/\n/g, '<br>')}</p>${button}
      <p style="color:#6b7a90;font-size:12px">${footer ? escape(footer) : `You receive this as a${/^[AEIOU]/i.test(brand) ? 'n' : ''} ${escape(brand)} shareholder. Change email preferences in your portal profile.`}</p></div>`,
  });
}
