// Host names the portal answers on, besides ventures' own domains (verified in
// Admin → Companies → a company → Domain and mail, and looked up at run time).
// astro.config.mjs passes these to Astro, which then trusts the Host header;
// the middleware turns away any other name that isn't a verified venture domain.
export const KNOWN_HOSTS = [
  { hostname: 'localhost' },
  { hostname: '127.0.0.1' },
  { hostname: '192.168.1.141' }, // this Mac on the local network (plain HTTP)
  { hostname: '100.117.227.8' }, // this Mac on the Tailscale network
  { hostname: 'giuseppe-macbook-pro.tail21d16f.ts.net', protocol: 'https' }, // same, via Tailscale HTTPS: staging's central address (PORTAL_DOMAIN)
  { hostname: 'investors.lakeba.com', protocol: 'https' }, // production (Caddy in front, HTTPS only)
];

/** Whether a host name is one of the known ones (exactly, or one level under a "*." name). */
export function isKnownHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1') return true;
  return KNOWN_HOSTS.some(({ hostname: k }) => (k.startsWith('*.') ? h.endsWith(k.slice(1)) && !h.slice(0, -k.length + 1).includes('.') : h === k));
}
