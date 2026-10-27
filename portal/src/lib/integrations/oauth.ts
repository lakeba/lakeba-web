import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { serviceClient } from '../admin';
import { hashSecret } from '../api/core';

type Svc = ReturnType<typeof serviceClient>;

// Apps allowed by a company (OAuth 2, authorization code with PKCE or a client
// secret). /oauth/authorize asks a company Admin; /oauth/token gives the app an
// access token (lk_oat_…, an hour) and a refresh token (lk_ort_…, 60 days,
// replaced each time it's used). Tokens live in api_keys as kind 'oauth'.

export type Client = { id: string; client_id: string; name: string; description: string; website: string | null; redirect_uris: string[]; secret_hash: string; scopes_allowed: string[]; revoked_at: string | null };

export function newClientCredentials() {
  const clientId = `lkapp_${randomBytes(12).toString('base64url')}`;
  const secret = `lkcs_${randomBytes(24).toString('base64url')}`;
  return { clientId, secret, secretHash: hashSecret(secret) };
}

export async function clientById(svc: Svc, clientId: string) {
  if (!/^lkapp_[A-Za-z0-9_-]{10,30}$/.test(clientId)) return null;
  const { data } = await svc.from('oauth_clients').select('*').eq('client_id', clientId).is('revoked_at', null).maybeSingle();
  return data as Client | null;
}

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** A one-time code (10 minutes) after the Admin allowed the app. */
export async function newCode(svc: Svc, a: { client: Client; entityId: string; userId: string; scopes: string[]; redirectUri: string; codeChallenge: string | null }) {
  const code = randomBytes(24).toString('base64url');
  await svc.from('oauth_codes').insert({ code_hash: hashSecret(code), client_id: a.client.id, entity_id: a.entityId, user_id: a.userId, scopes: a.scopes, redirect_uri: a.redirectUri, code_challenge: a.codeChallenge, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }).throwOnError();
  return code;
}

async function issue(svc: Svc, client: Client, entityId: string, scopes: string[], userId: string | null) {
  const access = `lk_oat_${randomBytes(24).toString('base64url')}`;
  const refresh = `lk_ort_${randomBytes(24).toString('base64url')}`;
  const { data } = await svc.from('api_keys').insert({
    entity_id: entityId, name: client.name, kind: 'oauth', client_id: client.id, prefix: access.slice(0, 12), key_hash: hashSecret(access), scopes,
    expires_at: new Date(Date.now() + 3600_000).toISOString(), refresh_hash: hashSecret(refresh), refresh_expires_at: new Date(Date.now() + 60 * 86_400_000).toISOString(), created_by: userId,
  }).select('id').single().throwOnError();
  return { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: scopes.join(' '), key_id: data!.id };
}

const err = (error: string, description: string, status = 400) => ({ status, body: { error, error_description: description } });

/** POST /oauth/token. */
export async function token(svc: Svc, p: URLSearchParams, basic: string | null) {
  let clientId = p.get('client_id') ?? '', secret = p.get('client_secret') ?? '';
  if (basic) { const [id, s] = Buffer.from(basic, 'base64').toString().split(':'); clientId = decodeURIComponent(id ?? ''); secret = decodeURIComponent(s ?? ''); }
  const client = await clientById(svc, clientId);
  if (!client) return err('invalid_client', 'Unknown app.', 401);
  const secretOk = secret ? same(hashSecret(secret), client.secret_hash) : false;

  if (p.get('grant_type') === 'authorization_code') {
    const { data: c } = await svc.from('oauth_codes').select('*').eq('code_hash', hashSecret(p.get('code') ?? '')).eq('client_id', client.id).maybeSingle();
    if (!c || c.used_at || new Date(c.expires_at) < new Date()) return err('invalid_grant', 'The code is unknown, used or expired.');
    if (c.redirect_uri !== p.get('redirect_uri')) return err('invalid_grant', 'redirect_uri doesn’t match.');
    // PKCE (S256) for apps that can't keep a secret; otherwise the client secret.
    const verifier = p.get('code_verifier');
    const pkceOk = c.code_challenge && verifier ? createHash('sha256').update(verifier).digest('base64url') === c.code_challenge : false;
    if (!secretOk && !pkceOk) return err('invalid_client', 'Send the client secret, or the PKCE code_verifier.', 401);
    const { data: used } = await svc.from('oauth_codes').update({ used_at: new Date().toISOString() }).eq('code_hash', c.code_hash).is('used_at', null).select('code_hash');
    if (!used?.length) return err('invalid_grant', 'The code was already used.');
    const t = await issue(svc, client, c.entity_id, c.scopes, c.user_id);
    await svc.from('audit_log').insert({ action: 'oauth_app_authorised', detail: { entity_id: c.entity_id, client: client.name, scopes: c.scopes } });
    const { key_id: _k, ...body } = t;
    return { status: 200, body };
  }
  if (p.get('grant_type') === 'refresh_token') {
    const { data: k } = await svc.from('api_keys').select('id, entity_id, scopes, created_by, refresh_expires_at, revoked_at').eq('refresh_hash', hashSecret(p.get('refresh_token') ?? '')).eq('client_id', client.id).maybeSingle();
    if (!k || k.revoked_at || !k.refresh_expires_at || new Date(k.refresh_expires_at) < new Date()) return err('invalid_grant', 'The refresh token is unknown, revoked or expired.');
    if (!secretOk && !p.get('client_secret') && !basic) { /* public clients may refresh with their refresh token alone */ }
    else if (!secretOk) return err('invalid_client', 'Wrong client secret.', 401);
    const t = await issue(svc, client, k.entity_id, k.scopes, k.created_by);
    // The old pair stops working; webhooks the app subscribed move to the new token.
    await svc.from('api_keys').update({ revoked_at: new Date().toISOString(), refresh_hash: null }).eq('id', k.id);
    await svc.from('webhook_endpoints').update({ created_by_key: t.key_id }).eq('created_by_key', k.id);
    const { key_id: _k, ...body } = t;
    return { status: 200, body };
  }
  return err('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

/** A company stops an app: every token it has stops at once, and the webhooks it made are removed. */
export async function revokeApp(svc: Svc, entityId: string, clientId: string) {
  const { data: keys } = await svc.from('api_keys').select('id').eq('entity_id', entityId).eq('client_id', clientId);
  const ids = (keys ?? []).map((k) => k.id);
  if (ids.length) await svc.from('webhook_endpoints').delete().in('created_by_key', ids);
  await svc.from('api_keys').update({ revoked_at: new Date().toISOString(), refresh_hash: null }).eq('entity_id', entityId).eq('client_id', clientId).is('revoked_at', null);
}
