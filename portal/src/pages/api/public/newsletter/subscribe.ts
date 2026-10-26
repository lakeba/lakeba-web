import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { PUBLIC_SITE_URL } from 'astro:env/server';
import { serviceClient } from '../../../../lib/admin';
import { hashToken } from '../../../../lib/newsletter';
import { sendMail } from '../../../../lib/mail';
import { brandOf } from '../../../../lib/brand';

// Newsletter sign-up from a public website: Lakeba's, or a venture's own (with
// "company": its code, from its website's address). Double opt-in: we email a
// confirmation link and only send newsletters once it's clicked. The answer is
// the same whatever happens, so the form can't be used to check who is subscribed.
const ALLOWED = new Set([new URL(PUBLIC_SITE_URL).origin, 'https://lakeba.com', 'https://www.lakeba.com', 'http://localhost:4321']);
const recent = new Map<string, number[]>();
const cors = (origin: string | null, allowed: Set<string> = ALLOWED) => (origin && allowed.has(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {});
const answer = (origin: string | null, status: number, allowed: Set<string>) => Response.json({ ok: status === 200, message: status === 200 ? 'Thanks! Please check your inbox and click the link to confirm.' : 'Please enter a valid email address.' }, { status, headers: cors(origin, allowed) });

/** A venture's website (https://mist.com and www.mist.com) may sign people up to that venture's list. */
const siteOrigins = (website: string | null) => {
  try { const u = new URL(website ?? ''); const bare = u.hostname.replace(/^www\./, ''); return [`${u.protocol}//${bare}`, `${u.protocol}//www.${bare}`]; } catch { return []; }
};
async function listFor(code: string | null) {
  if (!code) return null;
  const { data } = await serviceClient().from('entities').select('id, code, display_name, relationship, website, brand_color, sender_name, reply_to, contact_email, email_footer').eq('code', code.toUpperCase()).eq('portal', 'full').maybeSingle();
  return data && data.relationship !== 'group' ? data : null;
}

export const OPTIONS: APIRoute = async ({ request, url }) => {
  const origin = request.headers.get('origin');
  const venture = await listFor(url.searchParams.get('company'));
  const ok = origin && (venture ? siteOrigins(venture.website).includes(origin) : ALLOWED.has(origin));
  return new Response(null, { status: 204, headers: ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' } : {} });
};

export const POST: APIRoute = async ({ request, url, clientAddress }) => {
  const origin = request.headers.get('origin');
  const body = (request.headers.get('content-type') ?? '').includes('json') ? await request.json().catch(() => ({})) : Object.fromEntries(await request.formData());
  const code = String(body.company ?? url.searchParams.get('company') ?? '').trim() || null;
  const venture = await listFor(code);
  if (code && !venture) return new Response('Not found', { status: 404 });
  const allowed = venture ? new Set(siteOrigins(venture.website)) : ALLOWED;
  if (origin && !allowed.has(origin) && origin !== url.origin) return new Response('Forbidden', { status: 403 });
  const reply = (o: string | null, status = 200) => answer(o, status, allowed);
  const email = String(body.email ?? '').trim().toLowerCase().slice(0, 200);
  const name = String(body.name ?? '').trim().slice(0, 100);
  // Bots fill the hidden "website" field.
  if (String(body.website ?? '')) return reply(origin);
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return reply(origin, 400);
  if (body.consent !== true && body.consent !== 'on' && body.consent !== 'yes') return reply(origin, 400);
  // At most 5 sign-ups an hour from one address.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'unknown';
  const times = (recent.get(ip) ?? []).filter((t) => Date.now() - t < 3_600_000);
  if (times.length >= 5) return reply(origin);
  recent.set(ip, [...times, Date.now()]);

  const svc = serviceClient();
  const list = svc.from('newsletter_subscribers').select('id, status, confirm_sent_at').ilike('email', email);
  const { data: existing } = await (venture ? list.eq('entity_id', venture.id) : list.is('entity_id', null)).maybeSingle();
  if (existing?.status === 'subscribed') return reply(origin);
  // One confirmation email per address per 10 minutes.
  if (existing?.confirm_sent_at && Date.now() - new Date(existing.confirm_sent_at).getTime() < 600_000) return reply(origin);
  const token = randomBytes(24).toString('base64url');
  const row = { email, name, status: 'pending', confirm_token_hash: hashToken(token), confirm_sent_at: new Date().toISOString(), consent_ip: ip };
  const { error } = existing ? await svc.from('newsletter_subscribers').update(row).eq('id', existing.id) : await svc.from('newsletter_subscribers').insert({ ...row, source: 'website', entity_id: venture?.id ?? null });
  if (error) return reply(origin);
  if (venture) {
    await sendMail({
      to: email, subject: `Confirm your ${venture.display_name} newsletter subscription`, brand: brandOf(venture),
      text: `Hello${name ? ` ${name.split(' ')[0]}` : ''},\n\nPlease confirm that you'd like to receive the ${venture.display_name} newsletter.\n\nIf you didn't sign up, ignore this email and you won't hear from us.`,
      link: `${url.origin}/n/confirm/${token}`, linkLabel: 'Confirm my subscription',
      footer: `You receive this because this address was entered in the newsletter form on the ${venture.display_name} website.`,
    });
    return reply(origin);
  }
  await sendMail({
    to: email, subject: 'Confirm your Lakeba newsletter subscription',
    text: `Hello${name ? ` ${name.split(' ')[0]}` : ''},\n\nPlease confirm that you'd like to receive the Lakeba newsletter, with news from Lakeba Group and its ventures, about four times a year.\n\nIf you didn't sign up, ignore this email and you won't hear from us.`,
    link: `${url.origin}/n/confirm/${token}`, linkLabel: 'Confirm my subscription',
    footer: 'You receive this because this address was entered in the newsletter form on the Lakeba website.',
  });
  return reply(origin);
};
