/*
  The terrain modes Traxx 1.7 adds (TrackPOD/TrackPODTerrain.cpp, "Terrain mode and the 16-bit
  grids"; Include/TrackPODTerrain.h).

  A classic track has only the 8-bit heights (raw). Any other mode adds the authoritative grid:
  h16 (256 x 256 u16, CLASSIC16 and SPLINE) or fine (1024 x 1024 u16, FINE). Height units are
  1/256 of a terrain step, so feet = v / 128 (one step is 2 ft). raw then becomes the 8-bit
  mirror of that grid so everything that reads raw keeps working, and rawShadow remembers what
  the mirror last wrote, so syncFromRaw can tell which raw cells an 8-bit tool has edited since.

  Plain data on the track record (TxxTrack): terrainMode, h16, fine, rawShadow, heights (raw).
*/

import { asU16, cellsOf, cellShiftOf, newHeightGrid, type HeightGrid } from "./world.ts";

export const TERRAINMODE_CLASSIC8 = 0;
export const TERRAINMODE_CLASSIC16 = 1;
export const TERRAINMODE_SPLINE = 2;
export const TERRAINMODE_FINE = 3;

/** TERRAIN_FINE: the side of the Full Map grid. */
export const TERRAIN_FINE = 1024;
/** RAWLEN_8BIT, RAWLEN_16BIT, RAWLEN_FINE: the height file sizes Traxx reads. */
export const RAWLEN_8BIT = 256 * 256;
export const RAWLEN_16BIT = 256 * 256 * 2;
export const RAWLEN_FINE = TERRAIN_FINE * TERRAIN_FINE * 2;

/** The part of a track record the terrain modes touch. */
export interface Terrain16 {
  terrainMode: number;
  /** Format version 6: cells a side, 256 (absent) or 512 (world.ts). Every grid below is N x N or 4N x 4N. */
  worldCells?: number;
  /** CLASSIC16 and SPLINE: N x N heights, x + N z (Int32Array on a version 6 track, world.ts). */
  h16: HeightGrid | null;
  /** FINE: 4N x 4N heights, x + 4N z. */
  fine: HeightGrid | null;
  /** What the mirror last wrote into `heights`; null on a classic track. */
  rawShadow: Uint8Array | null;
  /** The 8-bit heights (raw): the data on a classic track, the mirror otherwise. */
  heights: Uint8Array;
}

/**
  MirrorOf: a 16-bit height rounded to the nearest 8-bit step, capped at 255. A version 6 height
  below 0 ft (spec section 7.3) mirrors as 0.
*/
export function mirrorOf(v: number): number {
  const m = (v + 128) >> 8;
  return m > 255 ? 255 : m < 0 ? 0 : m;
}

/**
  RefreshRaw: raw becomes the mirror of the 16-bit data (a Full Map's points on the 32 ft grid,
  fine[4z][4x]) and the shadow is brought level with it. Nothing on a classic track.
*/
export function refreshRaw(t: Terrain16): void {
  if (t.terrainMode === TERRAINMODE_CLASSIC8) return;
  const raw = t.heights;
  const n = cellsOf(t), sh = cellShiftOf(n);
  if (t.fine) {
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) raw[x + (z << sh)] = mirrorOf(t.fine[((4 * z) << (sh + 2)) + 4 * x]!);
    }
  } else if (t.h16) {
    for (let i = 0; i < n * n; i++) raw[i] = mirrorOf(t.h16[i]!);
  } else return;
  if (t.rawShadow) t.rawShadow.set(raw);
}

/**
  SyncFromRaw: fold the 8-bit edits made since the mirror was last written back into the real
  data. On CLASSIC16 and SPLINE each raw cell that differs from the shadow becomes raw << 8 in
  h16. On a Full Map an 8-bit edit has no meaning, so the mirror wins back (RefreshRaw), and only
  when raw really differs from the shadow. Returns whether anything changed.
*/
export function syncFromRaw(t: Terrain16): boolean {
  const raw = t.heights;
  if (t.fine) {
    if (t.rawShadow && sameBytes(raw, t.rawShadow)) return false;
    refreshRaw(t);
    return true;
  }
  if (!t.h16 || !t.rawShadow) return false;
  let changed = false;
  const cells = cellsOf(t) * cellsOf(t);
  for (let i = 0; i < cells; i++) {
    if (raw[i] !== t.rawShadow[i]) {
      t.h16[i] = (raw[i] << 8) & 0xffff;
      t.rawShadow[i] = raw[i];
      changed = true;
    }
  }
  return changed;
}

/** RawFileLength: the height file's size for the track's mode (SPLINE is always 16-bit). */
export function rawFileLength(t: Pick<Terrain16, "terrainMode" | "fine">): number {
  if (t.fine) return RAWLEN_FINE;
  if (t.terrainMode === TERRAINMODE_CLASSIC8) return RAWLEN_8BIT;
  return RAWLEN_16BIT;
}

/**
  SaveRaw: the height file's bytes, after SyncFromRaw; u16 little-endian outside classic. This is
  CP4's file (0..65535 v): a version 6 32-bit grid is clamped into it, so a version 6 writer
  stores its heights with step and base instead (spec section 7.1).
*/
export function saveRaw(t: Terrain16): Uint8Array {
  syncFromRaw(t);
  const cells = cellsOf(t) * cellsOf(t);
  if (t.terrainMode === TERRAINMODE_CLASSIC8) return t.heights.slice(0, cells);
  const grid = t.fine ?? t.h16;
  if (!grid) return t.heights.slice(0, cells);
  const src = asU16(grid);
  const out = new Uint8Array(src.length * 2);
  for (let i = 0; i < src.length; i++) { out[2 * i] = src[i] & 255; out[2 * i + 1] = src[i] >> 8; }
  return out;
}

/** The u16 little-endian words of a height file. */
export function wordsOf(bytes: Uint8Array, count: number): Uint16Array {
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = bytes[2 * i] | (bytes[2 * i + 1] << 8);
  return out;
}

/**
  LoadRaw, then SetMode when the .TXV asks for another mode: `bytes` as a height file of a size
  Traxx knows, into the track. Returns false (and changes nothing) for any other size, which the
  callers then handle as LoadRawLegacy or a refusal does.
*/
export function loadRaw(t: Terrain16, bytes: Uint8Array): boolean {
  const n = bytes.length;
  if (n === RAWLEN_8BIT) {
    t.terrainMode = TERRAINMODE_CLASSIC8;
    t.h16 = t.fine = t.rawShadow = null;
    t.heights.set(bytes.subarray(0, RAWLEN_8BIT));
    return true;
  }
  if (n === RAWLEN_16BIT) {
    t.terrainMode = TERRAINMODE_CLASSIC16;
    t.h16 = wordsOf(bytes, 256 * 256);
    t.fine = null;
  } else if (n === RAWLEN_FINE) {
    t.terrainMode = TERRAINMODE_FINE;
    t.fine = wordsOf(bytes, TERRAIN_FINE * TERRAIN_FINE);
    t.h16 = null;
  } else return false;
  t.rawShadow = new Uint8Array(RAWLEN_8BIT);
  refreshRaw(t);
  return true;
}

/**
  ParseTerrainGridKey: "terrainGrid = value" out of the whole .TXV text, the first such line,
  '#' lines skipped, key and value case-insensitive with the blanks around them trimmed. -1 when
  there is no key, the mode for classic / spline / fine, -2 for any other value.
*/
export function parseTerrainGridKey(txv: string | null): number {
  const value = txvKey(txv, "terraingrid");
  if (value === null) return -1;
  const v = value.toLowerCase();
  if (v === "classic") return TERRAINMODE_CLASSIC8;
  if (v === "spline") return TERRAINMODE_SPLINE;
  if (v === "fine") return TERRAINMODE_FINE;
  return -2;
}

/** ParseTerrainHeightsKey: the terrainHeights= value, verbatim but trimmed; "" for none. */
export function parseTerrainHeightsKey(txv: string | null): string {
  return txvKey(txv, "terrainheights") ?? "";
}

/** The value of the first `key` line, by the rules ParseTerrainGridKey reads with; null when absent. */
function txvKey(txv: string | null, key: string): string | null {
  if (!txv) return null;
  for (const line of txv.split(/[\r\n]+/)) {
    const s = line.replace(/^[ \t]+/, "");
    if (!s || s[0] === "#") continue;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    if (s.slice(0, eq).replace(/[ \t]+$/, "").toLowerCase() !== key) continue;
    return s.slice(eq + 1).replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
  }
  return null;
}

/**
  ResolveTerrainMode: the height file's size decides the data; the key can only say that a
  256 x 256 file is the smooth SPLINE surface. A mismatch is shown in the closest mode with a
  warning (Traxx's own words), never refused.
*/
export function resolveTerrainMode(key: number, rawLength: number): { mode: number; warning: string | null } {
  if (rawLength === RAWLEN_FINE) {
    let warning: string | null = null;
    if (key === TERRAINMODE_SPLINE) warning = "The track's .TXV says terrainGrid=spline but its height file is 1024x1024; showing it as a 16-bit Full Map track.";
    else if (key === -2) warning = "The track's .TXV has a terrainGrid value this Traxx does not know; a newer Traxx is needed, and the height file is being shown as a 16-bit Full Map track.";
    else if (key === TERRAINMODE_CLASSIC8) warning = "The track's .TXV says terrainGrid=classic but its height file is 1024x1024; showing it as a 16-bit Full Map track.";
    else if (key !== TERRAINMODE_FINE) warning = "The track's .TXV has no terrainGrid key (or no .TXV) but its height file is 1024x1024; showing it as a 16-bit Full Map track.";
    return { mode: TERRAINMODE_FINE, warning };
  }
  let mode = rawLength === RAWLEN_16BIT ? TERRAINMODE_CLASSIC16 : TERRAINMODE_CLASSIC8;
  let warning: string | null = null;
  if (key === TERRAINMODE_SPLINE) mode = TERRAINMODE_SPLINE;
  else if (key === TERRAINMODE_FINE) warning = "The track's .TXV says terrainGrid=fine but its height file is 256x256; showing it as a Classic 8-bit or 16-bit (32 ft) track.";
  else if (key === -2) warning = "The track's .TXV has a terrainGrid value this Traxx does not know; a newer Traxx is needed, and the height file is being shown as a Classic 8-bit or 16-bit (32 ft) track.";
  return { mode, warning };
}

/**
  SetMode, for the one conversion opening a track needs: a CLASSIC8 or CLASSIC16 grid called
  SPLINE by its .TXV (h16 = raw << 8 when there is no h16 yet). The Terrain Grid conversions
  that rebuild the surface (to and from a Full Map) are not ported yet; asked for one, this
  returns false and leaves the track as it is.
*/
export function setModeOnLoad(t: Terrain16, mode: number): boolean {
  if (mode === t.terrainMode) return true;
  if (mode !== TERRAINMODE_SPLINE || t.fine) return false;
  syncFromRaw(t);
  const n = cellsOf(t);
  if (!t.h16) {
    t.h16 = newHeightGrid(n * n, false);
    for (let i = 0; i < n * n; i++) t.h16[i] = t.heights[i]! << 8;
  }
  t.rawShadow ??= t.heights.slice(0, n * n);
  t.terrainMode = mode;
  refreshRaw(t);
  return true;
}

/** "Classic 8-bit", "16-bit", "16-bit Spline", "16-bit Full Map" (TerrainModeName). */
export function terrainModeName(mode: number): string {
  if (mode === TERRAINMODE_CLASSIC16) return "16-bit";
  if (mode === TERRAINMODE_SPLINE) return "16-bit Spline";
  if (mode === TERRAINMODE_FINE) return "16-bit Full Map";
  return "Classic 8-bit";
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
