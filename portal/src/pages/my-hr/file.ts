import type { APIRoute } from 'astro';
import { streamFile } from '../../lib/stream-file';
import { serviceClient } from '../../lib/admin';
import { myRecords, policiesFor } from '../../lib/hr';

/** A file for the employee: a document HR shared with them, their grant letter, or a published policy that applies to them. */
export const GET: APIRoute = async ({ url, locals, request }) => {
  const svc = serviceClient();
  const path = url.searchParams.get('path') ?? '';
  const records = (await myRecords(svc, locals.user!.id)).filter((r) => r.status !== 'left');
  const ids = records.map((r) => r.id).concat('00000000-0000-0000-0000-000000000000');
  const [{ data: doc }, { data: grant }] = await Promise.all([
    svc.from('person_documents').select('id').eq('file_path', path).in('person_id', ids).eq('visible_to_employee', true).maybeSingle(),
    svc.from('equity_grants').select('id').eq('letter_path', path).in('person_id', ids).maybeSingle(),
  ]);
  let allowed = Boolean(doc || grant);
  if (!allowed) for (const r of records) if ((await policiesFor(svc, r.entity_id)).some((p) => p.file_path === path)) { allowed = true; break; }
  if (!allowed || !path) return new Response('Not found', { status: 404 });
    return streamFile(svc, 'legal', path, request);
};
