import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import JSZip from 'jszip';
import sharp from 'sharp';
import type { serviceClient } from './admin';
import { MEDIA_PREFIX } from './news-cms';
import { makeEmailSafe } from './newsletter-design';
import { FETCH_TEST_PREFIXES } from 'astro:env/server';

type Svc = ReturnType<typeof serviceClient>;

// Importing a newsletter template from elsewhere: pasted HTML or MJML, a file
// (.html, .mjml, .eml saved from an email program, or a .zip with its images),
// a "view in browser" address, or a screenshot. Whatever comes in is made
// safe, the sender's tracking and links are removed, and its images are
// copied into the portal's image store so nothing loads from their servers.

export type Source = {
  kind: 'html' | 'mjml' | 'image';
  text: string;
  image?: { data: Buffer; type: string };
  /** Images that came with it (a .zip's files, an email's attachments), by path or cid. */
  files: Map<string, { data: Buffer; type: string }>;
  label: string;
  /** Where relative image paths point: the page's address, or the folder inside a .zip. */
  base?: string;
};
export type ReadResult = Source | { error: string };

const MAX_TEXT = 1_500_000, MAX_FILE = 15 * 1024 * 1024, MAX_IMAGE = 5 * 1024 * 1024, MAX_IMAGES = 40;
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const typeOfName = (n: string) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as Record<string, string>)[n.split('.').pop()?.toLowerCase() ?? ''];
const isMjml = (s: string) => /<mjml[\s>]/i.test(s);

// ---------- Fetching from the internet, safely ----------

/** True for addresses on the public internet; false for the server itself, private networks and the like. */
export function publicAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return publicAddress(v.slice(7));
  return !(v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff') || v.startsWith('64:ff9b') || v.startsWith('2001:db8'));
}

/** DNS lookup that refuses non-public addresses, checked when connecting (so a name can't switch to an internal address in between). */
export const safeLookup: LookupFunction = (host, options, cb) => {
  lookup(host, { ...options, all: true }, (err, addresses) => {
    if (err) return (cb as (e: Error | null, a?: unknown, f?: number) => void)(err);
    const list = (addresses as unknown as { address: string; family: number }[]).filter((a) => publicAddress(a.address));
    if (!list.length) return (cb as (e: Error) => void)(new Error('not a public address'));
    if ((options as { all?: boolean }).all) (cb as (e: null, a: unknown) => void)(null, list);
    else (cb as (e: null, a: string, f: number) => void)(null, list[0].address, list[0].family);
  });
};

/** GET a public http(s) address: at most `max` bytes, 3 redirects and 12 seconds. */
/** Staging tests only: local stand-ins the fetcher may reach (never set in production). */
const testAllowed = (url: string) => (FETCH_TEST_PREFIXES ?? '').split(',').map((p) => p.trim()).filter(Boolean).some((p) => url.startsWith(p));

export async function safeGet(url: string, max: number, redirects = 3): Promise<{ data: Buffer; type: string; url: string }> {
  if (testAllowed(url)) { const r = await fetch(url, { signal: AbortSignal.timeout(12_000) }); return { data: Buffer.from(await r.arrayBuffer()), type: (r.headers.get('content-type') ?? '').split(';')[0], url }; }
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https addresses can be imported.');
  if (u.username || u.password || (u.port && !['80', '443'].includes(u.port))) throw new Error('That address can’t be imported.');
  if (isIP(u.hostname.replace(/^\[|\]$/g, '')) && !publicAddress(u.hostname.replace(/^\[|\]$/g, ''))) throw new Error('That address can’t be imported.');
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, { method: 'GET', lookup: safeLookup, headers: { 'user-agent': 'LakebaPortal/1.0 (newsletter template import)', accept: '*/*' }, timeout: 12_000 }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Too many redirects.'));
        return resolve(safeGet(new URL(res.headers.location, u).toString(), max, redirects - 1));
      }
      if (status !== 200) { res.resume(); return reject(new Error(`The address answered ${status}.`)); }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > max) { req.destroy(); reject(new Error('That is too large to import.')); } else chunks.push(c); });
      res.on('end', () => resolve({ data: Buffer.concat(chunks), type: String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), url: u.toString() }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The address took too long to answer.')));
    req.on('error', (e) => reject(new Error(/public address/.test(e.message) ? 'That address can’t be imported.' : e.message)));
    req.end();
  });
}

// ---------- Saved emails (.eml) ----------

const decodeQP = (s: string) => Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
const charsetText = (buf: Buffer, charset: string) => { try { return new TextDecoder(charset || 'utf-8').decode(buf); } catch { return buf.toString('utf8'); } };
function headersOf(block: string) {
  const h = new Map<string, string>();
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) h.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()); }
  return h;
}
const param = (v: string, name: string) => new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, 'i').exec(v)?.[1] ?? '';

/** The HTML of a saved email, and its inline images (by cid:). */
export function parseEml(raw: string) {
  const files = new Map<string, { data: Buffer; type: string }>();
  let html = '';
  const walk = (part: string, depth: number) => {
    if (depth > 6) return;
    const split = part.search(/\r?\n\r?\n/);
    const h = headersOf(split < 0 ? part : part.slice(0, split));
    const body = split < 0 ? '' : part.slice(split).replace(/^\r?\n\r?\n/, '');
    const ctype = (h.get('content-type') ?? 'text/plain').toLowerCase();
    if (ctype.startsWith('multipart/')) {
      const boundary = param(h.get('content-type') ?? '', 'boundary');
      if (!boundary) return;
      for (const p of body.split(`--${boundary}`).slice(1)) if (!p.startsWith('--')) walk(p.replace(/^\r?\n/, ''), depth + 1);
      return;
    }
    const enc = (h.get('content-transfer-encoding') ?? '').toLowerCase();
    const bytes = enc === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64') : enc === 'quoted-printable' ? decodeQP(body) : Buffer.from(body, 'latin1');
    if (ctype.startsWith('text/html') && !html) html = charsetText(bytes, param(h.get('content-type') ?? '', 'charset'));
    else if (ctype.startsWith('image/')) {
      const cid = (h.get('content-id') ?? '').replace(/[<>]/g, '');
      const type = ctype.split(';')[0].trim();
      if (cid && IMAGE_EXT[type]) files.set(`cid:${cid}`, { data: bytes, type });
    }
  };
  walk(raw, 0);
  return { html, files };
}

// ---------- Reading what was given ----------

export async function readSource(input: { paste?: string; file?: File | null; url?: string }): Promise<ReadResult> {
  const files = new Map<string, { data: Buffer; type: string }>();
  const paste = (input.paste ?? '').trim();
  if (paste) {
    if (paste.length > MAX_TEXT) return { error: 'That is too long to import.' };
    return { kind: isMjml(paste) ? 'mjml' : 'html', text: paste, files, label: 'Pasted' };
  }
  const file = input.file && input.file.size ? input.file : null;
  if (file) {
    if (file.size > MAX_FILE) return { error: 'Files can be up to 15 MB.' };
    const name = file.name.toLowerCase(), data = Buffer.from(await file.arrayBuffer());
    const label = `File ${file.name.slice(0, 100)}`;
    if (typeOfName(name) && !name.endsWith('.gif')) {
      if (data.length > 10 * 1024 * 1024) return { error: 'Screenshots can be up to 10 MB.' };
      return { kind: 'image', text: '', image: { data, type: typeOfName(name) }, files, label };
    }
    if (name.endsWith('.eml')) {
      const { html, files: f } = parseEml(data.toString('latin1'));
      if (!html) return { error: 'That email has no HTML part to import.' };
      return { kind: isMjml(html) ? 'mjml' : 'html', text: html, files: f, label };
    }
    if (name.endsWith('.zip')) {
      let zip: JSZip;
      try { zip = await JSZip.loadAsync(data); } catch { return { error: 'That zip file can’t be opened.' }; }
      const entries = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name));
      const main = entries.find((f) => /\.mjml$/i.test(f.name)) ?? entries.find((f) => /(^|\/)index\.html?$/i.test(f.name)) ?? entries.find((f) => /\.html?$/i.test(f.name));
      if (!main) return { error: 'The zip file has no .html or .mjml file.' };
      let total = 0;
      for (const f of entries) {
        const type = typeOfName(f.name);
        if (!type) continue;
        const d = Buffer.from(await f.async('uint8array'));
        total += d.length; if (total > 40 * 1024 * 1024) return { error: 'The zip file’s images are too large.' };
        files.set(f.name.replace(/^\.\//, ''), { data: d, type });
      }
      const text = await main.async('string');
      return { kind: /\.mjml$/i.test(main.name) ? 'mjml' : 'html', text, files, label: `${label} (${main.name})`, base: main.name.includes('/') ? main.name.replace(/[^/]+$/, '') : '' };
    }
    if (/\.(html?|mjml|txt)$/.test(name)) {
      const text = data.toString('utf8');
      return { kind: name.endsWith('.mjml') || isMjml(text) ? 'mjml' : 'html', text, files, label };
    }
    return { error: 'Use an .html, .mjml, .eml or .zip file, or a PNG/JPEG screenshot.' };
  }
  const url = (input.url ?? '').trim();
  if (url) {
    try {
      const res = await safeGet(url, 3 * 1024 * 1024);
      if (IMAGE_EXT[res.type] && res.type !== 'image/gif') return { kind: 'image', text: '', image: { data: res.data, type: res.type }, files, label: `From ${res.url.slice(0, 200)}` };
      const text = res.data.toString('utf8');
      if (!/html|text\/plain|xml/.test(res.type) && !/<html|<mjml/i.test(text)) return { error: 'That address doesn’t return an email page.' };
      return { kind: isMjml(text) ? 'mjml' : 'html', text, files, label: `From ${res.url.slice(0, 200)}`, base: res.url };
    } catch (e) { return { error: (e as Error).message || 'That address couldn’t be read.' }; }
  }
  return { error: 'Paste the HTML or MJML, choose a file, or give an address.' };
}

// ---------- Cleaning and re-hosting ----------

/** Removes the sender's tracking pixels and links (which may carry the reader's own tokens), keeping the layout. */
export function stripSender(html: string) {
  return makeEmailSafe(html)
    // Tracking pixels: tiny or hidden images.
    .replace(/<img\b[^>]*>/gi, (tag) => (/\b(width|height)\s*=\s*["']?[01](px)?["'\s>]/i.test(tag) || /\b(width|height)\s*:\s*[01]px/i.test(tag) || /display\s*:\s*none/i.test(tag) ? '' : tag))
    // Their links (tracked, personal): kept as links, pointing nowhere until edited.
    .replace(/(<a\b[^>]*?\shref\s*=\s*)(["'])(?!mailto:|#|\{\{)[^"']*\2/gi, '$1$2#$2')
    .replace(/(<mj-(?:button|image|social-element|navbar-link)\b[^>]*?\shref\s*=\s*)(["'])(?!#|\{\{)[^"']*\2/gi, '$1$2#$2')
    // Forms of "open in browser" and unsubscribe links are now dead: the portal adds its own.
    .replace(/\ssrcset\s*=\s*(["'])[^"']*\1/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');
}

/** Every image address in a template: src, background attributes, CSS url() and MJML image attributes. */
const IMAGE_REFS = /(\s(?:src|background|background-url)\s*=\s*)(["'])([^"']+)\2|(url\(\s*)(["']?)([^"')]+)\5(\s*\))/gi;

/** Copies the template's images into the portal's image store and points the template at them. */
export async function rehostImages(svc: Svc, html: string, origin: string, files: Map<string, { data: Buffer; type: string }>, base = '') {
  const found = new Set<string>();
  for (const m of html.matchAll(IMAGE_REFS)) found.add((m[3] ?? m[6]).trim().replace(/&amp;/g, '&'));
  const map = new Map<string, string>();
  let failed = 0, copied = 0;
  for (const ref of [...found].slice(0, MAX_IMAGES * 2)) {
    if (copied >= MAX_IMAGES) { map.set(ref, ''); failed++; continue; }
    if (ref.startsWith(`${origin}${MEDIA_PREFIX}`) || ref.startsWith(`${origin}/logos/`)) continue;
    try {
      let img: { data: Buffer; type: string } | undefined;
      if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(ref)) img = { data: Buffer.from(ref.split(',')[1], 'base64'), type: ref.slice(5, ref.indexOf(';')).toLowerCase() };
      else if (ref.startsWith('cid:')) img = files.get(ref);
      else if (/^https?:\/\//i.test(ref)) { const r = await safeGet(ref, MAX_IMAGE); img = { data: r.data, type: IMAGE_EXT[r.type] ? r.type : typeOfName(new URL(ref).pathname) ?? r.type }; }
      else if (base && /^https?:/.test(base)) { const r = await safeGet(new URL(ref, base).toString(), MAX_IMAGE); img = { data: r.data, type: IMAGE_EXT[r.type] ? r.type : typeOfName(ref) ?? r.type }; }
      else img = files.get(`${base}${ref}`.replace(/^\.\//, '').replace(/\/\.\//g, '/')) ?? files.get(ref.replace(/^\.\//, ''));
      if (!img || !IMAGE_EXT[img.type] || img.data.length > MAX_IMAGE) throw new Error('not an image');
      // Must really be an image (and not, say, an HTML page called .png).
      const meta = await sharp(img.data, { animated: true }).metadata();
      if (!meta.format || !['png', 'jpeg', 'gif', 'webp'].includes(meta.format)) throw new Error('not an image');
      const path = `${new Date().getUTCFullYear()}/${randomUUID()}.${IMAGE_EXT[img.type]}`;
      const { error } = await svc.storage.from('news-media').upload(path, new Uint8Array(img.data), { contentType: img.type });
      if (error) throw error;
      map.set(ref, `${origin}${MEDIA_PREFIX}${path}`); copied++;
    } catch { map.set(ref, ''); failed++; }
  }
  const out = html.replace(IMAGE_REFS, (all, a1, q1, v1, u1, q2, v2, u3) => {
    const v = (v1 ?? v2).trim().replace(/&amp;/g, '&');
    if (!map.has(v)) return all;
    const to = map.get(v)!;
    return v1 !== undefined ? `${a1}${q1}${to}${q1}` : to ? `${u1}${q2}${to}${q2}${u3}` : 'none';
  });
  return { html: out, copied, failed };
}

/** A screenshot made ready to show to Claude: at most 1,000 px wide and 7,000 px tall, as PNG. */
export async function screenshotForClaude(img: { data: Buffer }) {
  const out = await sharp(img.data).rotate().resize({ width: 1000, height: 7000, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  return out.toString('base64');
}

/** Stores a screenshot in the image store, to show as "the original". */
export async function storeScreenshot(svc: Svc, img: { data: Buffer; type: string }, origin: string) {
  const data = await sharp(img.data).rotate().resize({ width: 1400, withoutEnlargement: true }).png().toBuffer();
  const path = `${new Date().getUTCFullYear()}/${randomUUID()}.png`;
  const { error } = await svc.storage.from('news-media').upload(path, new Uint8Array(data), { contentType: 'image/png' });
  if (error) throw error;
  return `${origin}${MEDIA_PREFIX}${path}`;
}
