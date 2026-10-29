import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

// PDFs of directors' resolutions and minutes (Admin → Legal → Board): the
// paper as sent for signing, then the same pages with a signing record added
// once everyone has signed, and a company's minute book (every signed paper in
// date order). The pages that were signed are never redrawn: the signed copy
// is the sent PDF plus its record page, and the record quotes the sent PDF's
// SHA-256 so the two can be checked against each other.

const INK = rgb(0.067, 0.094, 0.153);
const MUTED = rgb(0.42, 0.46, 0.53);
const RULE = rgb(0.85, 0.87, 0.9);
// The standard PDF fonts only know Western characters: anything else becomes "?".
const plain = (s: string) => s.replace(/[\u2028\u2029]/g, ' ').replace(/[^\x20-\x7e\xa0-\xff“”‘’–—…•€™\n]/g, '?');

const A4 = { w: 595.28, h: 841.89 };
const M = 64;

type Writer = { doc: PDFDocument; page: PDFPage; y: number; regular: PDFFont; bold: PDFFont; footer: string };

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const para of plain(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else { if (line) out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

function newPage(w: Writer) {
  w.page = w.doc.addPage([A4.w, A4.h]);
  w.y = A4.h - M;
}

function text(w: Writer, s: string, { size = 10.5, font = w.regular, color = INK, indent = 0, gap = 4, lead = 1.45 } = {}) {
  for (const line of wrap(s, font, size, A4.w - 2 * M - indent)) {
    if (w.y < M + 40) newPage(w);
    w.page.drawText(line, { x: M + indent, y: w.y - size, size, font, color });
    w.y -= size * lead;
  }
  w.y -= gap;
}

function rule(w: Writer, gap = 10) {
  w.page.drawLine({ start: { x: M, y: w.y }, end: { x: A4.w - M, y: w.y }, thickness: 0.6, color: RULE });
  w.y -= gap;
}

/** Page numbers and the footer line on every page. */
function finish(w: Writer) {
  const pages = w.doc.getPages();
  pages.forEach((p, i) => {
    const label = plain(`${w.footer} · page ${i + 1} of ${pages.length}`);
    p.drawText(label, { x: M, y: 32, size: 8, font: w.regular, color: MUTED });
  });
}

export type PaperPdf = {
  company: string; acn: string | null; madeUnder: string; title: string; body: string; kind: 'resolution' | 'minutes';
  signers: { name: string; position: string }[]; reference: string;
};

/** The paper as it is sent for signing (signature lines, no signatures). */
export async function paperPdf(p: PaperPdf) {
  const doc = await PDFDocument.create();
  doc.setTitle(plain(`${p.company} – ${p.title}`));
  doc.setCreator('Lakeba portal');
  const w: Writer = { doc, page: doc.addPage([A4.w, A4.h]), y: A4.h - M, regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), footer: `${p.company} · ${p.reference}` };
  text(w, p.company, { size: 15, font: w.bold, gap: 0 });
  if (p.acn) text(w, `ACN ${p.acn}`, { size: 9.5, color: MUTED, gap: 2 });
  text(w, p.madeUnder, { size: 9.5, color: MUTED, gap: 10 });
  rule(w, 18);
  text(w, p.title, { size: 13, font: w.bold, gap: 10 });
  for (const block of p.body.split(/\n{2,}/)) {
    const b = block.trim();
    if (!b) continue;
    if (b.startsWith('## ')) { w.y -= 4; text(w, b.slice(3), { size: 11, font: w.bold, gap: 4 }); continue; }
    // Numbered lines and bullets hang their text after the number.
    if (/^(\d+\.|•)\s/m.test(b)) {
      for (const item of b.split('\n')) {
        const m = item.match(/^(\d+\.|•)\s+(.*)$/);
        if (!m) { text(w, item); continue; }
        const y = w.y;
        if (y < M + 40) newPage(w);
        w.page.drawText(m[1], { x: M, y: w.y - 10.5, size: 10.5, font: m[1] === '•' ? w.regular : w.bold, color: INK });
        text(w, m[2], { indent: 22, gap: 5 });
      }
      continue;
    }
    text(w, b, { gap: 7 });
  }
  w.y -= 14;
  if (w.y < M + 60 + 56 * p.signers.length) newPage(w);
  text(w, p.kind === 'minutes' ? 'Signed as a correct record by the chair' : 'Signed by the directors', { size: 11, font: w.bold, gap: 14 });
  for (const s of p.signers) {
    w.page.drawLine({ start: { x: M, y: w.y - 22 }, end: { x: M + 220, y: w.y - 22 }, thickness: 0.6, color: MUTED });
    w.page.drawText(plain(`${s.name}, ${s.position}`), { x: M, y: w.y - 36, size: 9.5, font: w.regular, color: INK });
    w.page.drawText('Signed electronically: see the signing record', { x: M + 250, y: w.y - 36, size: 8.5, font: w.regular, color: MUTED });
    w.y -= 56;
  }
  finish(w);
  return doc.save();
}

export type Signed = { name: string; position: string; typed_name: string; signed_at: string; how: string };

/** The sent PDF with the signing record added as its last page. */
export async function signedPdf(sent: Uint8Array, r: { company: string; title: string; reference: string; sha256: string; sentAt: string; signatures: Signed[] }) {
  const doc = await PDFDocument.load(sent);
  const w: Writer = { doc, page: doc.addPage([A4.w, A4.h]), y: A4.h - M, regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), footer: `${r.company} · ${r.reference}` };
  const when = (iso: string) => new Intl.DateTimeFormat('en-AU', { dateStyle: 'long', timeStyle: 'long', timeZone: 'Australia/Sydney' }).format(new Date(iso));
  text(w, 'Signing record', { size: 15, font: w.bold, gap: 4 });
  text(w, `${r.company} – ${r.title}`, { color: MUTED, gap: 12 });
  rule(w, 14);
  text(w, `Sent for signing on ${when(r.sentAt)}. The pages before this one are the document as sent; its SHA-256 fingerprint is:`, { gap: 4 });
  text(w, r.sha256, { size: 9, font: w.bold, gap: 14 });
  for (const s of r.signatures) {
    text(w, `${s.name}, ${s.position}`, { size: 11, font: w.bold, gap: 2 });
    text(w, `Signed on ${when(s.signed_at)}, typing “${s.typed_name}”.`, { gap: 2 });
    text(w, s.how, { size: 9, color: MUTED, gap: 12 });
  }
  rule(w, 12);
  text(w, 'Each signer signed in to the Lakeba portal with two-step verification, read the document and signed it by typing their name. The record of each signature is kept in the portal’s audit log. Documents may be signed electronically under the Corporations Act 2001 (Cth).', { size: 9, color: MUTED });
  const pages = doc.getPages();
  pages[pages.length - 1].drawText(plain(`${r.company} · ${r.reference} · signing record`), { x: M, y: 32, size: 8, font: w.regular, color: MUTED });
  return doc.save();
}

/** A company's minute book: a contents page, then each signed paper as it was signed. */
export async function minuteBook(company: string, papers: { title: string; date: string; pdf: Uint8Array }[]) {
  const doc = await PDFDocument.create();
  doc.setTitle(plain(`${company} – Minute book`));
  const w: Writer = { doc, page: doc.addPage([A4.w, A4.h]), y: A4.h - M, regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), footer: `${company} · minute book` };
  text(w, company, { size: 15, font: w.bold, gap: 2 });
  text(w, `Minute book · ${papers.length} signed resolution${papers.length === 1 ? '' : 's'} and minutes, in date order`, { color: MUTED, gap: 12 });
  rule(w, 14);
  let pageNo = 2;
  const counts: number[] = [];
  for (const p of papers) { const d = await PDFDocument.load(p.pdf); counts.push(d.getPageCount()); }
  papers.forEach((p, i) => { text(w, `${p.date}   ${p.title}   (page ${pageNo})`, { size: 9.5, gap: 2 }); pageNo += counts[i]; });
  for (const p of papers) {
    const src = await PDFDocument.load(p.pdf);
    for (const pg of await doc.copyPages(src, src.getPageIndices())) doc.addPage(pg);
  }
  return doc.save();
}
