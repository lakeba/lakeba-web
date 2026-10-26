import type { APIRoute } from 'astro';
import { VIEW_COOKIE } from '../lib/investor-view';

export const POST: APIRoute = async ({ locals, cookies, redirect }) => {
  if (locals.user) await locals.supabase.rpc('log_event', { event_action: 'sign_out' });
  await locals.supabase.auth.signOut();
  cookies.delete(VIEW_COOKIE, { path: '/' });
  return redirect('/login');
};
