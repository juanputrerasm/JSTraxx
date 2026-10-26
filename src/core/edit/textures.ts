/*
  Texture editing on the CLR grid, as Traxx does it (Traxx/TraxxViewEdit.cpp). A CLR word is
  the texture index (bits 0-11), mirror (12, 13) and rotation (14, 15).

  `Area` is an inclusive cell rectangle (texturefirst .. texturelast).
*/
import type { TrackDocument } from "../doc/document.ts";
import type { TxxAnimation } from "../traxx/txx.ts";

export interface Area { x0: number; y0: number; x1: number; y1: number }

const inMap = (x: number, y: number) => x >= 0 && x <= 255 && y >= 0 && y <= 255;

/** ApplyTexture: every cell of the area to texture `index`, unrotated and unmirrored. */
export function applyTexture(clr: Uint16Array, a: Area, index: number): void {
  for (let j = a.y0; j <= a.y1; j++) for (let i = a.x0; i <= a.x1; i++) if (inMap(i, j)) clr[i + (j << 8)] = index;
}

/** FloodTexture (Replace): every cell showing the texture of (x, y) becomes `index`. */
export function floodTexture(clr: Uint16Array, x: number, y: number, index: number): void {
  const key = clr[x + (y << 8)] & 0x0fff;
  for (let c = 0; c < 65536; c++) if ((clr[c] & 0x0fff) === key) clr[c] = index;
}

/** OnTextureMirror: each cell's mirror bit 12 flipped. */
export function mirrorCells(clr: Uint16Array, a: Area): void {
  for (let j = a.y0; j <= a.y1; j++) for (let i = a.x0; i <= a.x1; i++) clr[i + (j << 8)] ^= 0x1000;
}

/** OnTextureRotate90: each cell's rotation one quarter on. */
export function rotateCells(clr: Uint16Array, a: Area): void {
  for (let j = a.y0; j <= a.y1; j++) for (let i = a.x0; i <= a.x1; i++) {
    const c = i + (j << 8);
    clr[c] = (clr[c] & 0x3fff) | ((((clr[c] >> 14) + 1) & 3) << 14);
  }
}

/*
  OnTextureAreaRot90: the area turned a quarter about its first corner. A w x h area becomes
  h x w, written from the same corner (so a non-square area writes outside its rectangle, as
  Traxx's does). Each cell's own rotation goes one quarter on, or back for a mirrored cell.
  Returns the rectangle written.
*/
export function rotateArea(clr: Uint16Array, a: Area): Area {
  const w = a.x1 - a.x0 + 1, h = a.y1 - a.y0 + 1;
  const temp = new Uint16Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) temp[i + j * w] = clr[i + a.x0 + ((j + a.y0) << 8)];
  for (let j = 0; j < w; j++) for (let i = 0; i < h; i++) {
    if (!inMap(i + a.x0, j + a.y0)) continue;
    let word = temp[(w - 1 - j) + i * w];
    let arg = word >> 14;
    // (arg - 1) % 4 in C is -1 for 0, which sets every high bit: rotation 3.
    arg = word & 0x1000 ? (arg + 3) & 3 : (arg + 1) & 3;
    word = (word & 0x3fff) | (arg << 14);
    clr[i + a.x0 + ((j + a.y0) << 8)] = word;
  }
  return { x0: a.x0, y0: a.y0, x1: Math.min(255, a.x0 + h - 1), y1: Math.min(255, a.y0 + w - 1) };
}

/** OnTextureAreaMirror: the area's rows reversed, each cell's mirror bit 12 flipped. */
export function mirrorArea(clr: Uint16Array, a: Area): void {
  const w = a.x1 - a.x0 + 1, h = a.y1 - a.y0 + 1;
  const temp = new Uint16Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) temp[i + j * w] = clr[i + a.x0 + ((j + a.y0) << 8)];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) clr[i + a.x0 + ((j + a.y0) << 8)] = temp[i + (h - 1 - j) * w] ^ 0x1000;
}

/*
  OnTextureAreaPaste from a copied area. Copy Area records only where the copy was taken
  (texturecopyfirst), so the paste reads those cells as they are now, at the size of the area
  pasted into; cells beyond the map read as 0.
*/
export function pasteArea(clr: Uint16Array, from: { x: number; y: number }, a: Area): void {
  const w = a.x1 - a.x0 + 1, h = a.y1 - a.y0 + 1;
  const temp = new Uint16Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) temp[i + j * w] = inMap(i + from.x, j + from.y) ? clr[i + from.x + ((j + from.y) << 8)] : 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (inMap(i + a.x0, j + a.y0)) clr[i + a.x0 + ((j + a.y0) << 8)] = temp[i + j * w];
}

/*
  The transition table (transmap): for the four corners' above/below mask, which cell of the
  Transitions dialog's 3 x 3 grid to use; [4, 4] means the base texture.
*/
const TRANSMAP: [number, number][] = [[4, 4], [0, 2], [0, 0], [0, 1], [2, 2], [1, 2], [1, 1], [1, 1], [2, 0], [1, 1], [1, 0], [1, 1], [2, 1], [1, 1], [1, 1], [1, 1]];

export interface TransitionSettings {
  /** The height that divides the two textures. */
  threshold: number;
  /** The 3 x 3 grid of edge textures, tgrid[x][y]; -1 for none. */
  grid: number[][];
  /** The base texture (below the threshold, or above with Invert). */
  base: number;
  invert: boolean;
  fillToMin: boolean;
  minAlt: number;
  fillToMax: boolean;
  maxAlt: number;
}

/*
  TransitionTexture: each cell of the area takes the edge texture its corners call for (a
  corner at or over the threshold, or at or under it with Invert, sets its bit); cells wholly
  on one side take the base or the middle texture when the matching "fill" is on and every
  corner is within its altitude.
*/
export function transitionTextures(clr: Uint16Array, raw: Uint8Array, a: Area, t: TransitionSettings): void {
  for (let j = a.y0; j <= a.y1; j++) {
    const jj = j << 8;
    for (let i = a.x0; i <= a.x1; i++) {
      const r = [raw[i + jj], raw[((i + 1) & 255) + jj], raw[i + ((jj + 256) & 0xff00)], raw[((i + 1) & 255) + ((jj + 256) & 0xff00)]];
      let mask = 0;
      r.forEach((v, k) => { if (t.invert ? v <= t.threshold : v >= t.threshold) mask |= 1 << k; });
      let index = -1;
      const allAtLeast = (m: number) => r.every((v) => v >= m);
      const allAtMost = (m: number) => r.every((v) => v <= m);
      if (mask === 0) {
        if (t.invert ? t.fillToMax && allAtMost(t.maxAlt) : t.fillToMin && allAtLeast(t.minAlt)) index = t.base;
      } else if (mask === 15) {
        if (t.invert ? t.fillToMin && allAtLeast(t.minAlt) : t.fillToMax && allAtMost(t.maxAlt)) index = t.grid[1][1];
      } else {
        const [x, y] = TRANSMAP[mask];
        index = t.grid[x][y];
      }
      if (index >= 0) clr[i + jj] = index;
    }
  }
}

/** The texture indices nothing uses: not on the terrain, a ground-box face or an animation frame. */
export function unusedTextures(doc: TrackDocument): number[] {
  const t = doc.track;
  const used = new Set<number>();
  for (const w of t.clr) used.add(w & 0x0fff);
  for (const g of t.groundBoxes) for (const f of g.faces) used.add(f & 0x0fff);
  for (const a of t.animations) for (let k = 0; k < a.nframes; k++) used.add(a.frames[k]);
  const out: number[] = [];
  doc.textures.forEach((tex, i) => { if (tex && !used.has(i)) out.push(i); });
  return out;
}

/*
  DeleteTexture: remove one texture and close the gap. Every reference above it moves down one;
  references to it fall to texture 0, keeping their rotation and mirror. An animation based
  on it goes, and it is dropped from the others' frames (CTrackPODAnitextures::TextureDeleted).
  Traxx renumbers every frame but each animation's first; this renumbers that one too, or the
  animation would point at the wrong texture.
*/
export function deleteTexture(doc: TrackDocument, index: number): void {
  const t = doc.track;
  const fix = (w: number) => {
    const tex = w & 0x0fff;
    if (tex < index) return w;
    return (w & 0xf000) | (tex > index ? (tex - 1) & 0x0fff : 0);
  };
  for (let c = 0; c < 65536; c++) t.clr[c] = fix(t.clr[c]);
  for (const g of t.groundBoxes) g.faces = g.faces.map(fix);
  t.animations = textureDeletedFromAnimations(t.animations, index);
  doc.textures.splice(index, 1);
  t.textures.splice(index, 1);
}

function textureDeletedFromAnimations(anims: TxxAnimation[], index: number): TxxAnimation[] {
  return anims.filter((a) => a.frames[0] !== index).map((a) => {
    const frames = a.frames.slice(0, a.nframes).filter((f, k) => k === 0 || f !== index).map((f) => (f > index ? f - 1 : f));
    const nframes = frames.length;
    while (frames.length < 8) frames.push(0);
    return { ...a, nframes, frames };
  });
}

/** Purge Unused: delete every unused texture, highest first so the indices stay right. */
export function purgeTextures(doc: TrackDocument, unused: number[]): void {
  for (const i of [...unused].sort((a, b) => b - a)) deleteTexture(doc, i);
}
