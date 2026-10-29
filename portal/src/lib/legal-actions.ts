import { randomUUID } from 'node:crypto';
import type { serviceClient } from './admin';
import { field } from './forms';
import { KINDS, OBLIGATION_COLUMNS, todayIn, type Kind, type LegalCompany, type Obligation } from './legal';

// The calendar's actions, shared by Admin → Legal's company pages and its
// calendar: add an item, mark it done (with the proof) or not needed, open it
// again, change its owner or date, delete one added by hand.

type Svc = ReturnType<typeof serviceClient>;
type Supabase = App.Locals['supabase'];

export const MAX_FILE = 25 * 1024 * 1024;
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

/** Stores a file in the private legal bucket under the company: `{entity}/{folder}/{uuid}-{name}`. */
export async function storeLegalFile(svc: Svc, entityId: string, folder: string, file: File) {
  if (file.size > MAX_FILE) throw new Error('The file is larger than 25 MB.');
  const name = file.name.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(-120) || 'file';
  const path = `${entityId}/${folder}/${randomUUID()}-${name}`;
  const { error } = await svc.storage.from('legal').upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream' });
  if (error) throw new Error(`The file could not be stored (${error.message}).`);
  return path;
}

export const fileOf = (form: FormData, name: string) => { const f = form.get(name); return f instanceof File && f.size > 0 ? f : null; };

/**
 * Handles an obligation form (intents ob-add, ob-done, ob-not-needed, ob-reopen,
 * ob-owner, ob-date, ob-delete). Returns a message for the page, or null when
 * the form wasn't one of these.
 */
export async function obligationAction(svc: Svc, supabase: Supabase, form: FormData, companies: LegalCompany[], may: (entityId: string) => boolean, userId: string) {
  const intent = field(form, 'intent');
  if (!intent.startsWith('ob-')) return null;
  const log = (action: string, detail: Record<string, unknown>) => supabase.rpc('log_event', { event_action: action, event_detail: detail });

  if (intent === 'ob-add') {
    const company = companies.find((c) => c.id === field(form, 'entity_id'));
    if (!company || !may(company.id)) return { error: 'Choose a company you look after.' };
    const title = field(form, 'title'), due = date(field(form, 'due_on'));
    if (title.length < 3 || !due) return { error: 'Give the item a title and a due date.' };
    const kind = (field(form, 'kind') in KINDS ? field(form, 'kind') : 'other') as Kind;
    const { data, error } = await svc.from('legal_obligations').insert({
      entity_id: company.id, kind, title: title.slice(0, 300), detail: field(form, 'detail').slice(0, 4000), due_on: due,
      owner_id: field(form, 'owner_id') || null, created_by: userId,
    }).select('id').single();
    if (error || !data) return { error: 'The item could not be added.' };
    await log('admin_added_legal_item', { entity_id: company.id, obligation_id: data.id, title });
    return { ok: `Added “${title}”.` };
  }

  const { data: row } = await svc.from('legal_obligations').select(OBLIGATION_COLUMNS).eq('id', field(form, 'obligation_id')).maybeSingle();
  const o = row as Obligation | null;
  if (!o || !companies.some((c) => c.id === o.entity_id) || !may(o.entity_id)) return { error: 'That item isn’t one you can change.' };
  const detail = { entity_id: o.entity_id, obligation_id: o.id, title: o.title };

  if (intent === 'ob-done' || intent === 'ob-not-needed') {
    const proof = fileOf(form, 'proof');
    const note = field(form, 'done_note').slice(0, 2000);
    if (intent === 'ob-not-needed' && !note) return { error: 'Say why it isn’t needed, for the record.' };
    let proofPath = o.proof_path;
    try { if (proof) proofPath = await storeLegalFile(svc, o.entity_id, 'proof', proof); } catch (e) { return { error: (e as Error).message }; }
    await svc.from('legal_obligations').update({
      status: intent === 'ob-done' ? 'done' : 'not_needed', done_on: date(field(form, 'done_on')) || todayIn(), done_by: userId, done_note: note, proof_path: proofPath,
    }).eq('id', o.id).throwOnError();
    await log(intent === 'ob-done' ? 'admin_completed_legal_item' : 'admin_marked_legal_item_not_needed', { ...detail, proof: Boolean(proof), note });
    return { ok: intent === 'ob-done' ? `Marked “${o.title}” done.` : `Marked “${o.title}” not needed.` };
  }
  if (intent === 'ob-reopen') {
    await svc.from('legal_obligations').update({ status: 'open', done_on: null, done_by: null }).eq('id', o.id).throwOnError();
    await log('admin_reopened_legal_item', detail);
    return { ok: `Opened “${o.title}” again.` };
  }
  if (intent === 'ob-owner') {
    const owner = field(form, 'owner_id') || null;
    await svc.from('legal_obligations').update({ owner_id: owner }).eq('id', o.id).throwOnError();
    await log('admin_assigned_legal_item', { ...detail, owner_id: owner });
    return { ok: `Changed who looks after “${o.title}”.` };
  }
  if (intent === 'ob-date') {
    const due = date(field(form, 'due_on'));
    if (!due) return { error: 'Choose a date.' };
    // A date moved by hand stays: the rules no longer change it.
    await svc.from('legal_obligations').update({ due_on: due, date_kept: true }).eq('id', o.id).throwOnError();
    await log('admin_moved_legal_item', { ...detail, from: o.due_on, to: due });
    return { ok: `Moved “${o.title}” to ${due}.` };
  }
  if (intent === 'ob-delete') {
    if (o.source_key) return { error: 'Items the portal adds from the records can’t be deleted; mark them not needed instead.' };
    await svc.from('legal_obligations').delete().eq('id', o.id).throwOnError();
    await log('admin_deleted_legal_item', detail);
    return { ok: `Deleted “${o.title}”.` };
  }
  return { error: 'Unknown action.' };
}
