import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';

/** A file on a reporting pack, for Lakeba's finance team. */
export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const path = url.searchParams.get('path') ?? '';
  const [entityId, folder] = path.split('/');
  const a = locals.access;
  if (folder !== 'reporting' || path.includes('..') || !/^[0-9a-f-]{36}$/.test(entityId) || !a.can('accounting.view', null)) return new Response('Not found', { status: 404 });
  const { data } = await serviceClient().storage.from('legal').createSignedUrl(path, 60);
  if (!data?.signedUrl) return new Response('Not found', { status: 404 });
  return redirect(data.signedUrl, 302);
};
