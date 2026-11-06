import type { APIRoute } from 'astro';
import { allNews } from '../../lib/news';
import { rss } from '../../lib/feeds';

export const GET: APIRoute = async ({ site }) => rss(site!, { title: 'Lakeba Press releases', description: 'Press releases from Lakeba Group and its ventures.', path: '/press/rss.xml', items: (await allNews()).filter((n) => n.data.press) });
