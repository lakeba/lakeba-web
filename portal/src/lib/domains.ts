import { promises as dns } from 'node:dns';
import { readFileSync } from 'node:fs';
import { DNS_TEST_FILE, DNS_TEST_RECORDS, PORTAL_DOMAIN, PORTAL_SERVER_IP } from 'astro:env/server';
import { inLakebaMicrosoft } from './graph';

/*
 * DNS for a venture's set-up. Its own domain (investors.mist.com) is used once
 * its DNS points to the portal: a CNAME to the portal's domain
 * (investors.lakeba.com), or an A record with its address. When it doesn't, the check
 * says why in plain words. The same lookups tell who runs the venture's email
 * (Microsoft 365, Google or another) and where its DNS is managed (GoDaddy,
 * Cloudflare…), so the set-up page shows only the steps that apply.
 */
const strip = (s: string) => s.toLowerCase().replace(/\.$/, '');
type Kind = 'cname' | 'a' | 'mx' | 'ns' | 'txt';

/** One DNS lookup; nothing found (or an error) is an empty list. DNS_TEST_FILE stands in for DNS in tests. */
async function lookup(kind: Kind, name: string): Promise<string[]> {
  name = strip(name);
  if (DNS_TEST_FILE) {
    const all = JSON.parse(readFileSync(DNS_TEST_FILE, 'utf8')) as Partial<Record<Kind, Record<string, string[]>>>;
    return (all[kind]?.[name] ?? []).map((v) => (kind === 'txt' ? v : strip(v)));
  }
  try {
    switch (kind) {
      case 'cname': return (await dns.resolveCname(name)).map(strip);
      case 'a': return await dns.resolve4(name);
      case 'mx': return (await dns.resolveMx(name)).sort((x, y) => x.priority - y.priority).map((m) => strip(m.exchange));
      case 'ns': return (await dns.resolveNs(name)).map(strip);
      case 'txt': return (await dns.resolveTxt(name)).map((parts) => parts.join(''));
    }
  } catch {
    return [];
  }
}

/** The zone a name belongs to (mist.com for investors.mist.com): the nearest name with its own name servers. */
async function zoneOf(name: string) {
  const labels = strip(name).split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    const ns = await lookup('ns', candidate);
    if (ns.length) return { zone: candidate, ns };
  }
  return null;
}

export type DnsHost = { name: string; where?: string; url?: string; note?: string };
// Where a domain's DNS is managed, by its name servers. `where`: the way to its DNS records, for the best-known ones.
const DNS_HOSTS: (DnsHost & { match: RegExp })[] = [
  { match: /domaincontrol\.com$/, name: 'GoDaddy', url: 'https://dcc.godaddy.com/control/portfolio', where: 'My Products → the domain → DNS → Add New Record' },
  { match: /ns\.cloudflare\.com$/, name: 'Cloudflare', url: 'https://dash.cloudflare.com', where: 'the domain → DNS → Records → Add record', note: 'Set Proxy status to DNS only (a grey cloud, not orange). With the orange cloud the portal can’t be reached at that address.' },
  { match: /registrar-servers\.com$/, name: 'Namecheap', url: 'https://ap.www.namecheap.com/domains/list/', where: 'Domain List → Manage → Advanced DNS → Add New Record' },
  { match: /awsdns/, name: 'Amazon Route 53', url: 'https://console.aws.amazon.com/route53/v2/hostedzones', where: 'Hosted zones → the domain → Create record' },
  { match: /azure-dns\./, name: 'Azure DNS', url: 'https://portal.azure.com', where: 'DNS zones → the domain → + Record set' },
  { match: /wixdns\.net$/, name: 'Wix', url: 'https://manage.wix.com/account/domains', where: 'Domains → ⋯ next to the domain → Manage DNS records → CNAME → + Add record' },
  { match: /googledomains\.com$|squarespacedns|squarespace\.com$/, name: 'Squarespace Domains', url: 'https://account.squarespace.com/domains', where: 'the domain → DNS → Custom records → Add record' },
  { match: /nameserver\.net\.au$/, name: 'VentraIP' },
  { match: /crazydomains\.com/, name: 'Crazy Domains' },
  { match: /netregistry\.net$/, name: 'Netregistry' },
  { match: /melbourneit|mitdns/, name: 'Melbourne IT' },
  { match: /hover\.com$/, name: 'Hover' },
  { match: /digitalocean\.com$/, name: 'DigitalOcean' },
  { match: /ui-dns\.|ionos/, name: 'IONOS' },
  { match: /dnsimple/, name: 'DNSimple' },
  { match: /nsone\.net$/, name: 'NS1' },
  { match: /vultr\.com$/, name: 'Vultr' },
];
const hostOf = (ns: string[]): DnsHost | null => {
  const hit = DNS_HOSTS.find((h) => ns.some((n) => h.match.test(n)));
  return hit ? { name: hit.name, where: hit.where, url: hit.url, note: hit.note } : null;
};

export type MailProvider = 'microsoft' | 'google' | 'other' | 'none';
export type Detected = {
  emailDomain: string | null;
  mail: MailProvider;
  /** The mail servers' name, for "other" (e.g. a filter like Mimecast in front). */
  mailHost: string | null;
  /** Where the email domain's DNS is managed. */
  dns: (DnsHost & { zone: string }) | null;
  /** Its Microsoft 365 is Lakeba's own (e.g. a controlled venture's domain added there). */
  lakebaMicrosoft: boolean;
};

const FREE_MAIL = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|bigpond|proton|protonmail)\.(com|com\.au|net|me)$|^lakeba\.com$/;
const domainOf = (s: string | null) => {
  if (!s) return null;
  const d = (s.includes('@') ? s.split('@')[1] : s.replace(/^https?:\/\//, '').replace(/[/:?#].*$/, '')).toLowerCase().replace(/^www\./, '');
  return d && d.includes('.') && !FREE_MAIL.test(d) ? d : null;
};

const detected = new Map<string, { at: number; value: Detected }>();
/**
 * Who runs a venture's email, and where its DNS is managed. The email domain
 * comes from its sending address, shareholder mailbox, contact address or website.
 */
export async function detect(c: { mail_from?: string | null; shareholder_mailbox?: string | null; contact_email?: string | null; reply_to?: string | null; website?: string | null; custom_domain?: string | null }): Promise<Detected> {
  const custom = c.custom_domain ? (await zoneOf(c.custom_domain))?.zone ?? null : null;
  const candidates = [...new Set([c.mail_from, c.shareholder_mailbox, c.contact_email, c.reply_to, c.website].map(domainOf).concat(custom).filter(Boolean) as string[])];
  if (!candidates.length) return { emailDomain: null, mail: 'none', mailHost: null, dns: null, lakebaMicrosoft: false };
  const key = candidates.join(',');
  const hit = detected.get(key);
  if (hit && Date.now() - hit.at < 600_000) return hit.value;
  // The first of them that receives email.
  let emailDomain = candidates[0];
  let mx: string[] = [];
  for (const d of candidates) {
    const found = await lookup('mx', d);
    if (found.length) { emailDomain = d; mx = found; break; }
  }
  const [txt, zone] = await Promise.all([lookup('txt', emailDomain), zoneOf(emailDomain)]);
  const spf = txt.find((t) => /^v=spf1/i.test(t)) ?? '';
  let mail: MailProvider = 'none';
  if (mx.some((m) => /\.mail\.protection\.outlook\.com$|\.outlook\.com$/.test(m))) mail = 'microsoft';
  else if (mx.some((m) => /(^|\.)google(mail)?\.com$/.test(m))) mail = 'google';
  // A filter (Mimecast, Proofpoint…) in front of the mail: who sends tells.
  else if (mx.length) mail = /include:spf\.protection\.outlook\.com/i.test(spf) ? 'microsoft' : /include:_spf\.google\.com/i.test(spf) ? 'google' : 'other';
  const host = zone ? hostOf(zone.ns) : null;
  const value: Detected = {
    emailDomain, mail, mailHost: mx[0] ?? null, lakebaMicrosoft: mail === 'microsoft' && (await inLakebaMicrosoft(emailDomain)),
    dns: zone ? { zone: zone.zone, ...(host ?? { name: zone.ns[0]?.split('.').slice(-2).join('.') ?? 'its DNS provider' }) } : null,
  };
  detected.set(key, { at: Date.now(), value });
  return value;
}
export const forgetDetected = () => detected.clear();

/** Where a record goes: the zone, its DNS host and the short name to type in the "Name" (or "Host") box. */
export async function placeOf(domainName: string) {
  const z = await zoneOf(domainName);
  const name = strip(domainName);
  return {
    zone: z?.zone ?? null,
    host: z ? hostOf(z.ns) ?? { name: z.ns[0]?.split('.').slice(-2).join('.') ?? 'its DNS provider' } : null,
    label: z && name !== z.zone ? name.slice(0, -(z.zone.length + 1)) : name === z?.zone ? '@' : name,
  };
}

// Cloudflare's addresses: an orange-cloud ("proxied") record shows these instead of the portal's.
const CLOUDFLARE = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
const ip = (a: string) => a.split('.').reduce((n, p) => n * 256 + Number(p), 0);
const inCloudflare = (a: string) => CLOUDFLARE.some((r) => { const [base, bits] = r.split('/'); const size = 2 ** (32 - Number(bits)); return Math.floor(ip(a) / size) === Math.floor(ip(base) / size); });
// Where other records usually point (a website builder already using the name).
const KNOWN_TARGETS: [RegExp, string][] = [[/wix(dns)?\./, 'Wix'], [/squarespace\.com$/, 'Squarespace'], [/myshopify\.com$/, 'Shopify'], [/github\.io$/, 'GitHub Pages'],
  [/vercel/, 'Vercel'], [/netlify/, 'Netlify'], [/ghs\.googlehosted\.com$/, 'Google Sites'], [/webflow/, 'Webflow'], [/hubspot/, 'HubSpot']];

/**
 * Whether a venture's own domain points to the portal, and when it doesn't,
 * what is wrong in plain words (problem) and what was found (found).
 */
export async function domainStatus(domainName: string): Promise<{ ok: boolean; found: string; problem?: string }> {
  const portal = strip(PORTAL_DOMAIN ?? '');
  const name = strip(domainName);
  if (!portal) return { ok: false, found: 'own domains are not switched on', problem: 'Own domains aren’t switched on on this server yet (Lakeba’s side).' };
  if (DNS_TEST_RECORDS && !DNS_TEST_FILE) {
    const test = new Map(DNS_TEST_RECORDS.split(',').filter(Boolean).map((x) => x.split('=').map(strip) as [string, string]));
    return test.get(name) === portal ? { ok: true, found: `CNAME ${portal}` } : { ok: false, found: 'no record', problem: `There’s no record for ${name} yet.` };
  }
  const cnames = await lookup('cname', name);
  if (cnames.includes(portal)) return { ok: true, found: `CNAME ${portal}` };
  const [portalAddresses, theirs, place] = await Promise.all([lookup('a', portal), lookup('a', name), placeOf(name)]);
  const mine = [...new Set([...portalAddresses, PORTAL_SERVER_IP])];
  if (theirs.length && mine.length && theirs.every((a) => mine.includes(a))) return { ok: true, found: `A ${theirs.join(', ')}` };
  const found = cnames.length ? `CNAME ${cnames.join(', ')}` : theirs.length ? `A ${theirs.join(', ')}` : 'no record yet';
  // The whole name typed in the Name box makes investors.mist.com.mist.com.
  if (place.zone && place.label !== '@') {
    const doubled = `${name}.${place.zone}`;
    const [dc, da] = await Promise.all([lookup('cname', doubled), lookup('a', doubled)]);
    if (dc.length || da.length) return { ok: false, found, problem: `The record was made for ${doubled}: the whole address was typed in the Name box. Edit it and put just “${place.label}” in the Name (or Host) box.` };
  }
  if (place.label === '@') return { ok: false, found, problem: `${name} is the main domain, which can’t point to the portal. Use an address like investors.${name} instead (ask Lakeba to change it).` };
  if (cnames.length) {
    const what = KNOWN_TARGETS.find(([re]) => re.test(cnames[0]))?.[1];
    return { ok: false, found, problem: `${name} points to ${cnames[0]}${what ? ` (${what})` : ''}, not to the portal. Change that record’s value (“Points to” or “Target”) to ${portal}.` };
  }
  if (theirs.some(inCloudflare)) {
    return { ok: false, found, problem: `Cloudflare is in the way: in Cloudflare’s DNS records, click the orange cloud next to “${place.label}” so it turns grey (DNS only), then save.` };
  }
  if (theirs.length) {
    const some = theirs.filter((a) => mine.includes(a));
    if (some.length) return { ok: false, found, problem: `${name} has more than one A record: ${theirs.join(', ')}. Keep only ${PORTAL_SERVER_IP} and delete the others.` };
    return { ok: false, found, problem: `${name} points to the address ${theirs.join(', ')}, which isn’t the portal. Change that A record’s value to ${PORTAL_SERVER_IP}, or delete it and add the CNAME record below.` };
  }
  return { ok: false, found, problem: `There’s no record for ${name} yet. If it was added recently, give it time: it can take up to a few hours to show.` };
}

/** Kept for callers that only need yes or no. */
export const pointsHere = async (domainName: string) => { const r = await domainStatus(domainName); return { ok: r.ok, found: r.found }; };
