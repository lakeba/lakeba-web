import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../../lib/admin';
import { newsEditor } from '../../../../../lib/news-editors';
import { EMAIL_PAGE_HEADERS } from '../../../../../lib/newsletter-design';
import { loadTemplate, mayManageTemplate } from '../../../../../lib/newsletter-template-store';

/** An imported template's original (as imported: cleaned, images copied), to compare with. */
export const GET: APIRoute = async ({ params, locals }) => {
  const editor = newsEditor(locals, 'newsletters', 'view');
  if (!editor) return new Response('Not allowed', { status: 403 });
  const t = await loadTemplate(serviceClient(), params.id!);
  if (!t || !t.source_html || !mayManageTemplate(t, editor.maySee, editor.seesGroup)) return new Response('Not found', { status: 404 });
  return new Response(t.source_html, { headers: { ...EMAIL_PAGE_HEADERS, 'cache-control': 'no-store', 'x-frame-options': 'SAMEORIGIN' } });
};
