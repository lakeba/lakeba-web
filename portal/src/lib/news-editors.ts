/** Who may write news: group admins, and company admins (for their companies), after two-step. */
export function newsEditor(locals: App.Locals) {
  if (!locals.user || locals.user.aal !== 'aal2') return null;
  const group = locals.profile?.role === 'admin';
  if (!group && !locals.adminOf.length) return null;
  return { group, entityIds: locals.adminOf, mayEdit: (entityId: string) => group || locals.adminOf.includes(entityId) };
}
