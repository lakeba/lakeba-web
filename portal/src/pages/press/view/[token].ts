import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { EMAIL_PAGE_HEADERS } from '../../../lib/newsletter-design';
import { composeRelease, loadRelease, pressSettings, sydneyTime } from '../../../lib/press';
import { embargoOf, pitchByToken, recordPreview } from '../../../lib/press-outreach';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The journalist's private copy of the release, from their pitch: readable
 * before publication (with the embargo shown), not indexed, viewing recorded.
 */
export const GET: APIRoute = async ({ params }) => {
  const svc = serviceClient();
  const p = await pitchByToken(svc, params.token ?? '');
  const page = (body: string, status = 200) => new Response(`<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Lakeba press release</title>
<style>body{margin:0;background:#f4f7fc;font-family:Inter,Arial,sans-serif;color:#0b1d37}main{max-width:760px;margin:0 auto;padding:40px 24px 80px}.tag{display:inline-block;background:#276ae7;color:#fff;font-size:12px;letter-spacing:.12em;text-transform:uppercase;padding:4px 10px;border-radius:999px}h1{font-size:32px;line-height:1.2;margin:16px 0 8px}h2.sub{font-size:19px;font-weight:400;color:#3d4b60;margin:0 0 24px}article{line-height:1.75;font-size:17px}img.cover{width:100%;border-radius:14px;margin:8px 0 24px}.embargo{background:#fde8e8;color:#9b1c1c;border-radius:10px;padding:12px 16px;font-weight:600;margin-bottom:20px}.kit{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}.kit a{color:#1d4ed8;font-size:13px}</style></head><body><main>${body}</main></body></html>`, { status, headers: { ...EMAIL_PAGE_HEADERS, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
  if (!p) return page('<p>This link is not valid.</p>', 404);
  const { data: d } = await svc.from('press_distributions').select('release_id').eq('id', p.distribution_id).maybeSingle();
  const r = d ? await loadRelease(svc, d.release_id) : null;
  if (!r || !['approved', 'published'].includes(r.status)) return page('<p>This press release is no longer available. Questions: press@lakeba.com.</p>', 410);
  await recordPreview(svc, p);
  const s = await pressSettings(svc);
  const embargo = embargoOf(r);
  const when = r.published_at ?? r.publish_at ?? new Date().toISOString();
  const kit = r.kit.map((k) => `<figure style="margin:0"><a href="${esc(k.url)}" download><img src="${esc(k.url)}" alt="${esc(k.label)}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px"></a><figcaption style="font-size:12px;color:#6b7a90">${esc(k.label)}</figcaption></figure>`).join('');
  return page(`${embargo ? `<p class="embargo">Embargoed until ${esc(sydneyTime(embargo))} (Sydney). Please don’t publish or share before then.</p>` : ''}
<span class="tag">Press release</span><h1>${esc(r.headline)}</h1>${r.subheadline ? `<h2 class="sub">${esc(r.subheadline)}</h2>` : ''}
${r.cover_url ? `<img class="cover" src="${esc(r.cover_url)}" alt="">` : ''}<article>${composeRelease(r, s, when)}</article>
${kit ? `<h3>Press kit</h3><p style="font-size:14px;color:#3d4b60">Images for editorial use with this release. Click an image to download it.</p><div class="kit">${kit}</div>` : ''}`);
};
