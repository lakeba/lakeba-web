import { ApiError, endpoint, isUuid, json } from '../../../../lib/api/core';

/** GET /api/v1/documents/{id} — one document, with a download link valid for 5 minutes. */
export const GET = endpoint('documents/{id}', { scope: 'documents.view' }, async ({ svc, ctx, companyIds, audit }) => {
  const id = ctx.params.id;
  const { data: d } = isUuid(id) ? await svc.from('documents').select('id, title, summary, category, audience, mime_type, size_bytes, published_at, created_at, file_path, entity_id, entities(code)').eq('id', id).in('entity_id', companyIds).neq('audience', 'holder').maybeSingle() : { data: null };
  if (!d) throw new ApiError(404, 'not_found', 'No such document in this company.');
  const { data: signed } = await svc.storage.from('documents').createSignedUrl(d.file_path, 300);
  await audit('api_downloaded_document', { document_id: d.id, title: d.title });
  const { file_path: _f, entities, entity_id: _e, ...rest } = d;
  return json({ data: { company: (entities as unknown as { code: string }).code, ...rest, download_url: signed?.signedUrl ?? null, download_expires_in: 300 } });
});
