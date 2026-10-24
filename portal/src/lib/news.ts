import type { SupabaseClient } from '@supabase/supabase-js';
import type { Company } from './companies';

/** external: a link-only item that opens elsewhere (press coverage); public: also on the website. */
export type NewsItem = { title: string; excerpt: string; date: Date; href: string; external: boolean; public: boolean; label: string; cover: string | null };

/**
 * The company's shareholder-only posts and every public post (public anyway,
 * so every investor sees them), newest first. All are managed in Admin → News.
 */
export async function loadNews(supabase: SupabaseClient, limit?: number, company?: Company | null): Promise<NewsItem[]> {
  let query = supabase.from('posts')
    .select('slug, title, excerpt, published_at, visibility, venture, external, source_url, cover_url, entity_id, entities(display_name)')
    .or(`entity_id.eq.${company?.id ?? '00000000-0000-0000-0000-000000000000'},visibility.eq.public`)
    .not('published_at', 'is', null).lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false });
  if (limit) query = query.limit(limit);
  const { data } = await query;
  return (data ?? []).map((p) => {
    const isPublic = p.visibility === 'public';
    const linkOnly = isPublic && p.external && Boolean(p.source_url);
    return {
      title: p.title, excerpt: p.excerpt, date: new Date(p.published_at!), cover: p.cover_url,
      href: linkOnly ? p.source_url! : `/news/${p.slug}`, external: linkOnly, public: isPublic,
      label: isPublic ? p.venture || (p.entities as unknown as { display_name: string } | null)?.display_name || 'Lakeba Group'
        : company && company.relationship !== 'group' ? `${company.display_name} shareholders` : 'Shareholders',
    };
  });
}
