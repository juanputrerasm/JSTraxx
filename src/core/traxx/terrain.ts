/*
  Terrain and naming rules from TrackPOD (TrackPODTerrain.cpp, TrackPOD.cpp).
*/

export const GRID = 256;
export const CELLS = GRID * GRID;
/** One terrain cell in ipos units (half SIT units). */
export const CELL_IPOS = 64;
/** The light byte a flat new track gets (CTrackPODTerrain::Reset: BuildLte(0xed, 0xed)). */
export const FLAT_LTE = 0xed;
export const POD1_TRACK_STEM_MAX = 20;
export const POD1_TOOL_STEM_MAX = 18;

/*
  CTrackPODTerrain::InterpolateRawAtPoint: the terrain height under an ipos point, in whole
  steps. Cells split along a checkerboard diagonal; the last row and column read the corner
  value. Float maths and the final (int) truncation are kept, so results match Traxx's.
*/
export function interpolateRawAtPoint(raw: Uint8Array, wx: number, wy: number): number {
  const gx = (wx >> 6) & 255, gy = (wy >> 6) & 255;
  if (gx === 255 || gy === 255) return raw[gx + (gy << 8)];
  const xoff = wx - (gx << 6), yoff = wy - (gy << 6);
  let x0, x1, x2, y0, y1, y2, z0, z1, z2;
  if ((gx + gy) & 1) {
    if (64 - xoff >= yoff) {
      x0 = 0; x1 = 64; x2 = 0; y0 = 0; y1 = 0; y2 = 64;
      z0 = raw[gx + (gy << 8)]; z1 = raw[gx + 1 + (gy << 8)]; z2 = raw[gx + ((gy + 1) << 8)];
    } else {
      x0 = 64; x1 = 0; x2 = 64; y0 = 64; y1 = 64; y2 = 0;
      z0 = raw[gx + 1 + ((gy + 1) << 8)]; z1 = raw[gx + ((gy + 1) << 8)]; z2 = raw[gx + 1 + (gy << 8)];
    }
  } else if (xoff >= yoff) {
    x0 = 0; x1 = 64; x2 = 64; y0 = 0; y1 = 0; y2 = 64;
    z0 = raw[gx + (gy << 8)]; z1 = raw[gx + 1 + (gy << 8)]; z2 = raw[gx + 1 + ((gy + 1) << 8)];
  } else {
    x0 = 64; x1 = 0; x2 = 0; y0 = 64; y1 = 64; y2 = 0;
    z0 = raw[gx + 1 + ((gy + 1) << 8)]; z1 = raw[gx + ((gy + 1) << 8)]; z2 = raw[gx + (gy << 8)];
  }
  const f = Math.fround;
  const denom = (x1 - x2) * (y0 - y1) - (x0 - x1) * (y1 - y2);
  const b = f(f((x1 - x2) * (z0 - z1) - (x0 - x1) * (z1 - z2)) / f(denom));
  const a = f(f(f(z0 - z1) - f(b * (y0 - y1))) / f(x0 - x1));
  const c = f(f(z0 - f(a * x0)) - f(b * y0));
  return Math.trunc(f(f(f(a * xoff) + f(b * yoff)) + c));
}

/** A flat light plane: ground byte `value`, the other six zero (BuildLte with min == max). */
export function flatLte(value = FLAT_LTE): Uint8Array {
  const lte = new Uint8Array(CELLS * 7);
  for (let c = 0; c < CELLS; c++) lte[c * 7] = value;
  return lte;
}

/*
  Pod1StemFromText: letters and digits only, upper case, at most 18 characters. How the stem
  is derived from the track name, and how a typed stem is cleaned.
*/
export function stemFromText(text: string): string {
  let out = "";
  for (const ch of text) {
    if (out.length >= POD1_TOOL_STEM_MAX) break;
    if (/[A-Za-z0-9]/.test(ch)) out += ch.toUpperCase();
  }
  return out;
}

/*
  CTrackPOD::InferPrefixMode: after a load, a stem that is exactly what the name derives (or
  a name that derives nothing) stays automatic; any other stem was chosen and is kept.
*/
export function inferPrefixAuto(trackName: string, prefix: string): boolean {
  const derived = stemFromText(trackName);
  return derived === "" || derived === prefix;
}

/** UIBitmapName: the preserved name, else <stem><suffix>.BMP. */
export function uiBitmapName(preserved: string, stem: string, suffix: "S" | "L"): string {
  return preserved || `${stem}${suffix}.BMP`;
}

/*
  CTrackPOD::UIInfoName: the info photo's entry name (without UI\), the logo name with its
  trailing S (or T) swapped for M; "" when the logo does not follow that convention.
*/
export function uiInfoName(logoName: string): string {
  if (!logoName) return "";
  const dot = logoName.lastIndexOf(".");
  let stem = dot >= 0 ? logoName.slice(0, dot) : logoName;
  if (stem.length < 2 || !/[SsTt]$/.test(stem)) return "";
  stem = stem.slice(0, -1);
  return `${stem}M.BMP`;
}
