// Legal sample data for Sample Co: record, officers, deadlines, contracts, a request and a Legal Ask answer.
import { saveIds, svc, ins, pdf, removeAll, createBase, d, ts } from './base.mjs';
import { createHash, randomBytes } from 'node:crypto';
if (process.argv.includes('--remove')) { await removeAll(); console.log('removed'); process.exit(0); }
await removeAll();
const { E, uid } = await createBase();
await ins('company_records', { entity_id: E, acn: '000000019', abn: '00000000019', company_type: 'proprietary', incorporated_on: '2019-03-14', registered_in: 'NSW', registered_office: 'Level 5, 1 Sample Street, Sydney NSW 2000', principal_place: 'Level 5, 1 Sample Street, Sydney NSW 2000', year_end: '06-30', review_date: '03-14', auditor: 'Sample Audit Partners', ultimate_holding: 'Lakeba Group Limited', notes: 'Sample record for the staff guides.', updated_by: uid });
await ins('company_officers', [
  { entity_id: E, full_name: 'Jordan Lee (sample)', position: 'director', email: 'jordan.lee@sample.example.invalid', appointed_on: '2019-03-14', consent_on: '2019-03-10', created_by: uid },
  { entity_id: E, full_name: 'Priya Shah (sample)', position: 'director', email: 'priya.shah@sample.example.invalid', appointed_on: d(-20), consent_on: d(-22), created_by: uid },
  { entity_id: E, full_name: 'Sam Taylor (sample)', position: 'secretary', email: 'sam.taylor@sample.example.invalid', appointed_on: '2024-03-04', consent_on: '2024-03-01', created_by: uid },
]);
await ins('legal_obligations', [
  { entity_id: E, kind: 'other', title: 'Renew the business insurance (sample)', detail: 'Broker quote due; policy ends on the 30th.', due_on: d(-4), status: 'open', created_by: uid },
  { entity_id: E, kind: 'other', title: 'Trademark renewal for the Sample logo (sample)', due_on: d(45), status: 'open', created_by: uid },
  { entity_id: E, kind: 'address_change', title: 'Tell ASIC about the new registered office (sample)', due_on: d(-30), status: 'done', done_on: d(-33), done_by: uid, done_note: 'Lodged form 484; receipt filed.', created_by: uid },
]);
const contract = async (row, title) => {
  const bytes = await pdf(title, ['Between Sample Co Pty Ltd and the other party.']);
  const path = `${E}/contracts/${randomBytes(8).toString('hex')}-contract.pdf`;
  await svc.storage.from('legal').upload(path, bytes, { contentType: 'application/pdf' });
  return ins('contracts', { entity_id: E, title, file_path: path, file_name: 'contract.pdf', mime_type: 'application/pdf', size_bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), pages: 1, text_source: 'text', created_by: uid, ...row });
};
const c1 = await contract({ counterparty: 'Harbour Foods Pty Ltd', contract_type: 'customer', status: 'active', signed_on: '2025-01-20', starts_on: '2025-02-01', ends_on: d(95), auto_renews: true, renewal_term: '12 months', notice_days: 60, value: 'About A$180,000 a year', governing_law: 'New South Wales', summary: 'Sample Co supplies its platform and support to Harbour Foods for two years.', change_of_control: 'Harbour Foods may end the agreement on 30 days’ notice if Sample Co changes control.', assignment: 'Neither party may assign without consent.', exclusivity: 'None.', liability_cap: 'Fees paid in the last 12 months.', termination: 'For breach not fixed within 30 days.', obligations: 'Uptime of 99.5%; support within 4 business hours.', flags: ['Renews by itself for 12 months unless 60 days’ notice is given', 'Change of control lets the customer end it'], owner_id: uid, checked_by: uid, checked_at: ts(-30) }, 'Master services agreement – Harbour Foods (sample)');
const c2 = await contract({ counterparty: 'Sample Property Trust', contract_type: 'lease', status: 'active', signed_on: '2024-06-01', starts_on: '2024-07-01', ends_on: '2029-06-30', notice_days: 180, value: 'A$96,000 a year plus outgoings', governing_law: 'New South Wales', summary: 'Five-year lease of Level 5, 1 Sample Street.', flags: ['Market rent review in July 2027'], ai_notes: ['The rent review clause on page 7 is hard to read: check the review date.'] }, 'Office lease – 1 Sample Street (sample)');
await contract({ counterparty: 'Bayview Retail Pty Ltd', contract_type: 'supplier', status: 'draft', summary: 'Supply agreement sent by Bayview for review.' }, 'Supply agreement – Bayview Retail (sample)');
const req = await ins('legal_requests', { entity_id: E, title: 'Review the Bayview Retail supply agreement (sample)', kind: 'contract_review', urgency: 'high', needed_by: d(5), status: 'in_progress', requested_by: uid, assignee_id: uid, created_at: ts(-2), triage: { summary: 'Sample Co wants the Bayview supply agreement reviewed before signing next week.', flags: ['Unlimited liability for Sample Co in clause 12', 'Bayview may change prices on 7 days’ notice'], missing: ['The pricing schedule (Schedule 2) was not attached'], related_contracts: [{ id: c1.id, title: 'Master services agreement – Harbour Foods (sample)' }], first_view: 'Ask for a liability cap in line with Sample Co’s other contracts and a 30-day notice for price changes. A starting point, not advice.' } });
await ins('legal_request_messages', [
  { request_id: req.id, author_id: uid, body: 'Hi Legal, Bayview sent their supply agreement. We’d like to sign by next Friday. Anything we should push back on?', internal: false, files: [], created_at: ts(-2) },
  { request_id: req.id, author_id: uid, body: 'Clause 12 has no cap. Will propose 12 months’ fees, same as Harbour.', internal: true, files: [], created_at: ts(-1) },
]);
await ins('legal_ask_log', { user_id: uid, question: 'Which contracts renew by themselves in the next four months, and do any have a change-of-control clause?', answer: 'One contract renews by itself in the next four months: the master services agreement with Harbour Foods [C1]. It renews for 12 months unless notice is given 60 days before it ends, and its change-of-control clause lets Harbour Foods end it on 30 days’ notice if Sample Co changes control [C1]. The office lease [C2] runs to June 2029 and does not renew by itself.', sources: [{ ref: 'C1', kind: 'contract', id: c1.id, title: 'Master services agreement – Harbour Foods (sample)', company: 'Sample Co' }, { ref: 'C2', kind: 'contract', id: c2.id, title: 'Office lease – 1 Sample Street (sample)', company: 'Sample Co' }], created_at: ts(-1) });
saveIds({ E, c1: c1.id, c2: c2.id, req: req.id });
console.log('seeded');
