// Builds public/data/land.json (a projected, simplified SVG path of the
// world's coastlines) from the vendored Natural Earth TopoJSON.
//
//   node scripts/build-land.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { project } from '../public/js/geo.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = path.join(ROOT, 'data', 'vendor', 'land-50m.json');
const OUTPUT = path.join(ROOT, 'public', 'data', 'land.json');

const TOLERANCE = 0.05; // simplification tolerance, in projected degrees
const MIN_AREA = 0.008; // drop islands smaller than this (≈ 100 km²)
const SOUTH_LIMIT = -60; // drop Antarctica

const topo = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const { scale, translate } = topo.transform;

// Decode delta-encoded, quantised arcs into [lon, lat] arrays.
const arcs = topo.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
});

function ring(indices) {
  const points = [];
  for (const i of indices) {
    const arc = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
    arc.forEach((p, k) => {
      if (k > 0 || points.length === 0) points.push(p);
    });
  }
  // Unwrap rings that cross the antimeridian so they stay continuous (e.g.
  // Chukotka runs on past x = 180). The map repeats every 360 degrees, so the
  // overhang lines up with the neighbouring copy.
  let offset = 0;
  return points.map(([lon, lat], k) => {
    if (k > 0) {
      const prev = points[k - 1][0];
      if (lon - prev > 180) offset -= 360;
      else if (lon - prev < -180) offset += 360;
    }
    return [lon + offset, lat];
  });
}

function polygons(geometry) {
  if (geometry.type === 'Polygon') return [geometry.arcs];
  if (geometry.type === 'MultiPolygon') return geometry.arcs;
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(polygons);
  return [];
}

function simplify(points, tol) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let worstD = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      // Closed rings start and end on the same point: fall back to the
      // distance from that point.
      const d = len < 1e-9 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * (px - ax) - dx * (py - ay)) / len;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worstD > tol) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function area(points) {
  let s = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    s += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(s / 2);
}

const fmt = (n) => {
  const s = (Math.round(n * 100) / 100).toString();
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? `-${s.slice(2)}` : s;
};

let d = '';
let kept = 0;
let dropped = 0;
let points = 0;
for (const poly of polygons(topo.objects.land)) {
  for (const indices of poly) {
    const lonlat = ring(indices);
    if (lonlat.every(([, lat]) => lat < SOUTH_LIMIT)) {
      dropped++;
      continue;
    }
    const projected = lonlat.map(([lon, lat]) => project(lon, Math.max(lat, SOUTH_LIMIT)));
    if (area(projected) < MIN_AREA) {
      dropped++;
      continue;
    }
    const simple = simplify(projected, TOLERANCE);
    if (simple.length < 4) {
      dropped++;
      continue;
    }
    // Relative commands computed from rounded absolute coordinates, so
    // rounding errors do not accumulate along the ring.
    const rounded = simple.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    d += `M${fmt(rounded[0][0])} ${fmt(rounded[0][1])}`;
    let segment = 'l';
    for (let i = 1; i < rounded.length - 1; i++) {
      const dx = rounded[i][0] - rounded[i - 1][0];
      const dy = rounded[i][1] - rounded[i - 1][1];
      segment += `${fmt(dx)}${dy < 0 ? '' : ' '}${fmt(dy)} `;
    }
    d += `${segment.trimEnd()}z`;
    kept++;
    points += rounded.length;
  }
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(
  OUTPUT,
  JSON.stringify({
    source: 'Natural Earth 1:50m land via world-atlas 2.0.2; Patterson projection',
    d,
  }),
);
console.log(`land.json: ${kept} rings, ${points} points, ${dropped} dropped, ${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} KB`);
