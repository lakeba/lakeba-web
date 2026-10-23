import type { APIRoute } from 'astro';
import { notifyAdmins } from '../../lib/notify';

/** A shareholder rates one of their own Ask Lakeba answers (👍 1 / 👎 -1). */
export const POST: APIRoute = async ({ request, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const body = await request.json().catch(() => null);
  const rating = Number(body?.rating);
  if (typeof body?.id !== 'string' || ![1, -1].includes(rating)) return Response.json({ error: 'Invalid rating.' }, { status: 400 });
  const { error } = await locals.supabase.rpc('rate_ask_answer', {
    exchange_id: body.id,
    rating,
    note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null,
  });
  if (error) return Response.json({ error: 'Could not save your rating.' }, { status: 404 });
  if (rating === -1) await notifyAdmins({ kind: 'admin_ask_feedback', origin: url.origin, link: '/admin/ask-review', title: 'An Ask Lakeba answer was rated 👎', body: `${locals.profile?.email ?? 'An investor'} rated an Ask Lakeba answer as unhelpful${typeof body.note === 'string' && body.note ? `: “${body.note.slice(0, 200)}”` : ''}. Review it in Admin → Ask review.` });
  return Response.json({ ok: true });
};
