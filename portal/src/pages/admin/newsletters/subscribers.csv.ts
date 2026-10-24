import type { APIRoute } from 'astro';
import Papa from 'papaparse';
import { serviceClient } from '../../../lib/admin';

/** The public newsletter's subscribers as a spreadsheet (group admins). */
export const GET: APIRoute = async ({ locals }) => {
  if (locals.profile?.role !== 'admin' || locals.user?.aal !== 'aal2') return new Response('Not allowed', { status: 403 });
  const { data } = await serviceClient().from('newsletter_subscribers').select('email, name, status, source, created_at, confirmed_at, unsubscribed_at').order('created_at');
  await locals.supabase.rpc('log_event', { event_action: 'admin_exported_newsletter_subscribers', event_detail: { rows: data?.length ?? 0 } });
  return new Response(Papa.unparse(data ?? [], { escapeFormulae: true }), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="newsletter-subscribers.csv"', 'cache-control': 'no-store' } });
};
