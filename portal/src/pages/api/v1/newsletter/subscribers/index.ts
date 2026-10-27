import { ApiError, endpoint, json, page, since, str } from '../../../../../lib/api/core';
import { subscribe } from '../../../../../lib/integrations/actions';

/** GET /api/v1/newsletter/subscribers — the company's public newsletter list. Needs "people.read" as well. ?status; ?updated_since. */
export const GET = endpoint('newsletter/subscribers', { scope: 'newsletters.view' }, async ({ svc, ctx, companyIds, can }) => {
  if (!can('people.read')) return json({ type: 'https://investors.lakeba.com/developers#insufficient_scope', status: 403, code: 'insufficient_scope', detail: 'Subscribers are personal data: this key also needs “people.read”.' }, 403);
  const p = page(ctx.url);
  // Lakeba Group's list is the shared one (no company on it).
  const { data: group } = await svc.from('entities').select('id').eq('relationship', 'group').in('id', companyIds);
  const lists = companyIds.filter((id) => !(group ?? []).some((g) => g.id === id));
  let q = svc.from('newsletter_subscribers').select('id, email, name, source, status, confirmed_at, unsubscribed_at, created_at', { count: 'exact' }).order('created_at', { ascending: false });
  q = group?.length ? q.or(`entity_id.is.null${lists.length ? `,entity_id.in.(${lists.join(',')})` : ''}`) : q.in('entity_id', lists);
  const status = ctx.url.searchParams.get('status');
  if (status) q = q.eq('status', status);
  const s = since(ctx.url);
  if (s) q = q.or(`created_at.gte.${s},unsubscribed_at.gte.${s},confirmed_at.gte.${s}`);
  const { data, count } = await q.range(p.from, p.to);
  return json({ data: data ?? [], total: count ?? 0, next_cursor: p.next(count ?? 0) });
});

/**
 * POST /api/v1/newsletter/subscribers — { email, name }: subscribes someone who asked for the company's newsletter
 * (you're responsible for their consent). Needs "newsletters.do".
 */
export const POST = endpoint('newsletter/subscribers', { scope: 'newsletters.do', write: true }, async ({ svc, company, body, audit }) => {
  const b = await body();
  const r = await subscribe(svc, company as never, { email: str(b, 'email', 200, true), name: str(b, 'name', 120), source: 'api' });
  if ('error' in r) throw new ApiError(422, 'not_added', r.error!);
  if (r.was !== 'subscribed') await audit('newsletter_subscribed', { subscriber_id: r.id, email: str(b, 'email', 200).toLowerCase() });
  return json({ data: { id: r.id, status: 'subscribed' } }, r.existing ? 200 : 201);
});
