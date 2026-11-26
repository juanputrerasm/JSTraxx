/*
  Group Properties' "Move as one object" (Traxx 1.8.2, a68413d .. 93419dd): Traxx/GroupRigid.cpp
  (the rigid-body maths, feet on every axis) and CTraxxView::ApplyGroupRigid
  (TraxxViewEdit.cpp), the whole selection moved and turned as ONE rigid body about the centre
  of its bounding box.

  WHERE THE AXIS SIGNS COME FROM (GroupRigid.h). One object is drawn as Ry(-phi), then
  Rx(-theta), then Rz(-psi), each a standard right-handed rotation, so

      M = Rz(-psi) * Rx(-theta) * Ry(-phi)       (x, y are ipos X / Y directions, z is up)

  M applied to the local forward (0,1,0) gives (sin psi cos theta, cos psi cos theta, -sin theta),
  the engine's (m3, m9). Pure psi is a CLOCKWISE turn seen from above; positive theta tips the
  forward vector down. core/view/model-geometry.ts objectMatrix is the same matrix.

  Matrices are row-major 3 x 3 arrays (M[row][col]), doubles, as GroupRigid.cpp's double[3][3].
*/
import type { TraxxBox } from "../traxx/sit.ts";
import { traxxSignedSplit, TRAXX_BOX_CRUSH } from "../traxx/sit.ts";
import { boxHeightPairOf, boxHeightPairStore, surfaceTrack, type Ground } from "../traxx/box-ground.ts";
import { interpolateRawAtPoint } from "../traxx/terrain.ts";

export type Mat3 = number[][];

function mul(A: Mat3, B: Mat3): Mat3 {
  const C: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i]![j] = A[i]![0]! * B[0]![j]! + A[i]![1]! * B[1]![j]! + A[i]![2]! * B[2]![j]!;
  return C;
}

// Standard right-handed rotations by an angle given as (sin, cos).
const rotZ = (s: number, c: number): Mat3 => [[c, -s, 0], [s, c, 0], [0, 0, 1]];
const rotX = (s: number, c: number): Mat3 => [[1, 0, 0], [0, c, -s], [0, s, c]];
const rotY = (s: number, c: number): Mat3 => [[c, 0, s], [0, 1, 0], [-s, 0, c]];

/** Compose: M = Rz(a) * Rx(b) * Ry(c) from (sin, cos) pairs. */
function compose(sa: number, ca: number, sb: number, cb: number, sc: number, cc: number): Mat3 {
  return mul(rotZ(sa, ca), mul(rotX(sb, cb), rotY(sc, cc)));
}

/** SinCosDeg: sin and cos of an angle in degrees, exact at every multiple of 90; inf / NaN is no turn. */
function sinCosDeg(deg: number): [number, number] {
  const S = [0, 1, 0, -1], C = [1, 0, -1, 0];
  if (!Number.isFinite(deg)) deg = 0;
  const q = deg / 90;
  if (q === Math.floor(q)) {
    let k = Math.trunc(q % 4);
    if (k < 0) k += 4;
    return [S[k]!, C[k]!];
  }
  const r = (deg * 3.14159265358979323846) / 180;
  return [Math.sin(r), Math.cos(r)];
}

/** BoxAnglesToMatrix: one object's angles (radians) to M = Rz(-psi) * Rx(-theta) * Ry(-phi). */
export function boxAnglesToMatrix(psi: number, phi: number, theta: number): Mat3 {
  return compose(-Math.sin(psi), Math.cos(psi), -Math.sin(theta), Math.cos(theta), -Math.sin(phi), Math.cos(phi));
}

/**
  MatrixToBoxAngles: psi in (-pi, pi], theta in [-pi/2, pi/2], phi in (-pi, pi]. At the gimbal
  pole (|theta| = 90 degrees) phi is 0 and psi takes the whole rotation.
*/
export function matrixToBoxAngles(M: Mat3): { psi: number; phi: number; theta: number } {
  // With a = -psi, b = -theta, c = -phi: M[2][1] = sin b, M[2][0] = -cos b sin c, M[2][2] = cos b cos c,
  // M[0][1] = -sin a cos b, M[1][1] = cos a cos b.
  let sb = M[2]![1]!;
  if (sb > 1) sb = 1;
  if (sb < -1) sb = -1;
  const b = Math.asin(sb);
  let a: number, c: number;
  if (Math.abs(sb) > 1 - 1e-12) {
    c = 0;
    a = Math.atan2(M[1]![0]!, M[0]![0]!);
  } else {
    c = Math.atan2(-M[2]![0]!, M[2]![2]!);
    a = Math.atan2(-M[0]![1]!, M[1]![1]!);
  }
  return { psi: -a, theta: -b, phi: -c };
}

/** GroupRigidMatrix: degrees in, turn = psi, pitch = phi, tilt = theta, the same composition as one object's angles. */
export function groupRigidMatrix(turnDeg: number, pitchDeg: number, tiltDeg: number): Mat3 {
  const [st, ct] = sinCosDeg(turnDeg), [sp, cp] = sinCosDeg(pitchDeg), [sl, cl] = sinCosDeg(tiltDeg);
  return compose(-st, ct, -sl, cl, -sp, cp);
}

/** RigidApply: R * v. */
export function rigidApply(R: Mat3, v: readonly number[]): [number, number, number] {
  const o = [0, 1, 2].map((i) => R[i]![0]! * v[0]! + R[i]![1]! * v[1]! + R[i]![2]! * v[2]!);
  return [o[0]!, o[1]!, o[2]!];
}

/** GroupRigidIsIdentity: R is exactly the identity (what all-zero angles give). */
export function groupRigidIsIdentity(R: Mat3): boolean {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (R[i]![j] !== (i === j ? 1 : 0)) return false;
  return true;
}

/** GroupRigidMovePoint: centre + R * (p - centre), in feet. */
export function groupRigidMovePoint(R: Mat3, centre: readonly number[], p: readonly number[]): [number, number, number] {
  const r = rigidApply(R, [p[0]! - centre[0]!, p[1]! - centre[1]!, p[2]! - centre[2]!]);
  return [centre[0]! + r[0], centre[1]! + r[1], centre[2]! + r[2]];
}

/** Pod1IposSplit: a POSITION cannot be negative; otherwise the signed split. */
function iposSplit(value: number): [number, number] {
  return traxxSignedSplit(value < 0 ? 0 : value);
}

/**
  BoxFeet: one box's position in feet on all three axes: x, y = (ipos + fraction / 256) / 2 (a
  .SIT position is ipos / 2), z = 2 * (ipos[2] + zfraction / 256). Absolute z in both terrain
  modes (Classic 8-bit's ground is whole steps, so its zfraction is the absolute one too).
*/
export function boxFeet(box: TraxxBox): [number, number, number] {
  return [(box.ipos[0] + box.fraction[0] / 256) / 2, (box.ipos[1] + box.fraction[1] / 256) / 2, 2 * (box.ipos[2] + box.fraction[2] / 256)];
}

/** The four amounts (a field not usable counts as 0): Raise by in ipos[2] steps, the rest in degrees. */
export interface GroupRigidAmounts { raise: number; turn: number; pitch: number; tilt: number }

/**
  CTraxxView::ApplyGroupRigid. The centre is the midpoint of the extremes on each axis, snapped to
  the 1/512 ft position grid (so a quarter turn lands on that grid exactly). Per box: the position
  turned about the centre, the orientation R * B decomposed back (stored 0..2 pi), a Top-Crush's
  crush offset turned by R, x / y written by Pod1IposSplit, the absolute Z + Raise by written by
  Pod1SignedSplit, then the height above the ground re-derived under the new x / y (classic:
  ipos[2] less InterpolateRawAtPoint; else BoxHeightPairOf). Below the ground is allowed; at or
  above `cap` (ObjectHeightCap) the object is put at the cap.
*/
export function applyGroupRigid(boxes: readonly TraxxBox[], amounts: GroupRigidAmounts, ground: Ground, cap: number): void {
  const n = boxes.length;
  if (n <= 0) return;
  const R = groupRigidMatrix(amounts.turn, amounts.pitch, amounts.tilt);
  const turned = !groupRigidIsIdentity(R);
  if (!turned && amounts.raise === 0) return;
  const lo = [0, 0, 0], hi = [0, 0, 0];
  boxes.forEach((box, i) => {
    const p = boxFeet(box);
    for (let k = 0; k < 3; k++) {
      if (i === 0 || p[k]! < lo[k]!) lo[k] = p[k]!;
      if (i === 0 || p[k]! > hi[k]!) hi[k] = p[k]!;
    }
  });
  const centre = [0, 1, 2].map((k) => Math.floor(((lo[k]! + hi[k]!) / 2) * 512 + 0.5) / 512);
  const surface = surfaceTrack(ground);
  const TWO_PI = 2 * Math.PI;
  for (const box of boxes) {
    const p = boxFeet(box);
    let q: number[] = [...p];
    if (turned) {
      q = groupRigidMovePoint(R, centre, p);
      // New orientation: the group's rotation in the world frame, after the object's own.
      const ang = matrixToBoxAngles(mul(R, boxAnglesToMatrix(box.psi, box.phi, box.theta)));
      // Stored in 0..2PI, as the nudge keys leave them (GroupFieldTexts shows 0..360).
      const store = (a: number) => {
        if (a < 0) a += TWO_PI;
        let f = Math.fround(a);
        if (f >= Math.fround(TWO_PI)) f = 0;
        return f;
      };
      box.psi = store(ang.psi);
      box.phi = store(ang.phi);
      box.theta = store(ang.theta);
      if (box.type === TRAXX_BOX_CRUSH) {
        const ro = rigidApply(R, box.crush);
        box.crush = [Math.fround(ro[0]), Math.fround(ro[1]), Math.fround(ro[2])];
      }
      [box.ipos[0], box.fraction[0]] = iposSplit(q[0]! * 2);
      [box.ipos[1], box.fraction[1]] = iposSplit(q[1]! * 2);
    }
    // The absolute Z, in ipos[2] steps, lifted by Raise by.
    [box.ipos[2], box.fraction[2]] = traxxSignedSplit(q[2]! / 2 + amounts.raise);
    // Height above the ground under the new x / y, from where the box now IS.
    box.heightAboveGround = surface ? boxHeightPairOf(surface, box)[0]
      : box.ipos[2] - interpolateRawAtPoint(ground instanceof Uint8Array ? ground : ground.heights, box.ipos[0], box.ipos[1]);
    if (box.heightAboveGround >= cap) {
      box.heightAboveGround = cap;
      box.fraction[2] = 0;
      boxHeightPairStore(ground, box);
    }
  }
}
