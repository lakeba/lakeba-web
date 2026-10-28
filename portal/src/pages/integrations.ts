import type { APIRoute } from 'astro';

// A short address for Admin → Settings → Integrations.
export const GET: APIRoute = ({ redirect }) => redirect('/admin/integrations', 302);
