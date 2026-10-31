// Staff guides (docs/guides/README.md): turns each docs/guides/<guide>.md into a branded A4 PDF in
// templates/guides/, which the portal serves from each department's menu. Run after changing a guide:
//   npm run guides:pdf            (needs Edge or Chrome: GUIDES_BROWSER)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { marked } = require('marked');
const DOCS = new URL('../../docs/guides/', import.meta.url).pathname;
const OUT = new URL('../../templates/guides/', import.meta.url).pathname;
const TMP = `${tmpdir()}/lakeba-guides-${process.pid}/`;
mkdirSync(OUT, { recursive: true }); mkdirSync(TMP, { recursive: true });
const MONTH = new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric' }).format(new Date());
const keys = ['hr', 'finance', 'legal', 'compliance', 'marketing'];
const CSS = `
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
body { font-family: Inter, 'Helvetica Neue', Arial, sans-serif; color: #0b1d37; font-size: 10.5pt; line-height: 1.5; margin: 0; }
.cover { background: #0b1d37; color: #fff; border-radius: 14px; padding: 26px 28px 30px; margin-bottom: 22px; }
.cover .brand { font-family: Montserrat, Arial, sans-serif; font-weight: 800; letter-spacing: .08em; font-size: 13pt; }
.cover .kicker { margin-top: 26px; font-size: 8.5pt; letter-spacing: .14em; text-transform: uppercase; color: #7aa7ff; font-weight: 600; }
.cover h1 { font-family: Montserrat, Arial, sans-serif; font-weight: 800; font-size: 23pt; line-height: 1.15; margin: 8px 0 0; color: #fff; }
.cover .meta { margin-top: 14px; color: #a9bddc; font-size: 9pt; }
h2 { font-family: Montserrat, Arial, sans-serif; font-weight: 800; font-size: 15pt; margin: 26px 0 8px; padding-top: 6px; border-top: 2px solid #e3ebf8; break-after: avoid; }
h3 { font-family: Montserrat, Arial, sans-serif; font-weight: 700; font-size: 12pt; margin: 18px 0 6px; break-after: avoid; }
p { margin: 6px 0; }
img { display: block; max-width: 100%; max-height: 225mm; margin: 10px auto 8px; border: 1px solid #d5e0f2; border-radius: 8px; break-inside: avoid; }
ol, ul { margin: 6px 0 10px; padding-left: 22px; }
li { margin: 3px 0; }
ol > li::marker { color: #eb802b; font-weight: 700; }
blockquote { margin: 10px 0; padding: 9px 14px; background: #f4f7fc; border-left: 4px solid #276ae7; border-radius: 6px; break-inside: avoid; }
blockquote p { margin: 3px 0; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9.5pt; break-inside: avoid; }
th { background: #0b1d37; color: #fff; text-align: left; padding: 6px 8px; font-weight: 600; }
td { border-bottom: 1px solid #e3ebf8; padding: 6px 8px; vertical-align: top; }
tr:nth-child(even) td { background: #f8fafd; }
input[type=checkbox] { margin-right: 6px; }
li:has(> input[type=checkbox]) { list-style: none; margin-left: -18px; }
strong { color: #0b1d37; }
`;
for (const k of keys) {
  let md = readFileSync(`${DOCS}${k}.md`, 'utf8');
  const title = md.match(/^# (.+)$/m)[1];
  md = md.replace(/^# .+\n/, '');
  const body = marked.parse(md);
  writeFileSync(`${DOCS}.${k}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Montserrat:wght@700;800&display=swap"><style>${CSS}</style></head>
<body><div class="cover"><div class="brand">LAKEBA</div><div class="kicker">Staff guide · Lakeba Portal</div><h1>${title}</h1><div class="meta">${MONTH} · screens show sample data</div></div>${body}</body></html>`);
}
const edge = spawn(process.env.GUIDES_BROWSER ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${TMP}browser`, '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; for (let i = 0; i < 40 && !ws; i++) { await sleep(250); try { const t = await (await fetch('http://127.0.0.1:9334/json/list')).json(); ws = t.find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch {} }
const sock = new WebSocket(ws); await new Promise((r) => sock.addEventListener('open', r));
let seq = 0; const wait = new Map();
sock.addEventListener('message', (m) => { const j = JSON.parse(m.data); if (j.id && wait.has(j.id)) { wait.get(j.id)(j); wait.delete(j.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; wait.set(id, r); sock.send(JSON.stringify({ id, method, params })); }).then((j) => { if (j.error) throw new Error(j.error.message); return j.result; });
await cdp('Page.enable');
for (const k of keys) {
  await cdp('Page.navigate', { url: `file://${DOCS}.${k}.html` });
  for (let i = 0; i < 80; i++) { await sleep(200); const r = await cdp('Runtime.evaluate', { expression: 'document.readyState === "complete" && [...document.images].every((i) => i.complete)', returnByValue: true }); if (r.result.value) break; }
  await cdp('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true });
  const footer = `<div style="width:100%;font:8px Arial;color:#8a9ab2;padding:0 15mm;display:flex;justify-content:space-between"><span>Lakeba Portal · staff guide</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
  const { data } = await cdp('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: footer });
  writeFileSync(`${OUT}${k}.pdf`, Buffer.from(data, 'base64'));
  rmSync(`${DOCS}.${k}.html`);
  console.log(k, Math.round(Buffer.from(data, 'base64').length / 1024), 'KB');
}
sock.close(); edge.kill();
await new Promise((r) => { edge.on('exit', r); setTimeout(r, 3000); });
try { rmSync(TMP, { recursive: true, force: true }); } catch {}
process.exit(0);
