# Linguistic Drift: a conceptual map

An interactive, web-based concept map of **linguistic drift**: how languages change in sound, grammar and meaning, why they change, how a change spreads through a community, what it leads to, and how linguists study it.

The map has 88 concepts and 203 typed connections, arranged in nine colour-coded clusters around Edward Sapir’s idea of drift. Many concepts include worked examples and an animated **word journey** that steps through a word’s history (for example *nescius* → *nice*, *hlāf-weard* → *lord*, or *cantābō* → *chanterai* → *je vais chanter*).

## Running it

Requires Node.js 18.11 or later. There are no dependencies to install.

```bash
npm start
```

Then open <http://localhost:8004>.

The port defaults to **8004**. Set `PORT` to override it and `HOST` to change the bind address (default `0.0.0.0`):

```bash
PORT=9000 npm start
```

`npm run dev` does the same as `npm start`, but restarts the server whenever the data or server code changes.

## What you can do

- **Explore the map.** Drag to pan, scroll or pinch to zoom, and drag a node to move it. Hover over a concept to highlight its connections. Labels are placed so they never overlap, and more appear as you zoom in.
- **Read a concept.** Click a concept to open its detail panel: summary, explanation, examples, a word journey you can play or step through, and clickable connections grouped by relation (“Driven by”, “Example of”, “Challenged by”…).
- **Search** (press `/`) by concept name, alias, or any word that appears in an example. *nice*, *apron* and *GVS* all work.
- **Filter** clusters from the legend. **Index** lists every concept, and is the keyboard-friendly way in.
- **Timeline.** Dated changes in languages and milestones in linguistics, on a time axis compressed toward the distant past.
- **Guided tour.** Fifteen steps through the main ideas.
- **Deep links.** Every concept has a URL, e.g. `http://localhost:8004/#/grimms-law`.
- Light and dark themes, a mobile layout, and reduced-motion support.

Keyboard: `/` search · `+` / `-` zoom · `0` fit · `←` / `→` tour steps · `Esc` close.

## Project layout

```
server.js               Zero-dependency HTTP server (static files + JSON API)
lib/validate-map.js     Structural checks run at startup and in tests
data/drift-map.json     All content: categories, relation types, nodes, links, tour
public/
  index.html
  css/styles.css        Theme tokens (light/dark), layout, components
  js/main.js            App wiring: selection, search UI, legend, index, tour, theme
  js/graph.js           SVG map renderer: camera, gestures, focus, label placement
  js/layout.js          Deterministic force layout (pure; also runs in Node)
  js/panel.js           Detail panel and word-journey player
  js/timeline.js        Timeline strip
  js/search.js          Search index over labels, aliases and examples
test/                   node:test suites for data, server, search and layout
```

### API

| Endpoint | Returns |
|---|---|
| `GET /api/map` | The full concept map as JSON |
| `GET /api/health` | `{ "status": "ok", "nodes": …, "links": … }` |

## Editing the content

Everything lives in `data/drift-map.json`. A node looks like this:

```json
{
  "id": "grimms-law",
  "label": "Grimm’s Law",
  "category": "sound",
  "kind": "concept",
  "era": "1st millennium BCE (est.)",
  "year": -500,
  "track": "language",
  "aliases": ["First Germanic Sound Shift"],
  "summary": "One or two sentences.",
  "body": "A longer explanation.",
  "examples": [{ "from": "Latin pater", "to": "English father", "note": "*p → f" }],
  "journey": { "title": "…", "steps": [{ "stage": "Old English", "date": "c. 900", "form": "fæder", "gloss": "father" }] }
}
```

- `kind` is one of `core`, `hub` (a cluster overview), `concept` or `person`.
- `year` and `track` (`language` or `idea`) are optional. Together they place the node on the timeline.
- Links are `{ "source", "target", "type" }`, where `type` is one of `includes`, `drives`, `instance`, `proposed`, `challenges` or `related`. The panel’s wording for each type, in both directions, lives under `relations`.

The server validates the file at startup and refuses to start on broken references, duplicate IDs or orphaned nodes. Run the full checks with:

```bash
npm test
```
