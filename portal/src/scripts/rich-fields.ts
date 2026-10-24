import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';

// Small rich-text boxes (bold, italic, links, lists, subheadings) for forms:
// <div data-rich="field_name" data-placeholder="…">initial html</div> followed
// by its hidden <input name="field_name"> (names may repeat, e.g. one per
// section). The server cleans the HTML.
export function initRichFields(root: ParentNode = document) {
  const editors = new Map<string, Editor>();
  for (const box of root.querySelectorAll<HTMLElement>('[data-rich]:not([data-ready])')) {
    box.dataset.ready = '';
    const name = box.dataset.rich!;
    const next = box.nextElementSibling;
    const input = next instanceof HTMLInputElement && next.name === name ? next : root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    const area = document.createElement('div');
    area.className = 'rich-area min-h-28 px-4 py-3';
    const bar = document.createElement('div');
    bar.className = 'flex flex-wrap gap-1 border-b border-white/10 p-1.5';
    const initial = box.innerHTML;
    box.innerHTML = '';
    box.append(bar, area);
    const editor = new Editor({
      element: area,
      extensions: [StarterKit.configure({ heading: { levels: [3] }, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }), Placeholder.configure({ placeholder: box.dataset.placeholder ?? '' })],
      content: initial,
      onUpdate: () => { input.value = editor.getHTML(); input.dispatchEvent(new Event('input', { bubbles: true })); },
    });
    input.value = editor.getHTML();
    const buttons: [string, string, () => void][] = [
      ['B', 'Bold', () => editor.chain().focus().toggleBold().run()],
      ['I', 'Italic', () => editor.chain().focus().toggleItalic().run()],
      ['H', 'Subheading', () => editor.chain().focus().toggleHeading({ level: 3 }).run()],
      ['•', 'Bulleted list', () => editor.chain().focus().toggleBulletList().run()],
      ['🔗', 'Link', () => {
        const url = prompt('Link address (leave empty to remove)', editor.getAttributes('link').href ?? '');
        if (url === null) return;
        if (!url.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
        else editor.chain().focus().extendMarkRange('link').setLink({ href: /^(https?:|mailto:|\/)/.test(url.trim()) ? url.trim() : `https://${url.trim()}` }).run();
      }],
    ];
    for (const [label, title, run] of buttons) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title);
      b.className = 'rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white';
      b.addEventListener('click', run);
      bar.append(b);
    }
    (box as HTMLElement & { editor?: Editor }).editor = editor;
    if (!editors.has(name)) editors.set(name, editor);
  }
  return editors;
}
