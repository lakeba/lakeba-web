import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../../lib/admin';
import { newsEditor } from '../../../../../lib/news-editors';
import { renderIssue, type Company, type Issue } from '../../../../../lib/newsletter';
import { EMAIL_PAGE_HEADERS } from '../../../../../lib/newsletter-design';
import { designFields, issueFields } from '../../../../../lib/newsletter-form';
import { issueFromTemplate, loadTemplate, mayManageTemplate } from '../../../../../lib/newsletter-template-store';

/**
 * A template as an issue would look, with example data: an example reader and
 * holding, recent news, documents and meetings. GET: as saved; POST: the
 * editor's unsaved fields (the live preview). Nothing is saved.
 */
async function preview(locals: App.Locals, id: string, origin: string, form: FormData | null) {
  const editor = newsEditor(locals);
  if (!editor) return new Response('Not allowed', { status: 403 });
  const svc = serviceClient();
  const t = await loadTemplate(svc, id);
  if (!t || !mayManageTemplate(t, editor.mayEdit, editor.group)) return new Response('Not found', { status: 404 });
  const audience = t.audience === 'public' ? 'public' : 'shareholders';
  const design = form ? await designFields(form) : null;
  const current = form ? { ...t, ...issueFields(form, audience), ...(design ? { mjml: design.mjml, design_json: null } : {}) } : t;
  const { data: entities } = await svc.from('entities').select('id, code, display_name, legal_name, brand_color, relationship, shareholder_mailbox');
  const company = (entities ?? []).find((e) => e.id === (t.entity_id ?? '')) ?? (entities ?? []).find((e) => e.relationship === 'group')!;
  const filled = await issueFromTemplate(current, { name: audience === 'public' ? 'Lakeba' : company.display_name, color: company.brand_color }, origin);
  // Example content: the latest news, documents and meetings.
  const [{ data: posts }, { data: docs }, { data: meetings }] = await Promise.all([
    svc.from('posts').select('id, slug, title, excerpt, cover_url, visibility, external, source_url, published_at').not('published_at', 'is', null).lte('published_at', new Date().toISOString()).or(audience === 'public' ? 'visibility.eq.public' : `visibility.eq.public,entity_id.eq.${company.id}`).order('published_at', { ascending: false }).limit(3),
    audience === 'shareholders' ? svc.from('documents').select('id, title, category, published_at').eq('entity_id', company.id).eq('audience', 'all_investors').not('published_at', 'is', null).order('published_at', { ascending: false }).limit(2) : Promise.resolve({ data: [] }),
    audience === 'shareholders' ? svc.from('meetings').select('id, title, starts_at, proxy_deadline, location').eq('entity_id', company.id).order('starts_at', { ascending: false }).limit(1) : Promise.resolve({ data: [] }),
  ]);
  const issue = { ...filled, id: t.id, audience, entity_id: company.id, segment: { segment: 'all' }, status: 'draft', scheduled_at: null, sent_at: null } as unknown as Issue;
  const { html } = renderIssue(issue, company as Company, { posts: posts ?? [], docs: docs ?? [], meetings: meetings ?? [] } as never, {
    firstName: locals.profile?.first_name || 'Alex',
    holding: audience === 'shareholders' ? { shares: 12500, value: 8750, className: 'ordinary shares (example)' } : null,
    setupUrl: audience === 'shareholders' ? `${origin}/login` : null, token: null,
  }, origin);
  return new Response(html, { headers: { ...EMAIL_PAGE_HEADERS, 'cache-control': 'no-store', 'x-frame-options': 'SAMEORIGIN' } });
}

export const GET: APIRoute = ({ params, locals, url }) => preview(locals, params.id!, url.origin, null);
export const POST: APIRoute = async ({ params, locals, url, request }) => preview(locals, params.id!, url.origin, await request.formData());
