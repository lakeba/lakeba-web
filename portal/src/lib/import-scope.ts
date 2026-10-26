import type { APIContext, AstroGlobal } from 'astro';

/**
 * Which company an Import data request is for. Group Admins work on the whole
 * platform, or on one company with ?company=CODE. Anyone else (a venture's own
 * admins) works on one company they manage the register of: ?company=CODE,
 * else the company they are viewing. `error` when there is none.
 */
export function importScope({ locals, url }: Pick<AstroGlobal | APIContext, 'locals' | 'url'>) {
  const access = locals.access;
  const asked = url.searchParams.get('company')?.toUpperCase() ?? null;
  const mine = locals.companies.filter((c) => access.can('investors.do', c.id));
  if (access.groupAdmin && !asked) return { scope: null, company: null, choices: mine, error: '' };
  const company = (asked ? mine.find((c) => c.code === asked) : mine.find((c) => c.id === locals.company?.id)) ?? (!asked && mine.length === 1 ? mine[0] : null);
  if (!company) return { scope: null, company: null, choices: mine, error: asked ? `You can’t import data for ${asked}.` : 'Choose the company whose data you work on.' };
  return { scope: { entityId: company.id, code: company.code }, company, choices: mine, error: '' };
}
