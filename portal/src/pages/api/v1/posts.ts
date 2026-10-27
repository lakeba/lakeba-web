import { ApiError, endpoint, json, page, since, str } from '../../../lib/api/core';
import { cleanHtml } from '../../../lib/news-cms';

/**
 * GET /api/v1/posts — the company's news posts, for investors and public ("visibility"), published or not.
 * ?published=true|false, ?updated_since, ?full=true for the text; limit, cursor.
 */
export const GET = endpoint('posts', { scope: 'news.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  const full = ctx.url.searchParams.get('full') === 'true';
  let q = svc.from('posts').select(`id, slug, title, excerpt, visibility, categories, cover_url, published_at, created_at, updated_at, on_lakeba_site, on_venture_site${full ? ', body_html' : ''}, entities(code)`, { count: 'exact' })
    .in('entity_id', companyIds).order('created_at', { ascending: false });
  const pub = ctx.url.searchParams.get('published');
  if (pub === 'true') q = q.not('published_at', 'is', null).lte('published_at', new Date().toISOString());
  if (pub === 'false') q = q.is('published_at', null);
  const s = since(ctx.url);
  if (s) q = q.gte('updated_at', s);
  const { data, count } = await q.range(p.from, p.to);
  return json({ data: ((data ?? []) as unknown as Record<string, unknown>[]).map(({ entities, ...d }) => ({ company: (entities as { code: string }).code, ...d })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});

/**
 * POST /api/v1/posts — a news post as a DRAFT: { title, excerpt, body_html, visibility (shareholders|public) }.
 * The HTML is cleaned like the editor's. Publish it in the portal. Needs "news.do".
 */
export const POST = endpoint('posts', { scope: 'news.do', write: true }, async ({ svc, company, body, audit }) => {
  const b = await body();
  const title = str(b, 'title', 200, true);
  const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'post';
  let slug = base;
  for (let i = 2; (await svc.from('posts').select('id').eq('slug', slug).maybeSingle()).data; i++) slug = `${base}-${i}`;
  const visibility = b.visibility === 'public' ? 'public' : 'shareholders';
  const { data, error } = await svc.from('posts').insert({ entity_id: company.id, slug, title, excerpt: str(b, 'excerpt', 500), body_html: cleanHtml(str(b, 'body_html', 500_000)), body_md: '', visibility, published_at: null, categories: [] }).select('id, slug').single();
  if (error || !data) throw new ApiError(422, 'not_added', error?.message ?? 'Couldn’t save the post.');
  await audit('api_added_post', { post_id: data.id, title });
  return json({ data: { id: data.id, slug: data.slug, title, visibility, published: false } }, 201);
});
