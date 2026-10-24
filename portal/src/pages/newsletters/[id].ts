import type { APIRoute } from 'astro';
import { serviceClient } from '../../lib/admin';
import { loadParts, renderIssue, type Company, type Issue } from '../../lib/newsletter';
import { EMAIL_PAGE_HEADERS } from '../../lib/newsletter-design';

/** A sent newsletter, without personal details, for people who can see it. */
export const GET: APIRoute = async ({ params, locals, url }) => {
  const svc = serviceClient();
  const { data: issue } = await svc.from('newsletter_issues').select('*').eq('id', params.id!).eq('status', 'sent').maybeSingle();
  if (!issue || (issue.audience !== 'public' && !locals.companies.some((c) => c.id === issue.entity_id))) return new Response('Not found', { status: 404 });
  const { data: company } = await svc.from('entities').select('id, code, display_name, legal_name, brand_color, relationship, shareholder_mailbox').eq('id', issue.entity_id).single();
  const { html } = renderIssue(issue as Issue, company as Company, await loadParts(svc, issue), { firstName: locals.profile?.first_name || null, holding: null, setupUrl: null, token: null }, url.origin);
  return new Response(html, { headers: { ...EMAIL_PAGE_HEADERS, 'cache-control': 'private, no-store' } });
};
