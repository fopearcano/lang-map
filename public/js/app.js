import { ConceptSection } from './concept-section.js';
import { WorldSection } from './world-section.js';
import { Bibliography } from './bibliography.js';
import { Tooltip } from './tooltip.js';
import { buildSearchIndex, buildLanguageEntries, search } from './search.js';
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

const isTyping = (e) => e.target.closest('input, textarea, select, [contenteditable="true"]');
const isControl = (e) => e.target.closest('button, a[href], [role="slider"], [role="menuitem"]');

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.json();
}

class App {
  constructor(data) {
    this.data = data;
    this.tooltip = new Tooltip($('#tooltip'));
    this.conceptById = new Map(data.map.nodes.map((n) => [n.id, n]));
    this.languageById = new Map(data.languages.languages.map((l) => [l.id, l]));
    this.sourcesById = new Map(data.sources.sources.map((s) => [s.id, s]));
    this.categories = new Map(data.map.categories.map((c) => [c.id, c]));
    this.families = new Map(data.languages.families.map((f) => [f.id, f]));
    this.timelineOpen = !this.isNarrow() && window.innerHeight >= 760;
    this.route = { section: 'concepts', id: null };
    this.sections = {};
    this.active = null;

    // Reverse indexes: which languages illustrate a concept, and which
    // concepts and languages cite each source.
    this.languagesByConcept = new Map();
    for (const l of data.languages.languages) {
      for (const c of l.concepts || []) {
        if (!this.languagesByConcept.has(c)) this.languagesByConcept.set(c, []);
        this.languagesByConcept.get(c).push(l);
      }
    }
    this.citedBy = new Map();
    const cite = (sid, item) => {
      if (!this.citedBy.has(sid)) this.citedBy.set(sid, []);
      this.citedBy.get(sid).push(item);
    };
    for (const n of data.map.nodes) {
      for (const s of n.sources || []) cite(s, { kind: 'concept', id: n.id, label: n.label, cls: `cat-${n.category}` });
    }
    for (const l of data.languages.languages) {
      for (const s of l.sources || []) cite(s, { kind: 'language', id: l.id, label: l.name, cls: `fam-${l.family}` });
    }

    this.bibliography = new Bibliography(data.sources, this.citedBy, {
      onNavigate: (item) => {
        this.bibliography.close({ silent: true });
        this.go(item.kind === 'concept' ? { section: 'concepts', id: item.id } : { section: 'world', id: item.id }, { replace: true });
      },
      onClose: () => this.closeSources(),
    });
    $('#help-sources-count').textContent = `${data.sources.sources.length} references, with links`;

    this.sections.concepts = new ConceptSection(this);
    this.searchIndex = [
      ...buildSearchIndex(data.map.nodes),
      ...buildLanguageEntries(data.languages.languages, data.languages.families),
    ];

    this.bindTabs();
    this.bindSearch();
    this.bindHelp();
    this.bindDrawer();
    this.bindTimeline();
    this.bindTheme();
    this.bindWelcome();
    this.bindKeys();

    window.addEventListener('hashchange', () => this.applyRoute(this.parseHash()));
    window.addEventListener('resize', () => {
      this.tooltip.hide();
      this.active?.onResize();
    });

    $('#loading').hidden = true;
    const initial = this.parseHash();
    this.applyRoute(initial);
    if (!location.hash && !store.get(STORAGE.welcomed)) this.showWelcome();
  }

  isNarrow() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  languagesForConcept(id) {
    return this.languagesByConcept.get(id) || [];
  }

  // ---------- Routing ----------
  //   #/                 concept map
  //   #/<concept-id>     concept map with a concept selected
  //   #/world            world map
  //   #/world/<lang-id>  world map with a language selected
  //   #/sources[/<id>]   bibliography, over whichever section is open

  parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'sources') return { ...this.route, sources: true, sourceId: parts[1] || null };
    if (parts[0] === 'world') return { section: 'world', id: this.languageById.has(parts[1]) ? parts[1] : null };
    return { section: 'concepts', id: this.conceptById.has(parts[0]) ? parts[0] : null };
  }

  hashFor(route) {
    if (route.sources) return `#/sources${route.sourceId ? `/${route.sourceId}` : ''}`;
    if (route.section === 'world') return `#/world${route.id ? `/${route.id}` : ''}`;
    return route.id ? `#/${route.id}` : '#/';
  }

  /** Navigate, adding a history entry (unless `replace`). */
  go(route, { replace = false } = {}) {
    const hash = this.hashFor(route);
    if (replace || hash === location.hash) {
      history.replaceState(null, '', hash);
      this.applyRoute(route);
    } else {
      location.hash = hash; // fires hashchange → applyRoute
    }
  }

  /** Record the current state in the URL without re-applying it. */
  setRoute(route, { replace = true } = {}) {
    this.route = { section: route.section, id: route.id };
    const hash = this.hashFor(route);
    if (hash === location.hash) return;
    if (replace) history.replaceState(null, '', hash);
    else history.pushState(null, '', hash);
  }

  applyRoute(route) {
    if (route.sources) {
      if (!this.active) this.showSection(route.section || 'concepts');
      this.bibliography.open(route.sourceId);
      return;
    }
    if (this.bibliography.isOpen) this.bibliography.close({ silent: true });
    this.showSection(route.section);
    this.route = { section: route.section, id: route.id };
    const section = this.active;
    const current = route.section === 'world' ? section.selected : section.state.selected;
    if (route.id !== current) section.select(route.id, { source: 'hash', updateHash: false });
  }

  section(name) {
    if (name === 'world' && !this.sections.world) this.sections.world = new WorldSection(this);
    return this.sections[name];
  }

  showSection(name) {
    const next = this.section(name);
    if (this.active === next) return;
    this.tooltip.hide();
    // Hide every other section (on first load none is "active" yet).
    for (const section of Object.values(this.sections)) if (section !== next) section.deactivate();
    this.active = next;
    this.activeName = name;
    document.body.dataset.section = name;
    for (const tab of document.querySelectorAll('.section-tab')) {
      const on = tab.id === `tab-${name}`;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    next.activate();
    if (!next.shownOnce) {
      next.shownOnce = true;
      next.fitIfFresh();
    }
    if (!$('#index-drawer').hidden) this.fillDrawer();
  }

  openSources(id) {
    this.sourcesReturn = location.hash;
    this.go({ sources: true, sourceId: id || null });
  }

  closeSources() {
    // Return to where the reader was; fall back to the open section.
    if (this.sourcesReturn != null) {
      const back = this.sourcesReturn;
      this.sourcesReturn = null;
      history.replaceState(null, '', back || '#/');
    } else {
      history.replaceState(null, '', this.hashFor(this.route));
    }
    this.applyRoute(this.parseHash());
  }

  // ---------- Header: tabs ----------

  bindTabs() {
    const tabs = [...document.querySelectorAll('.section-tab')];
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        const name = tab.id.replace('tab-', '');
        if (name === this.activeName) return;
        const section = this.sections[name];
        const id = section ? (name === 'world' ? section.selected : section.state.selected) : null;
        this.go({ section: name, id });
      });
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        next.click();
      });
    }
  }

  // ---------- Header: search ----------

  bindSearch() {
    const input = $('#search');
    const results = $('#search-results');
    let hits = [];
    let active = -1;

    const close = () => {
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    };
    const choose = (i) => {
      const hit = hits[i];
      if (!hit) return;
      close();
      input.blur();
      if (hit.node.type === 'language') this.go({ section: 'world', id: hit.node.id });
      else this.go({ section: 'concepts', id: hit.node.id });
    };
    const render = () => {
      const q = input.value;
      hits = q.trim() ? search(this.searchIndex, q, 9) : [];
      active = hits.length ? 0 : -1;
      results.replaceChildren();
      if (!q.trim()) return close();
      if (!hits.length) {
        results.append(el('li', { class: 'r-empty', role: 'option', 'aria-disabled': 'true' }, 'No concepts, languages or words match.'));
      }
      hits.forEach((h, i) => {
        const n = h.node;
        const isLang = n.type === 'language';
        const kind = isLang
          ? `Language · ${n.branch || this.families.get(n.family).label}`
          : this.categories.get(n.category).label;
        results.append(
          el('li', {
            id: `result-${i}`, role: 'option', class: isLang ? `fam-${n.family}` : `cat-${n.category}`,
            'aria-selected': String(i === active),
            onpointerdown: (e) => {
              e.preventDefault();
              choose(i);
            },
          },
          isLang ? el('span', { class: 'swatch is-lang', 'aria-hidden': 'true' }) : swatch(n),
          el('span', { class: 'r-label' }, n.label),
          el('span', { class: 'r-meta' }, h.via ? [`${kind} · `, el('em', {}, h.via)] : kind),
          ),
        );
      });
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-activedescendant', active >= 0 ? `result-${active}` : '');
    };
    const move = (delta) => {
      if (!hits.length) return;
      active = (active + delta + hits.length) % hits.length;
      [...results.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
      input.setAttribute('aria-activedescendant', `result-${active}`);
      results.children[active]?.scrollIntoView({ block: 'nearest' });
    };

    input.addEventListener('input', render);
    input.addEventListener('focus', () => input.value.trim() && render());
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(Math.max(0, active)); }
      else if (e.key === 'Escape') {
        if (!results.hidden) close();
        else { input.value = ''; input.blur(); }
        e.stopPropagation();
      }
    });
    this.searchInput = input;
  }

  // ---------- Header: Help menu ----------

  bindHelp() {
    const btn = $('#btn-help');
    const menu = $('#help-menu');
    const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
    const open = (focusFirst) => {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      if (focusFirst) items()[0].focus();
    };
    const close = (refocus) => {
      if (menu.hidden) return;
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (refocus) btn.focus();
    };
    this.closeHelpMenu = close;

    btn.addEventListener('click', () => (menu.hidden ? open(false) : close()));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(true);
      }
    });
    menu.addEventListener('keydown', (e) => {
      const list = items();
      const i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') close();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.menu-wrap')) close();
    });
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-action]');
      if (!item) return;
      close();
      const action = item.dataset.action;
      if (action === 'tour') this.startTour();
      else if (action === 'howto') this.showWelcome();
      else if (action === 'sources') this.openSources(null);
    });
  }

  startTour() {
    this.hideWelcome();
    // Switch synchronously (replace) so the tour never starts in a hidden section.
    if (this.activeName !== 'concepts') this.go({ section: 'concepts', id: null }, { replace: true });
    this.sections.concepts.startTour();
  }

  // ---------- Index drawer ----------

  bindDrawer() {
    $('#btn-index').addEventListener('click', () => this.setDrawerOpen($('#index-drawer').hidden));
    $('#index-close').addEventListener('click', () => this.setDrawerOpen(false));
    document.querySelector('.skip-link').addEventListener('click', (e) => {
      e.preventDefault();
      this.setDrawerOpen(true);
    });
  }

  fillDrawer() {
    const list = $('#index-list');
    list.replaceChildren();
    $('#index-title').textContent = this.activeName === 'world' ? 'Language index' : 'Concept index';
    this.active.buildIndex(list);
  }

  setDrawerOpen(open) {
    const drawer = $('#index-drawer');
    if (open) {
      this.fillDrawer();
      this.hideWelcome();
    }
    drawer.hidden = !open;
    $('#btn-index').setAttribute('aria-expanded', String(open));
    if (open) drawer.focus();
  }

  markIndexCurrent(id) {
    for (const b of document.querySelectorAll('#index-list [data-id]')) {
      b.setAttribute('aria-current', String(b.dataset.id === id));
    }
  }

  // ---------- Timeline, theme, welcome ----------

  bindTimeline() {
    const btn = $('#btn-timeline');
    const sync = () => {
      btn.setAttribute('aria-pressed', String(this.timelineOpen));
      if (this.activeName === 'concepts') $('#timeline').hidden = !this.timelineOpen;
    };
    btn.addEventListener('click', () => {
      this.timelineOpen = !this.timelineOpen;
      sync();
    });
    sync();
  }

  bindTheme() {
    const btn = $('#btn-theme');
    const current = () =>
      document.documentElement.dataset.theme ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const sync = () => {
      const dark = current() === 'dark';
      btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      btn.title = btn.getAttribute('aria-label');
      document.documentElement.dataset.theme = current();
    };
    btn.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      store.set(STORAGE.theme, next);
      sync();
    });
    if (!store.get(STORAGE.theme)) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        delete document.documentElement.dataset.theme;
        sync();
      });
    }
    sync();
  }

  bindWelcome() {
    $('#welcome-close').addEventListener('click', () => this.hideWelcome());
    $('#welcome-tour').addEventListener('click', () => this.startTour());
    $('#welcome-world').addEventListener('click', () => {
      this.hideWelcome();
      this.go({ section: 'world', id: null });
    });
  }

  showWelcome() {
    $('#welcome').hidden = false;
    $('#welcome-tour').focus({ preventScroll: true });
  }

  hideWelcome() {
    const welcome = $('#welcome');
    if (welcome.hidden) return;
    welcome.hidden = true;
    store.set(STORAGE.welcomed, '1');
  }

  // ---------- Keyboard ----------

  bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (this.bibliography.isOpen) return; // the dialog handles its own keys
      if (e.key === 'Escape') {
        if (!$('#help-menu').hidden) this.closeHelpMenu(true);
        else if (!$('#welcome').hidden) this.hideWelcome();
        else if (!$('#index-drawer').hidden) this.setDrawerOpen(false);
        else this.active.handleEscape();
        return;
      }
      if (isTyping(e)) return;
      if (e.key === '/') {
        e.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
        return;
      }
      if (isControl(e) && (e.key === ' ' || e.key === 'Enter' || e.key.startsWith('Arrow'))) return;
      if (e.key === '+' || e.key === '=') this.active.zoomIn();
      else if (e.key === '-' || e.key === '_') this.active.zoomOut();
      else if (e.key === '0') this.active.fit();
      else this.active.handleKey(e);
    });
  }
}

async function main() {
  const [map, sources, languages, land] = await Promise.all([
    fetchJson('api/map'),
    fetchJson('api/sources'),
    fetchJson('api/languages'),
    fetchJson('data/land.json'),
  ]);
  // Let the loading message paint before the (synchronous) layout runs.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const app = new App({ map, sources, languages, land });
  // Exposed for debugging and automated checks.
  window.langMap = app;
}

main().catch((err) => {
  console.error(err);
  const loading = document.getElementById('loading');
  loading.hidden = false;
  loading.textContent = `Sorry, the page failed to load: ${err.message}`;
});
