// Reads the company secretary's register of members: the PDF report "Current
// register of members as at dd/mm/yyyy", one block per member (name, address,
// then per class its movements: date, type, shares, balance, transferred
// to/from, consideration, certificate, amount paid and unpaid, beneficially
// held). Columns are found from the report's own headings on each page.
//
// It reads only what it can check: every holding's movements must add up to the
// report's own Balance column, and anything it can't place is a problem rather
// than a guess. With any problem the register is not used (another software's
// layout, a scanned copy, a changed report): the caller shows the problems.
import { getDocumentProxy } from 'unpdf';

/** @typedef {{ date: string, type: string, shares: number, balance: number, party: string | null, consideration: number | null, unique: string | null, certificate: string | null, paid: number | null, unpaid: number | null, beneficial: boolean | null }} Movement */
/** @typedef {{ code: string, name: string, entered_on: string | null, ceased_on: string | null, balance: number, movements: Movement[] }} RegisterClass */
/** @typedef {{ key: string, name: string, register_name: string, beneficially_for: string | null, acn: string | null, address: string | null, kind: 'individual' | 'company' | 'trust' | 'super_fund', classes: RegisterClass[] }} RegisterHolder */

const iso = (d) => { const m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const whole = (s) => (s == null || s === '' ? null : /^-?[\d,]+$/.test(s) ? Number(s.replace(/,/g, '')) : NaN);
const money = (s) => (s == null || s === '' ? null : /^-?\$?[\d,]+(\.\d+)?$/.test(s) ? Number(s.replace(/[$,]/g, '')) : NaN);

/** Tidies a register name for matching: case, punctuation, Pty Ltd and the like. */
export function tidyName(s) {
  return String(s ?? '').toUpperCase().replace(/[’'`]/g, '').replace(/[^A-Z0-9&]+/g, ' ')
    .replace(/\b(PTY|PTYLTD|PROPRIETARY|LTD|LIMITED|THE|AND|CO|INC)\b/g, ' ').replace(/&/g, ' ').replace(/\s+/g, ' ').trim();
}
/** The same name, trust and ACN make the same entry on a register. */
export const nameKey = (name, trust, acn) => [tidyName(name), tidyName(trust), acn ?? ''].join('|');

function kindOf(name, trust) {
  const both = `${name} ${trust ?? ''}`.toUpperCase();
  if (/\bSUPER(ANNUATION)?\b|\bSMSF\b|\bRETIREMENT\b/.test(both)) return 'super_fund';
  if (trust && /\bTRUST|FUND\b/.test(trust.toUpperCase())) return 'trust';
  if (/\b(PTY|LTD|LIMITED|INC|CORP|CORPORATION|COMPANY|HOLDINGS|LLC|GMBH)\b/.test(name.toUpperCase())) return 'company';
  if (/\bTRUST\b/.test(name.toUpperCase())) return 'trust';
  return 'individual';
}

/** The PDF's text as rows of cells with their positions, top to bottom, page by page. */
async function rowsOf(data) {
  // A copy: the PDF reader takes the bytes it's given, and the caller still needs them.
  const pdf = await getDocumentProxy(new Uint8Array(data).slice());
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const { items } = await (await pdf.getPage(p)).getTextContent();
    const rows = new Map();
    for (const it of items) {
      const s = String(it.str ?? '').trim();
      if (!s || !it.transform) continue;
      const y = Math.round(it.transform[5]);
      const k = [...rows.keys()].find((r) => Math.abs(r - y) <= 2) ?? y;
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k).push({ x: it.transform[4], r: it.transform[4] + (it.width ?? 0), s });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) out.push({ page: p, cells: rows.get(y).sort((a, b) => a.x - b.x) });
  }
  return out;
}

/**
 * @param {Uint8Array | ArrayBuffer} data the PDF
 * @returns {Promise<{ company: { name: string | null, number: string | null }, asAt: string | null, holders: RegisterHolder[], problems: string[], facts: { pages: number, holdings: number, movements: number, types: Record<string, number>, totals: Record<string, { name: string, shares: number }>, transfers: { paired: number, fromElsewhere: { holder: string, code: string, date: string, shares: number, party: string }[], toElsewhere: { holder: string, code: string, date: string, shares: number, party: string }[] } } }>}
 */
export async function readRegister(data) {
  const problems = [];
  let rows;
  try { rows = await rowsOf(data); } catch (e) {
    return { company: { name: null, number: null }, asAt: null, holders: [], problems: [`This PDF couldn’t be opened (${e instanceof Error ? e.message : e}).`], facts: emptyFacts(0) };
  }
  const text = (row) => row.cells.map((c) => c.s).join(' ');
  const pages = rows.length ? rows[rows.length - 1].page : 0;
  const head = rows.filter((r) => r.page === 1).slice(0, 8).map(text);
  const asAtLine = head.find((l) => /REGISTER OF MEMBERS AS AT \d{2}\/\d{2}\/\d{4}/i.test(l));
  const numberLine = head.find((l) => /Company Number:/i.test(l));
  const asAt = asAtLine ? iso(asAtLine.match(/(\d{2}\/\d{2}\/\d{4})/)[1]) : null;
  const company = { name: head[0] && !/Company Number|REGISTER OF MEMBERS/i.test(head[0]) ? head[0] : null, number: numberLine?.match(/Company Number:\s*([\d ]+)/i)?.[1].replace(/\s/g, '') || null };
  if (!asAt) {
    problems.push(rows.length ? 'This doesn’t look like a register of members the portal can read: its first page has no “Register of members as at …” line. Ask the company secretary for the “Current register of members” report, or a spreadsheet of it.' : 'This PDF has no text the portal can read (a scanned copy?). Ask the company secretary for the report itself.');
    return { company, asAt, holders: [], problems, facts: emptyFacts(pages) };
  }

  // Column centres, from the headings (they repeat with each member).
  const CENTRE = (c) => (c.x + c.r) / 2;
  let cols = null;
  const colOf = (c) => Object.entries(cols).sort((a, b) => Math.abs(a[1] - CENTRE(c)) - Math.abs(b[1] - CENTRE(c)))[0][0];
  const holders = [];
  let holder = null, cls = null, last = null, pending = null;
  const where = (row) => `page ${row.page}`;

  for (const row of rows) {
    const line = text(row);
    if (/^Date of Transaction\b/.test(line)) {
      const find = (s) => row.cells.find((c) => c.s === s);
      const u = find('Unique No.s');
      if (u) (cols ??= {}).unique = CENTRE(u);
      continue;
    }
    if (/^Acquired\b/.test(line)) {
      const at = (s, n = 0) => row.cells.filter((c) => c.s === s)[n];
      const need = [['acquired', at('Acquired')], ['transferred', at('Transferred')], ['balance', at('Balance')], ['party', at('To/From')], ['consideration', at('Paid/Received')], ['certificate', at('No.')], ['paid', at('Share', 0)], ['unpaid', at('Share', 1)], ['beneficial', at('Y/N')]];
      if (need.some(([, c]) => !c)) { problems.push(`${where(row)}: the column headings aren’t the ones this report usually has.`); continue; }
      cols = { ...(cols ?? {}), ...Object.fromEntries(need.map(([k, c]) => [k, CENTRE(c)])) };
      continue;
    }
    if (/^Per Share$/.test(line) || /^Company Number:|REGISTER OF MEMBERS AS AT/i.test(line) || (row.page === 1 && line === company.name)) continue;

    const c = line.match(/^([A-Z0-9]+) - (.+?) Date of Entry:\s*(\d{2}\/\d{2}\/\d{4})?\s*Date of Cessation:\s*(\d{2}\/\d{2}\/\d{4})?$/);
    if (c) {
      if (pending) {
        const m = pending.name.match(/^(.*?)(?:\s*<Beneficially Held by (.*?)>)?(?:\s+(\d{9}))?$/);
        const [name, trust, acn] = [m[1].trim(), m[2]?.trim() || null, m[3] || null];
        holder = { key: nameKey(name, trust, acn), name, register_name: pending.name, beneficially_for: trust, acn, address: pending.address, kind: kindOf(name, trust), classes: [] };
        holders.push(holder);
        pending = null;
      }
      if (!holder) { problems.push(`${where(row)}: a class (${c[1]}) with no member above it.`); continue; }
      cls = { code: c[1], name: c[2].trim(), entered_on: iso(c[3] ?? ''), ceased_on: iso(c[4] ?? ''), balance: 0, movements: [] };
      holder.classes.push(cls);
      last = null;
      continue;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(row.cells[0].s) && row.cells.length >= 3) {
      if (!cls || !cols) { problems.push(`${where(row)}: a movement (${line.slice(0, 60)}) outside a member’s class.`); continue; }
      const f = {};
      let type = row.cells[1].s;
      for (const cell of row.cells.slice(2)) { const k = colOf(cell); f[k] = f[k] ? `${f[k]} ${cell.s}` : cell.s; }
      const acquired = whole(f.acquired), transferred = whole(f.transferred), balance = whole(f.balance);
      const shares = acquired ?? transferred;
      const bad = [];
      if (acquired != null && transferred != null) bad.push('shares in both the acquired and transferred columns');
      if (shares == null || Number.isNaN(shares)) bad.push('no number of shares');
      if (balance == null || Number.isNaN(balance)) bad.push('no balance');
      for (const [k, v] of [['consideration', money(f.consideration)], ['paid', money(f.paid)], ['unpaid', money(f.unpaid)]]) if (Number.isNaN(v)) bad.push(`“${f[k]}” isn’t an amount`);
      if (/transfer out/i.test(type) && shares > 0) bad.push('a transfer out that adds shares');
      if (/allotment|transfer in/i.test(type) && shares < 0) bad.push(`${type.toLowerCase()} that takes shares away`);
      if (bad.length) { problems.push(`${holder.register_name}, ${cls.code}, ${row.cells[0].s}: ${bad.join('; ')}.`); last = null; continue; }
      last = { date: iso(row.cells[0].s), type, shares, balance, party: f.party ?? null, consideration: money(f.consideration), unique: f.unique ?? null, certificate: f.certificate ?? null, paid: money(f.paid), unpaid: money(f.unpaid), beneficial: f.beneficial === 'Y' ? true : f.beneficial === 'N' ? false : null };
      cls.movements.push(last);
      continue;
    }
    // A name carried onto more lines in the To/From column.
    if (last && cols && row.cells.every((cell) => colOf(cell) === 'party')) { last.party = `${last.party ?? ''} ${line}`.trim(); continue; }
    // A member's name, then their address, at the left margin.
    if (row.cells[0].x < (cols ? cols.acquired - 120 : 60) && row.cells.length <= 2) {
      if (!pending) { pending = { name: line, address: null }; last = null; cls = null; continue; }
      if (pending.address == null) { pending.address = line; continue; }
      problems.push(`${where(row)}: “${pending.name}” has more lines before its first class than a name and an address (“${line}”).`);
      pending = { name: line, address: null };
      continue;
    }
    problems.push(`${where(row)}: a line the portal couldn’t place: “${line.slice(0, 120)}”.`);
  }
  if (pending) problems.push(`“${pending.name}” has no class or movements under it.`);

  // The checks: every holding adds up to the register's own balances.
  let holdings = 0, movements = 0;
  const types = {}, totals = {};
  for (const h of holders) {
    if (!h.classes.length) problems.push(`${h.register_name} has no classes.`);
    for (const c of h.classes) {
      holdings++;
      let bal = 0;
      if (!c.movements.length) problems.push(`${h.register_name}, ${c.code}: no movements.`);
      for (const m of c.movements) {
        movements++;
        types[m.type] = (types[m.type] ?? 0) + 1;
        bal += m.shares;
        if (bal !== m.balance) problems.push(`${h.register_name}, ${c.code}, ${m.date}: the movements add up to ${bal.toLocaleString('en-AU')} but the register’s balance is ${m.balance.toLocaleString('en-AU')}.`);
        if (bal < 0) problems.push(`${h.register_name}, ${c.code}, ${m.date}: the balance goes below zero.`);
      }
      c.balance = bal;
      if (c.ceased_on && bal !== 0) problems.push(`${h.register_name}, ${c.code}: ceased on ${c.ceased_on} but still has ${bal.toLocaleString('en-AU')}.`);
      const dates = c.movements.map((m) => m.date);
      if (dates.some((d, i) => i && d < dates[i - 1])) problems.push(`${h.register_name}, ${c.code}: the movements aren’t in date order.`);
      if (dates.some((d) => d > asAt)) problems.push(`${h.register_name}, ${c.code}: a movement after the register’s date (${asAt}).`);
      (totals[c.code] ??= { name: c.name, shares: 0 }).shares += bal;
    }
  }
  const seenKeys = new Map();
  for (const h of holders) {
    if (seenKeys.has(h.key)) {
      const other = seenKeys.get(h.key);
      for (const c of h.classes) if (other.classes.some((o) => o.code === c.code)) problems.push(`${h.register_name} appears twice with ${c.code}.`);
      other.classes.push(...h.classes);
      h.classes = [];
    } else seenKeys.set(h.key, h);
  }
  const members = holders.filter((h) => h.classes.length);
  if (!members.length && !problems.length) problems.push('No members were found in this PDF.');

  // Transfers: an out on one member's page, the matching in on the other's.
  const transfers = { paired: 0, fromElsewhere: [], toElsewhere: [] };
  const flat = members.flatMap((h) => h.classes.flatMap((c) => c.movements.filter((m) => /^transfer (in|out)$/i.test(m.type)).map((m) => ({ h, code: c.code, m }))));
  const used = new Set();
  const same = (party, h) => { const a = tidyName(party), b = tidyName(h.name); return a && b && (a === b || a.startsWith(b) || b.startsWith(a)); };
  for (const o of flat.filter((t) => t.m.shares < 0)) {
    const i = flat.find((t) => !used.has(t) && t.m.shares === -o.m.shares && t.code === o.code && t.m.date === o.m.date && same(o.m.party, t.h) && same(t.m.party, o.h));
    if (i) { used.add(i); used.add(o); transfers.paired++; }
    else transfers.toElsewhere.push({ holder: o.h.name, code: o.code, date: o.m.date, shares: -o.m.shares, party: o.m.party ?? '' });
  }
  for (const i of flat.filter((t) => t.m.shares > 0 && !used.has(t))) transfers.fromElsewhere.push({ holder: i.h.name, code: i.code, date: i.m.date, shares: i.m.shares, party: i.m.party ?? '' });

  return { company, asAt, holders: members, problems, facts: { pages, holdings, movements, types, totals, transfers } };
}

const emptyFacts = (pages) => ({ pages, holdings: 0, movements: 0, types: {}, totals: {}, transfers: { paired: 0, fromElsewhere: [], toElsewhere: [] } });
