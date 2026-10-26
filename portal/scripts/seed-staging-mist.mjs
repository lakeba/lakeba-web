// Gives MIST (a company Lakeba doesn't control) a full portal on the staging
// database on this Mac, with clearly marked fake data, so the venture
// experience can be tried end to end: its register, documents, news, a
// meeting, Board Q&A, newsletter subscribers, its own press desk and a data
// room. Everything it adds can be found and removed again:
//   people     email ends in @mist.fake.lakeba.test, names end in "(fake)"
//   holders    registry_ref starts with FAKE-M
//   classes    MIST's, code starts with FAKE-
//   content    MIST's, titles end in "(fake)", slugs start with fake-mist-
//
//   node --env-file=.env scripts/seed-staging-mist.mjs           # add (replaces an earlier run)
//   node --env-file=.env scripts/seed-staging-mist.mjs --remove  # take it all out, MIST back to a portfolio entry
//
// Passwords for the sign-in personas go to ../private/fake-mist-users.json.
// Only runs against the local staging stack (port 54321); never production.
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const url = process.env.SUPABASE_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(url)) throw new Error('seed-staging-mist only runs against the local staging stack (port 54321).');
const svc = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const root = new URL('..', import.meta.url).pathname;
const DOMAIN = '@mist.fake.lakeba.test';
const day = 86400_000;
const ago = (d) => new Date(Date.now() - d * day).toISOString();
const ahead = (d) => new Date(Date.now() + d * day).toISOString();
const { data: entities } = await svc.from('entities').select('id, code, display_name');
const E = Object.fromEntries(entities.map((e) => [e.code, e]));
const MIST = E.MIST.id;

// Settings this script gives MIST (and takes away again).
const SETTINGS = {
  portal: 'full', legal_name: 'MIST Technologies Pty Ltd (fake)', company_number: '612 345 678', website: 'https://mist.test', brand_color: '#0d9488', tagline: 'Climate data for property (fake)',
  sender_name: 'MIST Investor Relations', reply_to: 'investors@mist.test', contact_email: 'investors@mist.test', ask_name: 'Ask MIST',
  email_footer: 'MIST Technologies Pty Ltd (fake), Melbourne. You receive this as a MIST shareholder.', document_footer: 'MIST Technologies Pty Ltd (fake) · investors@mist.test',
};

// ---------------------------------------------------------------------------
// Remove everything an earlier run added
// ---------------------------------------------------------------------------
async function remove() {
  const mine = (t, col, pattern) => svc.from(t).delete().eq('entity_id', MIST).like(col, pattern).throwOnError();
  const { data: rooms } = await svc.from('data_rooms').select('id').eq('entity_id', MIST).like('name', '%(fake)');
  for (const r of rooms ?? []) { await svc.from('data_room_documents').delete().eq('room_id', r.id); await svc.from('data_room_guests').delete().eq('room_id', r.id); }
  await mine('data_rooms', 'name', '%(fake)');
  await mine('meetings', 'title', '%(fake)');
  const { data: docs } = await svc.from('documents').select('id, file_path').eq('entity_id', MIST).like('title', '%(fake)');
  if (docs?.length) {
    await svc.storage.from('documents').remove(docs.map((d) => d.file_path));
    await svc.from('documents').delete().in('id', docs.map((d) => d.id)).throwOnError();
  }
  await mine('posts', 'slug', 'fake-mist-%');
  await mine('announcements', 'title', '%(fake)');
  await mine('press_releases', 'headline', '%(fake)');
  await mine('media_contacts', 'last_name', '%(fake)');
  await mine('newsletter_issues', 'subject', '%(fake)');
  await svc.from('newsletter_subscribers').delete().eq('entity_id', MIST).like('email', `%${DOMAIN}`);
  await mine('ask_approved_answers', 'question', '%(fake)');
  await svc.from('portal_settings').delete().eq('key', 'press:MIST');
  await svc.from('holders').delete().like('registry_ref', 'FAKE-M%').throwOnError();
  const { data: classes } = await svc.from('share_classes').select('id').eq('entity_id', MIST).like('code', 'FAKE-%');
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
    await svc.from('queries').delete().eq('user_id', p.id);
    await svc.from('audit_log').delete().eq('user_id', p.id);
    const { error } = await svc.auth.admin.deleteUser(p.id);
    if (error) throw error;
  }
  await svc.from('entities').update({ portal: 'portfolio', ...Object.fromEntries(Object.keys(SETTINGS).filter((k) => k !== 'portal').map((k) => [k, k === 'tagline' ? '' : null])) }).eq('id', MIST).throwOnError();
  console.log(`Removed MIST's fake data (${people?.length ?? 0} people, ${docs?.length ?? 0} documents).`);
}
await remove();
if (process.argv.includes('--remove')) process.exit(0);

// ---------------------------------------------------------------------------
// MIST's portal and register
// ---------------------------------------------------------------------------
await svc.from('entities').update({ ...SETTINGS, slug: 'mist', ask_enabled: true, board_qa_enabled: true }).eq('id', MIST).throwOnError();
const C = {};
for (const [code, name, kind, voting, counts, official] of [
  ['FAKE-ORD', 'Ordinary shares (fake)', 'ordinary', true, true, 12_000_000],
  ['FAKE-PREF', 'Seed preference shares (fake)', 'preference', true, true, 2_000_000],
  ['FAKE-OPT', 'Employee options (fake)', 'options', false, false, 900_000],
]) {
  const { data } = await svc.from('share_classes').insert({ entity_id: MIST, code, name, kind, voting, counts_toward_pct: counts, official_on_issue: official, official_as_at: '2026-06-30' }).select('id').single().throwOnError();
  C[code.slice(5)] = data.id;
}
await svc.from('reference_prices').insert([
  { share_class_id: C.ORD, price: 0.45, priced_on: '2025-09-30', source: 'capital_raise', note: 'Seed round (fake)' },
  { share_class_id: C.ORD, price: 0.62, priced_on: '2026-08-31', source: 'capital_raise', note: 'Seed extension (fake)' },
  { share_class_id: C.PREF, price: 0.62, priced_on: '2026-08-31', source: 'capital_raise', note: 'Seed extension (fake)' },
]).throwOnError();

const personas = [];
async function person(local, first, last, { signIn = false } = {}) {
  const email = `${local}${DOMAIN}`;
  const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { first_name: first, last_name: `${last} (fake)` } });
  if (error) throw error;
  // Marked as signed in before, so admins aren't told about a first sign-in.
  await svc.from('profiles').update({ first_name: first, last_name: `${last} (fake)`, first_signed_in_at: signIn ? new Date().toISOString() : null }).eq('id', data.user.id).throwOnError();
  if (signIn) {
    const password = `Mi${randomBytes(12).toString('base64url')}7q`;
    await svc.auth.admin.updateUserById(data.user.id, { password });
    personas.push({ email, password, who: `${first} ${last}` });
  }
  return data.user.id;
}
let ref = 0;
async function holder(name, kind, extra = {}) {
  const { data } = await svc.from('holders').insert({ name: name.endsWith('(fake)') ? name : `${name} (fake)`, kind, registry_ref: `FAKE-M${String(++ref).padStart(3, '0')}`, ...extra }).select('id').single().throwOnError();
  return data.id;
}
const member = (holderId, userId, access = 'owner') => svc.from('holder_members').insert({ holder_id: holderId, user_id: userId, access }).throwOnError();
const hold = (holderId, cls, shares, asAt = '2026-06-30', extra = {}) => svc.from('holdings').insert({ holder_id: holderId, share_class_id: C[cls], shares, as_at: asAt, ...extra }).throwOnError();

// Sign-in personas: MIST's admin, an investor, a director.
const admin = await person('admin', 'Morgan', 'Mistry', { signIn: true });
await svc.from('user_roles').insert({ user_id: admin, role_key: 'admin', entity_id: MIST, note: 'MIST admin for testing (fake)' }).throwOnError();
const investor = await person('investor', 'Isabel', 'Ng', { signIn: true });
const isabel = await holder('Isabel Ng', 'individual');
await member(isabel, investor);
await hold(isabel, 'ORD', 150_000, '2025-09-30'); await hold(isabel, 'ORD', 210_000); await hold(isabel, 'PREF', 80_000);
const director = await person('director', 'Daniel', 'Okafor', { signIn: true });
await svc.from('entity_board').insert({ entity_id: MIST, user_id: director, position: 'chair', starts_on: '2025-07-01' }).throwOnError();
const dan = await holder('Okafor Family Trust', 'trust');
await member(dan, director);
await hold(dan, 'ORD', 1_800_000); await hold(dan, 'OPT', 300_000, '2026-06-30', { exercise_price: 0.4, expires_on: '2030-06-30' });

// Lakeba's own (non-controlling) stake.
const lakeba = await holder('Lakeba Group Limited', 'company', { represents_entity_id: E.LKB.id });
await hold(lakeba, 'ORD', 2_400_000);
await svc.from('entities').update({ lakeba_stake: 20, stake_as_at: '2026-06-30' }).eq('id', MIST);

// The rest of the register: founders, angels, a fund; about half with a login (never signed in).
let seed = 11;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const names = ['Harper Lane', 'Theo Marsh', 'Zara Quinn', 'Oscar Vale', 'Lena Brooks', 'Felix Rowe', 'Maya Holt', 'Jonah Pike', 'Clara Wynn', 'Arlo Finch', 'Sienna Cole', 'Rafael Moss'];
const fillers = [];
let left = { ORD: 12_000_000 - 210_000 - 1_800_000 - 2_400_000, PREF: 2_000_000 - 80_000, OPT: 900_000 - 300_000 };
for (const [i, n] of names.entries()) {
  const kind = i === 3 ? 'company' : i === 7 ? 'trust' : 'individual';
  const name = kind === 'company' ? `${n.split(' ')[1]} Ventures Pty Ltd` : kind === 'trust' ? `${n.split(' ')[1]} Family Trust` : n;
  const h = await holder(name, kind);
  const cls = i < 8 ? 'ORD' : i < 10 ? 'PREF' : 'OPT';
  const last = (i === 7 && cls === 'ORD') || (i === 9 && cls === 'PREF') || i === 11;
  const share = last ? left[cls] : Math.round((left[cls] / (cls === 'ORD' ? 8 - i : cls === 'PREF' ? 10 - i : 12 - i)) * (0.7 + rand() * 0.6) / 100) * 100;
  left[cls] -= share;
  await hold(h, cls, share, '2026-06-30', cls === 'OPT' ? { exercise_price: 0.4, expires_on: '2030-06-30' } : {});
  if (i % 2 === 0) { const id = await person(n.toLowerCase().replace(' ', '.'), n.split(' ')[0], n.split(' ')[1]); await member(h, id); fillers.push(id); }
}
await svc.from('holding_notes').insert({ holder_id: isabel, share_class_id: C.PREF, note: 'Seed preference shares convert 1:1 to ordinary shares at the next priced round. (fake)' }).throwOnError();

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------
async function pdf(title, paragraphs) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  let y = 780;
  page.drawText('MIST Technologies Pty Ltd', { x: 56, y, size: 10, font, color: rgb(0.05, 0.58, 0.53) }); y -= 24;
  page.drawText(title, { x: 56, y, size: 16, font: bold, color: rgb(0.04, 0.11, 0.22) }); y -= 34;
  for (const para of paragraphs) {
    for (const line of para.match(/.{1,90}(\s|$)/g) ?? [para]) { page.drawText(line.trim(), { x: 56, y, size: 10.5, font }); y -= 15; }
    y -= 10;
  }
  page.drawText('FAKE DOCUMENT FOR TESTING. All names and figures are made up.', { x: 56, y: 40, size: 8, font, color: rgb(0.8, 0.1, 0.1) });
  return doc.save();
}
async function addDocument({ title, category, summary, audience = 'all_investors', days, paragraphs }) {
  const bytes = await pdf(title, paragraphs);
  const path = `entity/${MIST}/${category}/fake-mist-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
  const { error } = await svc.storage.from('documents').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  const { data } = await svc.from('documents').insert({
    entity_id: MIST, title, summary, category, audience, file_path: path, mime_type: 'application/pdf', size_bytes: bytes.length, published_at: ago(days), created_by: admin, in_knowledge_base: false,
  }).select('id').single().throwOnError();
  return data.id;
}
const report = await addDocument({ title: 'MIST FY26 Annual Report (fake)', category: 'report', summary: 'Results for the year to 30 June 2026.', days: 40, paragraphs: ['MIST grew annual recurring revenue to $2.4 million in this made-up report, with 31 enterprise customers.', 'Climate risk scores now cover 9.2 million Australian properties.'] });
const update = await addDocument({ title: 'MIST Q1 FY27 shareholder update (fake)', category: 'update', summary: 'July to September 2026.', days: 10, paragraphs: ['Two new bank customers signed in this made-up quarter.', 'The seed extension closed at $0.62 a share.'] });
await addDocument({ title: 'MIST constitution (fake)', category: 'governance', summary: 'The company’s constitution.', days: 200, paragraphs: ['A made-up constitution for testing.'] });
await addDocument({ title: 'MIST board papers October 2026 (fake)', category: 'governance', summary: 'For directors only.', audience: 'board', days: 3, paragraphs: ['Made-up board pack.'] });

const post = (slug, title, excerpt, days, visibility = 'shareholders', extra = {}) => ({ entity_id: MIST, slug: `fake-mist-${slug}`, title, excerpt, body_html: `<p>${excerpt}</p><p>This is a fake post for testing.</p>`, published_at: ago(days), visibility, venture: visibility === 'public' ? 'MIST' : '', on_lakeba_site: false, on_venture_site: true, ...extra });
await svc.from('posts').insert([
  post('seed-extension', 'Seed extension closed (fake)', 'MIST raised $1.5 million at $0.62 a share from existing and new investors.', 8),
  post('agm-notice', 'Notice of the 2026 AGM (fake)', 'The AGM is on line in four weeks; vote by proxy in the portal.', 2),
  post('bank-customers', 'MIST signs two Australian banks (fake)', 'Two lenders will use MIST climate scores in home-loan decisions.', 14, 'public'),
  post('climate-index', 'MIST launches the Australian Property Climate Index (fake)', 'A free quarterly index of climate risk across 9 million properties.', 30, 'public'),
]).throwOnError();
await svc.from('announcements').insert({ entity_id: MIST, title: 'MIST 2026 AGM: proxy voting is open (fake)', body: 'Vote before the deadline in the portal.', link_url: '/agm', link_label: 'Vote', tone: 'info', starts_at: ago(1) }).throwOnError();

const { data: agm } = await svc.from('meetings').insert({ entity_id: MIST, title: 'MIST 2026 AGM (fake)', kind: 'agm', starts_at: ahead(28), proxy_deadline: ahead(26), status: 'open', location: 'Melbourne and online' }).select('id').single().throwOnError();
await svc.from('resolutions').insert([
  { meeting_id: agm.id, number: 1, title: 'Receive the FY26 financial report', kind: 'ordinary' },
  { meeting_id: agm.id, number: 2, title: 'Re-elect Daniel Okafor as a director', kind: 'ordinary' },
  { meeting_id: agm.id, number: 3, title: 'Approve the employee option plan', kind: 'ordinary' },
]).throwOnError();
await svc.from('meeting_questions').insert({ meeting_id: agm.id, user_id: investor, body: 'Will the AGM be recorded? (fake)' }).throwOnError();

const { data: q1 } = await svc.from('queries').insert({ entity_id: MIST, user_id: investor, subject: 'Next priced round (fake)', status: 'open' }).select('id').single().throwOnError();
await svc.from('query_messages').insert({ query_id: q1.id, author_id: investor, body: 'Is a Series A planned for 2027, and will existing shareholders be able to take part?' }).throwOnError();
const { data: q2 } = await svc.from('queries').insert({ entity_id: MIST, user_id: investor, subject: 'Preference share conversion (fake)', status: 'answered' }).select('id').single().throwOnError();
await svc.from('query_messages').insert([
  { query_id: q2.id, author_id: investor, body: 'When do the seed preference shares convert?' },
  { query_id: q2.id, author_id: admin, body: 'They convert 1:1 to ordinary shares at the next priced round.' },
]).throwOnError();
await svc.from('ask_approved_answers').insert({ entity_id: MIST, question: 'What does MIST do? (fake)', answer: 'MIST scores Australian properties for climate risk (flood, bushfire, heat) for banks and insurers. (fake)', created_by: admin, active: true, review_by: ahead(180).slice(0, 10) }).throwOnError();

// MIST's own newsletter list and press desk.
await svc.from('newsletter_subscribers').insert(['ella.rivers', 'tom.hale', 'nadia.shah'].map((local) => ({ email: `${local}${DOMAIN}`, name: `${local.split('.').map((x) => x[0].toUpperCase() + x.slice(1)).join(' ')} (fake)`, status: 'subscribed', source: 'website', confirmed_at: ago(20), entity_id: MIST }))).throwOnError();
await svc.from('portal_settings').insert({ key: 'press:MIST', value: { boilerplate_html: '<p>MIST Technologies scores Australian properties for climate risk for banks, insurers and property owners. (fake)</p>', about_title: 'About MIST', contact_name: 'MIST Media Relations', contact_email: 'press@mist.test', dateline_city: 'MELBOURNE', monitor_terms: ['MIST Technologies'] } }).throwOnError();
await svc.from('media_contacts').insert([
  ['Priya', 'Lal', 'Climate reporter', ['climate', 'property']],
  ['Ben', 'Cho', 'Fintech editor', ['fintech', 'banking']],
  ['Rosa', 'Kent', 'Property writer', ['property', 'housing']],
].map(([first, last, title, beats]) => ({ first_name: first, last_name: `${last} (fake)`, email: `${first.toLowerCase()}.${last.toLowerCase()}${DOMAIN}`, role: 'journalist', title, beats, regions: ['national'], source: 'manual', consent_basis: 'published_work_address', status: 'active', entity_id: MIST, created_by: admin }))).throwOnError();
await svc.from('press_releases').insert({ entity_id: MIST, status: 'draft', headline: 'MIST launches the Australian Property Climate Index (fake)', head_points: '- What: a free quarterly climate-risk index\n- Who: MIST\n- Why: lenders and buyers need comparable data', dateline_city: 'MELBOURNE', body_html: '<p>MIST today launched a free quarterly index of climate risk across nine million Australian properties. (fake)</p>', created_by: admin, updated_by: admin }).throwOnError();

// A data room for prospective investors.
const { data: room } = await svc.from('data_rooms').insert({ entity_id: MIST, name: 'Series A data room (fake)', description: 'For prospective Series A investors.', nda_text: 'By opening this data room you agree to keep its contents confidential. (fake)', created_by: admin }).select('id').single().throwOnError();
await svc.from('data_room_documents').insert([{ room_id: room.id, document_id: report, sort: 1 }, { room_id: room.id, document_id: update, sort: 2 }]).throwOnError();

// ---------------------------------------------------------------------------
// Passwords for the personas
// ---------------------------------------------------------------------------
mkdirSync(`${root}../private`, { recursive: true });
writeFileSync(`${root}../private/fake-mist-users.json`, JSON.stringify(personas, null, 2) + '\n', { mode: 0o600 });
console.log(`MIST fake data added: ${personas.length} sign-in personas, ${fillers.length} more fake people, ${ref} holders. Passwords in private/fake-mist-users.json.`);
