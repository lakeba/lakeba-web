import { endpoint, json } from '../../../../lib/api/core';

/** GET /api/v1/data-rooms — data rooms, their documents and how many guests (not test links). */
export const GET = endpoint('data-rooms', { scope: 'documents.view' }, async ({ svc, companyIds }) => {
  const { data } = await svc.from('data_rooms').select('id, name, description, closed_at, created_at, entities(code), data_room_documents(document_id, sort), data_room_guests(id, revoked_at, is_test)').in('entity_id', companyIds).order('created_at', { ascending: false });
  return json({ data: (data ?? []).map((r) => ({
    id: r.id, company: (r.entities as unknown as { code: string }).code, name: r.name, description: r.description, closed_at: r.closed_at, created_at: r.created_at,
    document_ids: ((r.data_room_documents ?? []) as { document_id: string; sort: number }[]).sort((a, b) => a.sort - b.sort).map((d) => d.document_id),
    active_guests: ((r.data_room_guests ?? []) as { revoked_at: string | null; is_test: boolean }[]).filter((g) => !g.revoked_at && !g.is_test).length,
  })) });
});
