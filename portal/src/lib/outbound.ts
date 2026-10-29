import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { FETCH_TEST_PREFIXES, OUTBOUND_ALLOWLIST } from 'astro:env/server';
import { publicAddress, safeLookup } from './newsletter-import';

// Calls from integrations to the outside world (webhooks, HubSpot, Xero). Only
// public internet addresses are reached, checked when connecting, so a webhook
// can never be pointed at the server itself or a private network. Where
// OUTBOUND_ALLOWLIST is set (staging), nothing outside it is called at all.

export type OutResponse = { status: number; headers: Record<string, string>; text: string; bytes: Buffer };

const prefixes = (v: string | undefined) => (v ?? '').split(',').map((p) => p.trim()).filter(Boolean);
const testStandIn = (url: string) => prefixes(FETCH_TEST_PREFIXES).some((p) => url.startsWith(p));

/** Why this address can't be called, or null. */
export function outboundProblem(url: string) {
  let u: URL;
  try { u = new URL(url); } catch { return 'That isn’t a web address.'; }
  const allow = prefixes(OUTBOUND_ALLOWLIST);
  if (allow.length && !allow.some((p) => url.startsWith(p))) return 'This server only calls its test stand-ins (OUTBOUND_ALLOWLIST).';
  if (testStandIn(url)) return null;
  if (u.protocol !== 'https:') return 'Use an https:// address.';
  if (u.username || u.password) return 'Leave the user name and password out of the address.';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !publicAddress(host)) return 'That address isn’t on the public internet.';
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) return 'That address isn’t on the public internet.';
  return null;
}

/** One request: at most `max` bytes back, no redirects, 15 seconds. */
export function outbound(method: string, url: string, opts: { headers?: Record<string, string>; body?: string | Buffer; max?: number; timeout?: number; onData?: (chunk: Buffer) => void } = {}): Promise<OutResponse> {
  const problem = outboundProblem(url);
  if (problem) return Promise.reject(new Error(problem));
  const u = new URL(url);
  const max = opts.max ?? 1_000_000;
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, {
      method, lookup: testStandIn(url) ? undefined : safeLookup, timeout: opts.timeout ?? 15_000,
      headers: { 'user-agent': 'LakebaPortal/1.0 (integrations)', ...(opts.body !== undefined ? { 'content-length': String(Buffer.byteLength(opts.body)) } : {}), ...opts.headers },
    }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      // onData: a successful response's body as it arrives (Lex's voice), besides the whole of it at the end.
      res.on('data', (c: Buffer) => { size += c.length; if (size <= max) { chunks.push(c); if (opts.onData && (res.statusCode ?? 0) < 400) opts.onData(c); } });
      res.on('end', () => { const bytes = Buffer.concat(chunks); resolve({ status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, String(v)])), text: bytes.toString('utf8'), bytes }); });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('No answer within 15 seconds.')));
    req.on('error', (e) => reject(new Error(/public address/.test(e.message) ? 'That address isn’t on the public internet.' : e.message)));
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** JSON in, JSON out; throws with the service's own message when it answers with an error. */
export async function outboundJson<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await outbound(method, url, { headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: unknown = null;
  try { json = res.text ? JSON.parse(res.text) : null; } catch { /* not JSON */ }
  if (res.status >= 400) {
    const j = json as { message?: string; Message?: string; error_description?: string; error?: string; Detail?: string } | null;
    const err = new Error(`${res.status}: ${j?.message ?? j?.Message ?? j?.Detail ?? j?.error_description ?? j?.error ?? res.text.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}
