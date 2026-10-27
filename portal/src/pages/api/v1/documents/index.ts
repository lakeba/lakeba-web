import { ApiError, bool, endpoint, json, page, since, str } from '../../../../lib/api/core';
import { addDraftDocument } from '../../../../lib/integrations/actions';

/**
 * GET /api/v1/documents — the company's documents (not those for one holder): title, category, audience,
 * whether published. ?published=true|false, ?category, ?updated_since; limit, cursor.
 */
export const GET = endpoint('documents', { scope: 'documents.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  let q = svc.from('documents').select('id, title, summary, category, audience, mime_type, size_bytes, published_at, created_at, shared_with_group, entities(code)', { count: 'exact' })
    .in('entity_id', companyIds).neq('audience', 'holder').order('created_at', { ascending: false });
  const pub = ctx.url.searchParams.get('published');
  if (pub === 'true') q = q.not('published_at', 'is', null).lte('published_at', new Date().toISOString());
  if (pub === 'false') q = q.is('published_at', null);
  const category = ctx.url.searchParams.get('category');
  if (category) q = q.eq('category', category);
  const s = since(ctx.url);
  if (s) q = q.gte('created_at', s);
  const { data, count } = await q.range(p.from, p.to);
  return json({ data: (data ?? []).map(({ entities, ...d }) => ({ company: (entities as unknown as { code: string }).code, ...d })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});

/**
 * POST /api/v1/documents — { title, category (report|agm|update|governance|other), audience (all_investors|board),
 * summary, file_name, content_type, file_base64, knowledge_base }. It arrives as a draft: publish it in the
 * portal (or it waits for approval there). Needs "documents.do".
 */
export const POST = endpoint('documents', { scope: 'documents.do', write: true }, async ({ svc, company, body, audit }) => {
  const b = await body();
  const title = str(b, 'title', 200, true);
  const audience = b.audience === 'board' ? 'board' : 'all_investors';
  const data = str(b, 'file_base64', 40_000_000, true);
  const bytes = new Uint8Array(Buffer.from(data, 'base64'));
  const r = await addDraftDocument(svc, company as never, { title, summary: str(b, 'summary', 1000), category: str(b, 'category', 20) || 'other', audience, bytes, fileName: str(b, 'file_name', 120) || 'document.pdf', contentType: str(b, 'content_type', 100) || 'application/pdf', knowledgeBase: bool(b, 'knowledge_base') });
  if ('error' in r) throw new ApiError(422, 'not_added', r.error!);
  await audit('api_added_document', { document_id: r.id, title });
  return json({ data: { id: r.id, title, published: false } }, 201);
});
