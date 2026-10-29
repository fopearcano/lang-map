import { svgEl, clamp, prefersReducedMotion } from './dom.js';
import { projectY, WORLD_WIDTH, Y_TOP, Y_BOTTOM } from './geo.js';

const MAX_K = 48;
const DEFAULT_CENTER = 30; // longitude at the centre of the default view
const FRESH_YEARS = 300; // arcs are emphasised for this long after a split
const DRAG_THRESHOLD = 4;
const FONT = 12;

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Shifts x by whole world widths so it lands as close as possible to `ref`. */
const wrapNear = (x, ref) => x + WORLD_WIDTH * Math.round((ref - x) / WORLD_WIDTH);

/**
 * Smooth path through points (Catmull–Rom converted to cubic Béziers). With
 * only two points, a gentle arc whose bulge grows with distance.
 */
function smoothPath(pts) {
  if (pts.length === 2) {
    const [a, b] = pts;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = 0.14;
    const c = { x: (a.x + b.x) / 2 - (dy / len) * len * bend, y: (a.y + b.y) / 2 + (dx / len) * len * bend };
    return { d: `M${a.x.toFixed(1)},${a.y.toFixed(1)}Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`, tail: c };
  }
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  let tail = pts[pts.length - 2];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    tail = c2;
  }
  return { d, tail };
}

/** A small arrowhead at `tip`, pointing away from `from`. */
function arrowPath(tip, from, size = 6) {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  const px = -uy * size * 0.55;
  const py = ux * size * 0.55;
  return `M${tip.x.toFixed(1)},${tip.y.toFixed(1)}L${(bx + px).toFixed(1)},${(by + py).toFixed(1)}L${(bx - px).toFixed(1)},${(by - py).toFixed(1)}Z`;
}

/** Point a little before the end of the path, so arrows stop short of markers. */
function pullBack(tip, from, by) {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: tip.x - (dx / len) * by, y: tip.y - (dy / len) * by };
}

export class WorldView {
  constructor(svg, { languages, landPath, onSelect, onHover, onBackground }) {
    this.svg = svg;
    this.onSelect = onSelect || (() => {});
    this.onHover = onHover || (() => {});
    this.onBackground = onBackground || (() => {});
    this.layers = {
      viewport: svg.querySelector('.w-viewport'),
      graticule: svg.querySelector('.w-graticule'),
      land: svg.querySelector('.w-land'),
      arcs: svg.querySelector('.w-arcs'),
      markers: svg.querySelector('.w-markers'),
      labels: svg.querySelector('.w-labels'),
    };

    this.langs = languages.map((l) => ({
      ...l,
      x: l.at[0],
      y: projectY(l.at[1]),
      via: (l.via || []).map(([lon, lat]) => ({ x: lon, y: projectY(lat) })),
      places: (l.places || []).map((p) => ({ ...p, x: p.at[0], y: projectY(p.at[1]) })),
    }));
    this.byId = new Map(this.langs.map((l) => [l.id, l]));
    this.children = new Map(this.langs.map((l) => [l.id, []]));
    for (const l of this.langs) if (l.parent) this.children.get(l.parent).push(l.id);

    this.year = 2025;
    this.options = { showExtinct: true, showLineage: true, word: false };
    this.hidden = new Set();
    this.selected = null;
    this.hovered = null;
    this.lineage = null;
    this.camera = { x: 0, y: 0, k: 1 };
    this.insets = { left: 0, right: 0, bottom: 0, top: 0 };
    this.width = 0;
    this.height = 0;
    this.frame = 0;
    this.cameraAnim = null;
    this.pointers = new Map();
    this.gesture = null;
    this.widthCache = new Map();

    this.buildBase(landPath);
    this.buildLanguages();
    this.attachEvents();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(svg);
  }

  // ---------- Build ----------

  buildBase(landPath) {
    const { land, graticule } = this.layers;
    svgEl('path', { id: 'w-land-path', class: 'w-land-path', d: landPath }, land);
    for (const dx of [-WORLD_WIDTH, WORLD_WIDTH]) {
      svgEl('use', { href: '#w-land-path', x: dx, y: 0 }, land);
    }
    let d = '';
    for (let lon = -540; lon <= 540; lon += 30) d += `M${lon} ${Y_TOP}V${Y_BOTTOM}`;
    for (const lat of [-30, 0, 30, 60]) d += `M-540 ${projectY(lat).toFixed(2)}H540`;
    svgEl('path', { class: 'w-graticule-path', d }, graticule);
    svgEl('path', { class: 'w-equator', d: `M-540 0H540` }, graticule);
  }

  buildLanguages() {
    const { arcs, markers, labels } = this.layers;
    for (const l of this.langs) {
      const fam = `fam-${l.family}`;
      if (l.parent) {
        l.arcEl = svgEl('path', { class: `w-arc ${fam} r-${l.relation || 'descent'}` }, arcs);
        l.arrowEl = svgEl('path', { class: `w-arrow ${fam}` }, arcs);
      }
      for (const p of l.places) {
        p.arcEl = svgEl('path', { class: `w-spread ${fam}` }, arcs);
        p.arrowEl = svgEl('path', { class: `w-arrow ${fam}` }, arcs);
        p.el = svgEl('g', { class: `w-place ${fam}`, 'data-id': l.id, 'data-place': l.places.indexOf(p) }, markers);
        svgEl('circle', { class: 'hit', r: 11 }, p.el);
        p.dotEl = svgEl('circle', { class: 'dot', r: 3.6 }, p.el);
      }
      l.el = svgEl('g', { class: `w-lang ${fam} k-${l.kind || 'attested'}`, 'data-id': l.id }, markers);
      svgEl('circle', { class: 'hit', r: 13 }, l.el);
      svgEl('circle', { class: 'ring', r: 10 }, l.el);
      l.dotEl = svgEl('circle', { class: 'dot', r: l.kind === 'proto' ? 6.5 : 5.2 }, l.el);
      l.labelEl = svgEl('text', { class: `w-label ${fam}`, 'data-id': l.id }, labels);
      l.nameEl = svgEl('tspan', { class: 'w-name' }, l.labelEl);
      l.nameEl.textContent = l.name;
      l.wordEl = svgEl('tspan', { class: 'w-word' }, l.labelEl);
    }
  }

  // ---------- Public API ----------

  setYear(year) {
    this.year = year;
    this.invalidate();
  }

  setOptions(opts) {
    Object.assign(this.options, opts);
    this.invalidate();
  }

  setHidden(families) {
    this.hidden = new Set(families);
    this.invalidate();
  }

  setInsets(insets) {
    this.insets = { left: 0, right: 0, bottom: 0, top: 0, ...insets };
  }

  select(id) {
    this.selected = id;
    this.lineage = id ? this.lineageOf(id) : null;
    this.svg.classList.toggle('has-focus', !!id);
    this.invalidate();
  }

  setHover(id) {
    if (this.hovered === id) return;
    this.hovered = id;
    this.invalidate();
  }

  /** Ancestors and descendants of a language, plus itself. */
  lineageOf(id) {
    const set = new Set([id]);
    for (let p = this.byId.get(id)?.parent; p; p = this.byId.get(p)?.parent) set.add(p);
    const stack = [id];
    while (stack.length) {
      for (const c of this.children.get(stack.pop()) || []) {
        set.add(c);
        stack.push(c);
      }
    }
    return set;
  }

  ancestors(id) {
    const chain = [];
    for (let p = this.byId.get(id)?.parent; p; p = this.byId.get(p)?.parent) chain.unshift(this.byId.get(p));
    return chain;
  }

  viewport() {
    const { left, right, bottom, top } = this.insets;
    const w = Math.max(160, this.width - left - right);
    const h = Math.max(160, this.height - bottom - top);
    const x0 = this.width - left - right >= 160 ? left : 0;
    const y0 = this.height - bottom - top >= 160 ? top : 0;
    return { w, h, x0, y0, cx: x0 + w / 2, cy: y0 + h / 2 };
  }

  minK() {
    const vp = this.viewport();
    return Math.min(vp.w / WORLD_WIDTH, vp.h / (Y_BOTTOM - Y_TOP)) * 0.95;
  }

  fit({ animate = true } = {}) {
    if (this.svg.clientWidth && this.svg.clientHeight) {
      this.width = this.svg.clientWidth;
      this.height = this.svg.clientHeight;
    }
    const vp = this.viewport();
    const fitAll = Math.min(vp.w / WORLD_WIDTH, vp.h / (Y_BOTTOM - Y_TOP));
    // On tall, narrow screens the whole world would be a thin strip, so show
    // about 150° of longitude (Europe, Africa, western Asia) instead.
    const k = vp.h > vp.w ? Math.max(fitAll, Math.min(vp.h / (Y_BOTTOM - Y_TOP), vp.w / 150)) : fitAll;
    const cy = vp.h > vp.w ? projectY(28) : (Y_TOP + Y_BOTTOM) / 2;
    this.moveCamera({ k, x: vp.cx - DEFAULT_CENTER * k, y: vp.cy - cy * k }, animate);
  }

  /** Pans to a language only if it is hidden under an overlay or off screen. */
  ensureVisible(id) {
    const l = this.byId.get(id);
    if (!l) return;
    const anchor = this.anchorAt(l, this.year) || l;
    const vp = this.viewport();
    const cxw = (vp.cx - this.camera.x) / this.camera.k;
    const sx = wrapNear(anchor.x, cxw) * this.camera.k + this.camera.x;
    const sy = anchor.y * this.camera.k + this.camera.y;
    const m = 40;
    if (sx < vp.x0 + m || sx > vp.x0 + vp.w - m || sy < vp.y0 + m || sy > vp.y0 + vp.h - m) {
      this.centerOnWorld(anchor.x, anchor.y);
    }
  }

  /** Centre the view on a point given in projected world units. */
  centerOnWorld(x, y, { k, animate = true } = {}) {
    const vp = this.viewport();
    const nextK = clamp(k ?? this.camera.k, this.minK(), MAX_K);
    const cxw = (vp.cx - this.camera.x) / this.camera.k;
    const wx = wrapNear(x, cxw);
    this.moveCamera({ k: nextK, x: vp.cx - wx * nextK, y: vp.cy - y * nextK }, animate);
  }

  /** Brings a language into view, zooming in if the map is zoomed out. */
  focusLanguage(id, { zoom = 3.2 } = {}) {
    const l = this.byId.get(id);
    if (!l) return;
    const anchor = this.anchorAt(l, this.year) || l;
    this.centerOnWorld(anchor.x, anchor.y, { k: Math.max(this.camera.k, zoom) });
  }

  focusPlace(id, index) {
    const p = this.byId.get(id)?.places[index];
    if (p) this.centerOnWorld(p.x, p.y, { k: Math.max(this.camera.k, 3.2) });
  }

  zoomBy(factor, around) {
    const vp = this.viewport();
    const p = around || { x: vp.cx, y: vp.cy };
    const k = clamp(this.camera.k * factor, this.minK(), MAX_K);
    const r = k / this.camera.k;
    this.moveCamera({ k, x: p.x - (p.x - this.camera.x) * r, y: p.y - (p.y - this.camera.y) * r }, true, 260);
  }

  moveCamera(target, animate = true, duration = 700) {
    if (!animate || prefersReducedMotion()) {
      this.cameraAnim = null;
      this.camera = this.constrain({ ...target });
      this.invalidate();
      return;
    }
    this.cameraAnim = { from: { ...this.camera }, to: this.constrain({ ...target }), start: performance.now(), duration };
    this.invalidate();
  }

  // Keep zoom in range, keep the map vertically in view, and wrap horizontally.
  constrain(cam) {
    const vp = this.viewport();
    cam.k = clamp(cam.k, this.minK(), MAX_K);
    const top = Y_TOP * cam.k;
    const bottom = Y_BOTTOM * cam.k;
    const mapH = bottom - top;
    if (mapH <= vp.h) {
      cam.y = vp.cy - ((Y_TOP + Y_BOTTOM) / 2) * cam.k;
    } else {
      cam.y = clamp(cam.y, vp.y0 + vp.h - bottom - 20, vp.y0 - top + 20);
    }
    const cxw = (vp.cx - cam.x) / cam.k;
    const shift = Math.round((cxw - DEFAULT_CENTER) / WORLD_WIDTH);
    if (shift) cam.x += shift * WORLD_WIDTH * cam.k;
    return cam;
  }

  // ---------- Loop ----------

  invalidate() {
    if (!this.frame) this.frame = requestAnimationFrame((t) => this.loop(t));
  }

  loop(now) {
    this.frame = 0;
    if (this.cameraAnim) {
      const { from, to, start, duration } = this.cameraAnim;
      const t = clamp((now - start) / duration, 0, 1);
      const e = easeInOut(t);
      const vp = this.viewport();
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      const fc = { x: (vp.cx - from.x) / from.k, y: (vp.cy - from.y) / from.k };
      const tc = { x: (vp.cx - to.x) / to.k, y: (vp.cy - to.y) / to.k };
      // Travel the short way round the globe.
      tc.x = wrapNear(tc.x, fc.x);
      const cx = fc.x + (tc.x - fc.x) * e;
      const cy = fc.y + (tc.y - fc.y) * e;
      this.camera = { k, x: vp.cx - cx * k, y: vp.cy - cy * k };
      if (t >= 1) {
        this.camera = this.constrain({ ...to });
        this.cameraAnim = null;
      } else {
        this.frame = requestAnimationFrame((tt) => this.loop(tt));
      }
    }
    this.render();
  }

  // ---------- State at a given year ----------

  isAlive(l, year) {
    return year >= l.start && (l.end == null || year <= l.end);
  }

  /** Where a language's label and arcs attach at `year`. */
  anchorAt(l, year) {
    if (!this.isAlive(l, year)) return year > (l.end ?? Infinity) ? l : null;
    const active = l.places.filter((p) => year >= p.from && year <= (p.until ?? Infinity));
    const homeOn = l.homeUntil == null || year <= l.homeUntil;
    if (l.chain && active.length) return active[active.length - 1];
    if (homeOn) return l;
    return active[active.length - 1] || l;
  }

  stats(year) {
    let living = 0;
    let proto = 0;
    for (const l of this.langs) {
      if (this.hidden.has(l.family) || !this.isAlive(l, year)) continue;
      if (l.kind === 'proto') proto++;
      else living++;
    }
    return { living, proto };
  }

  // ---------- Render ----------

  render() {
    const { k, x: tx, y: ty } = this.camera;
    const year = this.year;
    const vp = this.viewport();
    const cxw = (vp.cx - tx) / k;
    const S = (x, y) => ({ x: x * k + tx, y: y * k + ty });
    const focus = this.lineage;
    const { showExtinct, showLineage, word } = this.options;

    this.layers.viewport.setAttribute('transform', `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(4)})`);

    // Pass 1: positions and visibility.
    for (const l of this.langs) {
      const filtered = this.hidden.has(l.family);
      const started = year >= l.start;
      const alive = this.isAlive(l, year);
      const ghost = started && !alive;
      l.homeX = wrapNear(l.x, cxw);
      l.state = filtered || !started ? 'off' : alive ? 'alive' : ghost && showExtinct ? 'ghost' : 'off';
      l.homeShown = l.state === 'ghost' || (l.state === 'alive' && (l.homeUntil == null || year <= l.homeUntil));
      const s = S(l.homeX, l.y);
      l.sx = s.x;
      l.sy = s.y;

      let prev = { x: l.homeX, y: l.y };
      for (const p of l.places) {
        const src = l.chain ? prev : { x: l.homeX, y: l.y };
        p.wx = wrapNear(p.x, src.x);
        p.src = src;
        p.on = l.state === 'alive' && year >= p.from && year <= (p.until ?? Infinity);
        const ps = S(p.wx, p.y);
        p.sx = ps.x;
        p.sy = ps.y;
        prev = { x: p.wx, y: p.y };
      }
    }

    // Pass 2: arcs.
    for (const l of this.langs) {
      if (l.arcEl) {
        const parent = this.byId.get(l.parent);
        const visible = l.state !== 'off' && !this.hidden.has(parent.family);
        const age = year - l.start;
        const fresh = age >= 0 && age < FRESH_YEARS;
        const inLineage = focus && focus.has(l.id) && focus.has(parent.id);
        const show = visible && (showLineage || fresh || inLineage);
        if (!show) {
          l.arcEl.style.display = 'none';
          l.arrowEl.style.display = 'none';
        } else {
          const start = { x: parent.homeX, y: parent.y };
          const pts = [start];
          let ref = start.x;
          for (const v of l.via) {
            const vx = wrapNear(v.x, ref);
            pts.push({ x: vx, y: v.y });
            ref = vx;
          }
          pts.push({ x: wrapNear(l.x, ref), y: l.y });
          const screen = pts.map((p) => S(p.x, p.y));
          const tip = screen[screen.length - 1];
          const { d, tail } = smoothPath([...screen.slice(0, -1), pullBack(tip, screen[screen.length - 2], 7)]);
          l.arcEl.setAttribute('d', d);
          l.arcEl.style.display = '';
          const strength = fresh ? 1 - age / FRESH_YEARS : 0;
          l.arcEl.style.opacity = focus ? (inLineage ? 1 : 0.06) : (0.22 + 0.68 * strength).toFixed(2);
          l.arcEl.classList.toggle('is-fresh', fresh && !focus);
          l.arcEl.classList.toggle('is-lineage', !!inLineage);
          const end = pullBack(tip, screen[screen.length - 2], 7);
          l.arrowEl.setAttribute('d', arrowPath(end, tail, fresh || inLineage ? 7 : 5.5));
          l.arrowEl.style.display = '';
          l.arrowEl.style.opacity = l.arcEl.style.opacity;
        }
      }
      for (const p of l.places) {
        const showSpread = p.on && !this.hidden.has(l.family);
        if (!showSpread) {
          p.arcEl.style.display = 'none';
          p.arrowEl.style.display = 'none';
          continue;
        }
        const age = year - p.from;
        const fresh = age < FRESH_YEARS / 2;
        const a = S(p.src.x, p.src.y);
        const b = { x: p.sx, y: p.sy };
        const tip = pullBack(b, a, 5);
        const { d, tail } = smoothPath([a, tip]);
        p.arcEl.setAttribute('d', d);
        p.arcEl.style.display = '';
        const inLineage = focus && focus.has(l.id);
        p.arcEl.style.opacity = focus ? (inLineage ? 0.95 : 0.05) : fresh ? 0.85 : 0.35;
        p.arrowEl.setAttribute('d', arrowPath(tip, tail, 5));
        p.arrowEl.style.display = '';
        p.arrowEl.style.opacity = p.arcEl.style.opacity;
      }
    }

    // Pass 3: markers.
    for (const l of this.langs) {
      const show = l.homeShown && l.state !== 'off';
      l.el.style.display = show ? '' : 'none';
      if (show) {
        l.el.setAttribute('transform', `translate(${l.sx.toFixed(1)},${l.sy.toFixed(1)})`);
        l.el.classList.toggle('is-ghost', l.state === 'ghost');
        l.el.classList.toggle('is-new', l.state === 'alive' && year - l.start < 120 && l.start > -4500);
        l.el.classList.toggle('is-selected', l.id === this.selected);
        l.el.classList.toggle('is-hover', l.id === this.hovered);
        l.el.classList.toggle('is-dim', !!focus && !focus.has(l.id));
      }
      for (const p of l.places) {
        p.el.style.display = p.on && !this.hidden.has(l.family) ? '' : 'none';
        if (p.on) {
          p.el.setAttribute('transform', `translate(${p.sx.toFixed(1)},${p.sy.toFixed(1)})`);
          p.el.classList.toggle('is-dim', !!focus && !focus.has(l.id));
          p.el.classList.toggle('is-new', year - p.from < 60);
        }
      }
    }

    this.placeLabels(word);
  }

  placeLabels(word) {
    const year = this.year;
    const focus = this.lineage;
    const placed = [];
    for (const l of this.langs) {
      if (l.el.style.display !== 'none') placed.push({ x: l.sx - 6, y: l.sy - 6, w: 12, h: 12, owner: l.id });
      for (const p of l.places) if (p.el.style.display !== 'none') placed.push({ x: p.sx - 4, y: p.sy - 4, w: 8, h: 8, owner: l.id });
    }

    const candidates = [];
    for (const l of this.langs) {
      const label = l.labelEl;
      if (l.state === 'off') {
        label.style.display = 'none';
        continue;
      }
      const anchor = l.state === 'ghost' ? l : this.anchorAt(l, year);
      const pos = anchor === l ? { x: l.sx, y: l.sy } : { x: anchor.sx, y: anchor.sy };
      const wordText = word && l.night ? l.night.form : '';
      const key = `${l.name}|${wordText}`;
      if (l.labelKey !== key) {
        l.labelKey = key;
        // An em space: ordinary spaces would collapse in SVG text.
        l.wordEl.textContent = wordText ? `\u2003${wordText}` : '';
        l.labelEl.classList.toggle('has-word', !!wordText);
        l.labelEl.classList.toggle('is-cognate', !!(wordText && l.night.cognate === true));
        l.labelEl.classList.toggle('is-noncognate', !!(wordText && l.night.cognate === false));
        label.style.display = '';
        if (!this.widthCache.has(key)) {
          let w = (l.name.length + wordText.length) * 6.6;
          try { w = label.getComputedTextLength() || w; } catch { /* not rendered */ }
          this.widthCache.set(key, w);
        }
      }
      let priority = l.state === 'ghost' ? 0 : 200 + (this.children.get(l.id)?.length || 0) * 20 + (l.kind === 'proto' ? 40 : 0);
      if (wordText) priority += 100;
      if (focus && focus.has(l.id)) priority += 5000;
      if (l.id === this.hovered) priority += 20000;
      if (l.id === this.selected) priority += 50000;
      candidates.push({ l, pos, w: this.widthCache.get(key), priority });
    }

    candidates.sort((a, b) => b.priority - a.priority);
    const h = FONT * 1.3;
    for (const c of candidates) {
      const { l, pos, w } = c;
      const r = l.kind === 'proto' ? 9 : 8;
      const options = [
        { x: pos.x + r, y: pos.y - h / 2, anchor: 'start', tx: pos.x + r },
        { x: pos.x - r - w, y: pos.y - h / 2, anchor: 'end', tx: pos.x - r },
        { x: pos.x - w / 2, y: pos.y + r - 2, anchor: 'middle', tx: pos.x },
        { x: pos.x - w / 2, y: pos.y - r - h + 2, anchor: 'middle', tx: pos.x },
      ];
      const force = l.id === this.selected || l.id === this.hovered;
      let chosen = null;
      for (const o of options) {
        const box = { x: o.x - 2, y: o.y, w: w + 4, h };
        if (box.x < 2 || box.x + box.w > this.width - 2 || box.y < 2 || box.y + box.h > this.height - 2) continue;
        if (!force && placed.some((p) => p.owner !== l.id && overlaps(box, p))) continue;
        chosen = { ...o, box };
        break;
      }
      const label = l.labelEl;
      if (!chosen) {
        label.style.display = 'none';
        continue;
      }
      placed.push(chosen.box);
      label.style.display = '';
      label.setAttribute('x', chosen.tx.toFixed(1));
      label.setAttribute('y', (chosen.y + FONT * 0.98).toFixed(1));
      label.setAttribute('text-anchor', chosen.anchor);
      label.classList.toggle('is-ghost', l.state === 'ghost');
      label.classList.toggle('is-dim', !!this.lineage && !this.lineage.has(l.id));
      label.classList.toggle('is-selected', l.id === this.selected);
    }
  }

  resize() {
    const w = this.svg.clientWidth;
    const h = this.svg.clientHeight;
    if (!w || !h) return;
    const first = !this.sized;
    if (!first) {
      this.camera.x += (w - this.width) / 2;
      this.camera.y += (h - this.height) / 2;
    }
    this.width = w;
    this.height = h;
    this.sized = true;
    if (first) this.fit({ animate: false });
    else {
      this.camera = this.constrain(this.camera);
      this.invalidate();
    }
  }

  // ---------- Input ----------

  localPoint(e) {
    const rect = this.svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  hitTarget(target) {
    const g = target.closest('.w-lang, .w-place');
    if (!g) return null;
    return { id: g.dataset.id, place: g.dataset.place != null ? Number(g.dataset.place) : null };
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
          type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y),
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, camera: { ...this.camera },
        };
        return;
      }
      this.gesture = { type: 'pan', start: p, camera: { ...this.camera }, moved: false, hit: this.hitTarget(e.target) };
    });

    svg.addEventListener('pointermove', (e) => {
      const p = this.localPoint(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      const g = this.gesture;
      if (!g) {
        if (e.pointerType === 'mouse' && this.hovered) this.onHover(this.hovered, e, this.hoverPlace);
        return;
      }
      if (g.type === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const k = clamp(g.camera.k * (dist / g.dist), this.minK(), MAX_K);
        const world = { x: (g.mid.x - g.camera.x) / g.camera.k, y: (g.mid.y - g.camera.y) / g.camera.k };
        this.camera = this.constrain({ k, x: mid.x - world.x * k, y: mid.y - world.y * k });
        this.invalidate();
        return;
      }
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!g.moved) {
        svg.classList.add('is-panning');
        this.onHover(null);
      }
      g.moved = true;
      this.camera = this.constrain({ ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy });
      this.invalidate();
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
          const [rest] = [...this.pointers.values()];
          this.gesture = { type: 'pan', start: rest, camera: { ...this.camera }, moved: true };
        }
        return;
      }
      this.gesture = null;
      if (e.type === 'pointercancel' || g.moved) return;
      if (g.hit) this.onSelect(g.hit.id, { source: 'map', place: g.hit.place });
      else this.onBackground();
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cameraAnim = null;
      const p = this.localPoint(e);
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.002;
      const factor = Math.pow(2, -e.deltaY * unit * (e.ctrlKey ? 5 : 1));
      const k = clamp(this.camera.k * factor, this.minK(), MAX_K);
      const r = k / this.camera.k;
      this.camera = this.constrain({ k, x: p.x - (p.x - this.camera.x) * r, y: p.y - (p.y - this.camera.y) * r });
      this.invalidate();
    }, { passive: false });

    svg.addEventListener('dblclick', (e) => {
      if (this.hitTarget(e.target)) return;
      this.zoomBy(1.8, this.localPoint(e));
    });

    svg.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse' || (this.gesture && this.gesture.moved)) return;
      const hit = this.hitTarget(e.target);
      if (!hit) return;
      this.hoverPlace = hit.place;
      this.setHover(hit.id);
      this.onHover(hit.id, e, hit.place);
    });
    svg.addEventListener('pointerout', (e) => {
      const g = e.target.closest('.w-lang, .w-place');
      if (!g || (e.relatedTarget && g.contains(e.relatedTarget))) return;
      this.setHover(null);
      this.onHover(null);
    });
    svg.addEventListener('pointerleave', () => {
      this.setHover(null);
      this.onHover(null);
    });
  }
}
