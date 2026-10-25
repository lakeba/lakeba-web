import type { serviceClient } from './admin';
import type { Access } from './access';
import { notifySecurity } from './notify';

type Svc = ReturnType<typeof serviceClient>;

// Giving and removing roles (System → Users) and changing what a role allows
// (System → Roles), with the safety rules: only people allowed to manage users
// may change roles; nobody can hand out a permission they don't hold
// themselves (for that scope); the last group Admin can't be removed; every
// change is audited and the person is told.

export type RoleRow = { key: string; name: string; description: string; builtin: boolean; permissions: string[] };

export async function loadRoles(svc: Svc): Promise<RoleRow[]> {
  const { data } = await svc.from('roles').select('key, name, description, builtin, role_permissions(permission)').order('builtin', { ascending: false }).order('name');
  return ((data ?? []) as unknown as (RoleRow & { role_permissions: { permission: string }[] })[]).map((r) => ({ key: r.key, name: r.name, description: r.description, builtin: r.builtin, permissions: r.role_permissions.map((p) => p.permission).sort() }));
}

/** The permissions in this list that the person changing roles doesn't hold for this scope (they can't hand those out). */
export const beyondMe = (me: Access, perms: string[], entityId: string | null) => perms.filter((p) => !me.can(p, entityId));

async function activeGroupAdmins(svc: Svc) {
  const { data } = await svc.from('user_roles').select('user_id').eq('role_key', 'admin').is('entity_id', null).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  return new Set((data ?? []).map((r) => r.user_id));
}

export async function grantRole(svc: Svc, me: Access, by: string, o: { userId: string; role: RoleRow; entityId: string | null; expiresAt: string | null; note: string; origin: string; companyName: string }) {
  if (!me.can('users.do', null)) return 'Only people allowed to manage users can give roles.';
  const missing = beyondMe(me, o.role.permissions, o.entityId);
  if (missing.length) return `You can’t give this role: it includes permissions you don’t have yourself (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}).`;
  if (o.expiresAt && new Date(o.expiresAt) <= new Date()) return 'The end date must be in the future.';
  const { error } = await svc.from('user_roles').insert({ user_id: o.userId, role_key: o.role.key, entity_id: o.entityId, expires_at: o.expiresAt, note: o.note.slice(0, 300), granted_by: by });
  if (error) return /duplicate|unique/i.test(error.message) ? 'They already have this role for this scope.' : error.message;
  await notifySecurity({ userId: o.userId, origin: o.origin, title: `You now have the ${o.role.name} role`, body: `A Lakeba administrator gave you the ${o.role.name} role for ${o.companyName}${o.expiresAt ? `, until ${new Date(o.expiresAt).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}` : ''}. You’ll need two-step sign-in to use it. You’ll find it under Admin.` }).catch(() => null);
  return null;
}

export async function removeRole(svc: Svc, me: Access, by: string, o: { assignmentId: string; origin: string }) {
  if (!me.can('users.do', null)) return { error: 'Only people allowed to manage users can remove roles.' };
  const { data: a } = await svc.from('user_roles').select('id, user_id, role_key, entity_id, roles(name, role_permissions(permission))').eq('id', o.assignmentId).maybeSingle();
  if (!a) return { error: 'That role was not found.' };
  const perms = ((a.roles as unknown as { role_permissions: { permission: string }[] } | null)?.role_permissions ?? []).map((p) => p.permission);
  if (beyondMe(me, perms, a.entity_id).length) return { error: 'You can’t remove a role with permissions you don’t have yourself.' };
  if (a.role_key === 'admin' && a.entity_id === null) {
    const admins = await activeGroupAdmins(svc);
    if (admins.size <= 1 && admins.has(a.user_id)) return { error: 'This is the last group Admin: give someone else the Admin role first.' };
  }
  await svc.from('user_roles').delete().eq('id', a.id);
  const name = (a.roles as unknown as { name: string } | null)?.name ?? a.role_key;
  await notifySecurity({ userId: a.user_id, origin: o.origin, title: `Your ${name} role was removed`, body: `A Lakeba administrator removed your ${name} role. If you think this is a mistake, contact them.` }).catch(() => null);
  return { error: null, removed: { user_id: a.user_id, role_key: a.role_key, entity_id: a.entity_id } };
}

/** Changes what a role allows. Admin always has everything; you can only add permissions you hold for the whole group. */
export async function setRolePermissions(svc: Svc, me: Access, role: RoleRow, perms: string[]) {
  if (!me.can('users.do', null)) return 'Only people allowed to manage users can change roles.';
  if (role.key === 'admin') return 'Admin always has every permission.';
  const added = perms.filter((p) => !role.permissions.includes(p));
  const missing = beyondMe(me, added, null);
  if (missing.length) return `You can’t add permissions you don’t have yourself: ${missing.join(', ')}.`;
  await svc.from('role_permissions').delete().eq('role_key', role.key);
  if (perms.length) await svc.from('role_permissions').insert(perms.map((permission) => ({ role_key: role.key, permission }))).throwOnError();
  return null;
}
