import type { serviceClient } from './admin';
import type { Access } from './access';
import { notifyMembers } from './notify';

type Svc = ReturnType<typeof serviceClient>;

// Approvals, optional per item (Admin → Approvals). Whoever prepares an item
// may ask for approval; until someone with "approve" for its area and company
// approves it, it can't be published, sent, opened or completed. The person
// who asked can't approve it themselves. Changing an approved item asks
// again, with the person who changed it as the one asking.

export type ItemType = 'document' | 'post' | 'newsletter' | 'meeting' | 'trade';
export type Approval = {
  id: string; item_type: ItemType; item_id: string; area: string; entity_id: string | null; status: 'pending' | 'approved' | 'changes_requested';
  title: string; note: string; requested_by: string | null; requested_at: string; decided_by: string | null; decided_at: string | null; decision_note: string;
};

/** What each kind of item is, where it lives and what approval holds back. */
export const ITEMS: Record<ItemType, { area: string; label: string; holds: string; link: (id: string) => string }> = {
  document: { area: 'documents', label: 'Document', holds: 'publishing it', link: () => '/admin/documents' },
  post: { area: 'news', label: 'News post', holds: 'publishing it', link: (id) => `/admin/news/${id}` },
  newsletter: { area: 'newsletters', label: 'Newsletter', holds: 'sending or scheduling it', link: (id) => `/admin/newsletters/${id}` },
  meeting: { area: 'meetings', label: 'Meeting', holds: 'opening proxy voting and publishing results', link: (id) => `/admin/agm/${id}` },
  trade: { area: 'capital', label: 'Secondary trade', holds: 'completing it', link: () => '/admin/trading' },
};
export const STATUS_TEXT: Record<Approval['status'], string> = { pending: 'Waiting for approval', approved: 'Approved', changes_requested: 'Changes requested' };
export const approvalHref = (type: ItemType, id: string) => `/admin/approvals/${type}/${id}`;

export async function getApproval(svc: Svc, type: ItemType, id: string) {
  const { data } = await svc.from('approvals').select('*').eq('item_type', type).eq('item_id', id).maybeSingle();
  return (data as Approval | null) ?? null;
}
export async function approvalsFor(svc: Svc, type: ItemType, ids: string[]) {
  if (!ids.length) return new Map<string, Approval>();
  const { data } = await svc.from('approvals').select('*').eq('item_type', type).in('item_id', ids);
  return new Map(((data ?? []) as Approval[]).map((a) => [a.item_id, a]));
}

/** The same content, whatever order the database returns JSON keys in. */
export function sameContent(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => (Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])])) : v ?? null);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** Why this can't go ahead yet (null when it can: no approval asked for, or approved). */
export function heldBack(a: Approval | null, type: ItemType) {
  if (!a || a.status === 'approved') return null;
  return a.status === 'pending' ? `This ${ITEMS[type].label.toLowerCase()} is waiting for approval: ${ITEMS[type].holds} has to wait until it’s approved.` : `Changes were requested before approval: make them and ask for approval again before ${ITEMS[type].holds}.`;
}

/** People who may approve this area for this company (group roles or that company's), now. */
export async function approverIds(svc: Svc, area: string, entityId: string | null) {
  const { data: perms } = await svc.from('role_permissions').select('role_key').eq('permission', `${area}.approve`);
  const keys = (perms ?? []).map((p) => p.role_key);
  if (!keys.length) return [];
  let q = svc.from('user_roles').select('user_id, entity_id').in('role_key', keys).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  q = entityId ? q.or(`entity_id.is.null,entity_id.eq.${entityId}`) : q.is('entity_id', null);
  const { data } = await q;
  return [...new Set((data ?? []).map((r) => r.user_id))];
}

const may = (me: Access, a: { area: string; entity_id: string | null }, level: 'do' | 'approve') => me.can(`${a.area}.${level}`, a.entity_id);
export const mayAsk = (me: Access, type: ItemType, entityId: string | null) => may(me, { area: ITEMS[type].area, entity_id: entityId }, 'do');
export const mayDecide = (me: Access, meId: string, a: Approval) => may(me, a, 'approve') && a.requested_by !== meId;

const tellApprovers = async (svc: Svc, a: { area: string; entity_id: string | null; item_type: ItemType; item_id: string; title: string }, by: string, origin: string, again = false) =>
  notifyMembers({
    kind: 'admin_approval', origin, link: approvalHref(a.item_type, a.item_id),
    title: `${ITEMS[a.item_type].label} ${again ? 'changed after approval' : 'waiting for your approval'}`, body: a.title,
    userIds: (await approverIds(svc, a.area, a.entity_id)).filter((u) => u !== by),
  }).catch(() => 0);

export async function requestApproval(svc: Svc, me: Access, by: string, o: { type: ItemType; id: string; entityId: string | null; title: string; note: string; origin: string }) {
  if (!mayAsk(me, o.type, o.entityId)) return 'You can’t ask for approval here.';
  const area = ITEMS[o.type].area;
  if (!(await approverIds(svc, area, o.entityId)).filter((u) => u !== by).length) return 'Nobody else can approve this yet: give someone a role with “approve” for it in System → Users.';
  const row = { item_type: o.type, item_id: o.id, area, entity_id: o.entityId, status: 'pending', title: o.title.slice(0, 300), note: o.note.slice(0, 1000), requested_by: by, requested_at: new Date().toISOString(), decided_by: null, decided_at: null, decision_note: '' };
  await svc.from('approvals').upsert(row, { onConflict: 'item_type,item_id' }).throwOnError();
  await tellApprovers(svc, { ...row, item_type: o.type }, by, o.origin);
  return null;
}

export async function decide(svc: Svc, me: Access, by: string, a: Approval, o: { decision: 'approved' | 'changes_requested'; note: string; origin: string }) {
  if (!may(me, a, 'approve')) return 'You can’t approve this.';
  if (a.requested_by === by) return 'You asked for this approval, so someone else has to give it.';
  if (a.status !== 'pending') return 'This isn’t waiting for approval.';
  if (o.decision === 'changes_requested' && !o.note.trim()) return 'Say what needs changing.';
  await svc.from('approvals').update({ status: o.decision, decided_by: by, decided_at: new Date().toISOString(), decision_note: o.note.slice(0, 1000) }).eq('id', a.id).eq('status', 'pending').throwOnError();
  if (a.requested_by) await notifyMembers({
    kind: 'admin_approval', origin: o.origin, link: approvalHref(a.item_type, a.item_id), userIds: [a.requested_by],
    title: o.decision === 'approved' ? `Approved: ${a.title}` : `Changes requested: ${a.title}`,
    body: o.decision === 'approved' ? `You can now go ahead with ${ITEMS[a.item_type].holds}.${o.note ? ` Note: ${o.note}` : ''}` : o.note,
  }).catch(() => 0);
  return null;
}

/** Withdraws the request: the item no longer needs approval. Only someone who may prepare it. */
export async function withdrawApproval(svc: Svc, me: Access, a: Approval) {
  if (!may(me, a, 'do') && !may(me, a, 'approve')) return 'You can’t change this.';
  // Once an approver has answered, only an approver can drop the approval.
  if (a.status !== 'pending' && !may(me, a, 'approve')) return 'An approver has already answered: only an approver can remove the approval now.';
  await svc.from('approvals').delete().eq('id', a.id).throwOnError();
  return null;
}

/** After a change to an approved item: it waits for approval again, asked by whoever changed it. Returns true when that happened. */
export async function changedAfterApproval(svc: Svc, type: ItemType, id: string, by: string, origin: string, title?: string) {
  const a = await getApproval(svc, type, id);
  if (!a || a.status !== 'approved') return false;
  const row = { status: 'pending', requested_by: by, requested_at: new Date().toISOString(), decided_by: null, decided_at: null, decision_note: '', note: 'Changed after it was approved.', ...(title ? { title: title.slice(0, 300) } : {}) };
  await svc.from('approvals').update(row).eq('id', a.id).throwOnError();
  await tellApprovers(svc, { ...a, ...row }, by, origin, true);
  return true;
}

/** Approvals waiting for this person (they may approve, and didn't ask). */
export async function waitingFor(svc: Svc, me: Access, meId: string) {
  const { data } = await svc.from('approvals').select('*').eq('status', 'pending').order('requested_at');
  return ((data ?? []) as Approval[]).filter((a) => mayDecide(me, meId, a));
}

export type Item = { type: ItemType; id: string; title: string; entityId: string | null; open: string; preview: string | null; facts: string[] };

/** The item an approval is about: its name, company and where to look at it. */
export async function loadItem(svc: Svc, type: ItemType, id: string): Promise<Item | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const base = { type, id, open: ITEMS[type].link(id) };
  if (type === 'document') {
    const { data: d } = await svc.from('documents').select('title, summary, category, audience, entity_id, published_at').eq('id', id).maybeSingle();
    return d && { ...base, title: d.title, entityId: d.entity_id, preview: `/documents/${id}`, facts: [d.category, d.audience.replace('_', ' '), d.published_at ? 'published' : 'not published', d.summary].filter(Boolean) };
  }
  if (type === 'post') {
    const { data: p } = await svc.from('posts').select('title, excerpt, visibility, entity_id, published_at').eq('id', id).maybeSingle();
    return p && { ...base, title: p.title, entityId: p.entity_id, preview: null, facts: [p.visibility === 'public' ? 'public: website and all investors' : 'shareholders', p.published_at ? 'published or scheduled' : 'draft', p.excerpt].filter(Boolean) };
  }
  if (type === 'newsletter') {
    const { data: n } = await svc.from('newsletter_issues').select('subject, audience, entity_id, status').eq('id', id).maybeSingle();
    return n && { ...base, title: n.subject || 'Untitled newsletter', entityId: n.entity_id, preview: `/admin/newsletters/${id}/preview`, facts: [n.audience === 'public' ? 'public newsletter' : 'for shareholders', n.status] };
  }
  if (type === 'meeting') {
    const { data: m } = await svc.from('meetings').select('title, entity_id, status, starts_at, notice_document_id').eq('id', id).maybeSingle();
    if (!m) return null;
    const { data: res } = await svc.from('resolutions').select('number, title').eq('meeting_id', id).order('number');
    return { ...base, title: m.title, entityId: m.entity_id, preview: m.notice_document_id ? `/documents/${m.notice_document_id}` : null, facts: [m.status, m.starts_at ? new Date(m.starts_at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' }) : '', ...(res ?? []).map((r) => `Resolution ${r.number}: ${r.title}`)].filter(Boolean) };
  }
  const { data: t } = await svc.from('trade_matches').select('entity_id, shares, price, status, sell_id, buy_id').eq('id', id).maybeSingle();
  if (!t) return null;
  const { data: sides } = await svc.from('trade_interests').select('id, holder_id, holders(name)').in('id', [t.sell_id, t.buy_id]);
  const name = (sid: string) => ((sides ?? []).find((x) => x.id === sid)?.holders as unknown as { name: string } | null)?.name ?? '—';
  return { ...base, title: `${Number(t.shares).toLocaleString('en-AU')} shares: ${name(t.sell_id)} to ${name(t.buy_id)}`, entityId: t.entity_id, preview: null, facts: [t.price ? `A$${t.price} a share` : 'price not set', t.status] };
}
