// Investor data workbook import (Lakeba-investor-data-*.xlsx): parse, check,
// compare with the portal, and optionally apply. Used by
// scripts/import-investors.mjs and Admin → Import data.
//
// The check (apply false) lists every change the file would make: records
// to add, fields to update (old → new) and records in the portal that the
// file no longer has. Applying adds and updates; with remove: true it also
// removes those records, except where removing would lose records that must
// stay (proxy votes, questions, documents, trading), which are kept and
// listed with the reason. Companies are never removed by an import, nor
// anyone with a staff role, nor the person importing.
// Accounts are created without sending email. Staff roles listed on People
// are given (and, when removing, taken away when no longer listed), except
// the group Admin role, which a file never gives or takes; "Company admin" on
// the Boards sheet is the Admin role for that company only. Files exported
// by the portal (investor-export.mjs) read back unchanged.
//
// With a company (scope: a venture's own admins), the file is that company's
// only, and only it can change: its classes, holdings, board, prices and notes;
// its holders and people unless they also belong to another company (those
// are kept as they are, and nobody is given access to a shared holder).
// Relationship, portal access and Lakeba's stake stay Lakeba's; no roles are
// given or taken, and no company admins added. Removals stay inside it.
//
// A company whose holdings come from its register of members (Import data →
// Register of members) keeps them: the file's holdings and official shares on
// issue for it are only compared, and differences are listed, not applied.
import { readXlsx } from './xlsx-read.mjs';

/** @typedef {{ sheet: string, action: 'add' | 'update' | 'remove' | 'keep', item: string, details: string[] }} Change */

/**
 * @param {{ data: Buffer | Uint8Array, name: string, svc: import('@supabase/supabase-js').SupabaseClient, apply: boolean, target: string, remove?: boolean, actorId?: string | null, scope?: { entityId: string, code: string } | null }} opts
 * @returns {Promise<{ lines: string[], problems: string[], warnings: string[], applied: boolean, changes: Change[], changedHolders: string[], latestAsAt: string | null }>}
 */
export async function runImport({ data, name, svc, apply, target, remove = false, actorId = null, scope = null }) {
  const FIRST = 4;
  const cellValue = (v) => (typeof v === 'string' ? v.trim() || null : v ?? null);
  const iso = (v) => {
    if (v == null || v === '') return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : 'invalid';
  };
  const num = (v) => (v == null || v === '' ? null : typeof v === 'number' ? v : Number(String(v).replace(/[,$\s%]/g, '')));
  const yes = (v) => (v == null ? null : String(v).toLowerCase() === 'yes');

  const book = await readXlsx(data);
  function rows(sheetName, optional = false) {
    const ws = book[sheetName];
    if (!ws && optional) return [];
    if (!ws) throw new Error(`Sheet "${sheetName}" not found. Is this the Lakeba investor data workbook?`);
    const headers = [];
    for (const [i, v] of ws.get(2) ?? []) headers[i] = String(cellValue(v) ?? '').replace(/\s*\*$/, '').trim();
    const out = [];
    for (const r of [...ws.keys()].filter((r) => r >= FIRST).sort((a, b) => a - b)) {
      const row = ws.get(r);
      const o = { _row: r };
      let any = false;
      headers.forEach((h, i) => { if (!h) return; const v = cellValue(row.get(i)); o[h] = v; if (v != null && h !== 'Check') any = true; });
      if (any && o[headers[1]] != null) out.push(o);
    }
    return out;
  }

  const problems = [];
  const warn = [];
  const bad = (sheet, row, msg) => problems.push(`${sheet} row ${row._row}: ${msg}`);

  const RELATIONSHIP = { 'Group': 'group', 'Controlled venture': 'controlled', 'Non-controlling investment': 'portfolio' };
  const PORTAL = { 'Full portal': 'full', 'Portfolio entry only': 'portfolio', 'Not in portal': 'none' };
  const CLASS_KIND = { 'Ordinary': 'ordinary', 'Ordinary (non-voting)': 'ordinary', 'Preference': 'preference', 'Options': 'options', 'Convertible note': 'convertible_note', 'SAFE': 'safe', 'Other': 'other' };
  const HOLDER_KIND = { 'Individual': 'individual', 'Company': 'company', 'Trust': 'trust', 'Super fund': 'super_fund' };
  const ACCESS = { 'Owner': 'owner', 'Viewer': 'viewer' };
  const POSITION = { 'Director': 'director', 'Chair': 'chair', 'Company secretary': 'company_secretary', 'Observer': 'observer', 'Company admin': 'admin' };
  const PRICE_SOURCE = { 'Capital raise': 'capital_raise', 'Secondary trade': 'secondary_trade', 'Directors’ valuation': 'valuation', "Directors' valuation": 'valuation' };
  const pick = (map, v, sheet, row, label) => {
    if (v == null) { bad(sheet, row, `${label} is required`); return null; }
    if (!(v in map)) { bad(sheet, row, `${label} “${v}” is not one of: ${Object.keys(map).join(', ')}`); return null; }
    return map[v];
  };

  // ---------------------------------------------------------------------------
  // Parse and validate
  // ---------------------------------------------------------------------------
  const companies = rows('Companies').map((r) => ({
    _row: r._row, code: String(r['Company code'] ?? '').toUpperCase(),
    display_name: r['Display name'] ?? r['Legal name'], legal_name: r['Legal name'], company_number: r['ACN / ABN'] ? String(r['ACN / ABN']) : null,
    country: r['Country'] ?? 'Australia',
    relationship: pick(RELATIONSHIP, r['Relationship'], 'Companies', r, 'Relationship'),
    portal: pick(PORTAL, r['Portal access'], 'Companies', r, 'Portal access'),
    lakeba_stake: r['Lakeba stake (stated)'] == null ? null : Math.round(num(r['Lakeba stake (stated)']) * 10000) / 100,
    stake_as_at: iso(r['Stake as at']), website: r['Website'],
  }));
  for (const c of companies) {
    if (!/^[A-Z0-9]{2,8}$/.test(c.code)) bad('Companies', c, `company code “${c.code}” must be 2–8 capital letters or digits`);
    if (!c.legal_name && !c.display_name) bad('Companies', c, 'legal name is required');
    if (c.stake_as_at === 'invalid') bad('Companies', c, 'stake as-at date is not a date');
    if (c.relationship === 'group' && c.portal !== 'full') bad('Companies', c, 'the group must have Full portal access');
  }
  if (scope) {
    if (companies.length !== 1 || companies[0].code !== scope.code) problems.push(`Companies: this workbook is for ${scope.code} only: the Companies sheet must have just its row`);
  } else if (companies.filter((c) => c.relationship === 'group').length !== 1) problems.push('Companies: exactly one company must be the Group');
  const companyCodes = new Set(companies.map((c) => c.code));

  const classes = rows('Share classes').map((r) => {
    const full = String(r['Class code'] ?? '').toUpperCase();
    const company = String(r['Company code'] ?? '').toUpperCase();
    const c = {
      _row: r._row, full, company, code: full.startsWith(`${company}-`) ? full.slice(company.length + 1) : null,
      name: r['Class name'], kind: pick(CLASS_KIND, r['Type'], 'Share classes', r, 'Type'),
      voting: yes(r['Voting']), counts_toward_pct: yes(r['Counts toward %']),
      official_on_issue: num(r['Official on issue']), official_as_at: iso(r['Official as at']), currency: r['Currency'] ?? 'AUD',
    };
    if (!companyCodes.has(company)) bad('Share classes', r, `unknown company ${company}`);
    if (!c.code) bad('Share classes', r, `class code ${full} must start with the company code (${company}-…)`);
    if (!c.name) bad('Share classes', r, 'class name is required');
    if (c.voting == null || c.counts_toward_pct == null) bad('Share classes', r, 'Voting and Counts toward % must be Yes or No');
    if ((c.official_on_issue == null) !== (c.official_as_at == null)) bad('Share classes', r, 'official on issue and its as-at date go together');
    if (c.official_as_at === 'invalid') bad('Share classes', r, 'official as-at is not a date');
    return c;
  });
  const classByFull = new Map(classes.map((c) => [c.full, c]));

  const holders = rows('Holders').map((r) => ({
    _row: r._row, ref: String(r['Holder ID'] ?? ''), name: r['Holder name (as on register)'],
    kind: pick(HOLDER_KIND, r['Kind'], 'Holders', r, 'Kind'), detail: r['ACN / ABN / trust details'],
  }));
  for (const h of holders) if (!h.name) bad('Holders', h, 'holder name is required');
  const holderRefs = new Set(holders.map((h) => h.ref));

  // Roles: "Board, Legal (EZF)" (older files: a "Portal role" of Investor, Board or Admin).
  const people = rows('People').map((r) => {
    const listed = r['Roles'] !== undefined ? String(r['Roles'] ?? '') : r['Portal role'] && r['Portal role'] !== 'Investor' ? String(r['Portal role']) : '';
    return {
      _row: r._row, email: String(r['Email'] ?? '').toLowerCase(), first_name: r['First name'] ?? '', last_name: r['Last name'] ?? '',
      phone: r['Phone'] ? String(r['Phone']) : null, notify_email: r['Email notifications'] == null ? true : yes(r['Email notifications']),
      roleNames: listed.split(',').map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== 'investor').map((x) => { const m = x.match(/^(.*?)\s*\(([A-Za-z0-9]+)\)$/); return m ? { name: m[1], company: m[2].toUpperCase() } : { name: x, company: null }; }),
    };
  });
  for (const p of people) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) bad('People', p, `“${p.email}” is not an email address`);
  }
  const emails = new Set(people.map((p) => p.email));

  const access = rows('Access').map((r) => ({ _row: r._row, email: String(r['Email'] ?? '').toLowerCase(), ref: String(r['Holder ID'] ?? ''), access: pick(ACCESS, r['Access'], 'Access', r, 'Access') }));
  for (const a of access) {
    if (!emails.has(a.email)) bad('Access', a, `email ${a.email} is not on the People sheet`);
    if (!holderRefs.has(a.ref)) bad('Access', a, `holder ${a.ref} is not on the Holders sheet`);
  }

  const holdings = rows('Holdings').map((r) => ({
    _row: r._row, ref: String(r['Holder ID'] ?? ''), full: String(r['Class code'] ?? '').toUpperCase(),
    shares: num(r['Shares']), as_at: iso(r['As at']), notes: r['Notes'],
    exercise_price: num(r['Exercise price']), expires_on: iso(r['Expires on']),
  }));
  for (const h of holdings) {
    if (!holderRefs.has(h.ref)) bad('Holdings', h, `holder ${h.ref} is not on the Holders sheet`);
    if (!classByFull.has(h.full)) bad('Holdings', h, `class ${h.full} is not on the Share classes sheet`);
    if (!Number.isInteger(h.shares) || h.shares < 0) bad('Holdings', h, 'shares must be a whole number, 0 or more');
    if (!h.as_at || h.as_at === 'invalid') bad('Holdings', h, 'as-at date is required');
    if (h.exercise_price != null && Number.isNaN(h.exercise_price)) bad('Holdings', h, 'exercise price is not a number');
    if (h.expires_on === 'invalid') bad('Holdings', h, 'expiry is not a date');
  }

  const holdingNotes = rows('Holding notes', true).map((r) => ({ _row: r._row, ref: String(r['Holder ID'] ?? ''), full: String(r['Class code'] ?? '').toUpperCase(), note: r['Note'] }));
  for (const n of holdingNotes) {
    if (!holderRefs.has(n.ref)) bad('Holding notes', n, `holder ${n.ref} is not on the Holders sheet`);
    if (!classByFull.has(n.full)) bad('Holding notes', n, `class ${n.full} is not on the Share classes sheet`);
    if (!n.note) bad('Holding notes', n, 'the note is empty');
  }

  const boards = rows('Boards').map((r) => ({
    _row: r._row, company: String(r['Company code'] ?? '').toUpperCase(), email: String(r['Email'] ?? '').toLowerCase(),
    position: pick(POSITION, r['Position'], 'Boards', r, 'Position'), starts_on: iso(r['From']), ends_on: iso(r['To']),
  }));
  for (const b of boards) {
    if (!companyCodes.has(b.company)) bad('Boards', b, `unknown company ${b.company}`);
    if (!emails.has(b.email)) bad('Boards', b, `email ${b.email} is not on the People sheet`);
  }

  const prices = rows('Prices').map((r) => ({
    _row: r._row, full: String(r['Class code'] ?? '').toUpperCase(), price: num(r['Price per share']), currency: r['Currency'] ?? 'AUD',
    priced_on: iso(r['Priced on']), source: pick(PRICE_SOURCE, r['Source'], 'Prices', r, 'Source'), note: r['Note'],
  }));
  for (const p of prices) {
    if (!classByFull.has(p.full)) bad('Prices', p, `class ${p.full} is not on the Share classes sheet`);
    if (p.price == null || Number.isNaN(p.price)) bad('Prices', p, 'price is required');
    if (!p.priced_on || p.priced_on === 'invalid') bad('Prices', p, 'priced-on date is required');
  }

  const dupes = (list, key, sheet, label) => {
    const seen = new Map();
    for (const x of list) { const k = key(x); if (seen.has(k)) bad(sheet, x, `duplicate ${label} (also row ${seen.get(k)})`); else seen.set(k, x._row); }
  };
  dupes(companies, (c) => c.code, 'Companies', 'company code');
  dupes(classes, (c) => c.full, 'Share classes', 'class code');
  dupes(holders, (h) => h.ref, 'Holders', 'holder ID');
  dupes(people, (p) => p.email, 'People', 'email');
  dupes(access, (a) => `${a.email}|${a.ref}`, 'Access', 'link');
  dupes(holdings, (h) => `${h.ref}|${h.full}|${h.as_at}`, 'Holdings', 'holding (same holder, class and date)');
  dupes(prices, (p) => `${p.full}|${p.priced_on}|${p.source}`, 'Prices', 'price');
  dupes(holdingNotes, (n) => `${n.ref}|${n.full}`, 'Holding notes', 'note (same holder and class)');

  // ---------------------------------------------------------------------------
  // Compare with the portal
  // ---------------------------------------------------------------------------
  const all = async (q) => { const { data, error } = await q; if (error) throw error; return data ?? []; };
  const [dbEntities, dbClasses, dbHolders, dbProfiles, dbMembers, dbHoldings, dbRoles, dbUserRoles, dbNotes, dbBoard, dbPrices] = await Promise.all([
    all(svc.from('entities').select('*')),
    all(svc.from('share_classes').select('*')),
    all(svc.from('holders').select('*')),
    all(svc.from('profiles').select('id, email, first_name, last_name, phone, notify_email').range(0, 99999)),
    all(svc.from('holder_members').select('holder_id, user_id, access').range(0, 99999)),
    all(svc.from('holdings').select('id, holder_id, share_class_id, shares, as_at, exercise_price, expires_on').range(0, 199999)),
    all(svc.from('roles').select('key, name')),
    all(svc.from('user_roles').select('id, user_id, role_key, entity_id, expires_at')),
    all(svc.from('holding_notes').select('holder_id, share_class_id, note')),
    all(svc.from('entity_board').select('*')),
    all(svc.from('reference_prices').select('*')),
  ]);
  const entityByCode = new Map(dbEntities.map((e) => [e.code, e]));
  const entityById = new Map(dbEntities.map((e) => [e.id, e]));
  const holderByRef = new Map(dbHolders.map((h) => [h.registry_ref, h]));
  // Holders created in the portal without a register reference are exported as PORTAL-<first 8 of their id>.
  const fileRefOf = (h) => h.registry_ref || `PORTAL-${h.id.slice(0, 8)}`;
  for (const h of dbHolders) if (!h.registry_ref) holderByRef.set(fileRefOf(h), h);
  const holderById = new Map(dbHolders.map((h) => [h.id, h]));
  const profileByEmail = new Map(dbProfiles.map((p) => [p.email.toLowerCase(), p]));
  const profileById = new Map(dbProfiles.map((p) => [p.id, p]));
  const classKey = (entityId, code) => `${entityId}|${code}`;
  const dbClassByKey = new Map(dbClasses.map((c) => [classKey(c.entity_id, c.code), c]));
  const classFull = (c) => `${entityById.get(c.entity_id)?.code}-${c.code}`;
  const classById = new Map(dbClasses.map((c) => [c.id, c]));
  const dbClassOf = (full) => { const c = classByFull.get(full); const e = c && entityByCode.get(c.company); return e ? dbClassByKey.get(classKey(e.id, c.code)) : undefined; };
  const roleNameOf = new Map(dbRoles.map((r) => [r.key, r.name]));
  const now = new Date().toISOString();
  const liveRoles = dbUserRoles.filter((r) => !r.expires_at || r.expires_at > now);

  // Roles named on People: known roles only; the group Admin role is never given or taken from a file.
  const roleByName = new Map(dbRoles.flatMap((r) => [[r.name.toLowerCase(), r.key], [r.key.toLowerCase(), r.key]]));
  for (const p of people) {
    p.roles = [];
    for (const x of p.roleNames) {
      const key = roleByName.get(x.name.toLowerCase());
      if (!key) { bad('People', p, `role “${x.name}” doesn’t exist (System → Roles)`); continue; }
      if (x.company && !companyCodes.has(x.company)) { bad('People', p, `role ${x.name}: unknown company ${x.company}`); continue; }
      if (key === 'admin') {
        const uid = profileByEmail.get(p.email)?.id;
        const eid = x.company ? entityByCode.get(x.company)?.id ?? null : null;
        if (uid && liveRoles.some((r) => r.user_id === uid && r.role_key === 'admin' && (r.entity_id ?? null) === eid)) continue; // already has it
        warn.push(`People row ${p._row}: ${p.email} is listed as Admin${x.company ? ` (${x.company})` : ''}. Not given from a file: use System → Users${x.company ? ', or Position “Company admin” on the Boards sheet' : ''}.`);
        continue;
      }
      p.roles.push({ key, company: x.company });
    }
  }

  /** @type {Change[]} */
  const changes = [];
  const n = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 6 });
  const show = (v) => (v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' ? n.format(v) : String(v));
  const norm = (v) => (v == null || v === '' ? null : typeof v === 'number' ? v : /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : String(v));
  const fieldChanges = (row, db, fields) => fields.filter(([k]) => norm(row[k]) !== norm(db[k])).map(([k, label]) => `${label}: ${show(db[k])} → ${show(row[k])}`);
  const add = (sheet, item, details = []) => changes.push({ sheet, action: 'add', item, details });
  const upd = (sheet, item, details) => { if (details.length) changes.push({ sheet, action: 'update', item, details }); };
  const del = (sheet, item, details = []) => changes.push({ sheet, action: 'remove', item, details });
  const keep = (sheet, item, why) => changes.push({ sheet, action: 'keep', item, details: [why] });

  // One company only (scope): what it may change, and what stays as it is because it also belongs elsewhere.
  const own = { classIds: new Set(), holderIds: new Set(), sharedHolders: new Set(), people: new Set(), sharedPeople: new Set() };
  if (scope) {
    for (const c of dbClasses) if (c.entity_id === scope.entityId) own.classIds.add(c.id);
    for (const h of dbHoldings) (own.classIds.has(h.share_class_id) ? own.holderIds : own.sharedHolders).add(h.holder_id);
    for (const h of dbHolders) if (h.represents_entity_id) own.sharedHolders.add(h.id);
    for (const m of dbMembers) {
      if (own.holderIds.has(m.holder_id)) own.people.add(m.user_id);
      if (own.sharedHolders.has(m.holder_id)) own.sharedPeople.add(m.user_id);
    }
    for (const b of dbBoard) (b.entity_id === scope.entityId ? own.people : own.sharedPeople).add(b.user_id);
    for (const r of liveRoles) { own.sharedPeople.add(r.user_id); if (r.role_key === 'admin' && r.entity_id === scope.entityId) own.people.add(r.user_id); }
    const isShared = (h) => own.sharedHolders.has(h.id);

    for (const c of companies) {
      const db = entityByCode.get(c.code);
      if (!db) { bad('Companies', c, `${c.code} isn’t in the portal: only Lakeba adds companies`); continue; }
      for (const [k, label] of [['relationship', 'Relationship'], ['portal', 'Portal access'], ['lakeba_stake', 'Lakeba stake'], ['stake_as_at', 'Stake as at']]) {
        if (norm(c[k]) !== norm(db[k])) warn.push(`Companies row ${c._row}: ${label} is set by Lakeba, so the file’s value is ignored.`);
        c[k] = db[k];
      }
    }
    for (const c of classes) if (c.company !== scope.code) bad('Share classes', c, `class ${c.full} isn’t ${scope.code}’s`);
    for (const [sheet, list] of [['Holdings', holdings], ['Prices', prices], ['Holding notes', holdingNotes]]) {
      for (const x of list) if (classByFull.get(x.full) && classByFull.get(x.full).company !== scope.code) bad(sheet, x, `class ${x.full} isn’t ${scope.code}’s`);
    }
    for (const b of [...boards]) {
      if (b.company !== scope.code) { bad('Boards', b, `company ${b.company} isn’t ${scope.code}`); continue; }
      if (b.position !== 'admin') continue;
      const u = profileByEmail.get(b.email);
      if (!(u && liveRoles.some((r) => r.user_id === u.id && r.role_key === 'admin' && r.entity_id === scope.entityId))) {
        warn.push(`Boards row ${b._row}: ${b.email} isn’t made a company admin from a file. Lakeba gives that role (System → Users).`);
        boards.splice(boards.indexOf(b), 1);
      }
    }
    for (const h of holders) {
      const db = holderByRef.get(h.ref);
      if (!db && h.ref.endsWith('-GROUP')) bad('Holders', h, `${h.ref} would stand for a company: only Lakeba adds those`);
      if (db && isShared(db) && (norm(h.name) !== norm(db.name) || norm(h.kind) !== norm(db.kind))) bad('Holders', h, `${h.ref} also holds shares in another company (or stands for one), so its name and kind are kept as they are`);
    }
    for (const a of access) {
      const h = holderByRef.get(a.ref); const u = profileByEmail.get(a.email);
      if (!h || !isShared(h)) continue;
      const db = u && dbMembers.find((m) => m.holder_id === h.id && m.user_id === u.id);
      if (!db || db.access !== a.access) bad('Access', a, `${a.ref} also holds shares in another company, so who sees it is changed by Lakeba`);
    }
    for (const p of people) {
      if (p.roleNames.length) warn.push(`People row ${p._row}: roles are given by Lakeba (System → Users), so the Roles column is ignored.`);
      p.roles = [];
      const db = profileByEmail.get(p.email);
      if (db && own.sharedPeople.has(db.id) && fieldChanges(p, db, [['first_name', ''], ['last_name', ''], ['phone', ''], ['notify_email', '']]).length) bad('People', p, `${p.email} also belongs to another company (or has a role), so their details are kept as they are`);
    }
  }
  const sharedHolder = (id) => Boolean(scope) && own.sharedHolders.has(id);
  const ownHolder = (id) => !scope || (own.holderIds.has(id) && !own.sharedHolders.has(id));
  const ownPerson = (id) => !scope || (own.people.has(id) && !own.sharedPeople.has(id));
  const ownClass = (id) => !scope || own.classIds.has(id);

  // Companies
  for (const c of companies) {
    const db = entityByCode.get(c.code);
    if (!db) add('Companies', `${c.code} ${c.display_name ?? ''}`.trim(), [c.legal_name, c.relationship, c.portal].filter(Boolean));
    else upd('Companies', `${c.code} ${c.display_name ?? ''}`.trim(), fieldChanges(c, db, [['display_name', 'Display name'], ['legal_name', 'Legal name'], ['company_number', 'ACN / ABN'], ['country', 'Country'], ['relationship', 'Relationship'], ['portal', 'Portal access'], ['lakeba_stake', 'Lakeba stake %'], ['stake_as_at', 'Stake as at'], ['website', 'Website']]));
  }
  for (const e of dbEntities) if (!companyCodes.has(e.code) && !scope) keep('Companies', `${e.code} ${e.display_name}`, 'Not in the file. Companies are never removed by an import (their documents, news and meetings would go too).');

  // Companies whose holdings come from their register of members: compared only.
  const fromRegister = new Set(dbEntities.filter((e) => e.holdings_from_register).map((e) => e.id));
  const registerClass = (classId) => fromRegister.has(classById.get(classId)?.entity_id);
  const notApplied = new Map(); // company code → [what the file would have changed]
  const skip = (classId, what) => { const code = entityById.get(classById.get(classId).entity_id).code; notApplied.set(code, [...(notApplied.get(code) ?? []), what]); };

  // Share classes
  for (const c of classes) {
    const db = dbClassOf(c.full);
    if (db && registerClass(db.id) && (Number(c.official_on_issue ?? NaN) !== Number(db.official_on_issue ?? NaN) || (c.official_as_at ?? null) !== (db.official_as_at ?? null))) {
      if (c.official_on_issue != null || db.official_on_issue != null) skip(db.id, `${c.full} official on issue`);
      c.official_on_issue = db.official_on_issue; c.official_as_at = db.official_as_at;
    }
    if (!db) add('Share classes', `${c.full} ${c.name ?? ''}`.trim(), [c.kind, c.voting ? 'voting' : 'non-voting']);
    else upd('Share classes', `${c.full} ${c.name ?? ''}`.trim(), fieldChanges(c, db, [['name', 'Name'], ['kind', 'Type'], ['voting', 'Voting'], ['counts_toward_pct', 'Counts toward %'], ['official_on_issue', 'Official on issue'], ['official_as_at', 'Official as at'], ['currency', 'Currency']]));
  }

  // Holders
  for (const h of holders) {
    const db = holderByRef.get(h.ref);
    if (!db) add('Holders', `${h.ref} ${h.name ?? ''}`.trim(), [h.kind]);
    else upd('Holders', `${h.ref} ${h.name ?? ''}`.trim(), fieldChanges(h, db, [['name', 'Name'], ['kind', 'Kind']]));
  }

  // People and their roles
  const roleLabel = (r) => `${roleNameOf.get(r.role_key ?? r.key) ?? r.role_key ?? r.key}${(r.entity_id ?? r.company) ? ` (${r.company ?? entityById.get(r.entity_id)?.code})` : ''}`;
  const roleRemovals = [];
  for (const p of people) {
    const db = profileByEmail.get(p.email);
    const wanted = p.roles.map((r) => ({ ...r, entity_id: r.company ? entityByCode.get(r.company)?.id ?? null : null }));
    const has = db ? liveRoles.filter((r) => r.user_id === db.id) : [];
    const adds = wanted.filter((w) => !has.some((r) => r.role_key === w.key && (r.entity_id ?? null) === (w.entity_id ?? null)));
    // Listed roles are the person's staff roles, except Admin (group: never from a file; company: on the Boards sheet).
    const drops = has.filter((r) => r.role_key !== 'admin' && !wanted.some((w) => w.key === r.role_key && (w.entity_id ?? null) === (r.entity_id ?? null)));
    const roleDetails = adds.map((r) => `Role added: ${roleLabel(r)}`);
    if (!db) add('People', p.email, [[p.first_name, p.last_name].filter(Boolean).join(' '), ...roleDetails].filter(Boolean));
    else upd('People', p.email, [...fieldChanges(p, db, [['first_name', 'First name'], ['last_name', 'Last name'], ['phone', 'Phone'], ['notify_email', 'Email notifications']]), ...roleDetails]);
    // Roles no longer listed: taken away only when removing.
    for (const r of db && !scope ? drops : []) { roleRemovals.push(r); del('People', `${p.email}: ${roleLabel(r)} role`, ['role taken away']); }
  }

  // Access
  const memberKey = (userId, holderId) => `${userId}|${holderId}`;
  const dbMemberMap = new Map(dbMembers.map((m) => [memberKey(m.user_id, m.holder_id), m]));
  const fileMemberKeys = new Set();
  for (const a of access) {
    const u = profileByEmail.get(a.email); const h = holderByRef.get(a.ref);
    const db = u && h && dbMemberMap.get(memberKey(u.id, h.id));
    if (u && h) fileMemberKeys.add(memberKey(u.id, h.id));
    if (!db) add('Access', `${a.email} → ${a.ref}`, [a.access]);
    else if (db.access !== a.access) upd('Access', `${a.email} → ${a.ref}`, [`Access: ${db.access} → ${a.access}`]);
  }

  // Holdings
  const holdingKey = (holderId, classId, asAt) => `${holderId}|${classId}|${asAt}`;
  const dbHoldingMap = new Map(dbHoldings.map((h) => [holdingKey(h.holder_id, h.share_class_id, h.as_at), h]));
  const fileHoldingKeys = new Set();
  const changedHolderRefs = new Set();
  let latestAsAt = null;
  for (const h of holdings) {
    const holder = holderByRef.get(h.ref); const dbClass = dbClassOf(h.full);
    const db = holder && dbClass && dbHoldingMap.get(holdingKey(holder.id, dbClass.id, h.as_at));
    if (holder && dbClass) fileHoldingKeys.add(holdingKey(holder.id, dbClass.id, h.as_at));
    const item = `${h.ref} ${h.full} as at ${h.as_at}`;
    // From the register: the shares and their dates stay; exercise price and expiry still come from the file.
    if (dbClass && registerClass(dbClass.id) && (!db || Number(db.shares) !== h.shares)) {
      h.fromRegister = true;
      skip(dbClass.id, `${item}: ${db ? `${show(Number(db.shares))} → ` : ''}${show(h.shares)}`);
      continue;
    }
    const before = changes.length;
    if (!db) add('Holdings', item, [`${show(h.shares)} shares`, h.exercise_price != null ? `exercise ${show(h.exercise_price)}` : '', h.expires_on ? `expires ${h.expires_on}` : ''].filter(Boolean));
    else upd('Holdings', item, fieldChanges({ ...h, expires_on: h.expires_on === 'invalid' ? null : h.expires_on }, db, [['shares', 'Shares'], ['exercise_price', 'Exercise price'], ['expires_on', 'Expires on']]));
    if (changes.length > before) { changedHolderRefs.add(h.ref); if (!latestAsAt || h.as_at > latestAsAt) latestAsAt = h.as_at; }
  }

  // Boards (positions) and company admins
  const boardKey = (eid, uid, pos) => `${eid}|${uid}|${pos}`;
  const dbBoardMap = new Map(dbBoard.map((b) => [boardKey(b.entity_id, b.user_id, b.position), b]));
  const fileBoardKeys = new Set(); const fileCompanyAdmins = new Set();
  for (const b of boards) {
    const e = entityByCode.get(b.company); const u = profileByEmail.get(b.email);
    const item = `${b.company} · ${b.email} · ${b.position === 'admin' ? 'Company admin' : b.position}`;
    if (b.position === 'admin') {
      if (e && u) fileCompanyAdmins.add(`${u.id}|${e.id}`);
      if (!(e && u && liveRoles.some((r) => r.user_id === u.id && r.role_key === 'admin' && r.entity_id === e.id))) add('Boards', item, ['Admin role for this company']);
      continue;
    }
    const db = e && u && dbBoardMap.get(boardKey(e.id, u.id, b.position));
    if (e && u) fileBoardKeys.add(boardKey(e.id, u.id, b.position));
    if (!db) add('Boards', item, [b.starts_on ? `from ${b.starts_on}` : '', b.ends_on ? `to ${b.ends_on}` : ''].filter(Boolean));
    else upd('Boards', item, fieldChanges(b, db, [['starts_on', 'From'], ['ends_on', 'To']]));
  }

  // Prices
  const priceKey = (classId, on, src) => `${classId}|${on}|${src}`;
  const dbPriceMap = new Map(dbPrices.map((p) => [priceKey(p.share_class_id, p.priced_on, p.source), p]));
  const filePriceKeys = new Set();
  for (const p of prices) {
    const dbClass = dbClassOf(p.full);
    const db = dbClass && dbPriceMap.get(priceKey(dbClass.id, p.priced_on, p.source));
    if (dbClass) filePriceKeys.add(priceKey(dbClass.id, p.priced_on, p.source));
    const item = `${p.full} ${p.priced_on} (${p.source})`;
    if (!db) add('Prices', item, [`${show(p.price)} ${p.currency}`]);
    else upd('Prices', item, fieldChanges(p, db, [['price', 'Price'], ['currency', 'Currency'], ['note', 'Note']]));
  }

  // Holding notes (only when the file has the sheet)
  const hasNotesSheet = Boolean(book['Holding notes']);
  const noteKey = (hid, cid) => `${hid}|${cid}`;
  const dbNoteMap = new Map(dbNotes.map((x) => [noteKey(x.holder_id, x.share_class_id), x]));
  const fileNoteKeys = new Set();
  for (const x of holdingNotes) {
    const holder = holderByRef.get(x.ref); const dbClass = dbClassOf(x.full);
    const db = holder && dbClass && dbNoteMap.get(noteKey(holder.id, dbClass.id));
    if (holder && dbClass) fileNoteKeys.add(noteKey(holder.id, dbClass.id));
    if (!db) add('Holding notes', `${x.ref} ${x.full}`, [x.note]);
    else if (db.note !== x.note) upd('Holding notes', `${x.ref} ${x.full}`, [`Note: ${db.note} → ${x.note}`]);
  }

  // ---------------------------------------------------------------------------
  // In the portal but not in the file: removed when asked, unless that would lose records that must stay
  // ---------------------------------------------------------------------------
  const ids = (list) => [...new Set(list)];
  const [votesByHolder, docsByHolder, tradesByHolder, votesByUser, questionsByUser, meetingQsByUser, tradeClasses] = await Promise.all([
    all(svc.from('proxy_votes').select('holder_id').range(0, 199999)).then((r) => new Set(r.map((x) => x.holder_id))),
    all(svc.from('documents').select('holder_id').not('holder_id', 'is', null)).then((r) => new Set(r.map((x) => x.holder_id))),
    all(svc.from('trade_interests').select('holder_id, share_class_id')).then((r) => r),
    all(svc.from('proxy_votes').select('lodged_by').range(0, 199999)).then((r) => new Set(r.map((x) => x.lodged_by))),
    all(svc.from('queries').select('user_id')).then((r) => new Set(r.map((x) => x.user_id))),
    all(svc.from('meeting_questions').select('user_id')).then((r) => new Set(r.map((x) => x.user_id))),
    all(svc.from('trade_matches').select('share_class_id')).then((r) => new Set(r.map((x) => x.share_class_id))),
  ]);
  const removal = { members: [], holdings: [], board: [], companyAdmins: [], prices: [], notes: [], holders: [], classes: [], people: [], roles: roleRemovals };
  const refOfId = (id) => fileRefOf(holderById.get(id) ?? { id, registry_ref: null });
  for (const m of dbMembers) if (ownHolder(m.holder_id) && !fileMemberKeys.has(memberKey(m.user_id, m.holder_id)) && profileById.get(m.user_id) && !profileById.get(m.user_id).email.toLowerCase().endsWith('@lakeba.test')) {
    removal.members.push(m); del('Access', `${profileById.get(m.user_id).email} → ${refOfId(m.holder_id)}`, [m.access]);
  }
  for (const h of dbHoldings) if (ownClass(h.share_class_id) && registerClass(h.share_class_id) && !fileHoldingKeys.has(holdingKey(h.holder_id, h.share_class_id, h.as_at))) skip(h.share_class_id, `${refOfId(h.holder_id)} ${classFull(classById.get(h.share_class_id))} as at ${h.as_at}: not in the file`);
  for (const [code, list] of notApplied) warn.push(`${entityByCode.get(code)?.display_name ?? code}’s holdings come from its register of members, so the file’s ${list.length} difference${list.length === 1 ? '' : 's'} in its holdings or shares on issue ${list.length === 1 ? 'isn’t' : 'aren’t'} imported (import a newer register instead): ${list.slice(0, 8).join('; ')}${list.length > 8 ? `; and ${list.length - 8} more` : ''}.`);
  for (const h of dbHoldings) if (ownClass(h.share_class_id) && !registerClass(h.share_class_id) && !fileHoldingKeys.has(holdingKey(h.holder_id, h.share_class_id, h.as_at))) {
    removal.holdings.push(h); del('Holdings', `${refOfId(h.holder_id)} ${classById.get(h.share_class_id) ? classFull(classById.get(h.share_class_id)) : '?'} as at ${h.as_at}`, [`${show(Number(h.shares))} shares`]);
  }
  for (const b of dbBoard) if ((!scope || b.entity_id === scope.entityId) && !fileBoardKeys.has(boardKey(b.entity_id, b.user_id, b.position)) && profileById.get(b.user_id)) {
    removal.board.push(b); del('Boards', `${entityById.get(b.entity_id)?.code} · ${profileById.get(b.user_id).email} · ${b.position}`);
  }
  for (const r of liveRoles) if (!scope && r.role_key === 'admin' && r.entity_id && !fileCompanyAdmins.has(`${r.user_id}|${r.entity_id}`) && profileById.get(r.user_id)) {
    removal.companyAdmins.push(r); del('Boards', `${entityById.get(r.entity_id)?.code} · ${profileById.get(r.user_id).email} · Company admin`, ['Admin role for this company']);
  }
  for (const p of dbPrices) if (ownClass(p.share_class_id) && !filePriceKeys.has(priceKey(p.share_class_id, p.priced_on, p.source))) {
    removal.prices.push(p); del('Prices', `${classById.get(p.share_class_id) ? classFull(classById.get(p.share_class_id)) : '?'} ${p.priced_on} (${p.source})`, [`${show(Number(p.price))} ${p.currency}`]);
  }
  if (hasNotesSheet) for (const x of dbNotes) if (ownClass(x.share_class_id) && !fileNoteKeys.has(noteKey(x.holder_id, x.share_class_id))) {
    removal.notes.push(x); del('Holding notes', `${refOfId(x.holder_id)} ${classById.get(x.share_class_id) ? classFull(classById.get(x.share_class_id)) : '?'}`, [x.note]);
  }
  for (const h of dbHolders) {
    if (holderRefs.has(fileRefOf(h)) || !ownHolder(h.id) || (scope && !own.holderIds.has(h.id))) continue;
    const item = `${fileRefOf(h)} ${h.name}`;
    const why = votesByHolder.has(h.id) ? 'it has proxy votes (meeting records)' : docsByHolder.has(h.id) ? 'documents were published just for this holder' : tradesByHolder.some((t) => t.holder_id === h.id) ? 'it has secondary trading records' : '';
    if (why) keep('Holders', item, `Not in the file, but kept: ${why}.`);
    else { removal.holders.push(h); del('Holders', item, ['with its holdings, access links and notes']); }
  }
  const staff = new Set(liveRoles.map((r) => r.user_id));
  for (const p of dbProfiles) {
    if (emails.has(p.email.toLowerCase()) || p.email.toLowerCase().endsWith('@lakeba.test') || !ownPerson(p.id)) continue;
    const why = p.id === actorId ? 'that’s you' : staff.has(p.id) ? 'they have a staff role (remove it in System → Users first)' : votesByUser.has(p.id) ? 'they lodged proxy votes' : questionsByUser.has(p.id) ? 'they asked Board Q&A questions' : meetingQsByUser.has(p.id) ? 'they asked meeting questions' : '';
    if (why) keep('People', p.email, `Not in the file, but kept: ${why}.`);
    else { removal.people.push(p); del('People', p.email, ['their account is deleted']); }
  }
  const removedHolderIds = new Set(removal.holders.map((h) => h.id));
  const removedHoldingIds = new Set(removal.holdings.map((h) => h.id));
  const removedPriceIds = new Set(removal.prices.map((p) => p.id));
  for (const c of dbClasses) {
    if (classByFull.has(classFull(c)) || !ownClass(c.id)) continue;
    const item = `${classFull(c)} ${c.name}`;
    const holdingsLeft = dbHoldings.some((h) => h.share_class_id === c.id && !removedHoldingIds.has(h.id) && !removedHolderIds.has(h.holder_id));
    const pricesLeft = dbPrices.some((p) => p.share_class_id === c.id && !removedPriceIds.has(p.id));
    const trading = tradeClasses.has(c.id) || tradesByHolder.some((t) => t.share_class_id === c.id);
    const why = holdingsLeft ? 'holdings in it would remain' : pricesLeft ? 'reference prices for it would remain' : trading ? 'it has secondary trading records' : '';
    if (why) keep('Share classes', item, `Not in the file, but kept: ${why}.`);
    else { removal.classes.push(c); del('Share classes', item); }
  }

  // Ownership per company and class, from the file (latest holding per holder and class)
  const latestByClass = new Map();
  const latest = new Map();
  for (const h of holdings) {
    const k = `${h.ref}|${h.full}`;
    if (!latest.has(k) || latest.get(k).as_at < h.as_at) latest.set(k, h);
  }
  for (const h of latest.values()) latestByClass.set(h.full, (latestByClass.get(h.full) ?? 0) + (h.shares ?? 0));
  const portalLatest = new Map();
  for (const h of dbHoldings) {
    const k = `${h.holder_id}|${h.share_class_id}`;
    if (!portalLatest.has(k) || portalLatest.get(k).as_at < h.as_at) portalLatest.set(k, h);
  }
  const portalByClass = new Map();
  for (const h of portalLatest.values()) portalByClass.set(h.share_class_id, (portalByClass.get(h.share_class_id) ?? 0) + Number(h.shares));

  // ---------------------------------------------------------------------------
  // Report (Markdown, for the command line and the audit trail)
  // ---------------------------------------------------------------------------
  const SHEETS = ['Companies', 'Share classes', 'Holders', 'People', 'Access', 'Holdings', 'Boards', 'Prices', 'Holding notes'];
  const tally = (sheet, action) => changes.filter((c) => c.sheet === sheet && c.action === action).length;
  const removals = changes.filter((c) => c.action === 'remove').length;
  const lines = [`# Investor data import: ${name}`, '', `${apply ? (remove ? 'Applied, with removals' : 'Applied (adds and updates)') : 'Check only (nothing written)'} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${target}`, ''];
  lines.push(problems.length ? `## ❌ ${problems.length} problem${problems.length === 1 ? '' : 's'} (fix these in the file; nothing was imported)` : '## ✅ No problems found', '');
  for (const p of problems) lines.push(`- ${p}`);
  if (warn.length) { lines.push('', '## Warnings', ''); for (const w of warn) lines.push(`- ${w}`); }
  lines.push('', '## Summary', '', '| Sheet | Rows | New | Changed | Unchanged | Not in the file: remove | Not in the file: keep |', '|---|---:|---:|---:|---:|---:|---:|');
  const fileRows = { 'Companies': companies, 'Share classes': classes, 'Holders': holders, 'People': people, 'Access': access, 'Holdings': holdings, 'Boards': boards, 'Prices': prices, 'Holding notes': holdingNotes };
  for (const s of SHEETS) {
    const a = tally(s, 'add'), u = tally(s, 'update');
    lines.push(`| ${s} | ${fileRows[s].length} | ${a} | ${u} | ${Math.max(0, fileRows[s].length - a - u)} | ${tally(s, 'remove')} | ${tally(s, 'keep')} |`);
  }
  lines.push('', '## Ownership by class', '', '| Class | In this file | In the portal now | Official on issue | Difference (official − file) |', '|---|---:|---:|---:|---:|');
  for (const c of classes) {
    const db = dbClassOf(c.full);
    const inFile = latestByClass.get(c.full) ?? 0;
    lines.push(`| ${c.full} ${c.name} | ${n.format(inFile)} | ${db ? n.format(portalByClass.get(db.id) ?? 0) : '–'} | ${c.official_on_issue != null ? n.format(c.official_on_issue) : '–'} | ${c.official_on_issue != null ? n.format(c.official_on_issue - inFile) : '–'} |`);
  }
  for (const [action, title] of [['add', 'New'], ['update', 'Changed'], ['remove', 'In the portal, not in the file (removed only when you choose to remove)'], ['keep', 'In the portal, not in the file, kept']]) {
    const list = changes.filter((c) => c.action === action);
    if (!list.length) continue;
    lines.push('', `## ${title}`, '');
    for (const c of list) lines.push(`- ${c.sheet}: ${c.item}${c.details.length ? ` (${c.details.join('; ')})` : ''}`);
  }

  // ---------------------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------------------
  if (apply && !problems.length) {
    for (const c of companies) {
      const row = { code: c.code, display_name: c.display_name, legal_name: c.legal_name, company_number: c.company_number, country: c.country, relationship: c.relationship, portal: c.portal, lakeba_stake: c.lakeba_stake, stake_as_at: c.stake_as_at, website: c.website };
      const db = entityByCode.get(c.code);
      const { data } = db
        ? await svc.from('entities').update(row).eq('id', db.id).select('*').single().throwOnError()
        : await svc.from('entities').insert(row).select('*').single().throwOnError();
      entityByCode.set(c.code, data);
    }
    for (const c of classes) {
      const e = entityByCode.get(c.company);
      const row = { entity_id: e.id, code: c.code, name: c.name, kind: c.kind, voting: c.voting, counts_toward_pct: c.counts_toward_pct, official_on_issue: c.official_on_issue, official_as_at: c.official_as_at, currency: c.currency };
      const { data } = await svc.from('share_classes').upsert(row, { onConflict: 'entity_id,code' }).select('*').single().throwOnError();
      dbClassByKey.set(classKey(e.id, c.code), data);
    }
    for (const h of holders) {
      if (holderByRef.get(h.ref) && sharedHolder(holderByRef.get(h.ref).id)) continue; // kept as it is (checked above)
      // A holder exported without a register reference gets this ID as its reference now.
      const portalOnly = holderByRef.get(h.ref);
      if (portalOnly && !portalOnly.registry_ref) await svc.from('holders').update({ registry_ref: h.ref }).eq('id', portalOnly.id).throwOnError();
      const represents = h.ref.endsWith('-GROUP') ? entityByCode.get(h.ref.slice(0, -6))?.id ?? null : null;
      const row = { registry_ref: h.ref, name: h.name, kind: h.kind, represents_entity_id: represents };
      const { data } = await svc.from('holders').upsert(row, { onConflict: 'registry_ref' }).select('*').single().throwOnError();
      holderByRef.set(h.ref, data);
    }
    for (const p of people) {
      let profile = profileByEmail.get(p.email);
      if (!profile) {
        const { data, error } = await svc.auth.admin.createUser({ email: p.email, email_confirm: true, user_metadata: { first_name: p.first_name, last_name: p.last_name } });
        if (error) throw new Error(`${p.email}: ${error.message}`);
        profile = { id: data.user.id };
      }
      if (!scope || !own.sharedPeople.has(profile.id)) await svc.from('profiles').update({ first_name: p.first_name, last_name: p.last_name, phone: p.phone, notify_email: p.notify_email }).eq('id', profile.id).throwOnError();
      profileByEmail.set(p.email, { ...profile, email: p.email });
      for (const r of p.roles) {
        const entity_id = r.company ? entityByCode.get(r.company).id : null;
        if (!liveRoles.some((x) => x.user_id === profile.id && x.role_key === r.key && (x.entity_id ?? null) === entity_id)) {
          await svc.from('user_roles').insert({ user_id: profile.id, role_key: r.key, entity_id, note: `from the import of ${name}` }).throwOnError();
          liveRoles.push({ user_id: profile.id, role_key: r.key, entity_id });
        }
      }
    }
    for (const a of access) {
      if (sharedHolder(holderByRef.get(a.ref).id)) continue; // unchanged (checked above)
      await svc.from('holder_members').upsert({ holder_id: holderByRef.get(a.ref).id, user_id: profileByEmail.get(a.email).id, access: a.access }, { onConflict: 'holder_id,user_id' }).throwOnError();
    }
    const holdingRows = holdings.filter((h) => !h.fromRegister).map((h) => {
      const cls = classByFull.get(h.full); const e = entityByCode.get(cls.company);
      return { holder_id: holderByRef.get(h.ref).id, share_class_id: dbClassByKey.get(classKey(e.id, cls.code)).id, shares: h.shares, as_at: h.as_at, exercise_price: h.exercise_price, expires_on: h.expires_on };
    });
    for (let i = 0; i < holdingRows.length; i += 500) {
      await svc.from('holdings').upsert(holdingRows.slice(i, i + 500), { onConflict: 'holder_id,share_class_id,as_at' }).throwOnError();
    }
    for (const b of boards) {
      const entity_id = entityByCode.get(b.company).id; const user_id = profileByEmail.get(b.email).id;
      // Company admin: the Admin role for that company only.
      if (b.position === 'admin') {
        if (!liveRoles.some((x) => x.user_id === user_id && x.role_key === 'admin' && x.entity_id === entity_id)) {
          await svc.from('user_roles').insert({ user_id, role_key: 'admin', entity_id, expires_at: b.ends_on ? `${b.ends_on}T23:59:59+10:00` : null, note: `from the import of ${name}` }).throwOnError();
          liveRoles.push({ user_id, role_key: 'admin', entity_id });
        }
      } else await svc.from('entity_board').upsert({ entity_id, user_id, position: b.position, starts_on: b.starts_on, ends_on: b.ends_on }).throwOnError();
    }
    for (const p of prices) {
      const cls = classByFull.get(p.full); const e = entityByCode.get(cls.company);
      await svc.from('reference_prices').upsert({ share_class_id: dbClassByKey.get(classKey(e.id, cls.code)).id, price: p.price, currency: p.currency, priced_on: p.priced_on, source: p.source, note: p.note }, { onConflict: 'share_class_id,priced_on,source' }).throwOnError();
    }
    for (const x of holdingNotes) {
      const cls = classByFull.get(x.full); const e = entityByCode.get(cls.company);
      await svc.from('holding_notes').upsert({ holder_id: holderByRef.get(x.ref).id, share_class_id: dbClassByKey.get(classKey(e.id, cls.code)).id, note: x.note, updated_at: new Date().toISOString() }, { onConflict: 'holder_id,share_class_id' }).throwOnError();
    }
    if (remove) {
      // Links and rows first, then holders, classes and accounts.
      for (const m of removal.members) await svc.from('holder_members').delete().eq('holder_id', m.holder_id).eq('user_id', m.user_id).throwOnError();
      for (const x of removal.notes) await svc.from('holding_notes').delete().eq('holder_id', x.holder_id).eq('share_class_id', x.share_class_id).throwOnError();
      for (let i = 0; i < removal.holdings.length; i += 200) await svc.from('holdings').delete().in('id', removal.holdings.slice(i, i + 200).map((h) => h.id)).throwOnError();
      for (const p of removal.prices) await svc.from('reference_prices').delete().eq('id', p.id).throwOnError();
      for (const b of removal.board) await svc.from('entity_board').delete().eq('entity_id', b.entity_id).eq('user_id', b.user_id).eq('position', b.position).throwOnError();
      for (const r of [...removal.companyAdmins, ...removal.roles]) await svc.from('user_roles').delete().eq('id', r.id).throwOnError();
      for (const h of removal.holders) await svc.from('holders').delete().eq('id', h.id).throwOnError();
      for (const c of removal.classes) await svc.from('share_classes').delete().eq('id', c.id).throwOnError();
      for (const p of removal.people) { const { error } = await svc.auth.admin.deleteUser(p.id); if (error) throw new Error(`${p.email}: ${error.message}`); }
    }
    await svc.from('audit_log').insert({ user_id: actorId, action: 'investor_data_imported', entity_id: scope?.entityId ?? null, detail: { file: name, company: scope?.code ?? null, removals: remove, added: changes.filter((c) => c.action === 'add').length, updated: changes.filter((c) => c.action === 'update').length, removed: remove ? removals : 0, companies: companies.length, holders: holders.length, people: people.length, holdings: holdings.length } });
    lines.splice(3, 0, '**Imported.** Review the changes above in the portal.', '');
  } else if (apply) {
    lines.splice(3, 0, '**Not imported** because of the problems below.', '');
  }
  return { lines, problems, warnings: warn, applied: apply && !problems.length, changes, changedHolders: [...changedHolderRefs], latestAsAt };
}
