import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap, loadData } from '../server.js';
import { validateMap, validateSources, validateLanguages } from '../lib/validate-map.js';

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

test('bibliography, concepts and languages cross-validate', () => {
  const { map: m, sources, languages } = loadData();
  assert.ok(m.nodes.every((n) => n.sources.length > 0));
  assert.ok(sources.sources.length >= 120);
  assert.ok(languages.languages.length >= 100);
});

test('every source is cited somewhere', () => {
  const { map: m, sources, languages } = loadData();
  const cited = new Set([...m.nodes, ...languages.languages].flatMap((x) => x.sources || []));
  // Map-data credits are "used for" the world map rather than cited by an entry.
  const unused = sources.sources.filter((s) => !s.usedFor).map((s) => s.id).filter((id) => !cited.has(id));
  assert.deepEqual(unused, []);
});

test('validators catch bad references', () => {
  const { map: m, sources, languages } = loadData();
  const sourceIds = new Set(sources.sources.map((s) => s.id));
  const brokenMap = structuredClone(m);
  brokenMap.nodes[0].sources = ['no-such-source'];
  assert.ok(validateMap(brokenMap, { sourceIds }).some((e) => e.includes('no-such-source')));

  const brokenSources = structuredClone(sources);
  brokenSources.sources[0].doi = 'not-a-doi';
  assert.ok(validateSources(brokenSources).some((e) => e.includes('DOI')));

  const brokenLangs = structuredClone(languages);
  brokenLangs.languages.find((l) => l.id === 'latin').parent = 'french';
  const errors = validateLanguages(brokenLangs, { sourceIds });
  assert.ok(errors.some((e) => e.includes('starts after its child') || e.includes('loops')));
});

test('the "night" word data is internally consistent', () => {
  const { languages } = loadData();
  for (const l of languages.languages) {
    if (!l.night) continue;
    // Cognacy with PIE *nókʷts only makes sense for Indo-European languages
    // and for creoles whose words came from one.
    if (l.night.cognate !== null) {
      assert.ok(l.family === 'indo-european' || l.relation === 'contact', `${l.id} marks cognacy outside Indo-European`);
    } else {
      assert.notEqual(l.family, 'indo-european', `${l.id} is Indo-European but has no cognacy verdict`);
    }
  }
});
