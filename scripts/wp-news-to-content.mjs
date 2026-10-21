// Converts WordPress posts into the site's news content collection.
//
//   node scripts/wp-news-to-content.mjs <posts.json> <uploads-dir> [out-dir] [files-dir]
//
// <posts.json> is a JSON array exported from the WordPress database, one
// object per published post with: id, slug, title, date (GMT), modified,
// content (HTML), excerpt, categories[], source_url (ACF link1),
// source_name (ACF website-title), company (ACF), description, cover
// (the thumbnail's _wp_attached_file path). <uploads-dir> is the
// wp-content/uploads folder from the backup. Images are resized to at most
// 1600px wide and saved as WebP next to the Markdown. Linked documents
// (PDFs and similar) are copied to [files-dir] (default public/news/files).
// Re-running replaces the generated files.
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const [exportFile, uploadsDir, outDir = 'src/content/news', filesDir = 'public/news/files'] = process.argv.slice(2);
if (!exportFile || !uploadsDir) throw new Error('Usage: wp-news-to-content.mjs <posts.json> <uploads-dir> [out-dir]');

const posts = JSON.parse(readFileSync(exportFile, 'utf8'));
const slugs = new Set(posts.map((p) => p.slug));
const SKIP_CATEGORIES = new Set(['Uncategorised', 'Uncategorized', 'Static Posts']);

rmSync(outDir, { recursive: true, force: true });
rmSync(filesDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'images'), { recursive: true });
mkdirSync(filesDir, { recursive: true });

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => entities[n.toLowerCase()] ?? m);
const plain = (html) => decode(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const yaml = (v) => JSON.stringify(v); // JSON strings are valid YAML scalars

/** Resizes an upload into the post's image folder; returns the relative path or null. */
async function copyImage(uploadPath, slug, name) {
  const src = join(uploadsDir, uploadPath);
  if (!existsSync(src)) return null;
  mkdirSync(join(outDir, 'images', slug), { recursive: true });
  const ext = extname(src).toLowerCase();
  if (['.gif', '.svg'].includes(ext)) {
    const file = `${name}${ext}`;
    copyFileSync(src, join(outDir, 'images', slug, file));
    return `./images/${slug}/${file}`;
  }
  const file = `${name}.webp`;
  await sharp(src).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toFile(join(outDir, 'images', slug, file));
  return `./images/${slug}/${file}`;
}

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' });
turndown.use(gfm);
// Keep YouTube embeds; drop any other iframe.
turndown.addRule('youtube', {
  filter: (node) => node.nodeName === 'IFRAME',
  replacement: (_, node) => {
    const src = node.getAttribute('src') ?? '';
    const id = src.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/)?.[1];
    return id ? `\n\n<iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube video" loading="lazy" allowfullscreen></iframe>\n\n` : '';
  },
});
turndown.addRule('figcaption', { filter: 'figcaption', replacement: (content) => (content.trim() ? `\n\n*${content.trim()}*\n\n` : '') });

const report = { posts: 0, external: 0, images: 0, missingImages: 0, files: 0, missingFiles: 0 };
for (const p of posts) {
  const slug = p.slug;
  let html = (p.content ?? '').replace(/<!--[\s\S]*?-->/g, '');

  // Inline images: copy, then point at the local file. Links that only wrap
  // an image and point at the upload are unwrapped.
  let n = 0;
  const imgs = [...html.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/g)];
  for (const [tag, src] of imgs) {
    const upload = src.match(/\/wp-content\/uploads\/(.+?)(?:\?.*)?$/)?.[1];
    if (!upload) { html = html.replace(tag, ''); continue; } // theme icons
    const local = await copyImage(upload, slug, `image-${++n}`);
    if (local) report.images++; else report.missingImages++;
    html = html.replace(tag, local ? tag.replace(src, local).replace(/\s(srcset|sizes)="[^"]*"/g, '') : '');
  }
  html = html.replace(/<a[^>]+href="[^"]*\/wp-content\/uploads\/[^"]*"[^>]*>\s*(<img[^>]*>)\s*<\/a>/g, '$1');
  // Linked documents are copied into the site; pages live at /news/<slug>/.
  html = html.replace(/href="[^"]*\/wp-content\/uploads\/([^"?]+\.(?:pdf|docx?|xlsx?|pptx?|mp4))(?:\?[^"]*)?"/gi, (m, upload) => {
    const src = join(uploadsDir, upload);
    if (!existsSync(src)) { report.missingFiles++; return m; }
    const file = basename(upload);
    copyFileSync(src, join(filesDir, file));
    report.files++;
    return `href="../files/${file}"`;
  });
  // Links to other posts become links within the news section.
  html = html.replace(/href="https?:\/\/(?:www\.)?lakeba\.com\/([a-z0-9-]+)\/?"/g, (m, s) => (slugs.has(s) ? `href="../${s}/"` : m));

  const body = turndown.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
  const cover = p.cover ? await copyImage(p.cover, slug, 'cover') : null;
  if (p.cover) cover ? report.images++ : report.missingImages++;

  const excerpt = plain(p.excerpt || p.description || '') || plain(p.content ?? '').slice(0, 220).replace(/\s\S*$/, '…');
  let sourceUrl = p.source_url && /^https?:\/\//.test(p.source_url) ? p.source_url.trim() : null;
  // A source that is itself an uploaded file (e.g. a press clipping PDF) is copied too.
  const sourceUpload = sourceUrl?.match(/\/wp-content\/uploads\/([^?]+)/)?.[1];
  if (sourceUpload && existsSync(join(uploadsDir, sourceUpload))) {
    copyFileSync(join(uploadsDir, sourceUpload), join(filesDir, basename(sourceUpload)));
    report.files++;
    sourceUrl = `../files/${basename(sourceUpload)}`;
  }
  const sourceName = (p.source_name && p.source_name !== 'NULL' && p.source_name.trim()) || (sourceUrl?.startsWith('http') ? new URL(sourceUrl).hostname.replace(/^www\./, '') : sourceUrl ? 'Press clipping (PDF)' : null);
  const external = !body;
  if (external) report.external++;
  const date = (p.date && !p.date.startsWith('0000') ? p.date : p.modified).replace(' ', 'T') + 'Z';

  const front = [
    '---',
    `title: ${yaml(decode(p.title))}`,
    `date: ${date}`,
    `excerpt: ${yaml(excerpt)}`,
    `venture: ${yaml(p.company && p.company !== 'NULL' ? p.company : 'Lakeba Group')}`,
    `categories: ${yaml((p.categories ?? []).filter((c) => !SKIP_CATEGORIES.has(c)))}`,
    cover ? `cover: ${yaml(cover)}` : null,
    sourceUrl ? `source: { url: ${yaml(sourceUrl)}, name: ${yaml(sourceName)} }` : null,
    `external: ${external}`,
    `wordpressId: ${p.id}`,
    '---',
  ].filter(Boolean).join('\n');
  writeFileSync(join(outDir, `${slug}.md`), `${front}\n\n${body}\n`);
  report.posts++;
}
console.log(report);
