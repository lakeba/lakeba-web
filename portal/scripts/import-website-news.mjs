// Imports the public website's News & Media (../src/content/news/*.md) into the
// portal's posts table as public posts, with their images in the "news-media"
// bucket, so news can be managed in the portal from now on. Keeps every
// address (slug) and date. Safe to run again: it updates posts by slug.
//
//   node --env-file=.env scripts/import-website-news.mjs            (dry run)
//   node --env-file=.env scripts/import-website-news.mjs --apply
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { parse } from 'yaml';
import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');
const dir = new URL('../../src/content/news/', import.meta.url).pathname;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };

const { data: entities } = await svc.from('entities').select('id, display_name, relationship');
const group = entities.find((e) => e.relationship === 'group');
const entityFor = (venture) => entities.find((e) => e.display_name.toLowerCase() === venture.toLowerCase())?.id ?? group.id;

/** Uploads ./images/<slug>/<file> and returns its /news-media/ address. */
const uploaded = new Map();
async function media(rel) {
  const m = /^\.\/images\/([^/]+)\/([^/]+)$/.exec(rel);
  if (!m) return null;
  const file = join(dir, 'images', m[1], m[2]);
  if (!existsSync(file)) { console.warn('  missing image', rel); return null; }
  const ext = extname(m[2]).toLowerCase();
  const name = m[2].toLowerCase().replace(/\.jpeg$/, '.jpg').replace(/[^a-z0-9._-]/g, '-');
  const path = `site/${m[1].toLowerCase().replace(/[^a-z0-9-]/g, '-')}/${name}`;
  if (!uploaded.has(path)) {
    if (apply) {
      const { error } = await svc.storage.from('news-media').upload(path, readFileSync(file), { contentType: TYPES[ext] ?? 'application/octet-stream', upsert: true });
      if (error) throw new Error(`${path}: ${error.message}`);
    }
    uploaded.set(path, true);
  }
  return `/news-media/${path}`;
}

let count = 0;
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
for (const f of files) {
  const slug = f.slice(0, -3);
  const raw = readFileSync(join(dir, f), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!fm) { console.warn('skipped (no header)', f); continue; }
  const meta = parse(fm[1]);
  let body = fm[2].trim();
  for (const [, rel] of body.matchAll(/\]\((\.\/images\/[^)\s]+)\)/g)) body = body.replaceAll(rel, (await media(rel)) ?? rel);
  const cover = meta.cover ? await media(meta.cover) : null;
  const date = new Date(meta.date).toISOString();
  const row = {
    slug, title: meta.title, excerpt: meta.excerpt ?? '', body_md: body, body_html: '',
    entity_id: entityFor(meta.venture ?? 'Lakeba Group'), venture: meta.venture ?? 'Lakeba Group', categories: meta.categories ?? [],
    cover_url: cover, external: Boolean(meta.external), source_url: meta.source?.url ?? null, source_name: meta.source?.name ?? null,
    visibility: 'public', published_at: date, updated_at: date, notified_at: date,
  };
  count++;
  if (!apply) continue;
  const { data: saved, error } = await svc.from('posts').upsert(row, { onConflict: 'slug' }).select('id').single();
  if (error) throw new Error(`${slug}: ${error.message}`);
  const { count: revs } = await svc.from('post_revisions').select('id', { count: 'exact', head: true }).eq('post_id', saved.id);
  if (!revs) await svc.from('post_revisions').insert({ post_id: saved.id, title: row.title, excerpt: row.excerpt, body_html: '', cover_url: cover, reason: 'import' });
}
console.log(`${apply ? 'Imported' : 'Would import'} ${count} articles and ${uploaded.size} images.${apply ? '' : ' Run with --apply to do it.'}`);
