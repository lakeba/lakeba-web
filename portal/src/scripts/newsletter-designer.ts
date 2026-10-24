import grapesjs, { type Editor, type Component } from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import mjmlPlugin from 'grapesjs-mjml';
import { initDesignAi } from './newsletter-design-ai';

// The drag-and-drop newsletter designer (GrapesJS + MJML). The design is kept
// in two hidden fields: the GrapesJS project (to reopen exactly) and its MJML
// (which the server compiles into the email). Portal blocks hold placeholders
// such as {{news}} that are filled per reader when the issue is sent.

const PORTAL_BLOCKS: [string, string, string][] = [
  ['portal-greeting', 'Greeting', '{{greeting}}'],
  ['portal-holding', 'Their holding', '{{holding}}'],
  ['portal-news', 'News list', '{{news}}'],
  ['portal-documents', 'New documents', '{{documents}}'],
  ['portal-meetings', 'Upcoming meetings', '{{meetings}}'],
  ['portal-button', 'Portal sign-in', '{{portal_button}}'],
];
const section = (inner: string, padding = '0 28px') => `<mj-section background-color="#ffffff" padding="${padding}"><mj-column>${inner}</mj-column></mj-section>`;
const icon = (glyph: string) => `<div style="font-size:26px;line-height:1">${glyph}</div>`;

export type Designer = { editor: Editor; sync: () => void; fillContent: (mjml: string) => void };

export function initDesigner(form: HTMLFormElement, onChange: () => void): Designer | null {
  const host = form.querySelector<HTMLElement>('[data-designer]');
  if (!host) return null;
  const mjmlInput = form.querySelector<HTMLInputElement>('input[name="mjml"]')!;
  const jsonInput = form.querySelector<HTMLInputElement>('input[name="design_json"]')!;
  const brand = host.dataset.brand || '#276ae7';
  const abs = (u: string) => (u.startsWith('/') ? `${location.origin}${u}` : u);

  const editor = grapesjs.init({
    container: host,
    height: '100%',
    fromElement: false,
    storageManager: false,
    plugins: [mjmlPlugin],
    pluginsOpts: { [mjmlPlugin as unknown as string]: { resetDevices: true, imagePlaceholderSrc: `${location.origin}/favicon.svg` } },
    colorPicker: { showPalette: true, palette: [[brand, '#0b1d37', '#ffffff', '#eef2f8', '#6b7a90', '#3d4b60', '#35a954', '#eb802b', '#dd3b2d', '#f2f6fd']] } as never,
    assetManager: {
      upload: false,
      // Uploads go to the portal's image store (the same as news images).
      uploadFile: async (ev: DragEvent & { target: HTMLInputElement }) => {
        const files = [...(ev.dataTransfer?.files ?? ev.target?.files ?? [])];
        for (const f of files) {
          const body = new FormData(); body.append('file', f);
          const res = await fetch('/api/admin/news-media', { method: 'POST', body });
          const json = await res.json().catch(() => ({}));
          if (res.ok) editor.Assets.add(abs(json.url)); else alert(json.error ?? 'The image could not be uploaded.');
        }
      },
    } as never,
  });

  // Blocks of our own: the portal's automatic parts, a table, and video.
  for (const [id, label, ph] of PORTAL_BLOCKS) {
    editor.Blocks.add(id, { label, category: 'Portal (filled in for each reader)', media: icon('⚡'), content: section(`<mj-text>${ph}</mj-text>`) });
  }
  editor.Blocks.add('table', {
    label: 'Table', category: 'Basic', media: icon('▦'),
    content: section('<mj-text><table style="width:100%;border-collapse:collapse;font-size:14px"><tr><th style="text-align:left;border-bottom:2px solid #dfe7f5;padding:6px">Heading</th><th style="text-align:left;border-bottom:2px solid #dfe7f5;padding:6px">Heading</th></tr><tr><td style="border-bottom:1px solid #eef2f8;padding:6px">Cell</td><td style="border-bottom:1px solid #eef2f8;padding:6px">Cell</td></tr><tr><td style="border-bottom:1px solid #eef2f8;padding:6px">Cell</td><td style="border-bottom:1px solid #eef2f8;padding:6px">Cell</td></tr></table></mj-text>'),
  });
  editor.Blocks.add('video', {
    label: 'Video (YouTube/Vimeo)', category: 'Basic', media: icon('▶'),
    content: section('<mj-image src="" alt="Watch the video" href="" padding="8px 0" border-radius="12px"></mj-image>', '8px 28px'),
  });
  // A video block asks for the link, then becomes the video's picture with a play button, linking to it.
  editor.on('block:drag:stop', async (comp: Component | undefined, block: { getId?: () => string } | undefined) => {
    if (!comp || block?.getId?.() !== 'video') return;
    const image = comp.find('mj-image')[0];
    const link = prompt('Paste the YouTube or Vimeo link');
    if (!link) { comp.remove(); return; }
    const res = await fetch('/api/admin/video-thumbnail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: link }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { alert(json.error ?? 'That video couldn’t be added.'); comp.remove(); return; }
    image?.addAttributes({ src: abs(json.url), href: json.watch, alt: 'Watch the video' });
  });

  // The image library: recent uploads (newsletters and news).
  fetch('/api/admin/news-media').then((r) => r.json()).then((j) => editor.Assets.add((j.images ?? []).map(abs))).catch(() => {});

  // Open the saved project, or start from the MJML.
  let saved: unknown = null;
  try { saved = JSON.parse(jsonInput.value || 'null'); } catch { saved = null; }
  if (saved && typeof saved === 'object' && Object.keys(saved as object).length) editor.loadProjectData(saved as never);
  else editor.setComponents(mjmlInput.value);

  const sync = () => {
    mjmlInput.value = editor.getHtml();
    jsonInput.value = JSON.stringify(editor.getProjectData());
  };
  let t: ReturnType<typeof setTimeout> | undefined;
  editor.on('update', () => { clearTimeout(t); t = setTimeout(() => { sync(); onChange(); }, 600); });
  editor.on('load', () => { sync(); editor.Panels.getButton('views', 'open-blocks')?.set('active', true); });

  /** Build with AI's draft goes into the part of the design marked css-class="nl-content" (or the end of the body). */
  const fillContent = (inner: string) => {
    const wrapper = editor.getWrapper();
    const target = wrapper?.findType('mj-wrapper').find((c) => String(c.getAttributes()['css-class'] ?? '').includes('nl-content'));
    if (target) target.components(inner);
    else (wrapper?.findType('mj-body')[0] ?? wrapper)?.append(`<mj-wrapper css-class="nl-content" padding="0">${inner}</mj-wrapper>`);
    sync(); onChange();
  };
  initDesignAi(form, editor, sync, onChange);
  return { editor, sync, fillContent };
}
