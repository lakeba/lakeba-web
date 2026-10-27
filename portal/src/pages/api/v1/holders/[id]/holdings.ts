import { ApiError, classesOf, endpoint, isUuid, json, str } from '../../../../../lib/api/core';
import { holderIn } from '../../../../../lib/api/data';

/**
 * POST /api/v1/holders/{id}/holdings — a dated balance: { share_class, shares, as_at (YYYY-MM-DD), reason }.
 * Refused (409) for a company whose holdings come from its register of members: import the register instead.
 * Needs "investors.do".
 */
export const POST = endpoint('holders/{id}/holdings', { scope: 'investors.do', write: true }, async ({ svc, ctx, companyIds, body, audit }) => {
  const id = ctx.params.id;
  if (!isUuid(id)) throw new ApiError(404, 'not_found', 'No such holder.');
  // A holder of this company, or one that holds nothing anywhere yet (just added in the portal).
  await holderIn(svc, companyIds, id).catch(async () => {
    const [{ data: h }, { count }] = await Promise.all([svc.from('holders').select('id').eq('id', id).maybeSingle(), svc.from('holdings').select('holder_id', { count: 'exact', head: true }).eq('holder_id', id)]);
    if (!h || count) throw new ApiError(404, 'not_found', 'No such holder in this company.');
  });
  const b = await body();
  const code = str(b, 'share_class', 20, true).toUpperCase();
  const shares = b.shares;
  const asAt = str(b, 'as_at', 10, true);
  const reason = str(b, 'reason', 500, true);
  if (typeof shares !== 'number' || !Number.isInteger(shares) || shares < 0) throw new ApiError(422, 'bad_field', '“shares” must be a whole number (0 or more).', { field: 'shares' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asAt)) throw new ApiError(422, 'bad_field', '“as_at” must be a date, YYYY-MM-DD.', { field: 'as_at' });
  const classes = [...(await classesOf(svc, companyIds)).values()].filter((c) => c.code.toUpperCase() === code);
  if (classes.length !== 1) throw new ApiError(422, 'bad_share_class', `No share class “${code}” in this company.`);
  const cls = classes[0];
  const { data: ent } = await svc.from('entities').select('code, display_name, holdings_from_register').eq('id', cls.entity_id).single();
  if (ent?.holdings_from_register) throw new ApiError(409, 'register_company', `${ent.display_name}’s holdings come from its register of members: send the register (POST /api/v1/register/imports) instead.`);
  await svc.from('holdings').upsert({ holder_id: id, share_class_id: cls.id, shares, as_at: asAt }, { onConflict: 'holder_id,share_class_id,as_at' }).throwOnError();
  await audit('api_holdings_changed', { holder_id: id, share_class: code, shares, as_at: asAt, reason, company: ent?.code });
  return json({ data: { holder_id: id, share_class: code, shares, as_at: asAt } }, 201);
});
