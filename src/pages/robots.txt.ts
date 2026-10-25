import type { APIRoute } from 'astro';

const base = () => import.meta.env.BASE_URL.replace(/\/$/, '');
export const GET: APIRoute = ({ site }) => new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL(`${base()}/sitemap.xml`, site).href}\nSitemap: ${new URL(`${base()}/news-sitemap.xml`, site).href}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
