import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../../lib/admin';
import { crmScope } from '../../../../../lib/crm';
import { renderQuote, type Quote } from '../../../../../lib/crm-quotes';

// A quote as a PDF (CRM → a quote → Preview PDF; the deal room serves the same for the buyer).
export const GET: APIRoute = async ({ params, locals, url }) => {
  const svc = serviceClient();
  const scope = await crmScope(svc, locals, url);
  const { data: q } = await svc.from('crm_quotes').select('*').eq('id', params.id!).maybeSingle();
  // Sales leads approving it from Approvals may have the company picked elsewhere: any CRM company of theirs.
  if (!q || !locals.access.can('crm.view', q.entity_id) || (scope.current && scope.current.id !== q.entity_id && !scope.companies.some((c) => c.id === q.entity_id))) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(await renderQuote(svc, q as Quote)), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${q.number}${q.version > 1 ? `-v${q.version}` : ''}.pdf"` } });
};

