// Staff guides (docs/guides/README.md). Shared by the guide seeds: the sample company (code SMPL, "Sample Co") and the account that takes the
// screenshots (sam.taylor@sample.example.invalid, Admin of Sample Co only). removeAll() takes out every row
// that points at Sample Co, its stored files, the account and what its sign-ins left behind.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
export const { PDFDocument, StandardFonts } = require('pdf-lib');

const url = process.env.SUPABASE_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):(54321|56321)$/.test(url)) throw new Error('local staging only');
export const svc = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
export const DOMAIN = '@sample.example.invalid';
const HERE = new URL('.', import.meta.url).pathname;
const day = 86400_000;
export const d = (n) => new Date(Date.now() + n * day).toISOString().slice(0, 10);
export const ts = (n) => new Date(Date.now() + n * day).toISOString();
// The CRM branch's copy of staging (port 56321) has its own database container.
const DB = url.includes(':56321') ? 'supabase_db_lakeba-portal-crm' : 'supabase_db_lakeba-portal';
export const sql = (q) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
export const ins = async (table, row) => { if (Array.isArray(row)) { const out = []; for (const r of row) out.push(await ins(table, r)); return out; } const { data, error } = await svc.from(table).insert(row).select('*'); if (error) throw new Error(`${table}: ${error.message} ${error.details ?? ''}`); return Array.isArray(row) ? data : data[0]; };
export const pdf = async (title, lines = []) => {
  const doc = await PDFDocument.create(); const pg = doc.addPage([595, 842]); const f = await doc.embedFont(StandardFonts.Helvetica);
  pg.drawText(`${title} (sample)`, { x: 60, y: 760, size: 18, font: f });
  [...lines, 'Sample document for the staff guides.'].forEach((l, i) => pg.drawText(l, { x: 60, y: 728 - i * 18, size: 11, font: f }));
  return doc.save();
};

/** The ids a seed made, for the shot lists' {{name}} placeholders (scripts/guides/ids.json, not committed). */
export const saveIds = (ids) => writeFileSync(`${HERE}ids.json`, JSON.stringify(ids, null, 1));

export async function removeAll() {
  try { sql(`delete from register_movements where holder_id in (select id from holders where registry_ref like 'SAMPLE-%')`); sql(`delete from holdings where holder_id in (select id from holders where registry_ref like 'SAMPLE-%')`); sql(`delete from holder_members where holder_id in (select id from holders where registry_ref like 'SAMPLE-%')`); sql(`delete from holders where registry_ref like 'SAMPLE-%'`); } catch (e) { console.log('holders', String(e.stderr ?? e).slice(0, 200)); }
  for (const code of ['SMPLB', 'SMPL']) await removeEntity(code);
  await removeUsers();
  try { sql(`delete from board_summaries where commentary like '%(Sample commentary.)%'`); } catch {}
}
async function removeEntity(code) {
  const E = sql(`select id from entities where code = '${code}'`);
  if (E) {
    for (const b of sql(`select distinct bucket_id from storage.objects where name like '${E}/%'`).split('\n').filter(Boolean)) {
      const names = sql(`select name from storage.objects where bucket_id = '${b}' and name like '${E}/%'`).split('\n').filter(Boolean);
      for (let i = 0; i < names.length; i += 100) await svc.storage.from(b).remove(names.slice(i, i + 100));
    }
    // Every public table with an entity_id: delete Sample Co's rows, a few passes for foreign-key order.
    const tables = sql(`select table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema = 'public' and c.column_name = 'entity_id' and t.table_type = 'BASE TABLE' and table_name <> 'entities'`).split('\n').filter(Boolean);
    for (let pass = 0; pass < 4; pass++) for (const t of tables) { try { sql(`delete from public.${t} where entity_id = '${E}'`); } catch {} }
    try { sql(`delete from audit_log where detail->>'entity_id' = '${E}'`); } catch {}
    try { sql(`delete from entities where id = '${E}'`); } catch (e) { console.log('entity', code, String(e.stderr ?? e).slice(0, 300)); }
  }
}
async function removeUsers() {
  const users = sql(`select id from auth.users where email like '%${DOMAIN}'`).split('\n').filter(Boolean);
  for (const u of users) {
    for (const t of ['user_roles', 'passkey_sessions', 'notification_preferences', 'notifications', 'announcement_views', 'audit_log', 'admin_devices', 'holder_members', 'legal_ask_log', 'hr_ask_log']) { try { sql(`delete from ${t} where user_id = '${u}'`); } catch {} }
    const { error } = await svc.auth.admin.deleteUser(u);
    if (error) console.log('delete user', error.message);
  }
  sql(`delete from notifications where title ilike '%${DOMAIN}%' or body ilike '%${DOMAIN}%' or title ilike '%(sample)%' or body ilike '%(sample)%' or title ilike '%Sample Co%' or title ilike '%Sample Labs%'`);
}

export async function createBase({ groupWide = true } = {}) {
  const ent = await ins('entities', { code: 'SMPL', display_name: 'Sample Co', relationship: 'controlled', portal: 'none', sort: 998, tagline: 'Sample company for the staff guides' });
  const email = `sam.taylor${DOMAIN}`;
  const password = `Sx${randomBytes(15).toString('base64url')}9k`;
  const { data: au, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: 'Sam', last_name: 'Taylor (sample)' } });
  if (error) throw error;
  await svc.from('profiles').update({ first_name: 'Sam', last_name: 'Taylor (sample)', first_signed_in_at: new Date().toISOString() }).eq('id', au.user.id).throwOnError();
  await ins('user_roles', { user_id: au.user.id, role_key: 'admin', entity_id: groupWide ? null : ent.id, note: 'Staff guide screenshots (sample)' });
  writeFileSync(`${HERE}account.json`, JSON.stringify({ email, password }));
  return { E: ent.id, uid: au.user.id };
}
