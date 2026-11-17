/*
  Picking a drivable mesh under the pointer: a JSTraxx addition for tracks built of meshes.

  Community Patch 4 drives trucks on placed models' triangles (OpenMTM2 docs/CP4_EXE_ANALYSIS.md 11.2): every box with
  a model except a fog (type 14) collides by its model's triangles, tested from both sides, and a face is driven on
  when it faces up (wallSkipDrivable: its up component over 0.5). A course point or a truck start picked on such a
  street, deck or tunnel floor belongs at that surface, not at the terrain under it, which Traxx's pick
  (PickSurfaceRay) is the only answer to.

  Scene units as the view draws objects (objectMatrix): x and y ipos, z ALTITUDE_SCALE units with Traxx's object
  Z stretch. The ray is taken into each model's own frame (the object transform is affine, so the distance along the
  ray stays the same), tried first against the model's bounds, then against its triangles. The world-wrap border's
  copies of objects are not picked, as they are not in the track's list.
*/
import { objectMatrix, type ModelGeometry } from "./model-geometry.ts";
import { TRAXX_BOX_FOG } from "../traxx/sit.ts";

type V3 = [number, number, number];

/** A face is driven on when its normal, turned to the eye, has at least this up component (CP4's wallSkipDrivable). */
export const DRIVABLE_UP = 0.5;

export interface DrivableMesh {
  /** The object transform, column-major 4 x 4 (objectMatrix). */
  matrix: number[];
  /** Its inverse's 3 x 3 part, row-major, and the inverse translation. */
  inverse: number[];
  /** Triangles in the model's frame, 9 numbers each. */
  tris: Float32Array;
  /** The triangles' bounds in the model's frame. */
  min: V3;
  max: V3;
}

interface Placed { type: number; modelName: string; ipos: [number, number, number]; fraction: [number, number, number]; theta: number; phi: number; psi: number }

function invert(m: number[]): number[] {
  // Columns of the 3 x 3: (m0 m1 m2), (m4 m5 m6), (m8 m9 m10); a[r][c] = m[c * 4 + r].
  const a = (r: number, c: number) => m[c * 4 + r]!;
  const det = a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
  const k = det === 0 ? 0 : 1 / det;
  const i = [
    (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) * k, (a(0, 2) * a(2, 1) - a(0, 1) * a(2, 2)) * k, (a(0, 1) * a(1, 2) - a(0, 2) * a(1, 1)) * k,
    (a(1, 2) * a(2, 0) - a(1, 0) * a(2, 2)) * k, (a(0, 0) * a(2, 2) - a(0, 2) * a(2, 0)) * k, (a(0, 2) * a(1, 0) - a(0, 0) * a(1, 2)) * k,
    (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0)) * k, (a(0, 1) * a(2, 0) - a(0, 0) * a(2, 1)) * k, (a(0, 0) * a(1, 1) - a(0, 1) * a(1, 0)) * k,
  ];
  const t = [m[12]!, m[13]!, m[14]!];
  return [...i, -(i[0]! * t[0] + i[1]! * t[1] + i[2]! * t[2]), -(i[3]! * t[0] + i[4]! * t[1] + i[5]! * t[2]), -(i[6]! * t[0] + i[7]! * t[1] + i[8]! * t[2])];
}

/** The placed models trucks drive on, from the track's boxes and a model's geometry by name (null when none). */
export function drivableMeshes(boxes: readonly Placed[], geometryOf: (name: string) => ModelGeometry | null): DrivableMesh[] {
  const soups = new Map<string, { tris: Float32Array; min: V3; max: V3 } | null>();
  const soupOf = (name: string) => {
    const key = name.toUpperCase();
    if (soups.has(key)) return soups.get(key)!;
    const g = geometryOf(name);
    let soup: { tris: Float32Array; min: V3; max: V3 } | null = null;
    const length = g ? g.groups.reduce((n, grp) => n + grp.positions.length, 0) : 0;
    if (g && length >= 9) {
      const tris = new Float32Array(length);
      let at = 0;
      for (const grp of g.groups) { tris.set(grp.positions, at); at += grp.positions.length; }
      const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, tris[i + k]!); max[k] = Math.max(max[k]!, tris[i + k]!); }
      soup = { tris, min, max };
    }
    soups.set(key, soup);
    return soup;
  };
  const out: DrivableMesh[] = [];
  for (const box of boxes) {
    if (box.type === TRAXX_BOX_FOG || !box.modelName) continue;
    const soup = soupOf(box.modelName);
    if (!soup) continue;
    const matrix = objectMatrix(box);
    out.push({ matrix, inverse: invert(matrix), ...soup });
  }
  return out;
}

/** The slab test of a ray against bounds: the entry distance, or -1. */
function slab(o: V3, d: V3, min: V3, max: V3, far: number): number {
  let t0 = 0, t1 = far;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]!) < 1e-12) { if (o[k]! < min[k]! || o[k]! > max[k]!) return -1; continue; }
    let a = (min[k]! - o[k]!) / d[k]!, b = (max[k]! - o[k]!) / d[k]!;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  return t0;
}

/**
  The nearest drivable face along the ray (scene units; `dir` need not be normalised) nearer than `far`: the point and
  the distance, or null. Faces that are walls to a truck (up component under DRIVABLE_UP, the normal turned to the
  eye) are passed through.
*/
export function pickMesh(meshes: readonly DrivableMesh[], origin: V3, dir: V3, far = Infinity): { point: V3; t: number } | null {
  let best: { point: V3; t: number } | null = null;
  for (const mesh of meshes) {
    const iv = mesh.inverse;
    const o: V3 = [
      iv[0]! * origin[0] + iv[1]! * origin[1] + iv[2]! * origin[2] + iv[9]!,
      iv[3]! * origin[0] + iv[4]! * origin[1] + iv[5]! * origin[2] + iv[10]!,
      iv[6]! * origin[0] + iv[7]! * origin[1] + iv[8]! * origin[2] + iv[11]!,
    ];
    const d: V3 = [iv[0]! * dir[0] + iv[1]! * dir[1] + iv[2]! * dir[2], iv[3]! * dir[0] + iv[4]! * dir[1] + iv[5]! * dir[2], iv[6]! * dir[0] + iv[7]! * dir[1] + iv[8]! * dir[2]];
    const limit = Math.min(far, best ? best.t : Infinity);
    if (slab(o, d, mesh.min, mesh.max, limit) < 0) continue;
    const m = mesh.matrix, p = mesh.tris;
    // Local to scene for an edge (no translation).
    const toScene = (x: number, y: number, z: number): V3 => [m[0]! * x + m[4]! * y + m[8]! * z, m[1]! * x + m[5]! * y + m[9]! * z, m[2]! * x + m[6]! * y + m[10]! * z];
    for (let i = 0; i < p.length; i += 9) {
      const ax = p[i]!, ay = p[i + 1]!, az = p[i + 2]!;
      const e1x = p[i + 3]! - ax, e1y = p[i + 4]! - ay, e1z = p[i + 5]! - az;
      const e2x = p[i + 6]! - ax, e2y = p[i + 7]! - ay, e2z = p[i + 8]! - az;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = o[0] - ax, sy = o[1] - ay, sz = o[2] - az;
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t < 0 || t >= (best ? best.t : far)) continue;
      // The face's normal in feet (the scene has 2 units a foot across and 1.5 up: 3 a step of 2 ft), turned to the eye.
      const a = toScene(e1x, e1y, e1z), b = toScene(e2x, e2y, e2z);
      a[0] /= 2; a[1] /= 2; a[2] /= 1.5; b[0] /= 2; b[1] /= 2; b[2] /= 1.5;
      let nx = a[1] * b[2] - a[2] * b[1], ny = a[2] * b[0] - a[0] * b[2], nz = a[0] * b[1] - a[1] * b[0];
      if (nx * dir[0] + ny * dir[1] + nz * dir[2] > 0) { nx = -nx; ny = -ny; nz = -nz; }
      const len = Math.hypot(nx, ny, nz);
      if (!len || nz / len < DRIVABLE_UP) continue;
      best = { point: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t], t };
    }
  }
  return best;
}
