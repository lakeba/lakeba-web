import type { APIRoute } from 'astro';
import { allNews } from '../lib/news';
import { sitemap } from '../lib/feeds';

export const GET: APIRoute = async ({ site }) => sitemap(site!, await allNews(), ['/', '/news/', '/press/']);
