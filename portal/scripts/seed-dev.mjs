// Creates local test accounts and links them to the fictional holders in
// supabase/seed.sql. Local development only: refuses to run against a
// non-local Supabase. Passwords are generated and saved to .dev-users.json.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url ?? '')) throw new Error('seed-dev only runs against local Supabase');
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const users = [
  { email: 'admin@lakeba.test', first_name: 'Ada', last_name: 'Admin', role: 'admin', holders: [] },
  { email: 'investor.one@lakeba.test', first_name: 'Jordan', last_name: 'Investor', role: 'investor', holders: ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2'] },
  { email: 'investor.two@lakeba.test', first_name: 'Sam', last_name: 'Holder', role: 'investor', holders: ['00000000-0000-4000-8000-0000000000a3'] },
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
writeFileSync(new URL('../.dev-users.json', import.meta.url), JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 });
console.log(`Seeded ${saved.length} local test accounts → portal/.dev-users.json`);
