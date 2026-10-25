/**
 * Who may work on news (area "news") or newsletters (area "newsletters"), from
 * their roles, after two-step. null when they lack `need` anywhere. group: may
 * act for the whole group (public news, the public newsletter); mayEdit: may
 * change this company's items ("do"); maySee: may look at them ("view").
 */
export function newsEditor(locals: App.Locals, area: 'news' | 'newsletters' = 'news', need: 'view' | 'do' = 'do') {
  const a = locals.access;
  if (!locals.user || locals.user.aal !== 'aal2' || !a.canAny(`${area}.${need}`)) return null;
  const doing = a.companies(`${area}.do`);
  const seeing = a.companies(`${area}.view`);
  const group = doing === 'all';
  return {
    group,
    seesGroup: seeing === 'all',
    entityIds: doing === 'all' ? [] : doing,
    mayEdit: (entityId: string) => doing === 'all' || doing.includes(entityId),
    maySee: (entityId: string) => seeing === 'all' || seeing.includes(entityId),
  };
}
