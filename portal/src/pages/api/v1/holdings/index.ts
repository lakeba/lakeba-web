import { classesOf, endpoint, isUuid, json, latestHoldings, page } from '../../../../lib/api/core';

/** GET /api/v1/holdings — the latest holding per holder and class (shares above nil). ?holder_id, ?share_class; limit, cursor. */
export const GET = endpoint('holdings', { scope: 'investors.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  const classes = await classesOf(svc, companyIds);
  const wantClass = ctx.url.searchParams.get('share_class')?.toUpperCase();
  const holder = ctx.url.searchParams.get('holder_id');
  const classIds = [...classes.values()].filter((c) => !wantClass || c.code.toUpperCase() === wantClass).map((c) => c.id);
  const rows = (await latestHoldings(svc, classIds, isUuid(holder) ? [holder] : undefined)).filter((r) => Number(r.shares) > 0)
    .sort((a, b) => a.holder_id.localeCompare(b.holder_id) || a.share_class_id.localeCompare(b.share_class_id));
  const data = rows.slice(p.from, p.to + 1).map((r) => {
    const c = classes.get(r.share_class_id)!;
    return { holder_id: r.holder_id, company: c.company, share_class: c.code, share_class_id: r.share_class_id, shares: Number(r.shares), as_at: r.as_at, ownership_pct: c.counts_toward_pct !== false && c.on_issue ? Math.round((Number(r.shares) / c.on_issue) * 1e6) / 1e4 : null };
  });
  return json({ data, total: rows.length, next_cursor: p.next(rows.length) });
});
