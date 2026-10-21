// Imports investors, holdings and documents exported from the WordPress portal.
//
//   node --env-file=.env scripts/import-legacy.mjs <folder> [--apply] [--invite]
//
// <folder> contains any of:
//   investors.csv  email, first_name, last_name, phone, role, registry_ref, access
//   holdings.csv   registry_ref, holder_name, kind, share_class_code, shares, as_at
//   documents.csv  file, title, category, published_at, audience, registry_ref, summary
//                  (`file` is a path relative to the folder)
// Templates are in migration-templates/. Without --apply nothing is written:
// the script validates everything and prints what it would do. --invite emails
// each new investor a link to set their password (otherwise accounts are
// created without sending email, e.g. to invite in batches later).
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import Papa from 'papaparse';
import { createClient } from '@supabase/supabase-js';
import { extractText, getDocumentProxy } from 'unpdf';
import nodemailer from 'nodemailer';

const [folder, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');
const invite = flags.includes('--invite');
if (!folder) throw new Error('Usage: import-legacy.mjs <folder> [--apply] [--invite]');
if (invite && !process.env.SMTP_URL) throw new Error('--invite needs SMTP_URL so the portal can send the invitation emails');
const portalUrl = process.env.PORTAL_URL ?? 'http://localhost:4322';
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const mailer = invite ? nodemailer.createTransport(process.env.SMTP_URL) : null;
const sendInvite = (to, link) => mailer.sendMail({
  from: process.env.MAIL_FROM ?? 'Lakeba Investor Relations <investors@lakeba.com>',
  to,
  subject: 'Your Lakeba Investor Portal invitation',
  text: `Lakeba has moved its investor portal. Use this link to choose your password (it expires in 24 hours):\n\n${link}`,
});

const KINDS = ['individual', 'company', 'trust', 'super_fund'];
const ROLES = ['investor', 'board', 'admin'];
const CATEGORIES = ['report', 'agm', 'update', 'governance', 'register', 'video', 'other'];
const MIME = { '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

const problems = [];
const read = (name) => {
  const path = join(folder, name);
  if (!existsSync(path)) return null;
  const { data, errors } = Papa.parse(readFileSync(path, 'utf8'), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  errors.forEach((e) => problems.push(`${name} row ${e.row + 2}: ${e.message}`));
  return data.map((row, i) => ({ ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? '').trim()])), _line: i + 2 }));
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s));

const holdings = read('holdings.csv') ?? [];
const investors = read('investors.csv') ?? [];
const documents = read('documents.csv') ?? [];

const { data: classes } = await svc.from('share_classes').select('id, code');
const classByCode = new Map((classes ?? []).map((c) => [c.code, c.id]));
const { data: existingHolders } = await svc.from('holders').select('id, registry_ref');
const holderByRef = new Map((existingHolders ?? []).map((h) => [h.registry_ref, h.id]));
const knownRefs = new Set([...holderByRef.keys(), ...holdings.map((h) => h.registry_ref)]);

for (const h of holdings) {
  if (!h.registry_ref) problems.push(`holdings.csv line ${h._line}: registry_ref is required`);
  if (!KINDS.includes(h.kind)) problems.push(`holdings.csv line ${h._line}: kind must be one of ${KINDS.join(', ')}`);
  if (!classByCode.has(h.share_class_code)) problems.push(`holdings.csv line ${h._line}: unknown share class "${h.share_class_code}"`);
  if (!/^\d+$/.test(h.shares)) problems.push(`holdings.csv line ${h._line}: shares must be a whole number`);
  if (!isDate(h.as_at)) problems.push(`holdings.csv line ${h._line}: as_at must be YYYY-MM-DD`);
}
for (const v of investors) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) problems.push(`investors.csv line ${v._line}: invalid email`);
  if (v.role && !ROLES.includes(v.role)) problems.push(`investors.csv line ${v._line}: role must be one of ${ROLES.join(', ')}`);
  if (v.registry_ref && !knownRefs.has(v.registry_ref)) problems.push(`investors.csv line ${v._line}: unknown registry_ref "${v.registry_ref}"`);
  if (v.access && !['owner', 'viewer'].includes(v.access)) problems.push(`investors.csv line ${v._line}: access must be owner or viewer`);
}
for (const d of documents) {
  if (!existsSync(join(folder, d.file))) problems.push(`documents.csv line ${d._line}: file not found: ${d.file}`);
  if (!MIME[extname(d.file).toLowerCase()]) problems.push(`documents.csv line ${d._line}: unsupported file type ${extname(d.file)}`);
  if (!CATEGORIES.includes(d.category)) problems.push(`documents.csv line ${d._line}: category must be one of ${CATEGORIES.join(', ')}`);
  if (d.published_at && !isDate(d.published_at)) problems.push(`documents.csv line ${d._line}: published_at must be YYYY-MM-DD`);
  const audience = d.audience || 'all_investors';
  if (!['all_investors', 'board', 'holder'].includes(audience)) problems.push(`documents.csv line ${d._line}: audience must be all_investors, board or holder`);
  if (audience === 'holder' && !knownRefs.has(d.registry_ref)) problems.push(`documents.csv line ${d._line}: holder documents need a known registry_ref`);
}

const newHolders = [...new Map(holdings.filter((h) => !holderByRef.has(h.registry_ref)).map((h) => [h.registry_ref, h])).values()];
console.log(`Target: ${process.env.SUPABASE_URL}`);
console.log(`Holdings rows: ${holdings.length} (new holders: ${newHolders.length})`);
console.log(`Investor accounts: ${investors.length}${invite ? ' (invitation emails will be sent)' : ' (no emails)'}`);
console.log(`Documents: ${documents.length}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s) — nothing was imported:`);
  problems.forEach((p) => console.log(`  - ${p}`));
  process.exit(1);
}
if (!apply) {
  console.log('\nDry run only. Re-run with --apply to import.');
  process.exit(0);
}

// 1. Holders and holdings.
for (const h of newHolders) {
  const { data } = await svc.from('holders').insert({ name: h.holder_name, kind: h.kind, registry_ref: h.registry_ref }).select('id').single().throwOnError();
  holderByRef.set(h.registry_ref, data.id);
}
if (holdings.length) {
  await svc.from('holdings').upsert(holdings.map((h) => ({
    holder_id: holderByRef.get(h.registry_ref), share_class_id: classByCode.get(h.share_class_code), shares: Number(h.shares), as_at: h.as_at,
  })), { onConflict: 'holder_id,share_class_id,as_at' }).throwOnError();
}

// 2. Accounts and holder links.
const { data: { users } } = await svc.auth.admin.listUsers({ perPage: 1000 });
for (const v of investors) {
  let user = users.find((u) => u.email?.toLowerCase() === v.email.toLowerCase());
  if (!user) {
    const meta = { first_name: v.first_name, last_name: v.last_name };
    // Invitations carry a token hash that /auth/confirm verifies on the server
    // (Supabase's own invite email would put the token in the URL fragment).
    const { data, error } = invite
      ? await svc.auth.admin.generateLink({ type: 'invite', email: v.email, options: { data: meta } })
      : await svc.auth.admin.createUser({ email: v.email, email_confirm: false, user_metadata: meta });
    if (error) { console.log(`  ! ${v.email}: ${error.message}`); continue; }
    user = data.user;
    if (invite) await sendInvite(v.email, `${portalUrl}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite`);
  }
  await svc.from('profiles').update({ role: v.role || 'investor', phone: v.phone || null }).eq('id', user.id).throwOnError();
  if (v.registry_ref) {
    await svc.from('holder_members').upsert({ holder_id: holderByRef.get(v.registry_ref), user_id: user.id, access: v.access || 'owner' }).throwOnError();
  }
}

// 3. Documents into private storage, PDFs indexed for Ask Lakeba.
for (const d of documents) {
  const bytes = readFileSync(join(folder, d.file));
  const mime = MIME[extname(d.file).toLowerCase()];
  const year = (d.published_at || new Date().toISOString()).slice(0, 4);
  const path = `${d.category}/${year}/${crypto.randomUUID()}-${d.file.split('/').pop().replace(/[^A-Za-z0-9._-]+/g, '-')}`;
  const { error } = await svc.storage.from('documents').upload(path, bytes, { contentType: mime });
  if (error) { console.log(`  ! ${d.file}: ${error.message}`); continue; }
  const audience = d.audience || 'all_investors';
  const { data: row } = await svc.from('documents').insert({
    title: d.title, summary: d.summary || null, category: d.category, file_path: path, mime_type: mime, size_bytes: bytes.length,
    audience, holder_id: audience === 'holder' ? holderByRef.get(d.registry_ref) : null,
    published_at: d.published_at ? new Date(d.published_at).toISOString() : null,
  }).select('id').single().throwOnError();
  if (mime === 'application/pdf') {
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false });
    const chunks = text.flatMap((t, i) => {
      const clean = t.replace(/\s+/g, ' ').trim();
      return Array.from({ length: Math.ceil(clean.length / 1200) }, (_, k) => ({ page: i + 1, content: clean.slice(k * 1200, (k + 1) * 1200) }));
    }).filter((c) => c.content.length > 20).map((c, n) => ({ ...c, document_id: row.id, chunk_index: n }));
    if (chunks.length) await svc.from('document_chunks').insert(chunks).throwOnError();
  }
}
console.log('\nImport complete.');
