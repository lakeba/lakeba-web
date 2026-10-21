import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Public News & Media lives in the marketing site (../src/content/news);
// the portal lists it alongside shareholder-only posts and links to the site.
const publicNews = defineCollection({
  loader: glob({ pattern: '*.md', base: '../src/content/news' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    excerpt: z.string(),
    venture: z.string(),
    external: z.boolean().default(false),
    source: z.object({ url: z.string(), name: z.string() }).optional(),
  }),
});

export const collections = { publicNews };
