import type { APIRoute } from 'astro';
import { serviceClient } from '../../lib/admin';
import { LINK_SOURCES, TRACKED_LINKS } from '../../lib/links';

/**
 * Records a click on a tracked outbound link, then redirects to it. Works
 * signed out too (email links); the click is attributed when signed in.
 * Only known destinations are served, so this is not an open redirect.
 */
export const GET: APIRoute = async ({ params, url, locals, redirect }) => {
  const target = TRACKED_LINKS[params.link ?? ''];
  if (!target) return new Response('Not found', { status: 404 });
  const src = url.searchParams.get('src') ?? '';
  const source = (LINK_SOURCES as readonly string[]).includes(src) ? src : 'other';
  try {
    await serviceClient().from('link_clicks').insert({ link: params.link, source, user_id: locals.user?.id ?? null });
  } catch (error) {
    console.error('Could not record link click', error); // never block the redirect
  }
  return redirect(target, 302);
};
