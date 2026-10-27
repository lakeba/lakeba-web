import { endpoint, classesOf, json } from '../../../lib/api/core';

/** GET /api/v1/share-classes — share classes with shares on issue (the official figure where there is one). */
export const GET = endpoint('share-classes', { scope: 'investors.view' }, async ({ svc, companyIds }) => {
  const classes = await classesOf(svc, companyIds);
  return json({ data: [...classes.values()].map((k) => ({ id: k.id, company: k.company, code: k.code, name: k.name, kind: k.kind, voting: k.voting, currency: k.currency, counts_toward_ownership: k.counts_toward_pct !== false, on_issue: k.on_issue, official_on_issue: k.official_on_issue, official_as_at: k.official_as_at })) });
});
