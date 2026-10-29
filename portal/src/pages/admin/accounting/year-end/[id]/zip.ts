import type { APIRoute } from 'astro';
import JSZip from 'jszip';
import { serviceClient } from '../../../../../lib/admin';
import type { FileRef } from '../../../../../lib/reporting';

/** Everything provided for a year-end request, one folder per item, for the auditor. */
export const GET: APIRoute = async ({ params, locals }) => {
  const svc = serviceClient();
  const { data: r } = await svc.from('audit_requests').select('id, entity_id, title').eq('id', params.id ?? '').maybeSingle();
  if (!r) return new Response('Not found', { status: 404 });
  const { data: items } = await svc.from('audit_items').select('sort, title, files, note').eq('request_id', r.id).order('sort');
  const zip = new JSZip();
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80);
  for (const it of items ?? []) {
    const folder = zip.folder(`${String(it.sort + 1).padStart(2, '0')} ${safe(it.title)}`)!;
    if (it.note) folder.file('note.txt', it.note);
    const used = new Set<string>();
    for (const f of it.files as FileRef[]) {
      const { data } = await svc.storage.from('legal').download(f.path);
      if (!data) continue;
      // Two files with the same name in one item keep both.
      let name = safe(f.name) || 'file';
      for (let n = 2; used.has(name); n++) name = `${n} ${safe(f.name)}`;
      used.add(name);
      folder.file(name, new Uint8Array(await data.arrayBuffer()));
    }
  }
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  await locals.supabase.rpc('log_event', { event_action: 'admin_downloaded_audit_files', event_detail: { entity_id: r.entity_id, request_id: r.id } });
  // Headers take plain ASCII: the name with its dash and accents goes in filename* too.
  const name = `${safe(r.title).replace(/\s+/g, '-')}.zip`;
  return new Response(bytes, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '-')}"; filename*=UTF-8''${encodeURIComponent(name)}` } });
};
