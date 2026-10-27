import { ApiError, endpoint, json, page } from '../../../../lib/api/core';
import { keepRegisterPdf } from '../../../../lib/integrations/actions';
import { notifyAdmins } from '../../../../lib/notify';

/** GET /api/v1/register/imports — registers of members imported, newest first. */
export const GET = endpoint('register/imports', { scope: 'investors.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  const { data, count } = await svc.from('register_imports').select('id, entity_id, as_at, company_name, company_number, file_name, holders, holdings, movements, totals, created_at, entities(code)', { count: 'exact' })
    .in('entity_id', companyIds).order('created_at', { ascending: false }).range(p.from, p.to);
  return json({ data: (data ?? []).map(({ entities, entity_id: _e, ...r }) => ({ company: (entities as unknown as { code: string }).code, ...r })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});

/**
 * POST /api/v1/register/imports — sends a new register of members (the PDF as the body, Content-Type:
 * application/pdf). It is never applied straight away: the company's Admins are told, and check, preview and
 * confirm it in the portal like an upload. Needs "investors.do".
 */
export const POST = endpoint('register/imports', { scope: 'investors.do', write: true }, async ({ svc, ctx, company, audit, raw }) => {
  if (!(ctx.request.headers.get('content-type') ?? '').startsWith('application/pdf')) throw new ApiError(415 as never, 'pdf_only', 'Send the register as the body, with Content-Type: application/pdf.');
  const bytes = new Uint8Array(raw);
  const kept = await keepRegisterPdf(svc, company as never, bytes);
  if ('error' in kept) throw new ApiError(422, 'bad_file', kept.error!);
  const name = (ctx.request.headers.get('x-file-name') ?? 'register.pdf').slice(0, 120);
  const { data: msg } = await svc.from('inbound_messages').insert({ entity_id: company.id, kind: 'register.pdf', source: 'api', file_path: kept.path, status: 'needs_review', summary: `A register of members (${name}) was sent through the API: check and apply it.`, result: { file_name: name } }).select('id').single().throwOnError();
  await audit('inbound_received', { message_id: msg!.id, kind: 'register.pdf', file_name: name });
  await notifyAdmins({ kind: 'admin_integrations', entityId: company.id, title: `A register for ${company.display_name} is waiting`, body: `${name} was sent through the API. Check it and apply it in the portal: nothing changes until you do.`, link: `/admin/companies/${company.code}/integrations?tab=incoming`, origin: ctx.url.origin });
  return json({ data: { id: msg!.id, status: 'needs_review' } }, 202);
});
