import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { serviceClient } from '../../../lib/admin';
import { IMAGE_TYPES, MEDIA_PREFIX } from '../../../lib/news-cms';
import { newsEditor } from '../../../lib/news-editors';

const MAX = 8 * 1024 * 1024;

/** Uploads one image for a news post (cover or in the text) and returns its address. */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!newsEditor(locals)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const file = (await request.formData()).get('file');
  if (!(file instanceof File)) return Response.json({ error: 'No image.' }, { status: 400 });
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return Response.json({ error: 'Use a PNG, JPEG, WebP or GIF image.' }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: 'Images can be up to 8 MB.' }, { status: 400 });
  const path = `${new Date().getUTCFullYear()}/${randomUUID()}.${ext}`;
  const { error } = await serviceClient().storage.from('news-media').upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
  if (error) return Response.json({ error: 'The image could not be saved.' }, { status: 500 });
  await locals.supabase.rpc('log_event', { event_action: 'admin_uploaded_news_image', event_detail: { path, bytes: file.size } });
  return Response.json({ url: `${MEDIA_PREFIX}${path}` });
};
