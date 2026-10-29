import { el } from './dom.js';

// One shared hover card. Content is built from text nodes only.
export class Tooltip {
  constructor(node) {
    this.node = node;
    this.key = null;
  }

  show(event, key, build) {
    if (!event || event.pointerType === 'touch') return this.hide();
    if (this.key !== key) {
      this.key = key;
      const { title, swatch, meta, text, className } = build();
      const summary = text && text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
      this.node.replaceChildren(
        el('div', { class: `tt-head ${className || ''}` }, swatch || null, title),
        meta ? el('div', { class: 'tt-cat' }, meta) : null,
        summary ? el('p', {}, summary) : null,
      );
    }
    this.node.hidden = false;
    const pad = 14;
    const { offsetWidth: w, offsetHeight: h } = this.node;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + w > window.innerWidth - 8) x = event.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = event.clientY - h - pad;
    this.node.style.left = `${Math.max(8, x)}px`;
    this.node.style.top = `${Math.max(8, y)}px`;
  }

  hide() {
    this.node.hidden = true;
  }
}
