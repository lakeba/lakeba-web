import type { serviceClient } from './admin';
import type { Access } from './access';
import { notifyMembers } from './notify';

type Svc = ReturnType<typeof serviceClient>;

// Editing the register on screen (Admin → Companies, and a holder's page):
// who may change what, what a deletion would take with it, and the old → new
// summary every change shows before it's saved. The import workbook follows
// the same rules (investor-import.mjs).
//
// Area "investors": "view" sees the register; "do" changes it, for the whole
// group or one company. Company-wide things (a holder's own details, who can
// see it, creating companies) need "do" for the whole group; holdings, share
// classes and boards need "do" for that company.

export const HOLDER_KINDS = { individual: 'Individual', company: 'Company', trust: 'Trust', super_fund: 'Super fund' } as const;
export const CLASS_KINDS = { ordinary: 'Ordinary', preference: 'Preference', options: 'Options', convertible_note: 'Convertible note', safe: 'SAFE', other: 'Other' } as const;
export const RELATIONSHIPS = { group: 'Group', controlled: 'Controlled venture', portfolio: 'Non-controlling investment' } as const;
export const PORTAL_ACCESS = { full: 'Full portal', portfolio: 'Portfolio entry only', none: 'Not in portal' } as const;
export const POSITIONS = { director: 'Director', chair: 'Chair', company_secretary: 'Company secretary', observer: 'Observer' } as const;

/** Companies (ids) this holder holds or held shares in. */
export async function companiesOfHolder(svc: Svc, holderId: string) {
  const { data } = await svc.from('holdings').select('share_classes(entity_id)').eq('holder_id', holderId);
  return [...new Set((data ?? []).map((r) => (r.share_classes as unknown as { entity_id: string } | null)?.entity_id).filter(Boolean))] as string[];
}

/** What this person may do on a holder's page. */
export function holderRights(access: Access, companies: string[]) {
  const sees = access.can('investors.view', null) || companies.some((e) => access.can('investors.view', e));
  return {
    sees,
    /** Name, kind, register ID, who can see it, deleting it: the whole group's register. */
    group: access.can('investors.do', null),
    /** Holdings and notes in this company's classes. */
    company: (entityId: string) => access.can('investors.do', entityId),
  };
}

/** Why this holder can't be deleted (null when it can): records that must stay. */
export async function holderBlocker(svc: Svc, holderId: string) {
  const [{ count: votes }, { count: docs }, { count: trades }] = await Promise.all([
    svc.from('proxy_votes').select('holder_id', { count: 'exact', head: true }).eq('holder_id', holderId),
    svc.from('documents').select('id', { count: 'exact', head: true }).eq('holder_id', holderId),
    svc.from('trade_interests').select('id', { count: 'exact', head: true }).eq('holder_id', holderId),
  ]);
  return votes ? 'it has proxy votes (meeting records)' : docs ? 'documents were published just for this holder' : trades ? 'it has secondary trading records' : null;
}

/** Why this share class can't be deleted (null when it can). */
export async function classBlocker(svc: Svc, classId: string) {
  const [{ count: holdings }, { count: prices }, { count: interests }, { count: matches }] = await Promise.all([
    svc.from('holdings').select('id', { count: 'exact', head: true }).eq('share_class_id', classId),
    svc.from('reference_prices').select('id', { count: 'exact', head: true }).eq('share_class_id', classId),
    svc.from('trade_interests').select('id', { count: 'exact', head: true }).eq('share_class_id', classId),
    svc.from('trade_matches').select('id', { count: 'exact', head: true }).eq('share_class_id', classId),
  ]);
  return holdings ? `${holdings} holding row${holdings === 1 ? '' : 's'} use it` : prices ? 'it has reference prices (Ventures & prices)' : interests || matches ? 'it has secondary trading records' : null;
}

/** "Label: old → new" for each field that changes. */
export function changes(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>, show: (k: string, v: unknown) => string = (_k, v) => fmt(v)) {
  return Object.entries(labels).filter(([k]) => k in after && norm(before[k]) !== norm(after[k])).map(([k, label]) => `${label}: ${show(k, before[k])} → ${show(k, after[k])}`);
}
const norm = (v: unknown) => (v == null || v === '' ? null : typeof v === 'number' ? v : /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : String(v));
const num = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 6 });
/** A value for a change summary: numbers grouped (12,500), text (including ACNs and dates) as written. */
export const fmt = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' ? num.format(v) : String(v));

/** A whole number of shares from a form ("12,500" → 12500); null when it isn't one. */
export const wholeShares = (s: string) => { const t = s.replace(/[,\s]/g, ''); return /^\d+$/.test(t) ? Number(t) : null; };
/** An optional amount ("$1.25" → 1.25, "" → null); NaN when it isn't a number. */
export const amount = (s: string) => { const t = s.replace(/[$,\s]/g, ''); return t === '' ? null : /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN; };
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** "Your holding statement is ready", to the people who see these holders (after holdings change). */
export async function tellStatementsReady(svc: Svc, holderIds: string[], asAt: string | null, origin: string) {
  const { data: members } = holderIds.length ? await svc.from('holder_members').select('user_id, holder_id').in('holder_id', holderIds) : { data: [] };
  const byUser = Map.groupBy(members ?? [], (m) => m.user_id);
  const when = asAt ? new Date(`${asAt}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  for (const [userId, rows] of byUser) {
    const one = rows.length === 1;
    await notifyMembers({
      kind: 'statement_ready', userIds: [userId], origin,
      link: one ? `/statement/${rows[0].holder_id}` : '/',
      title: 'Your holding statement is ready',
      body: `Your holdings${when ? ` as at ${when}` : ''} have been updated in the Lakeba investor portal. ${one ? 'Your holding statement is ready to open.' : `Statements for your ${rows.length} holdings are on your dashboard.`}`,
    });
  }
  return byUser.size;
}
