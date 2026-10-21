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

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
