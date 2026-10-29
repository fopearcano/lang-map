const KINDS = new Set(['core', 'hub', 'concept', 'person']);
const TRACKS = new Set(['language', 'idea']);

/**
 * Checks the concept map for structural problems.
 * Returns a list of human-readable error strings; an empty list means valid.
 */
export function validateMap(map) {
  const errors = [];
  if (!map || typeof map !== 'object') return ['map must be an object'];

  const categories = new Set();
  for (const c of map.categories || []) {
    if (!c.id || !c.label) errors.push(`category missing id/label: ${JSON.stringify(c)}`);
    if (categories.has(c.id)) errors.push(`duplicate category id: ${c.id}`);
    categories.add(c.id);
  }

  const relations = new Set(Object.keys(map.relations || {}));
  for (const [type, r] of Object.entries(map.relations || {})) {
    if (!r.out || !r.in) errors.push(`relation ${type} needs "out" and "in" labels`);
  }

  const ids = new Set();
  for (const n of map.nodes || []) {
    const where = `node ${n.id || '(no id)'}`;
    if (!n.id || !/^[a-z0-9-]+$/.test(n.id)) errors.push(`${where}: id must be kebab-case`);
    if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    ids.add(n.id);
    if (!n.label) errors.push(`${where}: missing label`);
    if (!n.summary) errors.push(`${where}: missing summary`);
    if (!categories.has(n.category)) errors.push(`${where}: unknown category ${n.category}`);
    if (!KINDS.has(n.kind)) errors.push(`${where}: unknown kind ${n.kind}`);
    if (n.year !== undefined) {
      if (!Number.isInteger(n.year)) errors.push(`${where}: year must be an integer`);
      if (!TRACKS.has(n.track)) errors.push(`${where}: a dated node needs track "language" or "idea"`);
    }
    for (const ex of n.examples || []) {
      if (!ex.from || !ex.to) errors.push(`${where}: example needs from/to`);
    }
    if (n.journey) {
      if (!n.journey.title || !Array.isArray(n.journey.steps) || n.journey.steps.length < 2) {
        errors.push(`${where}: journey needs a title and at least two steps`);
      }
      for (const s of n.journey.steps || []) {
        if (!s.stage || !s.form) errors.push(`${where}: journey step needs stage and form`);
      }
    }
  }

  const seen = new Set();
  for (const l of map.links || []) {
    const where = `link ${l.source} → ${l.target}`;
    if (!ids.has(l.source)) errors.push(`${where}: unknown source`);
    if (!ids.has(l.target)) errors.push(`${where}: unknown target`);
    if (l.source === l.target) errors.push(`${where}: self-link`);
    if (!relations.has(l.type)) errors.push(`${where}: unknown type ${l.type}`);
    const key = [l.source, l.target].sort().join('|');
    if (seen.has(key)) errors.push(`${where}: duplicate link between the same pair`);
    seen.add(key);
  }

  const linked = new Set();
  for (const l of map.links || []) { linked.add(l.source); linked.add(l.target); }
  for (const id of ids) if (!linked.has(id)) errors.push(`node ${id} has no links`);

  for (const step of map.tour || []) {
    if (!ids.has(step.node)) errors.push(`tour step references unknown node ${step.node}`);
    if (!step.text) errors.push(`tour step ${step.node} has no text`);
  }

  return errors;
}
