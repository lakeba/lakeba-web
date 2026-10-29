import { randomUUID } from 'node:crypto';
import type { serviceClient } from './admin';
import { notifyMembers } from './notify';
import { financeTeam, senders, todayIn, type FileRef } from './reporting';

// Year-end and audit requests (Accounting, phase 4): what the auditor needs
// from a venture for a financial year. Lakeba makes the list (from a standard
// one), the venture provides each item with its files, Lakeba accepts it or
// asks again; everything provided downloads as one zip for the auditor.

type Svc = ReturnType<typeof serviceClient>;

export const STANDARD_ITEMS: { title: string; detail: string }[] = [
  { title: 'Trial balance at year end', detail: 'Exported from the accounting system after the last adjustments.' },
  { title: 'Draft financial statements', detail: 'If already prepared by the accountant.' },
  { title: 'Bank statements at year end', detail: 'For every bank, credit card and loan account, showing the closing balance.' },
  { title: 'Bank reconciliations at year end', detail: 'One for each account, agreeing the statement to the ledger.' },
  { title: 'Aged receivables at year end', detail: 'With any amounts that may not be collected.' },
  { title: 'Aged payables at year end', detail: 'And accruals for costs not yet invoiced.' },
  { title: 'Fixed asset register', detail: 'Additions and disposals in the year, with invoices for large additions.' },
  { title: 'Loan and finance agreements', detail: 'New or changed in the year, and lenders’ year-end statements.' },
  { title: 'Payroll summary and superannuation', detail: 'Payroll summary for the year (STP finalisation) and super paid against super due.' },
  { title: 'GST and BAS', detail: 'The year’s BAS lodgements and a reconciliation to the ledger.' },
  { title: 'Income tax', detail: 'The last tax return lodged and the tax workings for this year, if prepared.' },
  { title: 'Share register and share issues', detail: 'The register at year end and documents for shares or options issued in the year.' },
  { title: 'Board minutes and resolutions', detail: 'For the year and since year end (the minute book in the portal, if kept there).' },
  { title: 'Significant contracts', detail: 'Contracts entered into in the year that the auditor should know about.' },
  { title: 'Balances with group companies', detail: 'Amounts owed to and by other Lakeba group companies at year end, and fees charged between them.' },
  { title: 'Events after year end', detail: 'Anything significant since year end: new funding, legal claims, large contracts lost or won.' },
  { title: 'Management representation letter', detail: 'Signed by the directors, near the end of the audit.' },
];
export const ITEM_STATES = { requested: 'To provide', provided: 'Provided', accepted: 'Accepted', not_applicable: 'Not applicable' } as const;
export type AuditRequest = { id: string; entity_id: string; year_end: string; title: string; due_on: string; auditor: string; status: 'open' | 'done'; created_at: string };
export type AuditItem = { id: string; request_id: string; sort: number; title: string; detail: string; status: keyof typeof ITEM_STATES; files: FileRef[]; note: string; review_note: string; updated_at: string };
export const REQUEST_COLUMNS = 'id, entity_id, year_end, title, due_on, auditor, status, created_at';
export const ITEM_COLUMNS = 'id, request_id, sort, title, detail, status, files, note, review_note, updated_at';

/** Files for an item, under the company: `{entity}/reporting/audit-{request}/…` (reporting file routes serve them). */
export async function storeItemFiles(svc: Svc, entityId: string, requestId: string, files: File[]) {
  const out: FileRef[] = [];
  for (const f of files.slice(0, 20)) {
    if (f.size > 25 * 1024 * 1024) throw new Error(`${f.name} is larger than 25 MB.`);
    const path = `${entityId}/reporting/audit-${requestId}/${randomUUID()}-${f.name.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(-120)}`;
    const { error } = await svc.storage.from('legal').upload(path, new Uint8Array(await f.arrayBuffer()), { contentType: f.type || 'application/octet-stream' });
    if (error) throw new Error(`${f.name} could not be stored.`);
    out.push({ path, name: f.name.slice(0, 200), size: f.size });
  }
  return out;
}

export const tellVenture = async (svc: Svc, r: Pick<AuditRequest, 'id' | 'entity_id'>, origin: string, title: string, body: string) =>
  notifyMembers({ kind: 'reporting', userIds: await senders(svc, r.entity_id), origin, link: `/admin/reporting/year-end/${r.id}`, entityId: r.entity_id, title, body }).catch(() => 0);
export const tellFinance = async (svc: Svc, r: Pick<AuditRequest, 'id'>, origin: string, title: string, body: string) =>
  notifyMembers({ kind: 'reporting', userIds: await financeTeam(svc), origin, link: `/admin/accounting/year-end/${r.id}`, title, body }).catch(() => 0);

/** Reminders for open year-end requests: a week before the due day, then weekly once overdue (with the reporting reminders each morning). */
export async function auditReminders(svc: Svc, origin: string) {
  const today = todayIn();
  const { data: reqs } = await svc.from('audit_requests').select(`${REQUEST_COLUMNS}, entities(display_name)`).eq('status', 'open');
  let sent = 0;
  for (const r of (reqs ?? []) as unknown as (AuditRequest & { entities: { display_name: string } | null })[]) {
    const left = Math.round((Date.parse(`${r.due_on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
    if (left > 7) continue;
    const stage = left >= 0 ? 'soon' : `over:${Math.floor(-left / 7)}`;
    const { data: claimed } = await svc.from('notification_jobs').upsert({ key: `audit_reminder:${r.id}:${stage}` }, { onConflict: 'key', ignoreDuplicates: true }).select('key');
    if (!claimed?.length) continue;
    const { count } = await svc.from('audit_items').select('id', { count: 'exact', head: true }).eq('request_id', r.id).eq('status', 'requested');
    if (!count) continue;
    await tellVenture(svc, r, origin, `${r.entities?.display_name}: ${count} year-end item${count === 1 ? '' : 's'} ${left >= 0 ? `due ${left === 0 ? 'today' : `in ${left} days`}` : 'overdue'}`,
      `${count} item${count === 1 ? ' is' : 's are'} still to provide for “${r.title}” (due ${r.due_on}). Upload them in the portal.`);
    sent++;
  }
  return sent;
}
