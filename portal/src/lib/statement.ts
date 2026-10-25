import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import type { Position, Price } from './holdings';
import { aud, audPrecise, holderKinds, longDate, percent, shares } from './format';

const PETAL = 'M15 11C21 4.5 28 1.5 36 1.5C43 1.5 46.5 3.5 50 5.5C53.5 3.5 57 1.5 64 1.5C72 1.5 79 4.5 85 11L63 33C58 38 54.5 39.5 50 39.5C45.5 39.5 42 38 37 33Z';
const PETAL_COLORS = [rgb(0.153, 0.416, 0.906), rgb(0.922, 0.502, 0.169), rgb(0.867, 0.231, 0.176), rgb(0.208, 0.663, 0.329)];
const INK = rgb(0.043, 0.114, 0.216);
const MUTED = rgb(0.42, 0.48, 0.56);

/** A personal holding statement for one holder and share class. */
/** issuer: the company whose shares these are (legal name for the heading, its ACN/ABN under it, short name in the notes). */
export async function holdingStatementPdf(position: Position, price: Price | undefined, recipient: string, issuer: { legal: string; short: string; identity?: string } = { legal: 'Lakeba Group Limited', short: 'Lakeba' }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Holding statement – ${position.holder.name}`);
  pdf.setAuthor(issuer.legal);
  const page = pdf.addPage([595.28, 841.89]); // A4
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const left = 56;
  let y = height - 64;

  // Logo: four petals turned about the centre of their 100×100 box. pdf-lib
  // rotates about the path origin, so shift each origin to keep the centre fixed.
  const scale = 0.3;
  const cx = left + 50 * scale;
  const cy = y + 8 - 50 * scale;
  PETAL_COLORS.forEach((color, i) => {
    const a = (-90 * i * Math.PI) / 180;
    const vx = 50 * scale;
    const vy = -50 * scale;
    const x = cx - (vx * Math.cos(a) - vy * Math.sin(a));
    const yy = cy - (vx * Math.sin(a) + vy * Math.cos(a));
    page.drawSvgPath(PETAL, { x, y: yy, scale, color, rotate: degrees(-90 * i) });
  });
  page.drawText('lakeba', { x: left + 38, y: y - 14, size: 18, font: bold, color: INK });
  page.drawText('Holding statement', { x: width - left - bold.widthOfTextAtSize('Holding statement', 16), y: y - 12, size: 16, font: bold, color: INK });
  y -= 70;

  const text = (s: string, x: number, yy: number, opts: { size?: number; font?: typeof regular; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(s, { x, y: yy, size: opts.size ?? 10, font: opts.font ?? regular, color: opts.color ?? INK });

  text(issuer.legal, left, y, { font: bold, size: 11 });
  text(`Statement date: ${longDate.format(new Date())}`, width - left - 170, y, { color: MUTED });
  if (issuer.identity) { y -= 14; text(issuer.identity, left, y, { size: 9, color: MUTED }); }
  y -= 34;

  const field = (label: string, value: string, x: number) => {
    text(label.toUpperCase(), x, y, { size: 8, color: MUTED });
    text(value, x, y - 15, { size: 12, font: bold });
  };
  field('Holder', position.holder.name, left);
  field('Holder type', holderKinds[position.holder.kind] ?? position.holder.kind, left + 300);
  y -= 46;
  field('Registry reference', position.holder.registry_ref ?? '—', left);
  field('Share class', position.row.share_classes?.name ?? '', left + 300);
  y -= 60;

  // Headline figures in a tinted box.
  page.drawRectangle({ x: left, y: y - 54, width: width - left * 2, height: 74, color: rgb(0.94, 0.96, 1) });
  const pct = position.total ? percent.format(position.row.shares / position.total) : '—';
  const headline = [
    [position.row.share_classes?.counts_toward_pct === false ? 'Held' : 'Shares held', shares.format(position.row.shares)],
    ['Of total on issue', pct],
    ['Total on issue', shares.format(position.total)],
  ];
  headline.forEach(([label, value], i) => {
    const x = left + 16 + i * 162;
    text(label.toUpperCase(), x, y, { size: 8, color: MUTED });
    text(value, x, y - 26, { size: 18, font: bold });
  });
  y -= 92;
  text(`As at ${longDate.format(new Date(position.row.as_at))}.`, left, y, { color: MUTED, size: 9 });
  y -= 40;

  text('Holding history', left, y, { font: bold, size: 12 });
  y -= 22;
  text('AS AT', left, y, { size: 8, color: MUTED });
  text('SHARES', left + 300, y, { size: 8, color: MUTED });
  y -= 6;
  page.drawLine({ start: { x: left, y }, end: { x: width - left, y }, thickness: 0.5, color: MUTED });
  for (const row of [...position.history].reverse().slice(0, 12)) {
    y -= 18;
    text(longDate.format(new Date(row.as_at)), left, y);
    text(shares.format(row.shares), left + 300, y);
  }
  y -= 40;

  if (price) {
    text('Indicative value', left, y, { font: bold, size: 12 });
    y -= 20;
    text(`${aud.format(position.row.shares * price.price)}  (${shares.format(position.row.shares)} × ${audPrecise.format(price.price)} reference price of ${longDate.format(new Date(price.priced_on))})`, left, y);
    y -= 16;
    text(`Indicative only. ${issuer.short} shares are unlisted; this is not a valuation, an offer or financial advice.`, left, y, { size: 8, color: MUTED });
  }

  text(`Prepared for ${recipient} from the ${issuer.short} Investor Portal${issuer.short === 'Lakeba' ? '' : ', powered by Lakeba'}. Questions: info@lakeba.com`, left, 48, { size: 8, color: MUTED });
  return pdf.save();
}
