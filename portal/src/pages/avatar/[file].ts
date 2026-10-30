import type { APIRoute } from 'astro';
import { serviceClient } from '../../lib/admin';

/**
 * Serves a profile photo from the private "avatars" bucket to signed-in people (the middleware
 * asks everyone else to sign in). Each upload gets a new file name, so it can be cached for long.
 */
export const GET: APIRoute = async ({ params }) => {
  const file = params.file ?? '';
  if (!/^[0-9a-f-]{36}-\d+\.jpg$/.test(file)) return new Response('Not found', { status: 404 });
  const { data, error } = await serviceClient().storage.from('avatars').download(file);
  if (error || !data) return new Response('Not found', { status: 404 });
  return new Response(data, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
};
