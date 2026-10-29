import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';

/**
 * Opens a file from the private legal bucket (an ASIC extract, a consent, a
 * proof) for someone who sees that company's legal records: a link valid for
 * a minute. Paths start with the company's id.
 */
export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const path = url.searchParams.get('path') ?? '';
  const entityId = path.split('/')[0];
  if (!/^[0-9a-f-]{36}$/.test(entityId) || path.includes('..') || !locals.access.can('legal.view', entityId)) return new Response('Not found', { status: 404 });
  const { data } = await serviceClient().storage.from('legal').createSignedUrl(path, 60);
  if (!data?.signedUrl) return new Response('Not found', { status: 404 });
  await locals.supabase.rpc('log_event', { event_action: 'admin_opened_legal_file', event_detail: { entity_id: entityId, path } });
  return redirect(data.signedUrl, 302);
};
