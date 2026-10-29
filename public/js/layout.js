// Force-directed layout with per-category gravity wells. Pure (no DOM), so it
// runs identically in the browser and in Node tests.

export const NODE_RADIUS = { core: 30, hub: 18, concept: 8, person: 8 };

// Clockwise from the top. Neighbours on the ring share the most cross-links,
// which keeps long edges short.
export const RING_ORDER = [
  'sound', 'scholar', 'method', 'outcome', 'mechanism', 'grammar', 'meaning', 'social',
];

const LINK_LENGTH = { includes: 80, instance: 140, drives: 150, challenges: 150, related: 160, proposed: 190 };

function mulberry32(seed) {
  return function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rough label width in world units at the base label size; good enough for
// collision spacing (the renderer measures real widths for label placement).
function estimateLabelWidth(node) {
  const perChar = node.kind === 'hub' ? 7.8 : node.kind === 'core' ? 9.5 : 6.6;
  return node.label.length * perChar;
}

export function collisionRadius(node) {
  const r = NODE_RADIUS[node.kind];
  return Math.max(r + 10, estimateLabelWidth(node) * 0.5 + 4);
}

export class Simulation {
  constructor(nodes, links, { ringRadius = 430, seed = 11 } = {}) {
    const rand = mulberry32(seed);
    this.nodes = nodes;
    this.byId = new Map(nodes.map((n) => [n.id, n]));
    this.anchors = new Map();
    const counts = {};
    for (const n of nodes) counts[n.category] = (counts[n.category] || 0) + 1;

    RING_ORDER.forEach((cat, i) => {
      const angle = -Math.PI / 2 + (i / RING_ORDER.length) * Math.PI * 2;
      // Bigger clusters sit a little further out so they have room to spread.
      const r = ringRadius * (0.85 + Math.min(0.3, (counts[cat] || 0) / 60));
      this.anchors.set(cat, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    });
    this.anchors.set('core', { x: 0, y: 0 });

    for (const n of nodes) {
      const a = this.anchors.get(n.category);
      const spread = n.kind === 'concept' || n.kind === 'person' ? 160 : 10;
      n.r = NODE_RADIUS[n.kind];
      n.cr = collisionRadius(n);
      n.x = a.x + (rand() - 0.5) * spread;
      n.y = a.y + (rand() - 0.5) * spread;
      n.vx = 0;
      n.vy = 0;
      n.fx = null;
      n.fy = null;
    }

    this.links = links.map((l) => {
      const s = this.byId.get(l.source);
      const t = this.byId.get(l.target);
      const sameCluster = s.category === t.category || s.kind === 'hub' || t.kind === 'hub';
      let strength;
      let length = LINK_LENGTH[l.type] ?? 160;
      if (s.kind === 'core' || t.kind === 'core') {
        strength = 0.02;
        length = 400;
      } else if (l.type === 'includes') {
        strength = 0.5;
      } else if (l.type === 'proposed') {
        strength = 0.012;
      } else if (sameCluster) {
        strength = 0.12;
      } else {
        strength = 0.018;
      }
      return { ...l, s, t, strength, length };
    });

    const degree = new Map();
    for (const l of this.links) {
      degree.set(l.s.id, (degree.get(l.s.id) || 0) + 1);
      degree.set(l.t.id, (degree.get(l.t.id) || 0) + 1);
    }
    for (const l of this.links) {
      const ds = degree.get(l.s.id);
      const dt = degree.get(l.t.id);
      l.bias = ds / (ds + dt);
    }

    this.alpha = 1;
    this.alphaMin = 0.002;
    this.alphaDecay = 1 - Math.pow(this.alphaMin, 1 / 320);
    this.velocityDecay = 0.42;
  }

  get settled() {
    return this.alpha < this.alphaMin;
  }

  reheat(alpha = 0.3) {
    this.alpha = Math.max(this.alpha, alpha);
  }

  tick() {
    const { nodes, links } = this;
    const alpha = this.alpha;

    // Springs.
    for (const l of links) {
      const { s, t } = l;
      let dx = t.x + t.vx - s.x - s.vx;
      let dy = t.y + t.vy - s.y - s.vy;
      const d = Math.hypot(dx, dy) || 1e-6;
      const k = ((d - l.length) / d) * alpha * l.strength;
      dx *= k;
      dy *= k;
      t.vx -= dx * l.bias;
      t.vy -= dy * l.bias;
      s.vx += dx * (1 - l.bias);
      s.vy += dy * (1 - l.bias);
    }

    // Repulsion.
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const qa = charge(a);
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 520 * 520) continue;
        if (d2 < 1) {
          dx = (i % 2 ? 1 : -1) * 0.5;
          dy = 0.5;
          d2 = 0.5;
        }
        const f = (alpha * (qa + charge(b))) / 2 / d2;
        a.vx -= dx * f;
        a.vy -= dy * f;
        b.vx += dx * f;
        b.vy += dy * f;
      }
    }

    // Gravity toward each category's anchor.
    for (const n of nodes) {
      const a = this.anchors.get(n.category);
      const g = n.kind === 'core' ? 0.5 : n.kind === 'hub' ? 0.2 : 0.05;
      n.vx += (a.x - n.x) * g * alpha;
      n.vy += (a.y - n.y) * g * alpha;
    }

    // Integrate.
    for (const n of nodes) {
      if (n.fx != null) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= 1 - this.velocityDecay;
      n.vy *= 1 - this.velocityDecay;
      n.x += n.vx;
      n.y += n.vy;
    }

    this.collide(0.7);
    this.alpha += (0 - this.alpha) * this.alphaDecay;
  }

  collide(strength) {
    const { nodes } = this;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const min = a.cr + b.cr;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          // Labels sit under nodes, so overlap is mostly a horizontal problem:
          // squash the vertical axis to let nodes stack closer vertically.
          const dyScaled = dy * 1.6;
          const d2 = dx * dx + dyScaled * dyScaled;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const push = ((min - d) / d) * strength * 0.5;
          if (d < 1e-3) {
            dx = 1;
            dy = 0;
          }
          const wa = a.fx != null ? 0 : b.fx != null ? 1 : b.cr / (a.cr + b.cr);
          const wb = b.fx != null ? 0 : a.fx != null ? 1 : 1 - wa;
          a.x -= dx * push * wa;
          a.y -= dy * push * wa;
          b.x += dx * push * wb;
          b.y += dy * push * wb;
        }
      }
    }
  }

  run(maxTicks = 400) {
    for (let i = 0; i < maxTicks && !this.settled; i++) this.tick();
    return this;
  }
}

function charge(n) {
  if (n.kind === 'core') return 6000;
  if (n.kind === 'hub') return 2600;
  return 420;
}
