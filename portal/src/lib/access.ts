import type { serviceClient } from './admin';
import { ALL_PERMISSIONS, AREAS, areaOf } from './permissions';

type Svc = ReturnType<typeof serviceClient>;

// What the signed-in person may do, from their roles (loaded once per request
// by the middleware into locals.access). Like the database's can(), staff
// permissions only count after two-step sign-in. A role for the whole group
// covers every company; a role for one company covers only that company.

export type HeldRole = { id: string; role_key: string; name: string; entity_id: string | null; expires_at: string | null };
export type Access = {
  roles: HeldRole[];
  /** The person holds a staff role (whether or not two-step is done yet). */
  staff: boolean;
  /** Permission held for the whole group, or for this company. */
  can: (perm: string, entityId?: string | null) => boolean;
  /** Permission held anywhere (the group or any company). */
  canAny: (perm: string) => boolean;
  /** Companies this permission covers: 'all' (a group role) or a list of company ids. */
  companies: (perm: string) => 'all' | string[];
  /** May open this admin path (its area's "view", anywhere). */
  mayOpen: (path: string) => boolean;
  groupAdmin: boolean;
};

export const NO_ACCESS: Access = { roles: [], staff: false, can: () => false, canAny: () => false, companies: () => [], mayOpen: () => false, groupAdmin: false };

export async function loadAccess(svc: Svc, userId: string, strong: boolean): Promise<Access> {
  const now = new Date().toISOString();
  const { data } = await svc.from('user_roles').select('id, role_key, entity_id, expires_at, roles(name, role_permissions(permission))').eq('user_id', userId).or(`expires_at.is.null,expires_at.gt.${now}`);
  const rows = (data ?? []) as unknown as { id: string; role_key: string; entity_id: string | null; expires_at: string | null; roles: { name: string; role_permissions: { permission: string }[] } | null }[];
  const roles: HeldRole[] = rows.map((r) => ({ id: r.id, role_key: r.role_key, name: r.roles?.name ?? r.role_key, entity_id: r.entity_id, expires_at: r.expires_at }));
  // permission → companies (null = the whole group)
  const map = new Map<string, Set<string | null>>();
  if (strong) for (const r of rows) for (const p of r.roles?.role_permissions ?? []) {
    if (!map.has(p.permission)) map.set(p.permission, new Set());
    map.get(p.permission)!.add(r.entity_id);
  }
  const can = (perm: string, entityId?: string | null) => { const s = map.get(perm); return Boolean(s && (s.has(null) || (entityId ? s.has(entityId) : false))); };
  const canAny = (perm: string) => (map.get(perm)?.size ?? 0) > 0;
  const groupAdmin = strong && roles.some((r) => r.role_key === 'admin' && r.entity_id === null);
  return {
    roles, staff: roles.length > 0, can, canAny, groupAdmin,
    companies: (perm) => { const s = map.get(perm); if (!s) return []; return s.has(null) ? 'all' : [...s].filter(Boolean) as string[]; },
    mayOpen: (path) => {
      if (path === '/admin') return map.size > 0;
      const area = areaOf(path);
      if (!area) return groupAdmin; // anything not mapped to an area stays with group admins
      return canAny(`${area.key}.view`) && (!area.groupOnly || can(`${area.key}.view`, null));
    },
  };
}

const under = (path: string, p: string) => path === p || path.startsWith(`${p}/`);
/** Tools that stay with group Admins whatever the roles: sending notifications, the LinkedIn campaign, Ask's tests. */
const GROUP_ADMIN_ONLY = ['/admin/notifications', '/admin/linkedin', '/admin/ask-tests'];
/**
 * Where an approver without "do" may send forms: the approval actions only
 * (the pages check "approve" again). Press settings are for approvers.
 */
const APPROVAL_ACTIONS: Record<string, { intents: string[]; paths?: string[] }> = {
  press: { intents: ['approve', 'request-changes', 'unschedule', 'withdraw', 'correct', 'post-bluesky', 'post-x', 'wire-email', 'record', 'remove', 'send'], paths: ['/admin/press/settings'] },
  // HR: signing off a performance review.
  hr: { intents: ['sign-off'] },
  // Finance: approving a commission run.
  accounting: { intents: ['approve-run'] },
};
/** The form's action, as approval checks see it ("then=send" on a distribution counts as send). */
export const formAction = (form: FormData | null) => (form?.get('then') === 'send' ? 'send' : String(form?.get('intent') ?? ''));

/**
 * The one gate for every admin request. Opening a page needs "see" for its
 * area; sending a form (anything but GET) needs "do" there, or "approve" where
 * the pages handle approvals. View-only roles therefore can't change anything,
 * whatever a page does inside. An investor's own page (account actions) opens
 * for people who see the whole register and changes only for group Admins.
 */
export function adminMayRequest(a: Access, path: string, writing: boolean, action = '') {
  if (a.groupAdmin) return true;
  if (GROUP_ADMIN_ONLY.some((p) => under(path, p))) return false;
  // Legal requests: anyone with a staff role sends and follows them (each page checks the company).
  if (under(path, '/admin/legal-requests')) return a.roles.length > 0;
  // What's new: every staff member (each entry checks its area).
  if (under(path, '/admin/whats-new')) return !writing && a.roles.length > 0;
  // Integrations: the list for any company Admin (each company's page checks its own Admins).
  if (under(path, '/admin/integrations')) return !writing && a.roles.some((r) => r.role_key === 'admin');
  // Import data: the whole platform for group Admins; one company's workbook for whoever manages a company's register (lib/import-scope.ts).
  // Boardroom (a venture's company secretary): its board meetings, the Observer and decks, the minutes papers and the meeting files; each page checks the company.
  if (!a.canAny('legal.view') && a.canAny('boardroom.view') && [/^\/admin\/legal\/meetings\//, /^\/admin\/legal\/papers\/[0-9a-f-]{36}(\/pdf)?$/, /^\/admin\/legal\/file$/, /^\/admin\/legal\/minute-book(\/[A-Za-z0-9-]+)?$/].some((re) => re.test(path))) return writing ? a.canAny('boardroom.do') : true;
  // Board Ask: asking (and rating answers) needs only "see"; the law library, tests and review need "do".
  if (under(path, '/admin/board-ask') && !['library', 'tests', 'review'].some((p) => under(path, `/admin/board-ask/${p}`))) return a.canAny('boardask.view');
  if (under(path, '/admin/import')) return a.canAny('investors.do');
  // Performance: Finance (accounting.do) opens the scorecards to propose results, which HR confirms; each page checks the company.
  if (/^\/admin\/hr\/performance(\/[0-9a-f-]{36})?$/.test(path) && a.canAny('accounting.do') && (!writing || action === 'propose')) return true;
  if (path.startsWith('/admin/investors/')) return !writing && a.can('investors.view', null);
  // Approvals: for anyone who prepares or approves something; each item checks its own area.
  if (under(path, '/admin/approvals')) return ALL_PERMISSIONS.some((p) => !p.endsWith('.view') && a.canAny(p));
  if (!a.mayOpen(path)) return false;
  if (!writing) return true;
  const area = areaOf(path);
  if (!area) return false;
  const scoped = (perm: string) => (area.groupOnly ? a.can(perm, null) : a.canAny(perm));
  if (scoped(`${area.key}.do`)) return true;
  const approvals = APPROVAL_ACTIONS[area.key];
  return Boolean(approvals && scoped(`${area.key}.approve`) && (approvals.intents.includes(action) || approvals.paths?.some((p) => under(path, p))));
}

/** The menu's areas this person may open. */
export const openableAreas = (a: Access) => AREAS.filter((x) => a.canAny(`${x.key}.view`) && (!x.groupOnly || a.can(`${x.key}.view`, null)));
/** May open this menu item (the area, and not a group-Admin-only tool). */
export const mayOpenItem = (a: Access, href: string) => adminMayRequest(a, href, false);
