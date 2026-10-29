import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../../lib/admin';
import { mayMeeting } from '../../../../../lib/boardroom';
import { DECK_COLUMNS, ROLES, type Deck } from '../../../../../lib/decks';
import { observerMeeting } from '../../../../../lib/observer';

/**
 * What the room screen shows during a presentation.
 *   GET  ?deck=<id> (a preview of that deck) → {presentation, deck}
 *   POST {action: "show", deck_id, slide, state} (the Observer tablet) | {action: "clear"}
 * The screen is for those who see the company's legal records; the tablet needs "do".
 */
export const GET: APIRoute = async ({ params, locals, url }) => {
  const svc = serviceClient();
  const { data: m } = await svc.from('board_meetings').select('id, entity_id, presentation').eq('id', params.id ?? '').maybeSingle();
  if (!m || !mayMeeting(locals.access, m.entity_id)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const p = (m.presentation ?? null) as { deck_id: string; slide: number; state: string; at: string } | null;
  const deckId = url.searchParams.get('deck') ?? p?.deck_id ?? null;
  if (!deckId) return Response.json({ presentation: null, deck: null });
  const { data: d } = await svc.from('board_decks').select(DECK_COLUMNS).eq('id', deckId).eq('meeting_id', m.id).maybeSingle();
  const deck = d as unknown as Deck | null;
  return Response.json({
    presentation: url.searchParams.get('deck') ? null : p,
    deck: deck && { id: deck.id, title: deck.title, role: ROLES[deck.role].name, source: deck.source, file: deck.file_path ? `/admin/legal/file?path=${encodeURIComponent(deck.file_path)}` : null, slides: deck.slides.map((s) => ({ title: s.title, points: s.points, figures: s.figures, page: s.page ?? null })) },
  }, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: APIRoute = async ({ request, params, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const svc = serviceClient();
  const m = await observerMeeting(svc, locals.access, params.id ?? '');
  if (!m) return Response.json({ error: 'Not found.' }, { status: 404 });
  const b = await request.json().catch(() => ({})) as { action?: string; deck_id?: string; slide?: number; state?: string };
  if (b.action === 'clear') {
    await svc.from('board_meetings').update({ presentation: null }).eq('id', m.id);
    return Response.json({ ok: true });
  }
  if (b.action !== 'show') return Response.json({ error: 'Unknown request.' }, { status: 400 });
  const { data: deck } = await svc.from('board_decks').select('id, status, slides, presented_at, title, role').eq('id', String(b.deck_id ?? '')).eq('meeting_id', m.id).maybeSingle();
  if (!deck || deck.status !== 'approved') return Response.json({ error: 'Only an approved deck can be presented.' }, { status: 400 });
  const slide = Math.max(0, Math.min((deck.slides as unknown[]).length - 1, Math.floor(Number(b.slide) || 0)));
  const state = ['presenting', 'paused', 'answering', 'done'].includes(String(b.state)) ? String(b.state) : 'presenting';
  await svc.from('board_meetings').update({ presentation: { deck_id: deck.id, slide, state, at: new Date().toISOString() } }).eq('id', m.id).throwOnError();
  if (!deck.presented_at) {
    await svc.from('board_decks').update({ presented_at: new Date().toISOString() }).eq('id', deck.id);
    await locals.supabase.rpc('log_event', { event_action: 'admin_presented_board_deck', event_detail: { entity_id: m.entity_id, meeting_id: m.id, deck_id: deck.id, title: deck.title } });
  }
  return Response.json({ ok: true, slide });
};
