/*
  The vegetation pass's rules, as COpenGLTerrainRenderer::DrawVegetation applies them
  (Traxx/OpenGLTerrainRenderer.cpp), in the view's scene units: x and y at 64 per 32 ft cell
  (2 per foot), z at ALTITUDESCALE per 2 ft step (1.5 per foot). Plain data, no three.js.

    - a tree stands at its record's (x, z) (1/256 ft) and y (up, 1/256 ft), turned by its heading
      through Traxx's 4096-entry sine table, scaled by scale / 4096 and by the object stack's
      z-stretch 0.75 (VegComposeMatrix);
    - a clump stands at its tile plus (fx, fz) eighths of a foot, turned by heading / 256 of a
      turn, scaled by 0.25 + scale / 64;
    - a facing species ignores the heading and turns to the camera's yaw;
    - a tree whose species has a usable far card shows the card past the far band (900 to
      1000 ft, horizontal distance; a hard switch at 950 ft without VEG_FLAG_CROSSFADE), the
      model inside it, and in the band each tree by a stable hash of its index;
    - grass shows to vegGrassDistFt (1000 ft), thinning by the same hash over the last quarter.
*/
import { VEG_FLAG_CROSSFADE, VEG_FLAG_FACING, type Vegetation } from "../traxx/veg.ts";

export const VEG_SINTABSIZE = 4096;
/** Far-card band, ft (TRAXX_VEG_FAR_BEGIN_FT / _END_FT: the engine's default SPEC fade). */
export const VEG_FAR_BEGIN_FT = 900;
export const VEG_FAR_END_FT = 1000;
/** vegGrassDistFt: the engine's default [Graphics] vegGrassDist. */
export const VEG_GRASS_DIST_FT = 1000;
/** TRAXX_VEG_AIDRANGEFT: trunk cylinders are drawn this close to the camera. */
export const VEG_AID_RANGE_FT = 600;
/** Scene units per foot across (x, y) and up (z). */
export const SCENE_PER_FT = 2;
export const SCENE_Z_PER_FT = 1.5;

/* VegNewState's tables: float sines and cosines of i / 4096 of a turn. */
const SIN = new Float32Array(VEG_SINTABSIZE);
const COS = new Float32Array(VEG_SINTABSIZE);
for (let i = 0; i < VEG_SINTABSIZE; i++) {
  const a = (2 * Math.PI * i) / VEG_SINTABSIZE;
  SIN[i] = Math.sin(a);
  COS[i] = Math.cos(a);
}

/** A tree's table index: ((heading + 8) >> 4) & 4095. */
export function treeHeadingIndex(heading: number): number {
  return ((heading + 8) >> 4) & (VEG_SINTABSIZE - 1);
}

/** A clump's table index: heading << 4. */
export function clumpHeadingIndex(heading: number): number {
  return (heading << 4) & (VEG_SINTABSIZE - 1);
}

export function headingCosSin(index: number): [number, number] {
  return [COS[index]!, SIN[index]!];
}

/** A tree's origin in scene units. */
export function treeScene(t: { x: number; y: number; z: number }): [number, number, number] {
  return [t.x / 128, t.z / 128, (t.y * 3) / 512];
}

/** A clump's origin in scene units. */
export function clumpScene(c: { tx: number; tz: number; fx: number; fz: number; y: number }): [number, number, number] {
  return [c.tx * 64 + c.fx / 4, c.tz * 64 + c.fz / 4, (c.y * 3) / 512];
}

export function treeScale(scale: number): number {
  return scale / 4096;
}

export function clumpScale(scale: number): number {
  return 0.25 + scale / 64;
}

/**
  VegComposeMatrix, column-major: model x to k (cs, -sn, 0), model y to k (sn, cs, 0), model z to
  0.75 k up, origin at pos. (The same turn as a box's psi in objectMatrix.)
*/
export function plantMatrix(out: Float32Array | number[], offset: number, pos: readonly number[], cs: number, sn: number, k: number): void {
  out[offset] = k * cs; out[offset + 1] = -k * sn; out[offset + 2] = 0; out[offset + 3] = 0;
  out[offset + 4] = k * sn; out[offset + 5] = k * cs; out[offset + 6] = 0; out[offset + 7] = 0;
  out[offset + 8] = 0; out[offset + 9] = 0; out[offset + 10] = 0.75 * k; out[offset + 11] = 0;
  out[offset + 12] = pos[0]!; out[offset + 13] = pos[1]!; out[offset + 14] = pos[2]!; out[offset + 15] = 1;
}

/** The stable per-plant dither value, 0..65535: ((index * 2654435761) >> 16) & 0xFFFF. */
export function plantHash(index: number): number {
  return (Math.imul(index, 2654435761 | 0) >>> 16) & 0xffff;
}

/**
  The facing yaw: the heading that lays a card's model x along the camera's right-hand axis,
  given that axis in scene coordinates. (1, 0) when it has no horizontal part.
*/
export function facingCosSin(rightX: number, rightY: number): [number, number] {
  const l = Math.hypot(rightX, rightY);
  return l > 1e-9 ? [rightX / l, -rightY / l] : [1, 0];
}

/** A species' far band in ft, [lo, hi]: the hard switch at the midpoint without the cross-fade flag. */
export function farBand(flags: number): [number, number] {
  if (flags & VEG_FLAG_CROSSFADE) return [VEG_FAR_BEGIN_FT, VEG_FAR_END_FT];
  const mid = 0.5 * (VEG_FAR_BEGIN_FT + VEG_FAR_END_FT);
  return [mid, mid];
}

/** Model or far card for a tree at a horizontal distance (ft), by its index's hash in the band. */
export function useFarCard(distFt: number, band: readonly [number, number], index: number): boolean {
  const [lo, hi] = band;
  if (distFt >= hi) return true;
  if (distFt <= lo) return false;
  return plantHash(index) < ((distFt - lo) / (hi - lo)) * 65536;
}

/** Grass: drawn inside the distance, thinned by the hash over its last quarter. */
export function keepClump(distFt: number, index: number, limitFt = VEG_GRASS_DIST_FT): boolean {
  if (distFt > limitFt) return false;
  if (distFt * distFt <= 0.5625 * limitFt * limitFt) return true;
  const keep = (limitFt - distFt) / (0.25 * limitFt);
  return plantHash(index) < keep * 65536;
}

/** The facts the pass keeps per species model (VegEnsureList), from its drawn vertices in model units. */
export interface VegModelFacts {
  /** Farthest vertex from the origin, z at 0.75 (radius). */
  radius: number;
  /** Farthest horizontal vertex. */
  hrad: number;
  /** Height span, z at 0.75. */
  height: number;
  /** modelIsFlatCard: the vertex box's thinnest extent times 20 is under its largest. */
  flat: boolean;
}

/** VegEnsureList's measures over (x, y, z) model-unit vertices. */
export function vegModelFacts(vertices: ArrayLike<number>): VegModelFacts {
  let r2 = 0, h2 = 0, zlo = 0, zhi = 0, any = false;
  const bmin = [0, 0, 0], bmax = [0, 0, 0];
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    const x = vertices[i]!, y = vertices[i + 1]!, zr = vertices[i + 2]!, z = 0.75 * zr;
    const d2 = x * x + y * y + z * z;
    if (d2 > r2) r2 = d2;
    if (x * x + y * y > h2) h2 = x * x + y * y;
    if (!any || z < zlo) zlo = z;
    if (!any || z > zhi) zhi = z;
    const c = [x, y, zr];
    for (let k = 0; k < 3; k++) {
      if (!any || c[k]! < bmin[k]!) bmin[k] = c[k]!;
      if (!any || c[k]! > bmax[k]!) bmax[k] = c[k]!;
    }
    any = true;
  }
  const e = [bmax[0]! - bmin[0]!, bmax[1]! - bmin[1]!, bmax[2]! - bmin[2]!];
  const mn = Math.min(...e), mx = Math.max(...e);
  return { radius: Math.sqrt(r2), hrad: Math.sqrt(h2), height: zhi - zlo, flat: any && mx > 0 && mn * 20 < mx };
}

/** What one species draws with, resolved from the track's models (VegPrepare). */
export interface VegSpeciesDraw {
  /** The model's name as the track lists it, or null when it is not in the track. */
  model: string | null;
  /** The far card's name, or null: none named, not in the track, a facing species, or the engine would not instance it or the model. */
  far: string | null;
  facing: boolean;
  /** The far card is one flat quad, turned to the camera; otherwise crossed quads at the tree's heading. */
  farFlat: boolean;
  /** The card's seating lift, model units (sp.minY - fsp.minY), 0 when either is unknown. */
  farLift: number;
  band: [number, number];
}

/** A model as the pass needs it: its raw bytes and drawn vertices, by bare or full name. */
export interface VegModelSource {
  name: string;
  bytes: Uint8Array | null;
  /** Drawn vertices in model units, (x, y, z) z up. */
  vertices: ArrayLike<number> | null;
}

/**
  VegPrepare's species resolution: each species' model and far card by name (IsModelLoaded), the
  card kept only when the engine would instance both it and the model, its flatness and lift.
*/
export function resolveVegSpecies(
  v: Pick<Vegetation, "species">,
  find: (name: string) => VegModelSource | null,
  instanceOk: (bytes: Uint8Array | null) => boolean,
  baseY: (bytes: Uint8Array | null) => number | null,
): VegSpeciesDraw[] {
  return v.species.map((s) => {
    const facing = (s.flags & VEG_FLAG_FACING) !== 0;
    const m = s.model ? find(s.model) : null;
    const f = s.farmodel && !facing ? find(s.farmodel) : null;
    const draw: VegSpeciesDraw = { model: m ? m.name : null, far: null, facing, farFlat: false, farLift: 0, band: farBand(s.flags) };
    if (m && f && f.vertices && instanceOk(m.bytes) && instanceOk(f.bytes)) {
      draw.far = f.name;
      draw.farFlat = vegModelFacts(f.vertices).flat;
      const a = baseY(m.bytes), b = baseY(f.bytes);
      if (a !== null && b !== null) draw.farLift = 0.5 * a - 0.5 * b;
    }
    return draw;
  });
}

/** The cell window the pass draws in, inclusive (the terrain's; Whole Grid: the map). */
export function vegWindow(gridx: number, gridy: number, gridsize: number, whole: boolean): { cx0: number; cy0: number; cx1: number; cy1: number } {
  if (whole) return { cx0: 0, cy0: 0, cx1: 255, cy1: 255 };
  const half = (gridsize - 1) >> 1;
  return { cx0: gridx - half, cy0: gridy - half, cx1: gridx + half - 1, cy1: gridy + half - 1 };
}

/** A tree's 32 ft tile, clamped to the map (VegTreeTile: x >> 13). */
export function treeTile(t: { x: number; z: number }): [number, number] {
  return [Math.min(255, Math.max(0, t.x >> 13)), Math.min(255, Math.max(0, t.z >> 13))];
}
