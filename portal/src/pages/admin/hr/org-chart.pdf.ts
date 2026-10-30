import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { hrCompanies, orgChartPdf, orgTree, type OrgPerson } from '../../../lib/hr';

/** Admin → HR → People → Org chart, as a PDF (the company picked, or every company this admin looks after). */
export const GET: APIRoute = async ({ url, locals }) => {
  const svc = serviceClient();
  const companies = await hrCompanies(svc, locals.access);
  const pick = companies.find((c) => c.code === url.searchParams.get('company')?.toUpperCase()) ?? null;
  const ids = pick ? [pick.id] : companies.map((c) => c.id);
  const { data } = await svc.from('people').select('id, entity_id, full_name, job_title, team, location, manager_id').in('entity_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).neq('status', 'left');
  const nameOf = new Map(companies.map((c) => [c.id, c.display_name]));
  const pdf = await orgChartPdf(`Org chart · ${pick?.display_name ?? 'All companies'}`, orgTree((data ?? []) as OrgPerson[]), (id) => nameOf.get(id) ?? '');
  await locals.supabase.rpc('log_event', { event_action: 'admin_downloaded_org_chart', event_detail: { company: pick?.code ?? null } });
  return new Response(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="org-chart-${(pick?.code ?? 'all').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf"`,
      'cache-control': 'no-store',
    },
  });
};
