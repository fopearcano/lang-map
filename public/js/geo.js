// World-map projection, shared by the browser and the land build script.
//
// Patterson cylindrical projection (Patterson, Šavrič & Jenny 2014): a
// compromise cylindrical projection, chosen because cylindrical maps tile
// horizontally, so the map can wrap around the Pacific. Units are "degrees at
// the equator": x runs from -180 to 180 and the world repeats every 360.

export const WORLD_WIDTH = 360;
export const LAT_MIN = -58;
export const LAT_MAX = 84;

const K1 = 1.0148;
const K2 = 0.23185;
const K3 = -0.14499;
const K4 = 0.02406;
const DEG = Math.PI / 180;

export function projectY(lat) {
  const phi = Math.max(-89.9, Math.min(89.9, lat)) * DEG;
  const phi2 = phi * phi;
  // Screen y grows downward, so north is negative.
  return 0 - (phi * (K1 + phi2 * phi2 * (K2 + phi2 * (K3 + K4 * phi2)))) / DEG; // 0 - x avoids -0
}

export function project(lon, lat) {
  return [lon, projectY(lat)];
}

export const Y_TOP = projectY(LAT_MAX);
export const Y_BOTTOM = projectY(LAT_MIN);
