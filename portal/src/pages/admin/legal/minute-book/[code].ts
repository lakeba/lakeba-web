import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/admin';
import { meetingCompanies } from '../../../../lib/boardroom';
import { minuteBookPdf } from '../../../../lib/legal-board';

/** A company's minute book: every signed resolution and minutes, in date order, as one PDF. */
export const GET: APIRoute = async ({ params, locals }) => {
  const svc = serviceClient();
  // Lakeba's Legal team, or the company's own secretary (Boardroom).
  const company = (await meetingCompanies(svc, locals.access)).find((c) => c.code === params.code?.toUpperCase());
  if (!company) return new Response('Not found', { status: 404 });
  const pdf = await minuteBookPdf(svc, company.id);
  await locals.supabase.rpc('log_event', { event_action: 'admin_downloaded_minute_book', event_detail: { entity_id: company.id } });
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${company.code}-minute-book.pdf"` } });
};
