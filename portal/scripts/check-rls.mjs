// Checks the row-level security rules against the local database using the
// accounts created by seed-dev.mjs. Exits non-zero on the first failure.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url ?? '')) throw new Error('check-rls only runs against local Supabase');
const accounts = JSON.parse(readFileSync(new URL('../.dev-users.json', import.meta.url), 'utf8'));
const client = () => createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failures++;
};

async function signIn(email) {
  const c = client();
  const { password } = accounts.find((a) => a.email === email);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

/** RFC 6238 TOTP code for a base32 secret, so the test can complete MFA. */
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

const holderNames = async (c) => ((await c.from('holders').select('name').order('name')).data ?? []).map((h) => h.name);

// Signed out: nothing is readable.
{
  const anon = client();
  const { data, error } = await anon.from('holdings').select('id');
  check('signed-out visitor cannot read holdings', Boolean(error) || data.length === 0, error?.message);
}

// Investor one: sees only their two entities.
const one = await signIn('investor.one@lakeba.test');
{
  const names = await holderNames(one);
  check('investor one sees only their own holders', JSON.stringify(names) === JSON.stringify(['Harbourview Family Trust', 'Northshore Ventures Pty Ltd']), names.join(', '));
  const { data: rows } = await one.from('holdings').select('holder_id');
  check('investor one sees only their own holdings rows', rows.every((r) => r.holder_id.endsWith('a1') || r.holder_id.endsWith('a2')) && rows.length === 3, `${rows.length} rows`);
  const { data: totals } = await one.rpc('shares_on_issue');
  check('total on issue uses latest holdings of everyone', Number(totals?.[0]?.total) === 10_000_000, JSON.stringify(totals));
  const { error: roleError } = await one.from('profiles').update({ role: 'admin' }).eq('email', 'investor.one@lakeba.test');
  check('investor cannot make themselves admin', Boolean(roleError), 'update succeeded');
  const { error: phoneError } = await one.from('profiles').update({ phone: '+61 400 000 000' }).eq('email', 'investor.one@lakeba.test');
  check('investor can update their own phone', !phoneError, phoneError?.message);
  const { error: insertError } = await one.from('holdings').insert({ holder_id: '00000000-0000-4000-8000-0000000000a1', share_class_id: '00000000-0000-4000-8000-000000000001', shares: 1, as_at: '2030-01-01' });
  check('investor cannot write holdings', Boolean(insertError), 'insert succeeded');
  const { data: others } = await one.from('profiles').select('email');
  check('investor sees only their own profile', others.length === 1, `${others.length} profiles`);
  const { data: log } = await one.from('audit_log').select('id');
  check('investor cannot read the audit log', log.length === 0, `${log.length} rows`);
}

// Investor two: cannot see investor one's entities.
const two = await signIn('investor.two@lakeba.test');
{
  const names = await holderNames(two);
  check('investor two sees only their own holder', JSON.stringify(names) === JSON.stringify(['Riverside Super Fund']), names.join(', '));
}

// Admin: no extra access until the session passes MFA. Start from no factors,
// so earlier manual testing doesn't change the outcome.
const service = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const adminUser = (await service.auth.admin.listUsers()).data.users.find((u) => u.email === 'admin@lakeba.test');
for (const f of (await service.auth.admin.mfa.listFactors({ userId: adminUser.id })).data?.factors ?? []) {
  await service.auth.admin.mfa.deleteFactor({ userId: adminUser.id, id: f.id });
}
const admin = await signIn('admin@lakeba.test');
{
  check('admin without MFA sees no holders', (await holderNames(admin)).length === 0);
  const { data: enrolled, error } = await admin.auth.mfa.enroll({ factorType: 'totp', friendlyName: `rls-check-${Date.now()}` });
  if (error) throw error;
  const { error: verifyError } = await admin.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code: totp(enrolled.totp.secret) });
  check('admin completes MFA (aal2)', !verifyError, verifyError?.message);
  check('admin with MFA sees all holders', (await holderNames(admin)).length === 3);
  const { data: log } = await admin.from('audit_log').select('id');
  check('admin with MFA can read the audit log', Array.isArray(log));
  await admin.auth.mfa.unenroll({ factorId: enrolled.id });
}

// ---------------------------------------------------------------------------
// Phase 2–5 content. Fixtures are created with the service key and removed at the end.
// ---------------------------------------------------------------------------
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A3 = '00000000-0000-4000-8000-0000000000a3';
const created = { documents: [], meetings: [], users: [] };
const fixtureDoc = async (fields) => {
  const path = `test/${crypto.randomUUID()}.pdf`;
  await service.storage.from('documents').upload(path, new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' });
  const { data } = await service.from('documents').insert({ title: 'RLS fixture', category: 'other', file_path: path, mime_type: 'application/pdf', ...fields }).select('id, file_path').single().throwOnError();
  await service.from('document_chunks').insert({ document_id: data.id, chunk_index: 0, content: 'zebracorn confidential fixture passage' }).throwOnError();
  created.documents.push(data);
  return data;
};
const docIds = async (c) => ((await c.from('documents').select('id')).data ?? []).map((d) => d.id);

try {
  const draft = await fixtureDoc({ published_at: null });
  const forA3 = await fixtureDoc({ published_at: new Date().toISOString(), audience: 'holder', holder_id: A3 });
  const boardOnly = await fixtureDoc({ published_at: new Date().toISOString(), audience: 'board' });

  const oneDocs = await docIds(one);
  check('investor sees published documents', oneDocs.length >= 4, `${oneDocs.length}`);
  check('investor cannot see drafts', !oneDocs.includes(draft.id));
  check("investor cannot see another holder's document", !oneDocs.includes(forA3.id));
  check('investor cannot see board-only documents', !oneDocs.includes(boardOnly.id));
  check('holder document visible to its holder', (await docIds(two)).includes(forA3.id));
  const { error: signError } = await one.storage.from('documents').createSignedUrl(forA3.file_path, 60);
  check("investor cannot get a link to another holder's file", Boolean(signError));
  const { error: ownSign } = await two.storage.from('documents').createSignedUrl(forA3.file_path, 60);
  check('holder can get a link to their own file', !ownSign, ownSign?.message);
  const { error: uploadError } = await one.storage.from('documents').upload(`test/${crypto.randomUUID()}.pdf`, new Uint8Array([1]));
  check('investor cannot upload files', Boolean(uploadError));
  const { error: readErr } = await one.rpc('record_document_read', { doc_id: forA3.id });
  check("investor cannot record a read of another holder's document", Boolean(readErr));
  const { data: hits } = await one.rpc('search_documents', { query: 'zebracorn' });
  check('Ask search never returns passages the investor cannot read', (hits ?? []).length === 0, `${hits?.length} hits`);
  const { data: twoHits } = await two.rpc('search_documents', { query: 'zebracorn' });
  check('Ask search returns passages the investor can read', (twoHits ?? []).length === 1, `${twoHits?.length} hits`);

  // Board Q&A
  const { data: q2 } = await two.from('queries').insert({ user_id: (await two.auth.getUser()).data.user.id, subject: 'RLS fixture question' }).select('id').single();
  check('investor can ask the board', Boolean(q2));
  const { data: seenByOne } = await one.from('queries').select('id').eq('id', q2?.id ?? '');
  check("investor cannot see another investor's questions", (seenByOne ?? []).length === 0);
  const { error: statusErr } = await two.from('queries').insert({ user_id: (await two.auth.getUser()).data.user.id, subject: 'Sneaky', status: 'closed' });
  check('investor cannot set a question’s status', Boolean(statusErr));
  const { error: internalErr } = await two.from('query_messages').insert({ query_id: q2?.id, author_id: (await two.auth.getUser()).data.user.id, body: 'x', internal: true });
  check('investor cannot post internal notes', Boolean(internalErr));
  const { error: crossReply } = await one.from('query_messages').insert({ query_id: q2?.id, author_id: (await one.auth.getUser()).data.user.id, body: 'x' });
  check("investor cannot reply in another investor's thread", Boolean(crossReply));
  if (q2) await service.from('queries').delete().eq('id', q2.id);

  // Proxy voting
  const { data: res } = await one.from('resolutions').select('id').order('number').limit(1).single();
  const oneId = (await one.auth.getUser()).data.user.id;
  const { error: voteOwn } = await one.from('proxy_votes').upsert({ resolution_id: res.id, holder_id: A1, vote: 'for', lodged_by: oneId });
  check('owner can lodge a proxy for their holder', !voteOwn, voteOwn?.message);
  const { error: voteOther } = await two.from('proxy_votes').upsert({ resolution_id: res.id, holder_id: A1, vote: 'against', lodged_by: (await two.auth.getUser()).data.user.id });
  check("investor cannot vote for another holder", Boolean(voteOther));
  const { data: past } = await service.from('meetings').insert({ title: 'Past meeting', starts_at: new Date(Date.now() - 86400_000).toISOString(), proxy_deadline: new Date(Date.now() - 2 * 86400_000).toISOString(), status: 'open' }).select('id').single().throwOnError();
  created.meetings.push(past.id);
  const { data: pastRes } = await service.from('resolutions').insert({ meeting_id: past.id, number: 1, title: 'Late' }).select('id').single().throwOnError();
  const { error: lateVote } = await one.from('proxy_votes').insert({ resolution_id: pastRes.id, holder_id: A1, vote: 'for', lodged_by: oneId });
  check('proxies are refused after the deadline', Boolean(lateVote));
  const { data: tally, error: tallyErr } = await one.rpc('resolution_tally', { target_meeting: '00000000-0000-4000-8000-0000000000b1' });
  check('investors cannot see the vote tally', !tallyErr && (tally ?? []).length === 0);
  await service.from('proxy_votes').delete().eq('resolution_id', res.id);

  // A viewer (read-only) link cannot vote.
  const viewerEmail = `viewer.${Date.now()}@lakeba.test`;
  const viewerPassword = `Vw${crypto.randomUUID()}9A`;
  const { data: vu } = await service.auth.admin.createUser({ email: viewerEmail, password: viewerPassword, email_confirm: true });
  created.users.push(vu.user.id);
  await service.from('holder_members').insert({ holder_id: A1, user_id: vu.user.id, access: 'viewer' }).throwOnError();
  const viewer = client();
  await viewer.auth.signInWithPassword({ email: viewerEmail, password: viewerPassword });
  const { error: viewerVote } = await viewer.from('proxy_votes').insert({ resolution_id: res.id, holder_id: A1, vote: 'for', lodged_by: vu.user.id });
  check('read-only (viewer) access cannot vote', Boolean(viewerVote));
  check('viewer can see the holding', (await holderNames(viewer)).includes('Harbourview Family Trust'));

  // An account with no holder link sees no portal content.
  const strangerEmail = `nobody.${Date.now()}@lakeba.test`;
  const { data: su } = await service.auth.admin.createUser({ email: strangerEmail, password: viewerPassword, email_confirm: true });
  created.users.push(su.user.id);
  const stranger = client();
  await stranger.auth.signInWithPassword({ email: strangerEmail, password: viewerPassword });
  check('an unlinked account sees no documents', (await docIds(stranger)).length === 0);
  check('an unlinked account sees no news', ((await stranger.from('posts').select('id')).data ?? []).length === 0);
  const { error: strangerAsk } = await stranger.from('queries').insert({ user_id: su.user.id, subject: 'Hello there' });
  check('an unlinked account cannot ask the board', Boolean(strangerAsk));

  // Directors see board documents.
  const director = await signIn('director@lakeba.test');
  check('directors see board-only documents', (await docIds(director)).includes(boardOnly.id));

  // Notifications: only read_at can be changed.
  const { error: notifEdit } = await one.from('notifications').update({ title: 'changed' }).eq('user_id', oneId);
  check('investor cannot rewrite notifications', Boolean(notifEdit));
} finally {
  for (const d of created.documents) {
    await service.storage.from('documents').remove([d.file_path]);
    await service.from('documents').delete().eq('id', d.id);
  }
  for (const id of created.meetings) await service.from('meetings').delete().eq('id', id);
  for (const id of created.users) await service.auth.admin.deleteUser(id);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
