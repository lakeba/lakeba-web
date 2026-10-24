import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/admin';
import { newsEditor } from '../../../../lib/news-editors';
import { loadParts, renderIssue, type Company, type Issue } from '../../../../lib/newsletter';
import { designFields, issueFields } from '../../../../lib/newsletter-form';
import { EMAIL_PAGE_HEADERS } from '../../../../lib/newsletter-design';

/**
 * The issue as it will look, with example personal details (first name, a
 * sample holding). GET shows the saved issue; POST the editor's unsaved fields
 * (the live preview). Nothing is saved.
 */
async function preview(locals: App.Locals, id: string, origin: string, form: FormData | null) {
  const editor = newsEditor(locals);
  if (!editor) return new Response('Not allowed', { status: 403 });
  const svc = serviceClient();
  const { data: saved } = await svc.from('newsletter_issues').select('*').eq('id', id).maybeSingle();
  if (!saved || (saved.audience === 'public' ? !editor.group : !editor.mayEdit(saved.entity_id))) return new Response('Not found', { status: 404 });
  const design = form ? await designFields(form) : null;
  const issue = (form ? { ...saved, ...issueFields(form, saved.audience), ...(design ? { mjml: design.mjml, design_html: design.design_html } : {}) } : saved) as Issue;
  const { data: company } = await svc.from('entities').select('id, code, display_name, legal_name, brand_color, relationship, shareholder_mailbox').eq('id', issue.entity_id).single();
  const { html } = renderIssue(issue, company as Company, await loadParts(svc, issue), {
    firstName: locals.profile?.first_name || 'Alex',
    holding: issue.audience === 'shareholders' ? { shares: 12500, value: 8750, className: 'ordinary shares (example)' } : null,
    setupUrl: issue.audience === 'shareholders' ? `${origin}/login` : null, token: null,
  }, origin);
  return new Response(html, { headers: { ...EMAIL_PAGE_HEADERS, 'cache-control': 'no-store', 'x-frame-options': 'SAMEORIGIN' } });
}

export const GET: APIRoute = ({ params, locals, url }) => preview(locals, params.id!, url.origin, null);
export const POST: APIRoute = async ({ params, locals, url, request }) => preview(locals, params.id!, url.origin, await request.formData());
