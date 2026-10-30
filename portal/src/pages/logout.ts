import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ locals, redirect }) => {
  if (locals.user) await locals.supabase.rpc('log_event', { event_action: 'sign_out' });
  await locals.supabase.auth.signOut();
  return redirect('/login');
};
