// Staff guides (docs/guides/README.md): signs in as the sample account a seed made, opens each page in headless
// Edge (or Chrome: GUIDES_BROWSER) and saves a JPEG with numbered markers into docs/guides/img.
// Usage: node scripts/guides/shoot.mjs scripts/guides/shots-hr.json [only-this-shot]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
const HERE = new URL('.', import.meta.url).pathname;
const BASE = process.env.GUIDES_BASE ?? 'https://giuseppe-macbook-pro.tail21d16f.ts.net';
const shots = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const ONLY = process.argv[3];
const IDS = JSON.parse(readFileSync(`${HERE}ids.json`, 'utf8'));
for (const s of shots) s.path = s.path.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!IDS[k]) throw new Error(`ids.json has no ${k}: run the guide's seed first`); return IDS[k]; });
const IMG = new URL('../../docs/guides/img/', import.meta.url).pathname;
const acct = JSON.parse(readFileSync(`${HERE}account.json`, 'utf8'));
mkdirSync(IMG, { recursive: true });
const profile = `${HERE}edge-profile`;
rmSync(profile, { recursive: true, force: true });
const edge = spawn(process.env.GUIDES_BROWSER ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40 && !ws; i++) { await sleep(250); try { const t = await (await fetch('http://127.0.0.1:9333/json/list')).json(); const p = t.find((x) => x.type === 'page'); if (p) ws = p.webSocketDebuggerUrl; } catch {} }
const sock = new WebSocket(ws);
await new Promise((r) => sock.addEventListener('open', r));
let seq = 0; const wait = new Map(); const events = [];
sock.addEventListener('message', (m) => { const j = JSON.parse(m.data); if (j.id && wait.has(j.id)) { wait.get(j.id)(j); wait.delete(j.id); } else if (j.method) events.push(j.method); });
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; wait.set(id, r); sock.send(JSON.stringify({ id, method, params })); }).then((j) => { if (j.error) throw new Error(`${method}: ${j.error.message}`); return j.result; });
const evalJs = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const settle = async () => { for (let i = 0; i < 60; i++) { await sleep(150); if ((await evalJs('document.readyState')) === 'complete') break; } await evalJs('document.fonts.ready.then(() => 1)'); await sleep(400); };
const go = async (path) => { await cdp('Page.navigate', { url: BASE + path }); await sleep(300); await settle(); };
await cdp('Page.enable'); await cdp('Runtime.enable');

// Sign in.
await go('/login');
await evalJs(`(() => { document.querySelector('#email').value = ${JSON.stringify(acct.email)}; document.querySelector('#password').value = ${JSON.stringify(acct.password)}; document.querySelector('button[value=password]').click(); return 1; })()`);
await sleep(2500); await settle();
console.log('after sign-in:', await evalJs('location.pathname'));

const FIND = `window.__find = (sel) => { const [css, text] = sel.split('|text='); return [...document.querySelectorAll(css)].find((e) => !text || e.textContent.trim().startsWith(text)); }; 1`;
const MARK = `(list) => {
  const out = [];
  for (const [sel, n, how] of list) {
    const el = __find(sel);
    if (!el) { out.push('missing ' + sel); continue; }
    const r = el.getBoundingClientRect();
    const b = document.createElement('div');
    b.textContent = n;
    Object.assign(b.style, { position: 'absolute', left: (r.left + scrollX - (how === 'dot' ? 36 : 14)) + 'px', top: (r.top + scrollY + (how === 'dot' ? r.height / 2 - 14 : -14)) + 'px', width: '28px', height: '28px', borderRadius: '14px', background: '#eb802b', color: '#fff', font: '700 15px/28px Inter, system-ui, sans-serif', textAlign: 'center', zIndex: 99999, boxShadow: '0 0 0 3px #fff' });
    document.body.appendChild(b);
    if (how !== 'dot') { el.style.outline = '2.5px solid #eb802b'; el.style.outlineOffset = '4px'; }
  }
  return out;
}`;
const HIDE = `document.querySelectorAll('details').forEach((d) => d.open = !/Sign out/.test(d.textContent) && !d.querySelector('[data-tour=admin-company]')); [...document.querySelectorAll('body *')].filter((e) => getComputedStyle(e).position === 'fixed').forEach((e) => e.remove()); 1`;
for (const s of shots.filter((x) => !ONLY || x.name === ONLY)) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: s.width ?? 1440, height: s.height ?? 1000, deviceScaleFactor: 1.5, mobile: false });
  await go(s.path);
  await evalJs(FIND); await evalJs(HIDE);
  if (s.keep) await evalJs(`${JSON.stringify(s.keep)}.forEach((q) => document.querySelectorAll(q).forEach((e) => { if (!new RegExp(${JSON.stringify(s.keepRe ?? '[Ss]ample')}).test(e.textContent)) e.remove(); })); 1`);
  if (s.js) await evalJs(s.js);
  if (s.marks) { const miss = await evalJs(`(${MARK})(${JSON.stringify(s.marks)})`); if (miss.length) console.log(s.name, miss); }
  let clip;
  if (s.clip) {
    const r = await evalJs(`(() => { const rs = ${JSON.stringify(s.clip)}.map((q) => __find(q)).filter(Boolean).map((e) => e.getBoundingClientRect()); if (!rs.length) return null; const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top)); return { x: x + scrollX, y: y + scrollY, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y }; })()`);
    if (r) { const pad = s.pad ?? 48; clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + pad * 2, height: Math.min(r.height + pad * 2, s.maxHeight ?? 4000), scale: 1 }; }
    else console.log(s.name, 'clip missing');
  }
  if (!clip) { const h = await evalJs('document.documentElement.scrollHeight'); clip = { x: 0, y: 0, width: s.width ?? 1440, height: Math.min(h, s.maxHeight ?? 1400), scale: 1 }; }
  const { data } = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 72, clip: { ...clip, scale: Math.min(1, 1000 / clip.width) }, captureBeyondViewport: true });
  writeFileSync(`${IMG}${s.name}.jpg`, Buffer.from(data, 'base64'));
  console.log('ok', s.name, await evalJs('location.pathname'), Math.round(clip.width) + 'x' + Math.round(clip.height));
}
// Sign out so the session ends.
// (Sign-in sessions end when the seed's --remove deletes the account.)
sock.close(); edge.kill();
process.exit(0);
