import type { AstroCookies } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { brandOf } from './brand';

/*
 * Which companies a signed-in person belongs to, and which one they are
 * looking at. Membership comes from the database (my_entity_ids: holdings,
 * boards, company admins, group board, admins), never from the request.
 */
export type Company = {
  id: string; code: string; display_name: string; legal_name: string | null; relationship: 'group' | 'controlled' | 'portfolio';
  portal: 'full' | 'portfolio' | 'none'; brand_color: string | null; tagline: string; logo_url: string | null; website: string | null;
  company_number: string | null; country: string | null;
  /** Venture settings (see brand.ts); empty means Lakeba's. */
  slug: string | null; custom_domain: string | null; sender_name: string | null; reply_to: string | null; contact_email: string | null;
  ask_name: string | null; email_footer: string | null; document_footer: string | null;
  ask_enabled: boolean; board_qa_enabled: boolean;
  shareholder_address: string | null; ask_monthly_budget_usd: number | null;
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
export const COLUMNS = 'id, code, display_name, legal_name, relationship, portal, brand_color, tagline, logo_url, website, company_number, country, '
  + 'slug, custom_domain, sender_name, reply_to, contact_email, ask_name, email_footer, document_footer, ask_enabled, board_qa_enabled, shareholder_address, ask_monthly_budget_usd';

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
export const brandName = (c: Company | null) => brandOf(c).name;
export const legalName = (c: Company | null) => brandOf(c).legalName;
/**
 * The company's registration line for documents: "ACN 123 456 789" (9 digits)
 * or "ABN 12 345 678 901" (11 digits), as entered otherwise, plus the country
 * when it isn't Australia. Empty when neither is known.
 */
export function companyIdentity(c: { company_number?: string | null; country?: string | null } | null) {
  const raw = (c?.company_number ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  const number = !raw ? '' : /^(ACN|ABN|ARBN|NZBN)\b/i.test(raw) ? raw
    : digits.length === 9 && digits.length === raw.replace(/\s/g, '').length ? `ACN ${digits.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')}`
    : digits.length === 11 && digits.length === raw.replace(/\s/g, '').length ? `ABN ${digits.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4')}`
    : raw;
  const country = (c?.country ?? '').trim();
  return [number, country && !/^(australia|au)$/i.test(country) ? country : ''].filter(Boolean).join(' · ');
}
