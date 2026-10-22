import type { AstroCookies } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Which companies a signed-in person belongs to, and which one they are
 * looking at. Membership comes from the database (my_entity_ids: holdings,
 * boards, company admins, group board, admins), never from the request.
 */
export type Company = {
  id: string; code: string; display_name: string; legal_name: string | null; relationship: 'group' | 'controlled' | 'portfolio';
  portal: 'full' | 'portfolio' | 'none'; brand_color: string | null; tagline: string; logo_url: string | null; website: string | null;
};
export type CompanyContext = {
  /** Companies with a full portal that this person belongs to (all of them for admins). */
  companies: Company[];
  /** The company being viewed. */
  current: Company | null;
  /** Lakeba Group, when this person belongs to it. */
  group: Company | null;
  /** Companies this person is a company admin of (from entity_admins). */
  adminOf: string[];
};

export const COMPANY_COOKIE = 'lakeba-company';
const COLUMNS = 'id, code, display_name, legal_name, relationship, portal, brand_color, tagline, logo_url, website';

export async function loadCompanyContext(supabase: SupabaseClient, cookies: AstroCookies): Promise<CompanyContext> {
  const [{ data: memberIds }, { data: visible }, { data: admins }] = await Promise.all([
    supabase.rpc('my_entity_ids'),
    supabase.from('entities').select(COLUMNS).order('sort'),
    supabase.from('entity_admins').select('entity_id'),
  ]);
  const member = new Set(((memberIds ?? []) as unknown[]).map((r) => (typeof r === 'string' ? r : (r as { my_entity_ids: string }).my_entity_ids)));
  const companies = ((visible ?? []) as Company[]).filter((c) => member.has(c.id) && c.portal === 'full');
  const group = companies.find((c) => c.relationship === 'group') ?? null;
  const wanted = cookies.get(COMPANY_COOKIE)?.value;
  const current = companies.find((c) => c.code === wanted) ?? group ?? companies[0] ?? null;
  return { companies, current, group, adminOf: (admins ?? []).map((a) => a.entity_id as string) };
}

/** Brand name for headings: "Lakeba" for the group, otherwise the company's name. */
export const brandName = (c: Company | null) => (!c || c.relationship === 'group' ? 'Lakeba' : c.display_name);
export const legalName = (c: Company | null) => c?.legal_name || c?.display_name || 'Lakeba Group Limited';
