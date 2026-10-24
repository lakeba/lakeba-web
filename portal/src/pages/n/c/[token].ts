import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { recipientByToken } from '../../../lib/newsletter';

/**
 * A tracked link: records the click, then goes to the address. Only addresses
 * that are actually in this reader's newsletter are followed, so the link can't
 * be used to send people elsewhere.
 */
export const GET: APIRoute = async ({ params, url }) => {
  const target = url.searchParams.get('u') ?? '';
  const svc = serviceClient();
  const r = await recipientByToken(svc, params.token ?? '');
  // The email holds the link as …?u=<encoded address>" (HTML-escaped, so ' becomes &#39;).
  const inEmail = Boolean(r && /^https?:\/\//.test(target) && r.html.includes(`?u=${encodeURIComponent(target).replace(/'/g, '&#39;')}"`));
  if (!r || !inEmail) return new Response('This link is not valid.', { status: 404 });
  const now = new Date().toISOString();
  await svc.from('newsletter_recipients').update({ clicked_at: r.clicked_at ?? now, click_count: r.click_count + 1, opened_at: r.opened_at ?? now }).eq('id', r.id);
  await svc.from('newsletter_clicks').insert({ recipient_id: r.id, url: target.slice(0, 2000) });
  return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
};
