/*
  Terrain tiles as Traxx's GL view shows them (COpenGLTerrainRenderer::GetTexture with
  CTraxxView::UpdatePalette):

    - a legacy tile is remapped into the track palette (CTrackPODPalette::RemapTexture, from
      its own .ACT or metalcr2), then coloured through the track palette with the gamma curve
      applied to the palette (255 * (c / 255) ^ (1 / gamma));
    - a tile with HD art shows the HD image instead, without gamma (the true-colour resolver);
    - a missing tile is Traxx's blank 64 x 64 one: palette entry 0.

  Tiles go into two arrays by size, 64 and 256 texels a side, so a few large tiles do not
  inflate every small one. Pure: HD images arrive already decoded.
*/
import type { TrackDocument, TextureAsset } from "../doc/document.ts";
import { metalcr2Act3, remapIndices } from "../traxx/palette.ts";

export const SMALL = 64;
export const LARGE = 256;

export interface RgbaImage { width: number; height: number; rgba: Uint8Array | Uint8ClampedArray }

export interface TileArray { side: number; count: number; rgba: Uint8Array }

export interface TileSet {
  small: TileArray;
  large: TileArray;
  /**
   * Per texture index: where its tile is, as (array << 15) | layer, array 0 small and 1
   * large; and the tile's legacy side (64 or 256), which Traxx's UV inset follows. -1 for a
   * texture index with no tile (drawn with the fallback colour).
   */
  where: Int32Array;
  side: Uint16Array;
}

export function gammaMap(gamma: number): Uint8Array {
  const map = new Uint8Array(256);
  for (let c = 0; c < 256; c++) map[c] = Math.trunc(255 * Math.pow(c / 255, 1 / gamma));
  return map;
}

/** Nearest-sample `src` (w x h, RGBA) into `dst` at `offset`, side x side. */
function resample(src: Uint8Array | Uint8ClampedArray, w: number, h: number, dst: Uint8Array, offset: number, side: number): void {
  for (let y = 0; y < side; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / side));
    for (let x = 0; x < side; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / side));
      const s = (sy * w + sx) * 4, d = offset + (y * side + x) * 4;
      dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = 255;
    }
  }
}

/** A legacy tile's pixels as track palette indices, as Traxx's texture database holds them. */
export function trackIndices(tex: TextureAsset, trackPalette: Uint8Array): Uint8Array | null {
  if (!tex.indices || tex.side === 0) return null;
  return tex.trackIndexed ? tex.indices : remapIndices(tex.indices, tex.act ?? metalcr2Act3(), trackPalette);
}

/** A legacy tile's RGBA as Traxx draws it. */
export function legacyTileRgba(tex: TextureAsset, trackPalette: Uint8Array, gamma: Uint8Array): RgbaImage | null {
  if (!tex.indices || tex.side === 0) return null;
  const indices = tex.trackIndexed ? tex.indices : remapIndices(tex.indices, tex.act ?? metalcr2Act3(), trackPalette);
  const n = tex.side * tex.side;
  const rgba = new Uint8Array(n * 4);
  for (let p = 0; p < n; p++) {
    const c = indices[p] * 3;
    rgba[p * 4] = gamma[trackPalette[c]];
    rgba[p * 4 + 1] = gamma[trackPalette[c + 1]];
    rgba[p * 4 + 2] = gamma[trackPalette[c + 2]];
    rgba[p * 4 + 3] = 255;
  }
  return { width: tex.side, height: tex.side, rgba };
}

/**
  A tile in its own colours, as Copy puts it on the clipboard: through its .ACT (metalcr2 when
  it has none), or the track palette for a tile already in it.
*/
export function sourceTileRgba(tex: TextureAsset, trackPalette: Uint8Array): RgbaImage | null {
  if (!tex.indices || tex.side === 0) return null;
  const pal = tex.trackIndexed ? trackPalette : tex.act ?? metalcr2Act3();
  const n = tex.side * tex.side;
  const rgba = new Uint8Array(n * 4);
  for (let p = 0; p < n; p++) {
    const c = tex.indices[p] * 3;
    rgba.set([pal[c], pal[c + 1], pal[c + 2], 255], p * 4);
  }
  return { width: tex.side, height: tex.side, rgba };
}

/**
 * Every terrain tile of a document. `hd` holds decoded HD images by texture index; a texture
 * with one shows it.
 */
export function buildTileSet(doc: TrackDocument, gammaValue: number, hd: ReadonlyMap<number, RgbaImage> = new Map()): TileSet {
  const gamma = gammaMap(gammaValue);
  const palette = doc.track.palette;
  const count = doc.textures.length;
  const where = new Int32Array(count).fill(-1);
  const side = new Uint16Array(count);
  const images: (RgbaImage | null)[] = [];
  let nSmall = 0, nLarge = 0;
  const plan: { index: number; large: boolean; layer: number; image: RgbaImage }[] = [];
  for (let i = 0; i < count; i++) {
    const tex = doc.textures[i];
    if (!tex) { images.push(null); continue; }
    const image = hd.get(i) ?? legacyTileRgba(tex, palette, gamma) ?? (tex.bad ? blank(palette, gamma) : null);
    images.push(image);
    if (!image) continue;
    // Traxx's UV inset follows the legacy size: 256 for a 256 tile, else 64.
    side[i] = tex.side === 256 || (tex.side === 0 && image.width >= 256) ? 256 : 64;
    const large = image.width > SMALL || image.height > SMALL;
    const layer = large ? nLarge++ : nSmall++;
    where[i] = ((large ? 1 : 0) << 15) | layer;
    plan.push({ index: i, large, layer, image });
  }
  const small: TileArray = { side: SMALL, count: Math.max(1, nSmall), rgba: new Uint8Array(SMALL * SMALL * 4 * Math.max(1, nSmall)) };
  const large: TileArray = { side: LARGE, count: Math.max(1, nLarge), rgba: new Uint8Array(LARGE * LARGE * 4 * Math.max(1, nLarge)) };
  for (const p of plan) {
    const target = p.large ? large : small;
    resample(p.image.rgba, p.image.width, p.image.height, target.rgba, p.layer * target.side * target.side * 4, target.side);
  }
  return { small, large, where, side };
}

/** Traxx's "bad" tile: 64 x 64 of palette entry 0. */
function blank(palette: Uint8Array, gamma: Uint8Array): RgbaImage {
  const rgba = new Uint8Array(64 * 64 * 4);
  for (let p = 0; p < 64 * 64; p++) rgba.set([gamma[palette[0]], gamma[palette[1]], gamma[palette[2]], 255], p * 4);
  return { width: 64, height: 64, rgba };
}

/*
  COpenGLTerrainRenderer::TextureAlignment: the texel each corner of a cell's triangle samples.
  Corners are numbered v00 = 0, v10 = 1, v11 = 2, v01 = 3. The CLR word's mirror bits (12, 13)
  and rotation (14, 15) permute them; the texels are inset 2 from the edge.
*/
const TSEQ64: [number, number][] = [[2, 62], [62, 62], [62, 2], [2, 2]];
const TSEQ256: [number, number][] = [[2, 253], [253, 253], [253, 2], [2, 2]];

export function cornerUv(corner: number, clrWord: number, side: number): [number, number] {
  const talign = (clrWord & 0xc000) >> 14;
  const tmirror = (clrWord & 0x3000) >> 12;
  let b = corner;
  if (tmirror & 1) b = (3 - b) & 3;
  if (tmirror & 2) b = (1 - b) & 3;
  b = (talign + b) & 3;
  const seq = side === 256 ? TSEQ256 : TSEQ64;
  return [seq[b][0] / side, seq[b][1] / side];
}
