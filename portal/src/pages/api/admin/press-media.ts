import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { serviceClient } from '../../../lib/admin';
import { IMAGE_TYPES, MEDIA_PREFIX } from '../../../lib/news-cms';

const MAX = 8 * 1024 * 1024;

/** Uploads an image for a press release (cover or press kit) to the newsroom's image store. */
export const POST: APIRoute = async ({ request, locals }) => {
  // Anyone who writes releases on some desk (images go into a release's kit).
  if (!locals.user || locals.user.aal !== 'aal2' || !locals.access.canAny('press.do')) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const file = (await request.formData()).get('file');
  if (!(file instanceof File)) return Response.json({ error: 'No image.' }, { status: 400 });
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return Response.json({ error: 'Use a PNG, JPEG, WebP or GIF image.' }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: 'Images can be up to 8 MB.' }, { status: 400 });
  const path = `${new Date().getUTCFullYear()}/${randomUUID()}.${ext}`;
  const { error } = await serviceClient().storage.from('news-media').upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
  if (error) return Response.json({ error: 'The image could not be saved.' }, { status: 500 });
  await locals.supabase.rpc('log_event', { event_action: 'press_uploaded_image', event_detail: { path, bytes: file.size } });
  return Response.json({ url: `${MEDIA_PREFIX}${path}` });
};
