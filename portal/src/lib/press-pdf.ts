import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { composeRelease, type PressSettings, type Release } from './press';

const INK = rgb(0.043, 0.114, 0.216);
const MUTED = rgb(0.42, 0.48, 0.56);
const BLUE = rgb(0.153, 0.416, 0.906);
// The standard PDF fonts only know Western characters: anything else becomes "?".
const WIN_ANSI = /[^\x20-\x7e\xa0-\xff“”‘’–—…•€™]/g;
const plain = (s: string) => s.replace(WIN_ANSI, '?');
const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)));

/** The release's text as blocks: paragraphs, list items and subheadings. */
function blocksOf(html: string) {
  const out: { kind: 'p' | 'li' | 'h'; text: string }[] = [];
  for (const m of html.matchAll(/<(p|li|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = decode(m[2].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();
    if (text) out.push({ kind: m[1].toLowerCase() === 'h3' ? 'h' : m[1].toLowerCase() === 'li' ? 'li' : 'p', text });
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const para of plain(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else { if (line) lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

/** The press release as an A4 PDF, for the press kit. */
export async function releasePdf(r: Release, s: PressSettings, when: string, url: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(plain(r.headline)); pdf.setAuthor('Lakeba Group'); pdf.setSubject('Press release');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H, left] = [595.28, 841.89, 60];
  const width = W - left * 2;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - 64;
  const newPage = () => { page = pdf.addPage([W, H]); y = H - 64; };
  const write = (text: string, font: PDFFont, size: number, color = INK, gap = 0.5) => {
    for (const line of wrap(text, font, size, width)) {
      if (y < 70) newPage();
      page.drawText(line, { x: left, y, size, font, color });
      y -= size * 1.45;
    }
    y -= size * gap;
  };
  page.drawText('lakeba', { x: left, y, size: 20, font: bold, color: INK });
  page.drawText('PRESS RELEASE', { x: W - left - bold.widthOfTextAtSize('PRESS RELEASE', 10), y: y + 4, size: 10, font: bold, color: BLUE });
  y -= 44;
  write(r.headline, bold, 19, INK, 0.4);
  if (r.subheadline) write(r.subheadline, regular, 13, MUTED, 0.9);
  for (const b of blocksOf(composeRelease(r, s, when))) {
    if (b.kind === 'h') { y -= 6; write(b.text, bold, 12, INK, 0.3); }
    else if (b.kind === 'li') write(`•  ${b.text}`, regular, 10.5, INK, 0.3);
    else write(b.text, regular, 10.5, INK, 0.75);
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(plain(url), { x: left, y: 36, size: 8, font: regular, color: MUTED });
    const n = `${i + 1} / ${pages.length}`;
    p.drawText(n, { x: W - left - regular.widthOfTextAtSize(n, 8), y: 36, size: 8, font: regular, color: MUTED });
  });
  return pdf.save();
}
