import { getCollection } from 'astro:content';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SITE_URL } from 'astro:env/server';

export type NewsItem = { title: string; excerpt: string; date: Date; href: string; external: boolean; label: string };

/** Shareholder-only portal posts and public News & Media, newest first. */
export async function loadNews(supabase: SupabaseClient, limit?: number): Promise<NewsItem[]> {
  const [{ data: posts }, publicNews] = await Promise.all([
    supabase.from('posts').select('slug, title, excerpt, published_at').order('published_at', { ascending: false }),
    getCollection('publicNews'),
  ]);
  const site = PUBLIC_SITE_URL.replace(/\/$/, '');
  const items: NewsItem[] = [
    ...(posts ?? []).map((p) => ({ title: p.title, excerpt: p.excerpt, date: new Date(p.published_at!), href: `/news/${p.slug}`, external: false, label: 'Shareholders' })),
    ...publicNews.map((n) => ({ title: n.data.title, excerpt: n.data.excerpt, date: n.data.date, href: `${site}/news/${n.id}/`, external: true, label: n.data.venture })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
  return limit ? items.slice(0, limit) : items;
}
