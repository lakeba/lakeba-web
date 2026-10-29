import type { APIRoute } from 'astro';
import { streamFile } from '../../../lib/stream-file';
import { serviceClient } from '../../../lib/admin';

/** A file on a reporting pack: for its company's senders and Lakeba's finance team. */
export const GET: APIRoute = async ({ url, locals, request }) => {
  const path = url.searchParams.get('path') ?? '';
  const [entityId, folder] = path.split('/');
  const a = locals.access;
  if (folder !== 'reporting' || path.includes('..') || !/^[0-9a-f-]{36}$/.test(entityId) || !(a.can('reporting.view', entityId) || a.can('accounting.view', null))) return new Response('Not found', { status: 404 });
    return streamFile(serviceClient(), 'legal', path, request);
};
