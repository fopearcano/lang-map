import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '../server.js';
import { buildSearchIndex, search, normalize } from '../public/js/search.js';
import { Simulation, RING_ORDER } from '../public/js/layout.js';

const map = loadMap();

test('normalize strips diacritics and punctuation', () => {
  assert.equal(normalize('*ph₂tḗr'), 'ph₂ter');
  assert.equal(normalize('Grimm’s Law'), 'grimm s law');
});

test('search finds concepts by label, alias and example word', () => {
  const index = buildSearchIndex(map.nodes);
  assert.equal(search(index, 'grimm')[0].node.id, 'grimms-law');
  assert.equal(search(index, 'GVS')[0].node.id, 'great-vowel-shift');
  const nice = search(index, 'nice')[0];
  assert.equal(nice.node.id, 'amelioration');
  assert.ok(nice.via);
  assert.equal(search(index, 'apron')[0].node.id, 'reanalysis');
  assert.deepEqual(search(index, '   '), []);
});

test('ring order covers every category except the core', () => {
  const cats = map.categories.map((c) => c.id).filter((id) => id !== 'core').sort();
  assert.deepEqual([...RING_ORDER].sort(), cats);
});

test('layout is deterministic, finite and keeps clusters together', () => {
  const run = () => {
    const nodes = map.nodes.map((n) => ({ ...n }));
    new Simulation(nodes, map.links).run(450);
    return nodes;
  };
  const a = run();
  const b = run();
  for (let i = 0; i < a.length; i++) {
    assert.ok(Number.isFinite(a[i].x) && Number.isFinite(a[i].y), `${a[i].id} has a finite position`);
    assert.equal(a[i].x, b[i].x);
  }

  // Each node should sit closer to its own hub than to the average other hub.
  const hubs = a.filter((n) => n.kind === 'hub');
  let misplaced = 0;
  for (const n of a.filter((x) => x.kind === 'concept' || x.kind === 'person')) {
    const own = hubs.filter((h) => h.category === n.category);
    const dOwn = Math.min(...own.map((h) => Math.hypot(h.x - n.x, h.y - n.y)));
    const others = hubs.filter((h) => h.category !== n.category);
    const dOther = others.reduce((s, h) => s + Math.hypot(h.x - n.x, h.y - n.y), 0) / others.length;
    if (dOwn >= dOther) misplaced++;
  }
  assert.equal(misplaced, 0);
});
