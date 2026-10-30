import type { APIRoute } from 'astro';
import { auditQuery, emailsFor, readFilters } from '../../lib/admin-audit';

const MAX_ROWS = 50_000;

/** Quotes a CSV cell and neutralises spreadsheet formulas. */
const cell = (value: unknown) => {
  let s = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export const GET: APIRoute = async ({ url, locals }) => {
  const supabase = locals.supabase;
  const audit = await auditQuery(supabase, readFilters(url.searchParams));
  const { data: rows } = await audit.query.range(0, MAX_ROWS - 1);
  const emails = await emailsFor(supabase, (rows ?? []).map((r) => r.user_id));
  const { data: companies } = await supabase.from('entities').select('id, code');
  const codeOf = new Map((companies ?? []).map((c) => [c.id, c.code as string]));
  await supabase.rpc('log_event', { event_action: 'admin_exported_audit_log', event_detail: { rows: rows?.length ?? 0 } });

  const lines = [
    ['time_utc', 'user_email', 'company', 'action', 'detail'].map(cell).join(','),
    ...(rows ?? []).map((r) => [r.created_at, r.user_id ? emails.get(r.user_id) ?? '' : 'system', r.entity_id ? codeOf.get(r.entity_id) ?? '' : '', r.action, r.detail].map(cell).join(',')),
  ];
  return new Response(`${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="lakeba-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};
