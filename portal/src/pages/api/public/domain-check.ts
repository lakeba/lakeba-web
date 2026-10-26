import type { APIRoute } from 'astro';
import { refreshOwnDomains, ownDomainVenture } from '../../../lib/sites';

/**
 * For the web server (Caddy's on-demand certificates): may a certificate be
 * requested for this name? Only for ventures' verified own domains.
 */
export const GET: APIRoute = async ({ url }) => {
  await refreshOwnDomains();
  return new Response(null, { status: ownDomainVenture(url.searchParams.get('domain') ?? '') ? 200 : 404 });
};
