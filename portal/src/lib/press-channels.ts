import { createHmac, randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';
import { BLUESKY_APP_PASSWORD, BLUESKY_HANDLE, BLUESKY_SERVICE, PUBLIC_SITE_URL, X_ACCESS_SECRET, X_ACCESS_TOKEN, X_API_BASE, X_API_KEY, X_API_SECRET } from 'astro:env/server';
import type { serviceClient } from './admin';
import { MEDIA_PREFIX, plainText } from './news-cms';
import { composeRelease, releaseDate, sydneyTime, type PressSettings, type Release } from './press';
import { releasePdf } from './press-pdf';

type Svc = ReturnType<typeof serviceClient>;

// Beyond the newsroom and the journalists: social networks and wire services.
// Bluesky and X are posted by the portal (when their keys are set on the
// server); LinkedIn company pages need LinkedIn's approval for posting by API,
// so a page admin shares it with one click and records the post's link. Wire
// services (EIN Presswire, Medianet, PR Newswire…) have no open submission
// API: the portal prepares the package they ask for (text, PDF, images),
// downloadable or emailed to their desk, and records the cost and their link.

/** A channel's name as people write it. */
export const channelName = (c: string) => ({ linkedin: 'LinkedIn', bluesky: 'Bluesky', x: 'X', wire: 'Wire', other: 'Other' } as Record<string, string>)[c] ?? c;

export const blueskyConfigured = () => Boolean(BLUESKY_HANDLE && BLUESKY_APP_PASSWORD);
export const xConfigured = () => Boolean(X_API_KEY && X_API_SECRET && X_ACCESS_TOKEN && X_ACCESS_SECRET);

const site = () => PUBLIC_SITE_URL.replace(/\/$/, '');
export const articleUrl = (slug: string) => `${site()}/news/${slug}/`;
export const linkedinShareUrl = (url: string) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;

/** Text for a network, within its limit (graphemes, roughly characters), ending with the link if it fits. */
export function socialText(text: string, url: string, limit: number, urlCost = url.length) {
  const room = limit - urlCost - 2;
  const t = [...text.trim()].length > room ? `${[...text.trim()].slice(0, room - 1).join('').replace(/\s+\S*$/, '')}…` : text.trim();
  return `${t}\n\n${url}`;
}

/** The release's main picture as a JPEG under 950 KB (Bluesky's limit is about 1 MB). */
async function coverJpeg(svc: Svc, r: Release) {
  if (!r.cover_url?.startsWith(MEDIA_PREFIX)) return null;
  const { data } = await svc.storage.from('news-media').download(r.cover_url.slice(MEDIA_PREFIX.length));
  if (!data) return null;
  for (const q of [82, 70, 55]) {
    const out = await sharp(Buffer.from(await data.arrayBuffer())).rotate().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: q }).toBuffer();
    if (out.length < 950_000) return out;
  }
  return null;
}

async function bsky<T>(path: string, init: { token?: string; json?: unknown; body?: Buffer; type?: string }) {
  const res = await fetch(`${BLUESKY_SERVICE.replace(/\/$/, '')}/xrpc/${path}`, {
    method: 'POST',
    headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), 'content-type': init.type ?? 'application/json' },
    body: init.body ? new Uint8Array(init.body) : JSON.stringify(init.json ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(`Bluesky: ${data.message ?? data.error ?? res.status}`);
  return data;
}

/** Posts to Bluesky with a link card (title, summary, picture); returns the post's address. */
export async function postBluesky(svc: Svc, r: Release, text: string, url: string) {
  if (!blueskyConfigured()) throw new Error('Bluesky isn’t set up on the server.');
  const session = await bsky<{ accessJwt: string; did: string; handle: string }>('com.atproto.server.createSession', { json: { identifier: BLUESKY_HANDLE, password: BLUESKY_APP_PASSWORD } });
  const img = await coverJpeg(svc, r).catch(() => null);
  const thumb = img ? (await bsky<{ blob: unknown }>('com.atproto.repo.uploadBlob', { token: session.accessJwt, body: img, type: 'image/jpeg' })).blob : undefined;
  const full = socialText(text, url, 300);
  // Links are only clickable with a facet, whose position is counted in UTF-8 bytes.
  const start = Buffer.byteLength(full.slice(0, full.lastIndexOf(url)), 'utf8');
  const record = {
    $type: 'app.bsky.feed.post', text: full, createdAt: new Date().toISOString(), langs: ['en'],
    facets: [{ index: { byteStart: start, byteEnd: start + Buffer.byteLength(url, 'utf8') }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }] }],
    embed: { $type: 'app.bsky.embed.external', external: { uri: url, title: r.headline.slice(0, 300), description: (r.summary || r.subheadline).slice(0, 1000), ...(thumb ? { thumb } : {}) } },
  };
  const out = await bsky<{ uri: string }>('com.atproto.repo.createRecord', { token: session.accessJwt, json: { repo: session.did, collection: 'app.bsky.feed.post', record } });
  const rkey = out.uri.split('/').pop()!;
  return { url: `https://bsky.app/profile/${session.handle}/post/${rkey}`, id: out.uri, text: full };
}

const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
/** OAuth 1.0a (HMAC-SHA1) for X: a JSON body isn't part of the signature. */
function xAuth(method: string, url: string) {
  const params: Record<string, string> = { oauth_consumer_key: X_API_KEY!, oauth_nonce: randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: X_ACCESS_TOKEN!, oauth_version: '1.0' };
  const base = [method, pct(url), pct(Object.keys(params).sort().map((k) => `${pct(k)}=${pct(params[k])}`).join('&'))].join('&');
  params.oauth_signature = createHmac('sha1', `${pct(X_API_SECRET!)}&${pct(X_ACCESS_SECRET!)}`).update(base).digest('base64');
  return `OAuth ${Object.keys(params).sort().map((k) => `${pct(k)}="${pct(params[k])}"`).join(', ')}`;
}

/** Posts to X (links count as 23 characters); returns the post's address. */
export async function postX(text: string, url: string) {
  if (!xConfigured()) throw new Error('X isn’t set up on the server.');
  const endpoint = `${X_API_BASE.replace(/\/$/, '')}/2/tweets`;
  const full = socialText(text, url, 280, 23);
  const res = await fetch(endpoint, { method: 'POST', headers: { authorization: xAuth('POST', endpoint), 'content-type': 'application/json' }, body: JSON.stringify({ text: full }) });
  const data = (await res.json().catch(() => ({}))) as { data?: { id: string }; detail?: string; title?: string };
  if (!res.ok || !data.data?.id) throw new Error(`X: ${data.detail ?? data.title ?? res.status}`);
  return { url: `https://x.com/i/web/status/${data.data.id}`, id: data.data.id, text: full };
}

/** The release as wires want it: plain text, embargo or "for immediate release" first, dateline, boilerplate, contact, ###. */
export function wireText(r: Release, s: PressSettings, url: string, origin: string) {
  const embargo = r.status === 'published' ? null : r.embargo_until ?? r.publish_at;
  const when = r.published_at ?? r.publish_at ?? new Date().toISOString();
  const blocks = [...composeRelease(r, s, when).matchAll(/<(p|li|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({ tag: m[1].toLowerCase(), text: plainText(m[2].replace(/<br\s*\/?>/gi, '\n')) }));
  const body = blocks.map((b) => (b.tag === 'li' ? `• ${b.text}` : b.tag === 'h3' ? `\n${b.text}` : b.text)).join('\n\n');
  return [
    embargo ? `EMBARGOED UNTIL ${sydneyTime(embargo).toUpperCase()} (SYDNEY)` : 'FOR IMMEDIATE RELEASE',
    '', r.headline.toUpperCase(), r.subheadline, '', body.trim(), '',
    '—', `Summary: ${r.summary || r.subheadline}`,
    r.kit.length ? `Images (for editorial use):\n${r.kit.map((k) => `• ${k.label || 'Image'}: ${k.url.startsWith('/') ? `${origin}${k.url}` : k.url}`).join('\n')}` : '',
    `Online: ${url}`,
  ].filter((x) => x !== '').join('\n');
}

/** Everything a wire asks for, in one zip: the text, a Word-friendly HTML copy, the PDF and the images. */
export async function wirePackage(svc: Svc, r: Release, s: PressSettings, slug: string | null, origin: string) {
  const url = slug ? articleUrl(slug) : `${origin}/admin/press/${r.id}`;
  const zip = new JSZip();
  const when = r.published_at ?? r.publish_at ?? new Date().toISOString();
  const name = (r.headline || 'press-release').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  zip.file(`${name}.txt`, wireText(r, s, url, origin));
  zip.file(`${name}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>${r.headline.replace(/</g, '&lt;')}</title></head><body style="font-family:Arial,sans-serif;max-width:720px"><p><strong>${r.status === 'published' ? 'FOR IMMEDIATE RELEASE' : `EMBARGOED UNTIL ${sydneyTime(r.embargo_until ?? r.publish_at ?? when)} (SYDNEY)`}</strong></p><h1>${r.headline.replace(/</g, '&lt;')}</h1>${r.subheadline ? `<h2>${r.subheadline.replace(/</g, '&lt;')}</h2>` : ''}${composeRelease(r, s, when)}</body></html>`);
  zip.file(`${name}.pdf`, await releasePdf(r, s, when, url));
  for (const [i, k] of r.kit.entries()) {
    if (!k.url.startsWith(MEDIA_PREFIX)) continue;
    const { data } = await svc.storage.from('news-media').download(k.url.slice(MEDIA_PREFIX.length));
    if (data) zip.file(`images/${String(i + 1).padStart(2, '0')}-${(k.label || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}${k.url.slice(k.url.lastIndexOf('.'))}`, Buffer.from(await data.arrayBuffer()));
  }
  return { name, bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), text: wireText(r, s, url, origin), date: releaseDate(when) };
}
