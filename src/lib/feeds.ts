import type { NewsEntry } from './news';

// RSS for news and press releases, and the Google News sitemap (built with the site).
const x = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const base = () => import.meta.env.BASE_URL.replace(/\/$/, '');
export const articleUrl = (site: URL, id: string) => new URL(`${base()}/news/${id}/`, site).href;

export function rss(site: URL, o: { title: string; description: string; path: string; items: NewsEntry[] }) {
  const items = o.items.slice(0, 50).map((n) => {
    const link = n.data.external && n.data.source?.url && !n.data.source.url.startsWith('../') ? n.data.source.url : articleUrl(site, n.id);
    return `<item><title>${x(n.data.title)}</title><link>${x(link)}</link><guid isPermaLink="false">lakeba-news-${x(n.id)}</guid><pubDate>${n.data.date.toUTCString()}</pubDate><category>${x(n.data.press ? 'Press release' : 'News')}</category><category>${x(n.data.venture)}</category><description>${x(n.data.press?.summary || n.data.description || n.data.excerpt)}</description>${n.data.cover ? `<enclosure url="${x(n.data.cover)}" type="image/${/\.png/i.test(n.data.cover) ? 'png' : /\.webp/i.test(n.data.cover) ? 'webp' : 'jpeg'}" length="0"/>` : ''}</item>`;
  }).join('\n');
  const self = new URL(`${base()}${o.path}`, site).href;
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${x(o.title)}</title><link>${x(new URL(`${base()}/`, site).href)}</link><description>${x(o.description)}</description><language>en-au</language><atom:link href="${x(self)}" rel="self" type="application/rss+xml"/>
${items}
</channel></rss>`, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
}

/** Google News sitemap: articles from the last two days (as Google asks). */
export function newsSitemap(site: URL, items: NewsEntry[], now = new Date()) {
  const recent = items.filter((n) => !n.data.external && now.getTime() - n.data.date.getTime() < 2 * 86_400_000);
  const urls = recent.map((n) => `<url><loc>${x(articleUrl(site, n.id))}</loc><news:news><news:publication><news:name>Lakeba</news:name><news:language>en</news:language></news:publication><news:publication_date>${n.data.date.toISOString()}</news:publication_date><news:title>${x(n.data.title)}</news:title></news:news></url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>`, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}

/** All pages, for search engines. */
export function sitemap(site: URL, items: NewsEntry[], pages: string[]) {
  const urls = [...pages.map((p) => `<url><loc>${x(new URL(`${base()}${p}`, site).href)}</loc></url>`), ...items.filter((n) => !n.data.external).map((n) => `<url><loc>${x(articleUrl(site, n.id))}</loc><lastmod>${(n.data.updated ?? n.data.date).toISOString()}</lastmod></url>`)].join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
