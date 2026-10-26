import type { APIRoute } from 'astro';
import { safeNext } from '../../lib/supabase';
import { VIEW_COOKIE } from '../../lib/investor-view';

/** View as investor / View as admin (user menu): for this session only, until signing out. */
export const POST: APIRoute = async ({ request, locals, cookies, redirect, url }) => {
  const form = await request.formData();
  const next = safeNext(String(form.get('next') ?? '/'));
  if (form.get('view') === 'investor' && locals.investorView.available) {
    cookies.set(VIEW_COOKIE, 'investor', { path: '/', sameSite: 'lax', secure: url.protocol === 'https:', httpOnly: true });
    return redirect(next.startsWith('/admin') ? '/' : next, 303);
  }
  cookies.delete(VIEW_COOKIE, { path: '/' });
  return redirect(next, 303);
};
