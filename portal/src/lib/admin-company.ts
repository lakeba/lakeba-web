import type { Company } from './companies';

/*
 * Which companies an admin page works on. Group admins manage every company
 * with a portal; company admins only theirs (entity_admins). Row-level
 * security enforces the same limits; this drives the filters and forms.
 */
export type AdminScope = {
  companies: Company[];
  /** The company picked in the filter (?company=CODE), or null for "all of mine". */
  selected: Company | null;
  isGroupAdmin: boolean;
  /** Entity ids the page should show. */
  ids: string[];
  /** Default company for new items: the selected one, else the group (or the admin's only company). */
  defaultCompany: Company | null;
};

const COLUMNS = 'id, code, display_name, legal_name, relationship, portal, brand_color, tagline, logo_url, website';

export async function adminScope(locals: App.Locals, url: URL): Promise<AdminScope> {
  const isGroupAdmin = locals.profile?.role === 'admin';
  let query = locals.supabase.from('entities').select(COLUMNS).eq('portal', 'full').order('sort');
  if (!isGroupAdmin) query = query.in('id', locals.adminOf.length ? locals.adminOf : ['00000000-0000-0000-0000-000000000000']);
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

/**
 * Admin sections a company admin can use (scoped to their company by RLS and
 * the page filters). Exact paths have no sub-pages for them (e.g. the investor
 * detail page, which changes roles and resets two-step, stays with group admins).
 */
const COMPANY_ADMIN_EXACT = ['/admin', '/admin/investors', '/admin/holdings', '/admin/ventures', '/admin/ask-review', '/admin/ask-knowledge'];
const COMPANY_ADMIN_TREES = ['/admin/documents', '/admin/content', '/admin/agm', '/admin/queries'];
export const companyAdminMayOpen = (path: string) =>
  COMPANY_ADMIN_EXACT.includes(path) || COMPANY_ADMIN_TREES.some((p) => path === p || path.startsWith(`${p}/`));
