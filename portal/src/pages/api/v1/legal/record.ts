import { endpoint, json } from '../../../../lib/api/core';

/** GET /api/v1/legal/record — the company's legal record (ACN, ABN, offices, year end, review date, auditor…), as kept in Legal. */
export const GET = endpoint('legal/record', { scope: 'legal.view' }, async ({ svc, companyIds }) => {
  const { data } = await svc.from('entities').select('id, code, legal_name, company_records(acn, abn, company_type, incorporated_on, registered_in, registered_office, principal_place, year_end, review_date, auditor, ultimate_holding, extract_dated, updated_at)').in('id', companyIds).order('sort');
  return json({ data: (data ?? []).map((e) => {
    const r = (Array.isArray(e.company_records) ? e.company_records[0] : e.company_records) as Record<string, unknown> | null;
    return { company: e.code, legal_name: e.legal_name, acn: r?.acn ?? null, abn: r?.abn ?? null, company_type: r?.company_type ?? null, incorporated_on: r?.incorporated_on ?? null,
      registered_in: r?.registered_in ?? null, registered_office: r?.registered_office ?? null, principal_place: r?.principal_place ?? null, year_end: r?.year_end ?? null,
      review_date: r?.review_date ?? null, auditor: r?.auditor ?? null, ultimate_holding: r?.ultimate_holding ?? null, extract_dated: r?.extract_dated ?? null, updated_at: r?.updated_at ?? null };
  }) });
});
