/*
  Traxx 1.7.2 / 1.7.3's waterfalls (TrackPOD/TrackPODFalls.cpp at 4364111), ported from Traxx's own
  console test tools/wfltest.cpp: the slab thickness and the back face (TestSlabThickCaps, TestSlab,
  with the engine harness' vertex counts), the final-audit parity fixes (TestParityFixes), one mist
  box per stream (TestMist, TestMistStreams, TestMistRidge, TestMistLanding, TestLandRule, with the
  engine's landing numbers), Rough water / Rough from (TestWFLRoughFrom and the TXX block 3), the
  lakes' EDGE rule on the falls' side (TestNotchEdge) and the dry fall's final run-out trim.

  Every check runs in the retail 256-cell world; the 512-cell checks at the end run the same rules
  in a version 6 world.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFallShape, buildNotchEdges, buildNotches, buildWfl, emptyFallShape, fallBudget, fallClassicHeightRaw, fallDefaults, fallErrorText,
  fallErrors, fallNameInPod, fallNotchWarnings, fallNotchWarnText, fallNudgeDistance, fallReverse, fallSlabThick, fallWarnText, landContinuous,
  fitFall, mistVolumes, parseWflFalls, snapToLip, walkColumn, FALL_IDX_UNLIMITED,
  FALLEND_GROUND, FALLEND_LIMIT, FALLEND_WATER, FALLERR_DIRECTION, FALLERR_LIP_LOW, FALLERR_NOTCH, FALLERR_NOTCH_SHARED, FALLERR_POINTS,
  FALLERR_ROUGH, FALLWARN_COARSE, FALLWARN_DROPPED, FALLWARN_DRY, FALLWARN_LIP_HIGH, FALLWARN_LIP_UNCOVERED, FALLWARN_NOTCH_FLAT,
  FALLWARN_SHORTENED, FALL_VERTS_PER_FALL,
  type FallColumn, type FallGround, type FallLakes, type FallShape, type TraxxFall,
} from "../src/core/traxx/falls.ts";
import { lakeNotches, recomputeLakes, lakeHoldsUpTo, lakeAt, LAKE_DIR_W, LAKE_RULE_EDGE, LAKE_RULE_TILE, type LakeNotchEdge } from "../src/core/traxx/lakes.ts";
import type { LakeGround } from "../src/core/traxx/surface.ts";
import { readTxx, writeTxx } from "../src/core/traxx/txx.ts";
import { resetTrack } from "../src/core/doc/new-track.ts";
import { applyFallRoughText, fallRoughText, stepFallRough, toggleFallRough } from "../src/core/edit/fall-properties.ts";

/* assert.ok without the narrowing (the checks re-read fields the code under test changes). */
const ok: (value: unknown, message?: string) => void = assert.ok;
const near = (a: number, b: number, tol: number, what = "") => ok(Math.abs(a - b) <= tol, `${what} ${a} != ${b} (+-${tol})`);

function crest2(x0: number, z0: number, x1: number, z1: number): TraxxFall {
  const w = fallDefaults();
  w.npoints = 2;
  w.pt[0] = [Math.trunc(x0 * 16), Math.trunc(z0 * 16)];
  w.pt[1] = [Math.trunc(x1 * 16), Math.trunc(z1 * 16)];
  w.height = 200;
  return w;
}

// ---- The slab (handover 4.6) ----

test("the slab thickness rule and its caps (TestSlabThickCaps)", () => {
  near(fallSlabThick(6.0, 6.0, 0.0, 0.0, 4, 9, 50.0, 100.0), 1.125, 1e-12);
  near(fallSlabThick(6.0, 6.0, 1.0, 25.0, 4, 9, 50.0, 100.0), 2.25, 1e-12);
  near(fallSlabThick(20.0, 20.0, 0.0, 0.0, 4, 9, 50.0, 100.0), 2.0, 1e-12); // h0 capped at 2 ft
  near(fallSlabThick(20.0, 10.0, 0.0, 0.0, 4, 9, 50.0, 100.0), 2.5, 1e-12); // draped never past 2.5 ft
  near(fallSlabThick(20.0, 20.0, 1.0, 25.0, 4, 9, 50.0, 100.0), 4.0, 1e-12);
  near(fallSlabThick(20.0, 20.0, 1.0, 200.0, 4, 9, 50.0, 100.0), 8.0, 1e-12);
  near(fallSlabThick(1.0, 1.0, 0.0, 0.0, 4, 9, 50.0, 100.0), 0.5, 1e-12); // the drape floor still wins
  near(fallSlabThick(8.0, 8.0, 0.0, 0.0, 4, 9, 50.0, 100.0), 2.0, 1e-12);
  near(fallSlabThick(20.0, 20.0, 1.0, 25.0, 0, 2, 50.0, 100.0), 0.0, 1e-12); // two columns: a flat sheet
});

/* SlabCliff: corners `top` (1/64 ft) to tile column `edge`, `base` beyond, under a body-0 plane at `plane` ft. */
function slabCliff(top: number, base: number, edge: number, plane: number): FallGround {
  const corner = (tx: number, _tz: number) => ((tx & 255) <= edge ? top : base);
  return { height: (x, z) => fallClassicHeightRaw(corner, x, z), water: () => Math.fround(plane) };
}
function slabFall(x: number, z0: number, z1: number): TraxxFall {
  const w = fallDefaults();
  w.npoints = 2; w.speed = 96;
  w.pt[0] = [Math.floor(x * 16 + 0.5), Math.floor(z0 * 16 + 0.5)];
  w.pt[1] = [Math.floor(x * 16 + 0.5), Math.floor(z1 * 16 + 0.5)];
  return w;
}
/* HandShape: `width` ft of crest, every column `pathlen` ft of path, no air flags (no back face). */
function handShape(width: number, pathlen: number, endk = FALLEND_GROUND): FallShape {
  const s = emptyFallShape();
  s.width = width;
  [2, 3, 4, 6, 8].forEach((sp, j) => {
    const n = Math.max(1, Math.ceil(width / sp - 1e-9)) + 1;
    s.stat[j] = { ncols: n, rows: new Int32Array(n).fill(Math.ceil(pathlen / sp - 1e-9) + 1), endk: new Uint8Array(n).fill(endk) };
  });
  s.ncols = s.stat[0]!.ncols;
  return s;
}

test("the slab: the back face in the counts, the front face pushed out, the 32768 cap (TestSlab, the engine harness' numbers)", () => {
  // a 2 ft crest over the cliff: two columns, a flat sheet: 62 vertices (sheet 56 + foam 6), no back face, front = path
  let g = slabCliff(100 * 64, 40 * 64, 124, 42.0);
  let s = buildFallShape(slabFall(4000, 4000, 4002), 200, g);
  ok(s.ncols === 2 && s.vertices === 62 && s.back === 0, `${s.ncols} ${s.vertices} ${s.back}`);
  for (const c of s.col) {
    ok(c.front);
    for (let i = 0; i < 3 * c.n; i++) assert.equal(c.front![i], c.p[i]);
  }
  assert.equal(fallBudget([s]), 62);
  ok(s.vertices === 62 && s.back === 0);
  // a 16 ft curtain: 9 columns; the push is 0 at the outer columns and the crest row, downstream in the middle
  s = buildFallShape(slabFall(4000, 4000, 4016), 200, g);
  ok(s.ncols === 9 && s.back > 0 && s.vertices > s.back);
  let worst = 0, mid = 0;
  s.col.forEach((col, c) => {
    ok(col.front && col.n >= 3);
    for (let r = 0; r < col.n; r++) {
      const dx = col.front![3 * r]! - col.p[3 * r]!, dy = col.front![3 * r + 1]! - col.p[3 * r + 1]!, dz = col.front![3 * r + 2]! - col.p[3 * r + 2]!;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > worst) worst = d;
      if (c === 0 || c === s.ncols - 1 || r === 0) assert.equal(d, 0);
      if (c === 4 && r === Math.trunc(col.n / 2)) { mid = d; ok(dx > 0); }
    }
  });
  ok(worst <= 8.0 + 1e-3 && mid > 0.5, `${worst} ${mid}`);
  // the budget with the back face: a 1024 ft crest over a 200 ft cliff into a 2 ft plane, 23901 vertices at 4 ft
  g = slabCliff(200 * 64, 0, 124, 2.0);
  s = buildFallShape(slabFall(4000, 3000, 4024), 400, g);
  let total = fallBudget([s]);
  ok(s.vertices === 23901 && s.spacing === 4 && total === 23901, `${s.vertices} at ${s.spacing}`);
  ok((s.warn & FALLWARN_COARSE) !== 0 && (s.warn & (FALLWARN_SHORTENED | FALLWARN_DROPPED)) === 0 && s.back > 0);
  // with 3000 left on the track: 2838 at 8 ft, shortened
  const set = Array.from({ length: 19 }, () => handShape(1024, 50));
  const h = handShape(10, 20);
  h.stat[0]!.rows[0]! += 5722 - 66;
  set.push(h, s);
  total = fallBudget(set);
  ok(set[19]!.vertices === 5722 && set[19]!.spacing === 2);
  ok(set[20]!.vertices === 2838 && set[20]!.spacing === 8 && (set[20]!.warn & FALLWARN_SHORTENED) !== 0, `${set[20]!.vertices} at ${set[20]!.spacing}`);
  assert.equal(set[20]!.warn & FALLWARN_DROPPED, 0);
  assert.equal(total, 19 * 513 * 26 + 5722 + 2838);
  assert.equal(FALL_VERTS_PER_FALL, 32768);
});

// ---- The final audit (734e980) ----

/* Lake 1 on tiles 10..19 x 10..19 (MakeLake), and a fall along its east rim (LakeFall). */
function makeLake(): FallLakes & { tmap: Uint8Array } {
  const tmap = new Uint8Array(65536);
  for (let z = 10; z < 20; z++) for (let x = 10; x < 20; x++) tmap[x + (z << 8)] = 1;
  return { lakes: [{ height: 100 }], tmap };
}
function lakeFall(): TraxxFall {
  const w = crest2(640, 400, 640, 480);
  w.source = 1;
  w.height = 7;
  return w;
}

test("the final audit's parity fixes: the nudge, the flags mask, no budget for a fall in error, a dropped fall is not DRY (TestParityFixes)", () => {
  near(fallNudgeDistance(10.0), 0.5, 1e-12);
  near(fallNudgeDistance(1.0), 0.5, 1e-12);
  near(fallNudgeDistance(0.6), 0.3, 1e-12);
  near(fallNudgeDistance(0.2), 0.1, 1e-12);
  const L = makeLake();
  const w = lakeFall();
  w.flags = 0xfff8 | 4;
  let buf = buildWfl([w], L)!;
  ok(buf.length >= 56 + 128);
  assert.equal(buf[56 + 4]! | (buf[56 + 5]! << 8), 4);
  w.flags = 0xffff;
  buf = buildWfl([w], L)!;
  assert.equal(buf[56 + 4]! | (buf[56 + 5]! << 8), 7);
  // nobudget: the count kept, no room taken, no shape warnings
  const s = [handShape(1024, 50), handShape(1024, 50), handShape(1024, 50)];
  s[0]!.vertices = 777;
  s[0]!.nobudget = true;
  s[0]!.warn = FALLWARN_DRY | FALLWARN_COARSE | FALLWARN_SHORTENED | FALLWARN_DROPPED;
  s[2]!.nobudget = true;
  const total = fallBudget(s);
  ok(s[0]!.warn === 0 && s[0]!.vertices === 777);
  ok(s[1]!.vertices === 513 * 26 && total === 513 * 26);
  assert.equal(s[2]!.warn, 0);
  const many = Array.from({ length: 23 }, () => handShape(1024, 50));
  many[22]!.warn |= FALLWARN_DRY;
  fallBudget(many);
  ok((many[22]!.warn & FALLWARN_DROPPED) !== 0 && (many[22]!.warn & FALLWARN_DRY) === 0);
  // the name check: model textures count, the stem may carry an extension
  const names = fallNameInPod([], [{ name: "ART\\ROCK.RAW" }], [{ name: "MODELS\\EWTF000.RAW" }]);
  ok(names(1, "EWTF000") && names(1, "ewtf000.raw") && names(1, "ROCK.TGA") && !names(1, "WATER") && !names(1, ".RAW"));
  assert.equal(fallWarnText(FALLWARN_DRY), "The water lands on dry ground: no foam strip or landing rings (mist and droplets still appear)");
});

// ---- One mist box per stream ----

/* The hand world (HandWorld): flat 0 ft under a 10 ft water plane; a raised rectangle; a wall where x mod 40 is in 10..30. */
interface HandWorld { water: number; bx0: number; bx1: number; bz0: number; bz1: number; bh: number; wall: number }
const handWorld = (): HandWorld => ({ water: 10.0, bx0: 0, bx1: 0, bz0: 0, bz1: 0, bh: 0, wall: 0 });
function handGround(h: HandWorld): FallGround {
  return {
    height: (x, z) => {
      let v = 0;
      const m = ((x % 40.0) + 40.0) % 40.0 === x % 40.0 ? x % 40.0 : x % 40.0; // fmod keeps the sign, as C
      if (x >= h.bx0 && x < h.bx1 && z >= h.bz0 && z < h.bz1) v = h.bh;
      if (h.wall > 0 && m >= 10.0 && m < 30.0 && h.wall > v) v = h.wall;
      return Math.fround(v);
    },
    water: () => (h.water < 0 ? null : Math.fround(h.water)),
  };
}
const handMist = (w: TraxxFall, height: number, s: FallShape, h: HandWorld) => mistVolumes(w, height, s, handGround(h));

/* MistShape5: five 2-row columns; 0, 1, 2 and 4 end in water, 3 on ground; the row before is (sx, sz) back and 10 ft higher. */
function mistShape5(sx: number, sz: number): FallShape {
  const lx = [100, 102, 104, 106, 108], ly = [60, 60, 50, 30, 40], lz = [200, 201, 202, 203, 204];
  const s = emptyFallShape();
  s.col = lx.map((_, k): FallColumn => ({
    n: 2, p: Float32Array.of(lx[k]! - sx, ly[k]! + 10, lz[k]! - sz, lx[k]!, ly[k]!, lz[k]!), end: k === 3 ? FALLEND_GROUND : FALLEND_WATER, pathlen: 0, land: 0,
  }));
  s.ncols = 5;
  return s;
}
/* MistShape: MistShape5 without its ground column 3 (one water stream). */
function mistShape(sx: number, sz: number): FallShape {
  const s = mistShape5(sx, sz);
  s.col.splice(3, 1);
  s.ncols = 4;
  return s;
}

test("the mist box of a stream: centred, W from the stream, L along, the sizes, the caps (TestMist)", () => {
  const H = handWorld();
  let w = crest2(1000, 1000, 1000, 1016);
  let m = handMist(w, 200, mistShape(5, 0), H)[0]!;
  near(m[0]!, 103.5 + 0.3 * 28.5, 1e-3); near(m[1]!, 50.5, 1e-4); near(m[2]!, 202, 1e-3);
  near(m[3]!, 14.75, 1e-4); near(m[4]!, 28.5, 1e-4); near(m[5]!, 33.25, 1e-4); near(m[6]!, 1, 1e-6); near(m[7]!, 0, 1e-6);
  m = handMist(w, 200, mistShape(0, 5), H)[0]!;
  near(m[0]!, 104, 1e-3); near(m[2]!, 201.75 + 0.3 * 28.5, 1e-3); near(m[3]!, 18.75, 1e-4); near(m[7]!, 1, 1e-6);
  m = handMist(w, 200, mistShape(3, 4), H)[0]!;
  near(m[6]!, 0.6, 1e-6); near(m[7]!, 0.8, 1e-6);
  w.mistdepth = 200; w.mistheight = 50;
  m = handMist(w, 200, mistShape(5, 0), H)[0]!;
  near(m[4]!, 57, 1e-4); near(m[5]!, 16.625, 1e-4); near(m[3]!, 14.75, 1e-4); near(m[0]!, 103.5 + 0.3 * 57, 1e-3);
  w.mistdepth = 100; w.mistheight = 100;
  // a vertical drop: the crest's direction
  m = handMist(w, 200, mistShape(0, 0), H)[0]!;
  near(m[6]!, 1, 1e-6); near(m[7]!, 0, 1e-6);
  w = crest2(1000, 1000, 1016, 1000);
  m = handMist(w, 200, mistShape(0, 0), H)[0]!;
  near(m[6]!, 0, 1e-6); near(m[7]!, -1, 1e-6); near(m[2]!, 201.75 - 0.3 * 28.5, 1e-3); near(m[0]!, 104, 1e-3); near(m[3]!, 18.75, 1e-4);
  w = crest2(1000, 1000, 1000, 1000);
  m = handMist(w, 200, mistShape(0, 0), H)[0]!;
  near(m[6]!, 1, 1e-6); near(m[7]!, 0, 1e-6); near(m[0]!, 103.5 + 0.3 * 28.5, 1e-3); near(m[2]!, 202, 1e-3);
  // the mean of the water columns' last steps
  const mix = mistShape(5, 0);
  mix.col[2]!.p[0] = mix.col[2]!.p[3]!; mix.col[2]!.p[2] = mix.col[2]!.p[5]! - 5;
  mix.col[3]!.p[0] = mix.col[3]!.p[3]!; mix.col[3]!.p[2] = mix.col[3]!.p[5]! - 5;
  m = handMist(w, 200, mix, H)[0]!;
  near(m[6]!, 0.70710678, 1e-5); near(m[7]!, 0.70710678, 1e-5);
  // mist 0: none
  w = crest2(1000, 1000, 1000, 1016);
  w.mist = 0;
  assert.equal(handMist(w, 200, mistShape(5, 0), H).length, 0);
  w.mist = 100;
  // no water-ending column: every column a candidate, one centred stream
  const dry = mistShape5(5, 0);
  for (const c of dry.col) c.end = FALLEND_GROUND;
  let all = handMist(w, 200, dry, H);
  assert.equal(all.length, 1);
  m = all[0]!;
  near(m[0]!, 104 + 0.3 * 31.2, 1e-3); near(m[1]!, 46, 1e-4); near(m[2]!, 202, 1e-3);
  near(m[3]!, 15.2, 1e-4); near(m[4]!, 31.2, 1e-4); near(m[5]!, 36.4, 1e-4); near(m[6]!, 1, 1e-6); near(m[7]!, 0, 1e-6);
  dry.col[0]!.end = FALLEND_LIMIT;
  assert.equal(handMist(w, 200, dry, H).length, 1);
  // water in the middle of dry: two streams
  all = handMist(w, 200, mistShape5(5, 0), H);
  assert.equal(all.length, 2);
  near(all[0]![3]!, 4.0 + 2.0 * (0.05 * (130.0 / 3.0) + 2.0), 1e-3);
  near(all[0]![4]!, 0.6 * (130.0 / 3.0), 1e-3);
  near(all[0]![0]!, 102.0 + 0.3 * all[0]![4]!, 1e-3);
  near(all[0]![2]!, 201, 1e-3);
  near(all[1]![3]!, 12, 1e-3); near(all[1]![4]!, 36, 1e-3); near(all[1]![5]!, 42, 1e-3); near(all[1]![0]!, 108 + 0.3 * 36, 1e-3); near(all[1]![2]!, 204, 1e-3);
  // the minimums, and the caps
  const one = mistShape(5, 0);
  one.col.forEach((c, k) => { c.end = k === 3 ? FALLEND_WATER : FALLEND_GROUND; });
  one.col[3]!.p[4] = 96;
  m = handMist(w, 200, one, H)[0]!;
  near(m[5]!, 2.8, 1e-4); near(m[3]!, 6.4, 1e-4); near(m[4]!, 20, 1e-4); near(m[1]!, 94, 1e-4);
  one.col[3]!.p[4] = 0;
  m = handMist(w, 1000, one, H)[0]!;
  near(m[5]!, 120, 1e-4); near(m[3]!, 14, 1e-3); near(m[4]!, 300, 1e-3);
  w.mistheight = 250;
  near(handMist(w, 1000, one, H)[0]![5]!, 240, 1e-4);
});

/* HandCols: n columns of two rows, the last (x, y, z), the one before 5 ft back along -X and 10 ft higher. */
function handCols(x: number[], y: number[], z: number[], end: number[]): FallShape {
  const s = emptyFallShape();
  s.col = x.map((_, k): FallColumn => ({ n: 2, p: Float32Array.of(x[k]! - 5, y[k]! + 10, z[k]!, x[k]!, y[k]!, z[k]!), end: end[k]!, pathlen: 0, land: 0 }));
  s.ncols = x.length;
  return s;
}
function groupsWorld(sizes: number[]): number[][] {
  const x: number[] = [], y: number[] = [], z: number[] = [], e: number[] = [];
  sizes.forEach((n, g) => { for (let j = 0; j < n; j++) { x.push(40 * g + 2 * j); y.push(50); z.push(0); e.push(FALLEND_WATER); } });
  const H = handWorld();
  H.wall = 20.0;
  return handMist(crest2(1000, 1000, 1000, 1016), 200, handCols(x, y, z, e), H);
}

test("the streams split where the landing breaks, at most 4 (TestMistStreams)", () => {
  const w = crest2(1000, 1000, 1000, 1016);
  const G = FALLEND_GROUND, Wt = FALLEND_WATER;
  let H = handWorld();
  // dry: 6.5 ft apart over flat ground is one stream, 40 ft too
  let s = handCols([0, 6.5], [50, 50], [0, 0], [G, G]);
  let all = handMist(w, 200, s, H);
  assert.equal(all.length, 1);
  near(all[0]![3]!, 11, 1e-3);
  assert.equal(handMist(w, 200, handCols([0, 40], [50, 50], [0, 0], [G, G]), H).length, 1);
  // a bump 2 ft over the line still continuous, 2.5 splits; off the segment it does not count
  s = handCols([0, 6.5], [50, 50], [0, 0], [G, G]);
  Object.assign(H, { bx0: 2, bx1: 4, bz0: -1, bz1: 1, bh: 52.0 });
  assert.equal(handMist(w, 200, s, H).length, 1);
  H.bh = 52.5;
  assert.equal(handMist(w, 200, s, H).length, 2);
  Object.assign(H, { bz0: 3, bz1: 5 });
  assert.equal(handMist(w, 200, s, H).length, 1);
  // the line between the two landing heights
  H = handWorld();
  Object.assign(H, { bx0: 8, bx1: 12, bz0: -1, bz1: 1, bh: 60.0 });
  s = handCols([0, 20], [50, 100], [0, 0], [G, G]);
  assert.equal(handMist(w, 200, s, H).length, 1);
  H.bh = 80;
  assert.equal(handMist(w, 200, s, H).length, 2);
  // 1 ft or less has no samples
  H = handWorld();
  Object.assign(H, { bx0: 0.5, bx1: 1.0, bz0: -1, bz1: 1, bh: 99 });
  assert.equal(handMist(w, 200, handCols([0, 0.9], [50, 50], [0, 0], [G, G]), H).length, 1);
  assert.equal(handMist(w, 200, handCols([0, 1.0], [50, 50], [0, 0], [G, G]), H).length, 1);
  assert.equal(handMist(w, 200, handCols([0, 1.5], [50, 50], [0, 0], [G, G]), H).length, 2);
  // along a diagonal
  H = handWorld();
  s = handCols([0, 3], [50, 50], [0, 5.196], [G, G]);
  assert.equal(handMist(w, 200, s, H).length, 1);
  Object.assign(H, { bx0: 1, bx1: 2, bz0: 2, bz1: 3.4, bh: 60 });
  assert.equal(handMist(w, 200, s, H).length, 2);
  Object.assign(H, { bz0: 0, bz1: 1 });
  assert.equal(handMist(w, 200, s, H).length, 1);
  // water: a surface above the ground at every sample
  H = handWorld();
  s = handCols([0, 20], [10, 10], [0, 0], [Wt, Wt]);
  assert.equal(handMist(w, 200, s, H).length, 1);
  Object.assign(H, { bx0: 8, bx1: 12, bz0: -1, bz1: 1, bh: Math.fround(9.9) });
  assert.equal(handMist(w, 200, s, H).length, 1);
  H.bh = 12;
  assert.equal(handMist(w, 200, s, H).length, 2);
  H.bh = 10;
  assert.equal(handMist(w, 200, s, H).length, 2);
  H = handWorld();
  H.water = -1;
  assert.equal(handMist(w, 200, s, H).length, 2);
  // no drop filter: an apex column joins its neighbours, 40 ft away it is its own stream
  H = handWorld();
  H.wall = 200;
  all = handMist(w, 200, handCols([0, 2, 4], [50, 100, 50], [0, 0, 0], [G, G, G]), H);
  assert.equal(all.length, 1);
  near(all[0]![4]!, 0.6 * (100 / 3), 1e-3);
  all = handMist(w, 200, handCols([0, 2, 4, 44], [50, 100, 50, 100], [0, 0, 0, 0], [G, G, G, G]), H);
  assert.equal(all.length, 2);
  near(all[1]![4]!, 20, 1e-3); near(all[1]![3]!, 6, 1e-3); near(all[1]![1]!, 98, 1e-3);
  // a non-candidate between two water columns splits them
  assert.equal(handMist(w, 200, handCols([0, 2, 4], [50, 50, 50], [0, 0, 0], [Wt, G, Wt]), handWorld()).length, 2);
  // at most 4: the most columns first, a tie to the lower first column, then column order
  all = groupsWorld([1, 2, 2, 2, 2, 2]);
  assert.equal(all.length, 4);
  for (let g = 0; g < 4; g++) near(all[g]![0]!, 40 * (g + 1) + 1 + 9, 1e-3);
  all = groupsWorld([2, 2, 2, 2, 2, 1]);
  assert.equal(all.length, 4);
  for (let g = 0; g < 4; g++) near(all[g]![0]!, 40 * g + 1 + 9, 1e-3);
  all = groupsWorld([1, 3, 1, 2, 1, 2, 2]);
  assert.equal(all.length, 4);
  near(all[0]![0]!, 51, 1e-3); near(all[1]![0]!, 130, 1e-3); near(all[2]![0]!, 210, 1e-3); near(all[3]![0]!, 250, 1e-3);
  assert.equal(groupsWorld([1, 1, 1, 1]).length, 4);
});

/* MistLanding + MistStreamCheck: the engine's (x, y, z, width, drop) of a stream, backed out of its box. */
function streamCheck(name: string, m: number[], want: readonly number[], n = 5): void {
  const drop = m[4]! / 0.6;
  let mg = 0.05 * drop + 2.0;
  if (mg < 2.0) mg = 2.0;
  if (mg > 6.0) mg = 6.0;
  const got = [m[0]! - 0.3 * m[4]! * m[6]!, m[1]! + 2.0, m[2]! - 0.3 * m[4]! * m[7]!, m[3]! - 2.0 * mg, drop];
  for (let i = 0; i < n; i++) near(got[i]!, want[i]!, 0.011, `${name} [${i}]`);
}

test("the engine's ridge and foot worlds: the streams and the dry landing (TestMistRidge, TestMistLanding)", () => {
  const ridge = (tx: number, tz: number) => { void tx; const v = 100 * 64 - 20 * 64 * Math.abs((tz & 255) - 126); return v > 0 ? v : 0; };
  const ridgeGround = (water: boolean): FallGround => ({ height: (x, z) => fallClassicHeightRaw(ridge, x, z), water: water ? () => Math.fround(10) : () => null });
  // Traxx 1.8.0 (f7fb1b9, flow tubes + ribbons): each side's columns MERGE into one tube, so each stream is ONE surviving
  // column landing on a lone row, the ribbon's W = clamp(0.35 x 32 x 2, 2, 64) = 22.4 ft wide (before: 10.37 / 10.31, 10.22 / 10.18).
  const dry = [[4008.769, 0.499, 3872.325, 22.4, 99.501], [4008.686, 0.438, 4191.779, 22.4, 99.562]];
  const pools = [[4008.766, 10.0, 3887.271, 22.4, 90.0], [4008.683, 10.0, 4176.502, 22.4, 90.0]];
  for (const [water, want] of [[false, dry], [true, pools]] as const) {
    const g = ridgeGround(water);
    const w = crest2(4000, 3969, 4000, 4095);
    const all = mistVolumes(w, 200, buildFallShape(w, 200, g), g);
    assert.equal(all.length, 2, water ? "ridge_pools" : "ridge_dry");
    all.forEach((m, k) => streamCheck(water ? "ridge_pools" : "ridge_dry", m, want[k]!));
    if (!water) ok(all[0]![2]! < 4032 && all[1]![2]! > 4032);
  }
  // the foot worlds: a cliff to tile 124, then a slope from `base` falling 10 ft a tile to 0
  const foot = (topFt: number, want: number[]) => {
    const corner = (tx: number) => { if ((tx & 255) <= 124) return topFt * 64; const v = 100 * 64 - 10 * 64 * ((tx & 255) - 125); return v > 0 ? v : 0; };
    const g: FallGround = { height: (x, z) => fallClassicHeightRaw(corner, x, z), water: () => null };
    const w = crest2(4000, 4000, 4000, 4040);
    const all = mistVolumes(w, topFt * 2, buildFallShape(w, topFt * 2, g), g);
    assert.equal(all.length, 1);
    streamCheck(`foot ${topFt}`, all[0]!, want);
  };
  foot(200, [4015.40, 95.49, 4020.0, 42.0, 104.51]); // a FALL: its touchdown
  foot(110, [4318.83, 0.66, 4020.0, 42.0, 109.34]); // a SLIDE: the run-out start
  // hand-built: FallColumn.land picks the row; 0, -1 or past n is the last row; a water column ignores it
  const s = emptyFallShape();
  s.col = [0, 2, 4].map((z): FallColumn => ({ n: 4, p: Float32Array.of(0, 100, z, 10, 80, z, 20, 60, z, 30, 10, z), end: FALLEND_GROUND, pathlen: 0, land: 2, front: null }));
  s.ncols = 3;
  const w = crest2(1000, 1000, 1000, 1016), H = handWorld();
  let all = handMist(w, 200, s, H);
  assert.equal(all.length, 1);
  near(all[0]![1]!, 58, 1e-4); near(all[0]![3]!, 14, 1e-4); near(all[0]![4]!, 24, 1e-4); near(all[0]![0]!, 20 + 0.3 * 24, 1e-3); near(all[0]![6]!, 1, 1e-6);
  for (const c of s.col) c.land = 0;
  near(handMist(w, 200, s, H)[0]![1]!, 8, 1e-4);
  for (const c of s.col) c.land = 4;
  near(handMist(w, 200, s, H)[0]![1]!, 8, 1e-4);
  for (const c of s.col) { c.end = FALLEND_WATER; c.land = 2; }
  all = handMist(w, 200, s, H);
  near(all[0]![1]!, 8, 1e-4);
});

test("the landing-continuity rule on the engine's split and mud worlds, and LandContinuous itself (TestLandRule)", () => {
  // the engine's 8 ft fine grid (core\TerrainFine.cpp terrainFineHeight), 1024 x 1024 cells
  const fine = new Int16Array(1024 * 1024);
  const sw = { top: 100, floorFt: 60, k: 3, r: 24, r0: 0, a: 0, water: -1e9 };
  const splitH = (x: number, z: number) => {
    const dx = x - 4000, len = (sw.top - sw.floorFt) / 0.5;
    const az = sw.a > 0 ? Math.abs(Math.abs(z - 4000) - sw.a) : Math.abs(z - 4000);
    if (dx <= 0) return sw.top;
    if (dx < len) {
      const t = 1 - az / sw.r;
      const h = sw.top - 0.5 * dx + sw.k * (t > 0 ? t : 0) * (dx / 16 < 1 ? dx / 16 : 1) * (1 - dx / len);
      return h > sw.floorFt ? h : sw.floorFt;
    }
    const t = 1 - Math.abs(z - 4000) / 8;
    return sw.floorFt + sw.r0 * (t > 0 ? t : 0);
  };
  const fmul = (a: number, b: number) => Math.floor((a * b) / 65536);
  const fineRaw = (z: number, x: number) => {
    const X = (x >>> 11) & 1023, Z = (z >>> 11) & 1023, X1 = (X + 1) & 1023, Z1 = (Z + 1) & 1023;
    const xf = (x & 2047) << 5, zf = (z & 2047) << 5;
    const F = (i: number) => fine[i]! * 4;
    if ((X & 1) === (Z & 1)) {
      if (xf > zf) { const y0 = F(Z * 1024 + X), y1 = F(Z * 1024 + X1), y2 = F(Z1 * 1024 + X1); return y0 + fmul(y1 - y0, xf) + fmul(y2 - y1, zf); }
      const y0 = F(Z * 1024 + X), y2 = F(Z1 * 1024 + X1), y3 = F(Z1 * 1024 + X);
      return y0 + fmul(y2 - y3, xf) + fmul(y3 - y0, zf);
    }
    if (0x10000 - xf > zf) { const y0 = F(Z * 1024 + X), y1 = F(Z * 1024 + X1), y3 = F(Z1 * 1024 + X); return y1 + fmul(y0 - y1, 0x10000 - xf) + fmul(y3 - y0, zf); }
    const y1 = F(Z * 1024 + X1), y2 = F(Z1 * 1024 + X1), y3 = F(Z1 * 1024 + X);
    return y1 + fmul(y3 - y2, 0x10000 - xf) + fmul(y2 - y1, zf);
  };
  const split = (z0: number, z1: number) => {
    for (let Z = 0; Z < 1024; Z++) for (let X = 0; X < 1024; X++) fine[Z * 1024 + X] = Math.floor(splitH(X * 8, Z * 8) * 64);
    const g: FallGround = {
      height: (x, z) => Math.fround(fineRaw(Math.floor(z * 256) >>> 0, Math.floor(x * 256) >>> 0) / 256),
      water: () => (sw.water < -1e8 ? null : Math.fround(sw.water)),
    };
    const w = crest2(4000, z0, 4000, z1);
    w.speed = 96;
    const s = buildFallShape(w, 200, g);
    let wet = 0, gap = 0;
    s.col.forEach((c, k) => {
      if (c.end === FALLEND_WATER) wet++;
      if (k > 0) {
        const a = s.col[k - 1]!, ea = 3 * (a.n - 1), eb = 3 * (c.n - 1);
        gap = Math.max(gap, Math.hypot(c.p[eb]! - a.p[ea]!, c.p[eb + 2]! - a.p[ea + 2]!));
      }
    });
    return { s, all: mistVolumes(w, 200, s, g), wet, gap };
  };
  // split_flat: two columns land 20.85 ft apart on a flat floor: one stream
  let r = split(3999, 4001);
  ok(r.s.ncols === 2 && r.gap > 20 && r.gap < 23, `${r.gap}`);
  assert.equal(r.all.length, 1);
  streamCheck("split_flat", r.all[0]!, [4078.77, 60.94, 3999.96], 3);
  // split_bump: a 3 ft ridge between them: two
  sw.r0 = 3.0;
  r = split(3999, 4001);
  assert.equal(r.all.length, 2);
  streamCheck("split_bump 0", r.all[0]!, [4078.75, 60.95, 3989.53], 3);
  streamCheck("split_bump 1", r.all[1]!, [4078.79, 60.93, 4010.38], 3);
  // mud: 50 columns slide into one lake up to 39 ft apart: one stream
  Object.assign(sw, { top: 100, floorFt: 60, k: 6, r: 12, r0: 0, a: 16, water: 62 });
  r = split(3951, 4049);
  ok(r.s.ncols === 50 && r.wet === 50 && r.gap > 6);
  assert.equal(r.all.length, 1);
  // Traxx 1.8.0: the engine harness' mud pins (cedb73e): 37 merges (13 live columns), the written mesh 1080 vertices (sheet
  // 1044, ribbon 0, foam 36), back 0, 1981 triangles, 0 split; x over the LIVE columns only (4076.71 before the flow tubes).
  ok(r.s.merges === 37 && r.s.col.filter((c) => c.merged).length === 37, `${r.s.merges}`);
  const fit = fitFall(r.s, 32768, FALL_IDX_UNLIMITED)!;
  ok(fit.verts === 1080 && fit.back === 0 && fit.tris === 1981 && fit.ribbon === 0 && fit.splitTris === 0 && fit.merges === 37, JSON.stringify(fit));
  streamCheck("mud", r.all[0]!, [4076.657, 62.000, 4000.000, 100.0, 38.0]);
  // LandContinuous on wtr_check's points
  const ul = { bump: false, lake: false, flat: 60 };
  const g: FallGround = {
    height: (_x, z) => {
      if (!ul.bump) return Math.fround(ul.flat);
      const t = 3 * (1.25 - Math.abs(z - 4000) / 8);
      return Math.fround(60 + (t > 0 ? (t < 3 ? t : 3) : 0));
    },
    water: (x) => (!ul.lake || x <= 4070 ? null : Math.fround(62)),
  };
  const f = (a: number[]) => Float32Array.from(a);
  const a = f([4078.8, 60.9, 3989.5]), b = f([4078.8, 60.9, 4010.4]), a2 = f([4079.5, 60.9, 3989.5]), c = f([4060.0, 62.0, 3990.0]);
  ok(landContinuous(a, b, false, 0, g));
  ul.bump = true;
  ok(!landContinuous(a, b, false, 0, g));
  ok(landContinuous(a, a2, false, 0, g));
  ul.bump = false; ul.lake = true;
  ok(landContinuous(a, b, true, 0, g));
  ok(!landContinuous(c, b, true, 0, g));
  ul.flat = 63;
  ok(!landContinuous(a, b, true, 0, g));
  ul.lake = false; ul.flat = 60;
  ok(!landContinuous(a, b, true, 0, g));
});

// ---- The final run-out trim (cea8c7e) ----

test("a dry column's final flat run-out is trimmed past 8 ft; the path length stays whole", () => {
  // 100 ft up, 6 ft/s, down a 45 degree slope from x 1000 onto a flat floor at 0 (x 1100 on): the slide
  // reaches the floor fast and runs out well past 8 ft before it rests
  const slope = (x: number) => Math.fround(x < 1000 ? 100 : x < 1100 ? 100 - (x - 1000) : 0);
  const g: FallGround = { height: (x) => slope(x), water: null };
  const rows: number[] = [];
  const r = walkColumn(1000, 100, 1000, 1, 0, 6, 0, g, 2.0, rows);
  assert.equal(r.end, FALLEND_GROUND);
  assert.equal(rows.length, 3 * r.rows);
  // the kept rows' own path, against the whole path: the run-out was cut
  let kept = 0;
  for (let k = 1; k < r.rows; k++) kept += Math.hypot(rows[3 * k]! - rows[3 * k - 3]!, rows[3 * k + 1]! - rows[3 * k - 2]!, rows[3 * k + 2]! - rows[3 * k - 1]!);
  ok(r.pathlen > kept + 1, `${r.pathlen} ${kept}`);
  // it ends on the floor, past the slope's foot by a little more than 8 ft of path
  const lastx = rows[3 * (r.rows - 1)]!;
  near(rows[3 * (r.rows - 1) + 1]!, 0.3, 1e-3);
  ok(lastx > 1100 + 8 && lastx < 1100 + 14, `${lastx}`);
  // a slide: its dry landing row is the start of the run-out, at the slope's foot
  ok(r.land >= 1 && r.land < r.rows);
  const footx = rows[3 * r.land]!;
  ok(footx > 1095 && footx < 1104, `${footx}`);
  // a water-ending column is never trimmed and has no dry landing row
  const gw: FallGround = { height: (x) => slope(x), water: () => Math.fround(1) };
  const rw = walkColumn(1000, 100, 1000, 1, 0, 6, 0, gw, 2.0, null);
  ok(rw.end === FALLEND_WATER && rw.land === -1);
  // the shape's columns carry the trimmed rows and the landing row; the mist stream lands at the foot
  const w = crest2(1000, 1000, 1000, 1004);
  w.speed = 96;
  const s = buildFallShape(w, 200, g);
  ok(s.col.every((c) => c.n === r.rows && c.land === r.land), `${s.col.map((c) => [c.n, c.land])}`);
  ok(s.warn & FALLWARN_DRY);
  const m = mistVolumes(w, 200, s, g);
  assert.equal(m.length, 1);
  near(m[0]![1]! + 2, rows[3 * r.land + 1]!, 1e-3);
});

// ---- Rough water / Rough from ----

test("Rough from: .WFL byte 130, FALL_ROUGH for 251..254, the TXX block 3, the window's rules (TestWFLRoughFrom)", () => {
  const L = makeLake();
  const a = lakeFall();
  const b = fallDefaults();
  assert.equal(b.roughfrom, 0);
  b.npoints = 2; b.height = 300;
  b.pt[0] = [100 * 16, 100 * 16]; b.pt[1] = [100 * 16, 140 * 16];
  const falls = [a, b];
  const v1 = buildWfl(falls, L)!;
  assert.equal(v1.length, 32 + 16 + 8 + 2 * 128);
  assert.equal(v1[6], 0);
  ok(parseWflFalls(v1)!.every((f) => f.roughfrom === 0));
  b.roughfrom = 40;
  assert.equal(fallErrors(falls, 1, L), 0);
  let buf = buildWfl(falls, L)!;
  assert.equal(buf.length, 32 + 16 + 8 + 2 * 132);
  assert.equal(buf[6], 1);
  assert.deepEqual([...buf.subarray(56 + 128, 56 + 132)], [100, 100, 0, 0]);
  assert.deepEqual([...buf.subarray(56 + 132 + 128, 56 + 132 + 132)], [100, 100, 40, 0]);
  for (let i = 0; i < 128; i++) ok(buf[56 + i] === v1[56 + i] && buf[56 + 132 + i] === v1[56 + 128 + i]);
  assert.deepEqual(parseWflFalls(buf)!.map((f) => f.roughfrom), [0, 40]);
  const copy = buf.slice();
  copy[56 + 131] = 0xaa; copy[56 + 130] = 252;
  assert.deepEqual(parseWflFalls(copy)!.map((f) => f.roughfrom), [252, 40]);
  for (const v of [1, 24, 25, 40, 250, 255]) {
    b.roughfrom = v;
    assert.equal(fallErrors(falls, 1, L), 0);
    buf = buildWfl(falls, L)!;
    ok(buf[56 + 132 + 130] === v && buf[56 + 132 + 131] === 0);
    assert.equal(parseWflFalls(buf)![1]!.roughfrom, v);
  }
  for (let v = 0; v <= 255; v++) {
    b.roughfrom = v;
    assert.equal((fallErrors(falls, 1, L) & FALLERR_ROUGH) !== 0, v >= 251 && v <= 254);
    if (v >= 251 && v <= 254) assert.equal(buildWfl(falls, L), null);
  }
  assert.equal(fallErrorText(FALLERR_ROUGH), "Rough from is 251..254: use 0 (default), 1..250 ft/s, or switch Rough water off");
  b.roughfrom = 0;
  b.mistdepth = 150;
  buf = buildWfl(falls, L)!;
  assert.deepEqual([...buf.subarray(56 + 132 + 128, 56 + 132 + 132)], [150, 100, 0, 0]);
  b.mistdepth = 100;
  ok(Buffer.from(buildWfl(falls, L)!).equals(Buffer.from(v1)));
  // the .TXX falls block 3 carries it
  const t = resetTrack();
  t.falls = [Object.assign(crest2(1000, 1000, 1000, 1016), { roughfrom: 255 }), Object.assign(crest2(1000, 1100, 1000, 1116), { roughfrom: 7 })];
  assert.deepEqual(readTxx(writeTxx(t)).falls.map((f) => f.roughfrom), [255, 7]);
  // the window: 0 shows 25, a typed 25 is 0, off keeps the last value, the spin a ft/s a click
  const w = fallDefaults();
  assert.equal(fallRoughText(w, 0), "25");
  ok(applyFallRoughText(w, "40", false) && w.roughfrom === 40);
  ok(applyFallRoughText(w, "25", false) && w.roughfrom === 0);
  ok(!applyFallRoughText(w, "300", false) && w.roughfrom === 0);
  ok(applyFallRoughText(w, "300", true) && w.roughfrom === 250);
  ok(applyFallRoughText(w, "", true) && w.roughfrom === 0);
  w.roughfrom = 40;
  let prev = toggleFallRough(w, false, 0);
  ok(w.roughfrom === 255 && prev === 40 && fallRoughText(w, prev) === "40");
  ok(!applyFallRoughText(w, "60", true) && !stepFallRough(w, 1) && w.roughfrom === 255);
  prev = toggleFallRough(w, true, prev);
  assert.equal(w.roughfrom, 40);
  w.roughfrom = 24;
  ok(stepFallRough(w, 1) && w.roughfrom === 0);
  ok(stepFallRough(w, 1) && w.roughfrom === 26);
  w.roughfrom = 1;
  stepFallRough(w, -1);
  assert.equal(w.roughfrom, 1);
});

// ---- The EDGE rule on the falls' side (056a2d3) ----

const NH = 100;
const NTILE = (x: number, z: number) => x + (z << 8);
function notchWorld(lip: number, far: number, extra: [number, number, number][] = []): Uint8Array {
  const raw = new Uint8Array(65536).fill(80);
  for (let z = 0; z < 256; z++) for (let x = 110; x < 256; x++) raw[z * 256 + x] = 10;
  for (let z = 103; z < 108; z++) for (let x = 103; x < 108; x++) raw[z * 256 + x] = 10;
  raw[104 * 256 + 108] = raw[105 * 256 + 108] = lip;
  raw[104 * 256 + 109] = raw[105 * 256 + 109] = far;
  for (const [x, z, v] of extra) raw[z * 256 + x] = v;
  return raw;
}
const notchFall = (x = 3456, z0 = 3329, z1 = 3359, src = 1) => Object.assign(crest2(x, z0, x, z1), { source: src, speed: 96 });
const tmapLake = (rule: number, h = NH): FallLakes => {
  const tmap = new Uint8Array(65536);
  for (let z = 102; z < 108; z++) for (let x = 102; x < 108; x++) tmap[NTILE(x, z)] = 1;
  return { lakes: [{ height: h }], tmap, rule };
};
const rawGround = (raw: Uint8Array): LakeGround => ({ raw, tilemin: null, groundAtLevel: null });
const rawFallGround = (raw: Uint8Array): FallGround => ({ height: (x, z) => fallClassicHeightRaw((tx, tz) => 128 * raw[(tz & 255) * 256 + (tx & 255)]!, x, z), water: null });
function hasEdge(e: readonly LakeNotchEdge[], ax: number, az: number, bx: number, bz: number): boolean {
  const dx = [0, 1, 0, -1], dz = [-1, 0, 1, 0];
  return e.some((r) => {
    const x1 = (r.x + dx[r.dir]!) & 255, z1 = (r.z + dz[r.dir]!) & 255;
    return (r.x === ax && r.z === az && x1 === bx && z1 === bz) || (r.x === bx && r.z === bz && x1 === ax && z1 === az);
  });
}
/* EdgeFill: lake 1 (seed 104,104) filled under EDGE with the falls' notch edges. */
const edgeFill = (raw: Uint8Array, falls: TraxxFall[], h = NH) => {
  const g = rawGround(raw);
  const n = lakeNotches(null, null, buildNotchEdges(falls), LAKE_RULE_EDGE);
  const lakes = [{ height: h, flags: 1, seeds: [[104, 104]] as [number, number][] }];
  return { g, lakes, n, st: recomputeLakes(g, lakes, 0, n) };
};

test("the notch EDGES, the edge meanings of FALL_NOTCH, NOTCH_SHARED and the lip codes, the fill end to end (TestNotchEdge)", () => {
  // the notch edge of a fall: named from D's side (108,104), whose west edge it is
  let e = buildNotchEdges([notchFall()]);
  assert.deepEqual(e, [{ lake: 1, x: 108, z: 104, dir: LAKE_DIR_W }]);
  ok(hasEdge(e, 107, 104, 108, 104) && !hasEdge(e, 108, 103, 108, 104));
  assert.equal(buildNotchEdges([notchFall()], 256, null, 0).length, 0);
  // the TMAP filter
  const L = tmapLake(LAKE_RULE_EDGE);
  assert.equal(buildNotchEdges([notchFall()], 256, L.tmap).length, 1);
  assert.equal(buildNotchEdges([notchFall()], 256, new Uint8Array(65536)).length, 0);
  const other = L.tmap!.slice();
  other[NTILE(107, 104)] = 2;
  assert.equal(buildNotchEdges([notchFall()], 256, other).length, 0);
  // the union: each (lake, edge) once; another lake's fall on the same edge counts for its own lake
  assert.equal(buildNotchEdges([notchFall(), notchFall(3456, 3335, 3350)]).length, 1);
  e = buildNotchEdges([notchFall(), notchFall(3456, 3335, 3350), notchFall(3456, 3329, 3359, 2)]);
  ok(e.length === 2 && e[0]!.lake === 1 && e[1]!.lake === 2 && hasEdge(e, 107, 104, 108, 104));
  assert.equal(buildNotchEdges([notchFall(), notchFall(3456, 3329, 3359, 2)], 256, null, 1).length, 1);
  // one crest over two notch edges
  e = buildNotchEdges([notchFall(3456, 3329, 3391)]);
  ok(e.length === 2 && hasEdge(e, 107, 104, 108, 104) && hasEdge(e, 107, 105, 108, 105));
  // the checks under EDGE
  let raw = notchWorld(25, 22);
  const errs = (f: TraxxFall[], i: number, lk: FallLakes = L) => fallErrors(f, i, lk, null, rawGround(raw));
  const warns = (f: TraxxFall[], i: number, lk: FallLakes = L) => fallNotchWarnings(f, i, lk, rawGround(raw), rawFallGround(raw));
  assert.equal(errs([notchFall()], 0), 0);
  assert.equal(warns([notchFall()], 0).warn, 0);
  let two = [notchFall(), notchFall(3456, 3335, 3350)];
  ok(errs(two, 0) === FALLERR_NOTCH_SHARED && errs(two, 1) === FALLERR_NOTCH_SHARED);
  two = [notchFall(), notchFall(3456, 3329, 3359, 2)];
  ok(errs(two, 0) & FALLERR_NOTCH_SHARED && errs(two, 1) & FALLERR_NOTCH_SHARED);
  // two falls on two edges of one tile D are not shared under EDGE (the tile rule says they are)
  const south = Object.assign(crest2(3487, 3328, 3457, 3328), { source: 1, speed: 96, height: NH });
  two = [notchFall(), south];
  ok(!(errs(two, 0) & FALLERR_NOTCH_SHARED) && !(errs(two, 1) & FALLERR_NOTCH_SHARED));
  const T = tmapLake(LAKE_RULE_TILE);
  ok(errs(two, 0, T) & FALLERR_NOTCH_SHARED && errs(two, 1, T) & FALLERR_NOTCH_SHARED);
  // FALL_NOTCH: A and D not 4-adjacent; D in a lake
  assert.equal(errs([notchFall(3453)], 0), FALLERR_NOTCH);
  assert.equal(errs([notchFall(3424)], 0), FALLERR_NOTCH | FALLERR_LIP_LOW);
  ok(errs([notchFall(3328)], 0) & FALLERR_NOTCH);
  // FALL_LIP_LOW: a lip point of the notch edge below H
  raw = notchWorld(24, 22);
  assert.equal(errs([notchFall()], 0), FALLERR_LIP_LOW);
  // a diagonal pair has no edge, so no lip point (the tile rule's vertex is LIP_LOW there)
  raw = notchWorld(25, 22, [[108, 108, 20]]);
  const diag = fallDefaults();
  Object.assign(diag, { source: 1, speed: 96, npoints: 2, height: 200 });
  diag.pt[0] = [Math.trunc(3471.5 * 16), Math.trunc(3440.5 * 16)];
  diag.pt[1] = [Math.trunc(3441.5 * 16), Math.trunc(3470.5 * 16)];
  const de = errs([diag], 0);
  ok(de & FALLERR_NOTCH && !(de & FALLERR_LIP_LOW));
  assert.equal(buildNotchEdges([diag]).length, 0);
  ok(errs([diag], 0, T) & FALLERR_LIP_LOW);
  // LIP_HIGH worded for the edge
  raw = notchWorld(26, 22);
  assert.equal(errs([notchFall()], 0), 0);
  let r = warns([notchFall()], 0);
  ok(r.warn & FALLWARN_LIP_HIGH && r.info.climb === 4 && r.info.edge && !r.info.hint4);
  let text = fallNotchWarnText(FALLWARN_LIP_HIGH, r.info);
  ok(text.includes("lip point") && text.includes("4 water units (2 ft)"));
  // NOTCH_FLAT worded for the edge; the tile rule's wording stays
  raw = notchWorld(25, 25);
  r = warns([notchFall()], 0);
  ok(r.warn & FALLWARN_NOTCH_FLAT);
  ok(fallNotchWarnText(FALLWARN_NOTCH_FLAT, r.info).includes("beyond the notch edge along the flow"));
  r = warns([notchFall()], 0, T);
  text = fallNotchWarnText(FALLWARN_NOTCH_FLAT, r.info);
  ok(text.includes("notch tile") && !r.info.edge);
  // the texts: edge wording only on request
  ok(fallErrorText(FALLERR_NOTCH_SHARED, null, true).includes("notch edge"));
  ok(fallErrorText(FALLERR_NOTCH_SHARED).includes("notch tile"));
  ok(fallErrorText(FALLERR_NOTCH, null, true).includes("notch edge"));
  ok(fallErrorText(FALLERR_LIP_LOW, null, true).includes("lip point"));
  ok(fallWarnText(FALLWARN_NOTCH_FLAT, true).includes("beyond the notch edge"));
  ok(fallErrorText(FALLERR_POINTS, null, true) && fallWarnText(FALLWARN_DRY, true));
  // LIP_UNCOVERED: half the lip edge
  raw = notchWorld(25, 22);
  ok(warns([notchFall(3456, 3329, 3345)], 0).warn & FALLWARN_LIP_UNCOVERED);
  assert.equal(warns([notchFall()], 0).warn & FALLWARN_LIP_UNCOVERED, 0);
  // END TO END: the fall's edge fills the lake (36 tiles, highest legal H 100)
  let f = edgeFill(raw, [notchFall()]);
  ok(f.n!.rule === LAKE_RULE_EDGE && f.n!.edges.length === 1 && f.n!.notchlake === null);
  ok(f.st.lakes[0]!.errors === 0 && f.st.lakes[0]!.tilecount === 36);
  ok(lakeAt(f.st, f.lakes, 108, 104) === -1 && lakeAt(f.st, f.lakes, 107, 104) === 0);
  ok(f.st.lakes[0]!.spill === 100 && lakeHoldsUpTo(f.g, f.lakes, f.st, 0, 0) === 100);
  // the tile-form feed (the transition) gives the same lake
  const nb = buildNotches([notchFall()]);
  const viaTiles = recomputeLakes(f.g, f.lakes, 0, lakeNotches(nb.notchlake, nb.lipedges, null, LAKE_RULE_EDGE));
  ok(viaTiles.lakes[0]!.errors === 0 && viaTiles.lakes[0]!.tilecount === 36 && Buffer.from(viaTiles.tmap).equals(Buffer.from(f.st.tmap)));
  ok(edgeFill(raw, []).st.lakes[0]!.errors & 2); // no fall: the lip points at H are open (LEAK)
  ok(edgeFill(notchWorld(25, 22, [[108, 103, 25]]), [notchFall()]).st.lakes[0]!.errors & 2);
  ok(edgeFill(notchWorld(24, 22), [notchFall()]).st.lakes[0]!.errors & 2);
  f = edgeFill(notchWorld(26, 22), [notchFall()]);
  ok(f.st.lakes[0]!.errors === 0 && f.st.lakes[0]!.tilecount === 36);
  f = edgeFill(notchWorld(25, 22, [[108, 106, 25], [109, 106, 22]]), [notchFall(3456, 3329, 3391)]);
  ok(f.n!.edges.length === 2 && f.st.lakes[0]!.errors === 0 && f.st.lakes[0]!.tilecount === 36 && f.st.lakes[0]!.spill === 100);
  // SnapToLip under EDGE: a crest 10 ft (or 2 ft) inside the lake goes onto the lip edge x = 3456
  raw = notchWorld(25, 22);
  for (const x of [3446, 3454]) {
    const lk = tmapLake(LAKE_RULE_EDGE);
    const falls = [notchFall(x)];
    ok(fallErrors(falls, 0, lk, null, rawGround(raw)) & FALLERR_NOTCH);
    assert.equal(snapToLip(falls, 0, lk, 48.0, rawGround(raw)), 2);
    ok(falls[0]!.pt[0]![0] === 3456 * 16 && falls[0]!.pt[1]![0] === 3456 * 16);
    f = edgeFill(raw, falls);
    ok(f.st.lakes[0]!.errors === 0 && f.st.lakes[0]!.tilecount === 36);
    assert.equal(fallErrors(falls, 0, lk, null, rawGround(raw)), 0);
  }
  // the wrong flow side is FALL_DIRECTION
  const rev = notchFall();
  fallReverse(rev);
  ok(errs([rev], 0) & FALLERR_DIRECTION);
});

test("track format version 6: the notch edges and the mist streams in a 512-cell world", () => {
  // a crest past column 255: its edge is named in the 512 map
  const w = notchFall(12000 + 3456 - 3456, 3329, 3359);
  w.pt[0] = [Math.trunc(11264 * 16), Math.trunc(3329 * 16)];
  w.pt[1] = [Math.trunc(11264 * 16), Math.trunc(3359 * 16)];
  const e = buildNotchEdges([w], 512);
  assert.deepEqual(e, [{ lake: 1, x: 352, z: 104, dir: LAKE_DIR_W }]);
  // a shape in an N world keeps its streams (the ground wraps at W = 16384 ft)
  const g: FallGround = { cells: 512, height: (x) => Math.fround(x >= 16000 && x < 16010 ? 100 : 0), water: () => Math.fround(10) };
  const f = crest2(16005, 1000, 16005, 1016);
  const s = buildFallShape(f, 200, g);
  ok(s.ncols === 9 && s.col.every((c) => c.end === FALLEND_WATER));
  const all = mistVolumes(f, 200, s, g);
  assert.equal(all.length, 1);
  ok(all[0]![0]! > 16005);
});
