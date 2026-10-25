// Roles and permissions (System → Users, System → Roles).
//
// A permission is an area of the admin and a level: "see" (view), "do" (make
// and change things) or "approve" (sign off where an item asks for it), e.g.
// "press.approve". The areas are fixed here, because the portal must know what
// each one protects; which role has which permission is a setting (role
// permissions in the database), with these defaults for the built-in roles.
// A person can have several roles, each for the whole group or for one
// company, optionally until a date. Investor isn't a role here: it follows the
// share register (holder memberships).

export type Level = 'view' | 'do' | 'approve';
export type Area = { key: string; label: string; description: string; levels: Level[]; menu: string[]; groupOnly?: boolean };

export const AREAS: Area[] = [
  { key: 'investors', label: 'Investors and the register', description: 'Investors, companies and share classes, holders and holdings, boards, engagement, data import.', levels: ['view', 'do'], menu: ['/admin/investors', '/admin/holdings', '/admin/holders', '/admin/companies', '/admin/engagement', '/admin/import'] },
  { key: 'documents', label: 'Documents and data rooms', description: 'Documents for investors and the board, data rooms.', levels: ['view', 'do', 'approve'], menu: ['/admin/documents', '/admin/data-rooms'] },
  { key: 'news', label: 'News, announcements and LinkedIn', description: 'News posts (portal and website), dashboard announcements, the LinkedIn campaign.', levels: ['view', 'do', 'approve'], menu: ['/admin/news', '/admin/content', '/admin/linkedin'] },
  { key: 'press', label: 'Press releases and media', description: 'Press releases, the media database, distribution, coverage and reports.', levels: ['view', 'do', 'approve'], menu: ['/admin/press'], groupOnly: true },
  { key: 'newsletters', label: 'Newsletters', description: 'Shareholder and public newsletters, templates, subscribers.', levels: ['view', 'do', 'approve'], menu: ['/admin/newsletters'] },
  { key: 'inbox', label: 'Shareholder emails and Board Q&A', description: 'The shareholder mailboxes, Board Q&A, notifications.', levels: ['view', 'do'], menu: ['/admin/emails', '/admin/queries', '/admin/notifications'] },
  { key: 'ask', label: 'Ask Lakeba', description: 'Answers to review, the knowledge Ask uses, its tests.', levels: ['view', 'do'], menu: ['/admin/ask-review', '/admin/ask-knowledge', '/admin/ask-tests'] },
  { key: 'meetings', label: 'Meetings', description: 'Meetings, AGMs, proxy voting and questions.', levels: ['view', 'do', 'approve'], menu: ['/admin/agm'] },
  { key: 'capital', label: 'Ventures, prices and trading', description: 'Ventures and reference prices, the secondary trading board.', levels: ['view', 'do', 'approve'], menu: ['/admin/ventures', '/admin/trading'] },
  { key: 'audit', label: 'Audit log', description: 'Who did what, when. “Do” allows deleting entries.', levels: ['view', 'do'], menu: ['/admin/audit'], groupOnly: true },
  { key: 'users', label: 'Users and roles', description: 'Giving and taking roles, custom roles and their permissions.', levels: ['view', 'do'], menu: ['/admin/system'], groupOnly: true },
];

export const LEVEL_LABEL: Record<Level, string> = { view: 'See', do: 'Do', approve: 'Approve' };
export const ALL_PERMISSIONS = AREAS.flatMap((a) => a.levels.map((l) => `${a.key}.${l}`));

/** Built-in roles and their starting permissions (changeable in System → Roles, except Admin, which has everything). */
const P = (spec: Record<string, string>) => Object.entries(spec).flatMap(([area, levels]) => levels.split('').map((c) => `${area}.${({ v: 'view', d: 'do', a: 'approve' } as Record<string, string>)[c]}`));
export const BUILT_IN_ROLES: { key: string; name: string; description: string; permissions: string[] }[] = [
  { key: 'admin', name: 'Admin', description: 'Runs the portal: everything, including users and roles. For one company: everything about that company.', permissions: ALL_PERMISSIONS },
  { key: 'board', name: 'Board', description: 'Board members: see the register, documents, meetings and ventures; answer Board Q&A.', permissions: P({ investors: 'v', documents: 'v', inbox: 'vd', meetings: 'vd', capital: 'v' }) },
  { key: 'marketing', name: 'Marketing', description: 'Prepares news, press releases, newsletters and the LinkedIn campaign; approvers publish.', permissions: P({ news: 'vd', press: 'vd', newsletters: 'vd' }) },
  { key: 'legal', name: 'Legal', description: 'Reviews and approves documents, press releases and meeting materials; sees the register and the audit log.', permissions: P({ investors: 'v', documents: 'va', news: 'v', press: 'va', inbox: 'v', ask: 'v', meetings: 'va', capital: 'v', audit: 'v' }) },
  { key: 'compliance', name: 'Compliance', description: 'Approves newsletters and secondary trades; sees the register, communications and the audit log.', permissions: P({ investors: 'v', documents: 'v', press: 'v', newsletters: 'va', inbox: 'v', ask: 'v', meetings: 'v', capital: 'va', audit: 'v', users: 'v' }) },
];

/** Does this set of permissions allow it? "do" and "approve" include "view". */
export const allows = (perms: Set<string>, perm: string) => perms.has(perm);

/** Normalises a chosen set: "do" or "approve" brings "view" with it; unknown permissions are dropped. */
export function normalise(perms: string[]) {
  const out = new Set(perms.filter((p) => ALL_PERMISSIONS.includes(p)));
  for (const p of [...out]) if (!p.endsWith('.view')) out.add(p.replace(/\.(do|approve)$/, '.view'));
  return [...out].filter((p) => ALL_PERMISSIONS.includes(p)).sort();
}

/** The area an admin path belongs to (null for the overview and pages every staff member may open). */
export function areaOf(path: string) {
  const hit = AREAS.flatMap((a) => a.menu.map((m) => ({ a, m }))).filter(({ m }) => path === m || path.startsWith(`${m}/`)).sort((x, y) => y.m.length - x.m.length)[0];
  return hit?.a ?? null;
}
