import type { Access } from './access';

// Staff guides (docs/guides/README.md): one PDF per department, built from docs/guides/<key>.md into
// templates/guides/<key>.pdf and offered at the end of that department's menu (/admin/guides/<key>.pdf).
// Whoever can open the department's pages may download its guide. `covers`: the pages it describes; check:portal
// warns when they change after the guide did, so the guide is kept up to date (AGENTS.md).
export type Guide = { key: string; title: string; file: string; covers: string[]; mayRead: (a: Access) => boolean };

export const GUIDES: Guide[] = [
  { key: 'hr', title: 'HR guide', file: 'Lakeba Portal - HR guide.pdf', covers: ['src/pages/admin/hr', 'src/pages/my-hr'], mayRead: (a) => a.canAny('hr.view') },
  { key: 'finance', title: 'Finance guide', file: 'Lakeba Portal - Finance guide.pdf', covers: ['src/pages/admin/accounting', 'src/pages/admin/reporting'], mayRead: (a) => a.can('accounting.view', null) || a.canAny('reporting.view') },
  { key: 'legal', title: 'Legal guide', file: 'Lakeba Portal - Legal guide.pdf', covers: ['src/pages/admin/legal', 'src/pages/admin/legal-requests'], mayRead: (a) => a.can('legal.view', null) },
  { key: 'compliance', title: 'Compliance and admin guide', file: 'Lakeba Portal - Compliance and admin guide.pdf', covers: ['src/pages/admin/approvals', 'src/pages/admin/audit.astro', 'src/pages/admin/system', 'src/pages/admin/investors', 'src/pages/admin/holders', 'src/pages/admin/companies', 'src/pages/admin/ask-review.astro'], mayRead: (a) => a.can('audit.view', null) || a.can('users.view', null) },
  { key: 'sales', title: 'Sales guide', file: 'Lakeba Portal - Sales guide.pdf', covers: ['src/pages/admin/crm', 'src/pages/deal'], mayRead: (a) => a.canAny('crm.view') || a.canAny('leadgen.view') },
  { key: 'marketing', title: 'Marketing and press guide', file: 'Lakeba Portal - Marketing and press guide.pdf', covers: ['src/pages/admin/news', 'src/pages/admin/content.astro', 'src/pages/admin/newsletters', 'src/pages/admin/press'], mayRead: (a) => ['news', 'press', 'newsletters'].some((area) => a.canAny(`${area}.view`)) },
];

/** The guide a /admin/guides/<key>.pdf address names, if any. */
export const guideAt = (path: string) => GUIDES.find((g) => path === `/admin/guides/${g.key}.pdf`);
