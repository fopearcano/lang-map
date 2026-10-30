import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectY } from '../public/js/geo.js';
import { AreaGrid, areaSites, assignTints, latOfY, placeRadius, radiusOf, DEFAULT_RADIUS, PROTO_RADIUS } from '../public/js/areas.js';
import { validateLanguages } from '../lib/validate-map.js';

const lang = (id, extra = {}) => ({ id, family: 'other', start: 0, end: null, at: [0, 0], ...extra });

test('latOfY inverts the projection', () => {
  for (const lat of [-55, -20, 0, 12.5, 45, 70, 83]) {
    assert.ok(Math.abs(latOfY(projectY(lat)) - lat) < 1e-6, `lat ${lat}`);
  }
});

test('areaSites follows dates, homeUntil, area: false and grow', () => {
  const langs = [
    lang('a', { start: 100, end: 500 }),
    lang('b', { area: false }),
    lang('c', { homeUntil: 300, places: [{ from: 200, at: [10, 10], label: 'p', area: 400, grow: 100 }, { from: 250, at: [20, 0], label: 'q', area: false }] }),
    lang('d', { kind: 'proto' }),
  ];
  assert.deepEqual(areaSites(langs, 50).map((s) => s.key), ['c', 'd']);
  const at200 = areaSites(langs, 200);
  assert.deepEqual(at200.map((s) => s.key), ['a', 'c', 'c/0/100', 'd']);
  assert.equal(at200.find((s) => s.key === 'd').r, PROTO_RADIUS);
  assert.equal(at200.find((s) => s.key === 'a').r, DEFAULT_RADIUS);
  // After homeUntil only the place remains, grown to full size after `grow` years.
  const at400 = areaSites(langs, 400);
  assert.deepEqual(at400.filter((s) => s.lang === 2).map((s) => s.r), [400]);
  assert.equal(placeRadius({ from: 200, area: 400, grow: 100 }, 250), 250);
  assert.equal(radiusOf({ area: 120 }), 120);
});

test('neighbours split the land; a much smaller language keeps an enclave', () => {
  const grid = new AreaGrid();
  const sites = [
    { lang: 0, key: 'west', lon: 0, lat: 45, r: 400 },
    { lang: 1, key: 'east', lon: 8, lat: 45, r: 400 },
    { lang: 2, key: 'big', lon: 60, lat: 40, r: 1500 },
    { lang: 3, key: 'small', lon: 62, lat: 41, r: 150 },
  ];
  const result = grid.compute(sites);
  const y = projectY(45);
  assert.equal(grid.langAt(-1, y), 0);
  assert.equal(grid.langAt(9, y), 1);
  assert.equal(grid.langAt(30, y), -1, 'no claim beyond the radius');
  assert.equal(grid.langAt(62, projectY(41)), 3, 'the small language keeps its own area');
  assert.equal(grid.langAt(55, projectY(40)), 2);
  for (const i of [0, 1, 2, 3]) {
    const area = result.get(i);
    assert.ok(area && /^M[-\d.]+,[-\d.]+/.test(area.d) && area.d.endsWith('Z'), `path for ${i}`);
    assert.ok(area.cells > 0 && area.parts.length >= 1);
  }
  // Label anchors sit inside their own area.
  for (const [i, area] of result) assert.equal(grid.langAt(area.parts[0].x, area.parts[0].y), i);
  // The big area has a hole for the enclave: two loops in one path.
  assert.ok(result.get(2).d.split('M').length - 1 >= 2);
});

test('an area across the antimeridian stays in one piece', () => {
  const grid = new AreaGrid();
  const result = grid.compute([{ lang: 0, key: 'fiji', lon: 179.5, lat: -17, r: 300 }]);
  assert.equal(grid.langAt(-179.5, projectY(-17)), 0);
  assert.equal(grid.langAt(178.5, projectY(-17)), 0);
  assert.equal(result.get(0).parts.length, 1);
  assert.equal(result.get(0).d.split('M').length - 1, 1);
});

test('sea crossings count as farther than land', () => {
  const grid = new AreaGrid();
  // Two landmasses, 10°W–5°E and 6°E–20°E (bounded, as the grid wraps round).
  const mask = new Uint8Array(grid.cols * grid.rows);
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const lon = -180 + (c + 0.5) * grid.cell;
      mask[r * grid.cols + c] = (lon > -10 && lon < 5) || (lon > 6 && lon < 20) ? 1 : 0;
    }
  }
  grid.setLand(mask);
  grid.compute([{ lang: 0, key: 'w', lon: 3, lat: 0, r: 450 }]);
  assert.equal(grid.langAt(4.5, 0), 0);
  // 6.5°E is about 390 km away: within 450 km, but across the sea.
  assert.equal(grid.langAt(6.5, 0), -1);
  // Without the sea in between it would be claimed.
  grid.setLand(new Uint8Array(grid.cols * grid.rows).fill(1));
  grid.compute([{ lang: 0, key: 'w', lon: 3, lat: 0, r: 450 }]);
  assert.equal(grid.langAt(6.5, 0), 0);
});

test('assignTints gives bordering languages of one family different shades', () => {
  const langs = [
    { id: 'a', family: 'f', start: 0, end: null, at: [0, 45] },
    { id: 'b', family: 'f', start: 0, end: null, at: [6, 45] },
    { id: 'c', family: 'f', start: 0, end: null, at: [3, 49] },
    { id: 'far', family: 'f', start: 0, end: null, at: [100, 0] },
  ];
  const t = assignTints(langs);
  assert.notEqual(t[0], t[1]);
  assert.notEqual(t[0], t[2]);
  assert.notEqual(t[1], t[2]);
  assert.ok(t.every((x) => x >= 0 && x < 3));
});

test('area and grow are validated', () => {
  const doc = (l) => ({ families: [{ id: 'other' }], languages: [{ id: 'x', name: 'X', summary: 's', family: 'other', start: 0, end: null, at: [0, 0], ...l }] });
  assert.deepEqual(validateLanguages(doc({ area: 300 })), []);
  assert.deepEqual(validateLanguages(doc({ area: false })), []);
  assert.equal(validateLanguages(doc({ area: 5 })).length, 1);
  assert.equal(validateLanguages(doc({ places: [{ from: 1, at: [1, 1], label: 'p', grow: 50 }] })).length, 1);
  assert.deepEqual(validateLanguages(doc({ places: [{ from: 1, at: [1, 1], label: 'p', area: 500, grow: 50 }] })), []);
});
