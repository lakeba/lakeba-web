// Checks that companies (entities) stay separate: a venture-only shareholder
// sees only that venture, a group-only shareholder sees only the group (plus
// venture documents shared with the group), and venture directors see only
// their venture's board papers.
//
// Safe to run on a database with real data: it creates temporary accounts,
// holders, classes and content (all marked "[entity test]") and removes them.
// Uses the ventures EZF (Ezifin) and the group (LKB).
//
//   node --env-file=.env scripts/check-entities.mjs
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const svc = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const TAG = '[entity test]';
const run = Date.now();
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${extra}`}`);
};

const users = [];
const created = { holders: [], classes: [], documents: [], posts: [], announcements: [], meetings: [] };

async function person(label) {
  const email = `entity.${label}.${run}@lakeba.test`;
  const password = `Et${crypto.randomUUID()}9A`;
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  const client = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

async function holderWith(label, classId, shares) {
  const { data: h } = await svc.from('holders').insert({ name: `${TAG} ${label}`, kind: 'individual', registry_ref: `ENTTEST-${label}-${run}` }).select('id').single().throwOnError();
  created.holders.push(h.id);
  await svc.from('holdings').insert({ holder_id: h.id, share_class_id: classId, shares, as_at: '2026-06-30' }).throwOnError();
  return h.id;
}
const link = (userId, holderId) => svc.from('holder_members').insert({ user_id: userId, holder_id: holderId, access: 'owner' }).throwOnError();

async function doc(entityId, audience, extra = {}) {
  const { data } = await svc.from('documents').insert({
    title: `${TAG} ${audience} ${run}`, category: 'report', file_path: `entity-test/${run}/${crypto.randomUUID()}.pdf`,
    mime_type: 'application/pdf', audience, entity_id: entityId, published_at: new Date(Date.now() - 60_000).toISOString(), in_knowledge_base: false, ...extra,
  }).select('id').single().throwOnError();
  created.documents.push(data.id);
  return data.id;
}

const ids = (rows) => new Set((rows ?? []).map((r) => r.id));
const totp = (secret) => {
  const al = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const ch of secret.replace(/=+$/, '')) bits += al.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((x) => parseInt(x, 2)));
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', key).update(c).digest(); const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
};
/** Enrols a TOTP factor and verifies it, so the session is aal2 (as company admins must be). */
async function withTwoStep(client) {
  const { data: f, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'entity test' });
  if (error) throw error;
  const { data: ch } = await client.auth.mfa.challenge({ factorId: f.id });
  const { error: vErr } = await client.auth.mfa.verify({ factorId: f.id, challengeId: ch.id, code: totp(f.totp.secret) });
  if (vErr) throw vErr;
}

try {
  const { data: entities } = await svc.from('entities').select('id, code');
  const E = Object.fromEntries(entities.map((e) => [e.code, e.id]));
  const { data: lkbOrd } = await svc.from('share_classes').select('id').eq('entity_id', E.LKB).eq('code', 'ORD').single().throwOnError();
  const { data: ezfClass } = await svc.from('share_classes').insert({ entity_id: E.EZF, code: `T${String(run).slice(-6)}`, name: `${TAG} Ezifin ordinary` }).select('id').single().throwOnError();
  created.classes.push(ezfClass.id);
  await svc.from('reference_prices').insert({ share_class_id: ezfClass.id, price: 1.23, priced_on: '2026-06-30', source: 'valuation', note: TAG }).throwOnError();

  // Group holdings use 0 shares so the group's totals don't move while the test runs.
  const venture = await person('venture');
  await link(venture.id, await holderWith('Venture only', ezfClass.id, 1000));
  const group = await person('group');
  await link(group.id, await holderWith('Group only', lkbOrd.id, 0));
  const both = await person('both');
  await link(both.id, await holderWith('Both group', lkbOrd.id, 0));
  await link(both.id, await holderWith('Both venture', ezfClass.id, 500));
  const director = await person('director');
  await svc.from('entity_board').insert({ entity_id: E.EZF, user_id: director.id, position: 'director' }).throwOnError();

  const lkbDoc = await doc(E.LKB, 'all_investors');
  const lkbBoardDoc = await doc(E.LKB, 'board');
  const ezfDoc = await doc(E.EZF, 'all_investors');
  const ezfShared = await doc(E.EZF, 'all_investors', { shared_with_group: true });
  const ezfBoardDoc = await doc(E.EZF, 'board');

  const { data: lkbPost } = await svc.from('posts').insert({ slug: `entity-test-lkb-${run}`, title: TAG, entity_id: E.LKB, published_at: new Date(Date.now() - 60_000).toISOString() }).select('id').single().throwOnError();
  const { data: ezfPost } = await svc.from('posts').insert({ slug: `entity-test-ezf-${run}`, title: TAG, entity_id: E.EZF, published_at: new Date(Date.now() - 60_000).toISOString() }).select('id').single().throwOnError();
  created.posts.push(lkbPost.id, ezfPost.id);
  const { data: ezfNotice } = await svc.from('announcements').insert({ title: TAG, entity_id: E.EZF, starts_at: new Date(Date.now() - 60_000).toISOString() }).select('id').single().throwOnError();
  created.announcements.push(ezfNotice.id);
  const meeting = (entityId) => svc.from('meetings').insert({ title: TAG, entity_id: entityId, starts_at: new Date(Date.now() + 30 * 86400_000).toISOString(), proxy_deadline: new Date(Date.now() + 28 * 86400_000).toISOString(), status: 'open' }).select('id').single().throwOnError();
  const { data: lkbMeeting } = await meeting(E.LKB);
  const { data: ezfMeeting } = await meeting(E.EZF);
  created.meetings.push(lkbMeeting.id, ezfMeeting.id);
  const { data: ezfRes } = await svc.from('resolutions').insert({ meeting_id: ezfMeeting.id, number: 1, title: TAG }).select('id').single().throwOnError();

  const view = async (who) => {
    const c = who.client;
    const [d, p, a, m, cls, pr, ent, v, s, soi] = await Promise.all([
      c.from('documents').select('id, entity_id, audience'), c.from('posts').select('id'), c.from('announcements').select('id, entity_id'),
      c.from('meetings').select('id'), c.from('share_classes').select('id, entity_id'), c.from('reference_prices').select('id, note, share_class_id'),
      c.from('entities').select('id, code'), c.from('ventures').select('id'), c.from('portal_settings').select('key'),
      c.rpc('shares_on_issue'),
    ]);
    return { docRows: d.data ?? [], noticeRows: a.data ?? [], docs: ids(d.data), posts: ids(p.data), notices: ids(a.data), meetings: ids(m.data), classes: cls.data ?? [],
      prices: pr.data ?? [], entities: (ent.data ?? []).map((e) => e.code), ventures: v.data ?? [], settings: s.data ?? [], onIssue: soi.data ?? [] };
  };

  // Venture-only shareholder
  const V = await view(venture);
  ok('venture-only: sees the venture’s document', V.docs.has(ezfDoc));
  ok('venture-only: sees no group documents', ![lkbDoc, lkbBoardDoc].some((d) => V.docs.has(d)));
  ok('venture-only: does not see venture board papers', !V.docs.has(ezfBoardDoc));
  ok('venture-only: every document it sees is the venture’s', V.docRows.every((d) => d.entity_id === E.EZF && d.audience !== 'board'), JSON.stringify(V.docRows.filter((d) => d.entity_id !== E.EZF)));
  ok('venture-only: venture posts only', V.posts.has(ezfPost.id) && !V.posts.has(lkbPost.id));
  ok('venture-only: no group announcements', V.notices.has(ezfNotice.id) && V.noticeRows.every((n) => n.entity_id === E.EZF));
  ok('venture-only: venture meetings only', V.meetings.has(ezfMeeting.id) && !V.meetings.has(lkbMeeting.id));
  ok('venture-only: only venture share classes', V.classes.length > 0 && V.classes.every((c) => c.entity_id === E.EZF));
  ok('venture-only: shares on issue only for venture classes', V.onIssue.length > 0 && V.onIssue.every((c) => V.classes.some((k) => k.id === c.share_class_id)));
  ok('venture-only: only venture prices', V.prices.some((p) => p.note === TAG) && V.prices.every((p) => V.classes.some((k) => k.id === p.share_class_id)));
  ok('venture-only: sees only its company', V.entities.join() === 'EZF', V.entities.join());
  ok('venture-only: no group portfolio or settings', V.ventures.length === 0 && V.settings.length === 0);
  const { data: vGroup } = await venture.client.rpc('can_see_entity', { target: E.LKB });
  ok('venture-only: Ask Lakeba gate is closed (cannot see the group)', vGroup === false);
  const { error: vQuery } = await venture.client.from('queries').insert({ user_id: venture.id, subject: TAG, entity_id: E.LKB });
  ok('venture-only: cannot ask the group board', !!vQuery);

  // Group-only shareholder
  const G = await view(group);
  ok('group-only: sees group documents', G.docs.has(lkbDoc));
  ok('group-only: does not see the venture’s own documents', !G.docs.has(ezfDoc) && !G.docs.has(ezfBoardDoc));
  ok('group-only: sees a venture document shared with the group', G.docs.has(ezfShared));
  ok('group-only: no venture posts, announcements or meetings', !G.posts.has(ezfPost.id) && !G.notices.has(ezfNotice.id) && !G.meetings.has(ezfMeeting.id));
  ok('group-only: no venture share classes or prices', G.classes.every((c) => c.entity_id === E.LKB) && !G.prices.some((p) => p.note === TAG));
  ok('group-only: sees group plus portfolio company names', G.entities.includes('LKB') && G.entities.includes('EZF') && G.entities.includes('WHK'));
  const { error: gVote } = await group.client.from('proxy_votes').insert({ resolution_id: ezfRes.id, holder_id: created.holders[1], vote: 'for', lodged_by: group.id });
  ok('group-only: cannot vote at the venture’s meeting', !!gVote);

  // Shareholder of both
  const B = await view(both);
  ok('both: sees group and venture documents', B.docs.has(lkbDoc) && B.docs.has(ezfDoc));
  ok('both: sees both companies’ meetings', B.meetings.has(lkbMeeting.id) && B.meetings.has(ezfMeeting.id));
  ok('both: no board papers', !B.docs.has(lkbBoardDoc) && !B.docs.has(ezfBoardDoc));
  const { error: bVote } = await both.client.from('proxy_votes').insert({ resolution_id: ezfRes.id, holder_id: created.holders[3], vote: 'for', lodged_by: both.id });
  ok('both: can vote with the venture holding', !bVote, bVote?.message);

  // Venture director without shares
  const D = await view(director);
  ok('venture director: sees venture board papers', D.docs.has(ezfBoardDoc));
  ok('venture director: no group board papers or documents', !D.docs.has(lkbBoardDoc) && !D.docs.has(lkbDoc));
  ok('venture director: sees only the venture', D.entities.join() === 'EZF', D.entities.join());

  // Company admin of the venture
  const coadmin = await person('coadmin');
  await svc.from('entity_admins').insert({ entity_id: E.EZF, user_id: coadmin.id }).throwOnError();
  const docRow = (entityId, title) => ({ entity_id: entityId, title: `${TAG} ${title} ${run}`, category: 'update', file_path: `entity/${entityId}/${run}/${crypto.randomUUID()}.pdf`, mime_type: 'application/pdf', audience: 'all_investors' });
  const { error: noMfa } = await coadmin.client.from('documents').insert(docRow(E.EZF, 'no two-step'));
  ok('company admin without two-step cannot write', !!noMfa);
  await withTwoStep(coadmin.client);
  const { data: own, error: ownErr } = await coadmin.client.from('documents').insert(docRow(E.EZF, 'by company admin')).select('id').single();
  if (own) created.documents.push(own.id);
  ok('company admin adds a venture document', !ownErr, ownErr?.message);
  const { error: grpErr } = await coadmin.client.from('documents').insert(docRow(E.LKB, 'group by company admin'));
  ok('company admin cannot add a group document', !!grpErr);
  const { data: grpDocs } = await coadmin.client.from('documents').select('id').eq('id', lkbBoardDoc);
  ok('company admin cannot read group board papers', !grpDocs?.length);
  const { data: regH } = await coadmin.client.from('holdings').select('share_class_id');
  ok('company admin reads the venture register only', regH.length > 0 && regH.every((h) => h.share_class_id === ezfClass.id || V.classes.some((k) => k.id === h.share_class_id)));
  const { error: holdErr } = await coadmin.client.from('holdings').insert({ holder_id: created.holders[0], share_class_id: ezfClass.id, shares: 1, as_at: '2026-07-01' });
  ok('company admin cannot change the register', !!holdErr);
  const { error: annErr } = await coadmin.client.from('announcements').insert({ title: TAG, entity_id: E.LKB });
  ok('company admin cannot post group announcements', !!annErr);
} finally {
  await svc.from('proxy_votes').delete().in('holder_id', created.holders);
  if (created.meetings.length) await svc.from('meetings').delete().in('id', created.meetings);
  if (created.announcements.length) await svc.from('announcements').delete().in('id', created.announcements);
  if (created.posts.length) await svc.from('posts').delete().in('id', created.posts);
  if (created.documents.length) await svc.from('documents').delete().in('id', created.documents);
  if (created.holders.length) await svc.from('holders').delete().in('id', created.holders);
  if (created.classes.length) {
    await svc.from('reference_prices').delete().in('share_class_id', created.classes);
    await svc.from('share_classes').delete().in('id', created.classes);
  }
  await svc.from('announcements').delete().eq('title', TAG);
  for (const id of users) {
    await svc.from('queries').delete().eq('user_id', id);
    await svc.from('audit_log').delete().eq('user_id', id);
    await svc.auth.admin.deleteUser(id);
  }
  console.log('cleaned up');
}
process.exitCode = failed ? 1 : 0;
