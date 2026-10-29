import { Simulation } from './layout.js';
import { svgEl, clamp, prefersReducedMotion } from './dom.js';

const MIN_K = 0.2;
const MAX_K = 3.5;
const DRAG_THRESHOLD = 4;
const CURVE = { includes: 0, instance: 0.1, drives: 0.12, challenges: 0.12, related: 0.14, proposed: 0.1 };
const FONT = { core: 16, hub: 13.5, concept: 12, person: 12 };

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function boxesOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Renders the concept graph into an <svg>, in screen coordinates: node
 * positions follow the camera, while label text stays a constant size and is
 * placed greedily so labels never collide.
 */
export class MapView {
  constructor(svg, data, { onSelect, onHover, onBackground } = {}) {
    this.svg = svg;
    this.onSelect = onSelect || (() => {});
    this.onHover = onHover || (() => {});
    this.onBackground = onBackground || (() => {});

    this.nodes = data.nodes.map((n) => ({ ...n }));
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.sim = new Simulation(this.nodes, data.links).run(450);
    this.links = this.sim.links;

    this.neighbors = new Map(this.nodes.map((n) => [n.id, new Set()]));
    this.degree = new Map(this.nodes.map((n) => [n.id, 0]));
    for (const l of this.links) {
      this.neighbors.get(l.s.id).add(l.t.id);
      this.neighbors.get(l.t.id).add(l.s.id);
      this.degree.set(l.s.id, this.degree.get(l.s.id) + 1);
      this.degree.set(l.t.id, this.degree.get(l.t.id) + 1);
    }

    this.groups = this.buildGroups();
    this.camera = { x: 0, y: 0, k: 1 };
    this.insets = { left: 0, right: 0, bottom: 0 };
    this.hidden = new Set();
    this.selected = null;
    this.hovered = null;
    this.pulsing = null;
    this.width = svg.clientWidth || 800;
    this.height = svg.clientHeight || 600;
    this.dirty = true;
    this.frame = 0;
    this.cameraAnim = null;
    this.pointers = new Map();
    this.gesture = null;

    this.build();
    this.attachEvents();
    this.measureLabels();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        this.measureLabels();
        this.invalidate();
      });
    }

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(svg);
  }

  // Territories: each hub plus everything it "includes" (transitively within
  // its category) gets a soft shaded region.
  buildGroups() {
    const groups = [];
    for (const hub of this.nodes.filter((n) => n.kind === 'hub')) {
      const members = new Set([hub.id]);
      const queue = [hub.id];
      while (queue.length) {
        const id = queue.shift();
        for (const l of this.links) {
          if (l.type === 'includes' && l.s.id === id && !members.has(l.t.id) && l.t.category === hub.category) {
            members.add(l.t.id);
            queue.push(l.t.id);
          }
        }
      }
      groups.push({ hub, members: [...members].map((id) => this.byId.get(id)) });
    }
    return groups;
  }

  build() {
    const layers = {
      territories: this.svg.querySelector('.layer-territories'),
      links: this.svg.querySelector('.layer-links'),
      nodes: this.svg.querySelector('.layer-nodes'),
      labels: this.svg.querySelector('.layer-labels'),
    };

    for (const g of this.groups) {
      g.el = svgEl('circle', { class: `territory cat-${g.hub.category}` }, layers.territories);
    }

    for (const l of this.links) {
      l.el = svgEl('path', { class: `link t-${l.type}` }, layers.links);
    }

    for (const n of this.nodes) {
      const g = svgEl('g', { class: `node k-${n.kind} cat-${n.category}`, 'data-id': n.id }, layers.nodes);
      n.hitEl = svgEl('circle', { class: 'hit' }, g);
      if (n.kind === 'person') {
        n.shapeEl = svgEl('rect', { class: 'shape' }, g);
        n.ringEl = svgEl('rect', { class: 'ring' }, g);
      } else {
        n.shapeEl = svgEl('circle', { class: 'shape' }, g);
        n.ringEl = svgEl('circle', { class: 'ring' }, g);
      }
      n.el = g;
      n.labelEl = svgEl('text', { class: `label k-${n.kind}`, 'data-id': n.id }, layers.labels);
      n.labelEl.textContent = n.label;
    }
  }

  measureLabels() {
    for (const n of this.nodes) {
      try {
        n.labelW = n.labelEl.getComputedTextLength() || n.label.length * 7;
      } catch {
        n.labelW = n.label.length * 7;
      }
    }
  }

  // ---------- Public API ----------

  setInsets(insets) {
    this.insets = { left: 0, right: 0, bottom: 0, ...insets };
  }

  setHidden(hiddenCategories) {
    this.hidden = new Set(hiddenCategories);
    for (const n of this.nodes) {
      const hide = this.hidden.has(n.category);
      n.hiddenByFilter = hide;
      n.el.style.display = hide ? 'none' : '';
      n.labelEl.style.display = hide ? 'none' : '';
    }
    for (const l of this.links) {
      l.el.style.display = l.s.hiddenByFilter || l.t.hiddenByFilter ? 'none' : '';
    }
    for (const g of this.groups) {
      g.el.style.display = this.hidden.has(g.hub.category) ? 'none' : '';
    }
    this.updateFocus();
    this.invalidate();
  }

  isVisible(id) {
    const n = this.byId.get(id);
    return n && !n.hiddenByFilter;
  }

  select(id) {
    if (this.selected) this.byId.get(this.selected)?.el.classList.remove('is-selected');
    this.selected = id;
    if (id) this.byId.get(id)?.el.classList.add('is-selected');
    this.updateFocus();
    this.invalidate();
  }

  setPulse(id) {
    if (this.pulsing) this.byId.get(this.pulsing)?.el.classList.remove('is-tour-pulse');
    this.pulsing = id;
    if (id) this.byId.get(id)?.el.classList.add('is-tour-pulse');
  }

  setHover(id) {
    if (this.hovered === id) return;
    if (this.hovered) this.byId.get(this.hovered)?.el.classList.remove('is-hover');
    this.hovered = id;
    if (id) this.byId.get(id)?.el.classList.add('is-hover');
    this.updateFocus();
    this.invalidate();
  }

  // Visible screen region not covered by overlays (detail panel etc).
  viewport() {
    const { left, right, bottom } = this.insets;
    const w = Math.max(120, this.width - left - right);
    const h = Math.max(120, this.height - bottom);
    const x0 = this.width - left - right >= 120 ? left : 0;
    return { w, h, x0, cx: x0 + w / 2, cy: h / 2 };
  }

  fit({ animate = true } = {}) {
    // Read the size directly: layout may have changed since the last
    // ResizeObserver callback (e.g. a toolbar toggled in the same frame).
    if (this.svg.clientWidth && this.svg.clientHeight) {
      this.width = this.svg.clientWidth;
      this.height = this.svg.clientHeight;
    }
    const visible = this.nodes.filter((n) => !n.hiddenByFilter);
    if (!visible.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of visible) {
      minX = Math.min(minX, n.x - n.cr);
      maxX = Math.max(maxX, n.x + n.cr);
      minY = Math.min(minY, n.y - n.r);
      maxY = Math.max(maxY, n.y + n.r + 18);
    }
    const vp = this.viewport();
    const pad = vp.w < 600 ? 16 : 36;
    const k = clamp(Math.min((vp.w - pad * 2) / (maxX - minX), (vp.h - pad * 2) / (maxY - minY)), MIN_K, 1.4);
    const target = {
      k,
      x: vp.cx - ((minX + maxX) / 2) * k,
      y: vp.cy - ((minY + maxY) / 2) * k,
    };
    this.moveCamera(target, animate);
  }

  centerOn(id, { k, animate = true } = {}) {
    const n = this.byId.get(id);
    if (!n) return;
    const vp = this.viewport();
    const nextK = clamp(k ?? this.camera.k, MIN_K, MAX_K);
    this.moveCamera({ k: nextK, x: vp.cx - n.x * nextK, y: vp.cy - n.y * nextK }, animate);
  }

  // Pans just enough to bring a node out from under an overlay or the edge.
  ensureVisible(id) {
    const n = this.byId.get(id);
    if (!n) return;
    const vp = this.viewport();
    const sx = n.x * this.camera.k + this.camera.x;
    const sy = n.y * this.camera.k + this.camera.y;
    const m = 70;
    if (sx < vp.x0 + m || sx > vp.x0 + vp.w - m || sy < m || sy > vp.h - m) this.centerOn(id);
  }

  zoomBy(factor, around) {
    const vp = this.viewport();
    const p = around || { x: vp.cx, y: vp.cy };
    const k = clamp(this.camera.k * factor, MIN_K, MAX_K);
    const ratio = k / this.camera.k;
    this.moveCamera(
      { k, x: p.x - (p.x - this.camera.x) * ratio, y: p.y - (p.y - this.camera.y) * ratio },
      true,
      260,
    );
  }

  moveCamera(target, animate = true, duration = 700) {
    if (!animate || prefersReducedMotion()) {
      this.cameraAnim = null;
      this.camera = { ...target };
      this.invalidate();
      return;
    }
    this.cameraAnim = { from: { ...this.camera }, to: target, start: performance.now(), duration };
    this.invalidate();
  }

  // ---------- Rendering loop ----------

  invalidate() {
    this.dirty = true;
    if (!this.frame) this.frame = requestAnimationFrame((t) => this.loop(t));
  }

  loop(now) {
    this.frame = 0;
    let keepGoing = false;

    if (!this.sim.settled) {
      this.sim.tick();
      this.dirty = true;
      keepGoing = true;
    }

    if (this.cameraAnim) {
      const { from, to, start, duration } = this.cameraAnim;
      const t = clamp((now - start) / duration, 0, 1);
      const e = easeInOut(t);
      // Interpolate zoom in log space and keep the motion visually linear.
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      const vp = this.viewport();
      const fromCenter = { x: (vp.cx - from.x) / from.k, y: (vp.cy - from.y) / from.k };
      const toCenter = { x: (vp.cx - to.x) / to.k, y: (vp.cy - to.y) / to.k };
      const cxw = fromCenter.x + (toCenter.x - fromCenter.x) * e;
      const cyw = fromCenter.y + (toCenter.y - fromCenter.y) * e;
      this.camera = { k, x: vp.cx - cxw * k, y: vp.cy - cyw * k };
      if (t >= 1) {
        this.camera = { ...to };
        this.cameraAnim = null;
      } else {
        keepGoing = true;
      }
      this.dirty = true;
    }

    if (this.dirty) {
      this.dirty = false;
      this.render();
    }
    if (keepGoing) this.frame = requestAnimationFrame((t) => this.loop(t));
  }

  render() {
    const { k, x: tx, y: ty } = this.camera;
    const scale = clamp(k, 0.6, 1.5);

    for (const n of this.nodes) {
      n.sx = n.x * k + tx;
      n.sy = n.y * k + ty;
      n.sr = n.r * scale;
      if (n.hiddenByFilter) continue;
      n.el.setAttribute('transform', `translate(${n.sx.toFixed(1)},${n.sy.toFixed(1)})`);
      const r = n.sr;
      n.hitEl.setAttribute('r', Math.max(r + 6, 13));
      if (n.kind === 'person') {
        const s = r * 0.92;
        setRect(n.shapeEl, -s, -s, s * 2, s * 2, 2.5);
        setRect(n.ringEl, -s - 4, -s - 4, s * 2 + 8, s * 2 + 8, 4);
      } else {
        n.shapeEl.setAttribute('r', r.toFixed(2));
        n.ringEl.setAttribute('r', (r + 4.5).toFixed(2));
      }
    }

    for (const l of this.links) {
      if (l.s.hiddenByFilter || l.t.hiddenByFilter) continue;
      l.el.setAttribute('d', linkPath(l));
    }

    for (const g of this.groups) {
      if (this.hidden.has(g.hub.category)) continue;
      let cx = 0, cy = 0;
      for (const m of g.members) { cx += m.sx; cy += m.sy; }
      cx /= g.members.length;
      cy /= g.members.length;
      let r = 0;
      for (const m of g.members) r = Math.max(r, Math.hypot(m.sx - cx, m.sy - cy) + m.sr);
      g.el.setAttribute('cx', cx.toFixed(1));
      g.el.setAttribute('cy', cy.toFixed(1));
      g.el.setAttribute('r', (r + 26 * scale).toFixed(1));
    }

    this.placeLabels();
  }

  focusSet() {
    const focus = this.hovered || this.selected;
    if (!focus || !this.isVisible(focus)) return null;
    return { focus, neighbors: this.neighbors.get(focus) };
  }

  updateFocus() {
    const fs = this.focusSet();
    this.svg.classList.toggle('has-focus', !!fs);
    for (const n of this.nodes) {
      const isFocus = !!fs && n.id === fs.focus;
      const isNeighbor = !!fs && fs.neighbors.has(n.id);
      n.el.classList.toggle('is-focus', isFocus);
      n.el.classList.toggle('is-neighbor', isNeighbor);
      n.labelEl.classList.toggle('is-focus', isFocus);
      n.labelEl.classList.toggle('is-neighbor', isNeighbor);
    }
    for (const l of this.links) {
      l.el.classList.toggle('is-active', !!fs && (l.s.id === fs.focus || l.t.id === fs.focus));
    }
    // Labels can change weight when focused, so re-measure the affected ones.
    if (fs) {
      for (const id of [fs.focus, ...fs.neighbors]) {
        const n = this.byId.get(id);
        try { n.labelW = n.labelEl.getComputedTextLength() || n.labelW; } catch { /* not rendered */ }
      }
    }
  }

  placeLabels() {
    const fs = this.focusSet();
    const placed = [];
    const vp = { w: this.width, h: this.height };

    for (const n of this.nodes) {
      if (n.hiddenByFilter) continue;
      placed.push({ x: n.sx - n.sr, y: n.sy - n.sr, w: n.sr * 2, h: n.sr * 2, owner: n.id });
    }

    const priority = (n) => {
      if (fs && n.id === fs.focus) return 1e6;
      if (n.id === this.selected) return 9e5;
      if (fs && fs.neighbors.has(n.id)) return 5e5 + this.degree.get(n.id);
      if (n.kind === 'core') return 4e5;
      if (n.kind === 'hub') return 3e5;
      return this.degree.get(n.id);
    };

    const candidates = this.nodes
      .filter((n) => !n.hiddenByFilter)
      .sort((a, b) => priority(b) - priority(a));

    for (const n of candidates) {
      const f = FONT[n.kind];
      const h = f * 1.25;
      const w = n.labelW;
      const ringed = n.id === this.selected || n.id === this.pulsing;
      const gap = n.sr + (ringed ? 7 : 2);
      const options = [
        { x: n.sx - w / 2, y: n.sy + gap, anchor: 'middle', tx: n.sx },
        { x: n.sx - w / 2, y: n.sy - gap - h, anchor: 'middle', tx: n.sx },
        { x: n.sx + gap + 3, y: n.sy - h / 2, anchor: 'start', tx: n.sx + gap + 3 },
        { x: n.sx - gap - 3 - w, y: n.sy - h / 2, anchor: 'end', tx: n.sx - gap - 3 },
      ];
      const isFocus = fs && n.id === fs.focus;
      // Hub and core labels name whole clusters, so they may sit over small
      // nodes (the text halo keeps them legible) but not over other labels.
      const overNodes = n.kind === 'hub' || n.kind === 'core';
      let chosen = null;
      for (const o of options) {
        const box = { x: o.x - 2, y: o.y, w: w + 4, h };
        if (box.x < 2 || box.x + box.w > vp.w - 2 || box.y < 2 || box.y + box.h > vp.h - 2) continue;
        // The focused label is always shown; everything else must avoid
        // previously placed labels and (except hubs) other nodes.
        const blocked = placed.some((p) => {
          if (p.owner === n.id) return false;
          if (p.owner && overNodes) return false;
          return boxesOverlap(box, p);
        });
        if (!isFocus && blocked) continue;
        chosen = { ...o, box };
        break;
      }
      const label = n.labelEl;
      if (!chosen) {
        label.classList.add('is-hidden');
        continue;
      }
      placed.push(chosen.box);
      label.classList.remove('is-hidden');
      label.setAttribute('x', chosen.tx.toFixed(1));
      label.setAttribute('y', (chosen.y + f * 0.95).toFixed(1));
      label.setAttribute('text-anchor', chosen.anchor);
    }
  }

  resize() {
    const w = this.svg.clientWidth;
    const h = this.svg.clientHeight;
    if (!w || !h) return;
    const first = !this.sized;
    // Keep the world point at the centre of the screen fixed.
    if (!first) {
      this.camera.x += (w - this.width) / 2;
      this.camera.y += (h - this.height) / 2;
    }
    this.width = w;
    this.height = h;
    this.sized = true;
    if (first) this.fit({ animate: false });
    else this.invalidate();
  }

  // ---------- Input ----------

  screenToWorld(px, py) {
    return { x: (px - this.camera.x) / this.camera.k, y: (py - this.camera.y) / this.camera.k };
  }

  localPoint(e) {
    const rect = this.svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  attachEvents() {
    const svg = this.svg;

    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.cameraAnim = null;
      const p = this.localPoint(e);
      this.pointers.set(e.pointerId, p);
      svg.setPointerCapture(e.pointerId);

      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.gesture = {
          type: 'pinch',
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          camera: { ...this.camera },
        };
        return;
      }

      const nodeEl = e.target.closest('.node');
      if (nodeEl) {
        this.gesture = { type: 'node', id: nodeEl.dataset.id, start: p, moved: false };
      } else {
        this.gesture = { type: 'pan', start: p, camera: { ...this.camera }, moved: false };
      }
    });

    svg.addEventListener('pointermove', (e) => {
      const p = this.localPoint(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      const g = this.gesture;
      if (!g) return;

      if (g.type === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const k = clamp(g.camera.k * (dist / g.dist), MIN_K, MAX_K);
        const world = { x: (g.mid.x - g.camera.x) / g.camera.k, y: (g.mid.y - g.camera.y) / g.camera.k };
        this.camera = { k, x: mid.x - world.x * k, y: mid.y - world.y * k };
        this.invalidate();
        return;
      }

      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      if (g.type === 'pan') {
        if (!g.moved) svg.classList.add('is-panning');
        g.moved = true;
        this.camera = { ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy };
        this.invalidate();
      } else if (g.type === 'node') {
        const n = this.byId.get(g.id);
        if (!g.moved) {
          this.onHover(null);
          svg.classList.add('is-panning');
        }
        g.moved = true;
        const w = this.screenToWorld(p.x, p.y);
        n.fx = w.x;
        n.fy = w.y;
        this.sim.reheat(0.25);
        this.invalidate();
      }
    });

    const end = (e) => {
      const g = this.gesture;
      this.pointers.delete(e.pointerId);
      if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      svg.classList.remove('is-panning');
      if (!g) return;
      if (g.type === 'pinch') {
        if (this.pointers.size === 0) this.gesture = null;
        else {
          // One finger left: continue as a pan from here.
          const [rest] = [...this.pointers.values()];
          this.gesture = { type: 'pan', start: rest, camera: { ...this.camera }, moved: true };
        }
        return;
      }
      this.gesture = null;
      if (e.type === 'pointercancel') return;
      if (g.type === 'node') {
        const n = this.byId.get(g.id);
        if (g.moved) {
          n.fx = null;
          n.fy = null;
          this.sim.reheat(0.08);
          this.invalidate();
        } else {
          this.onSelect(g.id, { source: 'map' });
        }
      } else if (g.type === 'pan' && !g.moved) {
        this.onBackground();
      }
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.cameraAnim = null;
        const p = this.localPoint(e);
        const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.002;
        const factor = Math.pow(2, -e.deltaY * unit * (e.ctrlKey ? 5 : 1));
        const k = clamp(this.camera.k * factor, MIN_K, MAX_K);
        const ratio = k / this.camera.k;
        this.camera = { k, x: p.x - (p.x - this.camera.x) * ratio, y: p.y - (p.y - this.camera.y) * ratio };
        this.invalidate();
      },
      { passive: false },
    );

    svg.addEventListener('dblclick', (e) => {
      if (e.target.closest('.node')) return;
      this.zoomBy(1.7, this.localPoint(e));
    });

    svg.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse' || (this.gesture && this.gesture.moved)) return;
      const nodeEl = e.target.closest('.node');
      if (nodeEl) {
        this.setHover(nodeEl.dataset.id);
        this.onHover(nodeEl.dataset.id, e);
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && this.hovered && !(this.gesture && this.gesture.moved)) this.onHover(this.hovered, e);
    });
    svg.addEventListener('pointerout', (e) => {
      const nodeEl = e.target.closest('.node');
      if (!nodeEl) return;
      if (e.relatedTarget && nodeEl.contains(e.relatedTarget)) return;
      this.setHover(null);
      this.onHover(null);
    });
    svg.addEventListener('pointerleave', () => {
      this.setHover(null);
      this.onHover(null);
    });
  }
}

function setRect(el, x, y, w, h, rx) {
  el.setAttribute('x', x.toFixed(2));
  el.setAttribute('y', y.toFixed(2));
  el.setAttribute('width', w.toFixed(2));
  el.setAttribute('height', h.toFixed(2));
  el.setAttribute('rx', rx);
}

// Quadratic curve between two nodes, trimmed so it starts and ends at the node
// edges (arrowheads stay visible).
function linkPath(l) {
  const { s, t } = l;
  const dx = t.sx - s.sx;
  const dy = t.sy - s.sy;
  const len = Math.hypot(dx, dy) || 1;
  const bend = CURVE[l.type] ?? 0.12;
  const cx = (s.sx + t.sx) / 2 - (dy / len) * len * bend;
  const cy = (s.sy + t.sy) / 2 + (dx / len) * len * bend;

  const trim = (px, py, r) => {
    const vx = cx - px;
    const vy = cy - py;
    const vl = Math.hypot(vx, vy) || 1;
    return [px + (vx / vl) * r, py + (vy / vl) * r];
  };
  const [x1, y1] = trim(s.sx, s.sy, s.sr + 1);
  const [x2, y2] = trim(t.sx, t.sy, t.sr + (l.type === 'drives' ? 3 : 1));
  if (bend === 0) return `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`;
  return `M${x1.toFixed(1)},${y1.toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}
