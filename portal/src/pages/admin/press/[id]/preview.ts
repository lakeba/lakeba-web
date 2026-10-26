import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/admin';
import { EMAIL_PAGE_HEADERS } from '../../../../lib/newsletter-design';
import { composeRelease, loadRelease, deskOf, settingsFor } from '../../../../lib/press';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The release as it will read on the newsroom (dateline, boilerplate, contact), with its kit. */
export const GET: APIRoute = async ({ params, locals }) => {
  const svc = serviceClient();
  const r = await loadRelease(svc, params.id!);
  if (!r) return new Response('Not found', { status: 404 });
  if (!(await deskOf(locals, svc, r.entity_id))) return new Response('Forbidden', { status: 403 });
  const s = await settingsFor(svc, r);
  const when = r.published_at ?? r.publish_at ?? r.embargo_until;
  const kit = r.kit.map((k) => `<figure style="margin:0"><img src="${esc(k.url)}" alt="" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px"><figcaption style="font-size:12px;color:#6b7a90">${esc(k.label)}</figcaption></figure>`).join('');
  const html = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.headline || 'Press release')}</title>
<style>body{margin:0;background:#f4f7fc;font-family:Inter,Arial,sans-serif;color:#0b1d37}main{max-width:760px;margin:0 auto;padding:40px 24px 80px}.tag{display:inline-block;background:#276ae7;color:#fff;font-size:12px;letter-spacing:.12em;text-transform:uppercase;padding:4px 10px;border-radius:999px}h1{font-size:34px;line-height:1.2;margin:16px 0 8px}h2.sub{font-size:19px;font-weight:400;color:#3d4b60;margin:0 0 24px}article{line-height:1.75;font-size:17px}article h3{margin-top:32px}img.cover{width:100%;border-radius:14px;margin:8px 0 24px}.kit{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}.note{background:#fff4e5;color:#8a4b00;border-radius:10px;padding:10px 14px;font-size:14px;margin-bottom:20px}</style></head>
<body><main>${r.status !== 'published' ? `<p class="note">Preview: ${r.embargo_until ? `embargoed until ${esc(new Date(r.embargo_until).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }))} (Sydney)` : 'not yet published'}.</p>` : ''}
<span class="tag">Press release</span><h1>${esc(r.headline || 'Headline')}</h1>${r.subheadline ? `<h2 class="sub">${esc(r.subheadline)}</h2>` : ''}
${r.cover_url ? `<img class="cover" src="${esc(r.cover_url)}" alt="">` : ''}<article>${composeRelease(r, s, when)}</article>
${kit ? `<h3>Press kit</h3><div class="kit">${kit}</div>` : ''}</main></body></html>`;
  return new Response(html, { headers: { ...EMAIL_PAGE_HEADERS, 'cache-control': 'no-store' } });
};
