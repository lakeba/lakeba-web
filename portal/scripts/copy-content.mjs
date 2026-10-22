// Copies the portal's content from one Supabase to another (e.g. the Mac to
// the hosted project): documents with their files and search text, news
// posts, current announcements, portfolio cards, settings, Ask approved
// answers and tests. Investors, holdings and accounts are NOT copied: load
// them with the investor data workbook (Admin → Import data) first, so
// holder-only documents can be matched to holders by Holder ID.
//
//   node scripts/copy-content.mjs --from .env --to .env.production            dry run
//   node scripts/copy-content.mjs --from .env --to .env.production --apply
//
// Safe to run again: rows keep their ids and are upserted; files that are
// already there are skipped. Companies are matched by code (LKB, EZF, …).
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes('--apply');
const readEnv = (file) => Object.fromEntries(readFileSync(file, 'utf8').split('\n')
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (!arg('--from') || !arg('--to')) { console.error('Usage: copy-content.mjs --from <env file> --to <env file> [--apply]'); process.exit(2); }
const [fromEnv, toEnv] = [readEnv(arg('--from')), readEnv(arg('--to'))];
if (fromEnv.SUPABASE_URL === toEnv.SUPABASE_URL) { console.error('Source and target are the same Supabase.'); process.exit(2); }
const client = (env) => createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const src = client(fromEnv);
const dst = client(toEnv);
console.log(`${apply ? 'Copying' : 'Dry run (nothing written)'}: ${fromEnv.SUPABASE_URL} → ${toEnv.SUPABASE_URL}\n`);

const all = async (q) => { const { data, error } = await q; if (error) throw error; return data ?? []; };
const [srcEntities, dstEntities] = await Promise.all([all(src.from('entities').select('id, code')), all(dst.from('entities').select('id, code'))]);
const codeOf = new Map(srcEntities.map((e) => [e.id, e.code]));
const dstEntity = new Map(dstEntities.map((e) => [e.code, e.id]));
const mapEntity = (id) => dstEntity.get(codeOf.get(id)) ?? null;
const missingEntities = srcEntities.filter((e) => !dstEntity.has(e.code)).map((e) => e.code);
if (missingEntities.length) { console.error(`Companies missing in the target: ${missingEntities.join(', ')}. Apply the migrations first.`); process.exit(1); }

const report = [];
const note = (what, n, extra = '') => report.push(`${what.padEnd(28)} ${String(n).padStart(4)}${extra ? `  ${extra}` : ''}`);
const upsert = async (table, rows) => {
  for (let i = 0; i < rows.length; i += 200) await dst.from(table).upsert(rows.slice(i, i + 200)).throwOnError();
};

// --- Documents, their files and search text --------------------------------
const [srcHolders, dstHolders] = await Promise.all([all(src.from('holders').select('id, registry_ref')), all(dst.from('holders').select('id, registry_ref'))]);
const refOf = new Map(srcHolders.map((h) => [h.id, h.registry_ref]));
const dstHolder = new Map(dstHolders.map((h) => [h.registry_ref, h.id]));
const docs = await all(src.from('documents').select('*').order('created_at'));
const skipped = [];
const docRows = [];
for (const d of docs) {
  let holderId = null;
  if (d.audience === 'holder') {
    holderId = dstHolder.get(refOf.get(d.holder_id)) ?? null;
    if (!holderId) { skipped.push(`${d.title} (holder ${refOf.get(d.holder_id) ?? '?'} not in the target yet)`); continue; }
  }
  docRows.push({ ...d, entity_id: mapEntity(d.entity_id), holder_id: holderId, created_by: null });
}
let copiedFiles = 0; let presentFiles = 0;
if (apply) {
  for (const d of docRows) {
    const { data: exists } = await dst.storage.from('documents').list(d.file_path.split('/').slice(0, -1).join('/'), { search: d.file_path.split('/').pop() });
    if (exists?.some((f) => f.name === d.file_path.split('/').pop())) { presentFiles++; continue; }
    const { data: blob, error } = await src.storage.from('documents').download(d.file_path);
    if (error || !blob) throw new Error(`Could not read ${d.file_path}: ${error?.message}`);
    const { error: upErr } = await dst.storage.from('documents').upload(d.file_path, blob, { contentType: d.mime_type, upsert: false });
    if (upErr) throw new Error(`Could not store ${d.file_path}: ${upErr.message}`);
    copiedFiles++;
  }
  await upsert('documents', docRows);
}
note('Documents', docRows.length, apply ? `(${copiedFiles} files copied, ${presentFiles} already there)` : '');
if (skipped.length) note('Documents skipped', skipped.length, skipped.join('; '));

const chunks = docRows.length ? await all(src.from('document_chunks').select('document_id, chunk_index, page, content').in('document_id', docRows.map((d) => d.id)).range(0, 99999)) : [];
if (apply) {
  for (let i = 0; i < chunks.length; i += 200) await dst.from('document_chunks').upsert(chunks.slice(i, i + 200), { onConflict: 'document_id,chunk_index' }).throwOnError();
}
note('Document search passages', chunks.length);

// --- News, announcements, portfolio ----------------------------------------
const posts = (await all(src.from('posts').select('*'))).map((p) => ({ ...p, entity_id: mapEntity(p.entity_id) }));
const now = new Date().toISOString();
const announcements = (await all(src.from('announcements').select('*'))).filter((a) => !a.ends_at || a.ends_at > now).map((a) => ({ ...a, entity_id: mapEntity(a.entity_id) }));
const ventures = (await all(src.from('ventures').select('*'))).map((v) => ({ ...v, entity_id: v.entity_id ? mapEntity(v.entity_id) : null }));
const updates = await all(src.from('venture_updates').select('*'));
if (apply) { await upsert('posts', posts); await upsert('announcements', announcements); await upsert('ventures', ventures); await upsert('venture_updates', updates); }
note('News posts', posts.length);
note('Announcements (current)', announcements.length);
note('Portfolio cards', ventures.length, `(${updates.length} milestones)`);

// --- Settings and Ask -------------------------------------------------------
const settings = await all(src.from('portal_settings').select('key, value'));
const askSettings = (await all(src.from('ask_settings').select('key, value'))).map((s) => ({ ...s, updated_by: null }));
const approved = (await all(src.from('ask_approved_answers').select('*'))).map((a) => ({ ...a, entity_id: mapEntity(a.entity_id), source_exchange_id: null, created_by: null, updated_by: null }));
const tests = (await all(src.from('ask_test_cases').select('*'))).map((t) => ({ ...t, entity_id: mapEntity(t.entity_id), source_exchange_id: null, created_by: null }));
if (apply) { await upsert('portal_settings', settings); await upsert('ask_settings', askSettings); await upsert('ask_approved_answers', approved); await upsert('ask_test_cases', tests); }
note('Portal settings', settings.length, settings.map((s) => s.key).join(', '));
note('Ask settings', askSettings.length, askSettings.map((s) => s.key).join(', '));
note('Ask approved answers', approved.length);
note('Ask test cases', tests.length);

console.log(report.join('\n'));
console.log(`\nNot copied: holders, holdings, people and accounts (use the workbook), Board Q&A, Ask history, notifications, read receipts, audit log.`);
if (!apply) console.log('Run again with --apply to copy.');
