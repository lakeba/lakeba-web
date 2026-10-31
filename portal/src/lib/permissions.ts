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
  { key: 'press', label: 'Press releases and media', description: 'Press releases, the media database, distribution, coverage and reports.', levels: ['view', 'do', 'approve'], menu: ['/admin/press'] },
  { key: 'newsletters', label: 'Newsletters', description: 'Shareholder and public newsletters, templates, subscribers.', levels: ['view', 'do', 'approve'], menu: ['/admin/newsletters'] },
  { key: 'inbox', label: 'Shareholder emails and Board Q&A', description: 'The shareholder mailboxes, Board Q&A, notifications.', levels: ['view', 'do'], menu: ['/admin/emails', '/admin/queries', '/admin/notifications'] },
  { key: 'ask', label: 'Ask Lakeba', description: 'Answers to review, the knowledge Ask uses, its tests.', levels: ['view', 'do'], menu: ['/admin/ask-review', '/admin/ask-knowledge', '/admin/ask-tests'] },
  { key: 'meetings', label: 'Meetings', description: 'Meetings, AGMs, proxy voting and questions.', levels: ['view', 'do', 'approve'], menu: ['/admin/agm'] },
  { key: 'legal', label: 'Legal and company secretary', description: 'Company records, officers registers and the deadlines calendar. Lakeba only for now.', levels: ['view', 'do', 'approve'], menu: ['/admin/legal'], groupOnly: true },
  { key: 'reporting', label: 'Reporting packs', description: 'Sending a company’s profit and loss and balance sheet to Lakeba, and answering its questions.', levels: ['view', 'do'], menu: ['/admin/reporting'] },
  { key: 'accounting', label: 'Accounting (Lakeba)', description: 'Reporting schedules, reviewing the ventures’ packs, the group view, sales commissions (do or approve only: "see" doesn’t show what reps earn; approve: approving commission runs). Lakeba only.', levels: ['view', 'do', 'approve'], menu: ['/admin/accounting'], groupOnly: true },
  { key: 'boardroom', label: 'Boardroom', description: 'Board meetings with the Observer, Lex and the decks it presents, and their minutes. For one company: that company’s board only, without the rest of Legal.', levels: ['view', 'do'], menu: ['/admin/boardroom'] },
  { key: 'boardask', label: 'Board Ask', description: 'Directors’ questions answered by Lakeba AI from the portal, Xero and the law, with sources. “Do” looks after the law library and the test set.', levels: ['view', 'do'], menu: ['/admin/board-ask'] },
  { key: 'hr', label: 'HR', description: 'People, onboarding and leaving, equity plans and grants, policies, employee documents.', levels: ['view', 'do', 'approve'], menu: ['/admin/hr'] },
  { key: 'crm', label: 'CRM and sales', description: 'A company’s CRM: people, companies, deals, pipelines, tasks and quotes. “Approve”: every deal of the company, discounts and quotes over the limit.', levels: ['view', 'do', 'approve'], menu: ['/admin/crm'] },
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
  { key: 'board', name: 'Board', description: 'Board members: see the register, documents, meetings and ventures; answer Board Q&A.', permissions: P({ investors: 'v', documents: 'v', inbox: 'vd', meetings: 'vd', accounting: 'v', boardask: 'v', capital: 'v' }) },
  { key: 'marketing', name: 'Marketing', description: 'Prepares news, press releases, newsletters and the LinkedIn campaign; approvers publish.', permissions: P({ news: 'vd', press: 'vd', newsletters: 'vd' }) },
  { key: 'legal', name: 'Legal', description: 'Company secretary work (company records, officers, deadlines); reviews and approves documents, press releases and meeting materials; sees the register and the audit log.', permissions: P({ investors: 'v', documents: 'va', news: 'v', press: 'va', inbox: 'v', ask: 'v', meetings: 'va', legal: 'vda', boardroom: 'vd', boardask: 'vd', capital: 'v', audit: 'v' }) },
  { key: 'finance', name: 'Finance', description: 'Does a company’s books: sends its reporting packs (profit and loss, balance sheet) and answers Lakeba’s questions about them.', permissions: P({ reporting: 'vd' }) },
  { key: 'secretary', name: 'Company secretary', description: 'A company’s board meetings: the Observer, Lex and the decks it presents, the minutes and their signing. Given for one company.', permissions: P({ boardroom: 'vd', boardask: 'v' }) },
  { key: 'hr', name: 'HR', description: 'Looks after a company’s people: employees, onboarding and leaving, equity grants, policies and employee documents.', permissions: P({ hr: 'vda' }) },
  { key: 'sales', name: 'Sales', description: 'Sells for a company: its CRM, their own deals and the team’s pipeline, quotes and follow-ups.', permissions: P({ crm: 'vd' }) },
  { key: 'sales_lead', name: 'Sales lead', description: 'Leads a company’s sales: every deal, the forecast, approving discounts and quotes.', permissions: P({ crm: 'vda' }) },
  { key: 'compliance', name: 'Compliance', description: 'Approves newsletters and secondary trades; sees the register, communications and the audit log.', permissions: P({ investors: 'v', documents: 'v', press: 'v', newsletters: 'va', inbox: 'v', ask: 'v', meetings: 'v', legal: 'v', accounting: 'v', boardask: 'v', capital: 'va', audit: 'v', users: 'v' }) },
];

/** What a set of permissions allows, in words, made from the areas (so it stays right when areas change). */
export function summarise(perms: string[]) {
  if (ALL_PERMISSIONS.every((p) => perms.includes(p))) return 'Everything.';
  const at = (level: Level) => AREAS.filter((a) => perms.includes(`${a.key}.${level}`) && (level !== 'view' || !perms.includes(`${a.key}.do`))).map((a) => a.label.toLowerCase());
  const parts = [['Sees', at('view')], ['Works on', at('do')], ['Approves', at('approve')]] as const;
  return parts.filter(([, list]) => list.length).map(([verb, list]) => `${verb} ${list.join(', ')}.`).join(' ') || 'Nothing yet.';
}

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
