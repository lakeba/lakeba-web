import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { recipientByToken } from '../../../lib/newsletter';
import { EMAIL_PAGE_HEADERS } from '../../../lib/newsletter-design';

/** "View in your browser": the reader's own copy, exactly as sent. */
export const GET: APIRoute = async ({ params }) => {
  const r = await recipientByToken(serviceClient(), params.token ?? '');
  if (!r) return new Response('This newsletter link is not valid.', { status: 404 });
  return new Response(r.html, { headers: { ...EMAIL_PAGE_HEADERS, 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' } });
};
