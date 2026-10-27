// Importing a company's register of members (read by register-pdf.mjs): match
// its names and classes to the portal's, compare, and optionally apply. Used by
// Admin → Import data → Register of members.
//
// The register is the legal record of who holds what, so for this company it
// gives each holding's shares at the register's date, a 0 at that date for
// holders the register no longer has, and the official shares on issue per
// class. Nothing else changes: people, access, boards, prices, notes and class
// settings stay with the workbook and the screens. Only this company's
// holdings change, never another company's.
//
// Matching, in order: what the admin chose; a name matched on an earlier
// register of this company (register_names); the same name (and trust) in the
// portal; else a suggestion: a holder with the same number of shares in the
// same class, or a similar name. The rest are new holders. Group Admins may
// match a name to any holder; a venture's own admins to holders of their
// company only. Choices are remembered when the register is applied.
//
// The register's movements are each holding's history: they are kept
// (register_movements) and give a dated balance after each movement day. Other
// figures in the portal the register doesn't support (dated after it, which
// would stay "current", or between its movements) are listed, and removed
// unless the admin chooses to keep them.
//
// A sale paired on the portal's trading board (a trade match still being
// arranged) is completed when the register shows it: the seller's transfer out
// of those shares, on or after the pairing, and the buyer's transfer in that day.
import { tidyName } from './register-pdf.mjs';

/** @typedef {{ sheet: string, action: 'add' | 'update' | 'remove' | 'same', item: string, details: string[] }} Change */
/** @typedef {{ holders?: Record<string, string>, classes?: Record<string, string>, later?: 'remove' | 'keep' }} Choices */

const show = (n) => Number(n).toLocaleString('en-AU');
const day = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const sentence = (s) => { const t = String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1).replace(/\(([a-z])/g, (m, c) => `(${c}`); };

/** "Rangelodge Pty Ltd atf Walker Family Trust (Board)" → its name and trust, tidied, with and without what's in brackets. */
function portalPairs(name) {
  const split = (s) => { const m = s.match(/^(.*?)\s+(?:atf|as trustee for|<)\s+(.*?)>?\s*$/i); return m ? [tidyName(m[1]), tidyName(m[2])] : [tidyName(s), '']; };
  const plain = String(name).replace(/\([^)]*\)/g, ' ');
  return [split(String(name)), split(plain)];
}
const words = (s) => new Set(tidyName(s).split(' ').filter((w) => w.length >= 4 && !/^(FAMILY|TRUST|FUND|SUPER|SUPERANNUATION|HOLDINGS|INVESTMENTS?|GROUP|AUSTRALIA|MANAGEMENT|CAPITAL)$/.test(w)));

function classSettings(code, name) {
  const n = `${code} ${name}`.toUpperCase();
  if (/OPTION/.test(n)) return { kind: 'options', voting: false, counts_toward_pct: false };
  if (/PREF/.test(n)) return { kind: 'preference', voting: !/NON[- ]?VOTING/.test(n), counts_toward_pct: true };
  return { kind: 'ordinary', voting: !/NON[- ]?VOTING/.test(n), counts_toward_pct: true };
}

/**
 * @param {{ svc: import('@supabase/supabase-js').SupabaseClient, register: Awaited<ReturnType<typeof import('./register-pdf.mjs').readRegister>>, entityId: string, groupWide: boolean, choices?: Choices | null, apply?: boolean, actorId?: string | null, file?: { name: string, sha256: string, path: string | null } | null }} opts
 */
export async function compareRegister({ svc, register, entityId, groupWide, choices = null, apply = false, actorId = null, file = null }) {
  const all = async (q) => { const { data, error } = await q; if (error) throw error; return data ?? []; };
  const [[entity], classes, savedNames, savedClasses] = await Promise.all([
    all(svc.from('entities').select('id, code, display_name, legal_name, company_number').eq('id', entityId)),
    all(svc.from('share_classes').select('id, code, name, kind, voting, counts_toward_pct, official_on_issue, official_as_at').eq('entity_id', entityId)),
    all(svc.from('register_names').select('name_key, holder_id').eq('entity_id', entityId)),
    all(svc.from('register_classes').select('register_code, share_class_id').eq('entity_id', entityId)),
  ]);
  if (!entity) throw new Error('Company not found');
  const holdings = classes.length ? await all(svc.from('holdings').select('id, holder_id, share_class_id, shares, as_at').in('share_class_id', classes.map((c) => c.id)).range(0, 199999)) : [];
  const inCompany = new Set(holdings.map((h) => h.holder_id));
  const holders = groupWide
    ? await all(svc.from('holders').select('id, name, kind, registry_ref').range(0, 99999))
    : inCompany.size ? await all(svc.from('holders').select('id, name, kind, registry_ref').in('id', [...inCompany])) : [];
  const holderById = new Map(holders.map((h) => [h.id, h]));
  const classById = new Map(classes.map((c) => [c.id, c]));
  const asAt = register.asAt;
  const problems = [];
  const warnings = [];
  /** @type {Change[]} */
  const changes = [];

  // The company: the register's company number, else its name, must be this company's.
  const regNumber = register.company.number;
  const ourNumber = entity.company_number?.replace(/\D/g, '') || null;
  if (regNumber && ourNumber && regNumber !== ourNumber && !ourNumber.endsWith(regNumber)) problems.push(`This register is for company number ${regNumber} (${register.company.name ?? 'no name'}), but ${entity.display_name}’s is ${entity.company_number}. Is it the right company’s register?`);
  else if (!ourNumber && register.company.name && ![entity.legal_name, entity.display_name].some((n) => n && tidyName(n) === tidyName(register.company.name))) warnings.push(`This register is for “${register.company.name}”; ${entity.display_name}’s name in the portal is “${entity.legal_name ?? entity.display_name}”. Check it’s the right company.`);
  if (regNumber && !ourNumber) changes.push({ sheet: 'Company', action: 'update', item: entity.display_name, details: [`Company number: none → ${regNumber} (from the register)`] });

  // Classes.
  const regClasses = Object.entries(register.facts.totals).map(([code, t]) => ({ code, name: t.name, total: t.shares }));
  const savedClass = new Map(savedClasses.map((c) => [c.register_code, c.share_class_id]));
  const classMap = regClasses.map((rc) => {
    const chosen = choices?.classes?.[rc.code];
    let id = null, how = 'new';
    if (chosen && chosen !== 'new' && classById.has(chosen)) { id = chosen; how = 'chosen'; }
    else if (chosen === 'new') how = 'chosen-new';
    else if (savedClass.has(rc.code) && classById.has(savedClass.get(rc.code))) { id = savedClass.get(rc.code); how = 'saved'; }
    else {
      const same = classes.find((c) => c.code.toUpperCase() === rc.code.toUpperCase()) ?? classes.find((c) => tidyName(c.name) === tidyName(rc.name));
      if (same) { id = same.id; how = 'same'; }
    }
    const newCode = rc.code.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
    if (!id && classes.some((c) => c.code.toUpperCase() === newCode)) problems.push(`Class ${rc.code}: ${entity.display_name} already has a class ${newCode}. Choose it, or rename that class first.`);
    return { ...rc, id, how, newCode, newName: sentence(rc.name), settings: classSettings(rc.code, rc.name) };
  });
  for (const c of classMap) if (c.id && classMap.filter((o) => o.id === c.id).length > 1) problems.push(`Register classes ${classMap.filter((o) => o.id === c.id).map((o) => o.code).join(' and ')} are both matched to ${classById.get(c.id).code}.`);
  const classIdOf = (code) => { const c = classMap.find((x) => x.code === code); return c.id ?? `new:${c.code}`; };
  for (const c of classMap) {
    if (!c.id) changes.push({ sheet: 'Share classes', action: 'add', item: `${c.newCode} ${c.newName}`, details: [`New class: ${c.settings.kind}${c.settings.voting ? ', voting' : ', not voting'}${c.settings.counts_toward_pct ? '' : ', doesn’t count toward ownership %'} (change it on the company page)`] });
    const was = c.id ? classById.get(c.id) : null;
    if (!was || Number(was.official_on_issue) !== c.total || was.official_as_at !== asAt) changes.push({ sheet: 'Share classes', action: 'update', item: `${was?.code ?? c.newCode} official on issue`, details: [`${was?.official_on_issue != null ? `${show(was.official_on_issue)} as at ${day(was.official_as_at)}` : 'not set'} → ${show(c.total)} as at ${day(asAt)}`] });
  }
  const mapped = new Set(classMap.map((c) => c.id).filter(Boolean));
  for (const c of classes) if (!mapped.has(c.id)) {
    const n = latestOf(holdings.filter((h) => h.share_class_id === c.id)).reduce((a, h) => a + Number(h.shares), 0);
    if (n) warnings.push(`${c.code} (${c.name}) has ${show(n)} in the portal but isn’t on this register: left as it is.`);
  }

  // Holders: what was chosen, saved, the same name, a suggestion, else new.
  const latestByHolderClass = new Map(latestOf(holdings).map((h) => [`${h.holder_id}|${h.share_class_id}`, h]));
  const savedName = new Map(savedNames.map((n) => [n.name_key, n.holder_id]));
  const candidate = (id) => holderById.has(id) && (groupWide || inCompany.has(id));
  const taken = new Map();
  const rows = register.holders.map((h) => ({ h, holderId: null, how: 'new', why: '' }));
  const take = (row, id, how, why = '') => { row.holderId = id; row.how = how; row.why = why; taken.set(id, [...(taken.get(id) ?? []), row]); };
  const named = (row, test) => {
    const free = holders.filter((p) => !taken.has(p.id) && portalPairs(p.name).some(([n, t]) => test(n, t, tidyName(row.h.name), tidyName(row.h.beneficially_for))));
    const here = free.filter((p) => inCompany.has(p.id));
    return here.length === 1 ? here[0] : !here.length && free.length === 1 ? free[0] : null;
  };
  for (const row of rows) {
    const chosen = choices?.holders?.[row.h.key];
    if (chosen === 'new') { row.how = 'chosen-new'; continue; }
    if (chosen && candidate(chosen)) { take(row, chosen, 'chosen'); continue; }
    if (savedName.has(row.h.key) && candidate(savedName.get(row.h.key))) take(row, savedName.get(row.h.key), 'saved', 'matched on an earlier register');
  }
  // The same name and trust; then the same name where the portal doesn't name the trust.
  for (const test of [(n, t, rn, rt) => n === rn && t === rt, (n, t, rn) => n === rn && !t]) {
    for (const row of rows.filter((r) => r.how === 'new')) { const p = named(row, test); if (p) take(row, p.id, 'name', 'same name'); }
  }
  for (const row of rows.filter((r) => r.how === 'new')) {
    // Never the other side of this member's own transfers (who sold to them is someone else).
    const parties = new Set(row.h.classes.flatMap((c) => c.movements.map((m) => tidyName(m.party)).filter(Boolean)));
    const free = holders.filter((p) => !taken.has(p.id) && !portalPairs(p.name).some(([n]) => parties.has(n)));
    // The same shares in the same class, in this company.
    const byShares = free.filter((p) => inCompany.has(p.id) && row.h.classes.some((c) => c.balance > 0 && Number(latestByHolderClass.get(`${p.id}|${classIdOf(c.code)}`)?.shares) === c.balance));
    if (byShares.length === 1) { take(row, byShares[0].id, 'suggested', 'same shares in the same class'); continue; }
    // A similar name (a distinctive word in common), this company's holders first.
    const mine = words(`${row.h.name} ${row.h.beneficially_for ?? ''}`);
    if (!mine.size) continue;
    const scored = free.map((p) => ({ p, n: [...words(p.name)].filter((w) => mine.has(w)).length, here: inCompany.has(p.id) })).filter((s) => s.n).sort((a, b) => b.n - a.n || Number(b.here) - Number(a.here));
    if (scored.length && (scored.length === 1 || scored[0].n > scored[1].n || (scored[0].here && !scored[1].here))) take(row, scored[0].p.id, 'suggested', 'similar name');
  }
  for (const [id, list] of taken) if (list.length > 1) problems.push(`${list.map((r) => r.h.register_name).join(' and ')} are all matched to ${holderById.get(id).name}. Each register name needs its own holder: choose another, or “New holder”.`);

  // Holdings at the register's date.
  const final = new Map(); // holder|class → { shares, row }
  for (const row of rows) for (const c of row.h.classes) final.set(`${row.holderId ?? `new:${row.h.key}`}|${classIdOf(c.code)}`, { shares: c.balance, row, code: c.code });
  const nameOf = (row) => (row.holderId ? holderById.get(row.holderId).name : newHolderName(row.h));
  for (const row of rows) {
    if (!row.holderId) changes.push({ sheet: 'Holders', action: 'add', item: newHolderName(row.h), details: [`New holder (${row.h.kind.replace('_', ' ')})${row.h.acn ? `, ACN ${row.h.acn}` : ''}`] });
    for (const c of row.h.classes) {
      const cid = classIdOf(c.code);
      const was = row.holderId ? latestByHolderClass.get(`${row.holderId}|${cid}`) : null;
      const code = classById.get(cid)?.code ?? c.code;
      const item = `${nameOf(row)} · ${code}`;
      if (!was) changes.push({ sheet: 'Holdings', action: 'add', item, details: [`${show(c.balance)} as at ${day(asAt)}`] });
      else if (Number(was.shares) !== c.balance) changes.push({ sheet: 'Holdings', action: 'update', item, details: [`${show(was.shares)} (as at ${day(was.as_at)}) → ${show(c.balance)} as at ${day(asAt)}`] });
      else changes.push({ sheet: 'Holdings', action: 'same', item, details: [`${show(c.balance)}${was.as_at !== asAt ? ` (now as at ${day(asAt)})` : ''}`] });
    }
  }
  // Holders the register no longer has, in its classes: 0 at its date.
  for (const [k, h] of latestByHolderClass) {
    if (!mapped.has(h.share_class_id) || final.has(k) || Number(h.shares) === 0) continue;
    final.set(k, { shares: 0, row: null, code: classById.get(h.share_class_id).code });
    changes.push({ sheet: 'Holdings', action: 'update', item: `${holderById.get(h.holder_id)?.name ?? 'A holder'} · ${classById.get(h.share_class_id).code}`, details: [`${show(h.shares)} (as at ${day(h.as_at)}) → 0 as at ${day(asAt)}: not on the register`] });
  }
  // History: the balance at the end of each day with movements, for each holding on the register.
  const rowsByKey = Map.groupBy(holdings, (h) => `${h.holder_id}|${h.share_class_id}`);
  const historyOf = (c) => { const m = new Map(); for (const mv of c.movements) m.set(mv.date, mv.balance); return m; };
  const balanceAt = (c, d) => { let b = 0; for (const mv of c.movements) if (mv.date <= d) b = mv.balance; return b; };
  let datedRows = 0;
  for (const row of rows) for (const c of row.h.classes) {
    const hist = historyOf(c);
    const have = row.holderId ? new Map((rowsByKey.get(`${row.holderId}|${classIdOf(c.code)}`) ?? []).map((h) => [h.as_at, Number(h.shares)])) : new Map();
    const missing = [...hist].filter(([d, b]) => d !== asAt && have.get(d) !== b).length;
    datedRows += hist.size;
    if (missing) changes.push({ sheet: 'History', action: 'add', item: `${nameOf(row)} · ${classById.get(classIdOf(c.code))?.code ?? c.code}`, details: [`${missing} dated balance${missing === 1 ? '' : 's'} from ${c.movements.length} movement${c.movements.length === 1 ? '' : 's'}, ${c.movements[0].date === c.movements.at(-1).date ? `on ${day(c.movements[0].date)}` : `${day(c.movements[0].date)} to ${day(c.movements.at(-1).date)}`}`] });
  }
  // Other figures the register doesn't support: after its date, or between its movements.
  const onRegister = new Map(rows.filter((r) => r.holderId).flatMap((r) => r.h.classes.map((c) => [`${r.holderId}|${classIdOf(c.code)}`, c])));
  const later = holdings.filter((h) => {
    if (!mapped.has(h.share_class_id)) return false;
    const k = `${h.holder_id}|${h.share_class_id}`;
    if (h.as_at > asAt) return Number(final.get(k)?.shares ?? 0) !== Number(h.shares);
    const c = onRegister.get(k);
    return Boolean(c) && h.as_at < asAt && !historyOf(c).has(h.as_at) && balanceAt(c, h.as_at) !== Number(h.shares);
  });
  for (const h of later) {
    const k = `${h.holder_id}|${h.share_class_id}`;
    const said = h.as_at > asAt ? `${show(final.get(k)?.shares ?? 0)} at ${day(asAt)}` : `${show(balanceAt(onRegister.get(k), h.as_at))} at that date`;
    changes.push({ sheet: 'Other figures', action: 'remove', item: `${holderById.get(h.holder_id)?.name ?? 'A holder'} · ${classById.get(h.share_class_id).code}`, details: [`${show(h.shares)} as at ${day(h.as_at)}; the register has ${said}`] });
  }
  const keepLater = choices?.later === 'keep';
  const after = later.filter((h) => h.as_at > asAt).length;
  if (later.length && keepLater) warnings.push(`You chose to keep ${later.length} figure${later.length === 1 ? '' : 's'} the register doesn’t support${after ? `: ${after === 1 ? 'the one' : `the ${after}`} dated after it stay${after === 1 ? 's' : ''} the current figure, not the register’s` : ''}.`);

  // Trades paired in the portal that this register shows as transferred.
  const matches = mapped.size ? await all(svc.from('trade_matches').select('id, share_class_id, shares, created_at, admin_note, sell_id, buy_id').eq('entity_id', entityId).eq('status', 'approved').in('share_class_id', [...mapped])) : [];
  const interests = matches.length ? await all(svc.from('trade_interests').select('id, holder_id').in('id', matches.flatMap((m) => [m.sell_id, m.buy_id]))) : [];
  const holderOfInterest = new Map(interests.map((i) => [i.id, i.holder_id]));
  const rowOfHolder = new Map(rows.filter((r) => r.holderId).map((r) => [r.holderId, r]));
  const movesIn = (row, classId) => (row?.h.classes ?? []).filter((c) => classIdOf(c.code) === classId).flatMap((c) => c.movements);
  const registeredTrades = [];
  for (const m of matches) {
    const seller = rowOfHolder.get(holderOfInterest.get(m.sell_id)), buyer = rowOfHolder.get(holderOfInterest.get(m.buy_id));
    const n = Number(m.shares), since = String(m.created_at).slice(0, 10);
    const sold = movesIn(seller, m.share_class_id).find((mv) => mv.shares === -n && mv.date >= since);
    const bought = sold && movesIn(buyer, m.share_class_id).find((mv) => mv.shares === n && mv.date === sold.date);
    if (!sold || !bought) continue;
    registeredTrades.push({ id: m.id, sell_id: m.sell_id, buy_id: m.buy_id, on: sold.date, note: m.admin_note });
    changes.push({ sheet: 'Trades', action: 'update', item: `${show(n)} ${classById.get(m.share_class_id).code}: ${nameOf(seller)} → ${nameOf(buyer)}`, details: [`Paired on the trading board on ${day(since)}; on the register on ${day(sold.date)}, so it’s completed`] });
  }

  // Totals per class: the portal now, and after.
  const totals = classMap.map((c) => {
    const now = c.id ? latestOf(holdings.filter((h) => h.share_class_id === c.id)).reduce((a, h) => a + Number(h.shares), 0) : 0;
    const keptLater = keepLater ? later.filter((h) => h.share_class_id === c.id && h.as_at > asAt) : [];
    const after = [...final.entries()].filter(([k]) => k.endsWith(`|${classIdOf(c.code)}`)).reduce((a, [k, v]) => a + (keptLater.find((h) => `${h.holder_id}|${h.share_class_id}` === k)?.shares ?? v.shares), 0);
    return { code: c.code, name: c.newName, portal: classById.get(c.id)?.code ?? c.newCode, register: c.total, now, after: Number(after) };
  });

  const matching = rows.map((r) => ({ key: r.h.key, register_name: r.h.register_name, name: r.h.name, newName: newHolderName(r.h), trust: r.h.beneficially_for, acn: r.h.acn, kind: r.h.kind, classes: r.h.classes.map((c) => ({ code: c.code, shares: c.balance })), how: r.how, why: r.why, holderId: r.holderId, holderName: r.holderId ? holderById.get(r.holderId).name : null }));
  const candidates = holders.map((h) => ({ id: h.id, name: h.name, ref: h.registry_ref, here: inCompany.has(h.id) })).sort((a, b) => Number(b.here) - Number(a.here) || a.name.localeCompare(b.name));
  const resolved = { holders: Object.fromEntries(rows.map((r) => [r.h.key, r.holderId ?? 'new'])), classes: Object.fromEntries(classMap.map((c) => [c.code, c.id ?? 'new'])), later: keepLater ? 'keep' : 'remove' };
  const out = { entity, asAt, datedRows, problems, warnings, changes, classes: classMap.map(({ settings, ...c }) => ({ ...c, portal: c.id ? classById.get(c.id).code : null })), allClasses: classes.map((c) => ({ id: c.id, code: c.code, name: c.name })), matching, candidates, totals, choices: resolved, applied: false, changedHolders: /** @type {string[]} */ ([]), importId: null, registeredTrades };
  if (!apply || problems.length) return out;

  // ---------------------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------------------
  if (regNumber && !ourNumber) await svc.from('entities').update({ company_number: regNumber }).eq('id', entityId).throwOnError();
  const classIds = new Map(classMap.filter((c) => c.id).map((c) => [c.code, c.id]));
  for (const c of classMap.filter((x) => !x.id)) {
    const { data } = await svc.from('share_classes').insert({ entity_id: entityId, code: c.newCode, name: c.newName, ...c.settings, currency: 'AUD' }).select('id').single().throwOnError();
    classIds.set(c.code, data.id);
  }
  for (const c of classMap) await svc.from('share_classes').update({ official_on_issue: c.total, official_as_at: asAt }).eq('id', classIds.get(c.code)).throwOnError();
  await svc.from('register_classes').upsert(classMap.map((c) => ({ entity_id: entityId, register_code: c.code, register_name: c.name, share_class_id: classIds.get(c.code) })), { onConflict: 'entity_id,register_code' }).throwOnError();

  // New holders get a register reference: CODE-R0001, CODE-R0002…
  const prefix = `${entity.code}-R`;
  const used = await all(svc.from('holders').select('registry_ref').like('registry_ref', `${prefix}%`));
  let next = Math.max(0, ...used.map((u) => Number(u.registry_ref.slice(prefix.length)) || 0)) + 1;
  const idOfRow = new Map();
  for (const row of rows) {
    if (row.holderId) { idOfRow.set(row, row.holderId); continue; }
    const { data } = await svc.from('holders').insert({ name: newHolderName(row.h), kind: row.h.kind, registry_ref: `${prefix}${String(next++).padStart(4, '0')}` }).select('id, name, registry_ref').single().throwOnError();
    holderById.set(data.id, data);
    idOfRow.set(row, data.id);
  }
  const firstEntry = (h) => h.classes.map((c) => c.entered_on).filter(Boolean).sort()[0] ?? null;
  await svc.from('register_names').upsert(rows.map((row) => ({ entity_id: entityId, name_key: row.h.key, register_name: row.h.register_name, beneficially_for: row.h.beneficially_for, acn: row.h.acn, address: row.h.address, entered_on: firstEntry(row.h), holder_id: idOfRow.get(row), updated_at: new Date().toISOString() })), { onConflict: 'entity_id,name_key' }).throwOnError();

  if (later.length && !keepLater) await svc.from('holdings').delete().in('id', later.map((h) => h.id)).throwOnError();
  const resolveClass = (cid) => (cid.startsWith('new:') ? classIds.get(cid.slice(4)) : cid);
  // Each holding at the register's date, and its balance after each day with movements.
  const writes = new Map();
  const put = (holder_id, share_class_id, as_at, shares) => writes.set(`${holder_id}|${share_class_id}|${as_at}`, { holder_id, share_class_id, shares, as_at });
  for (const row of rows) for (const c of row.h.classes) {
    const cid = resolveClass(classIdOf(c.code));
    for (const [d, b] of historyOf(c)) put(idOfRow.get(row), cid, d, b);
    put(idOfRow.get(row), cid, asAt, c.balance);
  }
  for (const [k, v] of final) if (!v.row) { const [holder_id, share_class_id] = k.split('|'); put(holder_id, share_class_id, asAt, 0); }
  const list = [...writes.values()];
  for (let i = 0; i < list.length; i += 500) await svc.from('holdings').upsert(list.slice(i, i + 500), { onConflict: 'holder_id,share_class_id,as_at' }).throwOnError();

  const { data: imp } = await svc.from('register_imports').insert({
    entity_id: entityId, as_at: asAt, company_name: register.company.name, company_number: regNumber, file_name: file?.name ?? null, file_path: file?.path ?? null, file_sha256: file?.sha256 ?? '',
    holders: rows.length, holdings: register.facts.holdings, movements: register.facts.movements, totals: Object.fromEntries(totals.map((t) => [t.code, t.register])), imported_by: actorId,
  }).select('id').single().throwOnError();

  // The movements, replacing those of the holdings on this register (others keep theirs).
  const pairs = rows.flatMap((row) => row.h.classes.map((c) => ({ row, c, holder_id: idOfRow.get(row), share_class_id: resolveClass(classIdOf(c.code)) })));
  for (let i = 0; i < pairs.length; i += 25) {
    const or = pairs.slice(i, i + 25).map((p) => `and(holder_id.eq.${p.holder_id},share_class_id.eq.${p.share_class_id})`).join(',');
    await svc.from('register_movements').delete().eq('entity_id', entityId).or(or).throwOnError();
  }
  // The other side of a transfer, when they're on this register too.
  const byName = Map.groupBy(rows, (r) => tidyName(r.h.name));
  const partyOf = (party, mv, code) => {
    const named = byName.get(tidyName(party)) ?? [];
    // Two entries of the same name (e.g. with and without a trust): the one with the opposite movement that day.
    const m = named.length > 1 ? named.filter((r) => r.h.classes.some((c) => c.code === code && c.movements.some((o) => o.date === mv.date && o.shares === -mv.shares))) : named;
    return m.length === 1 ? idOfRow.get(m[0]) : null;
  };
  const moves = pairs.flatMap((p) => p.c.movements.map((mv, seq) => ({
    entity_id: entityId, import_id: imp.id, holder_id: p.holder_id, share_class_id: p.share_class_id, seq, moved_on: mv.date, kind: mv.type, shares: mv.shares, balance: mv.balance,
    party: mv.party, party_holder_id: mv.party ? partyOf(mv.party, mv, p.c.code) : null, consideration: mv.consideration, unique_numbers: mv.unique, certificate: mv.certificate,
    paid_per_share: mv.paid, unpaid_per_share: mv.unpaid, beneficial: mv.beneficial,
  })));
  for (let i = 0; i < moves.length; i += 500) await svc.from('register_movements').insert(moves.slice(i, i + 500)).throwOnError();
  for (const t of registeredTrades) {
    await svc.from('trade_matches').update({ status: 'completed', completed_on: t.on, completed_by: actorId, admin_note: [t.note, `Completed from the register of members as at ${day(asAt)}`].filter(Boolean).join(' · ') }).eq('id', t.id).eq('status', 'approved').throwOnError();
  }

  const changedIds = new Set();
  for (const row of rows) for (const c of row.h.classes) {
    const was = row.holderId ? latestByHolderClass.get(`${row.holderId}|${classIdOf(c.code)}`) : null;
    if (!was || Number(was.shares) !== c.balance) changedIds.add(idOfRow.get(row));
  }
  for (const [k, v] of final) if (!v.row) changedIds.add(k.split('|')[0]);
  return { ...out, applied: true, importId: imp.id, changedHolders: [...changedIds].map((id) => holderById.get(id)?.registry_ref).filter(Boolean) };
}

/** A new holder's name: the register's, with its trust ("X atf Y"), in the portal's capitals. */
export function newHolderName(h) { return `${nameCase(h.name)}${h.beneficially_for ? ` atf ${nameCase(h.beneficially_for)}` : ''}`; }

// Registers print names in capitals; the portal writes them "Klockmann Investments Pty Ltd".
// Only words in capitals change (a name already in mixed case is kept); words without a vowel
// stay as they are, being initials (KTF, WSN), except the usual abbreviations.
const SMALL = new Set(['and', 'of', 'the', 'atf', 'for', 'as']);
const ABBREVIATIONS = { LTD: 'Ltd', PTY: 'Pty', MR: 'Mr', MRS: 'Mrs', MS: 'Ms', DR: 'Dr', ST: 'St', JR: 'Jr', SR: 'Sr' };
export function nameCase(name) {
  return String(name).split(/(\s+)/).map((word, i) => {
    if (!/[A-Z]/.test(word) || /[a-z]/.test(word)) return word;
    const bare = word.replace(/[^A-Z]/g, '');
    if (i > 0 && SMALL.has(bare.toLowerCase()) && bare === word) return bare.toLowerCase();
    if (ABBREVIATIONS[bare]) return word.replace(bare, ABBREVIATIONS[bare]);
    if (!/[AEIOUY]/.test(bare)) return word;
    // Each part after a hyphen or apostrophe starts with a capital: Kalinowski-Weaver, O'Hara; and McIntosh.
    return word.toLowerCase().replace(/(^|[-'’(])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bMc([a-z])/g, (m, c) => `Mc${c.toUpperCase()}`);
  }).join('');
}

/** The latest row per holder and class. */
function latestOf(rows) {
  const m = new Map();
  for (const h of rows) { const k = `${h.holder_id}|${h.share_class_id}`; if (!m.has(k) || m.get(k).as_at < h.as_at) m.set(k, h); }
  return [...m.values()];
}
