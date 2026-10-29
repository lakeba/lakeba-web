import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';

/** The PDF a signer reads: as sent, or the signed copy once everyone has signed. Only for the paper's signers. */
export const GET: APIRoute = async ({ params, locals }) => {
  const svc = serviceClient();
  const { data: sig } = await svc.from('board_signatures').select('paper_id').eq('paper_id', params.id ?? '').eq('user_id', locals.user!.id).maybeSingle();
  const { data: paper } = sig ? await svc.from('board_papers').select('pdf_path, signed_pdf_path, status').eq('id', sig.paper_id).maybeSingle() : { data: null };
  const path = paper?.status === 'signed' ? paper.signed_pdf_path : paper?.status === 'signing' ? paper.pdf_path : null;
  if (!path) return new Response('Not found', { status: 404 });
  const { data } = await svc.storage.from('legal').download(path);
  if (!data) return new Response('Not found', { status: 404 });
  // Shown inside the portal's own signing page.
  return new Response(await data.arrayBuffer(), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="document.pdf"', 'X-Frame-Options': 'SAMEORIGIN' } });
};
