import type { APIRoute } from 'astro';
import { openApi } from '../../../lib/api/spec';

/** GET /api/v1/openapi.json — the API described for tools (OpenAPI 3.1). Public. */
export const GET: APIRoute = ({ url, locals }) => Response.json(openApi(locals.site?.central ?? url.origin), { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
