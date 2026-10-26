/*
  Port of Traxx HDTexture.cpp: the size policy for HD art and the conversion of a true-colour
  image to the legacy 8-bit tile (RAW + ACT) the rest of Traxx works with.

  - HDTexValidateDimNamed: square, power of two, 32 to 1024.
  - HDTexLegacySize: 256 when the source is at least 256, else 64.
  - Terrain art gets a border ring of size/32 (at least 1): the image is box-filtered into
    the interior and the ring clamps out from its edge. Model, sky and backdrop art is a
    plain downscale.
  - HDTexQuantize: median cut over an RGB555 histogram with full 8-bit sums.
*/

export const HDTEX_MIN_DIM = 32;
export const HDTEX_MAX_DIM = 1024;
export const HDTEX_COMPOSITE_MAX = 8192;
export const HDTEX_LEGACY_MAX = 256;
export const HDTEX_MAX_STEM = 23;

export type HdTexClass = "terrain" | "model";

/** The refusal for a texture of this size, or null. The first sentence stands alone, as in Traxx. */
export function hdDimensionRefusal(title: string | null, w: number, h: number): string | null {
  const who = title ? `"${title}"` : "The texture";
  if (w !== h) return `${who} is ${w}x${h} - it must be SQUARE.\n\nTraxx will not resample it for you: crop or pad it in your paint program so you decide what gets lost.`;
  if (!(w > 0 && (w & (w - 1)) === 0)) return `${who} is ${w}x${h} - the size must be a power of two (32, 64, 128, 256, 512 or 1024).`;
  if (w < HDTEX_MIN_DIM || w > HDTEX_MAX_DIM) return `${who} is ${w}x${h} - the supported range is ${HDTEX_MIN_DIM} to ${HDTEX_MAX_DIM}.`;
  return null;
}

export function legacySize(srcSize: number): number {
  return srcSize >= HDTEX_LEGACY_MAX ? HDTEX_LEGACY_MAX : 64;
}

export function borderInset(size: number): number {
  return Math.max(1, Math.trunc(size / 32));
}

/** HDTexResampleRGB: area-average box filter; enlarging degrades to nearest neighbour. */
export function resampleRgb(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const dst = new Uint8Array(dw * dh * 3);
  let o = 0;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = Math.trunc((dy * sh) / dh);
    let y1 = Math.trunc(((dy + 1) * sh) / dh);
    if (y1 <= y0) y1 = y0 + 1;
    if (y1 > sh) y1 = sh;
    for (let dx = 0; dx < dw; dx++) {
      const x0 = Math.trunc((dx * sw) / dw);
      let x1 = Math.trunc(((dx + 1) * sw) / dw);
      if (x1 <= x0) x1 = x0 + 1;
      if (x1 > sw) x1 = sw;
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        let p = (sy * sw + x0) * 3;
        for (let sx = x0; sx < x1; sx++) {
          r += src[p]!;
          g += src[p + 1]!;
          b += src[p + 2]!;
          p += 3;
          n++;
        }
      }
      if (n === 0) n = 1;
      dst[o++] = Math.trunc(r / n);
      dst[o++] = Math.trunc(g / n);
      dst[o++] = Math.trunc(b / n);
    }
  }
  return dst;
}

/** HDTexClampBorder: the ring copies the nearest interior edge pixel; corners copy the corner pixel. */
export function clampBorder(img: Uint8Array, size: number, inset: number): void {
  const lo = inset;
  const hi = size - inset - 1;
  if (inset < 1 || hi < lo) return;
  for (let y = lo; y <= hi; y++) {
    const pl = (y * size + lo) * 3;
    for (let x = 0; x < lo; x++) img.copyWithin((y * size + x) * 3, pl, pl + 3);
    const ph = (y * size + hi) * 3;
    for (let x = hi + 1; x < size; x++) img.copyWithin((y * size + x) * 3, ph, ph + 3);
  }
  const row = size * 3;
  for (let y = 0; y < lo; y++) img.copyWithin(y * row, lo * row, lo * row + row);
  for (let y = hi + 1; y < size; y++) img.copyWithin(y * row, hi * row, hi * row + row);
}

interface QBox { lo: number[]; hi: number[]; start: number; count: number; pixels: number }

const QHIST = 32768;

function qcode(r: number, g: number, b: number): number {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

function qshrink(box: QBox, col: Uint16Array, hist: Int32Array): void {
  box.lo = [31, 31, 31];
  box.hi = [0, 0, 0];
  box.pixels = 0;
  for (let i = 0; i < box.count; i++) {
    const c = col[box.start + i]!;
    for (let a = 0; a < 3; a++) {
      const v = (c >> ((2 - a) * 5)) & 31;
      if (v < box.lo[a]!) box.lo[a] = v;
      if (v > box.hi[a]!) box.hi[a] = v;
    }
    box.pixels += hist[c]!;
  }
}

function qsortAxis(col: Uint16Array, box: QBox, axis: number, tmp: Uint16Array): void {
  const bucket = new Int32Array(33);
  const shift = (2 - axis) * 5;
  for (let i = 0; i < box.count; i++) bucket[((col[box.start + i]! >> shift) & 31) + 1]!++;
  for (let i = 1; i < 33; i++) bucket[i]! += bucket[i - 1]!;
  for (let i = 0; i < box.count; i++) {
    const c = col[box.start + i]!;
    tmp[bucket[(c >> shift) & 31]!++] = c;
  }
  col.set(tmp.subarray(0, box.count), box.start);
}

/** HDTexQuantize: a 256-entry palette (768-byte ACT) for `rgb` and an index per pixel. */
export function quantize(rgb: Uint8Array, w: number, h: number): { indices: Uint8Array; act: Uint8Array } {
  const npix = w * h;
  const hist = new Int32Array(QHIST);
  const sum = new Int32Array(QHIST * 3);
  const col = new Uint16Array(QHIST);
  const tmp = new Uint16Array(QHIST);
  const map = new Uint8Array(QHIST).fill(0xff);
  const indices = new Uint8Array(npix);
  const act = new Uint8Array(768);

  for (let i = 0; i < npix; i++) {
    const c = qcode(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!);
    hist[c]!++;
    sum[c * 3]! += rgb[i * 3]!;
    sum[c * 3 + 1]! += rgb[i * 3 + 1]!;
    sum[c * 3 + 2]! += rgb[i * 3 + 2]!;
  }
  let ncol = 0;
  for (let i = 0; i < QHIST; i++) if (hist[i]) col[ncol++] = i;

  const box: QBox[] = [{ lo: [0, 0, 0], hi: [0, 0, 0], start: 0, count: ncol, pixels: 0 }];
  qshrink(box[0]!, col, hist);

  while (box.length < 256) {
    let pick = -1, best = -1;
    for (let i = 0; i < box.length; i++) {
      if (box[i]!.count < 2) continue;
      if (box[i]!.pixels > best) { best = box[i]!.pixels; pick = i; }
    }
    if (pick < 0) break;
    const p = box[pick]!;
    let axis = 0, span = -1;
    for (let a = 0; a < 3; a++) {
      if (p.hi[a]! - p.lo[a]! > span) { span = p.hi[a]! - p.lo[a]!; axis = a; }
    }
    if (span < 1) break;
    qsortAxis(col, p, axis, tmp);
    const half = Math.trunc(p.pixels / 2);
    let acc = 0, cut = 0;
    for (let i = 0; i < p.count - 1; i++) {
      acc += hist[col[p.start + i]!]!;
      cut = i + 1;
      if (acc >= half) break;
    }
    if (cut < 1) cut = 1;
    if (cut > p.count - 1) cut = p.count - 1;
    const nb: QBox = { lo: [0, 0, 0], hi: [0, 0, 0], start: p.start + cut, count: p.count - cut, pixels: 0 };
    p.count = cut;
    qshrink(p, col, hist);
    qshrink(nb, col, hist);
    box.push(nb);
  }

  const nbox = box.length;
  const pal: number[][] = [];
  for (let i = 0; i < nbox; i++) {
    let sr = 0, sg = 0, sb = 0, sn = 0;
    const b = box[i]!;
    for (let j = 0; j < b.count; j++) {
      const c = col[b.start + j]!;
      sr += sum[c * 3]!;
      sg += sum[c * 3 + 1]!;
      sb += sum[c * 3 + 2]!;
      sn += hist[c]!;
    }
    if (sn < 1) sn = 1;
    pal.push([Math.trunc(sr / sn + 0.5), Math.trunc(sg / sn + 0.5), Math.trunc(sb / sn + 0.5)]);
  }
  // Unused entries repeat the last real one rather than staying black.
  const last = pal[nbox - 1] ?? [0, 0, 0];
  for (let i = 0; i < 256; i++) {
    const e = i < nbox ? pal[i]! : last;
    act[i * 3] = e[0]!;
    act[i * 3 + 1] = e[1]!;
    act[i * 3 + 2] = e[2]!;
  }

  // Index each pixel by its bucket's true average colour, cached per 555 code.
  const n = nbox > 0 ? nbox : 1;
  for (let i = 0; i < npix; i++) {
    const c = qcode(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!);
    if (map[c] === 0xff) {
      const cw = hist[c]! > 0 ? hist[c]! : 1;
      const r = Math.trunc(sum[c * 3]! / cw);
      const g = Math.trunc(sum[c * 3 + 1]! / cw);
      const b = Math.trunc(sum[c * 3 + 2]! / cw);
      let bestd = 0x7fffffff, bestj = 0;
      for (let j = 0; j < n; j++) {
        const e = pal[j] ?? last;
        const dr = e[0]! - r, dg = e[1]! - g, db = e[2]! - b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestd) {
          bestd = d;
          bestj = j;
          if (d === 0) break;
        }
      }
      map[c] = bestj;
    }
    indices[i] = map[c]!;
  }
  return { indices, act };
}

/**
  HDTexBuildLegacyIndicesMem after the decode: true-colour `rgb` (sw x sh, already validated)
  to the legacy tile.
*/
export function buildLegacyTile(rgb: Uint8Array, sw: number, sh: number, texClass: HdTexClass): { side: number; indices: Uint8Array; act: Uint8Array } {
  const size = legacySize(sw);
  const inset = texClass === "terrain" ? borderInset(size) : 0;
  let tile: Uint8Array;
  if (inset > 0) {
    const interior = size - 2 * inset;
    const inner = resampleRgb(rgb, sw, sh, interior, interior);
    tile = new Uint8Array(size * size * 3);
    for (let y = 0; y < interior; y++) tile.set(inner.subarray(y * interior * 3, (y + 1) * interior * 3), ((y + inset) * size + inset) * 3);
    clampBorder(tile, size, inset);
  } else {
    tile = resampleRgb(rgb, sw, sh, size, size);
  }
  const { indices, act } = quantize(tile, size, size);
  return { side: size, indices, act };
}

/**
  A true-colour picture as an 8-bit tile. Traxx's Paste takes only an 8-bit bitmap; a browser
  clipboard gives true colour, so a picture of 256 colours or fewer keeps them exactly
  (first-seen order) and anything richer goes through HDTexQuantize.
*/
export function indexImage(rgb: Uint8Array, w: number, h: number): { indices: Uint8Array; act: Uint8Array } {
  const n = w * h;
  const seen = new Map<number, number>();
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const key = (rgb[i * 3]! << 16) | (rgb[i * 3 + 1]! << 8) | rgb[i * 3 + 2]!;
    let at = seen.get(key);
    if (at === undefined) {
      if (seen.size >= 256) return quantize(rgb, w, h);
      at = seen.size;
      seen.set(key, at);
    }
    indices[i] = at;
  }
  const act = new Uint8Array(768);
  for (const [key, at] of seen) act.set([key >> 16, (key >> 8) & 255, key & 255], at * 3);
  return { indices, act };
}

/** The pixel size an HD file declares (PNG IHDR, TGA header), or null. */
export function hdDimensions(ext: "PNG" | "TGA", bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ext === "PNG") return bytes.length >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : null;
  return bytes.length >= 18 ? { width: view.getUint16(12, true), height: view.getUint16(14, true) } : null;
}
