/*
  The view's side of the waterfalls (Traxx 1.7.1, Traxx/TraxxViewFalls.cpp), without the DOM:

    FallShapeCache   FallShapesEnsure / FallShapesInvalidate: every fall's shape and errors,
                     rebuilt lazily and only when an input moved (the falls' shape fields, the
                     lake heights, the water level, or a terrain or lake change that marked it
                     dirty); when only the look changed (opacity, flags, mist, volume, names) the
                     shapes stand and the errors are judged again. Budget runs over all of them.
    fallPreviewList  DrawWaterfallsOpenGL: what the renderer draws for each fall and for the
                     crest being captured (TraxxGLFall).
*/
import type { TxxTrack } from "../traxx/txx.ts";
import type { LakesState } from "../traxx/lakes.ts";
import type { LakeGround } from "../traxx/surface.ts";
import {
  buildFallShape, emptyFallShape, fallBudget, fallDefaults, fallEffectiveHeight, fallErrors, fallGroundFor, fallUnwrap, mistVolume, pointDirection,
  FALL_COORD_MAX, FALL_MAX_FALLS, FALL_MAX_POINTS, FALL_SHAPE_ERRORS, type FallGround, type FallNameCheck, type FallShape, type TraxxFall,
} from "../traxx/falls.ts";

type FallTrack = Pick<TxxTrack, "falls" | "lakes" | "waterLevel4" | "terrainMode" | "heights" | "h16" | "fine" | "rawShadow">;

/* The fields a SHAPE depends on (a sourced fall's height is its lake's: the lake heights are in the signature too). */
function shapeSig(t: FallTrack): string {
  const n = Math.min(t.falls.length, FALL_MAX_FALLS);
  return JSON.stringify([t.waterLevel4, t.lakes.map((l) => l.height), t.falls.slice(0, n).map((w) => [w.source, w.npoints, w.speed, w.height, w.pt])]);
}

export class FallShapeCache {
  shapes: FallShape[] = [];
  errors: number[] = [];
  /** The vertices the kept falls use (Budget's track total). */
  trackVerts = 0;
  private sig = "";
  private full = "";
  private dirty = true;

  /** FallShapesInvalidate: a terrain change, a lake recompute or a water level change. */
  invalidate(): void {
    this.dirty = true;
  }

  /** Judge the errors again on the next ensure (a sound or texture came or went: FALL_NAME). */
  rejudge(): void {
    this.full = "";
  }

  /**
    FallShapesEnsure. `lakes` derives the lakes as they are now (with the notches), `names` is the
    pod's name check and `lip` the lakes' ground for FALL_LIP_LOW.
  */
  ensure(t: FallTrack, lakes: () => LakesState | null, names: FallNameCheck, lip: () => LakeGround | null): void {
    const sig = shapeSig(t);
    const full = JSON.stringify(t.falls.slice(0, FALL_MAX_FALLS));
    const n = Math.min(t.falls.length, FALL_MAX_FALLS);
    const shapesame = !this.dirty && sig === this.sig && this.shapes.length === n;
    if (shapesame && full === this.full) return;
    const st = lakes();
    const fl = { lakes: t.lakes, tmap: st?.tmap ?? null };
    const lg = lip();
    this.errors = t.falls.slice(0, n).map((_, i) => fallErrors(t.falls, i, fl, names, lg));
    this.full = full;
    // Only the look changed: the shapes stand, the errors (a name can be one) are judged again.
    if (shapesame) return;
    let g: FallGround | null = null;
    this.shapes = t.falls.slice(0, n).map((w, i) => {
      if (this.errors[i]! & FALL_SHAPE_ERRORS) return emptyFallShape();
      g ??= fallGroundFor(t as Parameters<typeof fallGroundFor>[0], fl.tmap);
      return buildFallShape(w, fallEffectiveHeight(t.falls, i, t.lakes), g);
    });
    // The budget runs over every fall in file order (a fall with no shape costs nothing).
    this.trackVerts = fallBudget(this.shapes);
    this.sig = sig;
    this.dirty = false;
  }
}

/** One fall (or the crest being captured) for the renderer: feet, unwrapped from crest point 0 (TraxxGLFall). */
export interface FallPreview {
  px: number[];
  py: number[];
  pz: number[];
  /** Flow direction (x, z), unit, per point. */
  dx: number[];
  dz: number[];
  shape: FallShape | null;
  /** % 0..100. */
  opacity: number;
  /** 0 normal (cyan crest), 1 has errors (red), 2 being edited or captured (yellow). */
  style: number;
  /** A flow arrow at every crest point (capture), else one at the crest's middle. */
  arrowsAll: boolean;
  /** x, floorY, z, W, L, H, fx, fz (MistVolume), or null. */
  mist: number[] | null;
}

/**
  DrawWaterfallsOpenGL's list: a crest drawn where its water starts (its height, never inside the
  ground: at least 0.3 ft above it; a spring with no height 1 ft above the ground), red with
  errors, yellow while its window is open; the captured crest yellow, 1 ft above the ground it was
  clicked on, with an arrow at every point.
*/
export function fallPreviewList(t: FallTrack, cache: FallShapeCache, g: FallGround | null, highlight: number, capture: readonly [number, number][] | null): FallPreview[] {
  const out: FallPreview[] = [];
  const n = Math.min(t.falls.length, FALL_MAX_FALLS);
  for (let i = 0; i < n; i++) {
    const w = t.falls[i]!;
    const np = w.npoints;
    if (np < 1 || np > FALL_MAX_POINTS) continue;
    const { px, pz } = fallUnwrap(w, np);
    const eff = fallEffectiveHeight(t.falls, i, t.lakes);
    const py: number[] = [], dx: number[] = [], dz: number[] = [];
    for (let k = 0; k < np; k++) {
      const ground = g ? g.height((w.pt[k]![0] & FALL_COORD_MAX) / 16.0, (w.pt[k]![1] & FALL_COORD_MAX) / 16.0) : null;
      let y: number;
      if (eff > 0) { y = Math.fround(eff * 0.5); if (ground !== null && ground + 0.3 > y) y = Math.fround(ground + 0.3); }
      else y = ground !== null ? Math.fround(ground + 1.0) : 0;
      py.push(y);
      const d = np >= 2 ? pointDirection(w, k) : [0, 0];
      dx.push(d[0]!); dz.push(d[1]!);
    }
    const shape = i < cache.shapes.length && cache.shapes[i]!.ncols >= 2 ? cache.shapes[i]! : null;
    let style = i < cache.errors.length && cache.errors[i] !== 0 ? 1 : 0;
    if (i === highlight) style = 2;
    // The mist box from the current mist / depth / height every draw (the cached shape does not depend on them).
    out.push({ px, py, pz, dx, dz, shape, opacity: w.opacity, style, arrowsAll: false, mist: shape ? mistVolume(w, eff, shape) : null });
  }
  if (capture && capture.length >= 1) {
    const w: TraxxFall = fallDefaults();
    w.npoints = capture.length;
    capture.forEach((p, k) => { w.pt[k] = [p[0], p[1]]; });
    const { px, pz } = fallUnwrap(w, w.npoints);
    const py: number[] = [], dx: number[] = [], dz: number[] = [];
    for (let k = 0; k < w.npoints; k++) {
      py.push(g ? Math.fround(g.height(w.pt[k]![0] / 16.0, w.pt[k]![1] / 16.0) + 1.0) : 0);
      const d = w.npoints >= 2 ? pointDirection(w, k) : [0, 0];
      dx.push(d[0]!); dz.push(d[1]!);
    }
    out.push({ px, py, pz, dx, dz, shape: null, opacity: 100, style: 2, arrowsAll: true, mist: null });
  }
  return out;
}

/**
  The shift DrawWaterfalls moves a fall by: the multiple of 8192 ft per axis that brings crest
  point 0 nearest the grid centre (cells gridx, gridy, 32 ft each).
*/
export function fallViewShift(px0: number, pz0: number, gridx: number, gridy: number): [number, number] {
  return [8192.0 * Math.floor((gridx * 32.0 - px0) / 8192.0 + 0.5), 8192.0 * Math.floor((gridy * 32.0 - pz0) / 8192.0 + 0.5)];
}

/** The flow arrow (FallGLArrow): shaft and two barbs, in the ground plane at y, as feet line pairs. */
export function fallArrow(x: number, y: number, z: number, dx: number, dz: number, len: number): [number, number, number][] {
  const tx = x + dx * len, tz = z + dz * len;
  const back = len * 0.35, side = len * 0.16;
  const rx = -dz, rz = dx;
  return [
    [x, y, z], [tx, y, tz],
    [tx, y, tz], [tx - dx * back + rx * side, y, tz - dz * back + rz * side],
    [tx, y, tz], [tx - dx * back - rx * side, y, tz - dz * back - rz * side],
  ];
}

/** The arrow at the crest's middle (by length), its direction blended along its segment. */
export function fallMiddleArrow(f: Pick<FallPreview, "px" | "py" | "pz" | "dx" | "dz">): { x: number; y: number; z: number; dx: number; dz: number } | null {
  const n = f.px.length;
  if (n < 2) return null;
  const seglen: number[] = [];
  let total = 0, run = 0;
  for (let k = 0; k + 1 < n; k++) { const ddx = f.px[k + 1]! - f.px[k]!, ddz = f.pz[k + 1]! - f.pz[k]!; seglen.push(Math.sqrt(ddx * ddx + ddz * ddz)); total += seglen[k]!; }
  const half = total * 0.5;
  for (let k = 0; k + 1 < n; k++) {
    if (run + seglen[k]! >= half || k + 2 === n) {
      let t = seglen[k]! > 0 ? (half - run) / seglen[k]! : 0.0;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      let adx = f.dx[k]! + t * (f.dx[k + 1]! - f.dx[k]!), adz = f.dz[k]! + t * (f.dz[k + 1]! - f.dz[k]!);
      const l = Math.sqrt(adx * adx + adz * adz);
      if (l > 1e-6) { adx /= l; adz /= l; }
      return { x: f.px[k]! + t * (f.px[k + 1]! - f.px[k]!), y: f.py[k]! + t * (f.py[k + 1]! - f.py[k]!), z: f.pz[k]! + t * (f.pz[k + 1]! - f.pz[k]!), dx: adx, dz: adz };
    }
    run += seglen[k]!;
  }
  return null;
}

/** A sheet strip's row pairs: m = the longer column's rows, at most 200, each column sampled at j (n - 1) / (m - 1). */
export function fallStripRows(na: number, nb: number): [number, number][] {
  let m = Math.max(na, nb);
  if (m > 200) m = 200;
  const out: [number, number][] = [];
  for (let j = 0; j < m; j++) out.push([Math.floor((j * (na - 1)) / (m - 1) + 0.5), Math.floor((j * (nb - 1)) / (m - 1) + 0.5)]);
  return out;
}
