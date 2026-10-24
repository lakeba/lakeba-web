import type { APIRoute } from 'astro';
import { serviceClient } from '../../lib/admin';

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/**
 * News images (covers and pictures in articles) from the private "news-media"
 * bucket, for everyone: public posts are public, and the website links here.
 * Each upload has its own name, so responses can be cached for a year.
 */
export const GET: APIRoute = async ({ params }) => {
  const path = params.path ?? '';
  const ext = /^[a-z0-9-]+(\/[a-z0-9-]+)*\/[A-Za-z0-9._-]+\.(png|jpg|webp|gif)$/.exec(path)?.[2];
  if (!ext || path.includes('..')) return new Response('Not found', { status: 404 });
  const { data, error } = await serviceClient().storage.from('news-media').download(path);
  if (error || !data) return new Response('Not found', { status: 404 });
  return new Response(data, {
    headers: {
      'content-type': TYPES[ext],
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    },
  });
};
