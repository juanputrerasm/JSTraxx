/*
  The engine's tree-trunk collision box, ported exactly from Traxx 1.8.0 (ae75b30,
  Traxx/VegetationTrunk.h/.cpp; engine a2c1819, handover TRAXX_HANDOVER_ENGINE_RULES.md section 2).

  A SQUARE box centred on the tree origin and yawed by its heading: side 65% of the widest axis of
  the vertices in the lowest 5 ft (15% of the model width for keyframed models or a band of under
  3 vertices), floored at 1 ft and capped at the full width; height 30% of the model, clamped to
  [6 ft, model height]. An explicit SPEC trunkdiam (1/64 ft) and trunkheight (1/16 ft) are
  independent and the diameter takes no clamps. Every number is the engine's integer in 1/256 ft
  with C truncating division; fmul is (int64 a * b) >> 16.

  Pure: raw model bytes in, numbers out. Drawing the box is the view's.
*/
import { keyframeFirstFrame } from "./keyframe.ts";

const VT_MRGL_VLIST = 2;
const VT_MRGL_MAGNIFY = 20;
const FT = 256;

export interface VegTrunk {
  /** The model's scaled AABB in y (up), 1/256 ft, scale 1. */
  minY: number;
  maxY: number;
  /** max((maxX - minX) / 2, (maxZ - minZ) / 2). */
  radius: number;
  /** The box's side and height at scale 1. */
  trunkDiam: number;
  trunkHeight: number;
  /** False when the author's explicit trunkdiam was used. */
  derived: boolean;
  /** The diameter came from the lowest-5-ft vertex band (x 0.65). */
  bandUsed: boolean;
  /** The band's widest axis (valid when bandUsed). */
  bandWidth: number;
  /** The trap: canopy vertices are in the trunk band (model taller than 5 ft and the band wider than half the model). */
  canopyInBand: boolean;
}

const rdInt = (p: Uint8Array, at: number) => (p[at]! | (p[at + 1]! << 8) | (p[at + 2]! << 16) | (p[at + 3]! << 24));
/** fmul (engine\64BIT.H): (int64 a * b) >> 16, arithmetic, cast to int. */
const fmul = (a: number, b: number) => Number(BigInt.asIntN(32, (BigInt(a) * BigInt(b)) >> 16n));
/** C int division (truncating) of 32-bit values. */
const idiv = (a: number, b: number) => Math.trunc(a / b) | 0;

/**
  VegTrunkDerive: `model` must be MAGNIFY then VLIST. keyframed: `model` is the species' keyframe
  record's first frame (vegTrunkFirstFrame), and the diameter falls back to 15% of the width.
  explicitDiam (1/64 ft) and explicitHeight (1/16 ft), 0 = derive. Null when the model cannot be
  read as the engine reads it.
*/
export function vegTrunkDerive(model: Uint8Array, keyframed: boolean, explicitDiam: number, explicitHeight: number): VegTrunk | null {
  const size = model.length;
  if (size < 20 + 12) return null;
  if (rdInt(model, 0) !== VT_MRGL_MAGNIFY || rdInt(model, 8) !== VT_MRGL_VLIST) return null;
  const power = rdInt(model, 4);
  const n = rdInt(model, 16);
  if (power <= 0 || n <= 0 || 20 + n * 12 > size) return null;
  const scale = Math.imul(idiv(0x7fffffff, power), 2);

  const mn = [0, 1, 2].map((a) => rdInt(model, 20 + a * 4));
  const mx = [...mn];
  for (let i = 1; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const c = rdInt(model, 20 + i * 12 + a * 4);
      if (c < mn[a]!) mn[a] = c;
      if (c > mx[a]!) mx[a] = c;
    }
  }
  // File order is x, y (UP), z. Scaling is monotone, so min/max of the scaled = scaled min/max.
  const minY = fmul(mn[1]!, scale), maxY = fmul(mx[1]!, scale);
  const sx0 = fmul(mn[0]!, scale), sx1 = fmul(mx[0]!, scale);
  const sz0 = fmul(mn[2]!, scale), sz1 = fmul(mx[2]!, scale);
  const ex = idiv((sx1 - sx0) | 0, 2), ez = idiv((sz1 - sz0) | 0, 2);
  const radius = ex > ez ? ex : ez;
  const r: VegTrunk = { minY, maxY, radius, trunkDiam: 0, trunkHeight: 0, derived: true, bandUsed: false, bandWidth: 0, canopyInBand: false };

  const h = (maxY - minY) | 0;
  let th = explicitHeight ? Math.imul(explicitHeight, 16) : idiv(Math.imul(h, 3), 10);
  if (th < 6 * FT) th = 6 * FT;
  if (th > h && h > 0) th = h;
  r.trunkHeight = th;

  if (explicitDiam) {
    r.trunkDiam = Math.imul(explicitDiam, 4); // explicit: no clamps at all
    r.derived = false;
    return r;
  }

  let td = idiv(Math.imul(Math.imul(radius, 2), 15), 100); // the fallback (also every keyframed model)
  if (!keyframed) {
    let bx0 = 0x7fffffff, bx1 = -0x7fffffff, bz0 = 0x7fffffff, bz1 = -0x7fffffff, found = 0;
    for (let i = 0; i < n; i++) {
      const x = fmul(rdInt(model, 20 + i * 12), scale);
      const y = fmul(rdInt(model, 20 + i * 12 + 4), scale);
      const z = fmul(rdInt(model, 20 + i * 12 + 8), scale);
      if (y > ((minY + 5 * FT) | 0)) continue;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (z < bz0) bz0 = z;
      if (z > bz1) bz1 = z;
      found++;
    }
    if (found >= 3) {
      const w = ((bx1 - bx0) | 0) > ((bz1 - bz0) | 0) ? (bx1 - bx0) | 0 : (bz1 - bz0) | 0;
      td = idiv(Math.imul(w, 65), 100);
      r.bandUsed = true;
      r.bandWidth = w;
      r.canopyInBand = ((maxY - minY) | 0) > 5 * FT && w > radius;
    }
  }
  if (td < 1 * FT) td = 1 * FT; // floor first ...
  if (td > radius * 2 && radius > 0) td = radius * 2; // ... then the cap
  r.trunkDiam = td;
  return r;
}

/** VegTrunkFirstFrame: a KEYFRAME / KEYFRAME64 record's frame 0 name as stored, or null. */
export function vegTrunkFirstFrame(model: Uint8Array): string | null {
  return keyframeFirstFrame(model);
}

/**
  VegTrunkPlace: one tree's box in feet. treeY is the tree's model-origin y in 1/256 ft, scale its
  VegTree scale (4096 = 1). The box is centred on the tree origin in x / z, yawed by its heading.
*/
export function vegTrunkPlace(t: VegTrunk, treeY: number, scale: number): { side: number; height: number; base: number } {
  const s = scale / 4096;
  return { side: (t.trunkDiam * s) / 256, height: (t.trunkHeight * s) / 256, base: (treeY + s * t.minY) / 256 };
}
