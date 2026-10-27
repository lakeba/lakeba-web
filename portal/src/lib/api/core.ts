import { createHash, randomBytes } from 'node:crypto';
import type { APIContext, APIRoute } from 'astro';
import { SUPABASE_URL } from 'astro:env/server';
import { serviceClient } from '../admin';

// The company API (/api/v1/…, see lib/api/spec.ts for what it offers). Every
// request carries a company key ("Authorization: Bearer lk_live_…") or an
// app's access token (lk_oat_…). A key belongs to one company and has scopes;
// every query below is limited to that company (or, for a Lakeba Group key
// made for all companies, to every company). Errors are application/problem+json.

export type Svc = ReturnType<typeof serviceClient>;
export type ApiKeyRow = { id: string; entity_id: string; name: string; kind: 'key' | 'oauth'; scopes: string[]; all_companies: boolean; allowed_ips: string[]; expires_at: string | null; created_by: string | null; client_id?: string | null };
export type ApiCompany = { id: string; code: string; display_name: string; relationship: string; integrations_enabled: boolean };

// Staging is the local Supabase on this Mac (port 54321, as in the middleware); production's database is on
// 127.0.0.1 too, behind its own gateway, so the address alone doesn't tell them apart.
export const LIVE = !/^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(SUPABASE_URL);
export const hashSecret = (s: string) => createHash('sha256').update(s).digest('hex');

/** A new company key: shown once, only its hash is kept. Staging keys say "test". */
export function newApiKey() {
  const key = `lk_${LIVE ? 'live' : 'test'}_${randomBytes(24).toString('base64url')}`;
  return { key, hash: hashSecret(key), prefix: key.slice(0, 12) };
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

const TITLES: Record<number, string> = { 400: 'Bad request', 401: 'Unauthorised', 403: 'Forbidden', 404: 'Not found', 409: 'Conflict', 422: 'Unprocessable', 429: 'Too many requests', 500: 'Server error', 503: 'Unavailable' };
export const problem = (status: number, code: string, detail: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: `https://investors.lakeba.com/developers#${code}`, title: TITLES[status] ?? 'Error', status, code, detail, ...extra }), {
    status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store', ...headers },
  });
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

// ---------- Rate limits: 300 requests a minute per key ----------
const LIMIT = 300;
const recent = new Map<string, number[]>();
function rate(id: string) {
  const now = Date.now();
  const times = (recent.get(id) ?? []).filter((t) => now - t < 60_000);
  times.push(now);
  recent.set(id, times);
  return { over: times.length > LIMIT, remaining: Math.max(0, LIMIT - times.length) };
}

const touched = new Map<string, number>();
async function touch(svc: Svc, id: string) {
  if (Date.now() - (touched.get(id) ?? 0) < 60_000) return;
  touched.set(id, Date.now());
  await svc.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', id);
}

const ipOf = (ctx: APIContext) => ctx.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || (() => { try { return ctx.clientAddress; } catch { return ''; } })();

/** The key and company behind a request, or a ready refusal. */
export async function authenticate(ctx: APIContext, svc: Svc): Promise<{ key: ApiKeyRow; company: ApiCompany } | Response> {
  const raw = ctx.request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!raw) return problem(401, 'missing_key', 'Send your API key as “Authorization: Bearer lk_live_…”.');
  if (!/^lk_(live|test|oat)_[A-Za-z0-9_-]{20,64}$/.test(raw)) return problem(401, 'invalid_key', 'That isn’t a Lakeba API key.');
  if (raw.startsWith('lk_test_') && LIVE) return problem(401, 'test_key', 'This is a test key: it only works on staging.');
  if (raw.startsWith('lk_live_') && !LIVE) return problem(401, 'live_key', 'This is a live key: on staging, use a test key (lk_test_…).');
  const { data } = await svc.from('api_keys').select('id, entity_id, name, kind, scopes, all_companies, allowed_ips, expires_at, created_by, client_id, revoked_at, entities(id, code, display_name, relationship, integrations_enabled)')
    .eq('key_hash', hashSecret(raw)).maybeSingle();
  if (!data || data.revoked_at) return problem(401, 'invalid_key', 'This key isn’t valid (it may have been revoked).');
  if (data.expires_at && new Date(data.expires_at) < new Date()) return problem(401, 'expired_key', data.kind === 'oauth' ? 'This access token has expired: refresh it.' : 'This key has expired.');
  const company = data.entities as unknown as ApiCompany;
  if (!company.integrations_enabled) return problem(403, 'integrations_off', `Integrations are switched off for ${company.display_name}.`);
  const ip = ipOf(ctx);
  if (data.allowed_ips?.length && !data.allowed_ips.includes(ip)) return problem(403, 'ip_not_allowed', `This key doesn’t work from ${ip || 'this address'}.`);
  return { key: data as unknown as ApiKeyRow, company };
}

export type Ctx = {
  svc: Svc; ctx: APIContext; key: ApiKeyRow; company: ApiCompany;
  /** The companies this request covers (narrowed with ?company=CODE on an all-companies key). */
  companyIds: string[];
  can: (scope: string) => boolean;
  /** Writes are recorded in the audit log, as made through this key. */
  audit: (action: string, detail: Record<string, unknown>) => Promise<void>;
  body: () => Promise<Record<string, unknown>>;
  /** The request body as bytes (files). */
  raw: Buffer;
};

/** limit (1–200, default 50) and an opaque cursor. */
export function page(url: URL) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
  const cursor = url.searchParams.get('cursor');
  const from = cursor && /^[A-Za-z0-9_-]+$/.test(cursor) ? Number(Buffer.from(cursor, 'base64url').toString()) || 0 : 0;
  return { limit, from, to: from + limit - 1, next: (count: number) => (from + limit < count ? Buffer.from(String(from + limit)).toString('base64url') : null) };
}

export const since = (url: URL) => {
  const s = url.searchParams.get('updated_since');
  if (!s) return null;
  if (Number.isNaN(Date.parse(s))) throw new ApiError(400, 'bad_date', 'updated_since must be a date, e.g. 2026-11-01T00:00:00Z.');
  return new Date(s).toISOString();
};

export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type Options = { scope: string; write?: boolean };

/** Wraps a handler: key, company, scope, rate limit, idempotency, usage and errors. */
export function endpoint(name: string, opts: Options, handler: (c: Ctx) => Promise<Response>): APIRoute {
  return async (ctx) => {
    const svc = serviceClient();
    const found = await authenticate(ctx, svc);
    if (found instanceof Response) return found;
    const { key, company } = found;
    const r = rate(key.id);
    const limitHeaders = { 'x-ratelimit-limit': String(LIMIT), 'x-ratelimit-remaining': String(r.remaining) };
    // (Supabase queries only run when awaited or then'd.)
    const count = (failed: boolean) => { svc.rpc('api_count', { target_key: key.id, target_endpoint: `${ctx.request.method} ${name}`, failed }).then(() => {}, () => {}); };
    if (r.over) { count(true); return problem(429, 'rate_limited', `More than ${LIMIT} requests a minute. Please slow down.`, {}, { ...limitHeaders, 'retry-after': '30' }); }
    void touch(svc, key.id);
    const can = (scope: string) => key.scopes.includes(scope);
    if (opts.scope !== 'any' && !can(opts.scope)) { count(true); return problem(403, 'insufficient_scope', `This key needs the “${opts.scope}” scope.`, { required_scope: opts.scope }, limitHeaders); }

    // Which companies: the key's own, or (all-companies keys) every one, optionally narrowed.
    let companyIds = [company.id];
    if (key.all_companies) {
      const { data } = await svc.from('entities').select('id, code').eq('integrations_enabled', true);
      const wanted = ctx.url.searchParams.get('company')?.toUpperCase();
      companyIds = (data ?? []).filter((e) => !wanted || e.code === wanted).map((e) => e.id);
    }

    let cachedBody: Record<string, unknown> | null = null;
    const bytes = opts.write ? Buffer.from(await ctx.request.arrayBuffer()) : Buffer.alloc(0);
    const isJson = !(ctx.request.headers.get('content-type') ?? '').startsWith('application/pdf');
    const raw = isJson ? bytes.toString('utf8') : `<${bytes.length} bytes>`;
    const body = async () => {
      if (cachedBody) return cachedBody;
      if (!raw) return (cachedBody = {});
      try { const v = JSON.parse(raw); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(); return (cachedBody = v); } catch { throw new ApiError(400, 'bad_json', 'The body must be a JSON object.'); }
    };
    const audit = async (action: string, detail: Record<string, unknown>) => {
      await svc.from('audit_log').insert({ user_id: null, action, detail: { ...detail, company: detail.company ?? company.code, via: 'api', key_id: key.id, key_name: key.name } });
    };

    // Idempotency: the same key and Idempotency-Key gets the first answer again.
    const idem = opts.write ? ctx.request.headers.get('idempotency-key')?.trim().slice(0, 120) : null;
    const reqHash = idem ? createHash('sha256').update(`${ctx.request.method} ${ctx.url.pathname} `).update(bytes).digest('hex') : '';
    if (idem) {
      const { data: prev } = await svc.from('api_idempotency').select('request_hash, status, response').eq('key_id', key.id).eq('idem_key', idem).maybeSingle();
      if (prev) {
        if (prev.request_hash !== reqHash) return problem(409, 'idempotency_conflict', 'This Idempotency-Key was already used for a different request.');
        return json(prev.response, prev.status, { ...limitHeaders, 'idempotent-replayed': 'true' });
      }
    }

    let res: Response;
    try {
      res = await handler({ svc, ctx, key, company, companyIds, can, audit, body, raw: bytes });
    } catch (e) {
      if (e instanceof ApiError) res = problem(e.status, e.code, e.message, e.extra);
      else { console.error(`api ${name}`, e); res = problem(500, 'server_error', 'Something went wrong on our side. Please try again.'); }
    }
    for (const [k, v] of Object.entries(limitHeaders)) res.headers.set(k, v);
    count(res.status >= 400);
    if (idem && res.status < 500) {
      const text = await res.clone().text();
      let stored: unknown = null; try { stored = JSON.parse(text); } catch { stored = text; }
      await svc.from('api_idempotency').insert({ key_id: key.id, idem_key: idem, request_hash: reqHash, status: res.status, response: stored as never });
    }
    return res;
  };
}

// ---------- Small helpers for handlers ----------

export const str = (b: Record<string, unknown>, k: string, max = 500, required = false) => {
  const v = b[k];
  if (v === undefined || v === null || v === '') { if (required) throw new ApiError(422, 'missing_field', `“${k}” is required.`, { field: k }); return ''; }
  if (typeof v !== 'string') throw new ApiError(422, 'bad_field', `“${k}” must be text.`, { field: k });
  return v.trim().slice(0, max);
};
export const bool = (b: Record<string, unknown>, k: string, dflt = false) => (b[k] === undefined ? dflt : b[k] === true);

/**
 * Share classes of the companies in view: id → { code, company code, on issue, counts toward % }. Shares on
 * issue as on the Holders & holdings page: the official figure where there is one, else the sum of holdings.
 */
export async function classesOf(svc: Svc, companyIds: string[]) {
  const { data: classes } = await svc.from('share_classes').select('id, code, name, kind, voting, counts_toward_pct, currency, official_on_issue, official_as_at, entity_id, entities(code)').in('entity_id', companyIds);
  const latest = await latestHoldings(svc, (classes ?? []).map((c) => c.id));
  const held = new Map<string, number>();
  for (const r of latest) held.set(r.share_class_id, (held.get(r.share_class_id) ?? 0) + Number(r.shares));
  return new Map((classes ?? []).map((c) => [c.id, { ...c, company: (c.entities as unknown as { code: string }).code, held: held.get(c.id) ?? 0, on_issue: c.official_on_issue != null ? Number(c.official_on_issue) : held.get(c.id) ?? 0 }]));
}

/** Latest holding per holder and class, for the given classes. */
export async function latestHoldings(svc: Svc, classIds: string[], holderIds?: string[]) {
  if (!classIds.length) return [];
  const rows: { holder_id: string; share_class_id: string; shares: number; as_at: string; exercise_price: number | null; expires_on: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    let q = svc.from('holdings').select('holder_id, share_class_id, shares, as_at, exercise_price, expires_on').in('share_class_id', classIds).order('as_at', { ascending: false }).range(from, from + 999);
    if (holderIds) q = q.in('holder_id', holderIds);
    const { data } = await q;
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) { const k = `${r.holder_id}:${r.share_class_id}`; if (!latest.has(k)) latest.set(k, r); }
  return [...latest.values()];
}
