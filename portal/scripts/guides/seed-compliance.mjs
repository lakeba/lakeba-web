// Compliance sample data for Sample Co: a second staff member, an investor, the register, approvals,
// audit entries and Ask answers to review.
import { saveIds, svc, ins, removeAll, createBase, d, ts, DOMAIN, sql } from './base.mjs';
import { randomUUID } from 'node:crypto';
if (process.argv.includes('--remove')) { await removeAll(); console.log('removed'); process.exit(0); }
await removeAll();
const { E, uid } = await createBase();
const user = async (first, last, signedIn) => {
  const { data, error } = await svc.auth.admin.createUser({ email: `${first.toLowerCase()}.${last.toLowerCase()}${DOMAIN}`, email_confirm: true, user_metadata: { first_name: first, last_name: `${last} (sample)` } });
  if (error) throw error;
  await svc.from('profiles').update({ first_name: first, last_name: `${last} (sample)`, first_signed_in_at: signedIn ? ts(-40) : null }).eq('id', data.user.id).throwOnError();
  return data.user.id;
};
const alex = await user('Alex', 'Morgan', true);
await ins('user_roles', [{ user_id: alex, role_key: 'marketing', entity_id: E, note: 'Sample Co marketing (sample)', granted_by: uid }, { user_id: alex, role_key: 'compliance', entity_id: E, expires_at: ts(60), note: 'Cover while Sam is away (sample)', granted_by: uid }]);
const inv = await user('Robin', 'Investor', true);

// Register: one class, four holders, movements.
const cls = await ins('share_classes', { entity_id: E, code: 'ORD', name: 'Ordinary shares', kind: 'ordinary', voting: true, official_on_issue: 1000000, official_as_at: '2026-06-30' });
const H = {};
for (const [k, name, kind, shares] of [['jordan', 'Jordan Lee (sample)', 'individual', 400000], ['trust', 'Sample Ventures Trust (sample)', 'trust', 350000], ['robin', 'Robin Investor (sample)', 'individual', 150000], ['super', 'Sample Super Fund (sample)', 'super_fund', 100000]]) {
  const h = await ins('holders', { name, kind, registry_ref: `SAMPLE-${k.toUpperCase()}` });
  H[k] = h.id;
  await ins('holdings', { holder_id: h.id, share_class_id: cls.id, shares, as_at: '2026-06-30' });
  await ins('register_movements', { entity_id: E, holder_id: h.id, share_class_id: cls.id, seq: 1, moved_on: '2019-03-14', kind: 'Allotment', shares, balance: shares });
}
await ins('holder_members', { holder_id: H.robin, user_id: inv, access: 'owner' });

// Approvals: a news post waiting (asked by Alex), a newsletter with changes requested.
const post = await ins('posts', { slug: 'sample-co-joins-retail-program-sample', title: 'Sample Co joins the Sample Retail program (sample)', excerpt: 'Sample Co will supply 40 stores from January.', body_html: '<p>Sample Co will supply 40 stores from January. (Sample post.)</p>', entity_id: E, visibility: 'shareholders', notify_on_publish: false, created_by: alex, updated_by: alex });
await ins('approvals', { item_type: 'post', item_id: post.id, area: 'news', entity_id: E, status: 'pending', title: post.title, note: 'Numbers checked with Finance. OK to publish Monday?', requested_by: alex, requested_at: ts(-1) });
const nl = await ins('newsletter_issues', { audience: 'shareholders', entity_id: E, subject: 'October update from Sample Co (sample)', status: 'draft', created_by: alex, updated_by: alex });
await ins('approvals', { item_type: 'newsletter', item_id: nl.id, area: 'newsletters', entity_id: E, status: 'changes_requested', title: nl.subject, note: 'Ready for review.', requested_by: alex, requested_at: ts(-3), decided_by: uid, decided_at: ts(-2), decision_note: 'Please remove the revenue forecast: it isn’t public yet.' });

// Audit entries (no webhooks are set up on staging).
const audit = [[uid, 'admin_granted_role', { entity_id: E, role: 'compliance', to: 'alex.morgan' + DOMAIN }, -5], [alex, 'approval_requested', { entity_id: E, item: post.title }, -1], [uid, 'approval_changes_requested', { entity_id: E, item: nl.subject }, -2], [uid, 'admin_created_holder', { entity_id: E, holder: 'Robin Investor (sample)' }, -6], [inv, 'document_opened', { entity_id: E, title: 'Sample Co annual report 2026 (sample)' }, -1], [uid, 'admin_set_official_on_issue', { entity_id: E, class: 'ORD', on_issue: 1000000 }, -7]];
for (const [u, action, detail, n] of audit) sql(`insert into audit_log (user_id, action, detail, created_at) values ('${u}', '${action}', '${JSON.stringify(detail).replace(/'/g, "''")}'::jsonb, now() + interval '${n} days')`);

// Ask answers to review.
const ask = [['What is my holding worth today?', 'Your 150,000 ordinary shares are worth about A$72,000 at the latest reference price of A$0.48 (set by the board on 30 June 2026).', 1, 'unreviewed'], ['When is the next dividend?', 'I don’t have information about a dividend in the documents I can see.', -1, 'unreviewed'], ['How do I change my address?', 'Open Account → Details and update your address, or email the share registry.', 1, 'good']];
for (const [i, [question, answer, feedback, review_status]] of ask.entries()) await ins('ask_exchanges', { user_id: inv, conversation_id: randomUUID(), turn: 1, question, answer, sources: [], feedback, review_status, entity_id: E, mode: 'retrieval', model: 'claude-haiku-5-5', cost_usd: 0.004, created_at: ts(-i - 1), feedback_note: feedback < 0 ? 'The board announced one last week' : null });
saveIds({ E, alex, inv, post: post.id, nl: nl.id, holder: H.robin });
console.log('seeded');
