// Fills the demo stack with fictional investors for every company, the way
// real data will arrive: it writes a filled-in investor data workbook
// (demo-data/demo-investors.xlsx), imports it with import-investors.mjs, then
// adds documents, news, meetings, questions and Ask answers per company and
// sets passwords for the demo personas (saved to .demo-users.json).
//
//   npm run demo:db        # start the demo Supabase (ports 553xx)
//   npm run seed:demo      # uses .env.demo; refuses anything but the demo stack
//   npm run dev:demo       # portal on http://localhost:4324
//
// Every name, holding and figure here is made up.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

const url = process.env.SUPABASE_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):553\d\d$/.test(url)) throw new Error('seed-demo only runs against the demo stack (port 553xx). Use npm run seed:demo.');
const svc = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const root = new URL('..', import.meta.url).pathname;
const out = `${root}demo-data`;
mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------------------
// 1. Fictional register, as workbook rows
// ---------------------------------------------------------------------------
let seed = 42;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const firstNames = ['Olivia', 'Liam', 'Mia', 'Noah', 'Ava', 'Ethan', 'Isla', 'Lucas', 'Chloe', 'Leo', 'Grace', 'Henry', 'Zoe', 'Oscar', 'Ruby', 'Jack', 'Ella', 'Max', 'Ivy', 'Sam', 'Priya', 'Arjun', 'Mei', 'Kenji', 'Sofia', 'Marco', 'Aisha', 'Tom', 'Nina', 'Ravi'];
const lastNames = ['Archer', 'Bennett', 'Calloway', 'Dunmore', 'Ellison', 'Fairbank', 'Galloway', 'Hartley', 'Iverson', 'Jarvis', 'Kingsley', 'Langford', 'Marsden', 'Northcott', 'Oakley', 'Pemberton', 'Quinlan', 'Radcliffe', 'Stanton', 'Thornbury'];

const companies = [
  ['LKB', 'Lakeba Group Limited', 'Lakeba Group', '000 000 001', 'Australia', 'Group', 'Full portal', null, null, 'https://lakeba.com', '', 'Demo data'],
  ['EZF', 'Ezifin Pty Ltd (demo)', 'Ezifin', '000 000 002', 'Australia', 'Controlled venture', 'Full portal', 0.72, '2026-06-30', 'https://ezifin.example', '', ''],
  ['DOX', 'DoxAI Pty Ltd (demo)', 'DoxAI', '000 000 003', 'Australia', 'Controlled venture', 'Full portal', 0.65, '2026-06-30', 'https://doxai.example', '', ''],
  ['BRK', 'Bricklet Pty Ltd (demo)', 'Bricklet', '000 000 004', 'Australia', 'Controlled venture', 'Full portal', 0.8, '2026-06-30', 'https://bricklet.example', '', ''],
  ['SHF', 'Shelfie Pty Ltd (demo)', 'Shelfie', '000 000 005', 'Australia', 'Controlled venture', 'Full portal', 0.58, '2026-06-30', 'https://shelfie.example', '', ''],
  ['WHK', 'Whitehawk (demo)', 'Whitehawk', '', 'Australia', 'Non-controlling investment', 'Portfolio entry only', 0.2, '2026-06-30', '', '', ''],
  ['MIST', 'MIST (demo)', 'MIST', '', 'Australia', 'Non-controlling investment', 'Portfolio entry only', 0.15, '2026-06-30', '', '', ''],
  ['AST', 'Assetora (demo)', 'Assetora', '', 'Australia', 'Non-controlling investment', 'Portfolio entry only', 0.25, '2026-06-30', '', '', ''],
  ['APR', 'Appreci (demo)', 'Appreci', '', 'Australia', 'Non-controlling investment', 'Portfolio entry only', 0.1, '2026-06-30', '', '', ''],
  ['ZUC', 'Zucoins (demo)', 'Zucoins', '', 'Australia', 'Non-controlling investment', 'Portfolio entry only', 0.3, '2026-06-30', '', '', ''],
  ['EZP', 'EziProp (demo)', 'EziProp', '', 'Australia', 'Non-controlling investment', 'Portfolio entry only', 0.12, '2026-06-30', '', '', ''],
];
// [company, class, name, type, voting, counts, official on issue]
const classes = [
  ['LKB', 'LKB-ORD', 'Ordinary shares', 'Ordinary', 'Yes', 'Yes', 20_000_000],
  ['LKB', 'LKB-F', 'F class shares (non-voting)', 'Ordinary (non-voting)', 'No', 'Yes', 1_500_000],
  ['EZF', 'EZF-ORD', 'Ordinary shares', 'Ordinary', 'Yes', 'Yes', 10_000_000],
  ['EZF', 'EZF-OPT', 'Employee options', 'Options', 'No', 'No', 600_000],
  ['DOX', 'DOX-ORD', 'Ordinary shares', 'Ordinary', 'Yes', 'Yes', 5_000_000],
  ['BRK', 'BRK-ORD', 'Ordinary shares', 'Ordinary', 'Yes', 'Yes', 8_000_000],
  ['SHF', 'SHF-ORD', 'Ordinary shares', 'Ordinary', 'Yes', 'Yes', 4_000_000],
  ['SHF', 'SHF-PREF', 'Series A preference shares', 'Preference', 'Yes', 'Yes', 1_000_000],
];
const stake = Object.fromEntries(companies.map((c) => [c[0], c[7]]));

// Personas who can sign in (passwords are set at the end).
const personas = [
  { key: 'admin', email: 'admin@demo.test', first: 'Ada', last: 'Admin', role: 'Admin' },
  { key: 'group', email: 'group.only@demo.test', first: 'Grace', last: 'Galloway', role: 'Investor' },
  { key: 'both', email: 'group.ezifin@demo.test', first: 'Marco', last: 'Bennett', role: 'Investor' },
  { key: 'ezifin', email: 'ezifin.only@demo.test', first: 'Priya', last: 'Iverson', role: 'Investor' },
  { key: 'multi', email: 'doxai.bricklet@demo.test', first: 'Kenji', last: 'Hartley', role: 'Investor' },
  { key: 'shelfie', email: 'shelfie.only@demo.test', first: 'Sofia', last: 'Stanton', role: 'Investor' },
  { key: 'director', email: 'director.ezifin@demo.test', first: 'Dana', last: 'Director', role: 'Investor' },
  { key: 'coadmin', email: 'admin.ezifin@demo.test', first: 'Felix', last: 'Fairbank', role: 'Investor' },
  { key: 'board', email: 'board.lakeba@demo.test', first: 'Bea', last: 'Board', role: 'Board' },
  { key: 'viewer', email: 'accountant@demo.test', first: 'Avery', last: 'Accountant', role: 'Investor' },
];

const holders = [['LKB-GROUP', 'Lakeba Group Limited', 'Company', '', 'Holds Lakeba’s shares in each venture']];
const people = personas.map((p) => [p.email, p.first, p.last, '', p.role, 'Yes', 'Demo persona']);
const access = [];
const holdings = [];
const boards = [
  ['LKB', 'board.lakeba@demo.test', 'Chair', '2023-07-01', null, ''],
  ['EZF', 'director.ezifin@demo.test', 'Director', '2024-01-15', null, ''],
  ['EZF', 'admin.ezifin@demo.test', 'Company admin', null, null, 'Ezifin CFO'],
];
let hid = 0;
const holder = (name, kind) => { const id = `D-${String(++hid).padStart(4, '0')}`; holders.push([id, name, kind, '', '']); return id; };
const hold = (id, cls, shares, asAt = '2026-06-30') => holdings.push([id, cls, shares, asAt, '', 'Share register', '']);

// Persona holdings
const grace = holder('Grace Galloway', 'Individual');
const graceSuper = holder('Galloway Super Pty Ltd ATF Galloway Super Fund', 'Super fund');
access.push(['group.only@demo.test', grace, 'Owner', ''], ['group.only@demo.test', graceSuper, 'Owner', '']);
hold(grace, 'LKB-ORD', 120_000, '2024-06-30'); hold(grace, 'LKB-ORD', 150_000); hold(graceSuper, 'LKB-ORD', 80_000); hold(graceSuper, 'LKB-F', 25_000);
const marco = holder('Bennett Family Trust', 'Trust');
access.push(['group.ezifin@demo.test', marco, 'Owner', ''], ['accountant@demo.test', marco, 'Viewer', 'Family accountant']);
hold(marco, 'LKB-ORD', 400_000); hold(marco, 'EZF-ORD', 250_000);
const priya = holder('Priya Iverson', 'Individual');
access.push(['ezifin.only@demo.test', priya, 'Owner', '']);
hold(priya, 'EZF-ORD', 180_000); hold(priya, 'EZF-OPT', 60_000);
const kenji = holder('Hartley Ventures Pty Ltd', 'Company');
access.push(['doxai.bricklet@demo.test', kenji, 'Owner', '']);
hold(kenji, 'DOX-ORD', 300_000); hold(kenji, 'BRK-ORD', 450_000);
const sofia = holder('Sofia Stanton', 'Individual');
access.push(['shelfie.only@demo.test', sofia, 'Owner', '']);
hold(sofia, 'SHF-PREF', 200_000); hold(sofia, 'SHF-ORD', 50_000);

// Lakeba's own stakes (counts-toward-% classes), then the rest of each register
// spread over fictional holders so totals match the official numbers.
const remaining = Object.fromEntries(classes.map((c) => [c[1], c[6]]));
for (const h of holdings) if (h[3] === '2026-06-30') remaining[h[1]] -= h[2]; // latest rows only
for (const [code, cls] of [['EZF', 'EZF-ORD'], ['DOX', 'DOX-ORD'], ['BRK', 'BRK-ORD'], ['SHF', 'SHF-ORD']]) {
  const counted = classes.filter((c) => c[0] === code && c[5] === 'Yes').reduce((a, c) => a + c[6], 0);
  const shares = Math.round(counted * stake[code]);
  hold('LKB-GROUP', cls, shares); remaining[cls] -= shares;
}
let n = 0;
for (const [cls, , count] of [['LKB-ORD', 0, 28], ['LKB-F', 0, 6], ['EZF-ORD', 0, 6], ['EZF-OPT', 0, 3], ['DOX-ORD', 0, 5], ['BRK-ORD', 0, 4], ['SHF-ORD', 0, 4], ['SHF-PREF', 0, 3]]) {
  const weights = Array.from({ length: count }, () => 0.3 + rand());
  const total = weights.reduce((a, b) => a + b, 0);
  let left = remaining[cls];
  weights.forEach((w, i) => {
    const shares = i === count - 1 ? left : Math.floor((remaining[cls] * w) / total / 100) * 100;
    left -= shares;
    const first = firstNames[n % firstNames.length]; const last = lastNames[(n * 7) % lastNames.length]; n++;
    const kind = n % 5 === 0 ? 'Company' : n % 7 === 0 ? 'Trust' : 'Individual';
    const name = kind === 'Company' ? `${last} Holdings Pty Ltd` : kind === 'Trust' ? `${last} Family Trust` : `${first} ${last}`;
    const id = holder(name, kind);
    hold(id, cls, shares);
    // About two thirds have a login.
    if (n % 3 !== 0) {
      const email = `${first}.${last}.${n}@demo.test`.toLowerCase();
      people.push([email, first, last, '', 'Investor', n % 4 === 0 ? 'No' : 'Yes', '']);
      access.push([email, id, 'Owner', '']);
    }
  });
}

const prices = [
  ['LKB-ORD', 4.2, 'AUD', '2024-03-31', 'Capital raise', 'Series C'],
  ['LKB-ORD', 4.75, 'AUD', '2025-06-30', 'Directors’ valuation', ''],
  ['LKB-F', 4.75, 'AUD', '2025-06-30', 'Directors’ valuation', ''],
  ['EZF-ORD', 1.2, 'AUD', '2026-03-31', 'Capital raise', 'Seed extension'],
  ['DOX-ORD', 0.85, 'AUD', '2026-02-28', 'Capital raise', 'Pre-seed'],
  ['BRK-ORD', 2.1, 'AUD', '2025-12-31', 'Directors’ valuation', ''],
  ['SHF-ORD', 0.6, 'AUD', '2026-05-31', 'Secondary trade', ''],
  ['SHF-PREF', 0.9, 'AUD', '2026-01-31', 'Capital raise', 'Series A'],
];

const rows = {
  Companies: companies,
  'Share classes': classes.map(([co, cls, name, type, voting, counts, official]) => [co, cls, name, type, voting, counts, official, '2026-06-30', 'AUD', '']),
  Holders: holders, People: people, Access: access, Holdings: holdings, Boards: boards, Prices: prices,
};
writeFileSync(`${out}/rows.json`, JSON.stringify(rows, null, 1));
execFileSync('python3', [`${root}scripts/build-investor-workbook.py`, `${out}/demo-investors.xlsx`, 'rows', `${out}/rows.json`], { stdio: 'inherit' });

// ---------------------------------------------------------------------------
// 2. Import it, exactly as the real file will be imported
// ---------------------------------------------------------------------------
execFileSync('node', [`${root}scripts/import-investors.mjs`, `${out}/demo-investors.xlsx`, '--apply'], { stdio: 'inherit', env: process.env });

// ---------------------------------------------------------------------------
// 3. Content per company
// ---------------------------------------------------------------------------
const { data: entities } = await svc.from('entities').select('id, code, display_name');
const E = Object.fromEntries(entities.map((e) => [e.code, e]));
const profileId = async (email) => (await svc.from('profiles').select('id').eq('email', email).single().throwOnError()).data.id;
const adminId = await profileId('admin@demo.test');
await svc.from('profiles').update({ role: 'admin' }).eq('id', adminId).throwOnError();

await svc.from('entities').update({ brand_color: '#2563EB', tagline: 'Venture studio and LakebaOS' }).eq('code', 'LKB');
await svc.from('entities').update({ brand_color: '#0EA5A4', tagline: 'Smarter lending for small business' }).eq('code', 'EZF');
await svc.from('entities').update({ brand_color: '#7C3AED', tagline: 'AI document intelligence' }).eq('code', 'DOX');
await svc.from('entities').update({ brand_color: '#EA580C', tagline: 'Fractional property, brick by brick' }).eq('code', 'BRK');
await svc.from('entities').update({ brand_color: '#DB2777', tagline: 'Retail shelf analytics' }).eq('code', 'SHF');

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
  page.drawText('Demo document. All names and figures are fictional.', { x: 56, y: 40, size: 8, font, color: rgb(0.45, 0.5, 0.56) });
  return doc.save();
}

async function addDocument(code, { title, category, summary, audience = 'all_investors', days, paragraphs, shared = false }) {
  const e = E[code];
  const bytes = await pdf(title, paragraphs, e.display_name);
  const path = `entity/${e.id}/${category}/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
  await svc.storage.from('documents').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
  const { data: row } = await svc.from('documents').insert({
    entity_id: e.id, title, summary, category, audience, shared_with_group: shared, file_path: path, mime_type: 'application/pdf', size_bytes: bytes.length,
    published_at: new Date(Date.now() - days * 86400_000).toISOString(), created_by: adminId, in_knowledge_base: category !== 'register',
  }).select('id').single().throwOnError();
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false });
  const chunks = text.map((t, i) => ({ document_id: row.id, chunk_index: i, page: i + 1, content: t.replace(/\s+/g, ' ').trim() })).filter((c) => c.content.length > 20);
  if (chunks.length) await svc.from('document_chunks').insert(chunks).throwOnError();
  return row.id;
}

const { count: existingDocs } = await svc.from('documents').select('id', { count: 'exact', head: true });
if (!existingDocs) {
  await addDocument('LKB', { title: 'FY26 Annual Report (demo)', category: 'report', summary: 'Group results for the year to 30 June 2026.', days: 20, paragraphs: [
    'Group revenue for FY26 was $21.6 million, up 18%. LakebaOS co-founded three new ventures. Lakeba holds controlling stakes in Ezifin, DoxAI, Bricklet and Shelfie.',
    'Net tangible assets per share were $3.10. The directors’ valuation of ordinary shares at 30 June 2025 was $4.75.'] });
  await addDocument('LKB', { title: 'Notice of 2026 AGM (demo)', category: 'agm', summary: 'Resolutions and proxy voting.', days: 5, paragraphs: [
    'The 2026 AGM of Lakeba Group Limited will be held in Sydney and online. Lodge proxies in the portal until two days before the meeting.',
    'Resolution 1: adopt the remuneration report. Resolution 2: re-elect a director. Resolution 3 (special): renew the share buy-back facility.'] });
  await addDocument('LKB', { title: 'Board papers: October 2026 (demo)', category: 'governance', summary: 'For directors only.', audience: 'board', days: 2, paragraphs: ['Board pack for the October meeting of Lakeba Group Limited.'] });
  await addDocument('LKB', { title: 'Member register (demo)', category: 'register', summary: 'Register of members.', audience: 'board', days: 30, paragraphs: ['Register of members (demo).'] });
  await addDocument('EZF', { title: 'Ezifin FY26 Annual Report (demo)', category: 'report', summary: 'Ezifin’s results for FY26.', days: 25, shared: true, paragraphs: [
    'Ezifin originated $48 million of small-business loans in FY26 with arrears under 1.5%. Revenue was $5.2 million.',
    'Ezifin raised a seed extension at $1.20 per share in March 2026. Lakeba Group holds 72% of Ezifin.'] });
  await addDocument('EZF', { title: 'Ezifin shareholder update: Q1 FY27 (demo)', category: 'update', summary: 'Quarterly update for Ezifin shareholders.', days: 10, paragraphs: [
    'Ezifin launched invoice finance with two accounting platforms. The employee option plan was expanded to 600,000 options.'] });
  await addDocument('EZF', { title: 'Ezifin board papers (demo)', category: 'governance', summary: 'For Ezifin directors only.', audience: 'board', days: 3, paragraphs: ['Ezifin board pack.'] });
  await addDocument('DOX', { title: 'DoxAI investor update (demo)', category: 'update', summary: 'Product and customer update.', days: 15, paragraphs: ['DoxAI signed four enterprise pilots for AI contract review. Pre-seed round closed at $0.85 per share.'] });
  await addDocument('BRK', { title: 'Bricklet FY26 Annual Report (demo)', category: 'report', summary: 'Bricklet results.', days: 30, paragraphs: ['Bricklet listed 12 fractional properties with $9 million of investor commitments.'] });
  await addDocument('SHF', { title: 'Shelfie Series A summary (demo)', category: 'report', summary: 'Terms of the Series A preference shares.', days: 40, paragraphs: ['Shelfie issued 1,000,000 Series A preference shares at $0.90. Preference shares carry a 1x non-participating liquidation preference.'] });

  const post = (code, slug, title, excerpt, days) => svc.from('posts').insert({ entity_id: E[code].id, slug, title, excerpt, body_md: `${excerpt}\n\nDemo post.`, published_at: new Date(Date.now() - days * 86400_000).toISOString() }).throwOnError();
  await post('LKB', 'demo-group-results', 'FY26 results: a record year', 'Group results for FY26 are now in the Documents area.', 18);
  await post('EZF', 'demo-ezifin-invoice-finance', 'Ezifin launches invoice finance', 'A new product for Ezifin’s small-business customers.', 9);
  await post('DOX', 'demo-doxai-pilots', 'DoxAI signs four enterprise pilots', 'An update for DoxAI shareholders.', 12);
  await svc.from('announcements').insert([
    { entity_id: E.LKB.id, title: '2026 AGM: proxy voting is open', body: 'Lodge your proxy before the deadline.', link_url: '/agm', link_label: 'Vote now', tone: 'info', starts_at: new Date().toISOString(), ends_at: null },
    { entity_id: E.EZF.id, title: 'Ezifin: general meeting on the option plan', body: 'Notice and proxy form are available.', link_url: '/agm', link_label: 'Details', tone: 'info', starts_at: new Date().toISOString(), ends_at: null },
  ]).throwOnError();

  const meeting = async (code, title, kind, days) => (await svc.from('meetings').insert({
    entity_id: E[code].id, title, kind, starts_at: new Date(Date.now() + days * 86400_000).toISOString(),
    proxy_deadline: new Date(Date.now() + (days - 2) * 86400_000).toISOString(), status: 'open', location: 'Sydney and online',
  }).select('id').single().throwOnError()).data.id;
  const agm = await meeting('LKB', '2026 Annual General Meeting (demo)', 'agm', 30);
  await svc.from('resolutions').insert([
    { meeting_id: agm, number: 1, title: 'Adopt the remuneration report', kind: 'ordinary' },
    { meeting_id: agm, number: 2, title: 'Re-elect a director', kind: 'ordinary' },
    { meeting_id: agm, number: 3, title: 'Renew the share buy-back facility', kind: 'special' },
  ]).throwOnError();
  const egm = await meeting('EZF', 'Ezifin general meeting: option plan (demo)', 'egm', 21);
  await svc.from('resolutions').insert({ meeting_id: egm, number: 1, title: 'Approve the expanded employee option plan' }).throwOnError();

  const ask = async (code, email, subject, question, answer) => {
    const user = await profileId(email);
    const { data: q } = await svc.from('queries').insert({ entity_id: E[code].id, user_id: user, subject }).select('id').single().throwOnError();
    await svc.from('query_messages').insert({ query_id: q.id, author_id: user, body: question }).throwOnError();
    if (answer) {
      await svc.from('query_messages').insert({ query_id: q.id, author_id: adminId, body: answer }).throwOnError();
      await svc.from('queries').update({ status: 'answered' }).eq('id', q.id);
    }
  };
  await ask('LKB', 'group.only@demo.test', 'Next secondary trading window', 'When is the next trading window?', 'It is planned for March; eligible shareholders will be notified.');
  await ask('EZF', 'ezifin.only@demo.test', 'Option vesting', 'When do the employee options vest?', null);

  await svc.from('ask_approved_answers').insert([
    { entity_id: E.LKB.id, question: 'When is the AGM?', answer: 'The 2026 AGM is in about a month, in Sydney and online. Proxy voting is open in the portal.', created_by: adminId, active: true, review_by: '2027-06-30' },
    { entity_id: E.EZF.id, question: 'What does Ezifin do?', answer: 'Ezifin provides small-business lending and, from this quarter, invoice finance.', created_by: adminId, active: true, review_by: '2027-06-30' },
  ]).throwOnError();

  // The group's portfolio view: one card per company, linked to its entity.
  for (const [i, code] of ['EZF', 'DOX', 'BRK', 'SHF', 'WHK', 'MIST', 'AST', 'APR', 'ZUC', 'EZP'].entries()) {
    const e = E[code];
    const { data: v } = await svc.from('ventures').insert({
      entity_id: e.id, slug: code.toLowerCase(), name: e.display_name, tagline: `${e.display_name} (demo)`, stage: i < 4 ? 'Controlled venture' : 'Minority investment',
      lakeba_stake: Math.round(stake[code] * 100), status: 'active', sort: i,
    }).select('id').single().throwOnError();
    if (i < 2) await svc.from('venture_updates').insert({ venture_id: v.id, title: `${e.display_name} quarterly update`, body: 'See the latest results.', happened_on: '2026-09-30' });
  }
  await svc.from('portal_settings').upsert({ key: 'liquidity', value: { title: 'Secondary trading', body: 'Buy or sell Lakeba shares in trading windows.', url: 'https://example.com/trading', label: 'Learn more' } });
}

// ---------------------------------------------------------------------------
// 4. Passwords for the personas
// ---------------------------------------------------------------------------
const saved = [];
for (const p of personas) {
  const password = `Dm${randomBytes(12).toString('base64url')}9a`;
  const id = await profileId(p.email);
  await svc.auth.admin.updateUserById(id, { password, email_confirm: true });
  saved.push({ email: p.email, password, who: p.key });
}
writeFileSync(`${root}.demo-users.json`, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 });
console.log(`\nDemo ready: ${saved.length} personas → portal/.demo-users.json (admin needs two-step setup on first sign-in).`);
