import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';

// News & Media comes from the investor portal, which holds every post and
// serves the published public ones as a JSON feed. It is fetched once per
// build; the portal triggers the deploy workflow when news changes.
// (src/content/news/ holds the old Markdown export and is no longer read.)
const NEWS_FEED_URL = process.env.NEWS_FEED_URL ?? 'https://investors.lakeba.com/api/public/news.json';

// Body images are remote, so let the browser defer them.
const lazyImages = (html: string) =>
  html.replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading="lazy"').replace(/<img\b(?![^>]*\bdecoding=)/gi, '<img decoding="async"');

type FeedItem ={ id: string; html?: string; [key: string]: unknown };

const news = defineCollection({
  loader: {
    name: 'portal-news-feed',
    load: async ({ store, parseData, logger }) => {
      let items: FeedItem[];
      try {
        const res = await fetch(NEWS_FEED_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const body = (await res.json()) as { items?: FeedItem[] };
        if (!Array.isArray(body.items)) throw new Error('response has no "items" array');
        items = body.items;
      } catch (err) {
        throw new Error(`News feed could not be loaded from ${NEWS_FEED_URL}: ${(err as Error).message}`, { cause: err });
      }
      // Never publish an empty News & Media section.
      if (items.length === 0) throw new Error(`News feed at ${NEWS_FEED_URL} returned zero items; refusing to build an empty news section.`);

      store.clear();
      for (const { html = '', ...data } of items) {
        const id = String(data.id ?? '');
        if (!id) throw new Error(`News feed at ${NEWS_FEED_URL} has an item without an id.`);
        store.set({ id, data: await parseData({ id, data }), rendered: { html: lazyImages(html) } });
      }
      logger.info(`Loaded ${items.length} news items from ${NEWS_FEED_URL}`);
    },
  },
  schema: z.object({
    id: z.string(),
    title: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    excerpt: z.string().default(''),
    // SEO text; the portal falls back to the excerpt.
    description: z.string().optional(),
    venture: z.string(),
    categories: z.array(z.string()).default([]),
    cover: z.string().url().nullable().optional(),
    shareImage: z.string().url().nullable().optional(),
    // Link-only items point to coverage elsewhere and have no body.
    external: z.boolean().default(false),
    // A url starting with "../" is another article on this site.
    source: z.object({ url: z.string(), name: z.string() }).nullable().optional(),
    // Press releases: the press kit (images), PDF and media contact.
    press: z.object({
      pdf: z.string().url(),
      kit: z.array(z.object({ url: z.string().url(), label: z.string() })).default([]),
      contact: z.object({ name: z.string(), email: z.string(), phone: z.string().default('') }),
      summary: z.string().default(''),
    }).nullable().optional(),
  }),
});

export const collections = { news };
