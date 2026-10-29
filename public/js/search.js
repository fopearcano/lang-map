// Small in-memory search over concept labels, aliases, and the example words
// and word journeys inside each concept, so a query like "nice" finds the
// concept that tells its story.

export function normalize(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[*‘’'“”"()[\]/·.,;:!?→]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSearchIndex(nodes) {
  return nodes.map((node) => {
    const phrases = [];
    for (const ex of node.examples || []) phrases.push({ text: `${ex.from} → ${ex.to}`, norm: normalize(`${ex.from} ${ex.to}`) });
    for (const s of node.journey?.steps || []) phrases.push({ text: s.form, norm: normalize(s.form) });
    if (node.journey) phrases.push({ text: node.journey.title, norm: normalize(node.journey.title) });
    return {
      node,
      label: normalize(node.label),
      aliases: (node.aliases || []).map((a) => ({ text: a, norm: normalize(a) })),
      phrases,
      summary: normalize(node.summary),
    };
  });
}

/**
 * Search entries for world-map languages, shaped like concept entries. The
 * `node` carries `type: 'language'` so the UI can route and style results.
 */
export function buildLanguageEntries(languages, families) {
  const familyLabel = new Map(families.map((f) => [f.id, f.label]));
  return languages.map((l) => {
    const phrases = [];
    if (l.night) phrases.push({ text: `‘night’: ${l.night.form}`, norm: normalize(l.night.form) });
    for (const p of l.places || []) phrases.push({ text: p.label, norm: normalize(p.label) });
    const aliases = [l.familyName || familyLabel.get(l.family), l.branch].filter(Boolean);
    return {
      node: { id: l.id, label: l.name, kind: 'language', type: 'language', family: l.family, branch: l.branch },
      label: normalize(l.name),
      aliases: aliases.map((a) => ({ text: a, norm: normalize(a) })),
      phrases,
      summary: normalize(l.summary),
    };
  });
}

const words = (s) => s.split(' ');

function matchWords(norm, q) {
  if (norm === q) return 3;
  if (norm.startsWith(q)) return 2;
  if (words(norm).some((w) => w.startsWith(q))) return 1.5;
  if (q.length >= 3 && norm.includes(q)) return 1;
  return 0;
}

export function search(index, query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const hits = [];

  for (const entry of index) {
    let score = 0;
    let via = null;

    const labelScore = matchWords(entry.label, q);
    if (labelScore) score = 60 + labelScore * 15;

    if (score < 60) {
      for (const a of entry.aliases) {
        const s = matchWords(a.norm, q);
        if (s && 35 + s * 6 > score) {
          score = 35 + s * 6;
          via = `also “${a.text}”`;
        }
      }
    }

    if (score < 35) {
      for (const p of entry.phrases) {
        const s = matchWords(p.norm, q);
        if (s && 15 + s * 5 > score) {
          score = 15 + s * 5;
          via = p.text;
        }
      }
    }

    if (!score && q.length >= 4 && entry.summary.includes(q)) score = 5;

    if (score) {
      // Prefer overview nodes slightly when scores tie.
      if (entry.node.kind === 'hub') score += 1;
      hits.push({ node: entry.node, score, via });
    }
  }

  return hits.sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label)).slice(0, limit);
}
