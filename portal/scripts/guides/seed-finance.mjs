// Finance sample data: two sample companies with monthly packs, a board summary, a year-end request and commissions.
import { saveIds, svc, ins, pdf, removeAll, createBase, ts, DOMAIN } from './base.mjs';
import { randomBytes } from 'node:crypto';
if (process.argv.includes('--remove')) { await removeAll(); console.log('removed'); process.exit(0); }
await removeAll();
const { E, uid } = await createBase();
const B = (await ins('entities', { code: 'SMPLB', display_name: 'Sample Labs', relationship: 'controlled', portal: 'none', sort: 999, tagline: 'Second sample company' })).id;

// Figures: monthly P&L (period and year to date from July) and the balance sheet at month end.
const fig = (rev, ytdRev, months, cash, ic) => {
  const line = (r) => ({ period: Math.round(rev * r), ytd: Math.round(ytdRev * r) });
  const pl = { revenue: line(1), other_income: line(0.01), cost_of_sales: line(0.38), employee_costs: line(0.34), other_expenses: line(0.12), depreciation: line(0.02), interest: line(0.005), income_tax: line(0.04) };
  pl.net_profit = { period: pl.revenue.period + pl.other_income.period - ['cost_of_sales', 'employee_costs', 'other_expenses', 'depreciation', 'interest', 'income_tax'].reduce((a, k) => a + pl[k].period, 0), ytd: 0 };
  pl.net_profit.ytd = pl.revenue.ytd + pl.other_income.ytd - ['cost_of_sales', 'employee_costs', 'other_expenses', 'depreciation', 'interest', 'income_tax'].reduce((a, k) => a + pl[k].ytd, 0);
  const bs = { cash, receivables: Math.round(rev * 0.9), other_current_assets: 18000, non_current_assets: 140000, payables: Math.round(rev * 0.4), borrowings: 60000, other_liabilities: 25000 };
  bs.equity = bs.cash + bs.receivables + bs.other_current_assets + bs.non_current_assets - bs.payables - bs.borrowings - bs.other_liabilities;
  return { pl, bs, ic };
};
await ins('reporting_schedules', [{ entity_id: E, cadence: 'monthly', due_days: 20, first_period: '2026-07-01', currency: 'AUD', year_end_month: 6, active: true }, { entity_id: B, cadence: 'monthly', due_days: 20, first_period: '2026-07-01', currency: 'AUD', year_end_month: 6, active: true }]);
const icA = [{ entity_id: B, receivable: 12000, payable: 0, income: 4000, expense: 0, investment: 250000 }];
const icB = [{ entity_id: E, receivable: 0, payable: 12000, income: 0, expense: 4000, investment: 0 }];
const months = [['2026-07-31', '2026-08-20'], ['2026-08-31', '2026-09-20'], ['2026-09-30', '2026-10-20']];
const revA = [172000, 181000, 196000], revB = [88000, 91000, 149000];
const packs = {};
for (const [i, [end, due]] of months.entries()) {
  const ytdA = revA.slice(0, i + 1).reduce((a, b) => a + b, 0), ytdB = revB.slice(0, i + 1).reduce((a, b) => a + b, 0);
  const a = await ins('reporting_packs', { entity_id: E, period_end: end, cadence: 'monthly', due_on: due, status: i < 2 ? 'accepted' : 'submitted', source: i === 2 ? 'upload' : 'xero', figures: fig(revA[i], ytdA, i + 1, 210000 + i * 15000, icA), note: i === 2 ? 'Strong September: two new customers and the Harbour Foods project billed. Payroll includes a one-off bonus.' : '', submitted_by: uid, submitted_at: `${due}T09:00:00+10:00`, reviewed_by: i < 2 ? uid : null, reviewed_at: i < 2 ? `${due}T15:00:00+10:00` : null });
  const b = await ins('reporting_packs', { entity_id: B, period_end: end, cadence: 'monthly', due_on: due, status: i < 2 ? 'accepted' : 'returned', source: 'xero', figures: fig(revB[i], ytdB, i + 1, 64000 - i * 9000, icB), note: i === 2 ? 'Revenue up on the Bayview contract.' : '', submitted_by: uid, submitted_at: `${due}T11:00:00+10:00`, reviewed_by: i < 2 ? uid : null, reviewed_at: i < 2 ? `${due}T16:00:00+10:00` : null });
  packs[`A${i}`] = a.id; packs[`B${i}`] = b.id;
}
await ins('reporting_pack_messages', [
  { pack_id: packs.B2, author_id: uid, body: 'Revenue is up 64% on August. Is the Bayview contract billed for the whole year in September? If so, please spread it over the months it covers and send the pack again.', created_at: ts(-8) },
  { pack_id: packs.A1, author_id: uid, body: 'Thanks, accepted.', created_at: ts(-40) },
]);
await ins('board_summaries', { period_end: '2026-09-30', commentary: 'September closed ahead of plan. Sample Co grew revenue 8% on August to A$196k with two new customers; payroll includes a one-off bonus. Sample Labs’ September pack has been sent back: revenue looks to include a full year of the Bayview contract, and will be restated. Cash across the two companies is A$295k. Between them, Sample Co charges Sample Labs a management fee of A$4k a month, removed in the consolidated figures. (Sample commentary.)', updated_by: uid });

// Year-end request for Sample Labs.
const req = await ins('audit_requests', { entity_id: B, year_end: '2026-06-30', title: 'FY2026 audit (sample)', due_on: '2026-11-20', auditor: 'Sample Audit Partners', status: 'open', created_by: uid });
const items = [['Trial balance at 30 June', 'accepted'], ['Bank statements and reconciliations for June', 'accepted'], ['Fixed asset register and depreciation schedule', 'provided'], ['Payroll summary and superannuation paid', 'provided'], ['Debtors and creditors listings at 30 June', 'requested'], ['Loan agreements and confirmations', 'requested'], ['Board minutes for the year', 'requested'], ['Share register at 30 June', 'not_applicable']];
for (const [i, [title, status]] of items.entries()) {
  let files = [];
  if (status === 'provided' || status === 'accepted') {
    const bytes = await pdf(title); const path = `${B}/year-end/${req.id}/${randomBytes(6).toString('hex')}.pdf`;
    await svc.storage.from('legal').upload(path, bytes, { contentType: 'application/pdf' });
    files = [{ path, name: `${title.split(' ').slice(0, 3).join('-').toLowerCase()}.pdf`, size: bytes.length }];
  }
  await ins('audit_items', { request_id: req.id, sort: i, title, status, files, updated_by: uid, review_note: title.startsWith('Debtors') ? 'Please add the ageing (30/60/90 days).' : '' });
}

// Commissions at Sample Co.
const person = async (full_name, job_title, team) => (await ins('people', { entity_id: E, full_name: `${full_name} (sample)`, email: `${full_name.split(' ')[0].toLowerCase()}${DOMAIN}`, job_title, team, location: 'Sydney', start_date: '2024-08-05', status: 'active' })).id;
const mia = await person('Mia Chen', 'Sales Representative', 'Sales'), leo = await person('Leo Rossi', 'Sales Representative', 'Sales'), priya = await person('Priya Shah', 'Head of Sales', 'Sales');
const plan = await ins('commission_plans', { entity_id: E, name: 'Sales commission 2026 (sample)', basis: 'invoice_raised', tiers: [{ upTo: 100, rate: 8 }, { upTo: null, rate: 12 }], cap: 30000, clawback: true, active: true, notes: 'Quarterly. Paid with the following month’s salary.', created_by: uid });
await ins('commission_assignments', [{ plan_id: plan.id, person_id: mia, target: 150000, starts_on: '2026-04-01' }, { plan_id: plan.id, person_id: leo, target: 120000, starts_on: '2026-04-01' }, { plan_id: plan.id, person_id: priya, target: 200000, starts_on: '2026-04-01' }]);
const clients = [['Harbour Foods', mia, 100], ['Northside Clinics', mia, 100], ['Bayview Retail', mia, 50], ['Bayview Retail', priya, 50], ['Cityline Logistics', leo, 100], ['Greenway Schools', leo, 100], ['Summit Legal', priya, 100]];
await ins('commission_attributions', clients.map(([contact_name, person_id, share]) => ({ entity_id: E, contact_name, person_id, share, starts_on: '2026-04-01', created_by: uid })));
const run = async (start, end, extra, lines) => {
  const r = await ins('commission_runs', { entity_id: E, plan_id: plan.id, period_start: start, period_end: end, source: 'upload', upload_name: `invoices-${start.slice(0, 7)}.csv`, invoices: [], built_by: uid, built_at: ts(-3), created_by: uid, ...extra });
  await ins('commission_run_lines', lines.map(([person_id, num, contact_name, date, amount, share], i) => {
    const credited = person_id ? Math.round(amount * share / 100) : 0;
    return { run_id: r.id, person_id, plan_id: person_id ? plan.id : null, kind: 'earned', invoice_id: `INV-${num}`, invoice_number: `INV-${num}`, contact_name, invoice_date: date, amount, share: person_id ? share : 0, credited, rate: person_id ? 8 : 0, commission: Math.round(credited * 0.08 * 100) / 100, sort: i };
  }));
  return r.id;
};
await run('2026-04-01', '2026-06-30', { status: 'paid', submitted_by: uid, submitted_at: ts(-110), approved_by: uid, approved_at: ts(-108), paid_by: uid, paid_at: ts(-100) }, [[mia, 1041, 'Harbour Foods', '2026-04-14', 38000, 100], [mia, 1056, 'Northside Clinics', '2026-05-20', 29000, 100], [leo, 1060, 'Cityline Logistics', '2026-05-28', 41000, 100], [priya, 1072, 'Summit Legal', '2026-06-12', 52000, 100]]);
const q3 = await run('2026-07-01', '2026-09-30', { status: 'draft', submitted_by: uid, submitted_at: ts(-2) }, [[mia, 1101, 'Harbour Foods', '2026-07-09', 42000, 100], [mia, 1118, 'Northside Clinics', '2026-08-03', 36000, 100], [mia, 1125, 'Bayview Retail', '2026-08-21', 56000, 50], [priya, 1125, 'Bayview Retail', '2026-08-21', 56000, 50], [leo, 1130, 'Cityline Logistics', '2026-09-02', 31000, 100], [leo, 1137, 'Greenway Schools', '2026-09-18', 22000, 100], [priya, 1140, 'Summit Legal', '2026-09-25', 47000, 100], [null, 1142, 'Riverbend Hotels', '2026-09-29', 18500, 0]]);
saveIds({ E, B, packA: packs.A2, packB: packs.B2, req: req.id, q3 });
console.log('seeded');
