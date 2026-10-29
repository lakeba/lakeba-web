import type { serviceClient } from './admin';

// A file from private storage, streamed through the portal (as documents are): the browser never gets a storage
// address, which in production is only reachable inside the server. Range requests pass through, so audio and
// video can be played and scrubbed.

type Svc = ReturnType<typeof serviceClient>;
const PASS_THROUGH = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

/** Is this the first request for the file (not a player asking for the next range)? For logging an opening once. */
export const firstRequest = (request: Request) => { const r = request.headers.get('range'); return !r || /^bytes=0-/.test(r); };

export async function streamFile(svc: Svc, bucket: string, path: string, request: Request) {
  const { data } = await svc.storage.from(bucket).createSignedUrl(path, 60);
  if (!data?.signedUrl) return new Response('Not found', { status: 404 });
  const range = request.headers.get('range');
  const upstream = await fetch(data.signedUrl, { headers: range ? { range } : {}, signal: request.signal });
  if (!upstream.ok || !upstream.body) return new Response('File unavailable', { status: 502 });
  const headers = new Headers();
  for (const h of PASS_THROUGH) { const v = upstream.headers.get(h); if (v) headers.set(h, v); }
  const name = (path.split('/').pop() ?? 'file').replace(/^[0-9a-f-]{36}-/, '').replace(/["\\\r\n]/g, '');
  headers.set('content-disposition', `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  headers.set('cache-control', 'private, no-store');
  return new Response(upstream.body, { status: upstream.status, headers });
}
