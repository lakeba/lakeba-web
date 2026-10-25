import type { APIRoute } from 'astro';
import { PUBLIC_SITE_URL } from 'astro:env/server';
import { serviceClient } from '../../../../lib/admin';
import { loadRelease, pressSettings } from '../../../../lib/press';
import { releasePdf } from '../../../../lib/press-pdf';

/** A published press release as a PDF (press kit). Never drafts, scheduled or withdrawn releases. */
export const GET: APIRoute = async ({ params }) => {
  const svc = serviceClient();
  const slug = String(params.slug ?? '');
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return new Response('Not found', { status: 404 });
  const { data: post } = await svc.from('posts').select('press_release_id, published_at, visibility').eq('slug', slug).maybeSingle();
  if (!post?.press_release_id || post.visibility !== 'public' || !post.published_at || new Date(post.published_at) > new Date()) return new Response('Not found', { status: 404 });
  const r = await loadRelease(svc, post.press_release_id);
  if (!r || r.status !== 'published') return new Response('Not found', { status: 404 });
  const bytes = await releasePdf(r, await pressSettings(svc), post.published_at, `${PUBLIC_SITE_URL.replace(/\/$/, '')}/news/${slug}/`);
  return new Response(bytes, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${slug}.pdf"`, 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
};
