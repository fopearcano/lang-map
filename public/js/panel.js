import { el, swatch, prefersReducedMotion } from './dom.js';

const GROUP_ORDER = [
  'Part of', 'Includes', 'Proposed by', 'Driven by', 'Drives', 'Example of', 'Examples',
  'Challenges', 'Challenged by', 'Related', 'Proposed or described',
];

const KIND_LABEL = { core: 'Core idea', hub: 'Overview', concept: 'Concept', person: 'Person' };

/**
 * Renders the detail view for one node. `ctx` carries lookups and the
 * navigation callback; returns a cleanup function (stops journey playback).
 */
export function renderPanel(container, node, ctx) {
  const { byId, categories, relations, links, onNavigate } = ctx;
  const cat = categories.get(node.category);
  const cleanups = [];

  container.replaceChildren();
  container.scrollTop = 0;
  container.className = `panel-scroll cat-${node.category}`;

  container.append(
    el('div', { class: 'eyebrow' }, swatch(node), `${cat.label} · ${KIND_LABEL[node.kind]}`),
    el('h2', { id: 'panel-title', tabindex: '-1' }, node.label),
    node.era ? el('div', { class: 'era' }, node.era) : null,
    el('p', { class: 'summary' }, node.summary),
    node.body ? el('p', { class: 'body' }, node.body) : null,
  );

  if (node.quote) {
    container.append(
      el('blockquote', { class: 'quote' }, el('p', {}, `“${node.quote.text}”`), el('cite', {}, `— ${node.quote.source}`)),
    );
  }

  if (node.journey) {
    const { section, stop } = journeySection(node.journey);
    container.append(section);
    cleanups.push(stop);
  }

  if (node.examples && node.examples.length) {
    container.append(
      el('section', { class: 'section' },
        el('h3', {}, 'Examples'),
        el('ul', { class: 'examples' },
          node.examples.map((ex) =>
            el('li', {},
              el('div', { class: 'ex-pair' }, el('span', {}, ex.from), el('span', { class: 'ex-arrow', 'aria-label': 'became' }, '→'), el('span', {}, ex.to)),
              ex.note ? el('div', { class: 'ex-note' }, ex.note) : null,
            ),
          ),
        ),
      ),
    );
  }

  const groups = new Map();
  const add = (label, id) => {
    if (!groups.has(label)) groups.set(label, []);
    if (!groups.get(label).includes(id)) groups.get(label).push(id);
  };
  for (const l of links) {
    if (l.source === node.id) add(relations[l.type].out, l.target);
    else if (l.target === node.id) add(relations[l.type].in, l.source);
  }
  const ordered = [...groups.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]));

  if (ordered.length) {
    container.append(
      el('section', { class: 'section' },
        el('h3', {}, 'Connections'),
        el('div', { class: 'connections' },
          ordered.map(([label, ids]) =>
            el('div', { class: 'conn-group' },
              el('h4', {}, label),
              el('div', { class: 'chips' },
                ids.map((id) => {
                  const other = byId.get(id);
                  return el('button', {
                    class: `chip cat-${other.category}`,
                    type: 'button',
                    onclick: () => onNavigate(id),
                  }, swatch(other), other.label);
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  const total = ordered.reduce((sum, [, ids]) => sum + ids.length, 0);
  container.append(el('div', { class: 'panel-foot' }, `${total} connection${total === 1 ? '' : 's'} · link to this concept: #/${node.id}`));

  return () => cleanups.forEach((fn) => fn());
}

function journeySection(journey) {
  const steps = journey.steps.map((s) =>
    el('li', { class: 'journey-step' },
      el('span', { class: 'journey-dot', 'aria-hidden': 'true' }),
      el('div', {},
        el('div', { class: 'journey-meta' }, [s.stage, s.date].filter(Boolean).join(' · ')),
        el('div', { class: 'journey-form' }, s.form),
        s.gloss ? el('div', { class: 'journey-gloss' }, s.gloss) : null,
      ),
    ),
  );
  const track = el('span', { class: 'journey-track', 'aria-hidden': 'true' });
  const rail = el('span', { class: 'journey-rail', 'aria-hidden': 'true' });
  const list = el('ol', { class: 'journey-steps' }, track, rail, steps);

  const playBtn = el('button', { class: 'btn', type: 'button' }, playIcon(), 'Play');
  const prevBtn = el('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Previous stage' }, chevron('left'));
  const nextBtn = el('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Next stage' }, chevron('right'));
  const status = el('span', { class: 'sr-only', 'aria-live': 'polite' });

  const box = el('div', { class: 'journey' },
    el('div', { class: 'journey-title' }, journey.title),
    list,
  );

  const section = el('section', { class: 'section' },
    el('h3', {}, 'Word journey', el('span', { class: 'journey-controls' }, prevBtn, playBtn, nextBtn)),
    box,
    status,
  );

  let index = -1;
  let timer = null;

  const dotCenter = (i) => steps[i].offsetTop + 11;

  const layoutTrack = () => {
    if (!steps.length) return;
    const top = dotCenter(0);
    track.style.top = `${top}px`;
    track.style.height = `${dotCenter(steps.length - 1) - top}px`;
    rail.style.top = `${top}px`;
    rail.style.height = index < 0 ? '0px' : `${dotCenter(index) - top}px`;
  };

  const show = (i) => {
    index = i;
    box.classList.toggle('is-playing', i >= 0);
    steps.forEach((s, j) => {
      s.classList.toggle('is-past', i >= 0 && j < i);
      s.classList.toggle('is-current', j === i);
    });
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i >= steps.length - 1;
    if (i >= 0) {
      const s = journey.steps[i];
      status.textContent = `${s.stage}: ${s.form}. ${s.gloss || ''}`;
    }
    layoutTrack();
  };

  const stop = () => {
    clearInterval(timer);
    timer = null;
    playBtn.replaceChildren(playIcon(), index >= steps.length - 1 ? 'Replay' : 'Play');
  };

  const play = () => {
    if (timer) return stop();
    if (index >= steps.length - 1 || index < 0) show(0);
    else show(index + 1);
    if (prefersReducedMotion()) return stop();
    playBtn.replaceChildren(pauseIcon(), 'Pause');
    timer = setInterval(() => {
      if (index >= steps.length - 1) return stop();
      show(index + 1);
      if (index >= steps.length - 1) stop();
    }, 1500);
  };

  playBtn.addEventListener('click', play);
  prevBtn.addEventListener('click', () => { stop(); show(Math.max(0, index - 1)); });
  nextBtn.addEventListener('click', () => { stop(); show(Math.min(steps.length - 1, index + 1)); });

  prevBtn.disabled = true;
  requestAnimationFrame(layoutTrack);

  return { section, stop };
}

function icon(d, filled) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  if (filled) {
    svg.style.fill = 'currentColor';
    svg.style.stroke = 'none';
  }
  svg.append(path);
  return svg;
}
const playIcon = () => icon('M6 4.5v11l9-5.5z', true);
const pauseIcon = () => icon('M6 4h3v12H6zM11 4h3v12h-3z', true);
const chevron = (dir) => icon(dir === 'left' ? 'm12 5-5 5 5 5' : 'm8 5 5 5-5 5');
