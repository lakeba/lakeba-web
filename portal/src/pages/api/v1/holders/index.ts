import { endpoint, json, page } from '../../../../lib/api/core';
import { externalIds, holderView, holdersIn } from '../../../../lib/api/data';

/**
 * GET /api/v1/holders — holders (holding entities) with shares in the company: their latest holding per
 * class and ownership percentage. ?include_zero=true adds holders whose shares are now nil; limit, cursor.
 */
export const GET = endpoint('holders', { scope: 'investors.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  const { classes, holders, byHolder } = await holdersIn(svc, companyIds, { includeZero: ctx.url.searchParams.get('include_zero') === 'true' });
  const slice = holders.slice(p.from, p.to + 1);
  const ext = await externalIds(svc, companyIds, 'holder', slice.map((h) => h.id));
  return json({ data: slice.map((h) => holderView(h, byHolder.get(h.id) ?? [], classes, ext.get(h.id))), total: holders.length, next_cursor: p.next(holders.length) });
});
