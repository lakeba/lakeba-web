// Keeps the portal's lists in step with its features. Run before every deploy (the "Deploy portal"
// workflow) and monthly, or by hand: npm run check:portal. It reads the code only (no database), and fails
// when something was added or removed in one place and not in the others:
//   1. Notifications: every kind the code sends is a choice in Profile → Notifications (and has its push text).
//   2. API: every /api/v1 route is in the reference (lib/api/spec.ts) with a real scope, and back.
//   3. Webhooks: every event the database emits is listed (lib/integrations/events.ts), and back.
//   4. Admin: every admin page is reachable from a menu, tab or link, and has an area in permissions.ts
//      (or is listed below as for group Admins only).
//   5. Translations: every text investors see has its Spanish, Italian and Chinese.
//   6. What's new: the newest entry is not older than the newest feature commit (a warning only).
// Warnings don't fail it; errors do. AGENTS.md has the checklist for what a script can't judge.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CATEGORIES } from '../src/lib/notification-events.ts';
import { AREAS } from '../src/lib/permissions.ts';
import { toShown } from '../src/lib/admin-paths.ts';

const root = new URL('..', import.meta.url).pathname;
const errors = [];
const warnings = [];
const read = (p) => readFileSync(join(root, p), 'utf8');
const walk = (dir) => readdirSync(join(root, dir)).flatMap((n) => {
  const p = join(dir, n);
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});
const source = walk('src').filter((p) => /\.(astro|ts|mjs)$/.test(p));
const text = new Map(source.map((p) => [p, read(p)]));

// ── 1. Notifications ────────────────────────────────────────────────────────────────────────────────
// A kind is sent through notifyMembers / notifyAdmins (or notifySecurity: 'security'); kinds chosen at run time
// are named in a `kinds:` list next to the call (e.g. NOTIFY_KINDS) or in KNOWN_DYNAMIC below.
const listed = new Map(CATEGORIES.flatMap((c) => c.kinds.map((k) => [k, c.key])));
const sent = new Map();
const note = (kind, file) => sent.set(kind, [...(sent.get(kind) ?? []), file]);
for (const [file, src] of text) {
  if (file.endsWith('notification-events.ts')) continue;
  for (const m of src.matchAll(/notify(?:Members|Admins)\(\s*\{/g)) {
    // The call's object literal: up to its closing brace at the same depth.
    let depth = 0, i = m.index + m[0].length - 1, end = i;
    for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) { end = i; break; } }
    const call = src.slice(m.index, end);
    for (const k of call.matchAll(/\bkind:\s*['`]([a-z_]+)['`]/g)) note(k[1], file);
  }
  if (/notifySecurity\(/.test(src) && !file.endsWith('lib/notify.ts')) note('security', file);
  for (const k of src.matchAll(/@notifies\s+([a-z_, ]+)/g)) for (const kind of k[1].split(/[ ,]+/).filter(Boolean)) note(kind, file);
}
for (const [kind, files] of sent) if (!listed.has(kind)) errors.push(`Notifications: "${kind}" is sent (${files[0]}) but isn't a choice in Profile → Notifications (lib/notification-events.ts).`);
for (const [kind, category] of listed) if (!sent.has(kind)) warnings.push(`Notifications: "${kind}" (${category}) is a choice people can make, but nothing sends it. Remove it, or mark the sender with "@notifies ${kind}".`);
const events = read('src/lib/notification-events.ts');
for (const [kind, key] of listed) if (!CATEGORIES.find((c) => c.key === key).emailOnly && !new RegExp(`case '${kind}'`).test(events)) warnings.push(`Notifications: "${kind}" has no push text in pushText() (it shows the generic one).`);
for (const c of CATEGORIES) if (c.audience === 'admin' && !c.section) errors.push(`Notifications: admin topic "${c.key}" has no section (which part of the admin menu it belongs to).`);

// ── 2. API reference ────────────────────────────────────────────────────────────────────────────────
// Routes that aren't part of the company API: they have their own documentation.
const NOT_IN_REFERENCE = {
  '/news': 'the website news API (publishable keys), documented in Admin → Companies → Website news',
  '/openapi.json': 'the reference itself',
};
const spec = read('src/lib/api/spec.ts');
const ops = [...spec.matchAll(/method: '([A-Z]+)', path: '([^']+)', scope: '([^']+)'/g)].map(([, method, path, scope]) => ({ method, path, scope }));
const routes = walk('src/pages/api/v1').filter((p) => p.endsWith('.ts')).map((p) => {
  const path = '/' + relative('src/pages/api/v1', p).replace(/\.ts$/, '').replace(/(^|\/)index$/, '').replace(/\[([^\]]+)\]/g, '{$1}');
  const methods = [...read(p).matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]);
  return { file: p, path: path === '/' ? '/' : path.replace(/\/$/, ''), methods };
});
const norm = (p) => p.replace(/\{[^}]+\}/g, '{}');
for (const r of routes) {
  if (NOT_IN_REFERENCE[r.path]) continue;
  for (const m of r.methods) if (!ops.some((o) => o.method === m && norm(o.path) === norm(r.path)) && !(m === 'DELETE' && ops.some((o) => o.method === 'PUT' && norm(o.path) === norm(r.path) && /DELETE removes/.test(spec))))
    errors.push(`API: ${m} ${r.path} (${r.file}) isn't in the reference (lib/api/spec.ts).`);
}
for (const o of ops) if (!routes.some((r) => norm(r.path) === norm(o.path) && r.methods.includes(o.method))) errors.push(`API: the reference lists ${o.method} ${o.path}, but there's no such route.`);
const API_AREAS = JSON.parse(read('src/lib/api/scopes.ts').match(/const API_AREAS = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
const scopes = new Set(['any', 'people.read', ...AREAS.filter((a) => API_AREAS.includes(a.key)).flatMap((a) => a.levels.filter((l) => l !== 'approve').map((l) => `${a.key}.${l}`))]);
for (const o of ops) if (!scopes.has(o.scope)) errors.push(`API: ${o.method} ${o.path} needs scope "${o.scope}", which keys can't have (lib/api/scopes.ts).`);

// ── 3. Webhook events ───────────────────────────────────────────────────────────────────────────────
// The newest migration that maps audit actions to events holds the whole mapping (create or replace).
const migrations = walk('supabase/migrations').filter((p) => p.endsWith('.sql')).sort();
const mapping = migrations.filter((p) => /then '[a-z_]+\.[a-z_]+'/.test(read(p))).at(-1);
const emitted = new Set([...read(mapping).matchAll(/then '([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]));
const documented = new Set([...read('src/lib/integrations/events.ts').matchAll(/^\s+'([a-z_]+\.[a-z_]+)':/gm)].map((m) => m[1]));
for (const e of emitted) if (!documented.has(e)) errors.push(`Webhooks: the database emits "${e}" (${mapping}) but it isn't in EVENTS (lib/integrations/events.ts), so the docs and endpoint settings don't show it.`);
for (const e of documented) if (!emitted.has(e)) errors.push(`Webhooks: "${e}" is listed in EVENTS but the database never emits it (${mapping}).`);

// ── 4. Admin pages ──────────────────────────────────────────────────────────────────────────────────
// Pages outside the areas on purpose: lib/access.ts opens them by its own rules (the overview and What's new
// for all staff, Approvals for anyone who prepares or approves, Integrations for Admins, Legal requests for
// any staff role). Anything else outside an area is for group Admins only.
const GROUP_ADMIN_PAGES = ['/admin', '/admin/approvals', '/admin/integrations', '/admin/legal-requests', '/admin/whats-new'];
const pages = walk('src/pages/admin').filter((p) => p.endsWith('.astro') && !p.includes('['))
  .map((p) => ({ file: p, path: '/' + relative('src/pages', p).replace(/\.astro$/, '').replace(/\/index$/, '') }));
const everything = [...text.values()].join('\n');
for (const p of pages) {
  const shown = toShown(p.path);
  const linked = [shown, p.path].some((h) => new RegExp(`['"\`]${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['"\`?#]|\\$\\{)`).test(everything.replace(text.get(p.file), '')));
  if (!linked && p.path !== '/admin') errors.push(`Admin: ${shown} (${p.file}) isn't linked from any menu, tab or page.`);
  const area = AREAS.some((a) => a.menu.some((m) => p.path === m || p.path.startsWith(`${m}/`)));
  if (!area && !GROUP_ADMIN_PAGES.some((g) => p.path === g || (g !== '/admin' && p.path.startsWith(`${g}/`)))) errors.push(`Admin: ${shown} has no area in permissions.ts, so only group Admins can open it. Add it to an area, or to GROUP_ADMIN_PAGES in this script if that's intended.`);
}

// ── 5. Translations ─────────────────────────────────────────────────────────────────────────────────
// Texts investors see: t('…') outside the admin. Some files are English-only on purpose.
const ENGLISH_ONLY = [/^src\/pages\/admin\//, /^src\/pages\/(developers|tablet|press|setup|my-hr|sign)\b/, /^src\/pages\/api\//, /^src\/components\/(admin|setup)\//, /Nav\.astro$/, /^src\/layouts\/Admin\.astro$/, /^src\/lib\/(i18n|newsletter-design)\.ts$/];
const catalogues = await Promise.all(walk('src/i18n').map(async (p) => (await import(join(root, p))).default));
const has = (lang, key) => catalogues.some((c) => c[lang] && key in c[lang]);
const missing = new Map();
for (const [file, src] of text) {
  if (ENGLISH_ONLY.some((re) => re.test(file)) || !/\bt\(|\bt\.n\(/.test(src)) continue;
  const lit = String.raw`'((?:[^'\\]|\\.)+)'`;
  const keys = [
    ...[...src.matchAll(new RegExp(String.raw`(?<![\w.])t\(\s*` + lit, 'g'))].map((m) => m[1]),
    ...[...src.matchAll(new RegExp(String.raw`\bt\.n\([^,]+,\s*` + lit + String.raw`\s*,\s*` + lit, 'g'))].flatMap((m) => [m[1], m[2]]),
    ...[...src.matchAll(new RegExp(String.raw`\bt\.c\(\s*` + lit + String.raw`\s*,\s*` + lit, 'g'))].map((m) => `${m[1]}|${m[2]}`),
  ];
  for (const raw of keys) {
    const key = raw.replace(/\\'/g, "'");
    for (const lang of ['es', 'it', 'zh']) if (!has(lang, key) && !(key.includes('|') && has(lang, key.split('|')[1]))) missing.set(`${lang}: ${key}`, file);
  }
}
for (const [what, file] of missing) errors.push(`Translations: no ${what.slice(0, 2) === 'es' ? 'Spanish' : what.slice(0, 2) === 'it' ? 'Italian' : 'Chinese'} for "${what.slice(4)}" (${file}).`);

// ── 6. What's new ───────────────────────────────────────────────────────────────────────────────────
try {
  const latest = read('src/lib/whats-new.ts').match(/date: '(\d{4}-\d{2}-\d{2})'/)?.[1];
  const commit = execFileSync('git', ['log', '-1', '--format=%cs', '--', 'src/pages', 'src/lib'], { cwd: root, encoding: 'utf8' }).trim();
  if (latest && commit && commit > latest) warnings.push(`What's new: the newest entry is ${latest}, but pages changed on ${commit}. Add an entry if people would notice (lib/whats-new.ts).`);
} catch { /* no git (e.g. a release folder) */ }

for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`error    ${e}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s). Checked ${sent.size} notification kinds, ${routes.length} API routes, ${emitted.size} webhook events, ${pages.length} admin pages.`);
process.exit(errors.length ? 1 : 0);
