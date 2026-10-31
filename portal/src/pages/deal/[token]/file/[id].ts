import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/admin';
import { recordVisit, roomForToken } from '../../../../lib/crm-rooms';

// A file in a deal room, for the buyer (logged on the deal).
export const GET: APIRoute = async ({ params, request, clientAddress }) => {
  const svc = serviceClient();
  const room = await roomForToken(svc, params.token ?? '');
  if (!room || !/^[0-9a-f-]{36}$/.test(params.id ?? '')) return new Response('Not found', { status: 404 });
  const { data: f } = await svc.from('crm_room_files').select('title, file_path, file_name').eq('id', params.id!).eq('room_id', room.id).maybeSingle();
  if (!f) return new Response('Not found', { status: 404 });
  const { data } = await svc.storage.from('crm').download(f.file_path);
  if (!data) return new Response('Not found', { status: 404 });
  await recordVisit(svc, room, { kind: 'download', detail: f.title, ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? clientAddress });
  return new Response(data, { headers: { 'content-type': data.type || 'application/octet-stream', 'content-disposition': `attachment; filename="${f.file_name.replace(/["\\\r\n]/g, '')}"`, 'cache-control': 'private, no-store' } });
};
