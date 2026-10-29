import { el } from './dom.js';

// ---------- Formatting ----------

function givenFirst(name) {
  const i = name.indexOf(', ');
  return i === -1 ? name : `${name.slice(i + 2)} ${name.slice(0, i)}`;
}

/** "Sapir, Edward", or "Labov, William, Malcah Yaeger & Richard Steiner". */
export function nameList(names, { max = 6 } = {}) {
  if (!names || !names.length) return '';
  if (names.length > max) return `${names[0]} et al.`;
  const [first, ...rest] = names;
  const all = [first, ...rest.map(givenFirst)];
  return all.length === 1 ? all[0] : `${all.slice(0, -1).join(', ')} & ${all[all.length - 1]}`;
}

const family = (name) => (name.includes(', ') ? name.slice(0, name.indexOf(', ')) : name);

/** Short in-text form: "Sapir 1921", "Gray & Atkinson 2003", "Lieberman et al. 2007". */
export function shortCite(s) {
  const people = s.authors && s.authors.length ? s.authors : s.editors || [];
  let who = people.length === 1 ? family(people[0])
    : people.length === 2 ? `${family(people[0])} & ${family(people[1])}`
    : `${family(people[0])} et al.`;
  if (!(s.authors && s.authors.length)) who += people.length > 1 ? ' (eds.)' : ' (ed.)';
  return `${who} ${s.year ?? 'online'}`;
}

/** Sort key: first surname without lowercase particles ("de Vaan" → "Vaan"). */
export function sortKey(s) {
  const people = s.authors && s.authors.length ? s.authors : s.editors || [];
  const surname = family(people[0] || s.title).replace(/^(?:[a-z]+\s)+/, '');
  return `${surname.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()} ${s.year ?? 9999}`;
}

export const sourceUrl = (s) => (s.doi ? `https://doi.org/${s.doi}` : s.url || null);

// Adds a full stop unless the text already ends in one (or in ? or !).
const stop = (text) => (/[.?!]$/.test(text) ? text : `${text}.`);

/** Full citation (Unified Style Sheet for Linguistics, lightly adapted). */
export function citation(s) {
  const parts = [];
  const authors = s.authors && s.authors.length;
  const lead = authors
    ? nameList(s.authors)
    : `${nameList(s.editors)} (${s.editors.length > 1 ? 'eds.' : 'ed.'})`;
  parts.push(`${stop(lead)} ${s.year ?? 'n.d.'}. `);
  const edition = s.edition ? ` ${s.edition} edn.` : '';
  const place = [s.place, s.publisher].filter(Boolean).join(': ');

  if (s.type === 'article' || s.type === 'newspaper') {
    parts.push(`${stop(s.title)} `, el('em', {}, s.journal));
    if (s.volume) parts.push(` ${s.volume}${s.issue ? `(${s.issue})` : ''}`);
    if (s.date) parts.push(`, ${s.date}`);
    if (s.pages) parts.push(`. ${s.pages}`);
    parts.push('.');
  } else if (s.type === 'chapter') {
    parts.push(`${stop(s.title)} In `);
    if (s.editors && s.editors.length) {
      parts.push(`${s.editors.map(givenFirst).join(' & ')} (${s.editors.length > 1 ? 'eds.' : 'ed.'}), `);
    }
    parts.push(el('em', {}, s.booktitle), s.pages ? `, ${s.pages}. ` : '. ', place ? `${place}.` : '');
  } else {
    parts.push(el('em', {}, s.title), /[.?!]$/.test(s.title) ? '' : '.', edition);
    if (s.series) parts.push(` (${s.series}).`);
    if (s.type === 'book' && authors && s.editors && s.editors.length) {
      parts.push(` Ed. by ${s.editors.map(givenFirst).join(' & ')}.`);
    }
    if (place) parts.push(` ${place}.`);
  }
  return parts;
}

function linkFor(s) {
  const url = sourceUrl(s);
  if (!url) return null;
  return el('a', { class: 'src-link', href: url, target: '_blank', rel: 'noopener noreferrer' },
    s.doi ? `doi:${s.doi}` : url.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, ''),
    el('span', { 'aria-hidden': 'true' }, ' ↗'),
  );
}

/**
 * The "Sources" block shown at the bottom of a concept or language panel.
 * `onOpen(id)` opens the entry in the full bibliography.
 */
export function sourcesSection(ids, { byId, onOpen }) {
  const items = (ids || []).map((id) => byId.get(id)).filter(Boolean);
  if (!items.length) return null;
  return el('section', { class: 'section' },
    el('h3', {}, 'Sources'),
    el('ol', { class: 'src-list' },
      items.map((s) =>
        el('li', {},
          el('button', { class: 'src-cite', type: 'button', onclick: () => onOpen(s.id), title: 'Show in the bibliography' },
            el('strong', {}, shortCite(s)), ' ', el('span', {}, s.title)),
          linkFor(s),
        ),
      ),
    ),
  );
}

// ---------- Full bibliography dialog ----------

export class Bibliography {
  /**
   * @param {object} doc     data/sources.json
   * @param {Map} citedBy    source id → [{ kind, id, label, cls }]
   * @param {function} onNavigate (item) → void, for "cited for" chips
   */
  constructor(doc, citedBy, { onNavigate, onClose }) {
    this.doc = doc;
    this.citedBy = citedBy;
    this.onNavigate = onNavigate;
    this.onClose = onClose;
    this.root = document.getElementById('bibliography');
    this.body = document.getElementById('bib-body');
    this.filter = document.getElementById('bib-filter');
    this.topicBox = document.getElementById('bib-topics');
    this.topic = 'all';
    this.sources = [...doc.sources].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    this.entries = new Map();
    this.built = false;

    const concepts = new Set();
    const languages = new Set();
    for (const list of citedBy.values()) {
      for (const c of list) (c.kind === 'concept' ? concepts : languages).add(c.id);
    }
    document.getElementById('bib-sub').textContent =
      `${this.sources.length} references behind ${concepts.size} concepts and ${languages.size} languages. ` +
      'Dates and figures follow these works; where scholars disagree, the text says so.';

    document.getElementById('bib-close').addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (e) => this.trapKeys(e));
    this.filter.addEventListener('input', () => this.applyFilter());
  }

  get isOpen() {
    return !this.root.hidden;
  }

  build() {
    if (this.built) return;
    this.built = true;
    const topics = [{ id: 'all', label: 'All' }, ...this.doc.topics];
    for (const t of topics) {
      this.topicBox.append(el('button', {
        type: 'button', class: 'chip topic-chip', 'data-topic': t.id, 'aria-pressed': String(t.id === 'all'),
        onclick: () => {
          this.topic = t.id;
          for (const b of this.topicBox.children) b.setAttribute('aria-pressed', String(b.dataset.topic === t.id));
          this.applyFilter();
        },
      }, t.label));
    }

    const list = el('ol', { class: 'bib-list' });
    for (const s of this.sources) {
      const cited = this.citedBy.get(s.id) || [];
      const chips = cited.map((c) =>
        el('button', { type: 'button', class: `chip ${c.cls}`, onclick: () => this.onNavigate(c) },
          el('span', { class: `swatch${c.kind === 'language' ? ' is-lang' : ''}`, 'aria-hidden': 'true' }), c.label),
      );
      const LIMIT = 8;
      const extra = chips.length > LIMIT ? chips.splice(LIMIT) : [];
      const more = extra.length
        ? el('button', { type: 'button', class: 'chip chip-more', onclick: (e) => {
          e.currentTarget.replaceWith(...extra);
        } }, `+${extra.length} more`)
        : null;
      const item = el('li', { class: 'bib-entry', id: `src-${s.id}`, tabindex: '-1' },
        el('p', { class: 'bib-cite' }, citation(s)),
        s.note ? el('p', { class: 'bib-note' }, s.note) : null,
        el('div', { class: 'bib-meta' },
          linkFor(s),
          el('span', { class: 'bib-topics-inline' }, s.topics.map((t) => this.doc.topics.find((x) => x.id === t)?.label).filter(Boolean).join(' · ')),
        ),
        cited.length ? el('div', { class: 'bib-cited' }, el('span', { class: 'bib-cited-label' }, 'Cited for'), chips, more) : null,
        s.usedFor ? el('div', { class: 'bib-cited' }, el('span', { class: 'bib-cited-label' }, `Used for: ${s.usedFor}`)) : null,
      );
      item.dataset.search = [citation(s).map((p) => (typeof p === 'string' ? p : p.textContent)).join(''), s.note || '']
        .join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      item.dataset.topics = s.topics.join(' ');
      this.entries.set(s.id, item);
      list.append(item);
    }
    this.empty = el('p', { class: 'bib-empty', hidden: true }, 'No references match.');
    this.body.append(list, this.empty);
  }

  applyFilter() {
    const q = this.filter.value.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    let shown = 0;
    for (const item of this.entries.values()) {
      const ok = (!q || item.dataset.search.includes(q)) && (this.topic === 'all' || item.dataset.topics.split(' ').includes(this.topic));
      item.hidden = !ok;
      if (ok) shown++;
    }
    this.empty.hidden = shown > 0;
  }

  open(focusId) {
    this.build();
    this.lastFocus = document.activeElement;
    this.root.hidden = false;
    document.body.classList.add('has-dialog');
    for (const item of this.entries.values()) item.classList.remove('is-target');
    const target = focusId && this.entries.get(focusId);
    if (target) {
      // Make sure the entry isn't filtered out.
      this.filter.value = '';
      this.topic = 'all';
      for (const b of this.topicBox.children) b.setAttribute('aria-pressed', String(b.dataset.topic === 'all'));
      this.applyFilter();
      target.classList.add('is-target');
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: 'center' });
        target.focus({ preventScroll: true });
      });
    } else {
      this.body.scrollTop = 0;
      requestAnimationFrame(() => this.filter.focus());
    }
  }

  close({ silent = false } = {}) {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.body.classList.remove('has-dialog');
    if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus({ preventScroll: true });
    if (!silent && this.onClose) this.onClose();
  }

  trapKeys(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...this.root.querySelectorAll('button, input, a[href], [tabindex="0"]')]
      .filter((n) => !n.hidden && n.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

