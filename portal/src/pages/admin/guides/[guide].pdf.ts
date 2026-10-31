import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GUIDES } from '../../../lib/guides';

// A department's staff guide (templates/guides/<key>.pdf, built by npm run guides:pdf). The middleware has
// already checked that this person may open it (lib/access.ts → lib/guides.ts).
export const GET: APIRoute = async ({ params }) => {
  const guide = GUIDES.find((g) => g.key === params.guide);
  if (!guide) return new Response('Not found', { status: 404 });
  const file = await readFile(join(process.cwd(), 'templates', 'guides', `${guide.key}.pdf`)).catch(() => null);
  if (!file) return new Response('This guide hasn’t been built yet.', { status: 404 });
  return new Response(new Uint8Array(file), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${guide.file}"`,
      'cache-control': 'private, max-age=300',
    },
  });
};
