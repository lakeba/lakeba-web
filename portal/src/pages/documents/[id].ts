import type { APIRoute } from 'astro';

const PASS_THROUGH = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

/**
 * Opens a document: checks access (RLS), records the read, then streams the
 * file from private storage through the portal. Browsers never see a storage
 * URL, so this works from any address the portal is reached on. Range
 * requests are passed through so videos can be scrubbed.
 */
export const GET: APIRoute = async ({ params, locals, request }) => {
  const supabase = locals.supabase;
  const { data: doc } = await supabase.from('documents').select('id, title, file_path, mime_type').eq('id', params.id!).maybeSingle();
  if (!doc) return new Response('Not found', { status: 404 });

  // Count a read once, not for every range request a video player makes.
  const range = request.headers.get('range');
  if (!range || /^bytes=0-/.test(range)) {
    const { error: readError } = await supabase.rpc('record_document_read', { doc_id: doc.id });
    if (readError) return new Response('Not found', { status: 404 });
  }

  const { data: signed, error } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60);
  if (error || !signed) return new Response('File unavailable', { status: 502 });
  const upstream = await fetch(signed.signedUrl, { headers: range ? { range } : {}, signal: request.signal });
  if (!upstream.ok || !upstream.body) return new Response('File unavailable', { status: 502 });

  const headers = new Headers();
  for (const h of PASS_THROUGH) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has('content-type')) headers.set('content-type', doc.mime_type);
  const ext = doc.file_path.split('.').pop();
  const name = `${doc.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'document'}.${ext}`;
  headers.set('content-disposition', `inline; filename="${name}"`);
  headers.set('cache-control', 'private, no-store');
  return new Response(upstream.body, { status: upstream.status, headers });
};
