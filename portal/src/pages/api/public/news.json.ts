import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { absoluteBody, absoluteMedia, markdownToHtml } from '../../../lib/news-cms';
import { type Release, settingsFor } from '../../../lib/press';

/**
 * Published public news, newest first, for the public website (read when it is
 * built). Never drafts, scheduled posts or shareholder-only posts.
 */
export const GET: APIRoute = async ({ url }) => {
  const { data, error } = await serviceClient().from('posts')
    .select('slug, title, excerpt, body_html, body_md, venture, categories, cover_url, external, source_url, source_name, seo_description, share_image_url, published_at, updated_at, press_release_id, entities(display_name)')
    .eq('visibility', 'public').lte('published_at', new Date().toISOString()).order('published_at', { ascending: false });
  if (error) return Response.json({ error: 'unavailable' }, { status: 503 });
  const origin = url.origin;
  // Press releases also carry their press kit, PDF and media contact.
  const releaseIds = (data ?? []).map((p) => p.press_release_id).filter(Boolean) as string[];
  const svc = serviceClient();
  const { data: releases } = releaseIds.length ? await svc.from('press_releases').select('id, kit, summary, status, entity_id').in('id', releaseIds) : { data: [] };
  const byId = new Map(((releases ?? []) as Pick<Release, 'id' | 'kit' | 'summary' | 'status' | 'entity_id'>[]).map((r) => [r.id, r]));
  // Each release's media contact: its press desk's (Lakeba's, or a non-controlling venture's own).
  const contacts = new Map(await Promise.all((releases ?? []).map(async (r) => [r.id, await settingsFor(svc, r)] as const)));
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
    press: p.press_release_id && byId.get(p.press_release_id)?.status === 'published' && contacts.get(p.press_release_id) ? {
      pdf: `${origin}/api/public/press/${p.slug}.pdf`,
      kit: byId.get(p.press_release_id)!.kit.map((k) => ({ url: absoluteMedia(origin, k.url)!, label: k.label })),
      contact: { name: contacts.get(p.press_release_id)!.contact_name, email: contacts.get(p.press_release_id)!.contact_email, phone: contacts.get(p.press_release_id)!.contact_phone },
      summary: byId.get(p.press_release_id)!.summary,
    } : null,
  })));
  return Response.json({ items }, { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } });
};
