import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/admin';
import { guestForToken, requestIp, watermarkPdf } from '../../../../lib/data-rooms';

/** One data room PDF, stamped for this guest. Every open is logged. */
export const GET: APIRoute = async ({ params, request, clientAddress }) => {
  const svc = serviceClient();
  const found = await guestForToken(svc, params.token ?? '');
  if (!('guest' in found) || !found.guest.nda_accepted_at) return new Response('Not found', { status: 404 });
  const { guest, room } = found;
  const { data: item } = await svc.from('data_room_documents').select('documents(id, title, file_path, mime_type)').eq('room_id', room.id).eq('document_id', params.docId!).maybeSingle();
  const doc = item?.documents as unknown as { id: string; title: string; file_path: string; mime_type: string } | null;
  if (!doc || doc.mime_type !== 'application/pdf') return new Response('Not found', { status: 404 });

  const { data: file, error } = await svc.storage.from('documents').download(doc.file_path);
  if (error || !file) return new Response('File unavailable', { status: 502 });
  const { data: company } = await svc.from('entities').select('display_name').eq('id', room.entity_id).single();
  let pdf: Uint8Array;
  try {
    pdf = await watermarkPdf(new Uint8Array(await file.arrayBuffer()), guest, company?.display_name ?? 'Lakeba');
  } catch {
    return new Response('This document could not be prepared. Please contact the person who invited you.', { status: 500 });
  }
  await svc.from('data_room_views').insert({ guest_id: guest.id, document_id: doc.id, ip: requestIp(request, clientAddress) });
  if (!guest.is_test) await svc.from('audit_log').insert({ action: 'data_room_document_viewed', detail: { room_id: room.id, guest_id: guest.id, document_id: doc.id, title: doc.title, name: guest.name, email: guest.email } });
  await svc.from('data_room_guests').update({ last_seen_at: new Date().toISOString() }).eq('id', guest.id);

  const name = `${doc.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'document'}.pdf`;
  return new Response(pdf, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
};
