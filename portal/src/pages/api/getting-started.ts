import type { APIRoute } from 'astro';
import { serviceClient } from '../../lib/admin';

/** "Hide for now" on the Getting started card: away for two weeks, on every device; back to the Overview. */
export const POST: APIRoute = async ({ request, locals, url, redirect }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  if (!locals.access?.staff) return new Response('Forbidden', { status: 403 });
  const until = new Date(Date.now() + 14 * 86_400_000).toISOString();
  await serviceClient().from('profiles').update({ getting_started_hidden_until: until }).eq('id', locals.user!.id);
  return redirect('/admin', 303);
};
