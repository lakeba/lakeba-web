import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/admin';
import { loadAccess } from '../../../../lib/access';
import { OBLIGATION_COLUMNS, addDays, calendarFile, hashToken, legalCompanies, todayIn, type Obligation } from '../../../../lib/legal';

/**
 * A person's private legal calendar (Admin → Legal → Calendar → "In your own
 * calendar"): the open deadlines of the companies their roles cover today,
 * titles and dates only. The address is the secret; a new one replaces it.
 */
export const GET: APIRoute = async ({ params, url }) => {
  const svc = serviceClient();
  const token = String(params.token ?? '');
  if (token.length < 20) return new Response('Not found', { status: 404 });
  const { data: feed } = await svc.from('legal_calendar_feeds').select('user_id').eq('token_hash', hashToken(token)).maybeSingle();
  if (!feed) return new Response('Not found', { status: 404 });
  // Roles as they are now (an ended role ends the feed's companies too); two-step is for the portal itself.
  const access = await loadAccess(svc, feed.user_id, true);
  const companies = await legalCompanies(svc, access);
  if (!access.canAny('legal.view') || !companies.length) return new Response('Not found', { status: 404 });
  const { data } = await svc.from('legal_obligations').select(OBLIGATION_COLUMNS).in('entity_id', companies.map((c) => c.id)).eq('status', 'open').gte('due_on', addDays(todayIn(), -90)).order('due_on').limit(1000);
  const name = new Map(companies.map((c) => [c.id, c.display_name]));
  const body = calendarFile(((data ?? []) as Obligation[]).map((o) => ({ ...o, company: name.get(o.entity_id) ?? '' })), url.origin);
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900' } });
};
