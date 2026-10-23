// Adds clearly marked fake investors, holdings and content to the staging
// database on this Mac, next to the real data, so every portal function can be
// tried. Everything it adds can be found and removed again:
//   people     email ends in @fake.lakeba.test, names end in "(fake)"
//   holders    registry_ref starts with FAKE-
//   classes    code starts with FAKE- (only in the ventures, which have none yet)
//   content    titles end in "(fake)", slugs start with fake-
//
//   node --env-file=.env scripts/seed-staging-fake.mjs           # add (replaces an earlier run)
//   node --env-file=.env scripts/seed-staging-fake.mjs --remove  # take it all out
//
// Passwords for the sign-in personas go to ../private/fake-staging-users.json.
// Only runs against the local staging stack (port 54321); never production.
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const url = process.env.SUPABASE_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(url)) throw new Error('seed-staging-fake only runs against the local staging stack (port 54321).');
const svc = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const root = new URL('..', import.meta.url).pathname;
const DOMAIN = '@fake.lakeba.test';
const day = 86400_000;
const ago = (d) => new Date(Date.now() - d * day).toISOString();
const ahead = (d) => new Date(Date.now() + d * day).toISOString();

// ---------------------------------------------------------------------------
// Remove everything an earlier run added
// ---------------------------------------------------------------------------
async function remove() {
  const like = (t, col, pattern) => svc.from(t).delete().like(col, pattern).throwOnError();
  await like('meetings', 'title', '%(fake)');
  const { data: docs } = await svc.from('documents').select('id, file_path').like('title', '%(fake)');
  if (docs?.length) {
    await svc.storage.from('documents').remove(docs.map((d) => d.file_path));
    await svc.from('documents').delete().in('id', docs.map((d) => d.id)).throwOnError();
  }
  await like('posts', 'slug', 'fake-%');
  await like('announcements', 'title', '%(fake)');
  await like('ventures', 'slug', 'fake-%');
  await like('ask_approved_answers', 'question', '%(fake)');
  await like('holders', 'registry_ref', 'FAKE-%');
  const { data: classes } = await svc.from('share_classes').select('id').like('code', 'FAKE-%');
  if (classes?.length) {
    const ids = classes.map((c) => c.id);
    await svc.from('holdings').delete().in('share_class_id', ids).throwOnError();
    await svc.from('reference_prices').delete().in('share_class_id', ids).throwOnError();
    await svc.from('share_classes').delete().in('id', ids).throwOnError();
  }
  const { data: people } = await svc.from('profiles').select('id').like('email', `%${DOMAIN}`);
  for (const p of people ?? []) {
    await svc.from('proxy_votes').delete().eq('lodged_by', p.id);
    await svc.from('query_messages').delete().eq('author_id', p.id);
    const { error } = await svc.auth.admin.deleteUser(p.id);
    if (error) throw error;
  }
  console.log(`Removed fake data (${people?.length ?? 0} people, ${docs?.length ?? 0} documents, ${classes?.length ?? 0} share classes).`);
}

await remove();
if (process.argv.includes('--remove')) process.exit(0);

// ---------------------------------------------------------------------------
// Companies already in staging
// ---------------------------------------------------------------------------
const { data: entities } = await svc.from('entities').select('id, code, display_name');
const E = Object.fromEntries(entities.map((e) => [e.code, e]));
const { data: lkbClasses } = await svc.from('share_classes').select('id, code').eq('entity_id', E.LKB.id);
const C = Object.fromEntries(lkbClasses.map((c) => [`LKB-${c.code}`, c.id]));

// Share classes for the ventures (they have none yet), all marked FAKE-.
const ventureClasses = [
  ['EZF', 'FAKE-ORD', 'Ordinary shares (fake)', 'ordinary', true, true, 10_000_000],
  ['EZF', 'FAKE-OPT', 'Employee options (fake)', 'options', false, false, 600_000],
  ['DOX', 'FAKE-ORD', 'Ordinary shares (fake)', 'ordinary', true, true, 5_000_000],
  ['BRK', 'FAKE-ORD', 'Ordinary shares (fake)', 'ordinary', true, true, 8_000_000],
  ['SHF', 'FAKE-ORD', 'Ordinary shares (fake)', 'ordinary', true, true, 4_000_000],
  ['SHF', 'FAKE-PREF', 'Series A preference shares (fake)', 'preference', true, true, 1_000_000],
];
for (const [co, code, name, kind, voting, counts, official] of ventureClasses) {
  const { data } = await svc.from('share_classes').insert({
    entity_id: E[co].id, code, name, kind, voting, counts_toward_pct: counts, official_on_issue: official, official_as_at: '2026-06-30',
  }).select('id').single().throwOnError();
  C[`${co}-${code.slice(5)}`] = data.id;
}
await svc.from('reference_prices').insert([
  { share_class_id: C['EZF-ORD'], price: 1.2, priced_on: '2026-03-31', source: 'capital_raise', note: 'Seed extension (fake)' },
  { share_class_id: C['DOX-ORD'], price: 0.85, priced_on: '2026-02-28', source: 'capital_raise', note: 'Pre-seed (fake)' },
  { share_class_id: C['BRK-ORD'], price: 2.1, priced_on: '2025-12-31', source: 'valuation', note: 'Directors’ valuation (fake)' },
  { share_class_id: C['SHF-ORD'], price: 0.6, priced_on: '2026-05-31', source: 'secondary_trade', note: '(fake)' },
  { share_class_id: C['SHF-PREF'], price: 0.9, priced_on: '2026-01-31', source: 'capital_raise', note: 'Series A (fake)' },
]).throwOnError();

// ---------------------------------------------------------------------------
// People and holders
// ---------------------------------------------------------------------------
const personas = [];
async function person(local, first, last, { role = 'investor', signIn = false } = {}) {
  const email = `${local}${DOMAIN}`;
  const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { first_name: first, last_name: `${last} (fake)` } });
  if (error) throw error;
  if (role !== 'investor') await svc.from('profiles').update({ role }).eq('id', data.user.id).throwOnError();
  if (signIn) {
    const password = `Fk${randomBytes(12).toString('base64url')}7q`;
    await svc.auth.admin.updateUserById(data.user.id, { password });
    personas.push({ email, password, who: `${first} ${last}` });
  }
  return data.user.id;
}
let ref = 0;
async function holder(name, kind, extra = {}) {
  const { data } = await svc.from('holders').insert({ name: `${name} (fake)`, kind, registry_ref: `FAKE-${String(++ref).padStart(4, '0')}`, ...extra }).select('id').single().throwOnError();
  return data.id;
}
const member = (holderId, userId, access = 'owner') => svc.from('holder_members').insert({ holder_id: holderId, user_id: userId, access }).throwOnError();
const hold = (holderId, cls, shares, asAt = '2026-06-30', extra = {}) => svc.from('holdings').insert({ holder_id: holderId, share_class_id: C[cls], shares, as_at: asAt, ...extra }).throwOnError();

// Sign-in personas, one per kind of shareholder.
const grace = await person('group.only', 'Grace', 'Galloway', { signIn: true });
const graceH = await holder('Grace Galloway', 'individual');
const graceSuper = await holder('Galloway Super Pty Ltd ATF Galloway Super Fund', 'super_fund');
await member(graceH, grace); await member(graceSuper, grace);
await hold(graceH, 'LKB-ORD', 120_000, '2024-06-30'); await hold(graceH, 'LKB-ORD', 150_000); await hold(graceSuper, 'LKB-ORD', 80_000); await hold(graceSuper, 'LKB-F', 25_000);

const marco = await person('group.ezifin', 'Marco', 'Bennett', { signIn: true });
const accountant = await person('accountant', 'Avery', 'Accountant', { signIn: true });
const marcoH = await holder('Bennett Family Trust', 'trust');
await member(marcoH, marco); await member(marcoH, accountant, 'viewer');
await hold(marcoH, 'LKB-ORD', 400_000); await hold(marcoH, 'EZF-ORD', 250_000);

const priya = await person('ezifin.only', 'Priya', 'Iverson', { signIn: true });
const priyaH = await holder('Priya Iverson', 'individual');
await member(priyaH, priya);
await hold(priyaH, 'EZF-ORD', 180_000); await hold(priyaH, 'EZF-OPT', 60_000, '2026-06-30', { exercise_price: 0.5, expires_on: '2029-06-30' });

const kenji = await person('doxai.bricklet', 'Kenji', 'Hartley', { signIn: true });
const kenjiH = await holder('Hartley Ventures Pty Ltd', 'company');
await member(kenjiH, kenji);
await hold(kenjiH, 'DOX-ORD', 300_000); await hold(kenjiH, 'BRK-ORD', 450_000);

const sofia = await person('shelfie.only', 'Sofia', 'Stanton', { signIn: true });
const sofiaH = await holder('Sofia Stanton', 'individual');
await member(sofiaH, sofia);
await hold(sofiaH, 'SHF-PREF', 200_000); await hold(sofiaH, 'SHF-ORD', 50_000);

// Switched off: no Ask, no Board Q&A.
const quiet = await person('switched.off', 'Quinn', 'Quinlan', { signIn: true });
const quietH = await holder('Quinn Quinlan', 'individual');
await member(quietH, quiet);
await hold(quietH, 'LKB-ORD', 30_000);
await svc.from('ask_user_pauses').insert({ user_id: quiet, reason: 'Switched off for testing (fake)' }).throwOnError();
await svc.from('profiles').update({ board_qa_enabled: false }).eq('id', quiet).throwOnError();

// Company roles, no holdings (so they can be deleted).
const director = await person('director.ezifin', 'Dana', 'Director', { signIn: true });
const coadmin = await person('admin.ezifin', 'Felix', 'Fairbank', { signIn: true });
const board = await person('board.lakeba', 'Bea', 'Board', { role: 'board', signIn: true });
await svc.from('entity_board').insert([
  { entity_id: E.EZF.id, user_id: director, position: 'director', starts_on: '2024-01-15' },
  { entity_id: E.LKB.id, user_id: board, position: 'observer', starts_on: '2026-07-01' },
]).throwOnError();
await svc.from('entity_admins').insert({ entity_id: E.EZF.id, user_id: coadmin }).throwOnError();

// Lakeba's own stakes in the ventures.
const lakeba = await holder('Lakeba Group Limited', 'company', { represents_entity_id: E.LKB.id });
await hold(lakeba, 'EZF-ORD', 7_200_000); await hold(lakeba, 'DOX-ORD', 3_250_000); await hold(lakeba, 'BRK-ORD', 6_400_000); await hold(lakeba, 'SHF-ORD', 2_900_000);

// The rest of each venture register over fictional holders, about two thirds with a
// login (never signed in; some only invited), plus a few small Lakeba holders.
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const firstNames = ['Olivia', 'Liam', 'Mia', 'Noah', 'Ava', 'Ethan', 'Isla', 'Lucas', 'Chloe', 'Leo', 'Ruby', 'Jack', 'Ella', 'Max', 'Ivy', 'Sam', 'Mei', 'Ravi', 'Nina', 'Tom'];
const lastNames = ['Archer', 'Calloway', 'Dunmore', 'Ellison', 'Fairley', 'Jarvis', 'Kingsley', 'Langford', 'Marsden', 'Northcott', 'Oakley', 'Pemberton', 'Radcliffe', 'Thornbury'];
let n = 0;
const fillers = [];
for (const [cls, count, total] of [['EZF-ORD', 5, 2_370_000], ['EZF-OPT', 3, 540_000], ['DOX-ORD', 4, 1_450_000], ['BRK-ORD', 3, 1_150_000], ['SHF-ORD', 3, 1_050_000], ['SHF-PREF', 2, 800_000], ['LKB-ORD', 6, 240_000]]) {
  let left = total;
  for (let i = 0; i < count; i++) {
    const shares = i === count - 1 ? left : Math.round((total / count) * (0.6 + rand() * 0.8) / 100) * 100;
    left -= shares;
    const first = firstNames[n % firstNames.length]; const last = lastNames[(n * 5) % lastNames.length]; n++;
    const kind = n % 5 === 0 ? 'company' : n % 7 === 0 ? 'trust' : 'individual';
    const name = kind === 'company' ? `${last} Holdings Pty Ltd` : kind === 'trust' ? `${last} Family Trust` : `${first} ${last}`;
    const h = await holder(name, kind);
    await hold(h, cls, shares, '2026-06-30', cls === 'EZF-OPT' ? { exercise_price: 0.5, expires_on: '2029-06-30' } : {});
    if (n % 3 !== 0) {
      const id = await person(`${first}.${last}.${n}`.toLowerCase(), first, last);
      await member(h, id);
      fillers.push(id);
    }
  }
}

// Holding notes (warning icon + banner).
await svc.from('holding_notes').insert([
  { holder_id: graceSuper, share_class_id: C['LKB-F'], note: 'F class shares are non-voting and convert to ordinary shares on a liquidity event. (fake)' },
  { holder_id: priyaH, share_class_id: C['EZF-OPT'], note: '20,000 of these options vest on 1 July 2027. (fake)' },
]).throwOnError();

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------
const { data: admins } = await svc.from('profiles').select('id').eq('role', 'admin').not('email', 'like', `%${DOMAIN}`).limit(1);
const adminId = admins?.[0]?.id ?? null;

async function pdf(title, paragraphs, company) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  let y = 780;
  page.drawText(company, { x: 56, y, size: 10, font, color: rgb(0.4, 0.45, 0.5) }); y -= 24;
  page.drawText(title, { x: 56, y, size: 16, font: bold, color: rgb(0.04, 0.11, 0.22) }); y -= 34;
  for (const para of paragraphs) {
    for (const line of para.match(/.{1,90}(\s|$)/g) ?? [para]) { page.drawText(line.trim(), { x: 56, y, size: 10.5, font }); y -= 15; }
    y -= 10;
  }
  page.drawText('FAKE DOCUMENT FOR TESTING. All names and figures are made up.', { x: 56, y: 40, size: 8, font, color: rgb(0.8, 0.1, 0.1) });
  return doc.save();
}
// Fake documents stay out of Ask's knowledge base so Ask keeps answering from real documents.
async function addDocument(code, { title, category, summary, audience = 'all_investors', days, paragraphs, shared = false, holderId = null }) {
  const e = E[code];
  const bytes = await pdf(title, paragraphs, e.display_name);
  const path = `entity/${e.id}/${category}/fake-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
  const { error } = await svc.storage.from('documents').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  const { data } = await svc.from('documents').insert({
    entity_id: e.id, title, summary, category, audience, holder_id: holderId, shared_with_group: shared, file_path: path, mime_type: 'application/pdf',
    size_bytes: bytes.length, published_at: ago(days), created_by: adminId, in_knowledge_base: false,
  }).select('id').single().throwOnError();
  return data.id;
}
const lkbReport = await addDocument('LKB', { title: 'FY26 Shareholder Update (fake)', category: 'update', summary: 'A made-up group update for testing.', days: 12, paragraphs: ['Group revenue grew 18% in this made-up update. Lakeba holds controlling stakes in Ezifin, DoxAI, Bricklet and Shelfie.'] });
await addDocument('LKB', { title: 'Board papers October 2026 (fake)', category: 'governance', summary: 'For directors only.', audience: 'board', days: 2, paragraphs: ['Made-up board pack.'] });
await addDocument('LKB', { title: 'Holding statement Galloway Super (fake)', category: 'other', summary: 'Visible only to this holder.', audience: 'holder', holderId: graceSuper, days: 6, paragraphs: ['Holding statement for Galloway Super Fund: 80,000 ordinary and 25,000 F class shares.'] });
await addDocument('EZF', { title: 'Ezifin FY26 Annual Report (fake)', category: 'report', summary: 'Shared with group shareholders.', shared: true, days: 25, paragraphs: ['Ezifin originated $48 million of loans in this made-up report. Lakeba Group holds 72%.'] });
await addDocument('EZF', { title: 'Ezifin Q1 FY27 update (fake)', category: 'update', summary: 'For Ezifin shareholders only.', days: 9, paragraphs: ['Ezifin launched invoice finance in this made-up update.'] });
await addDocument('EZF', { title: 'Ezifin board papers (fake)', category: 'governance', summary: 'For Ezifin directors only.', audience: 'board', days: 3, paragraphs: ['Made-up Ezifin board pack.'] });
await addDocument('DOX', { title: 'DoxAI investor update (fake)', category: 'update', summary: 'Product and customer update.', days: 15, paragraphs: ['DoxAI signed four pilots in this made-up update.'] });
await addDocument('BRK', { title: 'Bricklet FY26 report (fake)', category: 'report', summary: 'Bricklet results.', days: 30, paragraphs: ['Bricklet listed 12 properties in this made-up report.'] });
await addDocument('SHF', { title: 'Shelfie Series A summary (fake)', category: 'report', summary: 'Preference share terms.', days: 40, paragraphs: ['Shelfie issued 1,000,000 preference shares at $0.90 in this made-up summary.'] });
await svc.from('document_reads').insert([{ document_id: lkbReport, user_id: grace }, { document_id: lkbReport, user_id: marco }]).throwOnError();

const post = (code, slug, title, excerpt, days) => ({ entity_id: E[code].id, slug, title, excerpt, body_md: `${excerpt}\n\nThis is a fake post for testing.`, published_at: ago(days) });
await svc.from('posts').insert([
  post('LKB', 'fake-group-update', 'Group update for testing (fake)', 'A made-up group news item.', 4),
  post('EZF', 'fake-ezifin-invoice-finance', 'Ezifin launches invoice finance (fake)', 'A made-up Ezifin news item.', 9),
  post('DOX', 'fake-doxai-pilots', 'DoxAI signs four pilots (fake)', 'A made-up DoxAI news item.', 12),
]).throwOnError();
await svc.from('announcements').insert([
  { entity_id: E.EZF.id, title: 'Ezifin general meeting on the option plan (fake)', body: 'Notice and proxy form are in the portal.', link_url: '/agm', link_label: 'Details', tone: 'info', starts_at: ago(1) },
  { entity_id: E.SHF.id, title: 'Shelfie secondary window opens soon (fake)', body: 'A made-up announcement.', tone: 'success', starts_at: ago(1) },
]).throwOnError();

const meeting = async (code, title, kind, days, status) => (await svc.from('meetings').insert({
  entity_id: E[code].id, title, kind, starts_at: ahead(days), proxy_deadline: ahead(days - 2), status, location: 'Sydney and online',
}).select('id').single().throwOnError()).data.id;
const egm = await meeting('EZF', 'Ezifin general meeting: option plan (fake)', 'egm', 21, 'open');
const { data: egmRes } = await svc.from('resolutions').insert([
  { meeting_id: egm, number: 1, title: 'Approve the expanded employee option plan', kind: 'ordinary' },
  { meeting_id: egm, number: 2, title: 'Adopt a new constitution', kind: 'special' },
]).select('id').throwOnError();
await svc.from('proxy_votes').insert({ resolution_id: egmRes[0].id, holder_id: marcoH, vote: 'for', lodged_by: marco }).throwOnError();
const lkbAgm = await meeting('LKB', '2026 AGM rehearsal (fake)', 'agm', 35, 'open');
await svc.from('resolutions').insert([
  { meeting_id: lkbAgm, number: 1, title: 'Adopt the remuneration report (fake)', kind: 'ordinary' },
  { meeting_id: lkbAgm, number: 2, title: 'Re-elect a director (fake)', kind: 'ordinary' },
]).throwOnError();
await svc.from('meeting_questions').insert([
  { meeting_id: lkbAgm, user_id: grace, body: 'Will the AGM be recorded for shareholders who cannot attend? (fake)' },
  { meeting_id: egm, user_id: priya, body: 'How many new options will be issued under the plan? (fake)', answer: 'Up to 600,000 options over three years. (fake)', answered_at: ago(1) },
]).throwOnError();

const ask = async (code, userId, subject, question, answer, status) => {
  const { data: q } = await svc.from('queries').insert({ entity_id: E[code].id, user_id: userId, subject, status: status ?? 'open' }).select('id').single().throwOnError();
  await svc.from('query_messages').insert({ query_id: q.id, author_id: userId, body: question }).throwOnError();
  if (answer) await svc.from('query_messages').insert({ query_id: q.id, author_id: adminId, body: answer }).throwOnError();
  return q.id;
};
await ask('LKB', grace, 'Next secondary trading window (fake)', 'When is the next trading window?', 'It is planned for March; eligible shareholders will be notified.', 'answered');
const vest = await ask('EZF', priya, 'Option vesting (fake)', 'When do my employee options vest?', null);
await svc.from('query_messages').insert({ query_id: vest, author_id: adminId, body: 'Internal: check with the Ezifin CFO before replying. (fake)', internal: true }).throwOnError();
await ask('DOX', kenji, 'DoxAI dividend policy (fake)', 'Does DoxAI plan to pay dividends?', 'Not in the next few years; profits are reinvested.', 'closed');

await svc.from('ventures').insert([
  { entity_id: E.EZF.id, slug: 'fake-ezifin', name: 'Ezifin (fake)', tagline: 'Smarter lending for small business', stage: 'Controlled venture', lakeba_stake: 72, status: 'active', sort: 1 },
  { entity_id: E.DOX.id, slug: 'fake-doxai', name: 'DoxAI (fake)', tagline: 'AI document intelligence', stage: 'Controlled venture', lakeba_stake: 65, status: 'building', sort: 2 },
]).throwOnError();

await svc.from('ask_approved_answers').insert({ entity_id: E.EZF.id, question: 'What does Ezifin do? (fake)', answer: 'Ezifin provides small-business lending and invoice finance. (fake)', created_by: adminId, active: true, review_by: '2027-06-30' }).throwOnError();

await svc.from('notifications').insert([
  { user_id: grace, entity_id: E.LKB.id, kind: 'document', title: 'New document: FY26 Shareholder Update (fake)', link: '/documents' },
  { user_id: priya, entity_id: E.EZF.id, kind: 'meeting', title: 'Ezifin general meeting: proxy voting is open (fake)', link: '/agm' },
  { user_id: marco, entity_id: E.EZF.id, kind: 'query', title: 'Your question was answered (fake)', link: '/queries', read_at: ago(1) },
]).throwOnError();

// ---------------------------------------------------------------------------
// Passwords for the personas
// ---------------------------------------------------------------------------
mkdirSync(`${root}../private`, { recursive: true });
writeFileSync(`${root}../private/fake-staging-users.json`, JSON.stringify(personas, null, 2) + '\n', { mode: 0o600 });
console.log(`Fake data added: ${personas.length} sign-in personas, ${fillers.length} more fake people, ${ref} holders. Passwords in private/fake-staging-users.json.`);
