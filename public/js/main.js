import { MapView } from './graph.js';
import { renderPanel } from './panel.js';
import { Timeline } from './timeline.js';
import { buildSearchIndex, search } from './search.js';
import { el, swatch } from './dom.js';

const $ = (sel) => document.querySelector(sel);
const STORAGE = { theme: 'lang-map:theme', welcomed: 'lang-map:welcomed' };

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
};

const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;
const isTyping = (e) => e.target.closest('input, textarea, [contenteditable="true"]');

async function main() {
  const res = await fetch('api/map');
  if (!res.ok) throw new Error(`Could not load map data (${res.status})`);
  const data = await res.json();

  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const byId = new Map(data.nodes.map((n) => [n.id, n]));

  const state = {
    selected: null,
    hidden: new Set(),
    tourIndex: -1,
    stopPanel: null,
  };

  const stage = $('#stage');
  const panel = $('#panel');
  const panelContent = $('#panel-content');
  const tooltip = $('#tooltip');
  const drawer = $('#index-drawer');

  // Let the loading message paint before the (synchronous) layout runs.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  const map = new MapView($('#map'), data, {
    onSelect: (id, opts) => select(id, opts),
    onHover: (id, e) => showTooltip(id, e),
    onBackground: () => {
      if (state.tourIndex < 0) select(null);
    },
  });
  $('#loading').hidden = true;

  const timeline = new Timeline($('#timeline-svg'), data.nodes, {
    onSelect: (id) => select(id, { source: 'timeline' }),
    onHover: (id, e) => {
      map.setHover(id);
      showTooltip(id, e);
    },
  });

  // ---------- Selection ----------

  // Screen space covered by floating overlays, so the camera centres nodes in
  // the part of the map that is actually visible.
  function overlayInsets() {
    const tourCard = $('#tour-card');
    const legendBody = $('#legend-body');
    const tourH = tourCard.hidden ? 0 : tourCard.offsetHeight + 24;
    if (isNarrow()) {
      return { left: 0, right: 0, bottom: (panel.hidden ? 0 : panel.offsetHeight) + tourH };
    }
    return {
      left: legendBody.hidden ? 0 : $('#legend').offsetWidth + 12,
      right: panel.hidden ? 0 : panel.offsetWidth + 24,
      bottom: tourH,
    };
  }

  function select(id, { source = 'ui', updateHash = true } = {}) {
    if (id && !byId.has(id)) id = null;
    if (id && state.hidden.has(byId.get(id).category)) {
      state.hidden.delete(byId.get(id).category);
      applyFilters();
    }
    state.selected = id;
    if (state.stopPanel) state.stopPanel();
    state.stopPanel = null;

    map.select(id);
    timeline.setSelected(id);
    for (const b of drawer.querySelectorAll('[data-id]')) {
      b.setAttribute('aria-current', b.dataset.id === id ? 'true' : 'false');
    }

    if (!id) {
      panel.hidden = true;
      stage.classList.remove('panel-open');
      map.setInsets(overlayInsets());
      if (updateHash) setHash(null);
      return;
    }

    const node = byId.get(id);
    state.stopPanel = renderPanel(panelContent, node, {
      byId,
      categories,
      relations: data.relations,
      links: data.links,
      onNavigate: (next) => select(next, { source: 'panel' }),
    });
    panel.hidden = false;
    stage.classList.add('panel-open');
    map.setInsets(overlayInsets());

    if (source === 'map') map.ensureVisible(id);
    else map.centerOn(id, { k: Math.max(map.camera.k, isNarrow() ? 0.8 : 1) });

    if (source !== 'tour' && source !== 'map' && !isNarrow()) $('#panel-title')?.focus({ preventScroll: true });
    if (updateHash) setHash(id);
    if (state.tourIndex >= 0 && data.tour[state.tourIndex]?.node !== id) map.setPulse(null);
  }

  function setHash(id) {
    const url = id ? `#/${id}` : location.pathname + location.search;
    history.replaceState(null, '', url);
  }

  function idFromHash() {
    const m = location.hash.match(/^#\/([a-z0-9-]+)$/);
    return m && byId.has(m[1]) ? m[1] : null;
  }

  window.addEventListener('hashchange', () => select(idFromHash(), { source: 'hash', updateHash: false }));

  $('#panel-close').addEventListener('click', () => select(null));

  // ---------- Tooltip ----------

  function showTooltip(id, e) {
    if (!id || !e || e.pointerType === 'touch') {
      tooltip.hidden = true;
      return;
    }
    const n = byId.get(id);
    if (tooltip.dataset.id !== id) {
      tooltip.dataset.id = id;
      const summary = n.summary.length > 150 ? `${n.summary.slice(0, 147).trimEnd()}…` : n.summary;
      tooltip.replaceChildren(
        el('div', { class: `tt-head cat-${n.category}` }, swatch(n), n.label),
        el('div', { class: 'tt-cat' }, [categories.get(n.category).label, n.era].filter(Boolean).join(' · ')),
        el('p', {}, summary),
      );
    }
    tooltip.hidden = false;
    const pad = 14;
    const { offsetWidth: w, offsetHeight: h } = tooltip;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${Math.max(8, y)}px`;
  }

  // ---------- Legend & filters ----------

  const filterable = data.categories.filter((c) => c.id !== 'core');
  const counts = {};
  for (const n of data.nodes) counts[n.category] = (counts[n.category] || 0) + 1;

  const legendList = $('#legend-categories');
  for (const c of filterable) {
    legendList.append(
      el('li', {},
        el('button', {
          type: 'button',
          class: `cat-${c.id}`,
          'aria-pressed': 'true',
          'data-cat': c.id,
          title: c.description,
          onclick: () => {
            if (state.hidden.has(c.id)) state.hidden.delete(c.id);
            else state.hidden.add(c.id);
            applyFilters();
          },
        }, el('span', { class: 'swatch', 'aria-hidden': 'true' }), c.label, el('span', { class: 'count' }, counts[c.id] || 0)),
      ),
    );
  }

  const RELATION_LEGEND = [
    ['includes', 'Includes', 'M0 5h30', ''],
    ['drives', 'Drives / leads to', 'M0 5h26', 'arrow'],
    ['instance', 'Example of', 'M0 5h30', '5 4'],
    ['challenges', 'Challenges', 'M0 5h30', '8 3 2 3'],
    ['proposed', 'Proposed by', 'M0 5h30', '1 4'],
    ['related', 'Related', 'M0 5h30', ''],
  ];
  const relList = $('#legend-relations');
  for (const [type, label, d] of RELATION_LEGEND) {
    const sample = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sample.setAttribute('viewBox', '0 0 30 10');
    sample.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', `link t-${type}`);
    sample.append(path);
    relList.append(el('li', {}, sample, label));
  }

  function applyFilters() {
    for (const b of legendList.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', state.hidden.has(b.dataset.cat) ? 'false' : 'true');
    }
    map.setHidden(state.hidden);
    timeline.setHidden(state.hidden);
    if (state.selected && state.hidden.has(byId.get(state.selected).category)) select(null);
  }

  const legendToggle = $('#legend-toggle');
  const legendBody = $('#legend-body');
  const setLegendOpen = (open) => {
    legendToggle.setAttribute('aria-expanded', String(open));
    legendBody.hidden = !open;
    map.setInsets(overlayInsets());
  };
  legendToggle.addEventListener('click', () => setLegendOpen(legendBody.hidden));
  setLegendOpen(!isNarrow() && window.innerHeight > 700);

  // ---------- Index drawer ----------

  const indexList = $('#index-list');
  for (const c of data.categories) {
    const items = data.nodes
      .filter((n) => n.category === c.id)
      .sort((a, b) => (b.kind === 'hub') - (a.kind === 'hub') || a.label.localeCompare(b.label));
    indexList.append(
      el('h3', { class: `cat-${c.id}` }, el('span', { class: 'swatch', 'aria-hidden': 'true' }), c.label),
      el('ul', {},
        items.map((n) =>
          el('li', {},
            el('button', {
              type: 'button',
              class: `cat-${n.category}${n.kind === 'hub' || n.kind === 'core' ? ' is-hub' : ''}`,
              'data-id': n.id,
              onclick: () => {
                select(n.id, { source: 'index' });
                if (isNarrow()) setDrawerOpen(false);
              },
            }, n.label),
          ),
        ),
      ),
    );
  }

  const indexBtn = $('#btn-index');
  function setDrawerOpen(open) {
    drawer.hidden = !open;
    indexBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      $('#welcome').hidden = true;
      drawer.focus();
    }
  }
  indexBtn.addEventListener('click', () => setDrawerOpen(drawer.hidden));
  $('#index-close').addEventListener('click', () => setDrawerOpen(false));
  document.querySelector('.skip-link').addEventListener('click', (e) => {
    e.preventDefault();
    setDrawerOpen(true);
  });

  // ---------- Search ----------

  const searchIndex = buildSearchIndex(data.nodes);
  const input = $('#search');
  const results = $('#search-results');
  let resultIds = [];
  let active = -1;

  function renderResults() {
    const q = input.value;
    const hits = q.trim() ? search(searchIndex, q, 8) : [];
    resultIds = hits.map((h) => h.node.id);
    active = hits.length ? 0 : -1;
    results.replaceChildren();
    if (!q.trim()) {
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    if (!hits.length) {
      results.append(el('li', { class: 'r-empty', role: 'option', 'aria-disabled': 'true' }, 'No concepts or words match.'));
    }
    hits.forEach((h, i) => {
      const n = h.node;
      results.append(
        el('li', {
          id: `result-${i}`,
          role: 'option',
          class: `cat-${n.category}`,
          'aria-selected': String(i === active),
          onpointerdown: (e) => {
            e.preventDefault();
            choose(i);
          },
        },
        swatch(n),
        el('span', { class: 'r-label' }, n.label),
        el('span', { class: 'r-meta' },
          h.via ? [`${categories.get(n.category).label} · `, el('em', {}, h.via)] : categories.get(n.category).label),
        ),
      );
    });
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', active >= 0 ? `result-${active}` : '');
  }

  function moveActive(delta) {
    if (!resultIds.length) return;
    active = (active + delta + resultIds.length) % resultIds.length;
    [...results.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    input.setAttribute('aria-activedescendant', `result-${active}`);
    results.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const id = resultIds[i];
    if (!id) return;
    closeResults();
    input.blur();
    select(id, { source: 'search' });
  }

  function closeResults() {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }

  input.addEventListener('input', renderResults);
  input.addEventListener('focus', () => input.value.trim() && renderResults());
  input.addEventListener('blur', () => setTimeout(closeResults, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(Math.max(0, active)); }
    else if (e.key === 'Escape') {
      if (!results.hidden) closeResults();
      else { input.value = ''; input.blur(); }
      e.stopPropagation();
    }
  });

  // ---------- Tour ----------

  const tourCard = $('#tour-card');
  let legendWasOpen = null;
  function goTour(i) {
    if (i < 0 || i >= data.tour.length) return endTour();
    if (state.tourIndex < 0) {
      // Fold the legend away for the tour so it doesn't crowd the tour card.
      legendWasOpen = !legendBody.hidden;
      setLegendOpen(false);
    }
    state.tourIndex = i;
    const step = data.tour[i];
    $('#welcome').hidden = true;
    setDrawerOpen(false);
    tourCard.hidden = false;
    $('#tour-step').textContent = `Step ${i + 1} of ${data.tour.length}`;
    $('#tour-bar-fill').style.width = `${((i + 1) / data.tour.length) * 100}%`;
    $('#tour-text').textContent = step.text;
    $('#tour-prev').disabled = i === 0;
    $('#tour-next').textContent = i === data.tour.length - 1 ? 'Finish' : 'Next';
    select(step.node, { source: 'tour' });
    map.setPulse(step.node);
  }
  function endTour() {
    if (state.tourIndex < 0) return;
    state.tourIndex = -1;
    tourCard.hidden = true;
    map.setPulse(null);
    if (legendWasOpen) setLegendOpen(true);
    map.setInsets(overlayInsets());
  }
  $('#btn-tour').addEventListener('click', () => goTour(0));
  $('#tour-prev').addEventListener('click', () => goTour(state.tourIndex - 1));
  $('#tour-next').addEventListener('click', () => goTour(state.tourIndex + 1));
  $('#tour-exit').addEventListener('click', endTour);

  // ---------- Welcome ----------

  const welcome = $('#welcome');
  const dismissWelcome = () => {
    welcome.hidden = true;
    store.set(STORAGE.welcomed, '1');
  };
  $('#welcome-close').addEventListener('click', dismissWelcome);
  $('#welcome-tour').addEventListener('click', () => {
    dismissWelcome();
    goTour(0);
  });

  // ---------- Timeline toggle ----------

  const timelineEl = $('#timeline');
  const timelineBtn = $('#btn-timeline');
  const setTimeline = (open) => {
    timelineEl.hidden = !open;
    timelineBtn.setAttribute('aria-pressed', String(open));
  };
  timelineBtn.addEventListener('click', () => setTimeline(timelineEl.hidden));
  setTimeline(!isNarrow() && window.innerHeight >= 760);

  // ---------- Theme ----------

  const themeBtn = $('#btn-theme');
  const currentTheme = () =>
    document.documentElement.dataset.theme ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const syncThemeButton = () => {
    const dark = currentTheme() === 'dark';
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    themeBtn.title = themeBtn.getAttribute('aria-label');
    document.documentElement.dataset.theme = currentTheme();
  };
  themeBtn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set(STORAGE.theme, next);
    syncThemeButton();
  });
  if (!store.get(STORAGE.theme)) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      delete document.documentElement.dataset.theme;
      syncThemeButton();
    });
  }
  syncThemeButton();

  // ---------- Zoom controls & keyboard ----------

  $('#zoom-in').addEventListener('click', () => map.zoomBy(1.4));
  $('#zoom-out').addEventListener('click', () => map.zoomBy(1 / 1.4));
  $('#zoom-fit').addEventListener('click', () => map.fit());

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (!welcome.hidden) dismissWelcome();
      else if (state.tourIndex >= 0) endTour();
      else if (!drawer.hidden) setDrawerOpen(false);
      else if (state.selected) select(null);
      return;
    }
    if (isTyping(e)) return;
    if (e.key === '/') {
      e.preventDefault();
      input.focus();
      input.select();
    } else if (e.key === '+' || e.key === '=') map.zoomBy(1.4);
    else if (e.key === '-' || e.key === '_') map.zoomBy(1 / 1.4);
    else if (e.key === '0') map.fit();
    else if (state.tourIndex >= 0 && e.key === 'ArrowRight') goTour(state.tourIndex + 1);
    else if (state.tourIndex >= 0 && e.key === 'ArrowLeft') goTour(state.tourIndex - 1);
  });

  window.addEventListener('resize', () => {
    map.setInsets(overlayInsets());
    tooltip.hidden = true;
  });

  // ---------- Initial state ----------

  map.setInsets(overlayInsets());
  const initial = idFromHash();
  if (initial) {
    select(initial, { source: 'hash', updateHash: false });
  } else {
    map.fit({ animate: false });
    if (!store.get(STORAGE.welcomed)) welcome.hidden = false;
  }

  // Exposed for debugging and automated checks.
  window.langMap = { map, select, data };
}

main().catch((err) => {
  console.error(err);
  const loading = document.getElementById('loading');
  loading.hidden = false;
  loading.textContent = `Sorry, the map failed to load: ${err.message}`;
});
