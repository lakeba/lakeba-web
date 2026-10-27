import { endpoint, json } from '../../../lib/api/core';
import { EVENTS, eventData, eventScope } from '../../../lib/integrations/events';

/**
 * GET /api/v1/events — the company's events of the last 30 days, oldest first after ?after (an event's
 * "sequence"), for tools that poll instead of receiving webhooks. ?type; limit (max 200). Only events this
 * key's scopes cover; personal details only with "people.read".
 */
export const GET = endpoint('events', { scope: 'any' }, async ({ svc, ctx, companyIds, can }) => {
  const limit = Math.min(Math.max(Number(ctx.url.searchParams.get('limit')) || 50, 1), 200);
  const after = Number(ctx.url.searchParams.get('after')) || 0;
  let q = svc.from('integration_events').select('id, event_id, type, data, occurred_at, entities(code, display_name)').in('entity_id', companyIds).gt('id', after).order('id').limit(limit * 3);
  const type = ctx.url.searchParams.get('type');
  if (type) q = q.eq('type', type);
  const { data } = await q;
  const rows = (data ?? []).filter((e) => can(eventScope(e.type))).slice(0, limit);
  return json({ data: rows.map((e) => { const c = e.entities as unknown as { code: string; display_name: string }; return { sequence: e.id, id: e.event_id, type: e.type, description: EVENTS[e.type] ?? e.type, occurred_at: e.occurred_at, company: { code: c.code, name: c.display_name }, data: eventData(e.data as Record<string, unknown>, can('people.read')) }; }), next_after: rows.at(-1)?.id ?? after });
});
