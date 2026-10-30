// Computes the areas view off the main thread, so playback stays smooth.
// Messages in: { type: 'land', mask } once, then { type: 'compute', key, sites }.
// Messages out: { key, entries, label } where entries are [languageIndex, area]
// pairs from AreaGrid.compute and label is the grid of language indices.

import { AreaGrid } from './areas.js';

const grid = new AreaGrid();

self.onmessage = ({ data }) => {
  if (data.type === 'land') grid.setLand(data.mask);
  else if (data.type === 'compute') {
    const entries = [...grid.compute(data.sites)];
    const label = grid.label.slice();
    self.postMessage({ key: data.key, entries, label }, [label.buffer]);
  }
};
