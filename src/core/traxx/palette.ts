/*
  The track palette, as Traxx keeps it (TrackPOD/TrackPODPalette.cpp, Traxx/TraxxDoc.cpp).

  Traxx holds 256 entries, of which 246..255 are always the ten Windows system colours: every
  Create, Load and Reset writes them over whatever the file had. Textures are held as indices
  into this palette, remapped from their own .ACT by nearest colour over entries 0..245.
*/
import { fromBase64 } from "./bytes.ts";
import { DEFAULT_BROWSE_BMP_B64, DEFAULT_FOGMAP_RLE_B64, DEFAULT_ICON_BMP_B64, METALCR2_ACT3_B64, STOCK_PALETTES_B64 } from "./stock-data.ts";

/** syscolors[10] (TrackPODPalette.cpp): RGB for entries 246..255. */
export const SYS_COLORS: readonly [number, number, number][] = [
  [224, 224, 224], [160, 160, 164], [128, 128, 128], [255, 0, 0], [0, 255, 0],
  [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];

/** The palette with entries 246..255 set to the system colours. A new array. */
export function withSysColors(rgb: Uint8Array): Uint8Array {
  const out = new Uint8Array(768);
  out.set(rgb.subarray(0, 768));
  SYS_COLORS.forEach(([r, g, b], i) => out.set([r, g, b], (246 + i) * 3));
  return out;
}

/** CTrackPODPalette::Reset: all black but the system colours. */
export function emptyPalette(): Uint8Array {
  return withSysColors(new Uint8Array(768));
}

let metalcr2: Uint8Array | null = null;
/** metalcr2_act3: the palette a texture with no .ACT of its own is read against. */
export function metalcr2Act3(): Uint8Array {
  return (metalcr2 ??= fromBase64(METALCR2_ACT3_B64));
}

export const STOCK_PALETTE_COUNT = 16;
/** Index 16 in the fog map's first byte: the track's own palette (SelectMTM2Palette(pe[256])). */
export const CUSTOM_PALETTE_INDEX = 16;

export function stockPaletteName(index: number): string {
  return STOCK_PALETTES_B64[index]?.name ?? "Custom";
}

/** Stock palette 0..15 (palresid order), 768 RGB bytes. */
export function stockPalette(index: number): Uint8Array {
  const entry = STOCK_PALETTES_B64[index];
  if (!entry) throw new RangeError(`no stock palette ${index}`);
  return fromBase64(entry.data);
}

/*
  The default MTM2 fog map (AssignDefMTM2Fogmap): value, run-length byte pairs expanding to
  32768 bytes. Its first byte is 0, which is how Traxx records "stock palette 0".
*/
export function defaultFogMap(): Uint8Array {
  const rle = fromBase64(DEFAULT_FOGMAP_RLE_B64);
  const out = new Uint8Array(32768);
  let i = 0, j = 0;
  while (j < 32768 && i + 1 < rle.length) {
    const value = rle[i++], run = rle[i++];
    out.fill(value, j, Math.min(32768, j + run));
    j += run;
  }
  return out;
}

export function defaultBrowseBmp(): Uint8Array {
  return fromBase64(DEFAULT_BROWSE_BMP_B64);
}

export function defaultIconBmp(): Uint8Array {
  return fromBase64(DEFAULT_ICON_BMP_B64);
}

/*
  Which stock palette a track uses: Traxx keeps it in the fog map's FIRST BYTE
  (CTraxxDoc::LoadMTM2Palette). No fog map, or a value over 16, means 0.
*/
export function paletteIndexFromFogMap(fogMap: Uint8Array | null): number {
  if (!fogMap || fogMap.length === 0) return 0;
  return fogMap[0] > CUSTOM_PALETTE_INDEX ? 0 : fogMap[0];
}

export interface Mtm2PaletteResult {
  palette: Uint8Array;
  fogMap: Uint8Array | null;
  logoBmp: Uint8Array | null;
  mapBmp: Uint8Array | null;
}

/*
  CTraxxDoc::LoadMTM2Palette, run on a new track, a clone and every opened .TXX (not on a POD,
  whose load resets the palette and reads its own):

    - the palette becomes the stock one the fog map's first byte names, keeping its name;
    - when that index is 0 the default fog map is put in, replacing the track's own;
    - a track with no small or large picture (and no HD art in that slot) gets the default ones.

  Index 16, a custom palette, reads one past the end of Traxx's table, so the resource lookup
  fails and the track's palette stays as it is; that is what this does on purpose.
*/
export function applyMtm2Palette(current: { palette: Uint8Array; fogMap: Uint8Array | null; logoBmp: Uint8Array | null; mapBmp: Uint8Array | null; logoHd: boolean; mapHd: boolean }): Mtm2PaletteResult {
  const index = paletteIndexFromFogMap(current.fogMap);
  let palette = current.palette;
  let fogMap = current.fogMap;
  if (index < STOCK_PALETTE_COUNT) {
    palette = withSysColors(stockPalette(index));
    if (index === 0) fogMap = defaultFogMap();
  }
  return {
    palette,
    fogMap,
    logoBmp: current.logoBmp ?? (current.logoHd ? null : defaultBrowseBmp()),
    mapBmp: current.mapBmp ?? (current.mapHd ? null : defaultIconBmp()),
  };
}

/*
  CTrackPODPalette::RemapTexture: each of the source palette's 256 colours goes to the nearest
  of the track palette's first 246 entries (squared RGB distance, first match on ties), and the
  pixels are rewritten through that table. Returns new pixels.
*/
export function remapIndices(indices: Uint8Array, sourcePalette: Uint8Array, trackPalette: Uint8Array): Uint8Array {
  const map = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const r = sourcePalette[i * 3], g = sourcePalette[i * 3 + 1], b = sourcePalette[i * 3 + 2];
    let best = 1000000, match = 0;
    for (let j = 0; j < 246; j++) {
      const dr = trackPalette[j * 3] - r;
      let d = dr * dr;
      if (d >= best) continue;
      const dg = trackPalette[j * 3 + 1] - g;
      d += dg * dg;
      if (d >= best) continue;
      const db = trackPalette[j * 3 + 2] - b;
      d += db * db;
      if (d >= best) continue;
      best = d;
      match = j;
    }
    map[i] = match;
  }
  const out = new Uint8Array(indices.length);
  for (let p = 0; p < indices.length; p++) out[p] = map[indices[p]];
  return out;
}

/*
  The fog map Traxx builds for a palette it did not ship (CTraxxDoc::SelectMTM2Palette): for
  each 8-step RGB cube corner (plus a bias of 3) the nearest of entries 10..229, later entries
  winning ties; then the first byte is overwritten with the palette index, Traxx's "botch"
  that records which palette the track uses.
*/
export function traxxFogMap(palette: Uint8Array, paletteIndex: number): Uint8Array {
  const out = new Uint8Array(32768);
  let o = 0;
  for (let r = 0; r < 256; r += 8) {
    for (let g = 0; g < 256; g += 8) {
      for (let b = 0; b < 256; b += 8) {
        let best = 10000000, index = 0;
        for (let col = 10; col < 230; col++) {
          let diff = palette[col * 3] - (r + 3);
          let dist = diff * diff;
          if (dist > best) continue;
          diff = palette[col * 3 + 1] - (g + 3);
          dist += diff * diff;
          if (dist > best) continue;
          diff = palette[col * 3 + 2] - (b + 3);
          dist += diff * diff;
          if (dist > best) continue;
          best = dist;
          index = col;
        }
        out[o++] = index;
      }
    }
  }
  out[0] = paletteIndex;
  return out;
}

/*
  Marks a track's palette as its own (index 16), so opening its .TXX keeps it instead of
  swapping in a stock palette. A stock POD's fog map starts with 0, which Traxx would read
  as "stock palette 0". The fog map is kept and only its first byte changes, as
  SelectMTM2Palette does; a track with none gets one built from its palette.
*/
export function markCustomPalette(track: { palette: Uint8Array; fogMap: Uint8Array | null }): void {
  if (track.fogMap) {
    const fog = new Uint8Array(track.fogMap);
    fog[0] = CUSTOM_PALETTE_INDEX;
    track.fogMap = fog;
  } else {
    track.fogMap = traxxFogMap(track.palette, CUSTOM_PALETTE_INDEX);
  }
}
