import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import type { serviceClient } from './admin';
import { asVector, embed } from './retrieval';

// The law library for Board Ask (Admin → Board Ask → Law library): Acts,
// regulations, ASIC regulatory guides and accounting standards uploaded as
// PDF, Word or text (e.g. the compilation from legislation.gov.au). The text is
// split into passages under the section or paragraph they belong to, so
// answers can cite "s 180" or "AASB 10 para 7", and embedded on this server
// (as for Ask) for searching by meaning.

type Svc = ReturnType<typeof serviceClient>;
export const LAW_KINDS = { act: 'Act', regulation: 'Regulations', guide: 'Regulatory guide', standard: 'Accounting standard', other: 'Other' } as const;
export type LawKind = keyof typeof LAW_KINDS;
const CHUNK = 1800;
export const MAX_LAW_FILE = 60 * 1024 * 1024;

/** The file's text, page by page (one page for Word and text). */
async function pagesOf(name: string, bytes: Uint8Array): Promise<string[]> {
  if (/\.pdf$/i.test(name)) {
    // A copy: pdf.js takes over the bytes it is given, leaving the original empty.
    const { text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: false });
    return text;
  }
  if (/\.docx$/i.test(name)) return [(await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value];
  if (/\.(txt|md)$/i.test(name)) return [new TextDecoder().decode(bytes)];
  if (/\.html?$/i.test(name)) {
    const html = new TextDecoder().decode(bytes).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|h\d|li|tr|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
    return [html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, '’')];
  }
  throw new Error('Upload a PDF, Word (.docx), text or HTML file.');
}

// A section heading in an Act ("180  Care and diligence—civil obligation only"),
// a part of the Act ("Part 2D.1—Duties and powers"), or a paragraph of a
// standard or guide ("Aus7.1", "RG 259.12", "B86"). Table-of-contents lines end
// in a page number and don't count.
const SECTION = /^(\d{1,4}[A-Z]{0,4})\s{1,6}([A-Z][^\n]{2,150}?)\s*$/;
// A regulation's heading ("2M.3.03 Disclosure of…").
const REGULATION = /^(\d{1,2}[A-Z]{0,2}\.\d{1,2}[A-Z]{0,2}\.\d{2,3}[A-Z]{0,3})\s{1,6}([A-Z][^\n]{2,150}?)\s*$/;
// A part heading has a title starting in capitals ("Part 5.7B Recovering property…"), unlike a sentence that starts with "Part 2J.1 applies…".
const PART = /^((?:Chapter|Part|Division|Subdivision|Schedule)\s+\d[0-9A-Z.]*(?=[\s—–-]))\s*[—–-]?\s*([A-Z][^\n]{2,150}?)\s*$/;
// Running headers in legislation PDFs: "Part 5.7B", "Section 588G", "Director’s duty to prevent insolvent trading Division 3".
const BARE_HEADER = /^(Chapter|Part|Division|Subdivision|Section|Schedule)\s+\d[0-9A-Z.]*$/;
const TITLE_HEADER = /^[A-Z].{3,140}\s(Chapter|Part|Division|Subdivision)\s+\d?[0-9A-Z.]*$/;
// The footer on every page of a compilation from legislation.gov.au, sometimes run into the last line.
const FOOTER = /(?:Rectified )?Authorised Version(?: [A-Z]\d{4}[A-Z]\d{5}(?:VOL\d+)?)? registered \d{2}\/\d{2}\/\d{4}(?: [A-Z]\d{4}[A-Z]\d{5}(?:VOL\d+)?)?/g;
const PARAGRAPH = /^((?:Aus)?[A-Z]{0,2}\d{1,3}(?:\.\d{1,3})?[A-Z]?|RG\s?\d{1,3}\.\d{1,4})\s+(?=[A-Z(])/;
const tocLine = (l: string) => /(\.{3,}|\s)\d{1,4}$/.test(l) && /\.{3,}|\t/.test(l);
/** A heading's second line: short, starting in lower case ("company" after "…insolvent trading by"). */
const continues = (l: string | undefined) => Boolean(l && l.length <= 50 && /^[a-z]/.test(l) && !/[;:,()]/.test(l));
/** Dates in a compilation's endnotes ("11 Apr 2003 (s 2(1) items 5, 7)"), not section headings. */
const ENDNOTE_DATE = /^(Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/;

export type LawChunk = { chunk_index: number; heading: string; page: number; content: string };

/**
 * Lines to leave out: running headers and footers (the same line, numbers
 * aside, on many pages, e.g. "180 Corporations Act 2001" and the compilation
 * date), and whole contents pages (mostly section headings).
 */
function bodyLines(pages: string[], kind: LawKind) {
  const lines = pages.map((t) => t.split(/\r?\n/).map((l) => l.replace(FOOTER, '').trim()).filter(Boolean));
  const norm = (l: string) => l.replace(/\d+/g, '#').replace(/\s+/g, ' ');
  const seen = new Map<string, number>();
  for (const page of lines) for (const n of new Set(page.map(norm))) seen.set(n, (seen.get(n) ?? 0) + 1);
  // A line with a page number at either end ("208 Corporations Act 2001", "Corporations Act 2001 209") is a header
  // when it is on a fifth of the pages (even and odd pages differ); any other line when it is on half of them.
  const repeated = (l: string) => { const n = norm(l); return n.length >= 6 && (seen.get(n) ?? 0) >= Math.max(3, pages.length * (/^#|#$/.test(n) ? 0.2 : 0.5)); };
  const act = kind === 'act' || kind === 'regulation';
  return lines.map((page) => {
    // Contents pages: dotted leaders to page numbers, or (without them) almost nothing but headings.
    const leaders = page.filter(tocLine).length;
    const body = page.filter((l) => !repeated(l) && !tocLine(l) && !(act && (BARE_HEADER.test(l) || (TITLE_HEADER.test(l) && (seen.get(norm(l)) ?? 0) >= 2))));
    const headings = body.filter((l) => SECTION.test(l) || REGULATION.test(l) || PART.test(l)).length;
    const contents = act && (leaders >= 3 || (body.length >= 8 && headings / body.length > 0.6));
    return contents ? [] : body;
  });
}

/** Splits the text into passages, each with the heading it falls under. */
export function lawChunks(pages: string[], kind: LawKind): LawChunk[] {
  const out: LawChunk[] = [];
  const level = { part: '', division: '', section: '' };
  // Paragraphs of a standard or guide seen in the passage being built, and the last one before it.
  let paras: string[] = [];
  let lastPara = '';
  let buf = '';
  let bufPage = 1;
  const flush = () => {
    const text = buf.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const para = paras.length ? (paras.length === 1 ? `para ${paras[0]}` : `paras ${paras[0]}–${paras.at(-1)}`) : lastPara ? `para ${lastPara}` : '';
    if (text.length > 40) out.push({ chunk_index: out.length, heading: [level.part, level.division, level.section, para].filter(Boolean).join(', ').slice(0, 300), page: bufPage, content: text });
    if (paras.length) lastPara = paras.at(-1)!;
    paras = [];
    buf = '';
  };
  bodyLines(pages, kind).forEach((lines, p) => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const pm = line.length < 160 ? PART.exec(line) : null;
      const sm = kind === 'act' ? SECTION.exec(line) : kind === 'regulation' ? REGULATION.exec(line) : null;
      const gm = kind !== 'act' && kind !== 'regulation' && !/^\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/.test(line) ? PARAGRAPH.exec(line) : null;
      if (pm) {
        flush();
        let name = `${pm[1]}${pm[2] ? ` ${pm[2]}` : ''}`;
        while (continues(lines[i + 1])) name += ` ${lines[++i]}`;
        if (/^(Division|Subdivision)/.test(pm[1])) level.division = name; else { level.part = name; level.division = ''; }
        level.section = '';
        continue;
      }
      let text = line;
      if (sm && !/[.;:,]$/.test(sm[2]) && !ENDNOTE_DATE.test(sm[2])) {
        flush();
        let title = sm[2];
        while (continues(lines[i + 1])) { title += ` ${lines[++i]}`; text += ` ${lines[i]}`; }
        level.section = `${kind === 'regulation' ? 'reg' : 's'} ${sm[1]} ${title}`;
      }
      if (gm) { if (buf.length > CHUNK / 2) flush(); paras.push(gm[1]); }
      if (!buf) bufPage = p + 1;
      buf += `${text}\n`;
      if (buf.length > CHUNK) {
        // Cut at a line end; the rest starts the next passage under the same heading.
        const cut = buf.lastIndexOf('\n', CHUNK);
        const at = cut > CHUNK / 2 ? cut : CHUNK;
        const rest = buf.slice(at);
        buf = buf.slice(0, at);
        flush();
        buf = rest;
        bufPage = p + 1;
      }
    }
  });
  flush();
  return out;
}

/** Reads a new law library file into passages; embedding follows in the background. */
export async function addLawSource(svc: Svc, file: File, meta: { title: string; citation: string; kind: LawKind; version_note: string; url: string }, userId: string) {
  if (!file.size) throw new Error('Choose a file.');
  if (file.size > MAX_LAW_FILE) throw new Error('That file is over 60 MB. Upload the volumes one by one.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pages = await pagesOf(file.name, bytes);
  if (!bytes.length) throw new Error('The file came through empty. Try again.');
  const { data: source } = await svc.from('law_sources').insert({ ...meta, file_name: file.name.slice(0, 200), created_by: userId }).select('id').single().throwOnError();
  try {
    const path = `law/${source!.id}/${file.name.replace(/[^\w.\-]+/g, '_').slice(-120)}`;
    await svc.storage.from('legal').upload(path, bytes, { contentType: file.type || 'application/octet-stream' });
    const chunks = lawChunks(pages, meta.kind);
    if (chunks.length < 3) throw new Error('Hardly any text came out of this file. If it is a scan, upload the text version from the official site.');
    for (let i = 0; i < chunks.length; i += 500) {
      await svc.from('law_chunks').insert(chunks.slice(i, i + 500).map((c) => ({ ...c, source_id: source!.id }))).throwOnError();
    }
    await svc.from('law_sources').update({ file_path: path, status: 'ready', chunk_count: chunks.length }).eq('id', source!.id).throwOnError();
    void embedLaw(svc).catch((e) => console.error('law library embedding', e));
    return { id: source!.id as string, chunks: chunks.length };
  } catch (e) {
    await svc.from('law_sources').update({ status: 'failed', error: (e as Error).message.slice(0, 500) }).eq('id', source!.id);
    throw e;
  }
}

/** Splits a source again from its stored file (after the splitting rules improve); its passages are replaced. */
export async function rereadLawSource(svc: Svc, id: string) {
  const { data: src } = await svc.from('law_sources').select('id, kind, file_path, file_name').eq('id', id).single().throwOnError();
  if (!src?.file_path) throw new Error('No file is stored for this one: upload it again.');
  const { data: blob } = await svc.storage.from('legal').download(src.file_path);
  const bytes = new Uint8Array(await (blob ?? new Blob()).arrayBuffer());
  if (!bytes.length) throw new Error('The stored file is empty (an earlier fault): remove this one and upload the file again.');
  const chunks = lawChunks(await pagesOf(src.file_name, bytes), src.kind as LawKind);
  if (chunks.length < 3) throw new Error('Hardly any text came out of this file.');
  await svc.from('law_chunks').delete().eq('source_id', id).throwOnError();
  for (let i = 0; i < chunks.length; i += 500) await svc.from('law_chunks').insert(chunks.slice(i, i + 500).map((c) => ({ ...c, source_id: id }))).throwOnError();
  await svc.from('law_sources').update({ status: 'ready', error: null, chunk_count: chunks.length }).eq('id', id).throwOnError();
  void embedLaw(svc).catch((e) => console.error('law library embedding', e));
  return chunks.length;
}

let embedding: Promise<number> | null = null;
/** Embeds passages that don't have an embedding yet (one run at a time). Until then they are found by their words. */
export function embedLaw(svc: Svc) {
  embedding ??= (async () => {
    let n = 0;
    try {
      for (;;) {
        const { data } = await svc.from('law_chunks').select('id, heading, content, law_sources(title)').is('embedding', null).limit(128);
        if (!data?.length) break;
        const vectors = await embed(data.map((c) => `${(c.law_sources as unknown as { title: string } | null)?.title ?? ''} ${c.heading}\n\n${c.content}`));
        for (let i = 0; i < data.length; i += 16) {
          await Promise.all(data.slice(i, i + 16).map((c, j) => svc.from('law_chunks').update({ embedding: asVector(vectors[i + j]) }).eq('id', c.id).throwOnError()));
        }
        n += data.length;
      }
    } finally { embedding = null; }
    return n;
  })();
  return embedding;
}

/** How many passages are still waiting for their embedding. */
export async function lawPending(svc: Svc) {
  const { count } = await svc.from('law_chunks').select('id', { count: 'exact', head: true }).is('embedding', null);
  return count ?? 0;
}
