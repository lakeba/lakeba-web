import type { APIRoute } from 'astro';
import { firstRequest, streamFile } from '../../../lib/stream-file';
import { serviceClient } from '../../../lib/admin';
import { mayMeeting } from '../../../lib/boardroom';

/**
 * Opens a file from the private legal bucket (an ASIC extract, a consent, a
 * proof, a meeting's recording) for someone who sees that company's legal
 * records, streamed through the portal. Paths start with the company's id.
 */
export const GET: APIRoute = async ({ url, locals, request }) => {
  const path = url.searchParams.get('path') ?? '';
  const entityId = path.split('/')[0];
  // "unassigned/…": a contract whose company isn't chosen yet, for those who see every company's.
  const allowed = entityId === 'unassigned' ? locals.access.can('legal.view', null) : /^[0-9a-f-]{36}$/.test(entityId) && (locals.access.can('legal.view', entityId) || (path.split('/')[1] === 'meetings' && mayMeeting(locals.access, entityId)));
  if (!allowed || path.includes('..')) return new Response('Not found', { status: 404 });
  if (firstRequest(request)) await locals.supabase.rpc('log_event', { event_action: 'admin_opened_legal_file', event_detail: { ...(entityId === 'unassigned' ? {} : { entity_id: entityId }), path } });
  return streamFile(serviceClient(), 'legal', path, request);
};
