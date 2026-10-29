import type { Access } from '../access';
import { AREAS } from '../permissions';

// What a company API key may do. Scopes are named like the admin permissions
// ("investors.view", "documents.do"…), plus "people.read" for personal data
// (names, emails, phones, addresses), which is never implied by anything else.
// The audit log and users stay with the portal itself.

export type Scope = { key: string; label: string; area: string };

const API_AREAS = ['investors', 'documents', 'news', 'newsletters', 'inbox', 'meetings', 'legal', 'reporting', 'boardroom', 'hr', 'capital'];
export const API_SCOPES: Scope[] = [
  ...AREAS.filter((a) => API_AREAS.includes(a.key)).flatMap((a) => a.levels.filter((l) => l !== 'approve').map((l) => ({
    key: `${a.key}.${l}`, area: a.label, label: l === 'view' ? `Read: ${a.label.toLowerCase()}` : `Change: ${a.label.toLowerCase()}`,
  }))),
  { key: 'people.read', area: 'Personal data', label: 'Read personal data: names, emails, phones and addresses of investors, guests, subscribers, officers and employees' },
];
export const SCOPE_KEYS = API_SCOPES.map((s) => s.key);

/** The scopes this admin may put on a key for this company: never more than they hold themselves. */
export function grantable(access: Access, entityId: string) {
  return SCOPE_KEYS.filter((s) => (s === 'people.read' ? access.can('investors.view', entityId) : access.can(s, entityId)));
}

/** "do" brings "view" with it; unknown scopes are dropped. */
export function normaliseScopes(scopes: string[]) {
  const out = new Set(scopes.filter((s) => SCOPE_KEYS.includes(s)));
  for (const s of [...out]) if (s.endsWith('.do')) out.add(s.replace(/\.do$/, '.view'));
  return [...out].filter((s) => SCOPE_KEYS.includes(s)).sort();
}
