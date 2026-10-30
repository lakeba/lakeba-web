import type { APIRoute } from 'astro';
import { safeNext } from '../../lib/supabase';
import { isMode, rememberMode, sideOf, workHome } from '../../lib/view-mode';

/** View all / View as admin / View as investor (user menu), remembered until changed. Stays on the page unless the view hides it. */
export const POST: APIRoute = async ({ request, locals, cookies, redirect, url }) => {
  const form = await request.formData();
  const next = safeNext(String(form.get('next') ?? '/'));
  const mode = form.get('view');
  if (!locals.viewMode.offered || !isMode(mode) || (mode === 'investor' && !locals.viewMode.investor)) return redirect(next, 303);
  rememberMode(cookies, mode, url.protocol === 'https:');
  const side = sideOf(new URL(next, url).pathname);
  if (mode === 'investor') return redirect(side === 'admin' ? '/' : next, 303);
  if (mode === 'admin') return redirect(side === 'investor' ? workHome(locals.viewMode.work) : next, 303);
  return redirect(next, 303);
};
