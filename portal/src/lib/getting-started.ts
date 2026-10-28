import type { Access } from './access';
import { mayOpenItem } from './access';
import { serviceClient } from './admin';
import { isCompanyAdmin } from './integrations/admin';

type Svc = ReturnType<typeof serviceClient>;

/**
 * "Getting started" on Admin → Overview: what is left to run a venture's portal, from the portal's own data (each
 * step ticks itself; nobody marks it done). A venture's Admins get the whole list for their venture, its editors
 * their part (documents and news), Lakeba's group Admins one line per venture being set up.
 */
export type Step = { key: string; done: boolean; title: string; detail: string; href: string; action: string; optional?: boolean };
export type Card = { company: { id: string; code: string; name: string }; role: 'admin' | 'editor'; steps: Step[] };
export type VentureLine = { code: string; name: string; done: number; of: number; left: string };

type Venture = { id: string; code: string; display_name: string; legal_name: string | null; company_number: string | null; brand_color: string | null; logo_url: string | null; portal: string; relationship: string; shareholder_mailbox: string | null; custom_domain: string | null; custom_domain_verified_at: string | null };
const VENTURE = 'id, code, display_name, legal_name, company_number, brand_color, logo_url, portal, relationship, shareholder_mailbox, custom_domain, custom_domain_verified_at';

/** The figures the steps are made from, for one venture. */
async function factsOf(svc: Svc, c: Venture) {
  const now = new Date().toISOString();
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [{ data: classes }, { data: roles }, documents, published, news, newsKeys, subscribers, apiKeys, hooks, connections] = await Promise.all([
    svc.from('share_classes').select('id, official_on_issue').eq('entity_id', c.id),
    svc.from('user_roles').select('user_id, role_key').eq('entity_id', c.id).or(`expires_at.is.null,expires_at.gt.${now}`),
    count(svc.from('documents').select('id', { count: 'exact', head: true }).eq('entity_id', c.id)),
    count(svc.from('documents').select('id', { count: 'exact', head: true }).eq('entity_id', c.id).lte('published_at', now)),
    count(svc.from('posts').select('id', { count: 'exact', head: true }).eq('entity_id', c.id).lte('published_at', now)),
    count(svc.from('news_api_keys').select('id', { count: 'exact', head: true }).eq('entity_id', c.id).is('revoked_at', null)),
    count(svc.from('newsletter_subscribers').select('id', { count: 'exact', head: true }).eq('entity_id', c.id)),
    count(svc.from('api_keys').select('id', { count: 'exact', head: true }).eq('entity_id', c.id).is('revoked_at', null)),
    count(svc.from('webhook_endpoints').select('id', { count: 'exact', head: true }).eq('entity_id', c.id)),
    count(svc.from('connections').select('id', { count: 'exact', head: true }).eq('entity_id', c.id).eq('status', 'connected')),
  ]);
  const classIds = (classes ?? []).map((x) => x.id);
  const { data: holdingRows } = classIds.length ? await svc.from('holdings').select('holder_id').in('share_class_id', classIds).range(0, 99999) : { data: [] };
  const holderIds = [...new Set((holdingRows ?? []).map((h) => h.holder_id as string))];
  const investors = holderIds.length ? await count(svc.from('holder_members').select('user_id', { count: 'exact', head: true }).in('holder_id', holderIds.slice(0, 1000))) : 0;
  const people = new Set((roles ?? []).map((r) => r.user_id)).size;
  const admins = new Set((roles ?? []).filter((r) => r.role_key === 'admin').map((r) => r.user_id)).size;
  return { classes: classes ?? [], holders: holderIds.length, investors, people, admins, documents, published, news, newsKeys, subscribers, integrations: apiKeys + hooks + connections };
}

const SHORT: Record<string, string> = { details: 'details', brand: 'brand', documents: 'documents', register: 'register', classes: 'share classes', investors: 'investors', team: 'team' };
const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function adminSteps(c: Venture, f: Awaited<ReturnType<typeof factsOf>>): Step[] {
  const page = `/admin/companies/${c.code}`;
  const counted = f.classes.length > 0 && f.classes.every((k) => k.official_on_issue != null);
  return [
    { key: 'details', done: Boolean(c.legal_name && c.company_number), title: 'Company details', detail: c.legal_name && c.company_number ? `${c.legal_name} · ACN ${c.company_number}.` : 'Legal name and company number, for statements and emails.', href: page, action: 'Edit' },
    { key: 'brand', done: Boolean(c.brand_color || c.logo_url), title: 'Brand', detail: c.logo_url || c.brand_color ? `${[c.logo_url && 'Logo', c.brand_color && 'colour'].filter(Boolean).join(' and ')} set; they show on the sign-in page and in emails.` : `Logo and colour, shown on ${c.display_name}’s sign-in page and in emails.`, href: page, action: 'Brand' },
    { key: 'documents', done: f.documents > 0, title: 'Upload your documents', detail: f.documents ? `${plural(f.documents, 'document')} in the portal.` : 'Constitution, reports and certificates, for investors and for Ask.', href: `/admin/documents?company=${c.code}`, action: 'Documents' },
    { key: 'register', done: f.holders > 0, title: 'Import the share register', detail: f.holders ? `${plural(f.holders, 'holder')} in ${plural(f.classes.length, 'share class', 'share classes')}.` : 'Upload the register of members (PDF) or the investor data workbook; you check it before it’s saved.', href: '/admin/import', action: 'Import' },
    { key: 'classes', done: counted, title: 'Check share classes', detail: counted ? 'Every class has its official shares on issue.' : 'Classes and official shares on issue, so ownership percentages are right.', href: page, action: 'Share classes' },
    { key: 'investors', done: f.investors > 0, title: 'Invite your investors', detail: f.investors ? `${plural(f.investors, 'investor account')} linked to holders.` : 'Once the register is in: welcome emails with a sign-in link.', href: `/admin/investors?company=${c.code}`, action: 'Investors' },
    { key: 'team', done: f.people > 1, title: 'Your team', detail: f.people > 1 ? `${plural(f.people, 'person', 'people')} with a role, ${plural(f.admins, 'admin')}.` : 'Add whoever answers questions or posts news.', href: '/admin/system/users', action: 'Users' },
    { key: 'mail', done: Boolean(c.shareholder_mailbox), optional: true, title: 'Shareholder mail', detail: c.shareholder_mailbox ? `Shareholder emails arrive at ${c.shareholder_mailbox}.` : `Link ${c.display_name}’s Microsoft 365 or Google Workspace mailbox (Lakeba’s is used until then).`, href: `${page}/domain`, action: 'Domain and mail' },
    { key: 'domain', done: Boolean(c.custom_domain_verified_at), optional: true, title: 'Your own web address', detail: c.custom_domain_verified_at ? `${c.custom_domain}.` : c.custom_domain ? `${c.custom_domain} is waiting for its DNS record.` : 'Your own address for the portal instead of Lakeba’s.', href: `${page}/domain`, action: 'Domain and mail' },
    { key: 'integrations', done: f.integrations > 0, optional: true, title: 'Integrations', detail: f.integrations ? 'In use.' : 'API keys, webhooks, HubSpot or Xero.', href: `${page}/integrations`, action: 'Integrations' },
  ];
}

function editorSteps(c: Venture, f: Awaited<ReturnType<typeof factsOf>>, access: Access): Step[] {
  const steps: Step[] = [];
  if (access.can('documents.do', c.id)) steps.push({ key: 'document', done: f.published > 0, title: 'Publish a first document', detail: f.published ? `${plural(f.published, 'document')} published.` : 'A report or update for investors.', href: `/admin/documents?company=${c.code}`, action: 'Documents' });
  if (access.can('news.do', c.id)) {
    steps.push({ key: 'news', done: f.news > 0, title: 'Post your first news', detail: f.news ? `${plural(f.news, 'post')} published.` : 'An update for shareholders; you choose who sees it.', href: `/admin/news?company=${c.code}`, action: 'News' });
    steps.push({ key: 'website', done: f.newsKeys > 0, optional: true, title: `News on ${c.display_name}’s website`, detail: f.newsKeys ? 'The website shows its news.' : 'Show public news on its own site with one line of code.', href: `/admin/companies/${c.code}/website`, action: 'Website news' });
    steps.push({ key: 'newsletter', done: f.subscribers > 0, optional: true, title: 'Newsletter sign-up', detail: f.subscribers ? `${plural(f.subscribers, 'subscriber')}.` : 'A sign-up form for the public newsletter.', href: `/admin/newsletters?company=${c.code}`, action: 'Newsletters' });
  }
  return steps;
}

/** Shown while a required step is left (optional ones don't keep the card up). */
export const unfinished = (steps: Step[]) => steps.some((s) => !s.done && !s.optional);

/** The cards for this person: one per venture they run (Admins) or write for (editors). Not for group Admins. */
export async function gettingStarted(svc: Svc, access: Access): Promise<Card[]> {
  if (access.groupAdmin) return [];
  const ids = [...new Set(access.roles.map((r) => r.entity_id).filter(Boolean) as string[])];
  if (!ids.length) return [];
  const { data } = await svc.from('entities').select(VENTURE).in('id', ids).neq('relationship', 'group').order('sort');
  const cards: Card[] = [];
  for (const c of (data ?? []) as Venture[]) {
    const admin = isCompanyAdmin(access, c.id);
    if (!admin && !access.can('documents.do', c.id) && !access.can('news.do', c.id)) continue;
    const f = await factsOf(svc, c);
    const steps = (admin ? adminSteps(c, f) : editorSteps(c, f, access)).filter((s) => mayOpenItem(access, s.href.split('?')[0]));
    if (unfinished(steps)) cards.push({ company: { id: c.id, code: c.code, name: c.display_name }, role: admin ? 'admin' : 'editor', steps });
  }
  return cards;
}

/** For group Admins: each venture with its own portal, and where its set-up stands. */
export async function venturesGettingStarted(svc: Svc): Promise<VentureLine[]> {
  const { data } = await svc.from('entities').select(VENTURE).eq('portal', 'full').neq('relationship', 'group').order('sort');
  return Promise.all(((data ?? []) as Venture[]).map(async (c) => {
    const required = adminSteps(c, await factsOf(svc, c)).filter((s) => !s.optional);
    const left = required.filter((s) => !s.done);
    return { code: c.code, name: c.display_name, done: required.length - left.length, of: required.length, left: left.length ? sentence(left.map((s) => SHORT[s.key] ?? s.key).join(', ')) : 'All done' };
  }));
}
