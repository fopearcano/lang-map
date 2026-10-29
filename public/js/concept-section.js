import { MapView } from './graph.js';
import { renderPanel } from './panel.js';
import { Timeline } from './timeline.js';
import { sourcesSection } from './bibliography.js';
import { el, swatch } from './dom.js';

const RELATION_LEGEND = [
  ['includes', 'Includes', 'M0 5h30'],
  ['drives', 'Drives / leads to', 'M0 5h26'],
  ['instance', 'Example of', 'M0 5h30'],
  ['challenges', 'Challenges', 'M0 5h30'],
  ['proposed', 'Proposed by', 'M0 5h30'],
  ['related', 'Related', 'M0 5h30'],
];

/**
 * The concept-map section: graph, legend, detail panel, tour and timeline.
 * `app` supplies shared services (tooltip, routing, sources, cross-links).
 */
export class ConceptSection {
  constructor(app) {
    this.app = app;
    this.data = app.data.map;
    this.byId = new Map(this.data.nodes.map((n) => [n.id, n]));
    this.categories = new Map(this.data.categories.map((c) => [c.id, c]));
    this.root = document.getElementById('section-concepts');
    this.$ = (sel) => this.root.querySelector(sel);
    this.panel = this.$('#panel');
    this.panelContent = this.$('#panel-content');
    this.tourCard = this.$('#tour-card');
    this.legendBody = this.$('#legend-body');
    this.state = { selected: null, hidden: new Set(), tourIndex: -1, stopPanel: null };
    this.legendWasOpen = null;

    this.map = new MapView(this.$('#map'), this.data, {
      onSelect: (id, opts) => this.select(id, opts),
      onHover: (id, e) => this.showTooltip(id, e),
      onBackground: () => {
        if (this.state.tourIndex < 0) this.select(null);
      },
    });

    this.timelineEl = document.getElementById('timeline');
    this.timeline = new Timeline(document.getElementById('timeline-svg'), this.data.nodes, {
      onSelect: (id) => this.select(id, { source: 'timeline' }),
      onHover: (id, e) => {
        this.map.setHover(id);
        this.showTooltip(id, e);
      },
    });

    this.buildLegend();
    this.bindControls();
    this.setLegendOpen(!app.isNarrow() && window.innerHeight > 700);
  }

  // ---------- Lifecycle ----------

  activate() {
    this.root.hidden = false;
    this.timelineEl.hidden = !this.app.timelineOpen;
    this.map.resize();
    this.map.setInsets(this.overlayInsets());
  }

  deactivate() {
    this.endTour();
    this.root.hidden = true;
    this.timelineEl.hidden = true;
  }

  fitIfFresh() {
    this.map.setInsets(this.overlayInsets());
    this.map.fit({ animate: false });
  }

  // ---------- Selection ----------

  // Screen space covered by floating overlays, so the camera centres nodes in
  // the part of the map that is actually visible.
  overlayInsets() {
    const tourH = this.tourCard.hidden ? 0 : this.tourCard.offsetHeight + 24;
    if (this.app.isNarrow()) {
      return { left: 0, right: 0, bottom: (this.panel.hidden ? 0 : this.panel.offsetHeight) + tourH };
    }
    return {
      left: this.legendBody.hidden ? 0 : this.$('#legend').offsetWidth + 12,
      right: this.panel.hidden ? 0 : this.panel.offsetWidth + 24,
      bottom: tourH,
    };
  }

  select(id, { source = 'ui', updateHash = true } = {}) {
    const { state, byId } = this;
    if (id && !byId.has(id)) id = null;
    if (id && state.hidden.has(byId.get(id).category)) {
      state.hidden.delete(byId.get(id).category);
      this.applyFilters();
    }
    state.selected = id;
    if (state.stopPanel) state.stopPanel();
    state.stopPanel = null;

    this.map.select(id);
    this.timeline.setSelected(id);
    this.app.markIndexCurrent(id);

    if (!id) {
      this.panel.hidden = true;
      this.root.classList.remove('panel-open');
      this.map.setInsets(this.overlayInsets());
      if (updateHash) this.app.setRoute({ section: 'concepts', id: null }, { replace: true });
      return;
    }

    const node = byId.get(id);
    const languages = this.app.languagesForConcept(id);
    state.stopPanel = renderPanel(this.panelContent, node, {
      byId,
      categories: this.categories,
      relations: this.data.relations,
      links: this.data.links,
      onNavigate: (next) => this.select(next, { source: 'panel' }),
      extraSections: [
        languages.length
          ? el('section', { class: 'section' },
            el('h3', {}, 'On the world map'),
            el('div', { class: 'chips' },
              languages.map((l) =>
                el('button', {
                  type: 'button', class: `chip fam-${l.family}`,
                  onclick: () => this.app.go({ section: 'world', id: l.id }),
                }, el('span', { class: 'swatch is-lang', 'aria-hidden': 'true' }), l.name),
              ),
            ),
          )
          : null,
        sourcesSection(node.sources, { byId: this.app.sourcesById, onOpen: (sid) => this.app.openSources(sid) }),
      ],
    });
    this.panel.hidden = false;
    this.root.classList.add('panel-open');
    this.map.setInsets(this.overlayInsets());

    if (source === 'map') this.map.ensureVisible(id);
    else this.map.centerOn(id, { k: Math.max(this.map.camera.k, this.app.isNarrow() ? 0.8 : 1) });

    if (!['tour', 'map', 'hash'].includes(source) && !this.app.isNarrow()) {
      this.$('#panel-title')?.focus({ preventScroll: true });
    }
    if (updateHash) this.app.setRoute({ section: 'concepts', id }, { replace: true });
    if (state.tourIndex >= 0 && this.data.tour[state.tourIndex]?.node !== id) this.map.setPulse(null);
  }

  showTooltip(id, e) {
    if (!id) return this.app.tooltip.hide();
    const n = this.byId.get(id);
    this.app.tooltip.show(e, `c:${id}`, () => ({
      title: n.label,
      swatch: swatch(n),
      className: `cat-${n.category}`,
      meta: [this.categories.get(n.category).label, n.era].filter(Boolean).join(' · '),
      text: n.summary,
    }));
  }

  // ---------- Legend & filters ----------

  buildLegend() {
    const counts = {};
    for (const n of this.data.nodes) counts[n.category] = (counts[n.category] || 0) + 1;
    const list = this.$('#legend-categories');
    for (const c of this.data.categories.filter((x) => x.id !== 'core')) {
      list.append(
        el('li', {},
          el('button', {
            type: 'button', class: `cat-${c.id}`, 'aria-pressed': 'true', 'data-cat': c.id, title: c.description,
            onclick: () => {
              if (this.state.hidden.has(c.id)) this.state.hidden.delete(c.id);
              else this.state.hidden.add(c.id);
              this.applyFilters();
            },
          }, el('span', { class: 'swatch', 'aria-hidden': 'true' }), c.label, el('span', { class: 'count' }, counts[c.id] || 0)),
        ),
      );
    }
    const rel = this.$('#legend-relations');
    for (const [type, label, d] of RELATION_LEGEND) {
      const sample = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      sample.setAttribute('viewBox', '0 0 30 10');
      sample.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', `link t-${type}`);
      sample.append(path);
      rel.append(el('li', {}, sample, label));
    }
  }

  applyFilters() {
    for (const b of this.$('#legend-categories').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', this.state.hidden.has(b.dataset.cat) ? 'false' : 'true');
    }
    this.map.setHidden(this.state.hidden);
    this.timeline.setHidden(this.state.hidden);
    if (this.state.selected && this.state.hidden.has(this.byId.get(this.state.selected).category)) this.select(null);
  }

  setLegendOpen(open) {
    this.$('#legend-toggle').setAttribute('aria-expanded', String(open));
    this.legendBody.hidden = !open;
    this.map.setInsets(this.overlayInsets());
  }

  // ---------- Index ----------

  buildIndex(container) {
    for (const c of this.data.categories) {
      const items = this.data.nodes
        .filter((n) => n.category === c.id)
        .sort((a, b) => (b.kind === 'hub') - (a.kind === 'hub') || a.label.localeCompare(b.label));
      container.append(
        el('h3', { class: `cat-${c.id}` }, el('span', { class: 'swatch', 'aria-hidden': 'true' }), c.label),
        el('ul', {},
          items.map((n) =>
            el('li', {},
              el('button', {
                type: 'button',
                class: `cat-${n.category}${n.kind === 'hub' || n.kind === 'core' ? ' is-hub' : ''}`,
                'data-id': n.id,
                'aria-current': String(n.id === this.state.selected),
                onclick: () => {
                  this.select(n.id, { source: 'index' });
                  if (this.app.isNarrow()) this.app.setDrawerOpen(false);
                },
              }, n.label),
            ),
          ),
        ),
      );
    }
  }

  // ---------- Tour ----------

  startTour() {
    this.goTour(0);
  }

  goTour(i) {
    const { state, data } = this;
    if (i < 0 || i >= data.tour.length) return this.endTour();
    if (state.tourIndex < 0) {
      // Fold the legend away for the tour so it doesn't crowd the tour card.
      this.legendWasOpen = !this.legendBody.hidden;
      this.setLegendOpen(false);
    }
    state.tourIndex = i;
    const step = data.tour[i];
    this.app.hideWelcome();
    this.app.setDrawerOpen(false);
    this.tourCard.hidden = false;
    this.$('#tour-step').textContent = `Step ${i + 1} of ${data.tour.length}`;
    this.$('#tour-bar-fill').style.width = `${((i + 1) / data.tour.length) * 100}%`;
    this.$('#tour-text').textContent = step.text;
    this.$('#tour-prev').disabled = i === 0;
    this.$('#tour-next').textContent = i === data.tour.length - 1 ? 'Finish' : 'Next';
    this.select(step.node, { source: 'tour' });
    this.map.setPulse(step.node);
  }

  endTour() {
    if (this.state.tourIndex < 0) return;
    this.state.tourIndex = -1;
    this.tourCard.hidden = true;
    this.map.setPulse(null);
    if (this.legendWasOpen) this.setLegendOpen(true);
    this.map.setInsets(this.overlayInsets());
  }

  // ---------- Controls & keys ----------

  bindControls() {
    this.$('#panel-close').addEventListener('click', () => this.select(null));
    this.$('#legend-toggle').addEventListener('click', () => this.setLegendOpen(this.legendBody.hidden));
    this.$('#tour-prev').addEventListener('click', () => this.goTour(this.state.tourIndex - 1));
    this.$('#tour-next').addEventListener('click', () => this.goTour(this.state.tourIndex + 1));
    this.$('#tour-exit').addEventListener('click', () => this.endTour());
    this.$('#zoom-in').addEventListener('click', () => this.zoomIn());
    this.$('#zoom-out').addEventListener('click', () => this.zoomOut());
    this.$('#zoom-fit').addEventListener('click', () => this.fit());
  }

  zoomIn() { this.map.zoomBy(1.4); }
  zoomOut() { this.map.zoomBy(1 / 1.4); }
  fit() { this.map.fit(); }

  onResize() {
    this.map.setInsets(this.overlayInsets());
  }

  /** Returns true if Escape closed something. */
  handleEscape() {
    if (this.state.tourIndex >= 0) {
      this.endTour();
      return true;
    }
    if (this.state.selected) {
      this.select(null);
      return true;
    }
    return false;
  }

  handleKey(e) {
    if (this.state.tourIndex < 0) return false;
    if (e.key === 'ArrowRight') this.goTour(this.state.tourIndex + 1);
    else if (e.key === 'ArrowLeft') this.goTour(this.state.tourIndex - 1);
    else return false;
    return true;
  }
}
