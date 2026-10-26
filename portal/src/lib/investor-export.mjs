// Investor data workbook export: the blank template (templates/
// Lakeba-investor-data-template.xlsx, built by scripts/build-investor-workbook.py)
// filled with everything the portal holds today, in the format the import
// reads back. Admin → Import data → "Download with all data".
//
// The template already has every input cell (styled) and every formula, so
// only the input cells are written; Excel recalculates the checks on open.
import JSZip from 'jszip';

const FIRST = 4;
/** Input columns per sheet, in the order the builder defines them. */
const SHEETS = {
  'Companies': 'ABCDEFGHIJKL', 'Share classes': 'ABCDEFGHIJ', 'Holders': 'ABCDE', 'People': 'ABCDEFG', 'Access': 'ABCD',
  'Holdings': 'ABCDEFGHI', 'Boards': 'ABCDEF', 'Prices': 'ABCDEF', 'Holding notes': 'ABC',
};
const RELATIONSHIP = { group: 'Group', controlled: 'Controlled venture', portfolio: 'Non-controlling investment' };
const PORTAL = { full: 'Full portal', portfolio: 'Portfolio entry only', none: 'Not in portal' };
const CLASS_KIND = { ordinary: 'Ordinary', preference: 'Preference', options: 'Options', convertible_note: 'Convertible note', safe: 'SAFE', other: 'Other' };
const HOLDER_KIND = { individual: 'Individual', company: 'Company', trust: 'Trust', super_fund: 'Super fund' };
const POSITION = { director: 'Director', chair: 'Chair', company_secretary: 'Company secretary', observer: 'Observer' };
const PRICE_SOURCE = { capital_raise: 'Capital raise', secondary_trade: 'Secondary trade', valuation: 'Directors’ valuation' };
const yesNo = (b) => (b ? 'Yes' : 'No');

/** A date as stored ('YYYY-MM-DD' or a timestamp) → an Excel date. */
const DAY = 86_400_000;
const excelDate = (v) => (v ? (Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) - Date.UTC(1899, 11, 30)) / DAY : null);

/** A holder's ID in the file: its register reference, or one the import recognises for holders created without one. */
export const holderFileId = (h) => h.registry_ref || `PORTAL-${h.id.slice(0, 8)}`;

/**
 * Everything in the portal, as rows per sheet (input columns only). With a
 * company (a venture's own admins), only that company: its row, classes,
 * holdings, the holders in them and who sees those holders, its board and
 * admins, prices and notes. Nobody's roles are listed then.
 * @param {*} svc
 * @param {{ entityId: string } | null} [scope]
 */
export async function exportRows(svc, scope = null) {
  const all = async (q) => { const { data, error } = await q; if (error) throw error; return data ?? []; };
  const now = new Date().toISOString();
  const [entities, classes, holders, profiles, members, holdings, board, roleRows, prices, notes] = await Promise.all([
    all(svc.from('entities').select('*').order('sort')),
    all(svc.from('share_classes').select('*')),
    all(svc.from('holders').select('*').order('registry_ref')),
    all(svc.from('profiles').select('id, email, first_name, last_name, phone, notify_email').order('email').range(0, 99999)),
    all(svc.from('holder_members').select('holder_id, user_id, access').range(0, 99999)),
    all(svc.from('holdings').select('holder_id, share_class_id, shares, as_at, exercise_price, expires_on').range(0, 199999)),
    all(svc.from('entity_board').select('*')),
    all(svc.from('user_roles').select('user_id, role_key, entity_id, expires_at, roles(name)').or(`expires_at.is.null,expires_at.gt.${now}`)),
    all(svc.from('reference_prices').select('*').order('priced_on')),
    all(svc.from('holding_notes').select('holder_id, share_class_id, note')),
  ]);
  if (scope) {
    const classIds = new Set(classes.filter((c) => c.entity_id === scope.entityId).map((c) => c.id));
    const keepHoldings = holdings.filter((h) => classIds.has(h.share_class_id));
    const holderIds = new Set(keepHoldings.map((h) => h.holder_id));
    const keepMembers = members.filter((m) => holderIds.has(m.holder_id));
    const keepBoard = board.filter((b) => b.entity_id === scope.entityId);
    const keepAdmins = roleRows.filter((r) => r.role_key === 'admin' && r.entity_id === scope.entityId);
    const userIds = new Set([...keepMembers.map((m) => m.user_id), ...keepBoard.map((b) => b.user_id), ...keepAdmins.map((r) => r.user_id)]);
    const narrow = (list, keep) => list.splice(0, list.length, ...list.filter(keep));
    narrow(entities, (e) => e.id === scope.entityId);
    narrow(classes, (c) => classIds.has(c.id));
    narrow(holdings, (h) => classIds.has(h.share_class_id));
    narrow(holders, (h) => holderIds.has(h.id));
    narrow(members, (m) => holderIds.has(m.holder_id));
    narrow(board, (b) => b.entity_id === scope.entityId);
    narrow(roleRows, (r) => r.role_key === 'admin' && r.entity_id === scope.entityId);
    narrow(profiles, (p) => userIds.has(p.id));
    narrow(prices, (p) => classIds.has(p.share_class_id));
    narrow(notes, (n) => classIds.has(n.share_class_id) && holderIds.has(n.holder_id));
  }
  const entity = new Map(entities.map((e) => [e.id, e]));
  const classCode = new Map(classes.map((c) => [c.id, `${entity.get(c.entity_id)?.code}-${c.code}`]));
  const holderId = new Map(holders.map((h) => [h.id, holderFileId(h)]));
  // Test accounts never go in the file.
  const people = profiles.filter((p) => !p.email.toLowerCase().endsWith('@lakeba.test'));
  const email = new Map(people.map((p) => [p.id, p.email]));
  const roleName = (r) => r.roles?.name ?? r.role_key;

  const companyAdmins = (eid) => roleRows.filter((r) => r.role_key === 'admin' && r.entity_id === eid).map((r) => email.get(r.user_id)).filter(Boolean).join(', ');
  // Staff roles: group roles by name; company roles as "Name (CODE)", except company Admin, which goes on the Boards sheet.
  const rolesOf = (uid) => roleRows.filter((r) => r.user_id === uid && !(r.role_key === 'admin' && r.entity_id))
    .map((r) => (r.entity_id ? `${roleName(r)} (${entity.get(r.entity_id)?.code})` : roleName(r))).sort().join(', ');
  const byText = (a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]));

  return {
    'Companies': entities.map((e) => [e.code, e.legal_name, e.display_name, e.company_number, e.country, RELATIONSHIP[e.relationship], PORTAL[e.portal],
      e.lakeba_stake == null ? null : Number(e.lakeba_stake) / 100, excelDate(e.stake_as_at), e.website, companyAdmins(e.id) || null, null]),
    'Share classes': classes.map((c) => [entity.get(c.entity_id)?.code, classCode.get(c.id), c.name,
      c.kind === 'ordinary' && !c.voting ? 'Ordinary (non-voting)' : CLASS_KIND[c.kind], yesNo(c.voting), yesNo(c.counts_toward_pct),
      c.official_on_issue == null ? null : Number(c.official_on_issue), excelDate(c.official_as_at), c.currency, null]).sort(byText),
    'Holders': holders.map((h) => [holderId.get(h.id), h.name, HOLDER_KIND[h.kind], null, null]),
    'People': people.map((p) => [p.email, p.first_name || null, p.last_name || null, p.phone, rolesOf(p.id) || null, yesNo(p.notify_email !== false), null]),
    'Access': members.filter((m) => email.has(m.user_id) && holderId.has(m.holder_id))
      .map((m) => [email.get(m.user_id), holderId.get(m.holder_id), m.access === 'viewer' ? 'Viewer' : 'Owner', null]).sort(byText),
    'Holdings': holdings.map((h) => [holderId.get(h.holder_id), classCode.get(h.share_class_id), Number(h.shares), excelDate(h.as_at), null, null, null,
      h.exercise_price == null ? null : Number(h.exercise_price), excelDate(h.expires_on)])
      .sort((a, b) => byText(a, b) || a[3] - b[3]),
    'Boards': [
      ...board.filter((b) => email.has(b.user_id)).map((b) => [entity.get(b.entity_id)?.code, email.get(b.user_id), POSITION[b.position] ?? 'Director', excelDate(b.starts_on), excelDate(b.ends_on), null]),
      ...roleRows.filter((r) => r.role_key === 'admin' && r.entity_id && email.has(r.user_id)).map((r) => [entity.get(r.entity_id)?.code, email.get(r.user_id), 'Company admin', null, excelDate(r.expires_at), null]),
    ].sort(byText),
    'Prices': prices.map((p) => [classCode.get(p.share_class_id), Number(p.price), p.currency, excelDate(p.priced_on), PRICE_SOURCE[p.source], p.note]),
    'Holding notes': notes.map((n) => [holderId.get(n.holder_id), classCode.get(n.share_class_id), n.note]).sort(byText),
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cell = (ref, style, v) => {
  const s = style ? ` s="${style}"` : '';
  if (v == null || v === '') return `<c r="${ref}"${s}/>`;
  if (typeof v === 'number') return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
};

/**
 * The template filled with these rows. Row 3 (the example) stays; the
 * template's own sample rows are replaced.
 * @param {Buffer | Uint8Array} template
 * @param {Record<string, unknown[][]>} rows
 * @param {string} versionText shown on "Start here"
 */
export async function fillWorkbook(template, rows, versionText) {
  const zip = await JSZip.loadAsync(template);
  const wb = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const target = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/Id="([^"]+)"/)[1], m[0].match(/Target="([^"]+)"/)[1]]));
  const pathOf = Object.fromEntries([...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => [m[0].match(/name="([^"]+)"/)[1], target[m[0].match(/r:id="([^"]+)"/)[1]].replace(/^\/?(xl\/)?/, 'xl/')]));

  for (const [name, cols] of Object.entries(SHEETS)) {
    const path = pathOf[name];
    if (!path) throw new Error(`The template has no "${name}" sheet: rebuild it with scripts/build-investor-workbook.py.`);
    const data = rows[name] ?? [];
    let xml = await zip.file(path).async('string');
    const rowNumbers = [...xml.matchAll(/<row r="(\d+)"/g)].map((m) => +m[1]);
    const capacity = Math.max(...rowNumbers) - FIRST + 1;
    if (data.length > capacity) throw new Error(`${name}: ${data.length} rows, but the template has room for ${capacity}. Make the template bigger (ROWS in the builder).`);
    // Rows to write: every data row, and enough after it to clear the template's sample rows.
    const upto = FIRST + Math.max(data.length, 20) - 1;
    xml = xml.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (whole, rs, attrs, body) => {
      const r = +rs;
      if (r < FIRST || r > upto) return whole;
      const values = data[r - FIRST] ?? [];
      let out = body;
      [...cols].forEach((col, i) => {
        const ref = `${col}${r}`;
        const re = new RegExp(`<c r="${ref}"([^>]*?)(?:\\s*/>|>[\\s\\S]*?</c>)`);
        const m = out.match(re);
        const style = m?.[1].match(/\bs="(\d+)"/)?.[1];
        const next = cell(ref, style, values[i] ?? null);
        out = m ? out.replace(re, next) : out + next;
      });
      return `<row r="${rs}"${attrs}>${out}</row>`;
    });
    zip.file(path, xml);
  }
  const start = pathOf['Start here'];
  if (start) zip.file(start, (await zip.file(start).async('string')).replace(/Blank template\./, esc(versionText)));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
