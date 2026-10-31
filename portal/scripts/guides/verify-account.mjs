// Staff guides: a temporary sample account to check the guide downloads (role: admin | hr). --remove takes it out.
import { removeAll, createBase, saveIds, sql } from './base.mjs';
if (process.argv.includes('--remove')) { await removeAll(); console.log('removed'); process.exit(0); }
await removeAll();
const { E, uid } = await createBase();
if (process.argv[2] === 'hr') sql(`update user_roles set role_key = 'hr', entity_id = '${E}' where user_id = '${uid}'`);
saveIds({ E });
console.log('ready', process.argv[2] ?? 'admin');
