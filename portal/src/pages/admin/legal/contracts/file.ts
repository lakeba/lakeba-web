import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/admin';
import { legalCompanies, todayIn } from '../../../../lib/legal';
import { readContract } from '../../../../lib/legal-contracts';

/**
 * Import contracts: one file per request (the page sends them one by one), read
 * by Lakeba AI into a contract waiting to be checked.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const svc = serviceClient();
  const companies = await legalCompanies(svc, locals.access, 'do');
  if (!companies.length) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const form = await request.formData();
  const entityId = String(form.get('entity_id') ?? '');
  const fixed = entityId ? companies.find((c) => c.id === entityId) ?? null : null;
  if (entityId && !fixed) return Response.json({ error: 'Not allowed for that company.' }, { status: 403 });
  // Leaving the company to Lakeba AI needs every company (a contract may land on any).
  if (!fixed && !locals.access.can('legal.do', null)) return Response.json({ error: 'Choose the company.' }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return Response.json({ error: 'Empty file.' }, { status: 400 });
  try {
    const id = await readContract(svc, { name: file.name.slice(0, 250), type: file.type, bytes: new Uint8Array(await file.arrayBuffer()), companies, fixed, userId: locals.user!.id, today: todayIn() });
    await locals.supabase.rpc('log_event', { event_action: 'admin_imported_contract', event_detail: { ...(fixed ? { entity_id: fixed.id } : {}), contract_id: id, file: file.name } });
    return Response.json({ id });
  } catch (err) {
    return Response.json({ error: String((err as Error).message ?? err) }, { status: 400 });
  }
};
