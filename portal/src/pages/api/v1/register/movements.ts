import { classesOf, endpoint, isUuid, json, page } from '../../../../lib/api/core';

/** GET /api/v1/register/movements — movements on the register of members (allotments, transfers…). ?holder_id; limit, cursor. */
export const GET = endpoint('register/movements', { scope: 'investors.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  const classes = await classesOf(svc, companyIds);
  let q = svc.from('register_movements').select('holder_id, share_class_id, seq, moved_on, kind, shares, balance, party_holder_id, consideration, certificate, paid_per_share, unpaid_per_share', { count: 'exact' })
    .in('entity_id', companyIds).order('moved_on', { ascending: false }).order('seq', { ascending: false });
  const holder = ctx.url.searchParams.get('holder_id');
  if (isUuid(holder)) q = q.eq('holder_id', holder);
  const { data, count } = await q.range(p.from, p.to);
  return json({ data: (data ?? []).map((m) => ({ ...m, shares: Number(m.shares), balance: Number(m.balance), share_class: classes.get(m.share_class_id)?.code, company: classes.get(m.share_class_id)?.company })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});
