import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serviceClient } from '../../../lib/admin';
import { importScope } from '../../../lib/import-scope';
import { exportRows, fillWorkbook } from '../../../lib/investor-export.mjs';

/**
 * The investor data workbook with the data in the portal today: everything
 * (group Admins), or one company's only (?company=CODE, and always for a
 * venture's own admins). Edit it and import it back. It holds personal
 * information, so each download is audited.
 */
export const GET: APIRoute = async (context) => {
  const { locals } = context;
  const { scope, company, error } = importScope(context);
  if (error) return new Response(error, { status: 403 });
  const svc = serviceClient();
  const template = await readFile(join(process.cwd(), 'templates', 'Lakeba-investor-data-template.xlsx'));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
  const when = new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'long', year: 'numeric' });
  const rows = await exportRows(svc, scope);
  const what = company ? `${company.display_name}’s data` : 'the data';
  const file = await fillWorkbook(template, rows, `Filled with ${what} in the portal on ${when}. It contains personal information about investors: keep it access-controlled and delete copies you no longer need.`);
  await locals.supabase.rpc('log_event', { event_action: 'admin_exported_investor_data', event_detail: { ...(company ? { company: company.code } : {}), ...Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])) } });
  return new Response(file, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${company ? `${company.code}-` : 'Lakeba-'}investor-data-${today}.xlsx"`,
    },
  });
};
