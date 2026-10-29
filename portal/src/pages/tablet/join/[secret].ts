import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { TABLET_COOKIE, connected, tabletOf } from '../../../lib/tablets';

/**
 * Lex in an online meeting (lib/recall.ts): the meeting bot's browser opens this private link; it keeps the
 * one-meeting pass as its cookie and goes to the meeting's Lex page, like a connected tablet.
 */
export const GET: APIRoute = async ({ params, cookies, redirect, url }) => {
  const secret = params.secret ?? '';
  const t = await tabletOf(serviceClient(), secret);
  if (!connected(t) || t.kind !== 'bot') return new Response('This link has expired.', { status: 410, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  cookies.set(TABLET_COOKIE, secret, { path: '/', httpOnly: true, secure: url.protocol === 'https:' || url.hostname === 'localhost', sameSite: 'lax', maxAge: 60 * 60 * 12 });
  return redirect(`/admin/legal/meetings/${t.meeting_id}/observe`, 302);
};
