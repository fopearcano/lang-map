# Linguistic Drift

An interactive web app about how languages change, in two sections:

- **Concept map**: 88 concepts and 203 typed connections, arranged around Edward Sapir’s idea of *drift*. It covers sound change, grammar change, meaning and vocabulary, causes, social spread, outcomes, methods and key thinkers. Many concepts include an animated **word journey** (*nescius* → *nice*, *hlāf-weard* → *lord*, *cantābō* → *chanterai* → *je vais chanter*).
- **World map**: 127 languages placed in space and time, from Proto-Indo-European (c. 4500 BCE) to today. Drag the time slider or press play to watch languages appear, split into daughters, spread with migrations and conquests, and fall silent. A layer shows each language’s word for *night*, so you can follow Proto-Indo-European *\*nókʷts* as it drifts into *nox*, *nuit*, *Nacht*, *noć* and *natë*.

Every concept and language cites its sources. The **bibliography** lists 129 references, and each DOI has been checked against Crossref.

## Running it

Requires Node.js 18.11 or later. There are no dependencies to install.

```bash
npm start
```

Then open <http://localhost:8004>.

The port defaults to **8004**. Set `PORT` to override it and `HOST` to change the bind address (default `0.0.0.0`). `npm run dev` restarts the server whenever the data or server code changes.

## Using it

- **Switch sections** with the *Concept map / World map* tabs. Concepts and languages link to each other: Latin links to *Divergence*, and *Great Vowel Shift* links to English.
- **Help menu**: the *guided tour* (15 steps through the concept map), *how to use this site*, and the *bibliography & sources*.
- **Search** (press `/`) for concepts, languages, or any word in the examples: *nice*, *apron*, *nuit*.
- **Index** lists every concept or language and is the keyboard-friendly way in.
- **Concept map**: drag to pan, scroll to zoom, click a concept for its panel (examples, word journey, connections, sources). Filter categories from the legend, and toggle the timeline of dated changes and ideas.
- **World map**: press play (or `Space`), drag the slider, or jump to an era. Click a language to see its family tree, migrations, its word for *night*, related concepts and sources. Use the switches to hide languages that are no longer spoken, hide family lines, or show the *night* layer. Families can be filtered from the legend.
- **Deep links**: `#/grimms-law`, `#/world`, `#/world/latin`, `#/sources/sapir-1921`.
- Light and dark themes, a phone layout, and reduced-motion support.

Keyboard: `/` search · `+` / `-` zoom · `0` fit · `Space` play/pause (world map) · `←` / `→` tour steps or time steps · `Esc` close.

## Project layout

```
server.js                 Zero-dependency HTTP server (static files, JSON API, gzip)
lib/validate-map.js       Validators for all three datasets, run at startup and in tests
data/drift-map.json       Concept map: categories, relation types, nodes, links, tour
data/languages.json       World map: language families and languages
data/sources.json         Bibliography and topics
data/vendor/land-50m.json Natural Earth coastlines (via world-atlas, ISC); see data/vendor/README.md
scripts/build-land.mjs    Projects and simplifies the coastlines into public/data/land.json
public/
  index.html
  css/styles.css          Theme tokens, layout, concept map, shared components
  css/world.css           World map, time bar, panels, bibliography dialog
  js/app.js               App shell: routing, tabs, search, Help menu, index, theme, keys
  js/concept-section.js   Concept-map section (legend, panel, tour, timeline)
  js/graph.js             Concept-map renderer: camera, gestures, focus, label placement
  js/layout.js            Deterministic force layout (pure; also runs in Node)
  js/world-section.js     World-map section (time controls, legend, panel, index)
  js/world-view.js        World-map renderer: wrapping projection, arcs, markers, labels
  js/geo.js               Patterson cylindrical projection
  js/timescale.js         Compressed time scale shared by both timelines
  js/bibliography.js      Citation formatting and the bibliography dialog
  js/panel.js, timeline.js, search.js, tooltip.js, dom.js
test/                     node:test suites
```

### API

| Endpoint | Returns |
|---|---|
| `GET /api/map` | The concept map |
| `GET /api/languages` | Languages and families for the world map |
| `GET /api/sources` | The bibliography |
| `GET /api/health` | Status and counts |

## Editing the content

The server validates all three data files at startup, including the references between them. It refuses to start on a broken reference, a duplicate ID, a source that doesn’t exist, or a language whose parent appears after it. Run `npm test` after editing.

**Concepts** (`data/drift-map.json`): each node has `id`, `label`, `category`, `kind` (`core`, `hub`, `concept` or `person`), `summary`, and `sources`. Optional fields are `body`, `era`, `year`/`track` (for the timeline), `aliases`, `examples` and `journey`. Links are `{ source, target, type }`, with types `includes`, `drives`, `instance`, `proposed`, `challenges` and `related`.

**Languages** (`data/languages.json`):

```json
{
  "id": "latin", "name": "Latin", "family": "indo-european", "branch": "Italic", "parent": "pie",
  "start": -600, "end": 600, "era": "c. 600 BCE – 600 CE as a spoken mother tongue", "at": [12.5, 41.9],
  "places": [{ "from": -218, "at": [-4, 40], "label": "Hispania (from 218 BCE)" }],
  "summary": "…", "night": { "form": "nox (noctis)", "cognate": true },
  "concepts": ["language-split"], "sources": ["clackson-horrocks-2007"]
}
```

- `at` is `[longitude, latitude]` of an approximate centre. `end: null` means still spoken.
- `kind: "proto"` marks a reconstructed language. `relation` can be `contact` (a creole and its lexifier) or `revival`.
- `places` adds expansions over time. Use `until` when a place was lost, `homeUntil` when the homeland was left, and `chain: true` for a migration that moves from place to place (as with Romani).
- `via` bends a descent line through waypoints (Malagasy via Borneo).
- `night.cognate` is `true`/`false` for Indo-European languages (descended from \*nókʷts or not), and `null` for other families.

**Sources** (`data/sources.json`): `type` is `book`, `article`, `chapter`, `web` or `newspaper`, with authors or editors, year, title and `topics`. Add a `doi` or `url` where one exists.

Rebuild the coastline file after changing the projection or the simplification settings:

```bash
npm run build:land
```

## A note on accuracy

Dates for unwritten proto-languages are estimates, and scholars disagree about several of them (the Indo-European homeland, the age of Sino-Tibetan); the text says so where it matters. A language’s position marks a rough centre, not its full extent. Speaker numbers are rounded approximations from Ethnologue.
