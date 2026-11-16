/*
  The detail normal checks of Traxx 1.7.2 (28568e2: Traxx/HDTexture.cpp, TraxxComponentsDlg.cpp
  LoadTerrainMap, TraxxDoc.cpp CheckDetailMapForExport) for the terrain _DTL and the water _WDTL.

  One verdict (hd-texture.ts hdDetailMapVerdict) drives both the load check in Track Components
  and the export check in Write POD, so the two never disagree. Over HDTEX_MAX_DIM the engine
  refuses the map and uses its generated one, so the author is offered a resample to
  HDTEX_MAX_DIM, stored as a PNG (HDTexResampleDetailMem).
*/
import {
  HDTEX_DTL_ODD, HDTEX_DTL_RECOMMENDED, HDTEX_DTL_TINY, HDTEX_DTL_TOOBIG, HDTEX_MAX_DIM, HDTEX_MIN_DIM,
  hdDetailCostLine, hdDetailMapVerdict, hdGetInfoMem, resampleDetailRgb,
} from "./hd-texture.ts";
import { crc32, stbiZlibCompress } from "../traxx/height-image.ts";

/** Which map: the terrain pair or (Traxx 1.7.2) the water pair. */
export type DetailWhich = "terrain" | "water";

/**
  LoadTerrainMap's detail-normal warning for a picked file of w x h, or "" for none. `tooBig` is
  true when the answer to the question is "resample" rather than "load as it is".
*/
export function detailLoadWarning(w: number, h: number): { text: string; tooBig: boolean } {
  const verdict = hdDetailMapVerdict(w, h);
  if (verdict === HDTEX_DTL_TOOBIG) {
    return {
      tooBig: true,
      text: `This detail normal is ${w}x${h}.\n\nThe engine refuses anything over ${HDTEX_MAX_DIM} and uses its own generated map instead, so loaded as it is this would have no effect in game.\n\n`
        + `Resample it to ${HDTEX_MAX_DIM}x${HDTEX_MAX_DIM} now? It will be stored in the pod as a PNG.\n\n`
        + `${hdDetailCostLine(HDTEX_MAX_DIM, HDTEX_MAX_DIM)} ${HDTEX_DTL_RECOMMENDED}x${HDTEX_DTL_RECOMMENDED} is the recommended size and is usually plenty for a tiling detail normal.`,
    };
  }
  if (verdict === HDTEX_DTL_ODD) {
    const cost = w >= 1024 || h >= 1024 ? `\n\n${hdDetailCostLine(w, h)}` : "";
    return { tooBig: false, text: `This detail normal is ${w}x${h}, which is not a square power of two.\n\nIt will still tile correctly, but it mips less cleanly and the engine notes it in the log. 256x256 is the recommended size.${cost}\n\nLoad it anyway?` };
  }
  if (verdict === HDTEX_DTL_TINY) return { tooBig: false, text: `This detail normal is only ${w}x${h}. The engine expects at least ${HDTEX_MIN_DIM}.\n\nLoad it anyway?` };
  if (w >= 1024 || h >= 1024) {
    return { tooBig: false, text: `This detail normal is ${w}x${h}.\n\n${hdDetailCostLine(w, h)}\n\n${HDTEX_DTL_RECOMMENDED} or 512 is usually plenty for a tiling detail normal.\n\nLoad it anyway?` };
  }
  return { tooBig: false, text: "" };
}

/** LoadTerrainMap's greyscale warning for a mask with `bad` coloured pixels of `total`. */
export function maskGreyWarning(bad: number, total: number, which: DetailWhich): string {
  const water = which === "water";
  return `This mask is not greyscale - ${bad} of its ${total} pixels have different red, green and blue.\n\n`
    + `The usual cause is the exported colour reference${water ? " (MaskArt\\<stem>_MASK_ref.png, which water masks are painted over too)" : ""} being flattened into the saved file. `
    + `The engine reads those colours as mask values, so ${water ? "water" : "ground"} you never painted gets a strength you never asked for: it looks right here and wrong in game.\n\nLoad it anyway?`;
}

/**
  CheckDetailMapForExport's question for a map already on the track, or null when it is fine.
  `kind` says which buttons Traxx offers: "resample" is Yes (resample and write) / No (write as it
  is) / Cancel; "okcancel" is OK (write) / Cancel.
*/
export function detailExportCheck(map: Uint8Array | null, ext: string, which: DetailWhich): { caption: string; text: string; kind: "resample" | "okcancel" } | null {
  if (!map) return null;
  const water = which === "water";
  const name = water ? "water" : "terrain";
  const caption = water ? "Water Detail Normal" : "Terrain Detail Normal";
  const hint = `${water ? "_WDTL" : "_DTL"}${ext || ".PNG"}`;
  const info = hdGetInfoMem(map, hint);
  if ("err" in info) {
    return { caption, kind: "okcancel", text: `Traxx could not read the size of the ${name} detail normal (${info.err}).\n\nIf the engine cannot read it either, it will use its generated map instead.\n\nWrite the pod anyway?` };
  }
  const { width: w, height: h } = info;
  const verdict = hdDetailMapVerdict(w, h);
  if (verdict === HDTEX_DTL_TOOBIG) {
    return {
      caption, kind: "resample",
      text: `The ${name} detail normal is ${w}x${h}. The engine refuses anything over ${HDTEX_MAX_DIM} and uses its generated map instead, so as it stands it would have no effect in game.\n\n`
        + `${hdDetailCostLine(HDTEX_MAX_DIM, HDTEX_MAX_DIM)} ${HDTEX_DTL_RECOMMENDED}x${HDTEX_DTL_RECOMMENDED} is the recommended size.\n\n`
        + `Yes: resample it to ${HDTEX_MAX_DIM}x${HDTEX_MAX_DIM} now (stored as PNG) and write.\nNo: write it as it is.\nCancel: write nothing.`,
    };
  }
  if (verdict === HDTEX_DTL_TINY) return { caption, kind: "okcancel", text: `The ${name} detail normal is only ${w}x${h}. The engine expects at least ${HDTEX_MIN_DIM}.\n\nWrite the pod anyway?` };
  if (verdict === HDTEX_DTL_ODD) {
    return { caption, kind: "okcancel", text: `The ${name} detail normal is ${w}x${h}, which is not a square power of two.\n\nIt will still tile, but it mips less cleanly and the engine notes it in its log. ${HDTEX_DTL_RECOMMENDED}x${HDTEX_DTL_RECOMMENDED} is the recommended size.\n\nWrite the pod anyway?` };
  }
  return null;
}

/**
  HDTexResampleDetailMem: decoded RGBA pixels reduced to size x size (resampleDetailRgb) and
  returned as a 24-bit PNG, as Traxx's HDTexEncodePNG24Mem stores it.
*/
export function resampleDetailPng(rgba: ArrayLike<number>, w: number, h: number, size = HDTEX_MAX_DIM): Uint8Array {
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = rgba[i * 4]!; rgb[i * 3 + 1] = rgba[i * 4 + 1]!; rgb[i * 3 + 2] = rgba[i * 4 + 2]!; }
  return encodePngRgb(resampleDetailRgb(rgb, w, h, size), size, size);
}

function be32(d: Uint8Array, o: number, v: number): void {
  d[o] = (v >>> 24) & 255; d[o + 1] = (v >>> 16) & 255; d[o + 2] = (v >>> 8) & 255; d[o + 3] = v & 255;
}

/** An 8-bit RGB PNG (colour type 2), every row Paeth filtered, stb_image_write's deflate. */
export function encodePngRgb(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 3;
  const filtered = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const r = y * stride, d = y * (stride + 1);
    filtered[d] = 4;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? rgb[r + i - 3]! : 0;
      const b = y > 0 ? rgb[r - stride + i]! : 0;
      const c = y > 0 && i >= 3 ? rgb[r - stride + i - 3]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      filtered[d + 1 + i] = (rgb[r + i]! - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  const z = stbiZlibCompress(filtered, 8);
  const file = new Uint8Array(8 + 25 + 12 + z.length + 12);
  file.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  let o = 8;
  const chunk = (type: string, data: Uint8Array) => {
    be32(file, o, data.length);
    for (let k = 0; k < 4; k++) file[o + 4 + k] = type.charCodeAt(k);
    file.set(data, o + 8);
    be32(file, o + 8 + data.length, crc32(file, o + 4, o + 8 + data.length));
    o += 12 + data.length;
  };
  const ihdr = new Uint8Array(13);
  be32(ihdr, 0, w); be32(ihdr, 4, h);
  ihdr[8] = 8; ihdr[9] = 2;
  chunk("IHDR", ihdr);
  chunk("IDAT", z);
  chunk("IEND", new Uint8Array(0));
  return file;
}
