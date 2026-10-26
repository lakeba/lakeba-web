import nodemailer from 'nodemailer';
import { MAIL_FROM, SMTP_URL } from 'astro:env/server';
import { brandOf, type Brand } from './brand';
import { sendAs } from './graph';

const transport = SMTP_URL ? nodemailer.createTransport(SMTP_URL) : null;

/** Sends a fully built email (newsletters). Returns false when SMTP isn't configured. */
export async function sendRaw(message: { to: string; subject: string; html: string; text: string; replyTo?: string; headers?: Record<string, string>; from?: string; messageId?: string; attachments?: { filename: string; content: Buffer; contentType?: string }[] }) {
  if (!transport) return false;
  await transport.sendMail({ ...message, from: message.from || MAIL_FROM });
  return true;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The default sender with another display name: "MIST" <investors@lakeba.com>. */
export function senderNamed(name: string | null) {
  if (!name) return MAIL_FROM;
  const address = MAIL_FROM.match(/<([^>]+)>/)?.[1] ?? MAIL_FROM.trim();
  return `"${name.replace(/["\\<>\r\n]/g, '')}" <${address}>`;
}

/**
 * Sends a short branded email. Without SMTP configured, it is skipped.
 * brand: the company it is from (Lakeba by default); its sender name, reply-to
 * and footer are used when the company has set them. A venture with its own
 * Microsoft 365 connected sends from its own address there instead.
 */
export async function sendMail({ to, subject, text, link, linkLabel, brand = brandOf(null), footer }: { to: string; subject: string; text: string; link?: string; linkLabel?: string; brand?: Brand; footer?: string }) {
  if (!transport && !brand.sendFrom) return;
  const button = link
    ? `<p style="margin:28px 0"><a href="${escape(link)}" style="background:${escape(brand.color)};color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${escape(linkLabel ?? 'Open the portal')}</a></p>`
    : '';
  const standard = `You receive this as a${/^[AEIOU]/i.test(brand.name) ? 'n' : ''} ${escape(brand.name)} shareholder. Change email preferences in your portal profile.`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;color:#0b1d37">
      <p style="font-weight:700;font-size:18px">${brand.isGroup ? 'lakeba · Investors' : `${escape(brand.name)} · Investors <span style="font-weight:400;font-size:12px;color:#6b7a90">powered by Lakeba</span>`}</p>
      <p style="line-height:1.6">${escape(text).replace(/\n/g, '<br>')}</p>${button}
      <p style="color:#6b7a90;font-size:12px">${footer ? escape(footer) : brand.emailFooter ? escape(brand.emailFooter) : standard}</p></div>`;
  if (brand.sendFrom) return sendAs(brand.sendFrom, { to, subject, html, replyTo: brand.replyTo });
  await transport!.sendMail({
    from: senderNamed(brand.senderName),
    replyTo: brand.replyTo ?? undefined,
    to,
    subject,
    text: link ? `${text}\n\n${link}` : text,
    html,
  });
}
