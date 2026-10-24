import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';

// The news editor (Admin → News → a post). The server cleans whatever this
// produces, so this is about a good writing experience, not security.

/** Images can be shown small, medium or full width. */
const SizedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      size: { default: null, parseHTML: (el) => el.getAttribute('data-size'), renderHTML: (a) => (a.size ? { 'data-size': a.size } : {}) },
    };
  },
});

/** A YouTube or Vimeo player. */
const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  addAttributes: () => ({ src: { default: null } }),
  parseHTML: () => [{ tag: 'iframe[src]', getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute('src') }) }],
  renderHTML: ({ HTMLAttributes }) => ['iframe', mergeAttributes(HTMLAttributes, { allowfullscreen: 'true', allow: 'encrypted-media; picture-in-picture', title: 'Video' })],
});

/** The embeddable address for a YouTube or Vimeo link, or null. */
function embedUrl(url: string) {
  const yt = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = /vimeo\.com\/(?:video\/)?(\d+)/.exec(url);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

async function upload(file: File | Blob, name = 'image.webp') {
  const body = new FormData();
  body.append('file', file instanceof File ? file : new File([file], name, { type: file.type }));
  const res = await fetch('/api/admin/news-media', { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'The image could not be uploaded.');
  return json.url as string;
}

export function initNewsEditor() {
  const form = document.querySelector<HTMLFormElement>('#news-form');
  const mount = document.querySelector<HTMLElement>('#editor');
  if (!form || !mount) return;
  const $ = <T extends Element>(sel: string) => form.querySelector<T>(sel) ?? document.querySelector<T>(sel);
  const bodyInput = $<HTMLInputElement>('input[name="body_html"]')!;
  const status = $<HTMLElement>('[data-status]')!;
  const locked = Boolean(form.querySelector('fieldset')?.disabled);
  const say = (text: string) => { status.textContent = text; };
  let dirty = false;

  const insertImages = async (files: File[]) => {
    for (const f of files.filter((x) => x.type.startsWith('image/'))) {
      say('Uploading image…');
      try { editor.chain().focus().setImage({ src: await upload(f), alt: '' }).run(); say('Image added. Add a short description with “Alt”.'); }
      catch (e) { say((e as Error).message); }
    }
  };

  const editor = new Editor({
    element: mount,
    editable: !locked,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      SizedImage, Video, TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: 'Write the article…' }),
    ],
    content: mount.dataset.initial || '',
    editorProps: {
      handleDrop: (_view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        event.preventDefault(); void insertImages(files); return true;
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.length) return false;
        event.preventDefault(); void insertImages(files); return true;
      },
    },
    onUpdate: () => { dirty = true; bodyInput.value = editor.getHTML(); refreshToolbar(); },
    onSelectionUpdate: () => refreshToolbar(),
  });
  bodyInput.value = editor.getHTML();

  // Toolbar
  const imageFile = $<HTMLInputElement>('[data-image-file]')!;
  imageFile.addEventListener('change', () => { void insertImages([...(imageFile.files ?? [])]); imageFile.value = ''; });
  const commands: Record<string, () => void> = {
    undo: () => editor.chain().focus().undo().run(), redo: () => editor.chain().focus().redo().run(),
    h2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), h3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), p: () => editor.chain().focus().setParagraph().run(),
    bold: () => editor.chain().focus().toggleBold().run(), italic: () => editor.chain().focus().toggleItalic().run(),
    underline: () => editor.chain().focus().toggleUnderline().run(), strike: () => editor.chain().focus().toggleStrike().run(),
    link: () => {
      const prev = editor.getAttributes('link').href ?? '';
      const url = prompt('Link address (leave empty to remove the link)', prev);
      if (url === null) return;
      if (!url.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
      else editor.chain().focus().extendMarkRange('link').setLink({ href: /^(https?:|mailto:|\/)/.test(url.trim()) ? url.trim() : `https://${url.trim()}` }).run();
    },
    bullet: () => editor.chain().focus().toggleBulletList().run(), ordered: () => editor.chain().focus().toggleOrderedList().run(),
    quote: () => editor.chain().focus().toggleBlockquote().run(), hr: () => editor.chain().focus().setHorizontalRule().run(),
    image: () => imageFile.click(),
    alt: () => {
      if (!editor.isActive('image')) { say('Click an image first.'); return; }
      const alt = prompt('Describe the image for people who can’t see it', editor.getAttributes('image').alt ?? '');
      if (alt !== null) editor.chain().focus().updateAttributes('image', { alt: alt.trim() }).run();
    },
    'size-small': () => setSize('small'), 'size-medium': () => setSize('medium'), 'size-full': () => setSize(null),
    video: () => {
      const url = prompt('YouTube or Vimeo address');
      if (!url) return;
      const src = embedUrl(url.trim());
      if (!src) { say('That isn’t a YouTube or Vimeo address.'); return; }
      editor.chain().focus().insertContent({ type: 'video', attrs: { src } }).run();
    },
    table: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    row: () => editor.chain().focus().addRowAfter().run(), col: () => editor.chain().focus().addColumnAfter().run(),
    deltable: () => editor.chain().focus().deleteTable().run(),
    clear: () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
  };
  function setSize(size: string | null) {
    if (!editor.isActive('image')) { say('Click an image first.'); return; }
    editor.chain().focus().updateAttributes('image', { size }).run();
  }
  const active: Record<string, () => boolean> = {
    h2: () => editor.isActive('heading', { level: 2 }), h3: () => editor.isActive('heading', { level: 3 }),
    bold: () => editor.isActive('bold'), italic: () => editor.isActive('italic'), underline: () => editor.isActive('underline'), strike: () => editor.isActive('strike'),
    link: () => editor.isActive('link'), bullet: () => editor.isActive('bulletList'), ordered: () => editor.isActive('orderedList'), quote: () => editor.isActive('blockquote'),
  };
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-toolbar] [data-cmd]')];
  function refreshToolbar() { for (const b of buttons) { const f = active[b.dataset.cmd!]; if (f) b.setAttribute('aria-pressed', String(f())); } }
  for (const b of buttons) { b.disabled = locked; b.addEventListener('click', () => commands[b.dataset.cmd!]?.()); }
  refreshToolbar();

  // Fields that show only for public posts or schedules
  const visibility = $<HTMLSelectElement>('#visibility')!;
  const when = $<HTMLSelectElement>('#when')!;
  const showFor = () => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-public-only]')) el.hidden = visibility.value !== 'public';
    $<HTMLElement>('[data-schedule]')!.hidden = when.value !== 'schedule';
  };
  visibility.addEventListener('change', showFor); when.addEventListener('change', showFor); showFor();

  // Web address follows the title until it is edited (new posts only)
  const title = $<HTMLInputElement>('#title')!;
  const slug = $<HTMLInputElement>('[data-slug]')!;
  let slugTouched = Boolean(slug.value);
  slug.addEventListener('input', () => { slugTouched = true; });
  title.addEventListener('input', () => { if (!slugTouched) slug.value = title.value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); });

  // Search description length
  const seo = $<HTMLTextAreaElement>('#seo_description')!;
  const seoCount = $<HTMLElement>('[data-seo-count]')!;
  const count = () => { seoCount.textContent = `${seo.value.length} / 155 characters${seo.value.length > 155 ? ' — search engines may cut it off' : ''}`; };
  seo.addEventListener('input', count); count();

  // Claude suggestions
  const suggest = $<HTMLButtonElement>('[data-suggest]')!;
  const suggestStatus = $<HTMLElement>('[data-suggest-status]')!;
  const excerpt = $<HTMLTextAreaElement>('#excerpt')!;
  suggest.disabled = locked;
  suggest.addEventListener('click', async () => {
    if ((excerpt.value.trim() || seo.value.trim()) && !confirm('Replace the current excerpt and search description with suggestions?')) return;
    suggest.disabled = true; suggestStatus.textContent = 'Claude is reading the article…';
    try {
      const company = $<HTMLSelectElement>('#entity_id');
      const names = JSON.parse(form.dataset.companyNames ?? '{}') as Record<string, string>;
      const venture = ($<HTMLInputElement>('#venture')?.value || (company ? names[company.value] : '')) ?? '';
      const res = await fetch('/api/admin/news-suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title.value, html: editor.getHTML(), venture }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No suggestion.');
      excerpt.value = json.excerpt; seo.value = json.description; count(); dirty = true;
      suggestStatus.textContent = 'Suggested by Claude: check and edit before saving.';
    } catch (e) { suggestStatus.textContent = (e as Error).message; }
    finally { suggest.disabled = false; }
  });

  // Cover: choose, crop to 16:9 on a canvas, upload the result
  const coverInput = $<HTMLInputElement>('input[name="cover_url"]')!;
  const coverPreview = $<HTMLImageElement>('[data-cover-preview]')!;
  const coverRemove = $<HTMLButtonElement>('[data-cover-remove]')!;
  const coverFile = $<HTMLInputElement>('[data-cover-file]')!;
  const dialog = document.querySelector<HTMLDialogElement>('[data-crop-dialog]')!;
  const canvas = dialog.querySelector<HTMLCanvasElement>('[data-crop-canvas]')!;
  const zoom = dialog.querySelector<HTMLInputElement>('[data-crop-zoom]')!;
  const ctx = canvas.getContext('2d')!;
  let img: HTMLImageElement | null = null; let ox = 0; let oy = 0;
  const base = () => (img ? Math.max(canvas.width / img.width, canvas.height / img.height) : 1);
  const clamp = () => {
    if (!img) return;
    const s = base() * Number(zoom.value);
    ox = Math.min(0, Math.max(canvas.width - img.width * s, ox)); oy = Math.min(0, Math.max(canvas.height - img.height * s, oy));
  };
  const draw = () => { if (!img) return; clamp(); const s = base() * Number(zoom.value); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, ox, oy, img.width * s, img.height * s); };
  $<HTMLButtonElement>('[data-cover-choose]')!.addEventListener('click', () => coverFile.click());
  coverFile.addEventListener('change', () => {
    const f = coverFile.files?.[0]; coverFile.value = '';
    if (!f) return;
    const i = new window.Image();
    i.onload = () => { img = i; zoom.value = '1'; const s = base(); ox = (canvas.width - i.width * s) / 2; oy = (canvas.height - i.height * s) / 2; draw(); dialog.showModal(); };
    i.src = URL.createObjectURL(f);
  });
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = canvas.width / canvas.getBoundingClientRect().width;
    ox += (e.clientX - drag.x) * k; oy += (e.clientY - drag.y) * k; drag = { x: e.clientX, y: e.clientY }; draw();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  zoom.addEventListener('input', () => {
    const before = base() * Number(zoom.dataset.prev ?? 1), after = base() * Number(zoom.value);
    // Zoom around the centre.
    ox = canvas.width / 2 - ((canvas.width / 2 - ox) * after) / before; oy = canvas.height / 2 - ((canvas.height / 2 - oy) * after) / before;
    zoom.dataset.prev = zoom.value; draw();
  });
  dialog.querySelector('[data-crop-cancel]')!.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-crop-use]')!.addEventListener('click', () => {
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      dialog.close(); say('Uploading the cover…');
      try { const url = await upload(blob, 'cover.webp'); coverInput.value = url; coverPreview.src = url; coverPreview.classList.remove('hidden'); coverRemove.classList.remove('hidden'); dirty = true; say('Cover ready. Save to keep it.'); }
      catch (e) { say((e as Error).message); }
    }, 'image/webp', 0.86);
  });
  coverRemove.addEventListener('click', () => { coverInput.value = ''; coverPreview.classList.add('hidden'); coverRemove.classList.add('hidden'); dirty = true; });

  // Autosave every 20 seconds while there are changes (kept apart from the live post)
  const postId = form.dataset.postId;
  for (const el of form.querySelectorAll('input, textarea, select')) el.addEventListener('input', () => { dirty = true; });
  let saving = false;
  setInterval(async () => {
    if (!dirty || saving || locked) return;
    const draft = { title: title.value, excerpt: excerpt.value, seo_description: seo.value, body_html: editor.getHTML() };
    if (!postId) { try { localStorage.setItem('lakeba.newsDraft', JSON.stringify({ ...draft, at: Date.now() })); say('Draft kept in this browser.'); } catch {} return; }
    saving = true;
    try {
      const res = await fetch('/api/admin/news-autosave', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: postId, draft }) });
      if (res.ok) say(`Unsaved changes kept at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Save to publish them.`);
    } finally { saving = false; }
  }, 20_000);

  // Bring back unsaved changes
  const restore = (d: { title?: string; excerpt?: string; seo_description?: string; body_html?: string }) => {
    if (d.title) title.value = d.title; if (d.excerpt != null) excerpt.value = d.excerpt; if (d.seo_description != null) { seo.value = d.seo_description; count(); }
    if (d.body_html) { editor.commands.setContent(d.body_html); bodyInput.value = editor.getHTML(); }
    dirty = true;
  };
  document.querySelector('[data-restore-autosave]')?.addEventListener('click', () => {
    restore(JSON.parse(form.dataset.autosave || '{}'));
    document.querySelector('[data-autosave-banner]')?.remove(); say('Unsaved changes brought back. Save to keep them.');
  });
  if (!postId && !locked) {
    try {
      const d = JSON.parse(localStorage.getItem('lakeba.newsDraft') ?? 'null');
      if (d && Date.now() - d.at < 7 * 86_400_000 && (d.title || d.body_html) && confirm('Continue the new post you started earlier?')) restore(d);
    } catch {}
  }

  // Leaving with unsaved changes asks first; saving doesn't.
  form.addEventListener('submit', (e) => {
    bodyInput.value = editor.getHTML();
    const submitter = (e as SubmitEvent).submitter as HTMLElement | null;
    if (submitter?.hasAttribute('data-preview')) return;
    dirty = false;
    if (!postId) { try { localStorage.removeItem('lakeba.newsDraft'); } catch {} }
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

  // Full screen: editor, publishing and a live preview side by side; Esc leaves.
  const fsBtn = form.querySelector<HTMLButtonElement>('[data-fullscreen]');
  const frame = form.querySelector<HTMLIFrameElement>('[data-news-frame]');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refreshPreview = () => {
    if (!frame || !form.classList.contains('is-fullscreen')) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      bodyInput.value = editor.getHTML();
      const res = await fetch('/admin/news/preview?bare=1', { method: 'POST', body: new FormData(form) }).catch(() => null);
      if (res?.ok) frame.srcdoc = await res.text();
    }, 600);
  };
  const setFull = (on: boolean) => {
    form.classList.toggle('is-fullscreen', on);
    document.documentElement.classList.toggle('nl-fullscreen-open', on);
    if (fsBtn) fsBtn.textContent = on ? '⤡ Leave full screen' : '⤢ Full screen';
    if (on && !document.fullscreenElement) form.requestFullscreen?.().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    if (on) refreshPreview();
  };
  fsBtn?.addEventListener('click', () => setFull(!form.classList.contains('is-fullscreen')));
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && form.classList.contains('is-fullscreen')) setFull(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && form.classList.contains('is-fullscreen') && !document.fullscreenElement) setFull(false); });
  form.addEventListener('input', refreshPreview);
  form.addEventListener('change', refreshPreview);
  editor.on('update', refreshPreview);
  for (const b of form.querySelectorAll<HTMLButtonElement>('[data-device]')) {
    b.addEventListener('click', () => {
      if (frame) frame.style.width = b.dataset.device === 'mobile' ? '390px' : '100%';
      for (const x of form.querySelectorAll<HTMLButtonElement>('[data-device]')) { const on = x === b; x.setAttribute('aria-pressed', String(on)); x.classList.toggle('bg-white/10', on); x.classList.toggle('text-white/55', !on); }
    });
  }
}
