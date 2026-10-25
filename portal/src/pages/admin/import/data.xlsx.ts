import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serviceClient } from '../../../lib/admin';
import { exportRows, fillWorkbook } from '../../../lib/investor-export.mjs';

/**
 * The investor data workbook with everything in the portal today (group
 * Admins only, like the rest of Import data). Edit it and import it back.
 * It holds personal information, so each download is audited.
 */
export const GET: APIRoute = async ({ locals }) => {
  const svc = serviceClient();
  const template = await readFile(join(process.cwd(), 'templates', 'Lakeba-investor-data-template.xlsx'));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
  const when = new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'long', year: 'numeric' });
  const rows = await exportRows(svc);
  const file = await fillWorkbook(template, rows, `Filled with the data in the portal on ${when}. It contains personal information about investors: keep it access-controlled and delete copies you no longer need.`);
  await locals.supabase.rpc('log_event', { event_action: 'admin_exported_investor_data', event_detail: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])) });
  return new Response(file, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="Lakeba-investor-data-${today}.xlsx"`,
    },
  });
};
