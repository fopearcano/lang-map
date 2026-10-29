import { svgEl } from './dom.js';
import { fraction } from './timescale.js';

const TICKS = [-4000, -2000, 1, 500, 1000, 1500, 1700, 1800, 1850, 1900, 1950, 2000];
const TRACKS = [
  { id: 'language', label: 'In languages', y: 30 },
  { id: 'idea', label: 'In linguistics', y: 82 },
];
const LEFT = 112;
const RIGHT = 16;
const AXIS_Y = 110;
const ROW = 15;

function formatYear(y) {
  if (y < 0) return `${-y} BCE`;
  if (y === 1) return '1 CE';
  return String(y);
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export class Timeline {
  constructor(svg, nodes, { onSelect, onHover }) {
    this.svg = svg;
    this.onSelect = onSelect;
    this.onHover = onHover || (() => {});
    this.events = nodes
      .filter((n) => n.year !== undefined)
      .map((n) => ({ node: n }))
      .sort((a, b) => a.node.year - b.node.year);
    this.selected = null;
    this.hidden = new Set();
    this.widths = new Map();
    new ResizeObserver(() => this.render()).observe(svg);
  }

  setSelected(id) {
    this.selected = id;
    this.render();
  }

  setHidden(hidden) {
    this.hidden = new Set(hidden);
    this.render();
  }

  labelWidth(label, bold) {
    const key = `${bold ? 'b' : 'n'}:${label}`;
    if (!this.widths.has(key)) {
      const g = svgEl('g', { class: `tl-event${bold ? ' is-selected' : ''}` }, this.svg);
      const t = svgEl('text', {}, g);
      t.textContent = label;
      let w = label.length * 6.3;
      try { w = t.getComputedTextLength() || w; } catch { /* not rendered */ }
      g.remove();
      if (w) this.widths.set(key, w);
      return w;
    }
    return this.widths.get(key);
  }

  render() {
    const width = this.svg.clientWidth;
    if (!width) return;
    const svg = this.svg;
    svg.replaceChildren();
    const x = (year) => LEFT + fraction(year) * (width - LEFT - RIGHT);

    // Axis and ticks; drop tick labels that would collide on narrow screens.
    svgEl('line', { class: 'tl-axis', x1: LEFT, x2: width - RIGHT, y1: AXIS_Y, y2: AXIS_Y }, svg);
    let lastRight = -Infinity;
    for (const t of TICKS) {
      const tx = x(t);
      const label = formatYear(t);
      const w = label.length * 6.4;
      if (tx - w / 2 < lastRight + 6) continue;
      lastRight = tx + w / 2;
      svgEl('line', { class: 'tl-guide', x1: tx, x2: tx, y1: 6, y2: AXIS_Y }, svg);
      svgEl('line', { class: 'tl-tick', x1: tx, x2: tx, y1: AXIS_Y, y2: AXIS_Y + 4 }, svg);
      svgEl('text', { class: 'tl-tick-label', x: tx, y: AXIS_Y + 16 }, svg).textContent = label;
    }

    for (const track of TRACKS) {
      svgEl('text', { class: 'tl-track-label', x: 0, y: track.y + 4 }, svg).textContent = track.label;

      const events = this.events.filter((e) => e.node.track === track.id);
      const y = track.y;
      // Nudge near-simultaneous events apart so every dot stays clickable.
      let prevX = -Infinity;
      for (const e of events) {
        e.x = Math.max(x(e.node.year), prevX + 10);
        prevX = e.x;
      }

      // Each label tries three slots: beside its dot, just above, just below.
      // The selected event is placed first, then left to right; a label that
      // fits nowhere is left to the tooltip.
      const occupied = events.map((e) => ({ x: e.x - 6, w: 12, y: y - 6, h: 12 }));
      const order = [...events].sort(
        (a, b) => (b.node.id === this.selected) - (a.node.id === this.selected) || a.x - b.x,
      );
      for (const e of order) {
        e.label = null;
        if (this.hidden.has(e.node.category)) continue;
        const w = this.labelWidth(e.node.label, e.node.id === this.selected) + 4;
        const slots = [
          { tx: e.x + 9, ty: y + 4, box: { x: e.x + 7, y: y - 7, w, h: 14 } },
          { tx: e.x - 3, ty: y - ROW + 3, box: { x: e.x - 5, y: y - ROW - 8, w, h: 14 } },
          { tx: e.x - 3, ty: y + ROW + 6, box: { x: e.x - 5, y: y + ROW - 5, w, h: 14 } },
        ];
        const slot = slots.find(
          (s) => s.box.x >= LEFT - 8 && s.box.x + s.box.w <= width && !occupied.some((o) => overlaps(o, s.box)),
        );
        if (slot) {
          occupied.push(slot.box);
          e.label = slot;
        }
      }

      for (const e of events) {
        const n = e.node;
        const g = svgEl('g', {
          class: `tl-event cat-${n.category}${n.id === this.selected ? ' is-selected' : ''}${this.hidden.has(n.category) ? ' is-filtered' : ''}`,
          'data-id': n.id,
        }, svg);
        svgEl('circle', { class: 'tl-hit', cx: e.x, cy: y, r: 10 }, g);
        svgEl('circle', { class: 'tl-dot', cx: e.x, cy: y, r: 5 }, g);
        if (e.label) svgEl('text', { x: e.label.tx, y: e.label.ty }, g).textContent = n.label;
        g.addEventListener('click', () => this.onSelect(n.id));
        g.addEventListener('pointerenter', (ev) => this.onHover(n.id, ev));
        g.addEventListener('pointerleave', () => this.onHover(null));
      }
    }
  }
}
