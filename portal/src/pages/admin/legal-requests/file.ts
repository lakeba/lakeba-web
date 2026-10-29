import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { requesterCompanies } from '../../../lib/legal-requests';

/**
 * A file in a legal request's thread, for the venture's people: only files on
 * messages they can see (never the Legal team's internal notes).
 */
export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const svc = serviceClient();
  const path = url.searchParams.get('path') ?? '';
  const [entityId, folder, requestId] = path.split('/');
  if (folder !== 'requests' || path.includes('..')) return new Response('Not found', { status: 404 });
  const companies = await requesterCompanies(svc, locals.access);
  if (!companies.some((c) => c.id === entityId)) return new Response('Not found', { status: 404 });
  const { data: msgs } = await svc.from('legal_request_messages').select('files').eq('request_id', requestId).eq('internal', false);
  if (!(msgs ?? []).some((m) => (m.files as { path: string }[]).some((f) => f.path === path))) return new Response('Not found', { status: 404 });
  const { data } = await svc.storage.from('legal').createSignedUrl(path, 60);
  if (!data?.signedUrl) return new Response('Not found', { status: 404 });
  return redirect(data.signedUrl, 302);
};
