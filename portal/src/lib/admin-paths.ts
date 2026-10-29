// The admin's addresses follow its menu (Admin.astro): Board & governance lives at /admin/board/…, a company's
// legal record at /admin/companies/<code>/legal. The pages themselves stay where they were built; the
// middleware maps each address shown to its page (and checks access on that page, as before), and sends
// browsers from an old address to the new one. Used on the server and in the menu.

/** [address shown, page], most specific first. A prefix covers everything under it. */
const PREFIXES: [string, string][] = [
  ['/admin/board/meetings', '/admin/legal/meetings'],
  ['/admin/board/papers', '/admin/legal/papers'],
  ['/admin/board/minute-book', '/admin/legal/minute-book'],
  ['/admin/board/deadlines', '/admin/legal/calendar'],
  ['/admin/board/shareholder-meetings', '/admin/agm'],
  ['/admin/board/ask', '/admin/board-ask'],
  ['/admin/board', '/admin/boardroom'],
];
const COMPANY_LEGAL = { shown: /^\/admin\/companies\/([^/]+)\/legal$/, page: /^\/admin\/legal\/companies\/([^/]+)$/ };

const under = (path: string, p: string) => path === p || path.startsWith(`${p}/`);

/** The page behind an address (the address itself when it isn't an alias). */
export function toPage(path: string) {
  const company = COMPANY_LEGAL.shown.exec(path);
  if (company) return `/admin/legal/companies/${company[1]}`;
  for (const [shown, page] of PREFIXES) if (under(path, shown)) return page + path.slice(shown.length);
  return path;
}

/** The address to show for a page (the page's own when it has no alias). */
export function toShown(path: string) {
  const company = COMPANY_LEGAL.page.exec(path);
  if (company) return `/admin/companies/${company[1]}/legal`;
  for (const [shown, page] of [...PREFIXES].sort((a, b) => b[1].length - a[1].length)) if (under(path, page)) return shown + path.slice(page.length);
  return path;
}

/** Old addresses that now open elsewhere (no alias: the page moved into another). */
export const MOVED: Record<string, string> = {
  '/admin/legal/companies': '/admin/companies',
};
