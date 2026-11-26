/*
  Traxx 1.8.2's outline pick (core/view/object-pick-hull.ts), with every check of Traxx's
  tools/objectpicktest.cpp.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { pickChooseWinner, pickFaceDepth, pickHull, pickPointInHull, pickResolve, type PickCandidate, type PickPt } from "../src/core/view/object-pick-hull.ts";

/** A 100 x 60 x 40 box turned by `deg` about the vertical, seen from above-front: x across, y down, bottom ring then top. */
function rotatedBox(deg: number): PickPt[] {
  const a = (deg * 3.14159265358979) / 180, c = Math.cos(a), s = Math.sin(a);
  const cx = [-50, 50, 50, -50], cy = [-30, -30, 30, 30];
  return Array.from({ length: 8 }, (_, i) => {
    const x = cx[i & 3]!, y = cy[i & 3]!;
    const rx = x * c - y * s, ry = x * s + y * c;
    return { x: Math.floor(500 + rx + 0.5), y: Math.floor(500 + ry * 0.5 + 0.5) - (i < 4 ? 0 : 40) };
  });
}
const cand = (hit: boolean, depth: number, isFog: boolean): PickCandidate => ({ hit, depth, isFog });

test("objectpicktest: hulls", () => {
  let pts = rotatedBox(0);
  let hull = pickHull(pts, 8);
  assert.equal(hull.length, 4, "axis-aligned box hull has 4 corners");
  assert.ok(pickPointInHull(hull, 500, 480), "centre inside");
  assert.ok(!pickPointInHull(hull, 440, 480), "outside left");
  assert.ok(!pickPointInHull(hull, 500, 400), "outside above");
  assert.ok(pickPointInHull(hull, 450, 490), "on the left edge");
  assert.ok(pickPointInHull(hull, pts[0]!.x, pts[0]!.y), "on a corner");
  assert.ok(!pickPointInHull(hull, 449, 490), "one pixel past the edge");

  pts = rotatedBox(30);
  hull = pickHull(pts, 8);
  assert.ok(hull.length >= 4 && hull.length <= 8, "rotated box hull has 4..8 points");
  assert.ok(pts.every((p) => pickPointInHull(hull, p.x, p.y)), "every corner is inside its own hull");
  assert.ok(!pickPointInHull(hull, 700, 500), "far point outside");
  assert.ok(pickPointInHull(hull, 500, 490), "middle inside");
  const n = hull.length;
  const turn = (i: number) => {
    const a = hull[i]!, b = hull[(i + 1) % n]!, c = hull[(i + 2) % n]!;
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  };
  let convex = true;
  for (let i = 0; i < n; i++) {
    if (turn(i) === 0) convex = false;
    if (i && (turn(i) > 0) !== (turn(0) > 0)) convex = false;
  }
  assert.ok(convex, "hull turns one way, no collinear vertices");

  const dup = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  hull = pickHull(dup, 8);
  assert.equal(hull.length, 4, "duplicate points: hull of 4");
  assert.ok(pickPointInHull(hull, 5, 5), "inside");

  const line = [[0, 0], [10, 10], [20, 20], [30, 30], [5, 5], [15, 15], [25, 25], [40, 40]].map(([x, y]) => ({ x: x!, y: y! }));
  hull = pickHull(line, 8);
  assert.ok(hull.length < 3, "collinear input: no area");
  assert.ok(!pickPointInHull(hull, 20, 20), "point on the line is not a hit");
  assert.ok(!pickPointInHull(hull, 20, 21), "point off the line is not a hit");
  hull = pickHull(line, 1);
  assert.ok(hull.length < 3, "single point: no area");
  assert.ok(!pickPointInHull(hull, 0, 0), "not a hit");
  hull = pickHull(line, 0);
  assert.ok(hull.length < 3 && !pickPointInHull(hull, 0, 0), "no points: no area, no crash");
  assert.ok(!pickPointInHull(null, 0, 0), "null hull is no hit");
});

test("objectpicktest: choosing the winner", () => {
  assert.equal(pickChooseWinner([cand(true, 500, false), cand(true, 200, false), cand(true, 900, false)]), 1, "front-most wins");
  assert.equal(pickChooseWinner([cand(true, 100, true), cand(true, 800, false), cand(false, 50, false)]), 1, "fog loses to a farther non-fog hit; a miss never wins");
  assert.equal(pickChooseWinner([cand(true, 300, true), cand(false, 10, false), cand(true, 100, true)]), 2, "fog wins when nothing solid is hit");
  const none = [cand(false, 10, false), cand(false, 20, true)];
  assert.equal(pickChooseWinner(none), -1, "no hit -> -1");
  assert.equal(pickChooseWinner(none, 0), -1, "empty list -> -1");
  assert.equal(pickChooseWinner([cand(true, 100, false), cand(true, 100, false)]), 0, "equal depth: the lower index keeps it");
});

test("objectpicktest: the depth at the click, not the nearest corner's", () => {
  const plat: PickPt[] = [], small: PickPt[] = [], pd: number[] = [], sd: number[] = [];
  const rx = [0, 400, 400, 0], ry = [0, 0, 300, 300], rz = [100, 100, 900, 900];
  const sx = [180, 220, 220, 180], sy = [120, 120, 160, 160];
  for (let i = 0; i < 4; i++) {
    plat[i] = { x: rx[i]!, y: ry[i]! }; pd[i] = rz[i]!;
    plat[i + 4] = { x: rx[i]!, y: ry[i]! - 20 }; pd[i + 4] = rz[i]!;
    small[i] = { x: sx[i]!, y: sy[i]! }; sd[i] = 150;
    small[i + 4] = { x: sx[i]!, y: sy[i]! - 30 }; sd[i + 4] = 150;
  }
  const hitp = pickPointInHull(pickHull(plat), 200, 140), hits = pickPointInHull(pickHull(small), 200, 140);
  const dp = pickFaceDepth(plat, pd, 200, 140), ds = pickFaceDepth(small, sd, 200, 140);
  assert.ok(hitp && hits, "both hulls hold the click");
  assert.ok(dp > 100, "platform face depth under the click is farther than its nearest corner");
  assert.equal(ds, 150, "small box's face depth is 150");
  assert.equal(pickChooseWinner([cand(hitp, dp, false), cand(hits, ds, false)]), 1, "the small box on the platform wins");

  const x = [0, 100, 100, 0, 10, 90, 90, 10], y = [0, 0, 100, 100, 10, 10, 90, 90], z = [500, 500, 500, 500, 400, 400, 400, 400];
  const p = x.map((v, i) => ({ x: v, y: y[i]! }));
  assert.equal(pickFaceDepth(p, z, 50, 50), 400, "face-on: depth at the click is the top face's");
  assert.equal(pickFaceDepth(p, z, 30, 30), 400, "on the top face's diagonal");
  assert.equal(pickFaceDepth(p, z, 50, 10), 400, "on the edge shared by the top and a side");
  assert.equal(pickFaceDepth(p, z, 0, 0), 500, "on an outer corner");
  const d = pickFaceDepth(p, z, 50, 5);
  assert.ok(d > 400 && d < 500, "on the side slope: between the two");

  const q = Array.from({ length: 8 }, (_, i) => ({ x: i * 10, y: i * 10 }));
  assert.equal(pickFaceDepth(q, [90, 80, 70, 60, 50, 40, 30, 20], 20, 20), 20, "degenerate: nearest corner depth");
});

test("objectpicktest: a fog hit does not block the nearest-base rule", () => {
  assert.equal(pickResolve(3, false, 7), 3, "solid hit stands over a base hit");
  assert.equal(pickResolve(3, true, 7), 7, "fog hit gives way to a base-point object");
  assert.equal(pickResolve(3, true, -1), 3, "fog hit stands when no base point is near");
  assert.equal(pickResolve(-1, false, 7), 7, "no outline hit: the base rule's answer");
  assert.equal(pickResolve(-1, false, -1), -1, "nothing at all");
});

test("SelectObjectByOutline's pieces: the local corners, a model's bounds, a candidate", async () => {
  const { pickLocalCorners, pickModelBounds, pickCandidateOf } = await import("../src/core/view/object-pick-hull.ts");
  const c = pickLocalCorners([-1, -2, -3], [1, 2, 3]);
  assert.deepEqual(c, [[-1, -2, -3], [-1, 2, -3], [1, 2, -3], [1, -2, -3], [-1, -2, 3], [-1, 2, 3], [1, 2, 3], [1, -2, 3]]);
  assert.deepEqual(pickModelBounds([0, 5, 1, -2, 3, 4, 7, -1, 0]), { lo: [-2, -1, 0], hi: [7, 5, 4] });
  assert.equal(pickModelBounds([]), null);
  const box = rotatedBox(0).map((p, i) => ({ ...p, depth: i < 4 ? 500 : 400 }));
  assert.deepEqual(pickCandidateOf(box, 500, 480, false), { hit: true, depth: pickFaceDepth(box, box.map((b) => b.depth), 500, 480), isFog: false });
  assert.equal(pickCandidateOf(box, 700, 480, true)!.hit, false);
  assert.equal(pickCandidateOf(box.map((b, i) => (i === 3 ? { ...b, depth: 10 } : b)), 500, 480, false), null, "a corner at depth 10");
  assert.equal(pickCandidateOf(box.map((b, i) => (i === 3 ? null : b)), 500, 480, false), null, "a corner that did not project");
});
