/*
  The inputs of the detail-map shading (Traxx 1.8.0, b6d56f2: Traxx/GLDetailMaps.cpp
  EnsureMaskCPU / EnsureDetTex / EnsureLightTex / GLDetailTerrainReady, and 2e8a268's water mask
  table), as three.js textures for render/terrain.ts and render/water.ts.

    - uMask: the track's _MASK, its red channel (the only one the engine reads), REPEAT, mipmapped.
      No _MASK (or one that does not decode): no detail at all, as in the engine.
    - uDet: the track's _DTL, else (none, or over 2048 a side) the engine's generated map with AO
      (engineDetailGenerate(true)); REPEAT, mipmapped, 8x anisotropy.
    - uLight: the baked intensities from the .LTE (engineDetailLightTexture): per vertex on Classic
      8-bit and 16-bit, the engine's 8 ft relight on Spline and Full Map (unshadowed: the engine's
      box-system shadow trace is not available); NEAREST, REPEAT. Rebuilt when the lighting, the
      terrain mode or the heights change (engineDetailLightKey). Traxx 1.8.1: two channels, red the
      intensity and green the .LTE shadow bit (EnsureLightTex's luminance-alpha pair), for the
      ground boxes' walls and bottoms.
    - Water: _WDTL (else engineDetailGenerate(false)) and _WMSK red.
    - The water mask tint's cell table: the _WMSK's stb grey (req_comp 1: (77 r + 150 g + 29 b) >> 8)
      at pixel (gi w / N, gj h / N), N x N.
  Every decoded image is dropped on a new document (GLDetailInvalidate(newdocument)).

  Decoding is PNG and TGA (the HD formats JSTraxx reads); a mask in another format gives no detail.
*/
import * as THREE from "three";
import type { TrackDocument } from "../core/doc/document.ts";
import { tryDecodeImage } from "../shared/image-decode.ts";
import {
  ENGDET_TERRDETAIL_DEFAULT, engineDetailGenerate, engineDetailLightKey, engineDetailLightTexture, engineDetailMaskRed, engineDetailStrength,
  engineDetailSunUniform, ENGDET_GEN_SIZE, ENGDET_BOX_BACK, ENGDET_BOX_BOTTOM, ENGDET_BOX_FRONT, ENGDET_BOX_LEFT, ENGDET_BOX_RIGHT, engineDetailBoxFaceI,
} from "../core/view/engine-detail.ts";
import { engineY0, fillLteFlat, trackLighting } from "../core/edit/lighting.ts";
import { getSurface } from "../core/traxx/surface.ts";
import { TERRAINMODE_FINE, TERRAINMODE_SPLINE } from "../core/traxx/terrain16.ts";
import { cellsOf } from "../core/traxx/world.ts";
import type { RgbaImage } from "../core/view/tiles.ts";

/** HDTEX_MAX_DIM: a detail normal over 2048 a side is refused by the engine (the generated map stands in). */
const HD_MAX = 2048;

type Ext = "PNG" | "TGA";
const extOf = (e: string): Ext | null => {
  const x = e.replace(/^\./, "").toUpperCase();
  return x === "PNG" || x === "TGA" ? x : null;
};

async function decode(bytes: Uint8Array | null, ext: string): Promise<RgbaImage | null> {
  const x = extOf(ext);
  if (!bytes || !x) return null;
  return tryDecodeImage(bytes, x);
}

function tex(data: Uint8Array, w: number, h: number, format: THREE.PixelFormat, mips: boolean, nearest = false): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(data), w, h, format, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = nearest ? THREE.NearestFilter : mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips;
  t.unpackAlignment = 1;
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** stb_image's req_comp 1 (stbi__compute_y): (77 r + 150 g + 29 b) >> 8. */
export function stbiGrey(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) out[k] = (rgba[k * 4]! * 77 + rgba[k * 4 + 1]! * 150 + rgba[k * 4 + 2]! * 29) >> 8;
  return out;
}

/** EnsureWaterMask: cell (gi, gj) = the grey at pixel (gi w / N, gj h / N), row 0 = z 0. */
export function waterMaskCells(grey: Uint8Array, w: number, h: number, n: number): Uint8Array {
  const cells = new Uint8Array(n * n);
  for (let gj = 0; gj < n; gj++) {
    const my = Math.min(h - 1, Math.trunc((gj * h) / n));
    for (let gi = 0; gi < n; gi++) cells[gj * n + gi] = grey[my * w + Math.min(w - 1, Math.trunc((gi * w) / n))]!;
  }
  return cells;
}

export interface TerrainDetailTextures {
  det: THREE.Texture; mask: THREE.Texture; light: THREE.Texture; lightN: number; sun: [number, number, number]; strength: number;
  /** Traxx 1.8.1 GLDetailBeginBox: the ground boxes' face lights FRONT, BACK, RIGHT, LEFT (uBoxSideI) and BOTTOM (uBoxBottomI). */
  boxSideI: [number, number, number, number]; boxBottomI: number;
}
export interface WaterDetailTextures { det: THREE.Texture; mask: THREE.Texture }

export class TerrainDetail {
  private doc: TrackDocument | null = null;
  private terrainMaps: { det: THREE.Texture; mask: THREE.Texture } | null = null;
  private waterMaps: WaterDetailTextures | null = null;
  private wmaskCells: Uint8Array | null = null;
  private light: { key: string; lte: Uint8Array | null; tex: THREE.Texture; n: number } | null = null;
  private sources = { mask: null as Uint8Array | null, det: null as Uint8Array | null, wmask: null as Uint8Array | null, wdet: null as Uint8Array | null };
  /** The heights' revision (a terrain edit bumps it: the 8 ft relight follows). */
  private surfaceRevision = 0;
  /** Called when a decode finished. */
  onReady: () => void = () => {};

  /** GLDetailInvalidate(newdocument): every map and texture dropped. */
  open(doc: TrackDocument | null): void {
    this.dispose();
    this.doc = doc;
    this.sources = { mask: null, det: null, wmask: null, wdet: null };
    this.refresh();
  }

  /** The heights changed (the light texture is rebuilt on its next use). */
  heightsChanged(): void {
    this.surfaceRevision++;
  }

  /** Track Components may have replaced a map: decode again what changed. */
  refresh(): void {
    const doc = this.doc;
    if (!doc) return;
    const t = doc.track;
    if (t.maskMap !== this.sources.mask || t.detailMap !== this.sources.det) {
      this.sources.mask = t.maskMap; this.sources.det = t.detailMap;
      void this.loadTerrain(doc);
    }
    if (t.waterMaskMap !== this.sources.wmask || t.waterDetailMap !== this.sources.wdet) {
      this.sources.wmask = t.waterMaskMap; this.sources.wdet = t.waterDetailMap;
      void this.loadWater(doc);
    }
  }

  private async loadTerrain(doc: TrackDocument): Promise<void> {
    const t = doc.track;
    const m = await decode(t.maskMap, t.maskExt);
    if (this.doc !== doc) return;
    this.terrainMaps?.det.dispose(); this.terrainMaps?.mask.dispose();
    this.terrainMaps = null;
    if (m) {
      const d = await decode(t.detailMap, t.detailExt);
      if (this.doc !== doc) return;
      const det = d && d.width <= HD_MAX && d.height <= HD_MAX
        ? tex(new Uint8Array(d.rgba.buffer, d.rgba.byteOffset, d.rgba.byteLength), d.width, d.height, THREE.RGBAFormat, true)
        : tex(engineDetailGenerate(true), ENGDET_GEN_SIZE, ENGDET_GEN_SIZE, THREE.RGBAFormat, true);
      det.anisotropy = 8;
      this.terrainMaps = { det, mask: tex(engineDetailMaskRed(m.rgba, m.width, m.height), m.width, m.height, THREE.RedFormat, true) };
    }
    this.onReady();
  }

  private async loadWater(doc: TrackDocument): Promise<void> {
    const t = doc.track;
    const m = await decode(t.waterMaskMap, t.waterMaskExt);
    if (this.doc !== doc) return;
    this.waterMaps?.det.dispose(); this.waterMaps?.mask.dispose();
    this.waterMaps = null;
    this.wmaskCells = null;
    if (m) {
      const d = await decode(t.waterDetailMap, t.waterDetailExt);
      if (this.doc !== doc) return;
      const det = d && d.width <= HD_MAX && d.height <= HD_MAX
        ? tex(new Uint8Array(d.rgba.buffer, d.rgba.byteOffset, d.rgba.byteLength), d.width, d.height, THREE.RGBAFormat, true)
        : tex(engineDetailGenerate(false), ENGDET_GEN_SIZE, ENGDET_GEN_SIZE, THREE.RGBAFormat, true);
      this.waterMaps = { det, mask: tex(engineDetailMaskRed(m.rgba, m.width, m.height), m.width, m.height, THREE.RedFormat, true) };
      this.wmaskCells = waterMaskCells(stbiGrey(m.rgba, m.width, m.height), m.width, m.height, cellsOf(t));
    }
    this.onReady();
  }

  /** The terrain shader's inputs, or null with no _MASK (the engine's switch). */
  terrain(): TerrainDetailTextures | null {
    const doc = this.doc;
    if (!doc || !this.terrainMaps) return null;
    const t = doc.track;
    const { sun, ambient } = trackLighting(t);
    const n = cellsOf(t);
    const smooth = t.terrainMode === TERRAINMODE_SPLINE || t.terrainMode === TERRAINMODE_FINE;
    const key = engineDetailLightKey(0, t.terrainMode, smooth ? this.surfaceRevision : 0, sun, ambient) + `|${t.lte ? 1 : 0}`;
    if (!this.light || this.light.key !== key || this.light.lte !== t.lte) {
      this.light?.tex.dispose();
      const lt = engineDetailLightTexture({
        lte: t.lte ?? fillLteFlat(n * n), sun, ambient, n,
        surface: smooth ? getSurface(t) : null, y0: smooth ? engineY0(t) : null,
      });
      this.light = { key, lte: t.lte, tex: tex(lt.rg, lt.n, lt.n, THREE.RGFormat, false, true), n: lt.n };
    }
    return {
      det: this.terrainMaps.det, mask: this.terrainMaps.mask, light: this.light.tex, lightN: this.light.n,
      sun: engineDetailSunUniform(sun), strength: engineDetailStrength(ENGDET_TERRDETAIL_DEFAULT, 100, false),
      boxSideI: [ENGDET_BOX_FRONT, ENGDET_BOX_BACK, ENGDET_BOX_RIGHT, ENGDET_BOX_LEFT].map((f) => engineDetailBoxFaceI(f, sun, ambient)) as [number, number, number, number],
      boxBottomI: engineDetailBoxFaceI(ENGDET_BOX_BOTTOM, sun, ambient),
    };
  }

  /** The water shader's inputs, or null with no _WMSK. */
  water(): WaterDetailTextures | null {
    return this.waterMaps;
  }

  /** The water mask tint's N x N table, or null with no _WMSK. */
  waterMaskCells(): Uint8Array | null {
    return this.wmaskCells;
  }

  dispose(): void {
    this.terrainMaps?.det.dispose(); this.terrainMaps?.mask.dispose();
    this.waterMaps?.det.dispose(); this.waterMaps?.mask.dispose();
    this.light?.tex.dispose();
    this.terrainMaps = null; this.waterMaps = null; this.light = null; this.wmaskCells = null;
  }
}
