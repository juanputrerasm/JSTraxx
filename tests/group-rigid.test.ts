/*
  Group Properties' "Move as one object" (core/edit/group-rigid.ts), with every check of Traxx's
  tools/grouprigidtest.cpp (the same seeded generator, so the same random cases), plus
  ApplyGroupRigid on boxes.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyGroupRigid, boxAnglesToMatrix, groupRigidIsIdentity, groupRigidMatrix, groupRigidMovePoint, matrixToBoxAngles, rigidApply, type Mat3,
} from "../src/core/edit/group-rigid.ts";
import { traxxBoxDefaults as blankTraxxBox, TRAXX_BOX_CRUSH } from "../src/core/traxx/sit.ts";

const PI = 3.14159265358979323846;
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
const angDiff = (a: number, b: number) => {
  let d = (a - b) % (2 * PI);
  if (d > PI) d -= 2 * PI;
  if (d <= -PI) d += 2 * PI;
  return d;
};
const matNear = (A: Mat3, B: Mat3, eps: number) => A.every((row, i) => row.every((v, j) => near(v, B[i]![j]!, eps)));
const mulM = (A: Mat3, B: Mat3): Mat3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => A[i]![0]! * B[0]![j]! + A[i]![1]! * B[1]![j]! + A[i]![2]! * B[2]![j]!));

// grouprigidtest.cpp's generator: g_seed * 1664525 + 1013904223 (unsigned 32-bit).
let seed = 12345;
const rnd = (lo: number, hi: number) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return lo + (hi - lo) * ((seed >>> 8) / 16777216);
};

test("grouprigidtest: matrix -> angles -> matrix, the pole, the forward vector and the pure-angle senses", () => {
  seed = 12345;
  for (let n = 0; n < 50; n++) {
    const psi = rnd(-PI, PI), phi = rnd(-PI, PI), theta = rnd((-80 * PI) / 180, (80 * PI) / 180);
    const M = boxAnglesToMatrix(psi, phi, theta);
    const a = matrixToBoxAngles(M);
    assert.ok(matNear(M, boxAnglesToMatrix(a.psi, a.phi, a.theta), 1e-9));
    assert.ok(near(angDiff(psi, a.psi), 0, 1e-9) && near(angDiff(phi, a.phi), 0, 1e-9) && near(theta, a.theta, 1e-9));
  }
  for (const [psi, phi, theta] of [[0.7, 0.4, PI / 2], [-1.1, -0.9, -PI / 2]] as const) {
    const M = boxAnglesToMatrix(psi, phi, theta);
    const a = matrixToBoxAngles(M);
    assert.ok(matNear(M, boxAnglesToMatrix(a.psi, a.phi, a.theta), 1e-9), "the pole: only the matrix");
  }
  for (let n = 0; n < 50; n++) {
    const psi = rnd(-PI, PI), phi = rnd(-PI, PI), theta = rnd(-PI / 2, PI / 2);
    const o = rigidApply(boxAnglesToMatrix(psi, phi, theta), [0, 1, 0]);
    assert.ok(near(o[0], Math.sin(psi) * Math.cos(theta), 1e-12));
    assert.ok(near(o[1], Math.cos(psi) * Math.cos(theta), 1e-12));
  }
  let o = rigidApply(boxAnglesToMatrix(PI / 2, 0, 0), [1, 0, 0]);
  assert.ok(near(o[0], 0, 1e-12) && near(o[1], -1, 1e-12), "Rz(-90): x -> -y");
  o = rigidApply(boxAnglesToMatrix(0, 0, PI / 2), [0, 1, 0]);
  assert.ok(near(o[1], 0, 1e-12) && near(o[2], -1, 1e-12), "Rx(-90): y -> -z");
  o = rigidApply(boxAnglesToMatrix(0, PI / 2, 0), [1, 0, 0]);
  assert.ok(near(o[0], 0, 1e-12) && near(o[2], 1, 1e-12), "Ry(-90): x -> +z");
});

test("grouprigidtest: exact half and quarter turns, the engine convention", () => {
  const R = groupRigidMatrix(180, 0, 0);
  const a = rigidApply(R, [13.5, -7.25, 2]), b = rigidApply(R, a);
  assert.deepEqual(b, [13.5, -7.25, 2]);
  assert.ok(a[0] === -13.5 && a[1] === 7.25 && a[2] === 2);
  for (let k = -4; k <= 8; k++) {
    const Q = groupRigidMatrix(90 * k, 0, 0);
    assert.ok(Q.every((row) => row.every((v) => v === 0 || v === 1 || v === -1)), `quarter turn ${k} is exact`);
  }
  const o = rigidApply(groupRigidMatrix(90, 0, 0), [1, 0, 0]);
  assert.ok(o[0] === 0 && o[1] === -1 && o[2] === 0);
  const d = (30 * PI) / 180, o2 = rigidApply(groupRigidMatrix(30, 0, 0), [3, 5, 0]);
  assert.ok(near(o2[0], 3 * Math.cos(d) + 5 * Math.sin(d), 1e-12) && near(o2[1], -3 * Math.sin(d) + 5 * Math.cos(d), 1e-12));
});

test("grouprigidtest: turn-only adds to psi; pitch-only and tilt-only; identity detection", () => {
  // Its own random cases (the C test runs them after the others: the property holds for any triple).
  seed = 54321;
  for (let n = 0; n < 30; n++) {
    const psi = rnd(-PI, PI), phi = rnd(-PI, PI), theta = rnd((-80 * PI) / 180, (80 * PI) / 180);
    const a = matrixToBoxAngles(mulM(groupRigidMatrix(30, 0, 0), boxAnglesToMatrix(psi, phi, theta)));
    assert.ok(near(angDiff(a.psi, psi + (30 * PI) / 180), 0, 1e-9));
    assert.ok(near(angDiff(a.phi, phi), 0, 1e-9));
    assert.ok(near(a.theta, theta, 1e-9));
  }
  const B = boxAnglesToMatrix(0, 0, 0);
  let a = matrixToBoxAngles(mulM(groupRigidMatrix(0, 25, 0), B));
  assert.ok(near(a.phi, (25 * PI) / 180, 1e-9) && near(a.psi, 0, 1e-9) && near(a.theta, 0, 1e-9));
  a = matrixToBoxAngles(mulM(groupRigidMatrix(0, 0, 40), B));
  assert.ok(near(a.theta, (40 * PI) / 180, 1e-9) && near(a.psi, 0, 1e-9) && near(a.phi, 0, 1e-9));
  assert.ok(groupRigidIsIdentity(groupRigidMatrix(0, 0, 0)));
  assert.ok(!groupRigidIsIdentity(groupRigidMatrix(0.001, 0, 0)));
  assert.ok(!groupRigidIsIdentity(groupRigidMatrix(180, 0, 0)));
});

test("grouprigidtest: points on the 1/512 ft grid come back exactly", () => {
  const R = groupRigidMatrix(180, 0, 0);
  let exact = true;
  for (let n = 0; n < 200; n++) {
    const p: number[] = [], c: number[] = [];
    for (let k = 0; k < 3; k++) { p[k] = Math.floor(rnd(0, 8000 * 512)) / 512; c[k] = Math.floor(rnd(0, 8000 * 512)) / 512; }
    const a = groupRigidMovePoint(R, c, p);
    if (a[0] !== 2 * c[0]! - p[0]! || a[1] !== 2 * c[1]! - p[1]! || a[2] !== p[2]) exact = false;
    const b = groupRigidMovePoint(R, c, a);
    if (b[0] !== p[0] || b[1] !== p[1] || b[2] !== p[2]) exact = false;
  }
  assert.ok(exact, "180 twice");
  const R90 = groupRigidMatrix(90, 0, 0), R270 = groupRigidMatrix(270, 0, 0);
  let ongrid = true;
  exact = true;
  for (let n = 0; n < 200; n++) {
    const p: number[] = [], c: number[] = [];
    for (let k = 0; k < 3; k++) {
      p[k] = Math.floor(rnd(0, 8000 * 512)) / 512;
      c[k] = Math.floor((Math.floor(rnd(0, 8000 * 512)) + Math.floor(rnd(0, 8000 * 512))) / 2 + 0.5) / 512;
    }
    const a = groupRigidMovePoint(R90, c, p);
    if (a[0] * 512 !== Math.floor(a[0] * 512) || a[1] * 512 !== Math.floor(a[1] * 512)) ongrid = false;
    const e = groupRigidMovePoint(R90, c, groupRigidMovePoint(R90, c, groupRigidMovePoint(R90, c, a)));
    if (e[0] !== p[0] || e[1] !== p[1] || e[2] !== p[2]) exact = false;
    const b = groupRigidMovePoint(R270, c, a);
    if (b[0] !== p[0] || b[1] !== p[1] || b[2] !== p[2]) exact = false;
  }
  assert.ok(ongrid, "each quarter turn stays on the grid");
  assert.ok(exact, "90 four times, and 90 then 270");
});

test("grouprigidtest: non-finite degrees count as 0", () => {
  for (const bad of [Infinity, -Infinity, NaN]) {
    assert.ok(groupRigidIsIdentity(groupRigidMatrix(bad, 0, 0)));
    assert.ok(groupRigidIsIdentity(groupRigidMatrix(0, bad, 0)));
    assert.ok(groupRigidIsIdentity(groupRigidMatrix(0, 0, bad)));
  }
});

test("ApplyGroupRigid: two boxes turned 90 about their centre, raised, the crush offset turned, capped", () => {
  const heights = new Uint8Array(65536).fill(10);
  const a = blankTraxxBox(), b = blankTraxxBox();
  a.ipos = [1000, 2000, 12]; b.ipos = [1200, 2000, 12];
  a.heightAboveGround = b.heightAboveGround = 2;
  b.type = TRAXX_BOX_CRUSH; b.crush = [3, 0, 1];
  applyGroupRigid([a, b], { raise: 0, turn: 90, pitch: 0, tilt: 0 }, heights, 500);
  // Centre (550, 1000) ft; a at (500, 1000) -> (550, 1050) ft, ipos (1100, 2100); b -> (550, 950), ipos (1100, 1900).
  assert.deepEqual([a.ipos[0], a.ipos[1]], [1100, 2100]);
  assert.deepEqual([b.ipos[0], b.ipos[1]], [1100, 1900]);
  assert.ok(near(a.psi, PI / 2, 1e-6), `psi ${a.psi}`);
  assert.ok(near(b.crush[0], 0, 1e-6) && near(b.crush[1], -3, 1e-6) && b.crush[2] === 1, `crush ${b.crush}`);
  assert.equal(a.ipos[2], 12);
  assert.equal(a.heightAboveGround, 2);
  applyGroupRigid([a, b], { raise: 5.5, turn: 0, pitch: 0, tilt: 0 }, heights, 500);
  assert.equal(a.ipos[2], 17);
  assert.equal(a.fraction[2], 128);
  assert.equal(a.heightAboveGround, 7);
  applyGroupRigid([a], { raise: 600, turn: 0, pitch: 0, tilt: 0 }, heights, 500);
  assert.equal(a.heightAboveGround, 500, "ObjectHeightCap");
  assert.equal(a.ipos[2], 510);
  assert.equal(a.fraction[2], 0);
  applyGroupRigid([a], { raise: -600, turn: 0, pitch: 0, tilt: 0 }, heights, 500);
  assert.equal(a.ipos[2], -90);
  assert.equal(a.heightAboveGround, -100, "below the ground is allowed");
  const before = structuredClone(a);
  applyGroupRigid([a], { raise: 0, turn: 0, pitch: 0, tilt: 0 }, heights, 500);
  assert.deepEqual(a, before, "nothing to do");
});
