import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { apiPost, keyFor, newsQuery, overLimit, touchKey } from '../../../lib/news-api';

/**
 * A company's public news for its own website (see lib/news-api.ts).
 *   GET /api/v1/news?key=…                     newest first: limit (1–50, default 10), offset, since (changed since, ISO date), category, full=1 for the text
 *   GET /api/v1/news?key=…&slug=…              one post, with its text
 * The key can also be sent as "Authorization: Bearer …" (secret keys, from a server).
 */
const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, max-age=60', vary: 'origin', ...headers } });

const cors = (origin: string | null) => (origin ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'authorization' } : {});

export const OPTIONS: APIRoute = ({ request }) => new Response(null, { status: 204, headers: cors(request.headers.get('origin')) });

export const GET: APIRoute = async ({ request, url }) => {
  const svc = serviceClient();
  const origin = request.headers.get('origin');
  const raw = url.searchParams.get('key') ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const found = await keyFor(svc, raw.trim());
  // Refusals can be read by the page (the website component says why) and aren't kept, so a fixed key works at once.
  const refuse = (code: string, error: string, status: number) => json({ error, code }, status, { ...cors(origin), 'cache-control': 'no-store' });
  if (!found) return refuse('invalid_key', 'This key isn’t valid (it may have been revoked).', 401);
  const { key, company } = found;
  // A secret key never comes from a web page; a publishable one only from its website's addresses.
  if (key.kind === 'secret' && origin) return refuse('secret_key', 'This is a secret key, for servers. Use a publishable key (pk_live_…) in web pages.', 403);
  if (key.kind === 'publishable' && (!origin || !key.allowed_origins.includes(origin))) {
    return refuse('wrong_website', origin ? `This key doesn’t work from ${origin}. Add that address to the key on the portal’s Website news page.` : 'This key only works from a web page on its website.', 403);
  }
  if (overLimit(key.id)) return json({ error: 'Too many requests. Please slow down.' }, 429, cors(origin));
  await touchKey(svc, key.id);
  const site = { name: company.display_name, code: company.code, color: company.brand_color ?? '#276ae7', website: company.website };

  const slug = url.searchParams.get('slug');
  if (slug) {
    if (!/^[a-z0-9-]{1,120}$/.test(slug)) return json({ error: 'Not found.' }, 404, cors(origin));
    const { data } = await newsQuery(svc, company).eq('slug', slug).maybeSingle();
    if (!data) return json({ error: 'Not found.' }, 404, cors(origin));
    return json({ company: site, item: await apiPost(url.origin, data as never, true) }, 200, cors(origin));
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 50);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  let q = newsQuery(svc, company);
  const since = url.searchParams.get('since');
  if (since && !Number.isNaN(Date.parse(since))) q = q.gte('updated_at', new Date(since).toISOString());
  const category = url.searchParams.get('category')?.trim();
  if (category) q = q.contains('categories', [category.slice(0, 60)]);
  const { data, count } = await q.range(offset, offset + limit - 1);
  const full = url.searchParams.get('full') === '1';
  const items = await Promise.all((data ?? []).map((p) => apiPost(url.origin, p as never, full)));
  return json({ company: site, items, total: count ?? items.length, next_offset: offset + items.length < (count ?? 0) ? offset + items.length : null }, 200, cors(origin));
};
