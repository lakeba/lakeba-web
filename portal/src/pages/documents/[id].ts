import type { APIRoute } from 'astro';

/**
 * Opens a document: checks access (RLS), records the read, then redirects to a
 * short-lived signed link. Files are never served from a public URL.
 */
export const GET: APIRoute = async ({ params, locals, redirect }) => {
  const supabase = locals.supabase;
  const { data: doc } = await supabase.from('documents').select('id, file_path').eq('id', params.id!).maybeSingle();
  if (!doc) return new Response('Not found', { status: 404 });

  const { error: readError } = await supabase.rpc('record_document_read', { doc_id: doc.id });
  if (readError) return new Response('Not found', { status: 404 });

  const { data, error } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 120);
  if (error || !data) return new Response('File unavailable', { status: 502 });
  return redirect(data.signedUrl, 302);
};
