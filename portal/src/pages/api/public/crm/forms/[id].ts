import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../../lib/admin';
import { submitForm, type Form } from '../../../../../lib/crm-marketing';

/**
 * A CRM form for a website (lib/crm-marketing.ts; the component is /embed/crm-form.js). GET: the form's fields.
 * POST: a submission. Only the websites listed on the form (and the portal's own landing page) may use it.
 */
const recent = new Map<string, number[]>();
const tooMany = (ip: string) => {
  const now = Date.now();
  const list = (recent.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now); recent.set(ip, list);
  return list.length > 6;
};
const load = async (id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data } = await serviceClient().from('crm_forms').select('*, entities(crm_enabled, display_name, brand_color)').eq('id', id).eq('active', true).maybeSingle();
  return data && (data as { entities: { crm_enabled: boolean } }).entities?.crm_enabled ? data as Form & { entities: { display_name: string; brand_color: string | null } } : null;
};
const cors = (f: Form | null, origin: string | null, self: string): Record<string, string> =>
  origin && f && (origin === self || f.allowed_origins.includes(origin)) ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {};

export const OPTIONS: APIRoute = async ({ params, request, url }) => new Response(null, { status: 204, headers: cors(await load(params.id ?? ''), request.headers.get('origin'), url.origin) });

export const GET: APIRoute = async ({ params, request, url }) => {
  const f = await load(params.id ?? '');
  if (!f) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({ headline: f.headline, intro: f.intro, fields: f.fields, button: f.button, consent: f.consent_text, company: f.entities.display_name, accent: f.entities.brand_color }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', ...cors(f, request.headers.get('origin'), url.origin) } });
};

export const POST: APIRoute = async ({ params, request, url, clientAddress, locals }) => {
  const f = await load(params.id ?? '');
  const origin = request.headers.get('origin');
  const headers = { 'content-type': 'application/json', ...cors(f, origin, url.origin) };
  if (!f) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers });
  if (origin && origin !== url.origin && !f.allowed_origins.includes(origin)) return new Response(JSON.stringify({ error: 'This website isn’t allowed to use the form.' }), { status: 403, headers });
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? clientAddress;
  if (tooMany(ip)) return new Response(JSON.stringify({ error: 'Too many tries: please wait a minute.' }), { status: 429, headers });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'bad_json' }), { status: 400, headers }); }
  if (body.website) return new Response(JSON.stringify({ ok: true, thank_you: f.thank_you }), { headers }); // the honeypot
  if (body.consent !== true) return new Response(JSON.stringify({ error: 'Please tick the box to agree.' }), { status: 422, headers });
  const values = Object.fromEntries(f.fields.map((x) => [x.key, String((body.values as Record<string, unknown> | undefined)?.[x.key] ?? '').slice(0, 4000)]));
  const utm = Object.fromEntries(Object.entries((body.utm as Record<string, unknown>) ?? {}).filter(([k, v]) => /^utm_[a-z]+$/.test(k) && typeof v === 'string').map(([k, v]) => [k, String(v).slice(0, 100)]));
  try {
    await submitForm(serviceClient(), f, values, { origin: origin ?? url.origin, page: String(body.page ?? '').slice(0, 500), utm, ip, central: locals.site?.central ?? url.origin });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 422, headers });
  }
  return new Response(JSON.stringify({ ok: true, thank_you: f.thank_you, redirect: f.redirect_url }), { headers });
};
