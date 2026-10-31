import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { recordVisit, roomForToken } from '../../../lib/crm-rooms';
import { renderQuote, type Quote } from '../../../lib/crm-quotes';

// The deal room's quote as a PDF, for the buyer.
export const GET: APIRoute = async ({ params, request, clientAddress }) => {
  const svc = serviceClient();
  const room = await roomForToken(svc, params.token ?? '');
  if (!room) return new Response('Not found', { status: 404 });
  const { data: q } = await svc.from('crm_quotes').select('*').eq('deal_id', room.deal_id).in('status', ['sent', 'accepted']).order('version', { ascending: false }).limit(1).maybeSingle();
  if (!q) return new Response('Not found', { status: 404 });
  await recordVisit(svc, room, { kind: 'download', detail: `quote ${q.number} (PDF)`, ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? clientAddress });
  return new Response(new Uint8Array(await renderQuote(svc, q as Quote)), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${q.number}.pdf"`, 'cache-control': 'private, no-store' } });
};
