import { ApiError, endpoint, json, str } from '../../../../lib/api/core';
import { EVENTS, eventScope, newWebhookSecret, sealSecret } from '../../../../lib/integrations/events';
import { outboundProblem } from '../../../../lib/outbound';

// Webhook subscriptions made by a key or app ("REST hooks", as Zapier and Make use them): the app subscribes
// when a user turns a trigger on and unsubscribes when it's turned off. They show in Integrations → Outgoing
// webhooks as "made by an app" and stop when the app is stopped.

/** GET /api/v1/webhooks — this key's subscriptions. */
export const GET = endpoint('webhooks', { scope: 'any' }, async ({ svc, key }) => {
  const { data } = await svc.from('webhook_endpoints').select('id, url, events, format, active, created_at').eq('created_by_key', key.id);
  return json({ data: data ?? [], events: Object.keys(EVENTS).map((type) => ({ type, description: EVENTS[type], scope: eventScope(type) })) });
});

/**
 * POST /api/v1/webhooks — { target_url (or url), events: ["holder.created", …] (or event), format: json|slack|teams }.
 * Only events this key's scopes cover; names and emails only with "people.read". Returns the signing secret once.
 */
export const POST = endpoint('webhooks', { scope: 'any', write: true }, async ({ svc, key, company, can, body, audit }) => {
  const b = await body();
  const url = str(b, 'target_url', 2000) || str(b, 'url', 2000);
  const problem = outboundProblem(url);
  if (!url || problem) throw new ApiError(422, 'bad_url', problem ?? '“target_url” is required.');
  const events = (Array.isArray(b.events) ? b.events.map(String) : [str(b, 'event', 80)]).filter(Boolean);
  const unknown = events.filter((e) => !(e in EVENTS));
  if (!events.length || unknown.length) throw new ApiError(422, 'bad_events', unknown.length ? `Unknown events: ${unknown.join(', ')}.` : 'Give “events” (see GET /api/v1/webhooks for the list).');
  const denied = events.filter((e) => !can(eventScope(e)));
  if (denied.length) throw new ApiError(403, 'insufficient_scope', `This key can’t receive: ${denied.join(', ')}.`);
  const format = ['slack', 'teams'].includes(String(b.format)) ? String(b.format) : 'json';
  const secret = newWebhookSecret();
  const { data } = await svc.from('webhook_endpoints').insert({ entity_id: company.id, name: `${key.name} subscription`.slice(0, 80), url, events, format, personal_data: can('people.read'), secret_enc: sealSecret(secret), created_by_key: key.id }).select('id').single().throwOnError();
  await audit('api_subscribed_webhook', { endpoint_id: data!.id, url, events });
  return json({ data: { id: data!.id, target_url: url, events, format, secret } }, 201);
});
