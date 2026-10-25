import type { APIRoute } from 'astro';
import { allNews } from '../../lib/news';
import { rss } from '../../lib/feeds';

export const GET: APIRoute = async ({ site }) => rss(site!, { title: 'Lakeba News', description: 'News from Lakeba Group and its ventures.', path: '/news/rss.xml', items: await allNews() });
