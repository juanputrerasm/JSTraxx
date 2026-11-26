/*
  Traxx 1.8.2's walls (TrackPOD/TrackPODWalls.cpp, CTrackPODWalls), ported from Traxx's own console
  test tools/walltest.cpp: typed straights and arcs, the subdivision into 8 ft pieces, the export
  caps, Problems, the world bounds at 256 and 512 cells, the re-import a pod load makes, and the
  .TXX block (encodeWallsBlock / decodeWallsBlock) with its load rules. The STRAIGHT drag
  template's block (tests/fixtures/drags) decodes and encodes back byte for byte.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TrackWalls, WALL_MAX_EXPORT_POINTS, WALL_MAX_POINTS, WALL_UNIT, WALL_WORLD_FT, WallsBlockError, decodeWallsBlock, encodeWallsBlock,
  exportWall, pointsOutOfWorld, roundInt, type WallExportPoint,
} from "../src/core/traxx/walls.ts";
import { WALL_SIDE_NONE, WALL_SIDE_OUTSIDE, type Wall } from "../src/core/traxx/race-types.ts";

const PI = 3.14159265358979323846;
const ground10 = () => 10.0;
const ground0 = () => 0.0;

function newWall(x: number, z: number, h: number): { g: TrackWalls; w: number } {
  const g = new TrackWalls();
  const w = g.addWall("test");
  g.setStartAndHeading(w, x, z, h);
  return { g, w };
}
const pts = (g: TrackWalls, w: number) => g.walls[w]!.points;
const exp = (g: TrackWalls, w: number, max = WALL_MAX_EXPORT_POINTS) => g.export(w, ground0, max);

test("RoundInt: half away from zero", () => {
  assert.deepEqual([0.5, 1.49, -0.5, -1.5, -0.49, 2.5].map(roundInt), [1, 1, -1, -2, 0, 3]);
  assert.ok(Object.is(roundInt(-0.2), 0));
});

test("AppendStraight", () => {
  const { g, w } = newWall(0, 0, 0);
  assert.equal(g.appendStraight(w, 100.0), 0);
  assert.equal(pts(g, w).length, 2);
  assert.ok(pts(g, w)[1]!.x === 25600 && pts(g, w)[1]!.z === 0 && pts(g, w)[0]!.bend === 0);
  assert.ok(Math.abs(g.endHeadingDeg(w)) < 0.01);
});

test("AppendArc 90: the end point, the end heading and the bend's sign", () => {
  let { g, w } = newWall(0, 0, 0);
  const want = 50.0 * (1.0 - Math.cos(45.0 * PI / 180.0)) * 256.0;
  assert.equal(g.appendArc(w, 50.0, 90.0), 0);
  assert.equal(pts(g, w).length, 2);
  const e = pts(g, w)[1]!;
  assert.ok(Math.abs(e.x - 50 * 256) <= 1 && Math.abs(e.z - 50 * 256) <= 1);
  assert.ok(Math.abs(g.endHeadingDeg(w) - 90.0) < 0.01);
  // A left turn bulges to -z of its chord: the bend is negative.
  assert.ok(Math.abs(pts(g, w)[0]!.bend + Math.floor(want + 0.5)) <= 1);
  assert.ok(pts(g, w)[0]!.bend < 0);

  ({ g, w } = newWall(0, 100, 0));
  assert.equal(g.appendArc(w, 50.0, -90.0), 0);
  const f = pts(g, w)[1]!;
  assert.ok(Math.abs(f.x - 50 * 256) <= 1 && Math.abs(f.z - 50 * 256) <= 1);
  assert.ok(pts(g, w)[0]!.bend > 0);
  assert.ok(Math.abs(g.endHeadingDeg(w) + 90.0) < 0.01);
});

test("AppendArc over 180 is split, and the bends stay within half the chord", () => {
  const { g, w } = newWall(100, 0, 0);
  assert.equal(g.appendArc(w, 40.0, 270.0), 0);
  assert.equal(pts(g, w).length, 3);
  for (let i = 0; i < 2; i++) {
    const dx = pts(g, w)[i + 1]!.x - pts(g, w)[i]!.x, dz = pts(g, w)[i + 1]!.z - pts(g, w)[i]!.z;
    assert.ok(Math.abs(pts(g, w)[i]!.bend) <= Math.floor(Math.sqrt(dx * dx + dz * dz) / 2.0));
  }
  assert.ok(Math.abs(pts(g, w)[2]!.x - 60 * 256) <= 2 && Math.abs(pts(g, w)[2]!.z - 40 * 256) <= 2);
  assert.ok(Math.abs((((g.endHeadingDeg(w) - 270.0 + 540.0) % 360.0) - 180.0)) < 0.05);
});

test("Export: the piece count of a straight, and arcs on their circle", () => {
  let { g, w } = newWall(0, 0, 0);
  g.appendStraight(w, 100.0);
  let e = exp(g, w);
  assert.equal(e.count, 14);
  for (const p of e.points) assert.ok(p.z === 0 && p.x >= 0 && p.x <= 25600 && p.bend === 0);
  assert.ok(e.points[13]!.x === 25600 && e.points[13]!.gap === 0);

  ({ g, w } = newWall(0, 100, 0));
  g.appendArc(w, 50.0, -90.0);
  e = exp(g, w);
  assert.equal(e.count, 11);   // 78.5 ft of arc: 10 pieces and the end
  e.points.forEach((p, i) => {
    const dx = p.x / 256.0, dz = p.z / 256.0 - 50.0;
    assert.ok(Math.abs(Math.sqrt(dx * dx + dz * dz) - 50.0) * 256.0 <= 1.0);
    if (i < e.count - 1) assert.ok(p.bend > 0);
  });
  assert.equal(e.points[e.count - 1]!.bend, 0);

  ({ g, w } = newWall(0, 0, 0));
  g.appendArc(w, 50.0, 90.0);
  e = exp(g, w);
  assert.equal(e.count, 11);
  e.points.forEach((p, i) => {
    const dx = p.x / 256.0, dz = p.z / 256.0 - 50.0;
    assert.ok(Math.abs(Math.sqrt(dx * dx + dz * dz) - 50.0) * 256.0 <= 1.0);
    if (i < e.count - 1) assert.ok(p.bend < 0);
  });
});

test("zero-length straights are refused; the heading walks back past a zero-length stretch; one point keeps it", () => {
  let { g, w } = newWall(0, 0, 0);
  g.appendArc(w, 50.0, 90.0);
  assert.equal(g.appendStraight(w, 0.0), -1);
  assert.equal(g.appendStraight(w, 0.001), -1);
  assert.equal(pts(g, w).length, 2);
  assert.ok(Math.abs(g.endHeadingDeg(w) - 90.0) < 0.01);
  g.insertPoint(w, 1, pts(g, w)[1]!.x, pts(g, w)[1]!.z);
  assert.equal(pts(g, w).length, 3);
  assert.ok(Math.abs(g.endHeadingDeg(w) - 90.0) < 0.01);
  assert.equal(g.appendStraight(w, 10.0), 0);
  assert.ok(Math.abs(pts(g, w)[3]!.x - 50 * 256) <= 2 && Math.abs(pts(g, w)[3]!.z - 60 * 256) <= 2);

  ({ g, w } = newWall(0, 0, 0));
  g.appendStraight(w, 10.0);
  g.deletePoint(w, 1);
  assert.ok(pts(g, w).length === 1 && Math.abs(g.endHeadingDeg(w)) < 0.01);
  ({ g, w } = newWall(0, 0, 90));
  g.appendStraight(w, 10.0);
  g.deletePoint(w, 1);
  assert.ok(Math.abs(g.endHeadingDeg(w) - 90.0) < 0.01);
});

test("a closed wall exports its closing stretch, with no duplicate of point 0", () => {
  const g = new TrackWalls();
  const w = g.addWall("box");
  g.walls[w]!.closed = 1;
  g.insertPoint(w, -1, 0, 0);
  g.insertPoint(w, 0, 16 * 256, 0);
  g.insertPoint(w, 1, 16 * 256, 16 * 256);
  g.insertPoint(w, 2, 0, 16 * 256);
  pts(g, w)[3]!.gap = 1;
  const e = exp(g, w);
  assert.equal(e.count, 8);
  assert.ok(e.points[6]!.gap === 1 && e.points[7]!.gap === 1);
  assert.ok(e.points[6]!.x === 0 && e.points[6]!.z === 16 * 256);
  assert.equal(e.points.filter((p) => p.x === 0 && p.z === 0).length, 1);
});

test("a gap carries over the stretch's pieces; baseY is the ground plus above", () => {
  let { g, w } = newWall(0, 0, 0);
  g.appendStraight(w, 24.0);
  g.appendStraight(w, 24.0);
  g.appendStraight(w, 24.0);
  pts(g, w)[1]!.gap = 1;
  const e = exp(g, w);
  assert.equal(e.count, 10);
  assert.deepEqual(e.points.map((p) => p.gap), [0, 0, 0, 1, 1, 1, 0, 0, 0, 0]);

  ({ g, w } = newWall(0, 0, 0));
  g.appendStraight(w, 16.0);
  pts(g, w)[0]!.above = 12 * 256;
  pts(g, w)[1]!.above = 12 * 256;
  const b = g.export(w, ground10);
  assert.equal(b.count, 3);
  for (const p of b.points) assert.ok(p.baseY === 22 * 256 && p.above === 12 * 256);
});

test("ClampBend, NearPoint, InsertPoint / DeletePoint / DeleteWall and AddWall's defaults", () => {
  let { g, w } = newWall(0, 0, 0);
  g.appendStraight(w, 20.0);
  pts(g, w)[0]!.bend = 100 * 256;
  assert.equal(g.clampBend(w, 0), 1);
  assert.equal(pts(g, w)[0]!.bend, 10 * 256);
  pts(g, w)[0]!.bend = -100 * 256;
  assert.equal(g.clampBend(w, 0), 1);
  assert.equal(pts(g, w)[0]!.bend, -10 * 256);
  pts(g, w)[0]!.bend = 5 * 256;
  assert.equal(g.clampBend(w, 0), 0);
  assert.equal(g.clampBend(w, 1), 0, "the last point of an open wall has no stretch");

  const n = new TrackWalls();
  const a = n.addWall("a");
  n.setStartAndHeading(a, 0, 0, 0);
  n.appendStraight(a, 50.0);
  const b = n.addWall("b");
  n.setStartAndHeading(b, 0, 100, 0);
  n.appendStraight(b, 50.0);
  assert.deepEqual(n.nearPoint(49.0, 3.0, 5.0), { wall: 0, point: 1 });
  assert.deepEqual(n.nearPoint(2.0, 99.0, 5.0), { wall: 1, point: 0 });
  assert.equal(n.nearPoint(25.0, 50.0, 5.0), null);

  ({ g, w } = newWall(0, 0, 0));
  g.appendStraight(w, 10.0);
  pts(g, w)[1]!.above = 777;
  assert.equal(g.insertPoint(w, 0, 1280, 0), 1);
  assert.ok(pts(g, w).length === 3 && pts(g, w)[1]!.x === 1280 && pts(g, w)[1]!.above === 0);
  assert.ok(g.insertPoint(w, 2, 9999, 0) === 3 && pts(g, w)[3]!.above === 777);
  g.deletePoint(w, 1);
  assert.ok(pts(g, w).length === 3 && pts(g, w)[1]!.x === 2560);
  const wl = g.walls[w]!;
  assert.ok(wl.thickness === 256 && wl.height === 20 * 256 && wl.side === WALL_SIDE_NONE);
  g.deleteWall(w);
  assert.equal(g.nwalls, 0);
  assert.equal(new TrackWalls().addWall("x".repeat(40)), 0);
  const long = new TrackWalls();
  long.addWall("x".repeat(40));
  assert.equal(long.walls[0]!.name.length, 31);
  for (let i = 1; i < 64; i++) long.addWall(`w${i}`);
  assert.equal(long.addWall("one too many"), -1);
});

test("the .TXX block: a round trip, and a corrupt block refuses", () => {
  const g = new TrackWalls();
  let w = g.addWall("outer");
  g.walls[w]!.side = WALL_SIDE_OUTSIDE;
  g.walls[w]!.closed = 1;
  g.setStartAndHeading(w, 10, 20, 30);
  g.appendStraight(w, 30.0);
  g.appendArc(w, 25.0, 200.0);
  pts(g, w)[1]!.gap = 1;
  w = g.addWall("second");
  g.walls[w]!.noline = 1;
  g.setStartAndHeading(w, 0, 0, 0);
  g.appendStraight(w, 5.0);
  const block = encodeWallsBlock(g.walls);
  assert.equal(block.length, 8 + 2 * (32 + 24) + (pts(g, 0).length + pts(g, 1).length) * 20);
  const back = decodeWallsBlock(block, 0);
  assert.equal(back.length, block.length);
  assert.deepEqual(back.walls, g.walls);
  // At an offset inside a larger file.
  const framed = new Uint8Array(block.length + 7);
  framed.set(block, 3);
  assert.deepEqual(decodeWallsBlock(framed, 3).walls, g.walls);

  g.walls[0]!.thickness = 0;
  assert.throws(() => decodeWallsBlock(encodeWallsBlock(g.walls), 0), WallsBlockError);
  g.walls[0]!.thickness = 256;
  const cut = encodeWallsBlock(g.walls);
  assert.throws(() => decodeWallsBlock(cut.subarray(0, cut.length - 1), 0), /ends inside/);
  const bad = (edit: (v: DataView) => void) => { const b = encodeWallsBlock(g.walls); edit(new DataView(b.buffer)); return () => decodeWallsBlock(b, 0); };
  assert.throws(bad((v) => v.setInt32(0, 2, true)), WallsBlockError);
  assert.throws(bad((v) => v.setInt32(4, 65, true)), WallsBlockError);
  assert.throws(bad((v) => v.setInt32(4, -1, true)), WallsBlockError);
  assert.throws(bad((v) => v.setInt32(8 + 32, 3, true)), WallsBlockError);       // side
  assert.throws(bad((v) => v.setInt32(8 + 36, 2, true)), WallsBlockError);       // closed
  assert.throws(bad((v) => v.setInt32(8 + 40, -1, true)), WallsBlockError);      // noline
  assert.throws(bad((v) => v.setInt32(8 + 48, 1073741824, true)), WallsBlockError);   // height
  assert.throws(bad((v) => v.setInt32(8 + 56 + 16, 2, true)), WallsBlockError);   // gap of point 1
  assert.throws(bad((v) => v.setInt32(8 + 56, -1073741824, true)), WallsBlockError);   // x of point 1
  assert.doesNotThrow(bad((v) => v.setInt32(8 + 56, -1073741823, true)));
  // name[31] is forced to NUL.
  const named = encodeWallsBlock(g.walls);
  named.fill(65, 8, 8 + 32);
  assert.equal(decodeWallsBlock(named, 0).walls[0]!.name, "A".repeat(31));
});

test("a wall holds 1024 points, and a block claiming 1025 is corrupt", () => {
  const g = new TrackWalls();
  const w = g.addWall("many");
  for (let i = 0; i < WALL_MAX_POINTS; i++) assert.equal(g.insertPoint(w, i - 1, i * 256, 0), i);
  assert.equal(g.insertPoint(w, WALL_MAX_POINTS - 1, 0, 0), -1);
  assert.equal(pts(g, w).length, WALL_MAX_POINTS);
  assert.equal(decodeWallsBlock(encodeWallsBlock(g.walls), 0).walls[0]!.points.length, WALL_MAX_POINTS);

  const b = new Uint8Array(8 + 32 + 24 + (WALL_MAX_POINTS + 1) * 20);
  const v = new DataView(b.buffer);
  v.setInt32(0, 1, true); v.setInt32(4, 1, true);
  v.setInt32(8 + 32 + 12, 256, true); v.setInt32(8 + 32 + 16, 256, true); v.setInt32(8 + 32 + 20, WALL_MAX_POINTS + 1, true);
  assert.throws(() => decodeWallsBlock(b, 0), WallsBlockError);
});

test("Export's caps", () => {
  const { g, w } = newWall(0, 0, 0);
  g.appendStraight(w, 100.0);
  assert.equal(exp(g, w, 13).count, -1);
  assert.equal(exp(g, w, 13).points.length, 13);
  assert.equal(exp(g, w, 14).count, 14);
});

test("Problems, in the preflight's words", () => {
  const { g, w } = newWall(0, 0, 0);
  assert.deepEqual(g.problems(w), ['Wall "test" has 1 point(s); a wall needs at least 2.']);
  g.appendStraight(w, 100.0);
  assert.deepEqual(g.problems(w), []);
  g.walls[w]!.closed = 1;
  assert.deepEqual(g.problems(w), ['Wall "test" is closed with 2 points; a closed wall needs at least 3.']);
  g.walls[w]!.closed = 0;
  g.walls[w]!.thickness = 0;
  g.walls[w]!.height = 0;
  assert.equal(g.problemsText(w), 'Wall "test" has no thickness; it must be greater than 0.\r\nWall "test" has no height; it must be greater than 0.');
  g.walls[w]!.thickness = 256;
  g.walls[w]!.height = 8 * 256;
  pts(g, w)[1]!.x = 9000 * 256;
  assert.deepEqual(g.problems(w), [
    'Wall "test": point 2 is outside the world (0 to 8192 ft).',
    'Wall "test" has a stretch of 9000 ft; the longest allowed is 4096 ft.',
    'Wall "test" needs more than 1024 points once subdivided (the most one wall can have); shorten it or split it.',
  ]);
  pts(g, w)[1]!.x = 100 * 256;
  pts(g, w)[0]!.bend = 80 * 256;
  assert.deepEqual(g.problems(w), [
    'Wall "test" goes outside the world (0 to 8192 ft).',
    'Wall "test" has 1 bend(s) larger than half their stretch; they may be clamped.',
  ]);
  assert.equal(g.clampBend(w, 0), 1);
  assert.deepEqual(g.problems(w), []);
  assert.deepEqual(g.problems(9), []);
});

test("the world's bounds: starts, straights, arcs restored whole, inserts", () => {
  let g = new TrackWalls();
  let w = g.addWall("b");
  assert.ok(g.setStartAndHeading(w, -1.0, 10.0, 0) === -1 && pts(g, w).length === 0);
  assert.ok(g.setStartAndHeading(w, 8193.0, 10.0, 0) === -1 && pts(g, w).length === 0);
  assert.ok(g.setStartAndHeading(w, 8192.0, 0.0, 0) === 0 && pts(g, w).length === 1);
  assert.ok(g.appendStraight(w, 10.0) === -1 && pts(g, w).length === 1);
  assert.equal(g.appendStraight(w, 1e12), -1);

  ({ g, w } = newWall(10, 10, 180));
  pts(g, w)[0]!.gap = 1;
  const before = { ...pts(g, w)[0]! };
  assert.ok(g.appendArc(w, 50.0, 90.0) === -1 && pts(g, w).length === 1);
  assert.deepEqual(pts(g, w)[0], before);
  assert.ok(Math.abs(g.endHeadingDeg(w) - 180.0) < 0.01);
  ({ g, w } = newWall(10, 100, 0));
  pts(g, w)[0]!.gap = 1;
  assert.ok(g.appendArc(w, 20.0, 270.0) === -1 && pts(g, w).length === 1 && pts(g, w)[0]!.gap === 1 && pts(g, w)[0]!.bend === 0);
  ({ g, w } = newWall(100, 100, 0));
  assert.ok(g.appendArc(w, 20.0, -360.0) === 0 && pts(g, w).length === 3);

  ({ g, w } = newWall(0, 0, 0));
  let n = 0;
  for (let i = 0; i < 100; i++) if (g.appendStraight(w, 1000.0) === 0) n++;
  assert.ok(n === 8 && pts(g, w).length === 9);
  assert.equal(g.insertPoint(w, 0, -256, 0), -1);
  assert.equal(g.insertPoint(w, 0, 0, 8193 * 256), -1);
  assert.equal(g.insertPoint(w, 0, 100, 100), 1);

  ({ g, w } = newWall(0, 0, 0));
  g.appendStraight(w, 100.0);
  pts(g, w)[1]!.x = 9000 * 256;
  assert.ok(g.problems(w).some((p) => p.includes("point 2 is outside the world")));
});

function noDuplicates(e: readonly WallExportPoint[], n: number, closed: boolean): boolean {
  for (let i = 0; i + 1 < n; i++) if (e[i]!.x === e[i + 1]!.x && e[i]!.z === e[i + 1]!.z) return false;
  return !(closed && n > 1 && e[n - 1]!.x === e[0]!.x && e[n - 1]!.z === e[0]!.z);
}

test("zero-length stretches export as nothing", () => {
  let { g, w } = newWall(100.0, 100.0, 0.0);
  assert.equal(g.appendStraight(w, 300.0), 0);
  assert.equal(g.appendArc(w, 60.0, 180.0), 0);
  assert.equal(g.appendStraight(w, 300.0), 0);
  assert.equal(g.appendArc(w, 60.0, 180.0), 0);
  assert.equal(pts(g, w).length, 5);
  g.walls[w]!.closed = 1;
  let out = exp(g, w);
  assert.ok(out.count > 4 && noDuplicates(out.points, out.count, true));
  assert.ok(Math.abs(pts(g, w)[4]!.x - pts(g, w)[0]!.x) <= 1 && Math.abs(pts(g, w)[4]!.z - pts(g, w)[0]!.z) <= 1);
  pts(g, w)[4]!.x = pts(g, w)[0]!.x;
  pts(g, w)[4]!.z = pts(g, w)[0]!.z;
  out = exp(g, w);
  assert.ok(noDuplicates(out.points, out.count, true));
  g.deletePoint(w, 4);
  assert.equal(pts(g, w).length, 4);
  const ref = exp(g, w);
  assert.equal(ref.count, out.count);
  assert.deepEqual(ref.points.map((p) => [p.x, p.z]), out.points.map((p) => [p.x, p.z]));

  ({ g, w } = newWall(10.0, 10.0, 0.0));
  g.appendStraight(w, 40.0);
  g.appendStraight(w, 40.0);
  const r0 = exp(g, w);
  g.insertPoint(w, 1, pts(g, w)[1]!.x, pts(g, w)[1]!.z);
  assert.equal(pts(g, w).length, 4);
  out = exp(g, w);
  assert.ok(out.count === r0.count && r0.count > 2 && noDuplicates(out.points, out.count, false));
  assert.deepEqual(out.points.map((p) => [p.x, p.z]), r0.points.map((p) => [p.x, p.z]));
  pts(g, w)[1]!.bend = 100;
  out = exp(g, w);
  assert.ok(out.count === r0.count && noDuplicates(out.points, out.count, false));
  g.deletePoint(w, 1);
  g.insertPoint(w, 1, pts(g, w)[2]!.x, pts(g, w)[2]!.z);
  out = exp(g, w);
  assert.ok(out.count === r0.count && noDuplicates(out.points, out.count, false));

  g = new TrackWalls();
  w = g.addWall("sq");
  g.walls[w]!.closed = 1;
  for (const [i, x, z] of [[-1, 0, 0], [0, 16, 0], [1, 16, 0], [2, 16, 16], [3, 0, 16]] as const) g.insertPoint(w, i, x * 256, z * 256);
  out = exp(g, w);
  assert.ok(out.count === 8 && noDuplicates(out.points, out.count, true));

  g = new TrackWalls();
  w = g.addWall("dot");
  for (const i of [-1, 0, 1]) g.insertPoint(w, i, 256, 256);
  assert.equal(exp(g, w).count, 0);
  g.walls[w]!.closed = 1;
  assert.equal(exp(g, w).count, 0);
});

/** Rebuild a wall from an export the way ApplyRaceRulesCpx does. */
function reimport(dst: TrackWalls, src: Wall, e: readonly WallExportPoint[], n: number): void {
  const wi = dst.addWall(src.name);
  const wl = dst.walls[wi]!;
  Object.assign(wl, { side: src.side, closed: src.closed, noline: src.noline, thickness: src.thickness, height: src.height });
  wl.points = e.slice(0, Math.min(n, WALL_MAX_POINTS)).map((p) => ({ x: p.x, z: p.z, bend: p.bend, above: p.above, gap: p.gap ? 1 : 0 }));
}

test("a wall read back from a pod exports to the same pieces (the 1/64 ft slack)", () => {
  const g = new TrackWalls(), g2 = new TrackWalls();
  let w = g.addWall("open");
  g.setStartAndHeading(w, 500.3, 700.7, 17.0);
  g.appendStraight(w, 200.0);
  g.appendArc(w, 60.0, 100.0);
  g.appendStraight(w, 33.3);
  g.appendArc(w, 40.0, -200.0);
  pts(g, w)[1]!.gap = 1;
  pts(g, w)[0]!.above = 256 * 3;
  pts(g, w)[2]!.above = 256 * 5 + 77;
  w = g.addWall("closed");
  g.walls[w]!.closed = 1;
  g.insertPoint(w, -1, 1000 * 256, 1000 * 256);
  g.insertPoint(w, 0, 1141 * 256 + 100, 1141 * 256 + 37);
  g.insertPoint(w, 1, 1000 * 256 + 91, 1283 * 256 + 5);
  g.insertPoint(w, 2, 858 * 256 + 12, 1141 * 256 + 200);
  pts(g, w)[1]!.bend = 3000;
  pts(g, w)[3]!.gap = 1;

  const nw = g.nwalls;
  for (let k = 0; k < nw; k++) {
    const a = exp(g, k);
    assert.ok(a.count > 20);
    reimport(g2, g.walls[k]!, a.points, a.count);
    assert.equal(g2.walls[k]!.points.length, a.count);
    const b = exp(g2, k);
    assert.equal(b.count, a.count);
    a.points.forEach((p, i) => {
      const q = b.points[i]!;
      assert.ok(Math.abs(p.x - q.x) <= 1 && Math.abs(p.z - q.z) <= 1 && Math.abs(p.above - q.above) <= 1 && p.gap === q.gap);
    });
    reimport(g, g.walls[k]!, b.points, b.count);
    assert.equal(exp(g, g.nwalls - 1).count, a.count);
  }
});

test("the world range at export: an arc's bulge, the edges, AppendArc's sub-arc points", () => {
  let g = new TrackWalls();
  let w = g.addWall("bulge");
  g.insertPoint(w, -1, 8180 * 256, 4000 * 256);
  g.insertPoint(w, 0, 8180 * 256, 4100 * 256);
  assert.equal(g.exportOutOfWorld(w), false);
  assert.deepEqual(g.problems(w), []);
  pts(g, w)[0]!.bend = -12800;   // a semicircle bulging to +x, to x = 8230
  assert.equal(g.exportOutOfWorld(w), true);
  assert.deepEqual(g.problems(w), ['Wall "bulge" goes outside the world (0 to 8192 ft).']);
  let e = exp(g, w);
  assert.ok(e.count > 2 && pointsOutOfWorld(e.points, e.count, WALL_WORLD_FT));
  pts(g, w)[0]!.bend = 12800;
  e = exp(g, w);
  assert.ok(!g.exportOutOfWorld(w) && !pointsOutOfWorld(e.points, e.count, WALL_WORLD_FT));

  const one = (x: number, z: number): WallExportPoint[] => [{ x, z, baseY: 0, bend: 0, above: 0, gap: 0 }];
  assert.equal(pointsOutOfWorld(one(0, 8192 * 256), 1, WALL_WORLD_FT), false);
  assert.equal(pointsOutOfWorld(one(8192 * 256 + 1, 8192 * 256), 1, WALL_WORLD_FT), true);
  assert.equal(pointsOutOfWorld(one(0, -1), 1, WALL_WORLD_FT), true);
  assert.ok(!g.exportOutOfWorld(5) && !g.exportOutOfWorld(-1));

  ({ g, w } = newWall(8190.0, 4000.0, 30.0));
  assert.ok(g.appendArc(w, 100.0, 120.0) === -1 && pts(g, w).length === 1);
  ({ g, w } = newWall(8100.0, 4000.0, 30.0));
  assert.ok(g.appendArc(w, 100.0, 120.0) === 0 && pts(g, w).length === 2);
  assert.equal(g.exportOutOfWorld(w), false);
});

test("the world is 256 or 512 cells: N * 32 ft, walls kept across a change", () => {
  const g3 = new TrackWalls();
  assert.ok(g3.cellsCount() === 256 && g3.worldFt() === 8192);
  assert.ok(!g3.setWorldCells(128) && !g3.setWorldCells(1024) && g3.cellsCount() === 256);
  const w = g3.addWall("far");
  assert.ok(g3.setStartAndHeading(w, 16000.0, 100.0, 90) === -1 && pts(g3, w).length === 0);
  assert.equal(g3.insertPoint(w, -1, 16000 * WALL_UNIT, 100 * WALL_UNIT), -1);
  assert.ok(g3.setWorldCells(512) && g3.cellsCount() === 512 && g3.worldFt() === 16384);
  assert.ok(g3.setStartAndHeading(w, 16000.0, 16000.0, 90) === 0 && pts(g3, w).length === 1);
  assert.equal(g3.appendStraight(w, 300.0), 0);
  assert.equal(g3.appendStraight(w, 100.0), -1);   // 16400 > 16384
  assert.equal(g3.exportOutOfWorld(w), false);
  assert.deepEqual(g3.problems(w), []);

  const e = (x: number): WallExportPoint[] => [{ x, z: 0, baseY: 0, bend: 0, above: 0, gap: 0 }];
  assert.equal(pointsOutOfWorld(e(16000 * WALL_UNIT), 1, WALL_WORLD_FT), true);
  assert.equal(pointsOutOfWorld(e(16000 * WALL_UNIT), 1, 512 * 32), false);
  assert.equal(pointsOutOfWorld(e(16384 * WALL_UNIT), 1, 512 * 32), false);
  assert.equal(pointsOutOfWorld(e(16384 * WALL_UNIT + 1), 1, 512 * 32), true);

  assert.ok(g3.setWorldCells(256) && g3.nwalls === 1 && g3.exportOutOfWorld(w));
  g3.setWorldCells(512);
  const g2 = new TrackWalls();
  g2.copyFrom(g3);
  assert.equal(g2.cellsCount(), 512);
  assert.deepEqual(g2.walls, g3.walls);
  assert.notEqual(g2.walls[0], g3.walls[0], "a deep copy");
  g2.clear();
  assert.ok(g2.cellsCount() === 512 && g2.nwalls === 0 && g3.nwalls === 1);
});

test("the STRAIGHT drag template's .TXX wall block decodes and encodes back byte for byte", () => {
  const tail = new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "drags", "STRAIGHTDRAG.TXXTAIL")));
  const { walls, length } = decodeWallsBlock(tail, 12);   // after the V21 block (1, race_rules, race_laps)
  assert.equal(length, 392);   // 8 + 4 * (32 + 24) + 8 points * 20
  assert.deepEqual(walls.map((w) => [w.name, w.side, w.points.length]), [["Wall 1", 2, 2], ["Wall 2", 1, 2], ["Wall 3", 1, 2], ["Wall 4", 2, 2]]);
  assert.deepEqual(walls[0]!.points.map((p) => [p.x, p.z]), [[0x102400, 0x0fe100], [0x102400, 0x116080]]);
  assert.deepEqual(encodeWallsBlock(walls), tail.subarray(12, 12 + length));
  // 383.5 ft: 48 pieces and the end point.
  assert.equal(exportWall(walls[0]!).count, 49);
});
