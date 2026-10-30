import { WorldView } from './world-view.js';
import { sourcesSection } from './bibliography.js';
import { fraction, yearAt, niceYear, formatYear, formatRange } from './timescale.js';
import { el, prefersReducedMotion } from './dom.js';

const PRESENT = 2025;
const PLAY_DURATION = 45000; // ms for a full sweep of the slider
const TICKS = [-4000, -2000, -1000, 1, 500, 1000, 1500, 1700, 1800, 1900, 2000];
const ERAS = [
  { label: '4000 BCE', year: -4000 },
  { label: '1500 BCE', year: -1500 },
  { label: '1 CE', year: 1 },
  { label: '800', year: 800 },
  { label: '1500', year: 1500 },
  { label: '1900', year: 1900 },
  { label: 'Today', year: PRESENT },
];
const MODE_KEY = 'linguistic-drift.world-view';
const SYMBOLS = [
  ['alive', 'Spoken at the selected date'],
  ['proto', 'Reconstructed proto-language'],
  ['ghost', 'No longer spoken'],
  ['place', 'Spread to a new region'],
  ['descent', 'Descent (parent → daughter)'],
  ['contact', 'Creole: formed through contact'],
  ['spread', 'Migration or expansion'],
];
const AREA_SYMBOLS = [
  ['area', 'Where it was spoken at the selected date (approximate)'],
  ['area-proto', 'Reconstructed proto-language: likely homeland'],
  ['ghost', 'No longer spoken'],
  ['place', 'No area: a written, liturgical or second language, or too small at this zoom'],
  ['descent', 'Descent (parent → daughter)'],
  ['contact', 'Creole: formed through contact'],
  ['spread', 'Migration or expansion'],
];

function symbolSvg(kind) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 30 14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `sym sym-${kind}`);
  const add = (tag, attrs) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  };
  if (kind === 'alive') add('circle', { cx: 15, cy: 7, r: 5 });
  else if (kind === 'proto') add('circle', { cx: 15, cy: 7, r: 5.5 });
  else if (kind === 'ghost') add('circle', { cx: 15, cy: 7, r: 4.5 });
  else if (kind === 'place') add('circle', { cx: 15, cy: 7, r: 3.5 });
  else if (kind === 'area' || kind === 'area-proto') add('path', { d: 'M5 4.5Q9 1 16 2.5T26 6Q27 11 20 12T7 11.5Q3 8 5 4.5Z' });
  else add('path', { d: 'M2 10Q15 1 28 7' });
  return svg;
}

const statusOf = (l) =>
  l.kind === 'proto' ? 'Reconstructed (never written down)'
    : l.status === 'revived' ? 'Revived'
    : l.end != null ? 'No longer spoken'
    : 'Living';

export class WorldSection {
  constructor(app) {
    this.app = app;
    this.data = app.data.languages;
    this.families = new Map(this.data.families.map((f) => [f.id, f]));
    this.byId = new Map(this.data.languages.map((l) => [l.id, l]));
    this.root = document.getElementById('section-world');
    this.$ = (sel) => this.root.querySelector(sel);
    this.panel = this.$('#w-panel');
    this.panelContent = this.$('#w-panel-content');
    this.legendBody = this.$('#w-legend-body');
    this.range = this.$('#w-range');
    this.year = PRESENT;
    this.selected = null;
    this.hidden = new Set();
    this.playing = false;

    this.view = new WorldView(this.$('#world'), {
      languages: this.data.languages,
      landPath: app.data.land.d,
      onSelect: (id, opts) => this.select(id, opts),
      onHover: (id, e, place) => this.showTooltip(id, e, place),
      onBackground: () => this.select(null),
    });

    this.buildLegend();
    this.buildTimeControls();
    this.bindControls();
    let mode = 'dots';
    try { mode = localStorage.getItem(MODE_KEY) || mode; } catch { /* storage unavailable */ }
    this.setMode(mode, { save: false });
    this.setLegendOpen(!app.isNarrow() && window.innerHeight > 640);
    this.setYear(PRESENT);
  }

  // ---------- Lifecycle ----------

  activate() {
    this.root.hidden = false;
    this.view.resize();
    this.view.setInsets(this.overlayInsets());
    this.layoutTicks();
  }

  deactivate() {
    this.stop();
    this.root.hidden = true;
  }

  fitIfFresh() {
    this.view.setInsets(this.overlayInsets());
    this.view.fit({ animate: false });
  }

  overlayInsets() {
    const time = this.$('#w-time');
    const bottom = time.offsetHeight + 24;
    if (this.app.isNarrow()) {
      return { left: 0, right: 0, top: 0, bottom: this.panel.hidden ? bottom : this.panel.offsetHeight };
    }
    return {
      left: this.legendBody.hidden ? 0 : this.$('#w-legend').offsetWidth + 12,
      right: this.panel.hidden ? 0 : this.panel.offsetWidth + 24,
      top: 64,
      bottom,
    };
  }

  // ---------- Time ----------

  setYear(year, { fromSlider = false } = {}) {
    this.year = Math.round(Math.min(PRESENT, year));
    this.view.setYear(this.year);
    if (!fromSlider) this.range.value = String(Math.round(fraction(this.year) * 1000));
    this.range.setAttribute('aria-valuetext', formatYear(this.year));
    this.$('#w-year-value').textContent = formatYear(this.year);
    const { living, proto } = this.view.stats(this.year);
    const parts = [`${living} language${living === 1 ? '' : 's'} on the map`];
    if (proto) parts.push(`${proto} reconstructed`);
    this.$('#w-year-meta').textContent = parts.join(' · ');
    for (const b of this.$('#w-eras').children) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.year) === this.year));
    }
  }

  play() {
    if (this.playing) return;
    if (this.year >= PRESENT) this.setYear(-4500);
    if (prefersReducedMotion()) {
      this.setYear(PRESENT);
      return;
    }
    this.playing = true;
    this.root.classList.add('is-playing');
    this.$('#w-play').setAttribute('aria-label', 'Pause');
    let last = performance.now();
    let pos = fraction(this.year);
    const tick = (now) => {
      if (!this.playing) return;
      pos += (now - last) / PLAY_DURATION;
      last = now;
      const year = niceYear(yearAt(pos));
      this.setYear(year);
      if (pos >= fraction(PRESENT)) {
        this.setYear(PRESENT);
        return this.stop();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.root.classList.remove('is-playing');
    this.$('#w-play').setAttribute('aria-label', 'Play through time');
  }

  togglePlay() {
    if (this.playing) this.stop();
    else this.play();
  }

  buildTimeControls() {
    const ticks = this.$('#w-ticks');
    for (const t of TICKS) {
      ticks.append(el('span', { style: `left:${(fraction(t) * 100).toFixed(2)}%`, 'data-year': t }, formatYear(t)));
    }
    const eras = this.$('#w-eras');
    for (const e of ERAS) {
      eras.append(el('button', {
        type: 'button', class: 'chip', 'data-year': e.year, 'aria-pressed': 'false',
        onclick: () => {
          this.stop();
          this.setYear(e.year);
        },
      }, e.label));
    }
    this.range.addEventListener('input', () => {
      this.stop();
      this.setYear(niceYear(yearAt(Number(this.range.value) / 1000)), { fromSlider: true });
    });
    this.range.max = String(Math.round(fraction(PRESENT) * 1000));
    // Hide tick labels that would overlap.
    new ResizeObserver(() => this.layoutTicks()).observe(ticks);
  }

  layoutTicks() {
    const ticks = this.$('#w-ticks');
    const width = ticks.clientWidth;
    if (!width) return;
    let lastRight = -Infinity;
    for (const span of ticks.children) {
      const x = fraction(Number(span.dataset.year)) / fraction(PRESENT) * width;
      const w = span.textContent.length * 6.5;
      const ok = x - w / 2 > lastRight + 4;
      span.hidden = !ok;
      span.style.left = `${x}px`;
      if (ok) lastRight = x + w / 2;
    }
  }

  // ---------- Selection ----------

  select(id, { source = 'ui', updateHash = true } = {}) {
    if (id && !this.byId.has(id)) id = null;
    const l = id && this.byId.get(id);
    if (l && this.hidden.has(l.family)) {
      this.hidden.delete(l.family);
      this.applyFilters();
    }
    this.selected = id;
    this.view.select(id);
    this.app.markIndexCurrent(id);

    if (!l) {
      this.panel.hidden = true;
      this.root.classList.remove('panel-open');
      this.view.setInsets(this.overlayInsets());
      if (updateHash) this.app.setRoute({ section: 'world', id: null }, { replace: true });
      return;
    }

    // Jump to a date at which the language can be seen.
    if (source !== 'map') {
      const end = l.end ?? PRESENT;
      if (this.year < l.start) this.setYear(niceYear(Math.min(end, l.start + Math.max(10, (end - l.start) / 4))));
      else if (this.year > end) this.setYear(niceYear((l.start + end) / 2));
    }

    this.renderPanel(l);
    this.panel.hidden = false;
    this.root.classList.add('panel-open');
    this.view.setInsets(this.overlayInsets());
    // A marker clicked on the map only needs a nudge if the panel now covers
    // it; anything else flies there.
    if (source === 'map') this.view.ensureVisible(id);
    else this.view.focusLanguage(id);
    if (!['map', 'hash'].includes(source) && !this.app.isNarrow()) this.$('#w-panel-title')?.focus({ preventScroll: true });
    if (updateHash) this.app.setRoute({ section: 'world', id }, { replace: true });
  }

  renderPanel(l) {
    const fam = this.families.get(l.family);
    const ancestors = this.view.ancestors(l.id);
    const children = this.data.languages.filter((x) => x.parent === l.id);
    const langChip = (x, extra) =>
      el('button', { type: 'button', class: `chip fam-${x.family}`, onclick: () => this.select(x.id, { source: 'panel' }) },
        el('span', { class: 'swatch is-lang', 'aria-hidden': 'true' }), x.name, extra ? el('small', {}, ` ${extra}`) : null);

    const c = this.panelContent;
    c.replaceChildren();
    c.scrollTop = 0;
    c.className = `panel-scroll fam-${l.family}`;

    c.append(...[
      el('div', { class: 'eyebrow' }, el('span', { class: 'swatch is-lang', 'aria-hidden': 'true' }),
        [...new Set([l.familyName || fam.label, l.branch].filter(Boolean))].join(' · ')),
      el('h2', { id: 'w-panel-title', tabindex: '-1' }, l.name),
      el('div', { class: 'era' }, l.era),
      el('div', { class: 'status-row' },
        el('span', { class: `status-pill s-${statusOf(l).split(' ')[0].toLowerCase()}` }, statusOf(l)),
        l.speakers ? el('span', { class: 'speakers' }, l.speakers) : null),
      el('p', { class: 'summary' }, l.summary),
      l.afterlife ? el('p', { class: 'body' }, l.afterlife) : null,
    ].filter(Boolean));

    if (l.night) {
      const meta = this.data.meta.word;
      const verdict = l.night.cognate === true ? `Inherited from Proto-Indo-European ${meta.root}`
        : l.night.cognate === false ? `Indo-European, but not from ${meta.root}`
        : 'A different family: unrelated to the Indo-European word';
      c.append(el('section', { class: 'section' },
        el('h3', {}, `The word for ‘${meta.gloss}’`),
        el('div', { class: `word-card ${l.night.cognate === true ? 'is-cognate' : ''}` },
          el('div', { class: 'word-form' }, l.night.form),
          el('div', { class: 'word-verdict' }, verdict),
          l.night.note ? el('div', { class: 'word-note' }, l.night.note) : null,
        ),
      ));
    }

    const lineage = [];
    if (ancestors.length) {
      lineage.push(el('div', { class: 'conn-group' }, el('h4', {}, 'Descended from'),
        el('ol', { class: 'lineage' }, ancestors.map((a) => el('li', {}, langChip(a))), el('li', {}, el('span', { class: 'chip is-current' }, l.name)))));
    }
    if (l.relation === 'contact') {
      lineage.push(el('p', { class: 'relation-note' }, `Not a descendant in the usual sense: a creole that took most of its vocabulary from ${this.byId.get(l.parent).name} and much of its grammar from other languages.`));
    } else if (l.relation === 'revival') {
      lineage.push(el('p', { class: 'relation-note' }, `Revived from ${this.byId.get(l.parent).name} after centuries in which it had no native speakers.`));
    }
    if (children.length) {
      lineage.push(el('div', { class: 'conn-group' }, el('h4', {}, 'Gave rise to'),
        el('div', { class: 'chips' }, children.map((x) => langChip(x, x.relation === 'contact' ? '(creole)' : x.relation === 'revival' ? '(revival)' : '')))));
    }
    if (lineage.length) c.append(el('section', { class: 'section' }, el('h3', {}, 'Family tree'), el('div', { class: 'connections' }, lineage)));

    if (l.places && l.places.length) {
      c.append(el('section', { class: 'section' },
        el('h3', {}, 'Spread'),
        el('ul', { class: 'places' },
          l.places.map((p, i) =>
            el('li', {},
              el('button', {
                type: 'button',
                onclick: () => {
                  this.stop();
                  this.setYear(Math.max(this.year < p.from || this.year > (p.until ?? PRESENT) ? p.from + 10 : this.year, p.from));
                  this.view.focusPlace(l.id, i);
                },
              },
              el('span', { class: 'place-year' }, p.until ? formatRange(p.from, p.until) : `from ${formatYear(p.from)}`),
              el('span', {}, p.label)),
            ),
          ),
        ),
      ));
    }

    const concepts = (l.concepts || []).map((id) => this.app.conceptById.get(id)).filter(Boolean);
    if (concepts.length) {
      c.append(el('section', { class: 'section' },
        el('h3', {}, 'In the concept map'),
        el('div', { class: 'chips' }, concepts.map((n) =>
          el('button', { type: 'button', class: `chip cat-${n.category}`, onclick: () => this.app.go({ section: 'concepts', id: n.id }) },
            el('span', { class: 'swatch', 'aria-hidden': 'true' }), n.label))),
      ));
    }

    const src = sourcesSection(l.sources, { byId: this.app.sourcesById, onOpen: (sid) => this.app.openSources(sid) });
    if (src) c.append(src);
    c.append(el('div', { class: 'panel-foot' }, `Dates and positions are approximate · link: #/world/${l.id}`));
  }

  showTooltip(id, e, place) {
    if (!id) return this.app.tooltip.hide();
    const l = this.byId.get(id);
    const fam = this.families.get(l.family);
    const p = place != null ? l.places[place] : null;
    this.app.tooltip.show(e, `w:${id}:${place}`, () => ({
      title: p ? `${l.name}: ${p.label}` : l.name,
      swatch: el('span', { class: 'swatch is-lang', 'aria-hidden': 'true' }),
      className: `fam-${l.family}`,
      meta: p
        ? `${p.until ? formatRange(p.from, p.until) : `from ${formatYear(p.from)}`}`
        : [l.familyName || fam.label, l.era].filter(Boolean).join(' · '),
      text: p ? null : (this.view.options.word && l.night ? `‘night’: ${l.night.form}. ` : '') + l.summary,
    }));
  }

  // ---------- Legend ----------

  buildLegend() {
    const counts = {};
    for (const l of this.data.languages) counts[l.family] = (counts[l.family] || 0) + 1;
    const list = this.$('#w-families');
    for (const f of this.data.families) {
      list.append(el('li', {},
        el('button', {
          type: 'button', class: `fam-${f.id}`, 'aria-pressed': 'true', 'data-fam': f.id, title: f.description,
          onclick: () => {
            if (this.hidden.has(f.id)) this.hidden.delete(f.id);
            else this.hidden.add(f.id);
            this.applyFilters();
          },
        }, el('span', { class: 'swatch', 'aria-hidden': 'true' }), f.label, el('span', { class: 'count' }, counts[f.id] || 0)),
      ));
    }
  }

  renderSymbols() {
    const sym = this.$('#w-symbols');
    sym.replaceChildren(...(this.mode === 'areas' ? AREA_SYMBOLS : SYMBOLS).map(([kind, label]) => el('li', {}, symbolSvg(kind), label)));
  }

  /** Show languages as 'dots' (one per place) or 'areas' (approximate territories). */
  setMode(mode, { save = true } = {}) {
    this.mode = mode === 'areas' ? 'areas' : 'dots';
    for (const b of this.$('#w-mode').children) b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode));
    this.root.classList.toggle('is-areas', this.mode === 'areas');
    this.$('#w-area-note').hidden = this.mode !== 'areas';
    this.renderSymbols();
    this.view.setMode(this.mode);
    if (save) {
      try { localStorage.setItem(MODE_KEY, this.mode); } catch { /* storage unavailable */ }
    }
  }

  applyFilters() {
    for (const b of this.$('#w-families').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', this.hidden.has(b.dataset.fam) ? 'false' : 'true');
    }
    this.view.setHidden(this.hidden);
    this.setYear(this.year);
    if (this.selected && this.hidden.has(this.byId.get(this.selected).family)) this.select(null);
  }

  setLegendOpen(open) {
    this.$('#w-legend-toggle').setAttribute('aria-expanded', String(open));
    this.legendBody.hidden = !open;
    this.view.setInsets(this.overlayInsets());
  }

  // ---------- Index ----------

  buildIndex(container) {
    const item = (l) =>
      el('li', {},
        el('button', {
          type: 'button', class: `fam-${l.family}`, 'data-id': l.id, 'aria-current': String(l.id === this.selected),
          onclick: () => {
            this.select(l.id, { source: 'index' });
            if (this.app.isNarrow()) this.app.setDrawerOpen(false);
          },
        }, l.name, el('small', { class: 'index-era' }, l.era)),
      );
    for (const f of this.data.families) {
      const items = this.data.languages.filter((l) => l.family === f.id);
      container.append(el('h3', { class: `fam-${f.id}` }, el('span', { class: 'swatch', 'aria-hidden': 'true' }), f.label));
      // The colour groups can hold several real families (notably "Other"):
      // list those under their own sub-headings.
      const byName = new Map();
      for (const l of items) {
        const key = l.familyName || '';
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(l);
      }
      const names = [...byName.keys()].sort((a, b) => a.localeCompare(b));
      for (const name of names) {
        const list = byName.get(name).sort((a, b) => a.name.localeCompare(b.name));
        if (name && names.length > 1) container.append(el('h4', { class: 'index-subfamily' }, name));
        container.append(el('ul', {}, list.map(item)));
      }
    }
  }

  // ---------- Controls & keys ----------

  bindControls() {
    this.$('#w-panel-close').addEventListener('click', () => this.select(null));
    this.$('#w-legend-toggle').addEventListener('click', () => this.setLegendOpen(this.legendBody.hidden));
    this.$('#w-play').addEventListener('click', () => this.togglePlay());
    for (const b of this.$('#w-mode').children) b.addEventListener('click', () => this.setMode(b.dataset.mode));
    this.$('#w-zoom-in').addEventListener('click', () => this.zoomIn());
    this.$('#w-zoom-out').addEventListener('click', () => this.zoomOut());
    this.$('#w-zoom-fit').addEventListener('click', () => this.fit());
    const opt = (id, key) => this.$(id).addEventListener('change', (e) => {
      this.view.setOptions({ [key]: e.target.checked });
      this.setYear(this.year);
    });
    opt('#w-opt-extinct', 'showExtinct');
    opt('#w-opt-lineage', 'showLineage');
    opt('#w-opt-word', 'word');
  }

  zoomIn() { this.view.zoomBy(1.5); }
  zoomOut() { this.view.zoomBy(1 / 1.5); }
  fit() { this.view.fit(); }

  onResize() {
    this.view.setInsets(this.overlayInsets());
    this.layoutTicks();
  }

  handleEscape() {
    if (this.playing) {
      this.stop();
      return true;
    }
    if (this.selected) {
      this.select(null);
      return true;
    }
    return false;
  }

  handleKey(e) {
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      this.togglePlay();
      return true;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (e.target === this.range) return false;
      this.stop();
      const f = fraction(this.year) + (e.key === 'ArrowRight' ? 0.01 : -0.01);
      this.setYear(niceYear(yearAt(Math.max(0, f))));
      return true;
    }
    return false;
  }
}

