import type { APIRoute } from 'astro';
import { allNews } from '../lib/news';
import { newsSitemap } from '../lib/feeds';

export const GET: APIRoute = async ({ site }) => newsSitemap(site!, await allNews());
