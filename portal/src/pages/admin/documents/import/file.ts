import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/admin';
import { importCompanies, MAX_BYTES, MAX_FILES, readFile, type Settings } from '../../../../lib/document-import';

/**
 * Import documents: "start" opens an import with its settings; "file" stores and reads one file
 * (the page sends them one by one, so a long list doesn't hit request limits).
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const companies = await importCompanies(locals.access);
  if (!companies.length) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const svc = serviceClient();
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');

  if (intent === 'start') {
    const entityId = String(form.get('entity_id') ?? '');
    if (entityId && !companies.some((c) => c.id === entityId)) return Response.json({ error: 'Not allowed for that company.' }, { status: 403 });
    const settings: Settings = {
      financials_audience: form.get('financials_audience') === 'board' ? 'board' : 'all_investors',
      use_in_ask: form.get('use_in_ask') === 'on',
      share_with_group: form.get('share_with_group') === 'on',
      publish: form.get('publish') === 'quiet' ? 'quiet' : 'draft',
    };
    const { data, error } = await svc.from('document_imports').insert({ created_by: locals.user!.id, entity_id: entityId || null, settings }).select('id').single();
    if (error || !data) return Response.json({ error: 'The import could not be started.' }, { status: 500 });
    await locals.supabase.rpc('log_event', { event_action: 'admin_started_document_import', event_detail: { import_id: data.id } });
    return Response.json({ id: data.id });
  }

  if (intent === 'file') {
    const { data: imp } = await svc.from('document_imports').select('id, entity_id, settings, status, created_by').eq('id', String(form.get('import_id') ?? '')).maybeSingle();
    if (!imp || imp.created_by !== locals.user!.id || imp.status !== 'open') return Response.json({ error: 'This import is closed.' }, { status: 404 });
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) return Response.json({ error: 'Empty file.' }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: `Larger than ${MAX_BYTES / 1024 / 1024} MB.` }, { status: 400 });
    const { count } = await svc.from('document_import_items').select('id', { count: 'exact', head: true }).eq('import_id', imp.id);
    if ((count ?? 0) >= MAX_FILES) return Response.json({ error: `An import takes up to ${MAX_FILES} files.` }, { status: 400 });
    const folder = String(form.get('folder') ?? '').replace(/[^\p{L}\p{N} ._\-/()&]/gu, '').slice(0, 300);
    try {
      await readFile(svc, imp as never, { name: file.name.slice(0, 250), folder, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, companies);
    } catch (err) {
      return Response.json({ error: String((err as Error).message ?? err) }, { status: 500 });
    }
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'Unknown request.' }, { status: 400 });
};
