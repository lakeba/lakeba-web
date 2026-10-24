import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { serviceClient } from '../../../lib/admin';
import { MEDIA_PREFIX } from '../../../lib/news-cms';
import { newsEditor } from '../../../lib/news-editors';
import { videoOf } from '../../../lib/newsletter-design';

// Email can't play video, so a video in a newsletter is its thumbnail with a
// play button, linking to the video. This makes that image from a YouTube or
// Vimeo link (thumbnails are only fetched from those services' image hosts).
const PLAY = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><circle cx="80" cy="80" r="72" fill="#000" fill-opacity="0.62"/><circle cx="80" cy="80" r="72" fill="none" stroke="#fff" stroke-width="6"/><path d="M64 50 L114 80 L64 110 Z" fill="#fff"/></svg>`);
const HOSTS = ['i.ytimg.com', 'img.youtube.com', 'i.vimeocdn.com'];

async function image(url: string) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !HOSTS.includes(u.hostname)) return null;
  const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 5_000_000 ? null : buf;
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!newsEditor(locals)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { url?: string } | null;
  const video = videoOf(String(body?.url ?? ''));
  if (!video) return Response.json({ error: 'Paste a YouTube or Vimeo link.' }, { status: 400 });
  let thumb: Buffer | null = null;
  if (video.kind === 'youtube') {
    for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) { thumb = await image(`https://i.ytimg.com/vi/${video.id}/${name}.jpg`).catch(() => null); if (thumb) break; }
  } else {
    const o = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(video.watch)}&width=1280`, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { thumbnail_url?: string } | null;
    if (o?.thumbnail_url) thumb = await image(o.thumbnail_url).catch(() => null);
  }
  if (!thumb) return Response.json({ error: 'That video’s picture couldn’t be found. Is the video public?' }, { status: 404 });
  const base = sharp(thumb).resize({ width: 1200, height: 675, fit: 'cover' });
  const out = await base.composite([{ input: PLAY, gravity: 'center' }]).webp({ quality: 82 }).toBuffer();
  const path = `${new Date().getUTCFullYear()}/${randomUUID()}.webp`;
  const { error } = await serviceClient().storage.from('news-media').upload(path, out, { contentType: 'image/webp' });
  if (error) return Response.json({ error: 'The picture could not be saved.' }, { status: 500 });
  await locals.supabase.rpc('log_event', { event_action: 'admin_made_video_thumbnail', event_detail: { video: video.watch } });
  return Response.json({ url: `${MEDIA_PREFIX}${path}`, watch: video.watch });
};
