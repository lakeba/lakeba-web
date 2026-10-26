import { COLUMNS, type Company } from './companies';
import type { Access } from './access';
import { AREAS, areaOf } from './permissions';
import { serviceClient } from './admin';

/*
 * Which companies an admin page works on, from the person's roles for the
 * page's area (System → Roles): the companies they may see when reading, and
 * the companies they may change ("do") when a form is sent, so a role that
 * sees the whole group but works on one company can't change the others.
 * Row-level security enforces the same limits; this drives the filters and forms.
 */
export type AdminScope = {
  companies: Company[];
  /** The company picked in the filter (?company=CODE), or null for "all of mine". */
  selected: Company | null;
  /** A group Admin (group-only settings and tools). */
  isGroupAdmin: boolean;
  /** Entity ids the page should show. */
  ids: string[];
  /** Default company for new items: the selected one, else the group (or the admin's only company). */
  defaultCompany: Company | null;
};


/** Companies covered by this area and level ('all' for the whole group); the overview counts every area. */
function covered(access: Access, path: string, level: 'view' | 'do'): 'all' | string[] {
  const area = areaOf(path);
  const lists = (area ? [area] : AREAS).map((a) => access.companies(`${a.key}.${level}`));
  if (lists.includes('all')) return 'all';
  return [...new Set((lists as string[][]).flat())];
}

export async function adminScope(locals: App.Locals, url: URL): Promise<AdminScope> {
  const isGroupAdmin = locals.access.groupAdmin;
  const ids = covered(locals.access, url.pathname, locals.writing ? 'do' : 'view');
  // The service client: a role may cover a company the person has no shares in.
  let query = serviceClient().from('entities').select(COLUMNS).eq('portal', 'full').order('sort');
  if (ids !== 'all') query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const { data } = await query;
  const companies = (data ?? []) as Company[];
  const code = url.searchParams.get('company')?.toUpperCase();
  const selected = companies.find((c) => c.code === code) ?? (companies.length === 1 ? companies[0] : null);
  return {
    companies, selected, isGroupAdmin,
    ids: selected ? [selected.id] : companies.map((c) => c.id),
    defaultCompany: selected ?? companies.find((c) => c.relationship === 'group') ?? companies[0] ?? null,
  };
}

/** A company id from a form, accepted only if this admin manages that company. */
export const formCompany = (scope: AdminScope, value: string) => scope.companies.find((c) => c.id === value) ?? null;
/** Keep the company filter on links and redirects within an admin page. */
export const withCompany = (scope: AdminScope, href: string) =>
  scope.selected && scope.companies.length > 1 ? `${href}${href.includes('?') ? '&' : '?'}company=${scope.selected.code}` : href;
