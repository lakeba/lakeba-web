// Creates local test accounts and links them to the fictional holders in
// supabase/seed.sql. Local development only: refuses to run against a
// non-local Supabase. Passwords are generated and saved to .dev-users.json.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

const url = process.env.SUPABASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url ?? '')) throw new Error('seed-dev only runs against local Supabase');
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const users = [
  { email: 'admin@lakeba.test', first_name: 'Ada', last_name: 'Admin', role: 'admin', holders: [] },
  { email: 'investor.one@lakeba.test', first_name: 'Jordan', last_name: 'Investor', role: 'investor', holders: ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2'] },
  { email: 'investor.two@lakeba.test', first_name: 'Sam', last_name: 'Holder', role: 'investor', holders: ['00000000-0000-4000-8000-0000000000a3'] },
  { email: 'director@lakeba.test', first_name: 'Dana', last_name: 'Director', role: 'board', holders: [] },
];

// Meets the portal rules: 12+ characters, upper, lower and a digit.
const newPassword = () => `Lk${randomBytes(12).toString('base64url')}9a`;

const { data: existing } = await admin.auth.admin.listUsers();
const saved = [];
for (const u of users) {
  const password = newPassword();
  const found = existing.users.find((x) => x.email === u.email);
  const { data, error } = found
    ? await admin.auth.admin.updateUserById(found.id, { password })
    : await admin.auth.admin.createUser({ email: u.email, password, email_confirm: true, user_metadata: { first_name: u.first_name, last_name: u.last_name } });
  if (error) throw error;
  const id = data.user.id;
  await admin.from('profiles').update({ role: u.role, first_name: u.first_name, last_name: u.last_name }).eq('id', id).throwOnError();
  for (const holder_id of u.holders) {
    await admin.from('holder_members').upsert({ holder_id, user_id: id, access: 'owner' }).throwOnError();
  }
  saved.push({ email: u.email, password, role: u.role });
}
await seedDocuments(saved);
writeFileSync(new URL('../.dev-users.json', import.meta.url), JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 });
console.log(`Seeded ${saved.length} local test accounts → portal/.dev-users.json`);

// ---------------------------------------------------------------------------
// Sample documents: generated PDFs (fictional), uploaded to private storage and
// indexed for Ask Lakeba. Skipped if documents already exist.
// ---------------------------------------------------------------------------
async function samplePdf(title, pages) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const [i, paragraphs] of pages.entries()) {
    const page = pdf.addPage([595.28, 841.89]);
    let y = 780;
    page.drawText(i === 0 ? title : `${title} (continued)`, { x: 56, y, size: 16, font: bold, color: rgb(0.04, 0.11, 0.22) });
    y -= 36;
    for (const para of paragraphs) {
      // Naive word wrap at ~90 characters.
      const lines = para.match(/.{1,90}(\s|$)/g) ?? [para];
      for (const line of lines) { page.drawText(line.trim(), { x: 56, y, size: 10.5, font }); y -= 15; }
      y -= 10;
    }
    page.drawText('Sample document for local development. All figures are fictional.', { x: 56, y: 40, size: 8, font, color: rgb(0.45, 0.5, 0.56) });
  }
  return pdf.save();
}

async function seedDocuments(saved) {
  const { count } = await admin.from('documents').select('id', { count: 'exact', head: true });
  if (count) return;
  const adminId = (await admin.from('profiles').select('id').eq('email', 'admin@lakeba.test').single()).data.id;
  const docs = [
    { title: 'FY26 Annual Report (audited)', category: 'report', summary: 'Audited financial statements and directors’ report for the year to 30 June 2026.', days: 2, pages: [
      ['Chair’s letter. FY26 was the year Lakeba turned its venture studio into an operating system. LakebaOS lets founders describe an idea and have an AI team build a working MVP, after which Lakeba may co-found the company.',
       'Group revenue for FY26 was $18.4 million, up 22% on FY25, driven by growth at Northwind AI and Brightlane. Operating loss narrowed to $2.1 million.'],
      ['Outlook. The directors expect to co-found up to six ventures through LakebaOS in FY27, taking up to 49% of each, with founders holding 51% and receiving 12 months of funded salary.',
       'Capital. The company raised $6 million in a Series C round at $0.55 per share in March 2025. Total ordinary shares on issue at 30 June 2026 were 10,000,000 in this sample.'],
    ] },
    { title: 'Notice of 2026 Annual General Meeting', category: 'agm', summary: 'Meeting details, resolutions and how to lodge a proxy.', days: 1, pages: [
      ['The 2026 Annual General Meeting will be held in Sydney and online. Shareholders may lodge proxies through the investor portal until two days before the meeting.',
       'Resolution 1: adopt the remuneration report (advisory). Resolution 2: re-elect a non-executive director retiring by rotation. Resolution 3 (special): approve the LakebaOS co-founding program allowing the company to take up to 49% in ventures founded through LakebaOS.'],
    ] },
    { title: 'Half-year shareholder update', category: 'update', summary: 'Highlights from the first half of FY26.', days: 120, pages: [
      ['Half-year highlights: Northwind AI signed a partnership with a major bank; Brightlane launched shared-equity products with a lender; Kestrel Labs was the first venture built end to end with LakebaOS.',
       'Secondary trading windows will continue through a private marketplace for eligible investors.'],
    ] },
    { title: 'Company constitution', category: 'governance', summary: 'The constitution of Lakeba Group Limited.', days: 900, pages: [
      ['This constitution governs the company. Shareholders may appoint a proxy to attend and vote at general meetings. Special resolutions require 75% of votes cast.'],
    ] },
  ];
  for (const d of docs) {
    const bytes = await samplePdf(d.title, d.pages);
    const path = `${d.category}/sample/${d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
    const { error: upErr } = await admin.storage.from('documents').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) throw upErr;
    const { data: row } = await admin.from('documents').insert({
      title: d.title, summary: d.summary, category: d.category, file_path: path, mime_type: 'application/pdf', size_bytes: bytes.length,
      published_at: new Date(Date.now() - d.days * 86400_000).toISOString(), created_by: adminId,
    }).select('id').single().throwOnError();
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false });
    const chunks = text.map((t, i) => ({ document_id: row.id, chunk_index: i, page: i + 1, content: t.replace(/\s+/g, ' ').trim() })).filter((c) => c.content.length > 20);
    if (chunks.length) await admin.from('document_chunks').insert(chunks).throwOnError();
    if (d.category === 'agm') await admin.from('meetings').update({ notice_document_id: row.id }).eq('id', '00000000-0000-4000-8000-0000000000b1');
  }

  // A sample answered Board Q&A thread and a notification for investor one.
  const one = (await admin.from('profiles').select('id').eq('email', 'investor.one@lakeba.test').single()).data.id;
  const { data: q } = await admin.from('queries').insert({ user_id: one, subject: 'Timing of the next trading window' }).select('id').single().throwOnError();
  await admin.from('query_messages').insert({ query_id: q.id, author_id: one, body: 'When is the next secondary trading window expected to open?' }).throwOnError();
  await admin.from('query_messages').insert({ query_id: q.id, author_id: adminId, body: 'Thanks for your question. The next window is planned for March; eligible investors will be notified in the portal.' }).throwOnError();
  await admin.from('queries').update({ status: 'answered' }).eq('id', q.id);
  await admin.from('notifications').insert({ user_id: one, kind: 'document', title: 'New document: FY26 Annual Report (audited)', body: 'The audited FY26 annual report is now available.', link: '/documents' });
}
