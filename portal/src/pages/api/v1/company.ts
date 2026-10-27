import { endpoint, classesOf, json } from '../../../lib/api/core';

/** GET /api/v1/company — the key's company (or companies) and their share classes with shares on issue. */
export const GET = endpoint('company', { scope: 'investors.view' }, async ({ svc, companyIds }) => {
  const [{ data: companies }, classes] = await Promise.all([
    svc.from('entities').select('id, code, display_name, legal_name, company_number, country, relationship, website, holdings_from_register').in('id', companyIds).order('sort'),
    classesOf(svc, companyIds),
  ]);
  const data = (companies ?? []).map((c) => ({
    id: c.id, code: c.code, name: c.display_name, legal_name: c.legal_name, company_number: c.company_number, country: c.country, relationship: c.relationship, website: c.website,
    holdings_from_register: c.holdings_from_register,
    share_classes: [...classes.values()].filter((k) => k.entity_id === c.id).map((k) => ({ id: k.id, code: k.code, name: k.name, kind: k.kind, voting: k.voting, counts_toward_ownership: k.counts_toward_pct !== false, on_issue: k.on_issue, official_on_issue: k.official_on_issue, official_as_at: k.official_as_at })),
  }));
  return json({ data });
});
