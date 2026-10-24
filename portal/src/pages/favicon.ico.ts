import type { APIRoute } from 'astro';

/** Browsers ask for /favicon.ico on pages without an icon link (e.g. newsletter web versions). */
export const GET: APIRoute = () => new Response(null, { status: 301, headers: { location: '/favicon.svg', 'cache-control': 'public, max-age=86400' } });
