import { field } from './forms';
import { cleanHtml } from './news-cms';
import { cleanEmailHtml, type IssueContent } from './newsletter';
import { compileMjml } from './newsletter-design';

/** The editable fields of a newsletter issue from the editor's form (saving and the live preview). */
export function issueFields(form: FormData, audience: 'shareholders' | 'public') {
  const titles = form.getAll('section_title').map(String);
  const bodies = form.getAll('section_html').map(String);
  const sections = titles.map((title, i) => ({ title: title.trim().slice(0, 120), html: cleanHtml(bodies[i] ?? '') })).filter((s) => s.title || s.html.replace(/<[^>]+>/g, '').trim()).slice(0, 12);
  const segment = field(form, 'segment');
  const content: IssueContent = {
    brief: field(form, 'brief').slice(0, 6000),
    intro_html: cleanHtml(String(form.get('intro_html') ?? '')), closing_html: cleanHtml(String(form.get('closing_html') ?? '')), sections,
    post_ids: form.getAll('post_ids').map(String).slice(0, 12),
    document_ids: audience === 'shareholders' ? form.getAll('document_ids').map(String).slice(0, 12) : [],
    meetings: audience === 'shareholders' && form.get('meetings') === 'on', holding: audience === 'shareholders' && form.get('holding') === 'on',
    cta_label: field(form, 'cta_label').slice(0, 60), cta_url: /^https?:\/\//.test(field(form, 'cta_url')) ? field(form, 'cta_url') : '',
  };
  return {
    subject: field(form, 'subject').slice(0, 200), preheader: field(form, 'preheader').slice(0, 200),
    mode: field(form, 'mode') === 'html' ? 'html' as const : field(form, 'mode') === 'design' ? 'design' as const : 'compose' as const,
    html_body: cleanEmailHtml(String(form.get('html_body') ?? '')).slice(0, 200_000),
    content,
    segment: audience === 'public' ? { segment: 'all' as const } : segment === 'quiet' ? { segment: 'quiet' as const } : segment.startsWith('class:') ? { segment: 'class' as const, share_class_id: segment.slice(6) } : { segment: 'all' as const },
  };
}

/**
 * Designer fields (mode 'design'): the GrapesJS project and its MJML, compiled
 * to the email on the server. Returns nothing for the other modes.
 */
export async function designFields(form: FormData) {
  if (String(form.get('mode')) !== 'design') return null;
  const mjml = String(form.get('mjml') ?? '').slice(0, 400_000);
  let design_json: unknown = null;
  try { design_json = JSON.parse(String(form.get('design_json') || 'null')); } catch { design_json = null; }
  const { html, errors } = await compileMjml(mjml);
  return { mjml, design_json, design_html: html, errors };
}
