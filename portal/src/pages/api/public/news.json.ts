import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { absoluteBody, absoluteMedia, markdownToHtml } from '../../../lib/news-cms';

/**
 * Published public news, newest first, for the public website (read when it is
 * built). Never drafts, scheduled posts or shareholder-only posts.
 */
export const GET: APIRoute = async ({ url }) => {
  const { data, error } = await serviceClient().from('posts')
    .select('slug, title, excerpt, body_html, body_md, venture, categories, cover_url, external, source_url, source_name, seo_description, share_image_url, published_at, updated_at, entities(display_name)')
    .eq('visibility', 'public').lte('published_at', new Date().toISOString()).order('published_at', { ascending: false });
  if (error) return Response.json({ error: 'unavailable' }, { status: 503 });
  const origin = url.origin;
  const items = await Promise.all((data ?? []).map(async (p) => ({
    id: p.slug,
    title: p.title,
    date: p.published_at,
    updated: p.updated_at,
    excerpt: p.excerpt,
    description: p.seo_description || p.excerpt,
    venture: p.venture || (p.entities as unknown as { display_name: string } | null)?.display_name || 'Lakeba Group',
    categories: p.categories,
    cover: absoluteMedia(origin, p.cover_url),
    shareImage: absoluteMedia(origin, p.share_image_url ?? p.cover_url),
    external: p.external,
    source: p.source_url ? { url: p.source_url, name: p.source_name ?? '' } : null,
    html: p.external ? '' : absoluteBody(origin, p.body_html || (await markdownToHtml(p.body_md ?? ''))),
  })));
  return Response.json({ items }, { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } });
};
