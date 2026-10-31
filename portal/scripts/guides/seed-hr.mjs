// Staff guides (docs/guides/README.md): Sample Co on staging for the HR guide's screenshots. --remove takes it all out again.
// Everything is marked: entity code SMPL, names end in "(sample)", emails end in @sample.example.invalid.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const url = process.env.SUPABASE_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(url)) throw new Error('local staging only');
const svc = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const DOMAIN = '@sample.example.invalid';
const HERE = new URL('.', import.meta.url).pathname;
const day = 86400_000;
const d = (n) => new Date(Date.now() + n * day).toISOString().slice(0, 10);
const ts = (n) => new Date(Date.now() + n * day).toISOString();

async function remove() {
  const { data: e } = await svc.from('entities').select('id').eq('code', 'SMPL').maybeSingle();
  if (e) {
    const { data: files } = await svc.storage.from('legal').list(`${e.id}/hr/people`, { limit: 100 });
    for (const f of files ?? []) {
      const { data: inner } = await svc.storage.from('legal').list(`${e.id}/hr/people/${f.name}`, { limit: 100 });
      if (inner?.length) await svc.storage.from('legal').remove(inner.map((x) => `${e.id}/hr/people/${f.name}/${x.name}`));
    }
    const { data: people } = await svc.from('people').select('id').eq('entity_id', e.id);
    const ids = (people ?? []).map((p) => p.id);
    if (ids.length) await svc.from('policy_acks').delete().in('person_id', ids);
    await svc.from('policies').delete().eq('entity_id', e.id);
    await svc.from('kpi_periods').delete().eq('entity_id', e.id);
    await svc.from('equity_plans').delete().eq('entity_id', e.id);
    await svc.from('people').delete().eq('entity_id', e.id);
    await svc.from('kpi_role_sets').delete().eq('entity_id', e.id);
    await svc.from('kpi_definitions').delete().eq('entity_id', e.id);
  }
  const { data: users } = await svc.from('profiles').select('id, email').like('email', `%${DOMAIN}`);
  for (const u of users ?? []) {
    for (const t of ['user_roles', 'passkey_sessions', 'notification_preferences', 'notifications', 'announcement_views', 'audit_log']) await svc.from(t).delete().eq('user_id', u.id);
    await svc.from('notifications').delete().or(`title.ilike.%${u.email}%,body.ilike.%${u.email}%`);
    const { error } = await svc.auth.admin.deleteUser(u.id);
    if (error) console.log('delete user', u.email, error.message);
  }
  if (e) {
    await svc.from('audit_log').delete().filter('detail->>entity_id', 'eq', e.id);
    const { error } = await svc.from('entities').delete().eq('id', e.id);
    if (error) console.log('delete entity', error.message);
  }
}

if (process.argv.includes('--remove')) { await remove(); console.log('removed'); process.exit(0); }
await remove();

const { data: ent } = await svc.from('entities').insert({ code: 'SMPL', display_name: 'Sample Co', relationship: 'controlled', portal: 'none', sort: 999, tagline: 'Sample company for the HR guide' }).select('id').single().throwOnError();
const E = ent.id;

// The HR person who takes the screenshots: a portal account with the HR role for Sample Co.
const email = `sam.taylor${DOMAIN}`;
const password = `Sx${randomBytes(15).toString('base64url')}9k`;
const { data: au, error: auErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: 'Sam', last_name: 'Taylor (sample)' } });
if (auErr) throw auErr;
const uid = au.user.id;
await svc.from('profiles').update({ first_name: 'Sam', last_name: 'Taylor (sample)', first_signed_in_at: new Date().toISOString() }).eq('id', uid).throwOnError();
await svc.from('user_roles').insert({ user_id: uid, role_key: 'hr', entity_id: E, note: 'HR guide screenshots (sample)' }).throwOnError();
writeFileSync(`${HERE}account.json`, JSON.stringify({ email, password }));

const P = {};
const person = async (key, row) => {
  const { data } = await svc.from('people').insert({ entity_id: E, ...row, full_name: `${row.full_name} (sample)` }).select('id').single().throwOnError();
  P[key] = data.id;
};
await person('jordan', { full_name: 'Jordan Lee', email: `jordan.lee${DOMAIN}`, job_title: 'Chief Executive Officer', team: 'Leadership', location: 'Sydney', start_date: '2023-02-01', status: 'active' });
await person('sam', { full_name: 'Sam Taylor', email, user_id: uid, job_title: 'HR Manager', team: 'People', location: 'Sydney', start_date: '2024-03-04', status: 'active', manager_id: P.jordan });
await person('priya', { full_name: 'Priya Shah', email: `priya.shah${DOMAIN}`, job_title: 'Head of Sales', team: 'Sales', location: 'Sydney', start_date: '2023-06-12', status: 'active', manager_id: P.jordan });
await person('alex', { full_name: 'Alex Morgan', email: `alex.morgan${DOMAIN}`, job_title: 'Lead Developer', team: 'Engineering', location: 'Brisbane', start_date: '2023-04-03', status: 'active', manager_id: P.jordan });
await person('ella', { full_name: 'Ella Brown', email: `ella.brown${DOMAIN}`, job_title: 'Customer Success Manager', team: 'Customers', location: 'Sydney', start_date: '2024-01-15', status: 'offboarding', end_date: d(10), manager_id: P.jordan });
await person('mia', { full_name: 'Mia Chen', email: `mia.chen${DOMAIN}`, job_title: 'Sales Representative', team: 'Sales', location: 'Melbourne', start_date: '2024-08-05', status: 'active', manager_id: P.priya });
await person('leo', { full_name: 'Leo Rossi', email: `leo.rossi${DOMAIN}`, job_title: 'Sales Representative', team: 'Sales', location: 'Sydney', start_date: '2025-02-10', status: 'active', manager_id: P.priya });
await person('noah', { full_name: 'Noah Kim', email: `noah.kim${DOMAIN}`, job_title: 'Developer', team: 'Engineering', employment_type: 'full_time', location: 'Brisbane', start_date: d(7), status: 'onboarding', manager_id: P.alex });
await person('zoe', { full_name: 'Zoe Martin', email: `zoe.martin${DOMAIN}`, job_title: 'Developer', team: 'Engineering', employment_type: 'contractor', location: 'Remote', start_date: '2025-07-01', status: 'active', manager_id: P.alex });

// Checklists, as the portal makes them (src/lib/hr.ts).
const ON = [['Employment contract (or contractor agreement) signed and filed', 'hr', -3], ['Set up in payroll: TFN declaration, super choice, bank details', 'hr', 0], ['Email and systems accounts ready', 'it', 0], ['Laptop and equipment ready', 'it', 0], ['Invited to the portal (My HR)', 'hr', 0], ['Company policies read and accepted', 'employee', 14], ['Induction and first-week plan', 'manager', 5]];
const OFF = [['Resignation or termination letter filed', 'hr', -14], ['Handover of work, documents and passwords', 'manager', -1], ['Final pay and leave paid out (in payroll)', 'hr', 0], ['Laptop and equipment returned', 'it', 0], ['Email and systems access removed', 'it', 0], ['Unvested options lapse; vested ones may be exercised within the plan’s window', 'hr', 0], ['Portal access removed', 'hr', 0], ['Exit conversation', 'manager', -2]];
await svc.from('person_tasks').insert(ON.map(([title, who, n], i) => ({ person_id: P.noah, kind: 'onboarding', sort: i, title, who, due_on: d(7 + n), done_at: i < 2 ? ts(-1) : null }))).throwOnError();
await svc.from('person_tasks').insert(OFF.map(([title, who, n], i) => ({ person_id: P.ella, kind: 'offboarding', sort: i, title, who, due_on: d(10 + n), done_at: i < 1 ? ts(-2) : null }))).throwOnError();

// Documents for Sam.
const pdf = async (title) => { const doc = await PDFDocument.create(); const pg = doc.addPage([595, 842]); const f = await doc.embedFont(StandardFonts.Helvetica); pg.drawText(`${title} (sample)`, { x: 60, y: 760, size: 18, font: f }); pg.drawText('Sample document for the HR guide.', { x: 60, y: 730, size: 11, font: f }); return doc.save(); };
for (const [title, kind, visible] of [['Employment contract', 'contract', true], ['Salary review letter 2025', 'letter', true], ['Reference check notes', 'other', false]]) {
  const bytes = await pdf(title);
  const path = `${E}/hr/people/${P.sam}/${randomBytes(8).toString('hex')}-${kind}.pdf`;
  await svc.storage.from('legal').upload(path, bytes, { contentType: 'application/pdf' });
  await svc.from('person_documents').insert({ person_id: P.sam, title, kind, file_path: path, file_name: `${kind}.pdf`, size_bytes: bytes.length, visible_to_employee: visible, created_by: uid }).throwOnError();
}

// Policies: one everyone accepted except two, one just published.
const { data: leave } = await svc.from('policies').insert({ entity_id: E, title: 'Leave policy (sample)', status: 'published', version: 1, requires_ack: true, published_at: ts(-20), ack_due_days: 14, body: 'Annual leave: full-time staff get four weeks a year. Ask your manager at least four weeks ahead for leave of a week or more, and two weeks ahead for shorter leave.\n\nPersonal leave: tell your manager as early as you can on the day. For more than two days in a row, a medical certificate is needed.\n\nPublic holidays: the office is closed on national and state public holidays.' }).select('id').single().throwOnError();
const { data: conduct } = await svc.from('policies').insert({ entity_id: E, title: 'Code of conduct (sample)', status: 'published', version: 1, requires_ack: true, published_at: ts(-2), ack_due_days: 14, body: 'We treat colleagues, customers and investors with respect. We keep confidential information confidential, declare conflicts of interest, and speak up when something is wrong.' }).select('id').single().throwOnError();
await svc.from('policies').insert({ entity_id: E, title: 'Working from home (sample)', status: 'draft', version: 1, requires_ack: true, ack_due_days: 14, body: 'Draft.' }).throwOnError();
await svc.from('policy_acks').insert(['jordan', 'sam', 'priya', 'alex', 'mia', 'zoe'].map((k, i) => ({ policy_id: leave.id, version: 1, person_id: P[k], acked_at: ts(-18 + i) }))).throwOnError();
await svc.from('policy_acks').insert(['jordan', 'priya'].map((k) => ({ policy_id: conduct.id, version: 1, person_id: P[k], acked_at: ts(-1) }))).throwOnError();

// Equity.
const { data: plan } = await svc.from('equity_plans').insert({ entity_id: E, name: 'Employee Share Option Plan (sample)', kind: 'options', pool_size: 1000000, adopted_on: '2024-01-15', vesting_months: 48, cliff_months: 12, frequency: 'monthly', expiry_years: 10, leaver_exercise_days: 90 }).select('id').single().throwOnError();
const grant = (k, n, date, status, accepted) => ({ plan_id: plan.id, entity_id: E, person_id: P[k], holder_name: `${k[0].toUpperCase()}${k.slice(1)} (sample)`, number: n, exercise_price: 0.1, grant_date: date, vesting_start: date, vesting_months: 48, cliff_months: 12, frequency: 'monthly', expiry_date: `${Number(date.slice(0, 4)) + 10}${date.slice(4)}`, status, accepted_at: accepted ? `${date}T10:00:00+10:00` : null });
await svc.from('equity_grants').insert([grant('sam', 40000, '2024-06-01', 'granted', true), grant('alex', 60000, '2024-02-01', 'granted', true), grant('mia', 25000, '2025-03-01', 'granted', true), grant('priya', 50000, d(-3), 'draft', false)]).throwOnError();
for (const g of ['sam', 'alex', 'mia', 'priya']) await svc.from('equity_grants').update({ holder_name: { sam: 'Sam Taylor (sample)', alex: 'Alex Morgan (sample)', mia: 'Mia Chen (sample)', priya: 'Priya Shah (sample)' }[g] }).eq('person_id', P[g]);

// KPIs: this quarter, open, with scorecards for the sales team and Sam.
const { data: period } = await svc.from('kpi_periods').insert({ entity_id: E, label: 'Q4 2026', kind: 'quarter', starts_on: '2026-10-01', ends_on: '2026-12-31', status: 'open' }).select('id').single().throwOnError();
const { data: goal } = await svc.from('kpi_goals').insert({ entity_id: E, period_id: period.id, title: 'Grow new revenue to A$400k this quarter', target: 400000, unit: 'aud' }).select('id').single().throwOnError();
await svc.from('kpi_goals').insert({ entity_id: E, period_id: period.id, parent_id: goal.id, title: 'Sales team: A$300k of new revenue', team: 'Sales', target: 300000, unit: 'aud', sort: 1 }).throwOnError();
const K = { rev: '6b700000-0000-4000-8000-000000000101', cust: '6b700000-0000-4000-8000-000000000102', csat: '6b700000-0000-4000-8000-000000000107', pol: '6b700000-0000-4000-8000-000000000108', onb: '6b700000-0000-4000-8000-000000000110', ontime: '6b700000-0000-4000-8000-000000000104' };
const card = async (k, status, items, results) => {
  const { data: sc } = await svc.from('kpi_scorecards').insert({ entity_id: E, period_id: period.id, person_id: P[k], status, activated_at: ts(-30) }).select('id').single().throwOnError();
  for (const [i, it] of items.entries()) {
    const { data: row } = await svc.from('kpi_scorecard_items').insert({ scorecard_id: sc.id, definition_id: K[it[0]], goal_id: it[0] === 'rev' ? goal.id : null, target: it[1], weight: it[2], below: it[3], stretch: it[4], sort: i }).select('id').single().throwOnError();
    for (const [v, n] of results[i] ?? []) await svc.from('kpi_results').insert({ item_id: row.id, value: v, as_of: d(n), source: it[0] === 'pol' ? 'policies_accepted' : 'manual', status: 'confirmed', confirmed_by: uid, confirmed_at: ts(n) }).throwOnError();
  }
  return sc.id;
};
const mia = await card('mia', 'active', [['rev', 150000, 50, 100000, 180000], ['cust', 6, 30, 4, 8], ['csat', 4.5, 20, 4, 4.8]], [[[38000, -20], [64000, -1]], [[3, -1]], [[4.6, -1]]]);
const leo = await card('leo', 'active', [['rev', 120000, 50, 80000, 150000], ['cust', 5, 30, 3, 7], ['csat', 4.5, 20, 4, 4.8]], [[[9000, -20], [18000, -1]], [[1, -1]], [[4.2, -1]]]);
await card('sam', 'active', [['pol', 100, 40, 80, 100], ['onb', 100, 30, 80, 100], ['ontime', 90, 30, 75, 98]], [[[78, -1]], [[85, -1]], [[92, -1]]]);
await svc.from('kpi_checkins').insert([{ scorecard_id: mia, author_id: uid, author_role: 'manager', body: 'Strong month: two new customers signed. Next: close the Harbour deal before December.', private: false, created_at: ts(-6) }, { scorecard_id: leo, author_id: uid, author_role: 'hr', body: 'Revenue is behind target. Agreed to pair with Mia on two accounts.', private: true, created_at: ts(-3) }]).throwOnError();

const { data: samGrant } = await svc.from('equity_grants').select('id').eq('person_id', P.sam).single();
const { data: miaCard } = await svc.from('kpi_scorecards').select('id').eq('person_id', P.mia).single();
writeFileSync(`${HERE}ids.json`, JSON.stringify({ ...P, leave: leave.id, samGrant: samGrant.id, miaCard: miaCard.id }, null, 1));
console.log('seeded');
