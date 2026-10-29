import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { project, projectY, WORLD_WIDTH, Y_TOP, Y_BOTTOM } from '../public/js/geo.js';
import { fraction, yearAt, niceYear, formatYear } from '../public/js/timescale.js';
import { nameList, shortCite, sortKey } from '../public/js/bibliography.js';
import { loadData } from '../server.js';

test('projection: equator at 0, north is up, symmetric', () => {
  assert.equal(projectY(0), 0);
  assert.ok(projectY(45) < 0 && projectY(-45) > 0);
  assert.ok(Math.abs(projectY(30) + projectY(-30)) < 1e-9);
  assert.deepEqual(project(12.5, 0), [12.5, 0]);
  assert.ok(Y_TOP < Y_BOTTOM);
  assert.equal(WORLD_WIDTH, 360);
});

test('time scale is monotonic and invertible', () => {
  let prev = -1;
  for (let y = -4500; y <= 2030; y += 37) {
    const f = fraction(y);
    assert.ok(f >= prev, `fraction should not decrease at ${y}`);
    prev = f;
    assert.ok(Math.abs(yearAt(f) - y) < 1e-6, `round trip at ${y}`);
  }
  assert.equal(niceYear(1066), 1070); // 10-year steps before 1500
  assert.equal(niceYear(1907), 1907);
  assert.equal(niceYear(-2512), -2500);
  assert.equal(formatYear(-500), '500 BCE');
  assert.equal(formatYear(800), '800 CE');
  assert.equal(formatYear(1492), '1492');
});

test('citation helpers', () => {
  assert.equal(nameList(['Sapir, Edward']), 'Sapir, Edward');
  assert.equal(nameList(['Gray, Russell D.', 'Atkinson, Quentin D.']), 'Gray, Russell D. & Quentin D. Atkinson');
  assert.equal(shortCite({ authors: ['Gray, Russell D.', 'Atkinson, Quentin D.'], year: 2003 }), 'Gray & Atkinson 2003');
  assert.equal(shortCite({ authors: ['A, B', 'C, D', 'E, F'], year: 2000 }), 'A et al. 2000');
  assert.equal(shortCite({ editors: ['Woodard, Roger D.'], year: 2004 }), 'Woodard (ed.) 2004');
  assert.ok(sortKey({ authors: ['de Vaan, Michiel'], year: 2008 }).startsWith('vaan'));
});

test('every language sits on the map and its parent existed first', () => {
  const { languages } = loadData();
  const byId = new Map(languages.languages.map((l) => [l.id, l]));
  for (const l of languages.languages) {
    const [lon, lat] = l.at;
    assert.ok(lat > -58 && lat < 84, `${l.id} latitude inside the map`);
    assert.ok(lon >= -180 && lon <= 180);
    if (l.parent) assert.ok(byId.get(l.parent).start <= l.start, `${l.id} after ${l.parent}`);
  }
});

test('land geometry is built and non-trivial', () => {
  const land = JSON.parse(fs.readFileSync(new URL('../public/data/land.json', import.meta.url), 'utf8'));
  assert.match(land.d, /^M/);
  assert.ok((land.d.match(/M/g) || []).length > 500, 'expected hundreds of coastline rings');
});
