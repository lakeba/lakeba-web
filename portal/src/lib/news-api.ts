import { createHash, randomBytes } from 'node:crypto';
import type { serviceClient } from './admin';
import { absoluteBody, absoluteMedia, markdownToHtml } from './news-cms';

type Svc = ReturnType<typeof serviceClient>;

/*
 * The news API (Admin → Companies → a company → Website news): a company's
 * published public news for its own website, read with a key. A secret key
 * (sk_live_…) is for the website's server or build and is refused from a
 * browser; a publishable key (pk_live_…) is for the website component and
 * only works from the addresses listed with it. Only a hash of each key is
 * kept, so the full key is shown once, when it is made.
 */

export type KeyKind = 'secret' | 'publishable';
export type ApiKey = { id: string; entity_id: string; name: string; kind: KeyKind; prefix: string; allowed_origins: string[]; last_used_at: string | null; created_at: string; revoked_at: string | null };
export type ApiCompany = { id: string; code: string; display_name: string; relationship: string; brand_color: string | null; website: string | null };

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export function newKey(kind: KeyKind) {
  const key = `${kind === 'secret' ? 'sk' : 'pk'}_live_${randomBytes(24).toString('base64url')}`;
  return { key, hash: hashKey(key), prefix: key.slice(0, 14) };
}

/** "https://www.mist.com/news" → "https://www.mist.com"; null when it isn't a web address. */
export function originOf(s: string) {
  try { const u = new URL(s.trim()); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; }
}

/** The live key and its company, or null. */
export async function keyFor(svc: Svc, key: string) {
  if (!/^(sk|pk)_live_[A-Za-z0-9_-]{20,64}$/.test(key)) return null;
  const { data } = await svc.from('news_api_keys').select('id, entity_id, name, kind, prefix, allowed_origins, last_used_at, created_at, revoked_at, entities(id, code, display_name, relationship, brand_color, website)')
    .eq('key_hash', hashKey(key)).is('revoked_at', null).maybeSingle();
  if (!data) return null;
  return { key: data as unknown as ApiKey, company: data.entities as unknown as ApiCompany };
}

const used = new Map<string, number>();
/** Notes when a key was last used (at most once a minute per key). */
export async function touchKey(svc: Svc, id: string) {
  if (Date.now() - (used.get(id) ?? 0) < 60_000) return;
  used.set(id, Date.now());
  await svc.from('news_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', id);
}

const recent = new Map<string, number[]>();
/** Fair use: 120 requests a minute per key. */
export function overLimit(id: string) {
  const now = Date.now();
  const times = (recent.get(id) ?? []).filter((t) => now - t < 60_000);
  times.push(now);
  recent.set(id, times);
  return times.length > 120;
}

const COLUMNS = 'slug, title, excerpt, body_html, body_md, categories, cover_url, external, source_url, source_name, seo_description, share_image_url, published_at, updated_at';

/**
 * A company's published public news for its own website, newest first: its own
 * posts marked for its website. For Lakeba Group, the news on lakeba.com.
 */
export function newsQuery(svc: Svc, company: ApiCompany) {
  const q = svc.from('posts').select(COLUMNS, { count: 'exact' }).eq('visibility', 'public').lte('published_at', new Date().toISOString());
  return (company.relationship === 'group' ? q.eq('on_lakeba_site', true) : q.eq('entity_id', company.id).eq('on_venture_site', true))
    .order('published_at', { ascending: false });
}

type Row = { slug: string; title: string; excerpt: string; body_html: string | null; body_md: string | null; categories: string[]; cover_url: string | null; external: boolean;
  source_url: string | null; source_name: string | null; seo_description: string | null; share_image_url: string | null; published_at: string; updated_at: string };

/** One post as the API returns it (images and links as full addresses). */
export async function apiPost(origin: string, p: Row, full: boolean) {
  return {
    slug: p.slug, title: p.title, date: p.published_at, updated: p.updated_at, excerpt: p.excerpt, description: p.seo_description || p.excerpt,
    categories: p.categories, cover: absoluteMedia(origin, p.cover_url), shareImage: absoluteMedia(origin, p.share_image_url ?? p.cover_url),
    external: p.external, source: p.source_url ? { url: p.source_url, name: p.source_name ?? '' } : null,
    ...(full ? { html: p.external ? '' : absoluteBody(origin, p.body_html || (await markdownToHtml(p.body_md ?? ''))) } : {}),
  };
}
