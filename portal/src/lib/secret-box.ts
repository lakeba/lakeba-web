import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { INTEGRATIONS_KEY } from 'astro:env/server';

// Secrets the portal must use again later (webhook signing secrets, HubSpot and
// Xero tokens) are stored encrypted with INTEGRATIONS_KEY (AES-256-GCM), so a
// copy of the database alone doesn't reveal them.

const key = () => {
  const k = INTEGRATIONS_KEY ? Buffer.from(INTEGRATIONS_KEY, 'base64') : null;
  if (!k || k.length !== 32) throw new Error('Integrations aren’t set up on this server yet (INTEGRATIONS_KEY is missing).');
  return k;
};

export const integrationsReady = () => { try { key(); return true; } catch { return false; } };

/** "v1.<iv>.<tag>.<data>", base64url. */
export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function open(sealed: string) {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unreadable secret.');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

export const sealJson = (v: unknown) => seal(JSON.stringify(v));
export const openJson = <T>(sealed: string) => JSON.parse(open(sealed)) as T;
