import nodemailer from 'nodemailer';
import { MAIL_FROM, SMTP_URL } from 'astro:env/server';

const transport = SMTP_URL ? nodemailer.createTransport(SMTP_URL) : null;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Sends a short branded email. Without SMTP configured, it is skipped. */
export async function sendMail({ to, subject, text, link, linkLabel }: { to: string; subject: string; text: string; link?: string; linkLabel?: string }) {
  if (!transport) return;
  const button = link
    ? `<p style="margin:28px 0"><a href="${escape(link)}" style="background:#276ae7;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${escape(linkLabel ?? 'Open the portal')}</a></p>`
    : '';
  await transport.sendMail({
    from: MAIL_FROM,
    to,
    subject,
    text: link ? `${text}\n\n${link}` : text,
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;color:#0b1d37">
      <p style="font-weight:700;font-size:18px">lakeba · Investors</p>
      <p style="line-height:1.6">${escape(text).replace(/\n/g, '<br>')}</p>${button}
      <p style="color:#6b7a90;font-size:12px">You receive this as a Lakeba shareholder. Change email preferences in your portal profile.</p></div>`,
  });
}
