import type { APIRoute } from 'astro';

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

/**
 * Serves a company logo from the private "logos" bucket to signed-in people.
 * Each upload gets a new file name, so the response can be cached for long.
 * SVGs are sandboxed in case one is opened directly rather than as an image.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const file = params.file ?? '';
  const ext = /^[A-Z0-9]{2,8}-\d+\.(png|jpe?g|webp|svg)$/.exec(file)?.[1];
  if (!ext) return new Response('Not found', { status: 404 });
  const { data, error } = await locals.supabase.storage.from('logos').download(file);
  if (error || !data) return new Response('Not found', { status: 404 });
  return new Response(data, {
    headers: {
      'content-type': TYPES[ext],
      'cache-control': 'private, max-age=31536000, immutable',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  });
};
