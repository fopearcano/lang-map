import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '../server.js';
import { validateMap } from '../lib/validate-map.js';

const map = loadMap();

test('concept map passes validation', () => {
  assert.deepEqual(validateMap(map), []);
});

test('every non-core category has an overview hub', () => {
  for (const c of map.categories) {
    if (c.id === 'core') continue;
    assert.ok(
      map.nodes.some((n) => n.category === c.id && n.kind === 'hub'),
      `category ${c.id} has no hub`,
    );
  }
});

test('every node is reachable from the core concept', () => {
  const adj = new Map(map.nodes.map((n) => [n.id, []]));
  for (const l of map.links) {
    adj.get(l.source).push(l.target);
    adj.get(l.target).push(l.source);
  }
  const seen = new Set(['drift']);
  const queue = ['drift'];
  while (queue.length) {
    for (const next of adj.get(queue.shift())) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  assert.equal(seen.size, map.nodes.length);
});

test('validator reports broken references', () => {
  const broken = structuredClone(map);
  broken.links.push({ source: 'drift', target: 'no-such-node', type: 'related' });
  broken.tour.push({ node: 'missing', text: 'x' });
  const errors = validateMap(broken);
  assert.ok(errors.some((e) => e.includes('no-such-node')));
  assert.ok(errors.some((e) => e.includes('missing')));
});
