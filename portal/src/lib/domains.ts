import { promises as dns } from 'node:dns';
import { DNS_TEST_RECORDS, PORTAL_DOMAIN } from 'astro:env/server';

/*
 * A venture's own domain (investors.mist.com) is used once its DNS points to
 * the portal: a CNAME to the portal's domain (investors.lakeba.com), or the
 * same addresses. Checked when someone presses "Check DNS".
 */
const strip = (s: string) => s.toLowerCase().replace(/\.$/, '');

export async function pointsHere(domainName: string): Promise<{ ok: boolean; found: string }> {
  const portal = strip(PORTAL_DOMAIN ?? '');
  if (!portal) return { ok: false, found: 'venture addresses are not switched on (PORTAL_DOMAIN)' };
  const test = new Map((DNS_TEST_RECORDS ?? '').split(',').filter(Boolean).map((x) => x.split('=').map(strip) as [string, string]));
  if (test.size) return test.get(strip(domainName)) === portal ? { ok: true, found: `CNAME ${portal}` } : { ok: false, found: 'no record' };
  const cnames = await dns.resolveCname(domainName).catch(() => [] as string[]);
  if (cnames.map(strip).includes(portal)) return { ok: true, found: `CNAME ${cnames[0]}` };
  const [mine, theirs] = await Promise.all([dns.resolve4(portal).catch(() => [] as string[]), dns.resolve4(domainName).catch(() => [] as string[])]);
  if (theirs.length && theirs.every((a) => mine.includes(a))) return { ok: true, found: `A ${theirs.join(', ')}` };
  return { ok: false, found: cnames.length ? `CNAME ${cnames.join(', ')}` : theirs.length ? `A ${theirs.join(', ')}` : 'no record yet' };
}
