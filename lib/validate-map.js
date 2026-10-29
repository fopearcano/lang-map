const KINDS = new Set(['core', 'hub', 'concept', 'person']);
const TRACKS = new Set(['language', 'idea']);

/**
 * Checks the concept map for structural problems. Pass `sourceIds` to also
 * check each node's bibliography references.
 * Returns a list of human-readable error strings; an empty list means valid.
 */
export function validateMap(map, { sourceIds } = {}) {
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
    if (sourceIds) {
      if (!n.sources || !n.sources.length) errors.push(`${where}: no sources`);
      for (const ref of n.sources || []) {
        if (!sourceIds.has(ref)) errors.push(`${where}: unknown source ${ref}`);
      }
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

const SOURCE_TYPES = new Set(['book', 'article', 'chapter', 'web', 'newspaper']);

/** Checks the bibliography (data/sources.json). */
export function validateSources(doc) {
  const errors = [];
  if (!doc || !Array.isArray(doc.sources)) return ['sources document needs a "sources" array'];
  const topics = new Set((doc.topics || []).map((t) => t.id));
  const ids = new Set();
  for (const s of doc.sources) {
    const where = `source ${s.id || '(no id)'}`;
    if (!s.id || !/^[a-z0-9-]+$/.test(s.id)) errors.push(`${where}: id must be kebab-case`);
    if (ids.has(s.id)) errors.push(`duplicate source id: ${s.id}`);
    ids.add(s.id);
    if (!SOURCE_TYPES.has(s.type)) errors.push(`${where}: unknown type ${s.type}`);
    if (!s.title) errors.push(`${where}: missing title`);
    if (!(s.authors && s.authors.length) && !(s.editors && s.editors.length)) errors.push(`${where}: needs authors or editors`);
    if (s.year !== null && !Number.isInteger(s.year)) errors.push(`${where}: year must be an integer or null`);
    if (s.type === 'article' && !s.journal) errors.push(`${where}: article needs a journal`);
    if (s.type === 'chapter' && !s.booktitle) errors.push(`${where}: chapter needs a booktitle`);
    if (s.doi && !/^10\.\d{4,9}\/\S+$/.test(s.doi)) errors.push(`${where}: malformed DOI`);
    if (s.url && !/^https:\/\//.test(s.url)) errors.push(`${where}: url must be https`);
    if (!s.topics || !s.topics.length) errors.push(`${where}: needs at least one topic`);
    for (const t of s.topics || []) if (!topics.has(t)) errors.push(`${where}: unknown topic ${t}`);
  }
  return errors;
}

const LANG_KINDS = new Set(['proto', 'attested']);
const RELATIONS = new Set(['descent', 'contact', 'revival']);
const validPoint = (p) =>
  Array.isArray(p) && p.length === 2 && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** Checks the world-map language data (data/languages.json). */
export function validateLanguages(doc, { conceptIds, sourceIds } = {}) {
  const errors = [];
  if (!doc || !Array.isArray(doc.languages)) return ['languages document needs a "languages" array'];
  const families = new Set((doc.families || []).map((f) => f.id));
  const byId = new Map();
  for (const l of doc.languages) {
    if (byId.has(l.id)) errors.push(`duplicate language id: ${l.id}`);
    byId.set(l.id, l);
  }
  for (const l of doc.languages) {
    const where = `language ${l.id || '(no id)'}`;
    if (!l.id || !/^[a-z0-9-]+$/.test(l.id)) errors.push(`${where}: id must be kebab-case`);
    if (!l.name) errors.push(`${where}: missing name`);
    if (!l.summary) errors.push(`${where}: missing summary`);
    if (!families.has(l.family)) errors.push(`${where}: unknown family ${l.family}`);
    if (l.kind && !LANG_KINDS.has(l.kind)) errors.push(`${where}: unknown kind ${l.kind}`);
    if (l.relation && !RELATIONS.has(l.relation)) errors.push(`${where}: unknown relation ${l.relation}`);
    if (!Number.isInteger(l.start)) errors.push(`${where}: start must be an integer year`);
    if (l.end !== null && !Number.isInteger(l.end)) errors.push(`${where}: end must be an integer year or null`);
    if (Number.isInteger(l.end) && l.end <= l.start) errors.push(`${where}: end must be after start`);
    if (!validPoint(l.at)) errors.push(`${where}: "at" must be [lon, lat]`);
    for (const v of l.via || []) if (!validPoint(v)) errors.push(`${where}: bad via point`);
    for (const p of l.places || []) {
      if (!validPoint(p.at) || !Number.isInteger(p.from) || !p.label) errors.push(`${where}: place needs at, from and label`);
      if (p.from < l.start) errors.push(`${where}: place "${p.label}" starts before the language`);
    }
    if (l.parent) {
      const parent = byId.get(l.parent);
      if (!parent) errors.push(`${where}: unknown parent ${l.parent}`);
      else if (parent.start > l.start) errors.push(`${where}: parent ${l.parent} starts after its child`);
      // Walk up the tree to catch cycles.
      const seen = new Set([l.id]);
      for (let p = parent; p; p = byId.get(p.parent)) {
        if (seen.has(p.id)) {
          errors.push(`${where}: parent chain loops`);
          break;
        }
        seen.add(p.id);
      }
    }
    if (l.night && !l.night.form) errors.push(`${where}: night needs a form`);
    for (const c of l.concepts || []) if (conceptIds && !conceptIds.has(c)) errors.push(`${where}: unknown concept ${c}`);
    if (sourceIds && !(l.sources && l.sources.length)) errors.push(`${where}: no sources`);
    for (const r of l.sources || []) if (sourceIds && !sourceIds.has(r)) errors.push(`${where}: unknown source ${r}`);
  }
  return errors;
}
