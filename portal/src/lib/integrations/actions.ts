import type { serviceClient } from '../admin';
import { pdfChunks } from '../pdf-text';
import { validEmail } from '../people';

type Svc = ReturnType<typeof serviceClient>;
export type Company = { id: string; code: string; display_name: string; relationship: string };

// Changes made by other tools (the company API and incoming webhooks), with
// the same rules as the admin screens. Each returns { error } or the result;
// the caller records it in the audit log.

/** The newsletter list a company's subscribers are on (Lakeba Group's is the shared one). */
export const listOf = (c: Company) => (c.relationship === 'group' ? null : c.id);

export async function subscribe(svc: Svc, c: Company, a: { email: string; name?: string; source: 'api' | 'integration' }) {
  const email = a.email.trim().toLowerCase();
  if (!validEmail(email)) return { error: 'That isn’t an email address.' };
  const list = listOf(c);
  const q = svc.from('newsletter_subscribers').select('id, status').ilike('email', email);
  const { data: existing } = await (list ? q.eq('entity_id', list) : q.is('entity_id', null)).maybeSingle();
  const row = { email, name: (a.name ?? '').slice(0, 120), status: 'subscribed', confirmed_at: new Date().toISOString(), unsubscribed_at: null };
  const { data, error } = existing
    ? await svc.from('newsletter_subscribers').update(row).eq('id', existing.id).select('id').single()
    : await svc.from('newsletter_subscribers').insert({ ...row, source: a.source, entity_id: list }).select('id').single();
  if (error || !data) return { error: error?.message ?? 'Couldn’t subscribe them.' };
  return { id: data.id, existing: Boolean(existing), was: existing?.status ?? null };
}

export async function unsubscribe(svc: Svc, c: Company, id: string) {
  const list = listOf(c);
  const q = svc.from('newsletter_subscribers').update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() }).eq('id', id);
  const { data } = await (list ? q.eq('entity_id', list) : q.is('entity_id', null)).select('id, email');
  return data?.[0] ?? null;
}

/** Companies a person is an investor in (holders with shares). */
export async function companiesOfPerson(svc: Svc, userId: string) {
  const { data: links } = await svc.from('holder_members').select('holder_id').eq('user_id', userId);
  const ids = (links ?? []).map((l) => l.holder_id);
  if (!ids.length) return [] as string[];
  const { data } = await svc.from('holdings').select('share_classes(entity_id)').in('holder_id', ids).gt('shares', 0);
  return [...new Set((data ?? []).map((r) => (r.share_classes as unknown as { entity_id: string }).entity_id))];
}

/**
 * A person's name or phone, from another tool. Only for investors of this company, and only when they
 * aren't investors in another company too (then each company would overwrite the others).
 */
export async function updatePerson(svc: Svc, companyIds: string[], userId: string, next: { first_name?: string; last_name?: string; phone?: string }) {
  const theirs = await companiesOfPerson(svc, userId);
  if (!theirs.some((id) => companyIds.includes(id))) return { error: 'not_found' as const };
  if (theirs.some((id) => !companyIds.includes(id))) return { error: 'shared' as const };
  // Names can be blank but not missing; a blank phone is removed.
  const patch = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined).map(([k, v]) => [k, k === 'phone' ? (v ?? '').slice(0, 80) || null : (v ?? '').slice(0, 80)]));
  if (!Object.keys(patch).length) return { error: 'nothing' as const };
  const { data: before } = await svc.from('profiles').select('first_name, last_name, phone').eq('id', userId).single();
  await svc.from('profiles').update(patch).eq('id', userId).throwOnError();
  return { before, after: patch };
}

export const DOCUMENT_CATEGORIES = ['report', 'agm', 'update', 'governance', 'other'];
const safeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'file';

/** A document from another tool: always a draft, for an Admin to publish (or approve) in the portal. */
export async function addDraftDocument(svc: Svc, c: Company, a: { title: string; summary?: string; category: string; audience: 'all_investors' | 'board'; bytes: Uint8Array; fileName: string; contentType: string; knowledgeBase?: boolean; by?: string | null }) {
  if (!DOCUMENT_CATEGORIES.includes(a.category)) return { error: `The category must be one of ${DOCUMENT_CATEGORIES.join(', ')}.` };
  if (!a.bytes.length) return { error: 'The file is empty.' };
  if (a.bytes.length > 25 * 1024 * 1024) return { error: 'The file is larger than 25 MB.' };
  const path = `entity/${c.id}/${a.category}/${new Date().getFullYear()}/${crypto.randomUUID()}-${safeName(a.fileName)}`;
  const { error: up } = await svc.storage.from('documents').upload(path, a.bytes, { contentType: a.contentType || 'application/octet-stream' });
  if (up) return { error: up.message };
  const { data: doc, error } = await svc.from('documents').insert({
    entity_id: c.id, title: a.title.slice(0, 200), summary: a.summary?.slice(0, 1000) || null, category: a.category, audience: a.audience,
    file_path: path, mime_type: a.contentType || 'application/octet-stream', size_bytes: a.bytes.length, published_at: null, created_by: a.by ?? null,
    in_knowledge_base: Boolean(a.knowledgeBase),
  }).select('id').single();
  if (error || !doc) { await svc.storage.from('documents').remove([path]); return { error: error?.message ?? 'Couldn’t save the document.' }; }
  if (a.contentType === 'application/pdf') {
    try {
      const chunks = await pdfChunks(a.bytes);
      if (chunks.length) await svc.from('document_chunks').insert(chunks.map((ch, i) => ({ document_id: doc.id, chunk_index: i, page: ch.page, content: ch.content })));
    } catch { /* scanned or protected: no text */ }
  }
  return { id: doc.id, path };
}

/** Stores a register PDF received from another tool, for an Admin to check and apply. */
export async function keepRegisterPdf(svc: Svc, c: Company, bytes: Uint8Array) {
  if (!bytes.length || Buffer.from(bytes.slice(0, 5)).toString() !== '%PDF-') return { error: 'That isn’t a PDF.' };
  if (bytes.length > 20 * 1024 * 1024) return { error: 'The file is larger than 20 MB.' };
  const path = `imports/received-${c.code.toLowerCase()}-${crypto.randomUUID()}.pdf`;
  const { error } = await svc.storage.from('documents').upload(path, bytes, { contentType: 'application/pdf' });
  return error ? { error: error.message } : { path };
}
