import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// News & Media, imported from WordPress with scripts/wp-news-to-content.mjs.
const news = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/news' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      date: z.coerce.date(),
      excerpt: z.string(),
      venture: z.string(),
      categories: z.array(z.string()).default([]),
      cover: image().optional(),
      source: z.object({ url: z.string(), name: z.string() }).optional(),
      // Link-only items point to coverage elsewhere and have no body.
      external: z.boolean().default(false),
      wordpressId: z.number().optional(),
    }),
});

export const collections = { news };
