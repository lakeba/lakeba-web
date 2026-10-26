import type { APIRoute } from 'astro';
import Papa from 'papaparse';
import { serviceClient } from '../../../lib/admin';

/** A company's newsletter subscribers as a spreadsheet (?company=CODE; Lakeba's list without it). */
export const GET: APIRoute = async ({ locals, url }) => {
  const svc = serviceClient();
  const code = url.searchParams.get('company')?.toUpperCase();
  const { data: company } = code
    ? await svc.from('entities').select('id, code, relationship').eq('code', code).maybeSingle()
    : await svc.from('entities').select('id, code, relationship').eq('relationship', 'group').maybeSingle();
  if (!company || !locals.access.can('newsletters.do', company.id)) return new Response('Not allowed', { status: 403 });
  const query = svc.from('newsletter_subscribers').select('email, name, status, source, created_at, confirmed_at, unsubscribed_at').order('created_at');
  const { data } = await (company.relationship === 'group' ? query.is('entity_id', null) : query.eq('entity_id', company.id));
  await locals.supabase.rpc('log_event', { event_action: 'admin_exported_newsletter_subscribers', event_detail: { company: company.code, rows: data?.length ?? 0 } });
  return new Response(Papa.unparse(data ?? [], { escapeFormulae: true }), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="newsletter-subscribers-${company.code}.csv"`, 'cache-control': 'no-store' } });
};
