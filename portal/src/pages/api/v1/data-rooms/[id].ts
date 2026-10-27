import { ApiError, endpoint, isUuid, json } from '../../../../lib/api/core';

/** GET /api/v1/data-rooms/{id} — a room, its documents and guests with what they opened. Guests' names and emails need "people.read". */
export const GET = endpoint('data-rooms/{id}', { scope: 'documents.view' }, async ({ svc, ctx, companyIds, can }) => {
  const id = ctx.params.id;
  const { data: r } = isUuid(id) ? await svc.from('data_rooms').select('id, name, description, closed_at, created_at, entities(code), data_room_documents(sort, documents(id, title))').eq('id', id).in('entity_id', companyIds).maybeSingle() : { data: null };
  if (!r) throw new ApiError(404, 'not_found', 'No such data room in this company.');
  const { data: guests } = await svc.from('data_room_guests').select('id, name, email, organisation, expires_at, nda_accepted_at, revoked_at, last_seen_at, created_at, data_room_views(document_id, viewed_at)').eq('room_id', id!).eq('is_test', false).order('created_at');
  const personal = can('people.read');
  return json({ data: {
    id: r.id, company: (r.entities as unknown as { code: string }).code, name: r.name, description: r.description, closed_at: r.closed_at, created_at: r.created_at,
    documents: ((r.data_room_documents ?? []) as unknown as { sort: number; documents: { id: string; title: string } }[]).sort((a, b) => a.sort - b.sort).map((d) => d.documents),
    guests: (guests ?? []).map((g) => ({
      id: g.id, ...(personal ? { name: g.name, email: g.email, organisation: g.organisation } : {}),
      status: g.revoked_at ? 'revoked' : new Date(g.expires_at) < new Date() ? 'expired' : g.nda_accepted_at ? 'agreed' : 'invited',
      expires_at: g.expires_at, terms_accepted_at: g.nda_accepted_at, last_seen_at: g.last_seen_at, invited_at: g.created_at,
      views: ((g.data_room_views ?? []) as { document_id: string; viewed_at: string }[]).map((v) => ({ document_id: v.document_id, viewed_at: v.viewed_at })),
    })),
  } });
});
