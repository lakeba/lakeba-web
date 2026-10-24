import type { APIRoute } from 'astro';
import { cleanHtml } from '../../../lib/news-cms';
import { newsEditor } from '../../../lib/news-editors';

/**
 * Keeps unsaved edits of a post (title, text…) without changing the live post.
 * The editor offers them back if the page is closed before saving.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const editor = newsEditor(locals);
  if (!editor) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: string; draft?: Record<string, unknown> } | null;
  if (!body?.id || !body.draft) return Response.json({ error: 'Nothing to save.' }, { status: 400 });
  const { data: post } = await locals.supabase.from('posts').select('entity_id').eq('id', body.id).maybeSingle();
  if (!post || !editor.mayEdit(post.entity_id)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const d = body.draft;
  const draft = {
    title: String(d.title ?? '').slice(0, 300), excerpt: String(d.excerpt ?? '').slice(0, 1000), seo_description: String(d.seo_description ?? '').slice(0, 400),
    body_html: cleanHtml(String(d.body_html ?? '')).slice(0, 500_000),
  };
  const at = new Date().toISOString();
  const { error } = await locals.supabase.from('posts').update({ autosave: draft, autosave_at: at }).eq('id', body.id);
  return error ? Response.json({ error: 'Not saved.' }, { status: 500 }) : Response.json({ savedAt: at });
};
