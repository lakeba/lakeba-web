import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { serviceClient } from '../../../lib/admin';
import { IMAGE_TYPES, MEDIA_PREFIX } from '../../../lib/news-cms';
import { newsEditor } from '../../../lib/news-editors';

const MAX = 8 * 1024 * 1024;

/** Uploads one image for a news post (cover or in the text) and returns its address. */
// Group editors share one library (by year); anyone editing for one company only keeps theirs
// in their own folder, so they don't see other companies' (or the press office's) images.
const folder = (locals: App.Locals, year: number) => (newsEditor(locals)?.group ? String(year) : `u/${locals.user!.id}/${year}`);

export const POST: APIRoute = async ({ request, locals }) => {
  if (!newsEditor(locals)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const file = (await request.formData()).get('file');
  if (!(file instanceof File)) return Response.json({ error: 'No image.' }, { status: 400 });
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return Response.json({ error: 'Use a PNG, JPEG, WebP or GIF image.' }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: 'Images can be up to 8 MB.' }, { status: 400 });
  const path = `${folder(locals, new Date().getUTCFullYear())}/${randomUUID()}.${ext}`;
  const { error } = await serviceClient().storage.from('news-media').upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
  if (error) return Response.json({ error: 'The image could not be saved.' }, { status: 500 });
  await locals.supabase.rpc('log_event', { event_action: 'admin_uploaded_news_image', event_detail: { path, bytes: file.size } });
  return Response.json({ url: `${MEDIA_PREFIX}${path}` });
};

/** Recently uploaded images, for the designer's image library (newest first). */
export const GET: APIRoute = async ({ locals }) => {
  if (!newsEditor(locals)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const svc = serviceClient();
  const year = new Date().getUTCFullYear();
  const lists = await Promise.all([year, year - 1].map(async (y) => ((await svc.storage.from('news-media').list(folder(locals, y), { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })).data ?? []).map((f) => ({ path: `${folder(locals, y)}/${f.name}`, at: f.created_at ?? '' }))));
  const items = lists.flat().filter((f) => /\.(png|jpg|webp|gif)$/.test(f.path)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
  return Response.json({ images: items.map((f) => `${MEDIA_PREFIX}${f.path}`) });
};
