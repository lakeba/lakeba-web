// Investor data workbook import (Lakeba-investor-data-*.xlsx): parse, check,
// compare with the portal, and optionally apply. Used by
// scripts/import-investors.mjs and Admin → Import data.
//
// Nothing is ever deleted; rows only in the portal are listed for review.
// Accounts are created without sending email. Nobody is made an admin from
// the file: "Admin" rows are imported as investors and listed as warnings.
import { readXlsx } from './xlsx-read.mjs';

/**
 * @param {{ data: Buffer | Uint8Array, name: string, svc: import('@supabase/supabase-js').SupabaseClient, apply: boolean, target: string }} opts
 * @returns {Promise<{ lines: string[], problems: string[], warnings: string[], applied: boolean }>}
 */
export async function runImport({ data, name, svc, apply, target }) {
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
  function rows(sheetName) {
    const ws = book[sheetName];
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
  const ROLE = { 'Investor': 'investor', 'Board': 'board', 'Admin': 'investor' };
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
  if (companies.filter((c) => c.relationship === 'group').length !== 1) problems.push('Companies: exactly one company must be the Group');
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

  const people = rows('People').map((r) => ({
    _row: r._row, email: String(r['Email'] ?? '').toLowerCase(), first_name: r['First name'] ?? '', last_name: r['Last name'] ?? '',
    phone: r['Phone'] ? String(r['Phone']) : null, roleLabel: r['Portal role'], role: pick(ROLE, r['Portal role'], 'People', r, 'Portal role'),
    notify_email: r['Email notifications'] == null ? true : yes(r['Email notifications']),
  }));
  for (const p of people) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) bad('People', p, `“${p.email}” is not an email address`);
    if (p.roleLabel === 'Admin') warn.push(`People row ${p._row}: ${p.email} is marked Admin. Imported as an investor; grant admin in Admin → Investors (needs two-step).`);
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
  }));
  for (const h of holdings) {
    if (!holderRefs.has(h.ref)) bad('Holdings', h, `holder ${h.ref} is not on the Holders sheet`);
    if (!classByFull.has(h.full)) bad('Holdings', h, `class ${h.full} is not on the Share classes sheet`);
    if (!Number.isInteger(h.shares) || h.shares < 0) bad('Holdings', h, 'shares must be a whole number, 0 or more');
    if (!h.as_at || h.as_at === 'invalid') bad('Holdings', h, 'as-at date is required');
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

  // ---------------------------------------------------------------------------
  // Compare with the portal
  // ---------------------------------------------------------------------------
  const all = async (q) => { const { data, error } = await q; if (error) throw error; return data ?? []; };
  const [dbEntities, dbClasses, dbHolders, dbProfiles, dbMembers, dbHoldings, dbBoard, dbAdmins, dbPrices] = await Promise.all([
    all(svc.from('entities').select('*')),
    all(svc.from('share_classes').select('*')),
    all(svc.from('holders').select('*')),
    all(svc.from('profiles').select('id, email, first_name, last_name, phone, role, notify_email')),
    all(svc.from('holder_members').select('holder_id, user_id, access')),
    all(svc.from('holdings').select('id, holder_id, share_class_id, shares, as_at').range(0, 99999)),
    all(svc.from('entity_board').select('*')),
    all(svc.from('entity_admins').select('*')),
    all(svc.from('reference_prices').select('*')),
  ]);
  const entityByCode = new Map(dbEntities.map((e) => [e.code, e]));
  const holderByRef = new Map(dbHolders.map((h) => [h.registry_ref, h]));
  const profileByEmail = new Map(dbProfiles.map((p) => [p.email.toLowerCase(), p]));
  const classKey = (entityId, code) => `${entityId}|${code}`;
  const dbClassByKey = new Map(dbClasses.map((c) => [classKey(c.entity_id, c.code), c]));

  const report = { companies: [], classes: [], holders: [], people: [], access: [], holdings: [], boards: [], prices: [] };
  const same = (a, b) => (a ?? null) === (b ?? null) || String(a ?? '') === String(b ?? '');
  const diff = (row, db, fields) => fields.filter((f) => !same(row[f], db[f]));

  for (const c of companies) {
    const db = entityByCode.get(c.code);
    report.companies.push(db ? { c, status: diff(c, db, ['display_name', 'legal_name', 'company_number', 'country', 'relationship', 'portal', 'lakeba_stake', 'stake_as_at', 'website']).filter((f) => !(f === 'lakeba_stake' && Number(c.lakeba_stake) === Number(db.lakeba_stake))) } : { c, status: 'new' });
  }
  for (const c of classes) {
    const e = entityByCode.get(c.company);
    const db = e && dbClassByKey.get(classKey(e.id, c.code));
    report.classes.push(db ? { c, status: diff(c, db, ['name', 'kind', 'voting', 'counts_toward_pct', 'official_on_issue', 'official_as_at', 'currency']) } : { c, status: 'new' });
  }
  for (const h of holders) {
    const db = holderByRef.get(h.ref);
    report.holders.push(db ? { h, status: diff(h, db, ['name', 'kind']) } : { h, status: 'new' });
  }
  for (const p of people) {
    const db = profileByEmail.get(p.email);
    report.people.push(db ? { p, status: diff(p, db, ['first_name', 'last_name', 'phone', 'notify_email']).concat(db.role === 'admin' || db.role === p.role ? [] : ['role']) } : { p, status: 'new' });
  }
  const memberKey = (userId, holderId) => `${userId}|${holderId}`;
  const dbMemberSet = new Map(dbMembers.map((m) => [memberKey(m.user_id, m.holder_id), m]));
  for (const a of access) {
    const u = profileByEmail.get(a.email); const h = holderByRef.get(a.ref);
    const db = u && h && dbMemberSet.get(memberKey(u.id, h.id));
    report.access.push(db ? { a, status: db.access === a.access ? [] : ['access'] } : { a, status: 'new' });
  }
  const holdingKey = (holderId, classId, asAt) => `${holderId}|${classId}|${asAt}`;
  const dbHoldingMap = new Map(dbHoldings.map((h) => [holdingKey(h.holder_id, h.share_class_id, h.as_at), h]));
  for (const h of holdings) {
    const holder = holderByRef.get(h.ref); const cls = classByFull.get(h.full); const e = cls && entityByCode.get(cls.company);
    const dbClass = e && dbClassByKey.get(classKey(e.id, cls.code));
    const db = holder && dbClass && dbHoldingMap.get(holdingKey(holder.id, dbClass.id, h.as_at));
    report.holdings.push(db ? { h, status: Number(db.shares) === h.shares ? [] : ['shares'] } : { h, status: 'new' });
  }
  for (const b of boards) report.boards.push({ b, status: 'set' });
  for (const p of prices) report.prices.push({ p, status: 'set' });

  // In the portal but not in the file (never deleted)
  const fileHolderRefs = holderRefs;
  const onlyInPortal = {
    holders: dbHolders.filter((h) => !fileHolderRefs.has(h.registry_ref)),
    people: dbProfiles.filter((p) => !emails.has(p.email.toLowerCase()) && !p.email.endsWith('@lakeba.test')),
    access: dbMembers.filter((m) => {
      const p = dbProfiles.find((x) => x.id === m.user_id); const h = dbHolders.find((x) => x.id === m.holder_id);
      return p && h && !access.some((a) => a.email === p.email.toLowerCase() && a.ref === h.registry_ref);
    }),
  };

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
  // Report
  // ---------------------------------------------------------------------------
  const n = new Intl.NumberFormat('en-AU');
  const count = (list) => ({ new: list.filter((x) => x.status === 'new').length, changed: list.filter((x) => Array.isArray(x.status) && x.status.length).length, same: list.filter((x) => Array.isArray(x.status) && !x.status.length).length });
  const lines = [`# Investor data import: ${name}`, '', `${apply ? 'Applied' : 'Dry run (nothing written)'} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${target}`, ''];
  lines.push(problems.length ? `## ❌ ${problems.length} problem${problems.length === 1 ? '' : 's'} (fix these in the file; nothing was imported)` : '## ✅ No problems found', '');
  for (const p of problems) lines.push(`- ${p}`);
  if (warn.length) { lines.push('', '## Warnings', ''); for (const w of warn) lines.push(`- ${w}`); }
  lines.push('', '## Summary', '', '| Sheet | Rows | New | Changed | Unchanged |', '|---|---:|---:|---:|---:|');
  for (const [k, label] of [['companies', 'Companies'], ['classes', 'Share classes'], ['holders', 'Holders'], ['people', 'People'], ['access', 'Access'], ['holdings', 'Holdings']]) {
    const c = count(report[k]); lines.push(`| ${label} | ${report[k].length} | ${c.new} | ${c.changed} | ${c.same} |`);
  }
  lines.push(`| Boards | ${boards.length} | set from file | | |`, `| Prices | ${prices.length} | set from file | | |`);

  lines.push('', '## Ownership by class', '', '| Class | In this file | In the portal now | Official on issue | Difference (official − file) |', '|---|---:|---:|---:|---:|');
  for (const c of classes) {
    const e = entityByCode.get(c.company); const db = e && dbClassByKey.get(classKey(e.id, c.code));
    const inFile = latestByClass.get(c.full) ?? 0;
    lines.push(`| ${c.full} ${c.name} | ${n.format(inFile)} | ${db ? n.format(portalByClass.get(db.id) ?? 0) : '–'} | ${c.official_on_issue != null ? n.format(c.official_on_issue) : '–'} | ${c.official_on_issue != null ? n.format(c.official_on_issue - inFile) : '–'} |`);
  }

  const changedRows = (k, label, name) => {
    const ch = report[k].filter((x) => Array.isArray(x.status) && x.status.length);
    if (!ch.length) return;
    lines.push('', `## Changes: ${label}`, '');
    for (const x of ch) lines.push(`- ${name(x)}: ${x.status.join(', ')}`);
  };
  changedRows('companies', 'companies', (x) => x.c.code);
  changedRows('classes', 'share classes', (x) => x.c.full);
  changedRows('holders', 'holders', (x) => `${x.h.ref} ${x.h.name}`);
  changedRows('people', 'people', (x) => x.p.email);
  changedRows('access', 'access', (x) => `${x.a.email} → ${x.a.ref}`);
  changedRows('holdings', 'holdings (same date, different shares)', (x) => `${x.h.ref} ${x.h.full} ${x.h.as_at}: ${n.format(x.h.shares)}`);

  lines.push('', '## In the portal but not in the file (kept; review them)', '');
  lines.push(`- Holders: ${onlyInPortal.holders.length ? onlyInPortal.holders.map((h) => `${h.registry_ref ?? '(no ID)'} ${h.name}`).join('; ') : 'none'}`);
  lines.push(`- People: ${onlyInPortal.people.length ? onlyInPortal.people.map((p) => p.email).join('; ') : 'none'}`);
  lines.push(`- Access links: ${onlyInPortal.access.length ? onlyInPortal.access.length : 'none'}`);

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
        profile = { id: data.user.id, role: 'investor' };
      }
      // Never demote an admin from the file.
      const role = profile.role === 'admin' ? 'admin' : p.role;
      await svc.from('profiles').update({ first_name: p.first_name, last_name: p.last_name, phone: p.phone, role, notify_email: p.notify_email }).eq('id', profile.id).throwOnError();
      profileByEmail.set(p.email, { ...profile, email: p.email });
    }
    for (const a of access) {
      await svc.from('holder_members').upsert({ holder_id: holderByRef.get(a.ref).id, user_id: profileByEmail.get(a.email).id, access: a.access }, { onConflict: 'holder_id,user_id' }).throwOnError();
    }
    const holdingRows = holdings.map((h) => {
      const cls = classByFull.get(h.full); const e = entityByCode.get(cls.company);
      return { holder_id: holderByRef.get(h.ref).id, share_class_id: dbClassByKey.get(classKey(e.id, cls.code)).id, shares: h.shares, as_at: h.as_at };
    });
    for (let i = 0; i < holdingRows.length; i += 500) {
      await svc.from('holdings').upsert(holdingRows.slice(i, i + 500), { onConflict: 'holder_id,share_class_id,as_at' }).throwOnError();
    }
    for (const b of boards) {
      const entity_id = entityByCode.get(b.company).id; const user_id = profileByEmail.get(b.email).id;
      if (b.position === 'admin') await svc.from('entity_admins').upsert({ entity_id, user_id }).throwOnError();
      else await svc.from('entity_board').upsert({ entity_id, user_id, position: b.position, starts_on: b.starts_on, ends_on: b.ends_on }).throwOnError();
    }
    for (const p of prices) {
      const cls = classByFull.get(p.full); const e = entityByCode.get(cls.company);
      await svc.from('reference_prices').upsert({ share_class_id: dbClassByKey.get(classKey(e.id, cls.code)).id, price: p.price, currency: p.currency, priced_on: p.priced_on, source: p.source, note: p.note }, { onConflict: 'share_class_id,priced_on,source' }).throwOnError();
    }
    await svc.from('audit_log').insert({ action: 'investor_data_imported', detail: { file: name, companies: companies.length, holders: holders.length, people: people.length, holdings: holdings.length } });
    lines.splice(3, 0, '**Imported.** Review the changes above in the portal.', '');
  } else if (apply) {
    lines.splice(3, 0, '**Not imported** because of the problems below.', '');
  }
  // Holders whose holdings are new or changed in this file (for "your holding statement is ready").
  const changedHolders = [...new Set(report.holdings.filter((x) => x.status === 'new' || (Array.isArray(x.status) && x.status.length)).map((x) => x.h.ref))];
  const latestAsAt = report.holdings.filter((x) => x.status === 'new' || (Array.isArray(x.status) && x.status.length)).map((x) => x.h.as_at).sort().at(-1) ?? null;
  return { lines, problems, warnings: warn, applied: apply && !problems.length, changedHolders, latestAsAt };
}
