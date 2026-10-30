// Approximate language areas for the world map's "Areas" view.
//
// At a given date each language claims the land around the places where it
// was spoken, out to a radius: 300 km by default, 550 km for a reconstructed
// proto-language, or the `area` given in the data (`area: false` means the
// language or place gets no area, e.g. a liturgical or second language). A
// place with `grow` (years) starts at a quarter of its radius and widens to
// the full radius over that many years, as a colonial settlement did.
// Where claims overlap, a grid cell goes to the language with the lowest score
// d/R + WEIGHT·ln R: neighbours of similar size split roughly halfway, while a
// much smaller language keeps its own patch inside a larger one, as a
// minority language does. Reaching another landmass across the sea counts as
// SEA_FACTOR times farther. Distances are wobbled with smooth noise (fixed per
// place) so that areas look like territories rather than circles. The result
// is schematic: it shows roughly where each language on the map was spoken,
// not surveyed boundaries.
//
// No DOM access here, so the module also runs under node for tests.

import { WORLD_WIDTH, Y_TOP, Y_BOTTOM, projectY } from './geo.js';

export const CELL = 0.25; // grid cell, in projected degrees
export const DEFAULT_RADIUS = 300; // km
export const PROTO_RADIUS = 550; // km
const KM_PER_DEG = 111.2;
const DEG = Math.PI / 180;
const WEIGHT = 0.45;
const SEA_FACTOR = 2.5;
const WOBBLE = 0.2; // ± share of the distance added by the noise
const MAX_LABELS = 512; // language indices must fit in the edge keys
// Edge directions: 0 right, 1 down, 2 left, 3 up (screen axes, y down).

export const radiusOf = (l) => (typeof l.area === 'number' ? l.area : l.kind === 'proto' ? PROTO_RADIUS : DEFAULT_RADIUS);
/** A place's radius in km; with `year`, partly grown if the place has `grow`. */
export function placeRadius(p, year) {
  const r = typeof p.area === 'number' ? p.area : DEFAULT_RADIUS;
  if (!p.grow || year == null) return r;
  const f = Math.min(1, 0.25 + (0.75 * Math.max(0, year - p.from)) / p.grow);
  return Math.round((r * f) / 10) * 10;
}

/** Latitude for a projected y (inverse of projectY, by bisection). */
export function latOfY(y) {
  let lo = -89.9;
  let hi = 89.9;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (projectY(mid) > y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Approximate distance in km (equirectangular; fine at these scales). */
export function distanceKm(lon1, lat1, lon2, lat2) {
  let dlon = lon2 - lon1;
  dlon -= 360 * Math.round(dlon / 360);
  const dx = dlon * Math.cos(((lat1 + lat2) / 2) * DEG);
  return Math.hypot(dx, lat2 - lat1) * KM_PER_DEG;
}

/**
 * The points that claim an area at `year`: a language's home (until it is
 * left) and every place it has spread to, unless marked `area: false`.
 * `lang` is the index of the language in `langs`.
 */
export function areaSites(langs, year) {
  const sites = [];
  langs.forEach((l, i) => {
    if (l.area === false || year < l.start || (l.end != null && year > l.end)) return;
    if (l.homeUntil == null || year <= l.homeUntil) {
      sites.push({ lang: i, key: l.id, lon: l.at[0], lat: l.at[1], r: radiusOf(l) });
    }
    (l.places || []).forEach((p, j) => {
      if (p.area === false || year < p.from || (p.until != null && year > p.until)) return;
      const r = placeRadius(p, year);
      sites.push({ lang: i, key: `${l.id}/${j}/${r}`, lon: p.at[0], lat: p.at[1], r });
    });
  });
  return sites;
}

/**
 * A shade (0 … count-1) for each language, chosen so that languages of the
 * same colour group that can border each other get different shades. Fixed
 * for all dates, so a language never changes shade during playback.
 */
export function assignTints(langs, count = 3) {
  const points = langs.map((l) => (l.area === false ? [] : [
    { lon: l.at[0], lat: l.at[1], r: radiusOf(l) },
    ...(l.places || []).filter((p) => p.area !== false).map((p) => ({ lon: p.at[0], lat: p.at[1], r: placeRadius(p) })),
  ]));
  const overlap = (a, b) => a.start <= (b.end ?? Infinity) && b.start <= (a.end ?? Infinity);
  const adj = langs.map(() => []);
  for (let i = 0; i < langs.length; i++) {
    for (let j = i + 1; j < langs.length; j++) {
      const a = langs[i];
      const b = langs[j];
      if (a.family !== b.family || !overlap(a, b)) continue;
      const near = points[i].some((p) => points[j].some((q) => distanceKm(p.lon, p.lat, q.lon, q.lat) < 0.95 * (p.r + q.r)));
      if (near) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  const order = langs.map((_, i) => i).sort((a, b) => adj[b].length - adj[a].length || a - b);
  const tints = new Array(langs.length).fill(-1);
  for (const i of order) {
    const used = new Array(count).fill(0);
    for (const j of adj[i]) if (tints[j] >= 0) used[tints[j]]++;
    let best = 0;
    for (let t = 1; t < count; t++) if (used[t] < used[best]) best = t;
    tints[i] = best;
  }
  return tints;
}

// ---------- Noise ----------

function hash2(ix, iy) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]. */
function noise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return 2 * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) - 1;
}

/** A stable seed for a place, from its key (without the grown radius). */
function seedOf(key) {
  let h = 2166136261;
  const k = key.replace(/\/\d+$/, '');
  for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
  return [(h >>> 0) % 997, ((h >>> 0) >>> 10) % 991];
}

// ---------- Outline smoothing (grid units, flat [x0, y0, x1, y1, …] loops) ----------

/** Cuts each corner by up to half a cell: grid staircases become diagonals. */
function cutCorners(p) {
  const n = p.length / 2;
  const out = [];
  const push = (x, y) => {
    const m = out.length;
    if (m && Math.abs(out[m - 2] - x) < 1e-9 && Math.abs(out[m - 1] - y) < 1e-9) return;
    out.push(x, y);
  };
  for (let k = 0; k < n; k++) {
    const ax = p[((k + n - 1) % n) * 2];
    const ay = p[((k + n - 1) % n) * 2 + 1];
    const x = p[k * 2];
    const y = p[k * 2 + 1];
    const bx = p[((k + 1) % n) * 2];
    const by = p[((k + 1) % n) * 2 + 1];
    const la = Math.abs(x - ax) + Math.abs(y - ay);
    const lb = Math.abs(bx - x) + Math.abs(by - y);
    const c = Math.min(0.5, la / 2, lb / 2);
    push(x + ((ax - x) / la) * c, y + ((ay - y) / la) * c);
    push(x + ((bx - x) / lb) * c, y + ((by - y) / lb) * c);
  }
  if (out.length >= 4 && Math.abs(out[0] - out[out.length - 2]) < 1e-9 && Math.abs(out[1] - out[out.length - 1]) < 1e-9) out.length -= 2;
  return out;
}

/** One round of Chaikin corner cutting. */
function chaikin(p) {
  const n = p.length / 2;
  const out = new Array(n * 4);
  for (let k = 0; k < n; k++) {
    const x = p[k * 2];
    const y = p[k * 2 + 1];
    const nx = p[((k + 1) % n) * 2];
    const ny = p[((k + 1) % n) * 2 + 1];
    out[k * 4] = 0.75 * x + 0.25 * nx;
    out[k * 4 + 1] = 0.75 * y + 0.25 * ny;
    out[k * 4 + 2] = 0.25 * x + 0.75 * nx;
    out[k * 4 + 3] = 0.25 * y + 0.75 * ny;
  }
  return out;
}

/** Douglas–Peucker on an open chain of point indices [a, b] (inclusive). */
function dpKeep(p, a, b, tol2, keep) {
  let max = 0;
  let idx = -1;
  const ax = p[a * 2];
  const ay = p[a * 2 + 1];
  const dx = p[b * 2] - ax;
  const dy = p[b * 2 + 1] - ay;
  const len2 = dx * dx + dy * dy;
  for (let k = a + 1; k < b; k++) {
    const px = p[k * 2] - ax;
    const py = p[k * 2 + 1] - ay;
    let d2;
    if (len2 === 0) d2 = px * px + py * py;
    else {
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const ex = px - t * dx;
      const ey = py - t * dy;
      d2 = ex * ex + ey * ey;
    }
    if (d2 > max) {
      max = d2;
      idx = k;
    }
  }
  if (idx >= 0 && max > tol2) {
    keep[idx] = 1;
    dpKeep(p, a, idx, tol2, keep);
    dpKeep(p, idx, b, tol2, keep);
  }
}

function simplifyLoop(p, tol) {
  const n = p.length / 2;
  if (n <= 8) return p;
  // Split the loop at the point farthest from the first one.
  let far = 0;
  let max = -1;
  for (let k = 1; k < n; k++) {
    const d = (p[k * 2] - p[0]) ** 2 + (p[k * 2 + 1] - p[1]) ** 2;
    if (d > max) {
      max = d;
      far = k;
    }
  }
  const closed = p.concat([p[0], p[1]]);
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  dpKeep(closed, 0, far, tol * tol, keep);
  dpKeep(closed, far, n, tol * tol, keep);
  const out = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(p[k * 2], p[k * 2 + 1]);
  return out.length >= 6 ? out : p;
}

export class AreaGrid {
  constructor({ cell = CELL } = {}) {
    this.cell = cell;
    this.cols = Math.round(WORLD_WIDTH / cell);
    this.rows = Math.ceil((Y_BOTTOM - Y_TOP) / cell);
    const n = this.cols * this.rows;
    this.rowLat = new Float64Array(this.rows);
    for (let r = 0; r < this.rows; r++) this.rowLat[r] = latOfY(Y_TOP + (r + 0.5) * cell);
    this.label = new Int16Array(n).fill(-1);
    // Until a land mask is set, every cell is land.
    this.land = new Uint8Array(n).fill(1);
  }

  /** Working arrays, allocated on first use (a grid used only for lookups needs none). */
  buffers() {
    if (this.score) return;
    const n = this.cols * this.rows;
    this.score = new Float32Array(n);
    this.comp = new Int32Array(n);
    this.ucol = new Int32Array(n);
    this.dt = new Uint16Array(n);
    this.queue = new Int32Array(n);
    this.mass = new Int32Array(n); // landmass of each cell, -1 for sea; all one until setLand
  }

  colOf(lon) {
    const c = Math.floor((lon + 180) / this.cell) % this.cols;
    return c < 0 ? c + this.cols : c;
  }

  rowOf(lat) {
    return Math.floor((projectY(lat) - Y_TOP) / this.cell);
  }

  /** Grid index for a point in projected coordinates, or -1 off the grid. */
  indexAt(x, y) {
    const r = Math.floor((y - Y_TOP) / this.cell);
    if (r < 0 || r >= this.rows) return -1;
    const c = Math.floor((x + 180) / this.cell);
    return r * this.cols + (((c % this.cols) + this.cols) % this.cols);
  }

  /** Index of the language whose area covers this point on land, or -1. */
  langAt(x, y) {
    const i = this.indexAt(x, y);
    return i >= 0 && this.land[i] ? this.label[i] : -1;
  }

  /** `mask` has one byte per cell, row by row from the north: 1 = land. */
  setLand(mask) {
    this.buffers();
    const { cols, rows, queue } = this;
    this.land = mask;
    const mass = this.mass.fill(-1);
    let id = 0;
    for (let s = 0; s < mask.length; s++) {
      if (!mask[s] || mass[s] >= 0) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      mass[s] = id;
      while (head < tail) {
        const i = queue[head++];
        const r = (i / cols) | 0;
        const c = i - r * cols;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= rows) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const j = rr * cols + ((c + dc + cols) % cols);
            if (mask[j] && mass[j] < 0) {
              mass[j] = id;
              queue[tail++] = j;
            }
          }
        }
      }
      id++;
    }
  }

  /** The landmass a site stands on, or the nearest one within a few cells. */
  siteMass(s) {
    const { cols, rows, mass } = this;
    const r0 = Math.max(0, Math.min(rows - 1, this.rowOf(s.lat)));
    const c0 = this.colOf(s.lon);
    for (let rad = 0; rad <= 8; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        const r = r0 + dr;
        if (r < 0 || r >= rows) continue;
        const step = Math.abs(dr) === rad ? 1 : 2 * rad;
        for (let dc = -rad; dc <= rad; dc += step || 1) {
          const m = mass[r * cols + ((c0 + dc + cols) % cols)];
          if (m >= 0) return m;
        }
      }
    }
    return -1;
  }

  rasterSite(s) {
    const { cols, rows, cell, label, score, mass, rowLat } = this;
    const R = s.r;
    const bias = WEIGHT * Math.log(R);
    const c0 = this.colOf(s.lon);
    const own = this.siteMass(s);
    const reach = R / (1 - WOBBLE); // the noise can carry an area a little past R
    const dLat = reach / KM_PER_DEG;
    const r0 = Math.max(0, this.rowOf(Math.min(89.9, s.lat + dLat)));
    const r1 = Math.min(rows - 1, this.rowOf(Math.max(-89.9, s.lat - dLat)));
    const half = cols >> 1;
    // Noise coordinates are in units of the radius, so every area is about
    // equally irregular whatever its size.
    const [ox, oy] = seedOf(s.key);
    const f1 = 1.7 / R;
    const f2 = 3.9 / R;
    for (let r = r0; r <= r1; r++) {
      const lat = rowLat[r];
      const dy = (lat - s.lat) * KM_PER_DEG;
      if (Math.abs(dy) > reach) continue;
      const kx = KM_PER_DEG * Math.max(0.02, Math.cos(((lat + s.lat) / 2) * DEG));
      const span = Math.min(half, Math.ceil(Math.sqrt(reach * reach - dy * dy) / kx / cell) + 1);
      const base = r * cols;
      for (let dc = -span; dc <= span; dc++) {
        const c = (c0 + dc + cols) % cols;
        let dlon = -180 + (c + 0.5) * cell - s.lon;
        dlon -= 360 * Math.round(dlon / 360);
        const dx = dlon * kx;
        const i = base + c;
        let d = Math.sqrt(dx * dx + dy * dy);
        d *= 1 + WOBBLE * (0.65 * noise(ox + dx * f1, oy + dy * f1) + 0.35 * noise(oy + dx * f2, ox + dy * f2));
        const m = mass[i];
        if (m >= 0 && m !== own) d *= SEA_FACTOR;
        if (d > R) continue;
        const sc = d / R + bias;
        if (sc < score[i]) {
          score[i] = sc;
          label[i] = s.lang;
        }
      }
    }
    return [r0, r1];
  }

  /**
   * Computes the areas for a set of sites (from areaSites). Returns a Map from
   * language index to { d, parts, cells }: `d` is an SVG path in projected
   * coordinates (fill with evenodd, clip to land), `parts` lists each separate
   * area with a label anchor { x, y } and its size in land cells, largest
   * first, and `cells` is the total.
   */
  compute(sites) {
    this.buffers();
    const { cols, rows, cell, label, score, land, comp, ucol, dt, queue } = this;
    label.fill(-1);
    score.fill(Infinity);
    if (sites.some((s) => s.lang >= MAX_LABELS)) throw new Error('too many languages for the area grid');
    let rMin = rows;
    let rMax = -1;
    for (const s of sites) {
      const [a, b] = this.rasterSite(s);
      if (a <= b) {
        rMin = Math.min(rMin, a);
        rMax = Math.max(rMax, b);
      }
    }
    const result = new Map();
    if (rMax < 0) return result;
    const i0 = rMin * cols;
    const i1 = (rMax + 1) * cols;

    // 1. Connected areas (4-neighbour, wrapping east–west). `ucol` is an
    //    unwrapped column, so an area crossing the antimeridian stays whole.
    comp.fill(-1, i0, i1);
    const comps = [];
    for (let s = i0; s < i1; s++) {
      if (label[s] < 0 || comp[s] >= 0) continue;
      const L = label[s];
      const id = comps.length;
      let head = 0;
      let tail = 0;
      let landCells = 0;
      queue[tail++] = s;
      comp[s] = id;
      ucol[s] = s % cols;
      while (head < tail) {
        const i = queue[head++];
        if (land[i]) landCells++;
        const r = (i / cols) | 0;
        const c = i - r * cols;
        const u = ucol[i];
        let j = r * cols + (c + 1 === cols ? 0 : c + 1);
        if (label[j] === L && comp[j] < 0) { comp[j] = id; ucol[j] = u + 1; queue[tail++] = j; }
        j = r * cols + (c === 0 ? cols - 1 : c - 1);
        if (label[j] === L && comp[j] < 0) { comp[j] = id; ucol[j] = u - 1; queue[tail++] = j; }
        j = i - cols;
        if (r > 0 && label[j] === L && comp[j] < 0) { comp[j] = id; ucol[j] = u; queue[tail++] = j; }
        j = i + cols;
        if (r < rows - 1 && label[j] === L && comp[j] < 0) { comp[j] = id; ucol[j] = u; queue[tail++] = j; }
      }
      comps.push({ lang: L, land: landCells, best: -1, bestDt: -1 });
    }

    // 2. Distance to the edge of the area (chamfer 3-4), on land only, to
    //    put each label where its area is widest.
    for (let i = i0; i < i1; i++) dt[i] = land[i] && label[i] >= 0 ? 65535 : 0;
    // Neighbours with another label (or none) count as distance 0.
    const near = (i, j, w, v) => {
      const t = (label[j] === label[i] ? dt[j] : 0) + w;
      return t < v ? t : v;
    };
    for (let r = rMin; r <= rMax; r++) {
      const row = r * cols;
      for (let c = 0; c < cols; c++) {
        const i = row + c;
        if (!dt[i]) continue;
        const cl = c === 0 ? cols - 1 : c - 1;
        const cr = c + 1 === cols ? 0 : c + 1;
        let v = near(i, row + cl, 3, dt[i]);
        if (r > rMin) {
          const up = row - cols;
          v = near(i, up + c, 3, v);
          v = near(i, up + cl, 4, v);
          v = near(i, up + cr, 4, v);
        } else if (v > 3) v = 3;
        dt[i] = v;
      }
    }
    for (let r = rMax; r >= rMin; r--) {
      const row = r * cols;
      for (let c = cols - 1; c >= 0; c--) {
        const i = row + c;
        if (!dt[i]) continue;
        const cl = c === 0 ? cols - 1 : c - 1;
        const cr = c + 1 === cols ? 0 : c + 1;
        let v = near(i, row + cr, 3, dt[i]);
        if (r < rMax) {
          const dn = row + cols;
          v = near(i, dn + c, 3, v);
          v = near(i, dn + cl, 4, v);
          v = near(i, dn + cr, 4, v);
        } else if (v > 3) v = 3;
        dt[i] = v;
        const k = comps[comp[i]];
        if (v > k.bestDt) {
          k.bestDt = v;
          k.best = i;
        }
      }
    }

    // 3. Boundary edges of every area that touches land, oriented so the
    //    area is on the right; then link them into loops.
    let cap = this.edgeCap || 65536;
    let ex = new Int32Array(cap);
    let ey = new Int32Array(cap);
    let edir = new Uint8Array(cap);
    let eend = new Float64Array(cap);
    let enext = new Int32Array(cap);
    let count = 0;
    const starts = new Map();
    const addEdge = (L, vc, vr, x, y, dir) => {
      if (count === cap) {
        cap *= 2;
        const grow = (a) => { const b = new a.constructor(cap); b.set(a); return b; };
        ex = grow(ex); ey = grow(ey); edir = grow(edir); eend = grow(eend); enext = grow(enext);
      }
      const e = count++;
      ex[e] = x;
      ey[e] = y;
      edir[e] = dir;
      const dx = dir === 0 ? 1 : dir === 2 ? -1 : 0;
      const dy = dir === 1 ? 1 : dir === 3 ? -1 : 0;
      eend[e] = (((vc + dx) % cols) + (vr + dy) * cols) * MAX_LABELS + L;
      const key = ((vc % cols) + vr * cols) * MAX_LABELS + L;
      // At a saddle two edges of one area leave the same corner: chain them.
      const prev = starts.get(key);
      enext[e] = prev === undefined ? -1 : prev;
      starts.set(key, e);
    };
    for (let i = i0; i < i1; i++) {
      const L = label[i];
      if (L < 0 || !comps[comp[i]].land) continue;
      const r = (i / cols) | 0;
      const c = i - r * cols;
      const u = ucol[i];
      if (r === 0 || label[i - cols] !== L) addEdge(L, c, r, u, r, 0);
      if (label[r * cols + (c + 1) % cols] !== L) addEdge(L, c + 1, r, u + 1, r, 1);
      if (r === rows - 1 || label[i + cols] !== L) addEdge(L, c + 1, r + 1, u + 1, r + 1, 2);
      if (label[r * cols + (c + cols - 1) % cols] !== L) addEdge(L, c + cols, r + 1, u, r + 1, 3);
    }
    this.edgeCap = cap;
    const edgeComp = (e) => {
      // The cell to the right of an edge belongs to the area.
      const x = ex[e];
      const y = ey[e];
      const d = edir[e];
      const cx = d === 0 || d === 3 ? x : x - 1;
      const cy = d === 0 || d === 1 ? y : y - 1;
      return comp[cy * cols + (((cx % cols) + cols) % cols)];
    };

    const used = new Uint8Array(count);
    const loopsByComp = new Map();
    for (let e0 = 0; e0 < count; e0++) {
      if (used[e0]) continue;
      const pts = [];
      let e = e0;
      let guard = count + 1;
      while (guard--) {
        used[e] = 1;
        const d = edir[e];
        let chosen = starts.get(eend[e]);
        if (chosen !== undefined && enext[chosen] >= 0) {
          // A saddle: turn right, so diagonal neighbours stay separate.
          const other = enext[chosen];
          if (edir[other] === (d + 1) % 4 || (edir[chosen] !== (d + 1) % 4 && edir[other] === d)) chosen = other;
        }
        if (chosen === undefined) break;
        if (edir[chosen] !== d) {
          // A corner at the end of this edge, in this area's unwrapped columns.
          pts.push(ex[e] + (d === 0 ? 1 : d === 2 ? -1 : 0), ey[e] + (d === 1 ? 1 : d === 3 ? -1 : 0));
        }
        if (chosen === e0 || used[chosen]) break;
        e = chosen;
      }
      if (pts.length < 6) continue;
      const id = edgeComp(e0);
      if (!loopsByComp.has(id)) loopsByComp.set(id, []);
      loopsByComp.get(id).push(pts);
    }

    // 4. Paths and label anchors per language.
    for (const [id, loops] of loopsByComp) {
      const k = comps[id];
      if (!k.land || k.best < 0) continue;
      const shift = -cols * Math.floor(ucol[k.best] / cols);
      let d = '';
      for (const loop of loops) {
        const pts = simplifyLoop(chaikin(cutCorners(loop)), 0.12);
        for (let j = 0; j < pts.length; j += 2) {
          const x = -180 + (pts[j] + shift) * cell;
          const y = Y_TOP + pts[j + 1] * cell;
          d += `${j ? ' ' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
        }
        d += 'Z';
      }
      const br = (k.best / cols) | 0;
      const part = {
        x: -180 + (ucol[k.best] + shift + 0.5) * cell,
        y: Y_TOP + (br + 0.5) * cell,
        cells: k.land,
      };
      let entry = result.get(k.lang);
      if (!entry) result.set(k.lang, (entry = { d: '', parts: [], cells: 0 }));
      entry.d += d;
      entry.parts.push(part);
      entry.cells += k.land;
    }
    for (const entry of result.values()) entry.parts.sort((a, b) => b.cells - a.cells);
    return result;
  }
}
