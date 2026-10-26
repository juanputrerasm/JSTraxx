/*
  The Track Palette dialog's New (CTrackPOD::OptimalPalette): a palette built from the track's
  own art.

    1. Every texture, terrain and model, in its own colours (the .RAW through its .ACT, metalcr2
       without one) goes into an RGB555 histogram. A 64 tile weighs 10, a 256 one 1; a terrain
       texture adds sqrt(1 + its use on the map, at most 64), a model texture the number of
       objects showing it (at most 10). Bright pixels count three times, middling ones twice.
    2. The 28 "standard" colours (4 levels of red, green, blue, yellow, cyan, magenta, grey)
       are added at the top count; every count becomes sqrt(count) + 1.
    3. Colours under a rising threshold are merged into their nearest kept colour until 220
       remain (some of the rare ones are kept when that leaves fewer than 220).
    4. The palette: 10 system colours, the 28 standard ones, the survivors, the last 10 system
       colours at 246.

  Traxx reads the bottom ten system colours from the desktop; JSTraxx uses Windows' static
  colours, which is what an 8-bit desktop gave.
*/
import type { TrackDocument } from "../doc/document.ts";
import { metalcr2Act3, SYS_COLORS } from "../traxx/palette.ts";
import { findModelTexture } from "../doc/load-pod.ts";

/** The first ten Windows static colours. */
export const WINDOWS_LOW_COLORS: readonly [number, number, number][] = [
  [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0], [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192], [192, 220, 192], [166, 202, 240],
];

/** TextureUsage: cells, ground-box faces and animation frames using a texture. */
export function textureUsage(doc: TrackDocument, index: number): number {
  const t = doc.track;
  let count = 0;
  for (const w of t.clr) if ((w & 0x0fff) === index) count++;
  for (const g of t.groundBoxes) for (const f of g.faces) if ((f & 0x0fff) === index) count++;
  for (const a of t.animations) for (let f = 0; f < a.nframes; f++) if (a.frames[f] === index) count++;
  return count;
}

/** CountModelTextureUsage: per model texture slot, the objects showing it (once per object). */
export function modelTextureUsage(doc: TrackDocument): number[] {
  const usage = new Array<number>(doc.modelTextures.length).fill(0);
  const perModel = new Map<string, number>();
  for (const b of doc.track.boxes) if (b.modelName) perModel.set(b.modelName.toUpperCase(), (perModel.get(b.modelName.toUpperCase()) ?? 0) + 1);
  for (const [name, n] of perModel) {
    const model = doc.models.find((m) => m.name.toUpperCase().replace(/^MODELS\\/, "") === name.replace(/^MODELS\\/, ""));
    if (!model) continue;
    const seen = new Set<number>();
    for (const face of model.textureNames) {
      const slot = findModelTexture(doc.modelTextures, `ART\\${face}`);
      if (slot < 0 || seen.has(slot)) continue;
      seen.add(slot);
      usage[slot] = (usage[slot] ?? 0) + n;
    }
  }
  return usage;
}

/** The new palette, 768 RGB bytes, or null when the track has no art to build it from. */
export function optimalPalette(doc: TrackDocument): Uint8Array | null {
  const count = new Int32Array(32768);
  const r = new Int16Array(32768), g = new Int16Array(32768), b = new Int16Array(32768);
  let maxhisto = 0;
  const models = modelTextureUsage(doc);
  const all = [...doc.textures.map((t, i) => ({ t, terrain: true, i })), ...doc.modelTextures.map((t, i) => ({ t, terrain: false, i }))];
  for (const { t, terrain, i } of all) {
    if (!t?.indices || !t.side) continue;
    const size = t.side;
    let weight = size === 64 ? 10 : 1;
    if (terrain) weight += Math.trunc(Math.sqrt(Math.min(textureUsage(doc, i), 64) + 1));
    else weight += Math.min(models[i] ?? 0, 10);
    const pal = t.trackIndexed ? doc.track.palette : t.act ?? metalcr2Act3();
    const mapping = new Uint16Array(256), intens = new Uint16Array(256);
    for (let c = 0; c < 256; c++) {
      const lo = pal[c * 3 + 2]! >> 3, mid = pal[c * 3 + 1]! >> 3, hi = pal[c * 3]! >> 3;
      mapping[c] = lo | (mid << 5) | (hi << 10);
      intens[c] = lo + mid + hi;
    }
    for (let p = 0; p < size * size; p++) {
      const k: number = t.indices[p]!;
      const inc = weight * (intens[k]! > 128 ? 3 : intens[k]! > 64 ? 2 : 1);
      const key = mapping[k]!;
      count[key]! += inc;
      if (count[key]! > maxhisto) maxhisto = count[key]!;
    }
  }
  if (maxhisto < 1) return null;

  const std: [number, number, number][] = [];
  for (let i = 1; i < 5; i++) {
    const v = 64 * i - 1;
    for (const [rr, gg, bb] of [[v, 0, 0], [0, v, 0], [0, 0, v], [v, v, 0], [0, v, v], [v, 0, v], [v, v, v]] as const) {
      std.push([rr, gg, bb]);
      count[((rr & 0xf8) << 7) | ((gg & 0xf8) << 2) | ((bb & 0xf8) >> 3)]! += maxhisto;
    }
  }
  for (let k = 1; k < 32768; k++) if (count[k]! > 0) count[k] = Math.trunc(Math.sqrt(count[k]!)) + 1;

  const hlist: number[] = [];
  for (let k = 1; k < 32768; k++) {
    if (count[k]! <= 0) continue;
    r[k] = (((k >> 10) & 31) << 3) + 7;
    g[k] = (((k >> 5) & 31) << 3) + 7;
    b[k] = ((k & 31) << 3) + 7;
    hlist.push(k);
  }
  let ncolors = hlist.length;
  let threshold = 1;
  while (ncolors > 220) {
    const target = ncolors > 8192 ? 8192 : ncolors > 4096 ? 4096 : ncolors > 2048 ? 2048 : ncolors > 1024 ? 1024 : ncolors > 512 ? 512 : 220;
    ncolors = 0;
    for (const k of hlist) if (count[k]! >= threshold) ncolors++;
    if (ncolors > target) {
      if (target > 512) threshold *= 2; else threshold++;
      continue;
    }
    let keep = ncolors < 220 ? 220 - ncolors : 0;
    for (const k of hlist) {
      if (!(count[k]! > 0 && count[k]! < threshold)) continue;
      if (keep > 0) { keep--; continue; }
      let best = 0, bestd = 200000;
      for (const k2 of hlist) {
        if (count[k2]! < threshold) continue;
        const dr = r[k2]! - r[k]!, dg = g[k2]! - g[k]!, db = b[k2]! - b[k]!;
        const d = dr * dr + dg * dg + db * db;
        if (d <= bestd) { bestd = d; best = k2; }
      }
      count[best]! += count[k]!;
      count[k] = -best;
    }
    for (const k of hlist) {
      if (count[k]! < 0) {
        const k2 = -count[k]!;
        if (count[k2]! < 0) count[k] = count[k2]!;
      }
    }
  }

  const out = new Uint8Array(768);
  WINDOWS_LOW_COLORS.forEach((c, i) => out.set(c, i * 3));
  SYS_COLORS.forEach((c, i) => out.set(c, (246 + i) * 3));
  let at = 10;
  for (const [rr, gg, bb] of std) {
    out.set([rr, gg, bb], at * 3);
    at++;
    count[((rr & 0xf8) << 7) | ((gg & 0xf8) << 2) | ((bb & 0xf8) >> 3)] = 0;
  }
  for (let k = 1; k < 32768 && at < 246; k++) {
    if (count[k]! <= 0) continue;
    out.set([(((k >> 10) & 31) << 3) + 7, (((k >> 5) & 31) << 3) + 7, ((k & 31) << 3) + 7], at * 3);
    at++;
  }
  return out;
}
