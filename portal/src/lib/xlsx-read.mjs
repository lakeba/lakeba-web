// Minimal .xlsx reader: values per sheet, row and column (1-based). Handles
// shared and inline strings, numbers, booleans, cached formula results and
// dates (by cell number format). Enough for the investor data workbook.
import JSZip from 'jszip';

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const excelDate = (n) => new Date(Math.round((n - 25569) * 86400_000));

/** @param {Buffer | Uint8Array} data */
export async function readXlsx(data) {
  const zip = await JSZip.loadAsync(data);
  const get = async (p) => (zip.file(p) ? zip.file(p).async('string') : '');
  const shared = [...(await get('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const styles = await get('xl/styles.xml');
  const customDate = new Set([...styles.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)].filter((m) => /[dmy]/i.test(decode(m[2]).replace(/"[^"]*"|\[[^\]]*\]/g, ''))).map((m) => +m[1]));
  const xfs = (styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '').match(/<xf\b[^>]*>/g) ?? [];
  const isDateStyle = xfs.map((xf) => { const id = +(xf.match(/numFmtId="(\d+)"/)?.[1] ?? 0); return BUILTIN_DATES.has(id) || customDate.has(id); });

  const wbXml = await get('xl/workbook.xml');
  const rels = await get('xl/_rels/workbook.xml.rels');
  const target = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/Id="([^"]+)"/)[1], m[0].match(/Target="([^"]+)"/)[1]]));
  const sheets = {};
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(m[0].match(/name="([^"]+)"/)[1]);
    const rid = m[0].match(/r:id="([^"]+)"/)[1];
    const path = target[rid].replace(/^\/?(xl\/)?/, 'xl/');
    const xml = await get(path);
    const rows = new Map();
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]; const body = c[2] ?? '';
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1]; if (!ref) continue;
      const t = attrs.match(/\bt="([^"]+)"/)?.[1]; const s = +(attrs.match(/\bs="(\d+)"/)?.[1] ?? 0);
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = null;
      if (t === 's') value = v != null ? shared[+v] : null;
      else if (t === 'inlineStr') value = texts(body);
      else if (t === 'str') value = v != null ? decode(v) : null;
      else if (t === 'b') value = v === '1';
      else if (t === 'e') value = null;
      else if (v != null) value = isDateStyle[s] ? excelDate(+v) : +v;
      if (value === '') value = null;
      const r = +ref.match(/\d+/)[0];
      if (!rows.has(r)) rows.set(r, new Map());
      rows.get(r).set(colIndex(ref), value);
    }
    sheets[name] = rows;
  }
  return sheets;
}
