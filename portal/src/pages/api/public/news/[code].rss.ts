import type { APIRoute } from 'astro';
import { PUBLIC_SITE_URL } from 'astro:env/server';
import { serviceClient } from '../../../../lib/admin';
import { newsQuery, type ApiCompany } from '../../../../lib/news-api';

/**
 * A company's public news as an RSS feed (/api/public/news/MIST.rss), for its
 * website, newsletter tools and readers. Only what the news API would show; no
 * key, because it is public news. Articles link to the company's website
 * (?news=slug, where the website component opens them), Lakeba's to lakeba.com.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const GET: APIRoute = async ({ params, url }) => {
  const svc = serviceClient();
  const code = String(params.code ?? '').toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(code)) return new Response('Not found', { status: 404 });
  const { data: company } = await svc.from('entities').select('id, code, display_name, relationship, brand_color, website').eq('code', code).eq('portal', 'full').maybeSingle();
  if (!company) return new Response('Not found', { status: 404 });
  const { data } = await newsQuery(svc, company as ApiCompany).limit(30);
  const site = company.relationship === 'group' ? PUBLIC_SITE_URL.replace(/\/$/, '') : (company.website ?? '').replace(/\/$/, '');
  const link = (slug: string) => (company.relationship === 'group' ? `${site}/news/${slug}/` : site ? `${site}/?news=${slug}` : `${url.origin}/api/public/news/${code}.rss#${slug}`);
  const items = (data ?? []).map((p) => `<item><title>${esc(p.title)}</title><link>${esc(p.external && p.source_url ? p.source_url : link(p.slug))}</link><guid isPermaLink="false">${esc(`${code}:${p.slug}`)}</guid><pubDate>${new Date(p.published_at!).toUTCString()}</pubDate><description>${esc(p.excerpt ?? '')}</description></item>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${esc(`${company.display_name} news`)}</title><link>${esc(site || url.origin)}</link><description>${esc(`News from ${company.display_name}`)}</description><language>en-au</language>
${items}
</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'private, max-age=600', 'access-control-allow-origin': '*' } });
};
