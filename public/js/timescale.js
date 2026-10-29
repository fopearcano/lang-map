// Piecewise-linear time scale shared by the concept timeline and the world
// map's time slider. The distant past is compressed so that recent centuries,
// where most of the events are, get room.

export const STOPS = [
  [-4500, 0],
  [-1000, 0.07],
  [1000, 0.2],
  [1700, 0.36],
  [1850, 0.47],
  [2030, 1],
];

export const YEAR_MIN = STOPS[0][0];
export const YEAR_MAX = STOPS[STOPS.length - 1][0];

/** Year → position in [0, 1]. */
export function fraction(year, stops = STOPS) {
  for (let i = 1; i < stops.length; i++) {
    const [y0, f0] = stops[i - 1];
    const [y1, f1] = stops[i];
    if (year <= y1) return f0 + ((Math.max(year, y0) - y0) / (y1 - y0)) * (f1 - f0);
  }
  return 1;
}

/** Position in [0, 1] → year (inverse of `fraction`). */
export function yearAt(f, stops = STOPS) {
  const t = Math.min(1, Math.max(0, f));
  for (let i = 1; i < stops.length; i++) {
    const [y0, f0] = stops[i - 1];
    const [y1, f1] = stops[i];
    if (t <= f1) return y0 + ((t - f0) / (f1 - f0)) * (y1 - y0);
  }
  return stops[stops.length - 1][0];
}

/** Rounds a year to a precision that suits its distance from the present. */
export function niceYear(y) {
  const step = y < -1000 ? 50 : y < 0 ? 25 : y < 1500 ? 10 : y < 1900 ? 5 : 1;
  return Math.round(y / step) * step;
}

export function formatYear(y) {
  if (y < 0) return `${(-y).toLocaleString('en-US')} BCE`;
  if (y === 0) return '1 CE';
  if (y < 1000) return `${y} CE`;
  return String(y);
}

/** "711–1609", or "500 BCE – 600 CE" when the range crosses eras. */
export function formatRange(a, b) {
  if (a > 0 && b > 0) return `${a}–${b}`;
  if (a < 0 && b < 0) return `${-a}–${-b} BCE`;
  return `${formatYear(a)} – ${formatYear(b)}`;
}
