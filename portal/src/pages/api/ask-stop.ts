import type { APIRoute } from 'astro';
import { running } from '../../lib/ask-running';

/** The Stop button: ends the answer being written for this conversation (only the person's own). */
export const POST: APIRoute = async ({ request, locals, url }) => {
  if (request.headers.get('origin') !== url.origin || !locals.user) return new Response('Forbidden', { status: 403 });
  const { conversationId } = (await request.json().catch(() => ({}))) as { conversationId?: string };
  const live = conversationId ? running.get(conversationId) : undefined;
  if (live && live.userId === locals.user.id) live.stop.abort();
  return new Response(null, { status: 204 });
};
