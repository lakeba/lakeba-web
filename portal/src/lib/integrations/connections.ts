import { randomBytes } from 'node:crypto';
import { HUBSPOT_API_BASE, HUBSPOT_AUTH_BASE, HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET, XERO_AUTH_BASE, XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_SCOPES, XERO_TOKEN_URL } from 'astro:env/server';
import type { serviceClient } from '../admin';
import { hashSecret } from '../api/core';
import { notifyAdmins } from '../notify';
import { outbound } from '../outbound';
import { openJson, sealJson } from '../secret-box';

type Svc = ReturnType<typeof serviceClient>;

// A company's connection to HubSpot or Xero. "Connect" sends the company's
// Admin to the tool's own sign-in page (OAuth); the tool sends them back to
// /admin/companies/oauth/<tool> with a one-time code, exchanged here for
// tokens that are stored encrypted and refreshed when they expire.

export type Provider = 'hubspot' | 'xero';
export type Tokens = { access_token: string; refresh_token: string; expires_at: number };
export type Connection = { id: string; entity_id: string; provider: Provider; status: string; account_id: string | null; account_name: string | null; tokens_enc: string | null; token_expires_at: string | null; settings: Record<string, unknown>; cursor: Record<string, unknown>; last_sync_at: string | null; last_error: string | null; connected_at: string | null };

export const HUBSPOT_SCOPES = 'oauth crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read crm.objects.companies.write crm.schemas.contacts.read crm.schemas.contacts.write crm.schemas.companies.read crm.schemas.companies.write crm.objects.deals.read';
export const PROVIDERS: Record<Provider, { name: string; ready: () => boolean }> = {
  hubspot: { name: 'HubSpot', ready: () => Boolean(HUBSPOT_CLIENT_ID && HUBSPOT_CLIENT_SECRET) },
  xero: { name: 'Xero', ready: () => Boolean(XERO_CLIENT_ID && XERO_CLIENT_SECRET) },
};
export const callbackUrl = (central: string, p: Provider) => `${central}/admin/companies/oauth/${p}`;

export async function connectionOf(svc: Svc, entityId: string, provider: Provider) {
  const { data } = await svc.from('connections').select('*').eq('entity_id', entityId).eq('provider', provider).maybeSingle();
  return data as Connection | null;
}

/** Where to send the Admin to approve the connection. */
export async function startConnect(svc: Svc, entityId: string, provider: Provider, userId: string, central: string) {
  const state = randomBytes(24).toString('base64url');
  const existing = await connectionOf(svc, entityId, provider);
  // The portal address used here is the one the tool calls back (and HubSpot wants again when refreshing).
  await svc.from('connections').upsert({ entity_id: entityId, provider, status: 'connecting', state_hash: hashSecret(state), created_by: userId, settings: { ...(existing?.settings ?? {}), callback: central } }, { onConflict: 'entity_id,provider' }).throwOnError();
  const redirect = callbackUrl(central, provider);
  if (provider === 'hubspot') {
    return `${HUBSPOT_AUTH_BASE}/oauth/authorize?${new URLSearchParams({ client_id: HUBSPOT_CLIENT_ID!, redirect_uri: redirect, scope: HUBSPOT_SCOPES, state })}`;
  }
  return `${XERO_AUTH_BASE}/authorize?${new URLSearchParams({ response_type: 'code', client_id: XERO_CLIENT_ID!, redirect_uri: redirect, scope: XERO_SCOPES, state })}`;
}

async function tokenRequest(provider: Provider, params: Record<string, string>, central: string) {
  const body = new URLSearchParams({ ...params, redirect_uri: callbackUrl(central, provider), ...(provider === 'hubspot' ? { client_id: HUBSPOT_CLIENT_ID!, client_secret: HUBSPOT_CLIENT_SECRET! } : {}) }).toString();
  const url = provider === 'hubspot' ? `${HUBSPOT_API_BASE}/oauth/v1/token` : XERO_TOKEN_URL;
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (provider === 'xero') headers.authorization = `Basic ${Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString('base64')}`;
  const res = await outbound('POST', url, { body, headers });
  const j = (() => { try { return JSON.parse(res.text); } catch { return {}; } })() as { access_token?: string; refresh_token?: string; expires_in?: number; message?: string; error_description?: string; error?: string };
  if (res.status >= 400 || !j.access_token) throw new Error(j.message ?? j.error_description ?? j.error ?? `The token request answered ${res.status}.`);
  return { access_token: j.access_token, refresh_token: j.refresh_token ?? params.refresh_token ?? '', expires_at: Date.now() + (j.expires_in ?? 1800) * 1000 } as Tokens;
}

/** The callback: checks the state, exchanges the code, stores the tokens. */
export async function finishConnect(svc: Svc, provider: Provider, code: string, state: string, central: string) {
  const { data: c } = await svc.from('connections').select('*').eq('provider', provider).eq('state_hash', hashSecret(state)).maybeSingle();
  if (!c) throw new Error('This approval link has already been used or has expired. Start again from Integrations.');
  const tokens = await tokenRequest(provider, { grant_type: 'authorization_code', code }, central);
  await svc.from('connections').update({ tokens_enc: sealJson(tokens), token_expires_at: new Date(tokens.expires_at).toISOString(), state_hash: null, status: 'connected', connected_at: new Date().toISOString(), last_error: null }).eq('id', c.id).throwOnError();
  return { connection: c as Connection, tokens };
}

/** A working access token, refreshed if it's about to expire. */
export async function accessToken(svc: Svc, c: Connection, central: string) {
  if (!c.tokens_enc) throw new Error('Not connected.');
  let t = openJson<Tokens>(c.tokens_enc);
  if (t.expires_at - Date.now() < 120_000) {
    t = await tokenRequest(c.provider, { grant_type: 'refresh_token', refresh_token: t.refresh_token }, central);
    await svc.from('connections').update({ tokens_enc: sealJson(t), token_expires_at: new Date(t.expires_at).toISOString() }).eq('id', c.id);
    c.tokens_enc = sealJson(t);
  }
  return t.access_token;
}

/** Something for a person to look at (once per dedupe key until resolved). */
export async function raiseIssue(svc: Svc, c: Connection, kind: string, summary: string, dedupe: string, detail: Record<string, unknown> = {}) {
  await svc.from('connection_issues').upsert({ connection_id: c.id, kind, summary, dedupe, detail }, { onConflict: 'connection_id,dedupe', ignoreDuplicates: true });
}

/** A sync failed: kept on the connection; the company's Admins are told once (not every minute). */
export async function syncFailed(svc: Svc, c: Connection, e: Error, company: { code: string; display_name: string }, origin: string) {
  const message = e.message.slice(0, 500);
  const status = /401|invalid_grant|revoked|unauthor/i.test(message) ? 'error' : c.status;
  await svc.from('connections').update({ last_error: message, last_sync_at: new Date().toISOString(), status }).eq('id', c.id);
  if (c.last_error !== message) {
    await notifyAdmins({ kind: 'admin_integrations', entityId: c.entity_id, title: `${PROVIDERS[c.provider].name} sync for ${company.display_name} failed`, body: `${message}${status === 'error' ? ' Connect it again in Integrations.' : ' It will try again in a few minutes.'}`, link: `/admin/companies/${company.code}/integrations?tab=${c.provider}`, origin }).catch(() => {});
  }
}
