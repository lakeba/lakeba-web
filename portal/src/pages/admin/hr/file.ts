import type { APIRoute } from 'astro';
import { firstRequest, streamFile } from '../../../lib/stream-file';
import { serviceClient } from '../../../lib/admin';

/** An HR file (employee document, grant letter, plan rules, policy) for whoever sees that company's HR. */
export const GET: APIRoute = async ({ url, locals, request }) => {
  const path = url.searchParams.get('path') ?? '';
  const [entityId, folder] = path.split('/');
  if (folder !== 'hr' || path.includes('..') || !/^[0-9a-f-]{36}$/.test(entityId) || !locals.access.can('hr.view', entityId)) return new Response('Not found', { status: 404 });
  if (firstRequest(request)) await locals.supabase.rpc('log_event', { event_action: 'admin_opened_hr_file', event_detail: { entity_id: entityId, path } });
  return streamFile(serviceClient(), 'legal', path, request);
};
