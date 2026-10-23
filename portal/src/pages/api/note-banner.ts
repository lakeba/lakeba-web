import type { APIRoute } from 'astro';
import { pendingNotes } from '../../lib/note-banner';

/** Closes the holding-notes banner for the notes shown now; back to the page it was closed on. */
export const POST: APIRoute = async ({ request, locals, url, redirect }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const form = await request.formData();
  const next = String(form.get('next') ?? '/');
  const back = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const userId = locals.user!.id;
  const notes = await pendingNotes(locals.supabase, userId);
  if (notes.length) {
    await locals.supabase.from('holding_note_dismissals').upsert(
      notes.map((n) => ({ user_id: userId, holder_id: n.holderId, share_class_id: n.classId, note_updated_at: n.updatedAt, dismissed_at: new Date().toISOString() })),
    );
    await locals.supabase.rpc('log_event', { event_action: 'holding_note_banner_closed', event_detail: { notes: notes.length } });
  }
  return redirect(back, 303);
};
