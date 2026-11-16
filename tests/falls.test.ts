/*
  Traxx 1.7.1's waterfalls (TrackPOD/TrackPODFalls.cpp), ported from Traxx's own console test
  tools/wfltest.cpp: the classic ground rule, the crest geometry, the column walk over a cliff, into
  water, down a slope and across the world edge, a bent crest, every error code, Orient, SnapToLip,
  the spillway notches, the budget, the mist box, the .WFL and .TXX images and the list helpers.

  The 0.53 sandbox checks (JSTRAXX_CP4_053, default ~/games/cp4sandbox053, skipped when absent)
  rebuild fog_test.txx's .WFL and .WTR and compare them with the pod Traxx 1.7.1 wrote, byte for
  byte, and round-trip the TXX V18 file.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildFallShape, buildNotches, buildWfl, crestLength, fallBadPoints, fallBudget, fallClassicHeightRaw, fallDefaults, fallEffectiveHeight,
  fallErrorText, fallErrors, fallNotchWarnings, fallNotchWarnText, fallOrient, fallReverse, fallWarnText, fallsLakeDeleted, fallsOnLake,
  fallAdd, emptyFallShape, nearCrest, parseWflFalls, pointDirection, snapToLip, wrapDiff, fallPickSource, fallNearestToMenu,
  FALLEND_GROUND, FALLEND_LIMIT, FALLEND_WATER, FALLERR_COUNT, FALLERR_COORD, FALLERR_DIRECTION, FALLERR_HEIGHT, FALLERR_LIP_LOW,
  FALLERR_NAME, FALLERR_NOTCH, FALLERR_NOTCH_SHARED, FALLERR_POINTS, FALLERR_SOURCE, FALLERR_SPEED, FALLERR_TURN, FALLERR_WIDTH,
  FALLWARN_COARSE, FALLWARN_DRY, FALLWARN_DROPPED, FALLWARN_LIP_HIGH, FALLWARN_LIP_UNCOVERED, FALLWARN_NOTCH_FLAT, FALLWARN_SHORTENED,
  FALL_MAX_FALLS, FALL_NSPACINGS, type FallGround, type FallLakes, type FallShape, type TraxxFall,
} from "../src/core/traxx/falls.ts";
import { LAKE_LIP_E, LAKE_LIP_N, LAKE_LIP_S, LAKE_LIP_W } from "../src/core/traxx/lake-ground.ts";
import { readTxx, writeTxx, txxVersionFor } from "../src/core/traxx/txx.ts";
import { buildWtr, recomputeLakes, trackLakes, LAKE_RULE_TILE } from "../src/core/traxx/lakes.ts";
import { buildLakeGround, type LakeGround } from "../src/core/traxx/surface.ts";
import { resetTrack, newTrackDocument } from "../src/core/doc/new-track.ts";
import { buildTrackPod, podRefusal } from "../src/core/traxx/pod-writer.ts";
import { parseWfl } from "../src/vendor/openphotex/mtm/wfl.js";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { findPodEntry, readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { seekToItem } from "../src/core/traxx/pod-items.ts";
import { openTxx } from "../src/core/doc/load-txx.ts";
import { loadPodTrack } from "../src/core/doc/load-pod.ts";
import { FallShapeCache, fallPreviewList, fallStripRows, fallViewShift } from "../src/core/view/fall-shapes.ts";
import {
  applyFallPercent, applyFallSpeedText, fallReadouts, fallSourceOptions, fallTextureStem, liveFallHeight, liveFallSpeed, spaced, stepFallMist, stepFallSpeed,
} from "../src/core/edit/fall-properties.ts";

const DT = 1.0 / 60.0;
const near = (a: number, b: number, tol: number, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} != ${b} (+-${tol})`);

/* A straight crest of two points, in feet (Crest2). */
function crest2(x0: number, z0: number, x1: number, z1: number): TraxxFall {
  const w = fallDefaults();
  w.npoints = 2;
  w.pt[0] = [Math.trunc(x0 * 16), Math.trunc(z0 * 16)];
  w.pt[1] = [Math.trunc(x1 * 16), Math.trunc(z1 * 16)];
  w.height = 200;
  return w;
}
const setPt = (w: TraxxFall, k: number, x: number, z: number) => { w.pt[k] = [Math.trunc(x * 16), Math.trunc(z * 16)]; };

/* The synthetic worlds of wfltest (World): a cliff, a slope, a lake band; counts bad (unwrapped) callbacks. */
interface World { plateau: number; cliffx: number; floorh: number; slope: boolean; top: number; grade: number; slopex0: number; water: boolean; surf: number; wx0: number; wx1: number; noWaterSource: number; lastSource: number; bad: number; calls: number }
const world = (o: Partial<World> = {}): World => ({ plateau: 0, cliffx: 0, floorh: 0, slope: false, top: 0, grade: 0, slopex0: 0, water: false, surf: 0, wx0: 0, wx1: 0, noWaterSource: 0, lastSource: -1, bad: 0, calls: 0, ...o });
function groundOf(w: World): FallGround {
  const check = (x: number, z: number) => { w.calls++; if (x < 0 || x >= 8192 || z < 0 || z >= 8192) w.bad++; };
  return {
    height: (x, z) => {
      check(x, z);
      if (w.slope) { const h = w.top - w.grade * (x - w.slopex0); return Math.fround(h > w.floorh ? h : w.floorh); }
      return Math.fround(x < w.cliffx ? w.plateau : w.floorh);
    },
    water: (x, z, source) => {
      check(x, z);
      w.lastSource = source;
      if (!w.water || (w.noWaterSource !== 0 && source === w.noWaterSource)) return null;
      if (x < w.wx0 || x >= w.wx1) return null;
      return Math.fround(w.surf);
    },
  };
}

/* Lake 1 on tiles 10..19 x 10..19 (x / z 320..640 ft), height 100 (MakeLake). */
function makeLake(): FallLakes & { lakes: { height: number }[]; tmap: Uint8Array } {
  const tmap = new Uint8Array(65536);
  for (let z = 10; z < 20; z++) for (let x = 10; x < 20; x++) tmap[x + (z << 8)] = 1;
  return { lakes: [{ height: 100 }], tmap };
}
/* Along the east rim, flowing +x (LakeFall). */
function lakeFall(): TraxxFall {
  const w = crest2(640, 400, 640, 480);
  w.source = 1;
  w.height = 7; // ignored: the lake's is used
  return w;
}

test("FallClassicHeightRaw: the engine's integer triangles (TestClassic)", () => {
  const at = (tx: number, tz: number, fx: number, fz: number) => {
    const y0 = [10 * 64, 20 * 64, 30 * 64, 50 * 64]; // c00, c10, c01, c11 = 10, 20, 30, 50 ft
    return fallClassicHeightRaw((cx, cz) => y0[((cx - tx) & 255) + 2 * ((cz - tz) & 255)]!, (tx + fx) * 32.0, (tz + fz) * 32.0);
  };
  near(at(0, 0, 0.75, 0.25), 25.0, 1e-5);
  near(at(0, 0, 0.25, 0.75), 30.0, 1e-5);
  near(at(1, 1, 0.75, 0.25), 25.0, 1e-5);
  near(at(2, 0, 0.25, 0.75), 30.0, 1e-5);
  near(at(1, 0, 0.25, 0.25), 17.5, 1e-5);
  near(at(1, 0, 0.75, 0.75), 37.5, 1e-5);
  near(at(0, 1, 0.25, 0.25), 17.5, 1e-5);
  near(at(0, 1, 0.75, 0.75), 37.5, 1e-5);
  near(at(0, 0, 0.5, 0.5), 30.0, 1e-5);
  near(at(1, 0, 0.5, 0.5), 25.0, 1e-5);
  near(at(0, 0, 0, 0), 10.0, 1e-5);
  near(at(1, 0, 0, 0), 10.0, 1e-5);
  const tile = (tx: number, tz: number, y0: number[]) => (cx: number, cz: number) => y0[((cx - tx) & 255) + 2 * ((cz - tz) & 255)]!;
  near(fallClassicHeightRaw(tile(0, 0, [640, 1280, 1920, 3200]), 24.001, 8.0), 25.0, 1e-5);
  near(fallClassicHeightRaw(tile(255, 0, [640, 1280, 1920, 3200]), -24.0, 8.0), 17.5, 1e-5);
  near(fallClassicHeightRaw(tile(0, 0, [640, 1280, 1920, 3200]), 24.0, 8192.0 + 8.0), 25.0, 1e-5);
  // fmul floors (an arithmetic shift): a drop of 4 units over fx = 1/3 is -1.33, which floors to -2
  near(fallClassicHeightRaw(tile(0, 0, [100, 99, 100, 100]), 32.0 / 3.0, 1.0) * 256.0, 398.0, 1e-4);
});

test("the crest: length, point directions, the world edge, NearCrest (TestGeometry)", () => {
  let w = crest2(1000, 1000, 1000, 1016);
  near(crestLength(w), 16, 1e-4);
  const dirIs = (d: [number, number], x: number, z: number) => { near(d[0], x, 1e-6); near(d[1], z, 1e-6); };
  dirIs(pointDirection(w, 0), 1, 0);
  w.npoints = 3;
  setPt(w, 2, 1016, 1016);
  near(crestLength(w), 32, 1e-4);
  near(pointDirection(w, 1)[0], 0.70710678, 1e-6);
  near(pointDirection(w, 1)[1], -0.70710678, 1e-6);
  dirIs(pointDirection(w, 2), 0, -1);
  w = crest2(8190, 1000, 2, 1000);
  near(crestLength(w), 4, 1e-4);
  dirIs(pointDirection(w, 0), 0, -1);
  near(crestLength(crest2(2, 1000, 8190, 1000)), 4, 1e-4);
  near(crestLength(crest2(1000, 8191, 1000, 3)), 4, 1e-4);
  assert.equal(wrapDiff(10, 131070), 12);
  const f = [crest2(1000, 1000, 1000, 1016)];
  assert.ok(nearCrest(f, 0, 1000, 1008, 1));
  assert.ok(!nearCrest(f, 0, 1005, 1008, 1));
  assert.ok(nearCrest(f, 0, 1005, 1008, 6));
  assert.ok(nearCrest(f, 0, 1000.5, 1017, 1.2));
  assert.ok(!nearCrest(f, 0, 1000, 1020, 1));
  assert.ok(!nearCrest(f, 1, 1000, 1008, 1));
  const g = [crest2(8190, 1000, 2, 1000)];
  assert.ok(nearCrest(g, 0, 1.0, 1000.2, 0.5));
  assert.ok(nearCrest(g, 0, 8191.0, 999.8, 0.5));
  assert.ok(!nearCrest(g, 0, 100.0, 1000.0, 0.5));
  assert.equal(fallNearestToMenu(f, 1003, 1008), 0);
  assert.equal(fallNearestToMenu(f, 1020, 1008), -1);
});

test("a vertical cliff: the column is ballistic until it lands, then rests (TestCliff)", () => {
  const wd = world({ plateau: 100, cliffx: 1000 });
  const g = groundOf(wd);
  let w = crest2(1000, 1000, 1000, 1016);
  const s = buildFallShape(w, 200, g);
  assert.equal(s.ncols, 9);
  near(s.width, 16, 1e-4);
  assert.equal(wd.bad, 0);
  assert.ok(s.warn & FALLWARN_DRY);
  assert.ok(s.vertices > 0);
  let bad = 0, interior = 0;
  for (let k = 0; k < s.ncols; k++) {
    const c = s.col[k]!;
    assert.equal(c.end, FALLEND_GROUND);
    assert.ok(c.n >= 3);
    near(c.p[0]!, 1000, 1e-4); near(c.p[1]!, 100, 1e-4); near(c.p[2]!, 1000 + 2 * k, 1e-4);
    for (let j = 1; j < c.n - 1; j++) {
      const x = c.p[3 * j]!, y = c.p[3 * j + 1]!;
      const steps = (x - 1000.0) / (6.0 / 60.0), kk = Math.floor(steps + 0.5);
      const exact = 100.0 - 16.0 * DT * DT * (kk * kk - kk);
      if (y > 0.5) { interior++; if (Math.abs(steps - kk) > 1e-3 || Math.abs(y - exact) > 0.01) bad++; }
    }
  }
  assert.ok(interior > 100);
  assert.equal(bad, 0);
  const c = s.col[0]!;
  const lx = c.p[3 * (c.n - 1)]!, ly = c.p[3 * (c.n - 1) + 1]!;
  assert.ok(lx > 1015 && lx < 1030);
  near(ly, 0.3, 1e-4);
  assert.ok(c.pathlen > 100 && c.pathlen < 140);
  // a slower fall clings to the cliff longer
  w.speed = 16;
  const s2 = buildFallShape(w, 200, g);
  assert.equal(s2.col[0]!.end, FALLEND_GROUND);
  assert.ok(s2.col[0]!.p[3 * (s2.col[0]!.n - 1)]! < 1005);
  // column counts: 10 ft -> 6 (spacing exactly 2), 10.5 ft -> 7, both ends included
  assert.equal(buildFallShape(crest2(1000, 1000, 1000, 1010), 200, g).ncols, 6);
  w = crest2(1000, 1000, 1000, 1010.5);
  const s3 = buildFallShape(w, 200, g);
  assert.equal(s3.ncols, 7);
  near(s3.col[6]!.p[2]!, 1010.5, 1e-3);
});

test("water ends a column on its surface, with the sink row; the source's own tiles do not (TestWater)", () => {
  const wd = world({ plateau: 100, cliffx: 1000, water: true, surf: 60, wx0: 1005, wx1: 1100 });
  const g = groundOf(wd);
  const w = crest2(1000, 1000, 1000, 1016);
  let s = buildFallShape(w, 200, g);
  assert.equal(s.warn & FALLWARN_DRY, 0);
  for (let k = 0; k < s.ncols; k++) {
    const c = s.col[k]!;
    assert.equal(c.end, FALLEND_WATER);
    assert.equal(s.stat[0]!.rows[k], c.n + 1);
    near(c.p[3 * (c.n - 1) + 1]!, 60, 1e-5);
    assert.ok(c.p[3 * (c.n - 1)]! > 1005);
    assert.ok(c.pathlen > 40 && c.pathlen < 60);
  }
  wd.floorh = 20; wd.surf = 10;
  s = buildFallShape(w, 200, g);
  assert.equal(s.col[0]!.end, FALLEND_GROUND);
  assert.equal(s.stat[0]!.rows[0], s.col[0]!.n);
  wd.surf = 20;
  assert.equal(buildFallShape(w, 200, g).col[0]!.end, FALLEND_GROUND);
  wd.floorh = 0; wd.surf = 60; wd.noWaterSource = 2;
  w.source = 2;
  s = buildFallShape(w, 200, g);
  assert.equal(wd.lastSource, 2);
  assert.equal(s.col[0]!.end, FALLEND_GROUND);
  w.source = 3;
  assert.equal(buildFallShape(w, 200, g).col[0]!.end, FALLEND_WATER);
});

test("a slope drapes the column 0.3 ft over the ground; an endless one hits the step limit (TestSlope)", () => {
  const wd = world({ slope: true, top: 200, grade: 0.5, slopex0: 1000 });
  const g = groundOf(wd);
  const w = crest2(1000, 1000, 1000, 1016);
  let s = buildFallShape(w, 400, g);
  assert.equal(s.ncols, 9);
  let c = s.col[0]!;
  assert.equal(c.end, FALLEND_GROUND);
  let hmin = 1e9, hmax = 0;
  for (let j = 1; j < c.n; j++) {
    const x = c.p[3 * j]!, y = c.p[3 * j + 1]!;
    const h = Math.max(0, 200.0 - 0.5 * (x - 1000.0));
    if (x < 1390) { hmin = Math.min(hmin, y - h); hmax = Math.max(hmax, y - h); }
  }
  near(hmin, 0.3, 0.02); near(hmax, 0.3, 0.02);
  assert.ok(c.p[3 * (c.n - 1)]! > 1380);
  assert.ok(c.pathlen > 440);
  wd.grade = 1; wd.top = 100000; wd.floorh = -1e9;
  s = buildFallShape(w, 200000, g);
  c = s.col[0]!;
  assert.equal(c.end, FALLEND_LIMIT);
  const avg = c.pathlen / (4000 * DT);
  assert.ok(avg > 12 && c.pathlen < 4000 * DT * 35);
});

test("a crest across the world edge: unwrapped points, wrapped callbacks (TestWrap, TestBentCrest)", () => {
  let wd = world();
  let s = buildFallShape(crest2(8190, 1000, 2, 1000), 20, groundOf(wd));
  assert.equal(s.ncols, 3);
  near(s.col[0]!.p[0]!, 8190, 1e-3); near(s.col[1]!.p[0]!, 8192, 1e-3); near(s.col[2]!.p[0]!, 8194, 1e-3);
  assert.ok(s.col[0]!.p[3 * (s.col[0]!.n - 1) + 2]! < 1000);
  assert.equal(wd.bad, 0);
  wd = world();
  s = buildFallShape(crest2(8191, 1000, 8191, 1016), 200, groundOf(wd));
  assert.ok(s.col[0]!.p[3 * (s.col[0]!.n - 1)]! > 8200);
  assert.equal(wd.bad, 0);
  wd = world();
  s = buildFallShape(crest2(1, 1016, 1, 1000), 200, groundOf(wd));
  assert.ok(s.col[0]!.p[3 * (s.col[0]!.n - 1)]! < -5);
  assert.equal(wd.bad, 0);
  // the bent crest: column 8 on the inner point flows along the averaged direction
  const w = crest2(1000, 1000, 1000, 1016);
  w.npoints = 3;
  setPt(w, 2, 1016, 1016);
  s = buildFallShape(w, 20, groundOf(world()));
  assert.equal(s.ncols, 17);
  const c8 = s.col[8]!;
  near(c8.p[0]!, 1000, 1e-3); near(c8.p[2]!, 1016, 1e-3);
  const dx = c8.p[3]! - c8.p[0]!, dz = c8.p[5]! - c8.p[2]!, l = Math.hypot(dx, dz);
  near(dx / l, 0.70710678, 1e-3); near(dz / l, -0.70710678, 1e-3);
  near(s.col[16]!.p[0]!, 1016, 1e-3);
  assert.ok(s.col[16]!.p[5]! - s.col[16]!.p[2]! < -0.3);
});

test("every error code (TestErrors)", () => {
  const L = makeLake();
  const E = (f: TraxxFall[], i: number, lk: FallLakes = L, names: ((k: number, s: string) => boolean) | null = null) => fallErrors(f, i, lk, names);
  assert.equal(E([lakeFall()], 0), 0);
  assert.equal(fallEffectiveHeight([lakeFall()], 0, L.lakes), 100);
  const w = fallDefaults();
  w.npoints = 2; w.height = 200;
  setPt(w, 0, 100, 100); setPt(w, 1, 100, 140);
  assert.equal(E([w], 0), 0);
  assert.equal(fallEffectiveHeight([w], 0, L.lakes), 200);
  const b = (edit: (x: TraxxFall) => void) => { const x = structuredClone(w); edit(x); return x; };
  // POINTS
  const pts = [b((x) => { x.npoints = 1; }), b((x) => { x.npoints = 9; }), b((x) => { setPt(x, 1, 100, 101.5); }), b((x) => { setPt(x, 1, 100, 102); }),
    b((x) => { x.npoints = 3; setPt(x, 1, 100, 140); setPt(x, 2, 100, 140); })];
  assert.ok(E(pts, 0) & FALLERR_POINTS); assert.ok(E(pts, 1) & FALLERR_POINTS); assert.ok(E(pts, 2) & FALLERR_POINTS);
  assert.equal(E(pts, 3), 0); assert.ok(E(pts, 4) & FALLERR_POINTS);
  // TURN: a reversal is refused, a right angle is not
  const turn = [b((x) => { x.npoints = 3; setPt(x, 2, 101, 100); }), b((x) => { x.npoints = 3; setPt(x, 2, 140, 140); }), b((x) => { x.npoints = 3; setPt(x, 2, 140, 160); })];
  assert.ok(E(turn, 0) & FALLERR_TURN); assert.equal(E(turn, 1), 0); assert.equal(E(turn, 2), 0);
  // WIDTH
  const wide = [b((x) => { x.npoints = 3; setPt(x, 1, 100, 600); setPt(x, 2, 100, 1125); }), b((x) => { x.npoints = 3; setPt(x, 1, 100, 600); setPt(x, 2, 100, 1124); })];
  assert.ok(E(wide, 0) & FALLERR_WIDTH); assert.equal(E(wide, 1), 0);
  // COORD
  const coord = [b((x) => { x.pt[1]![0] = 131072; }), b((x) => { x.pt[0]![1] = -1; }), b((x) => { x.pt[1] = [131071, 1600]; x.pt[0] = [131071, 2240]; })];
  assert.ok(E(coord, 0) & FALLERR_COORD); assert.ok(E(coord, 1) & FALLERR_COORD); assert.equal(E(coord, 2) & FALLERR_COORD, 0);
  // SOURCE
  const src = [Object.assign(lakeFall(), { source: 5 }), lakeFall()];
  assert.ok(E(src, 0) & FALLERR_SOURCE); assert.equal(fallEffectiveHeight(src, 0, L.lakes), 0); assert.equal(E(src, 1) & FALLERR_SOURCE, 0);
  // HEIGHT
  const hts = [0, 1, 4096, 4097, -5].map((h) => b((x) => { x.height = h; }));
  assert.ok(E(hts, 0) & FALLERR_HEIGHT); assert.equal(E(hts, 1) & FALLERR_HEIGHT, 0); assert.equal(E(hts, 2) & FALLERR_HEIGHT, 0);
  assert.ok(E(hts, 3) & FALLERR_HEIGHT); assert.ok(E(hts, 4) & FALLERR_HEIGHT);
  const lf = [Object.assign(lakeFall(), { height: 0 })];
  assert.equal(E(lf, 0) & FALLERR_HEIGHT, 0);
  assert.ok(E(lf, 0, { lakes: [{ height: 5000 }], tmap: L.tmap }) & FALLERR_HEIGHT);
  assert.ok(E(lf, 0, { lakes: [{ height: 0 }], tmap: L.tmap }) & FALLERR_HEIGHT);
  // SPEED
  const sp = [15, 16, 1600, 1601].map((v) => b((x) => { x.speed = v; }));
  assert.ok(E(sp, 0) & FALLERR_SPEED); assert.equal(E(sp, 1) & FALLERR_SPEED, 0); assert.equal(E(sp, 2) & FALLERR_SPEED, 0); assert.ok(E(sp, 3) & FALLERR_SPEED);
  // DIRECTION
  const dir = [lakeFall(), Object.assign(crest2(640, 480, 640, 400), { source: 1 }),
    (() => { const x = Object.assign(crest2(640, 400, 640, 480), { source: 1 }); setPt(x, 0, 639.5, 400); setPt(x, 1, 639.5, 480); return x; })(),
    Object.assign(crest2(641, 400, 641, 480), { source: 1 }),
    (() => { const x = Object.assign(crest2(640, 400, 640, 480), { source: 1 }); setPt(x, 0, 640, 300); setPt(x, 1, 640, 400); return x; })()];
  assert.equal(E(dir, 0) & FALLERR_DIRECTION, 0);
  assert.ok(E(dir, 1) & FALLERR_DIRECTION);
  assert.equal(E(dir, 2) & FALLERR_DIRECTION, 0);
  assert.equal(E(dir, 3) & ~FALLERR_NOTCH_SHARED, FALLERR_DIRECTION | FALLERR_NOTCH);
  assert.ok(E(dir, 4) & FALLERR_DIRECTION);
  assert.equal(E([Object.assign(crest2(640, 480, 640, 400), { height: 100 })], 0), 0); // a spring has no direction rule
  assert.ok(E([lakeFall()], 0, { lakes: [{ height: 100 }], tmap: null }) & FALLERR_DIRECTION);
  assert.equal(E([Object.assign(lakeFall(), { source: 0, height: 100 })], 0, { lakes: [{ height: 100 }], tmap: null }), 0);
  L.tmap[19 + (12 << 8)] = 2;
  assert.ok(E([lakeFall()], 0) & FALLERR_DIRECTION);
  L.tmap[19 + (12 << 8)] = 1;
  // NAME
  let calls = [0, 0];
  const nameOk = (kind: number, stem: string) => { calls[kind]!++; return stem === "ROAR" || stem === "EWTF000"; };
  const nm = [b((x) => { x.sound = "ROAR"; x.texture = "EWTF000"; }), b((x) => { x.sound = "NOPE"; x.texture = "EWTF000"; }), b((x) => { x.sound = "ROAR"; x.texture = "NOTEX"; }),
    b((x) => { x.sound = "ABCDEFGHIJKLMNO"; }), b((x) => { x.sound = "ABCDEFGHIJKLMNOP"; }), b((x) => { x.texture = "ABCDEFGHIJKLMNOP"; })];
  assert.equal(E(nm, 0, L, nameOk), 0);
  assert.deepEqual(calls, [1, 1]);
  assert.ok(E(nm, 1, L, nameOk) & FALLERR_NAME); assert.ok(E(nm, 2, L, nameOk) & FALLERR_NAME);
  assert.equal(E(nm, 3) & FALLERR_NAME, 0); assert.ok(E(nm, 3, L, nameOk) & FALLERR_NAME);
  assert.ok(E(nm, 4) & FALLERR_NAME); assert.ok(E(nm, 5) & FALLERR_NAME);
  calls = [0, 0];
  assert.equal(E([w], 0, L, nameOk), 0);
  assert.deepEqual(calls, [0, 0]);
  // COUNT
  const many: TraxxFall[] = [];
  for (let i = 0; i < FALL_MAX_FALLS; i++) assert.equal(fallAdd(many, structuredClone(w)), i);
  assert.equal(fallAdd(many, structuredClone(w)), -1);
  assert.equal(E(many, 63), 0);
  assert.equal(fallErrors(many, 64, L), FALLERR_COUNT);
  for (let bit = 1; bit <= FALLERR_LIP_LOW * 2; bit <<= 1) assert.ok(fallErrorText(bit)); // FALL_ROUGH (0x2000) is the last
  for (let bit = FALLWARN_DRY; bit <= FALLWARN_NOTCH_FLAT; bit <<= 1) assert.ok(fallWarnText(bit));
  assert.equal(fallErrorText(0x4000), "");
});

test("SnapToLip puts the crest on the lake's lip; Orient picks the flow side (TestSnap, TestOrient)", () => {
  const L = makeLake();
  let f = [Object.assign(crest2(650, 400, 650, 470), { source: 1 })];
  assert.ok(fallErrors(f, 0, L) & FALLERR_DIRECTION);
  assert.equal(fallBadPoints(f, 0, L), 3);
  assert.equal(snapToLip(f, 0, L, 48), 2);
  assert.deepEqual(f[0]!.pt.slice(0, 2), [[640 * 16, 400 * 16], [640 * 16, 470 * 16]]);
  assert.equal(fallErrors(f, 0, L), 0);
  assert.equal(snapToLip(f, 0, L, 48), 0);
  f = [Object.assign(crest2(630, 400, 630, 470), { source: 1 })];
  assert.equal(snapToLip(f, 0, L, 48), 2);
  assert.equal(f[0]!.pt[0]![0], 640 * 16);
  f = [Object.assign(crest2(650, 320, 650, 350), { source: 1 })];
  assert.equal(snapToLip(f, 0, L, 48), 2);
  assert.deepEqual(f[0]!.pt[0], [640 * 16, 321 * 16]);
  f = [Object.assign(crest2(700, 400, 700, 480), { source: 1 })];
  assert.equal(snapToLip(f, 0, L, 48), 0);
  assert.equal(snapToLip(f, 0, L, 80), 2);
  f = [Object.assign(crest2(480, 400, 480, 470), { source: 1 })];
  assert.equal(snapToLip(f, 0, L, 48), 0);
  // across the world wrap: lake on tile 0, crest 2 ft west of the map edge
  const W = { lakes: [{ height: 100 }], tmap: new Uint8Array(65536) };
  W.tmap[0] = 1;
  f = [Object.assign(crest2(8190, 20, 8190, 10), { source: 1 })];
  assert.ok(fallErrors(f, 0, W) & FALLERR_DIRECTION);
  assert.equal(snapToLip(f, 0, W, 48), 2);
  assert.deepEqual(f[0]!.pt.slice(0, 2), [[0, 320], [0, 160]]);
  assert.equal(fallErrors(f, 0, W), 0);
  f = [crest2(650, 400, 650, 480)];
  assert.equal(snapToLip(f, 0, L, 48), 0);
  assert.equal(snapToLip(f, 5, L, 48), 0);
  // Reverse and Orient
  const r = crest2(640, 400, 640, 480);
  r.npoints = 3; setPt(r, 2, 640, 500);
  const orig = structuredClone(r);
  fallReverse(r);
  assert.deepEqual(r.pt.slice(0, 3), [orig.pt[2], orig.pt[1], orig.pt[0]]);
  fallReverse(r);
  assert.deepEqual(r, orig);
  f = [lakeFall()];
  fallOrient(f, 0, L, null);
  assert.deepEqual(f[0], lakeFall());
  f = [Object.assign(crest2(640, 480, 640, 400), { source: 1 })];
  fallOrient(f, 0, L, null);
  assert.equal(f[0]!.pt[0]![1], 400 * 16);
  assert.equal(fallErrors(f, 0, L), 0);
  f = [Object.assign(crest2(630, 480, 630, 400), { source: 1 })];
  assert.equal(fallErrors(f, 0, L), FALLERR_NOTCH);
  fallOrient(f, 0, L, null);
  assert.equal(f[0]!.pt[0]![1], 400 * 16);
  for (const flipped of [false, true]) {
    f = [Object.assign(flipped ? crest2(650, 480, 650, 400) : crest2(650, 400, 650, 480), { source: 1 })];
    fallOrient(f, 0, L, null);
    assert.equal(snapToLip(f, 0, L, 48), 2);
    fallOrient(f, 0, L, null);
    assert.equal(fallErrors(f, 0, L), 0);
    assert.ok(f[0]!.pt[0]![1] < f[0]!.pt[1]![1]);
    assert.equal(f[0]!.pt[0]![0], 640 * 16);
  }
  // a spring flows downhill
  const hill: FallGround = { height: (x) => Math.fround(1000 - x), water: null };
  f = [Object.assign(crest2(500, 480, 500, 400), { height: 900 })]; // flows -x: uphill
  fallOrient(f, 0, L, hill);
  assert.equal(f[0]!.pt[0]![1], 400 * 16);
});

/* The notch world of wfltest (NotchWorld): a 6 x 6-tile lake (tiles 102..107, floor byte 10), walls at byte 80, low ground east of vertex 110; the notch tile (108,104). */
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
const notchFall = (x = 3456, z0 = 3329, z1 = 3359) => Object.assign(crest2(x, z0, x, z1), { source: 1, speed: 96 });
const notchTmapLake = (h = NH): FallLakes => {
  const tmap = new Uint8Array(65536);
  for (let z = 102; z < 108; z++) for (let x = 102; x < 108; x++) tmap[NTILE(x, z)] = 1;
  // these tests pin the tile-form notches and the TILE rule's answers (wfltest 5627ad7)
  return { lakes: [{ height: h }], tmap, rule: LAKE_RULE_TILE };
};
const rawGround = (raw: Uint8Array): LakeGround => ({ raw, tilemin: null, groundAtLevel: null });
const rawFallGround = (raw: Uint8Array): FallGround => ({ height: (x, z) => fallClassicHeightRaw((tx, tz) => 128 * raw[(tz & 255) * 256 + (tx & 255)]!, x, z), water: null });

test("the spillway notch: the tile, the lip, the errors and the warnings (TestNotch)", () => {
  let n = buildNotches([notchFall()]);
  assert.equal(n.tiles, 1);
  assert.equal(n.notchlake[NTILE(108, 104)], 1);
  assert.equal(n.lipedges[NTILE(108, 104)], LAKE_LIP_W);
  assert.equal(n.notchfall[NTILE(108, 104)], 1);
  assert.equal(n.notchlake[NTILE(107, 104)], 0);
  n = buildNotches([notchFall(), notchFall(3456, 3335, 3350)]);
  assert.equal(n.tiles, 1);
  assert.equal(buildNotches([Object.assign(notchFall(), { source: 0 })]).tiles, 0);
  const dirs: [TraxxFall, number, number][] = [
    [Object.assign(crest2(3456, 3359, 3456, 3329), { source: 1 }), NTILE(107, 104), LAKE_LIP_E],
    [Object.assign(crest2(3330, 3456, 3358, 3456), { source: 1 }), NTILE(104, 107), LAKE_LIP_S],
    [Object.assign(crest2(3358, 3456, 3330, 3456), { source: 1 }), NTILE(104, 108), LAKE_LIP_N],
  ];
  for (const [w, tile, lip] of dirs) {
    const m = buildNotches([w]);
    assert.equal(m.tiles, 1);
    assert.equal(m.notchlake[tile], 1);
    assert.equal(m.lipedges[tile], lip);
  }
  // the fall's own checks on the stored tile map
  let raw = notchWorld(25, 22);
  const L = notchTmapLake();
  const errs = (f: TraxxFall[], i: number, lk: FallLakes = L) => fallErrors(f, i, lk, null, rawGround(raw));
  const warns = (f: TraxxFall[], i: number, lk: FallLakes = L) => fallNotchWarnings(f, i, lk, rawGround(raw), rawFallGround(raw));
  assert.equal(errs([notchFall()], 0), 0);
  assert.equal(warns([notchFall()], 0).warn, 0);
  assert.ok(errs([notchFall(3453)], 0) & FALLERR_NOTCH);
  raw = notchWorld(24, 22); // a lip corner at H - 1
  assert.ok(errs([notchFall()], 0) & FALLERR_LIP_LOW);
  assert.equal(fallErrors([notchFall()], 0, L) & FALLERR_LIP_LOW, 0);
  assert.equal(warns([notchFall()], 0).warn, 0);
  raw = notchWorld(25, 22);
  const two = [notchFall(), notchFall(3456, 3335, 3350)];
  assert.ok(errs(two, 0) & FALLERR_NOTCH_SHARED);
  assert.ok(errs(two, 1) & FALLERR_NOTCH_SHARED);
  const M = notchTmapLake();
  M.tmap![NTILE(108, 104)] = 1;
  assert.ok(errs([notchFall()], 0, M) & FALLERR_NOTCH);
  // LIP_HIGH names the climb
  raw = notchWorld(26, 22);
  let r = warns([notchFall()], 0);
  assert.equal(errs([notchFall()], 0), 0);
  assert.ok(r.warn & FALLWARN_LIP_HIGH);
  assert.equal(r.info.climb, 4);
  assert.ok(!r.info.hint4);
  let text = fallNotchWarnText(FALLWARN_LIP_HIGH, r.info);
  assert.ok(text.includes("climbs 4 water units (2 ft)") && !text.includes("multiple of 4"));
  raw = notchWorld(25, 22);
  r = warns([notchFall()], 0, notchTmapLake(98));
  assert.ok(r.warn & FALLWARN_LIP_HIGH);
  assert.equal(r.info.climb, 2);
  assert.ok(r.info.hint4);
  text = fallNotchWarnText(FALLWARN_LIP_HIGH, r.info);
  assert.ok(text.includes("climbs 2 water units (1 ft)") && text.includes("not a multiple of 4") && text.includes("set it to a multiple of 4"));
  // NOTCH_FLAT: lip == far warns, one step below (3.6 degrees) warns, two steps (7.1) is clean
  raw = notchWorld(25, 25);
  assert.ok(warns([notchFall()], 0).warn & FALLWARN_NOTCH_FLAT);
  raw = notchWorld(25, 24);
  r = warns([notchFall()], 0);
  assert.ok(r.warn & FALLWARN_NOTCH_FLAT);
  assert.ok(r.info.flatdeg > 3 && r.info.flatdeg < 4.5);
  raw = notchWorld(25, 23);
  assert.equal(warns([notchFall()], 0).warn & FALLWARN_NOTCH_FLAT, 0);
  // LIP_UNCOVERED: half the lip edge warns, the whole edge does not
  raw = notchWorld(25, 22);
  assert.equal(errs([notchFall(3456, 3329, 3345)], 0), 0);
  assert.ok(warns([notchFall(3456, 3329, 3345)], 0).warn & FALLWARN_LIP_UNCOVERED);
  assert.equal(warns([notchFall()], 0).warn & FALLWARN_LIP_UNCOVERED, 0);
});

/* A hand-made shape for the budget (HandShape): `width` ft of crest, every column `pathlen` ft of path. */
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

test("the vertex budget: coarsen, shorten, foam, the track in file order, drop (TestBudget, Traxx 1.7.2's 32768 cap)", () => {
  // fits at 2 ft: 513 columns * (25 + 1 rows)
  let s = [handShape(1024, 50)];
  s[0]!.warn = FALLWARN_DRY;
  let total = fallBudget(s);
  assert.equal(s[0]!.vertices, 513 * 26);
  assert.equal(total, 513 * 26);
  assert.equal(s[0]!.spacing, 2);
  assert.equal(s[0]!.warn, FALLWARN_DRY);
  // coarsened: 513 * 76 = 38988 at 2 ft (the cap is 32768, handover 4.6); at 3 ft 343 columns * 51 rows
  s = [handShape(1024, 150)];
  total = fallBudget(s);
  assert.equal(s[0]!.spacing, 3);
  assert.equal(s[0]!.vertices, 343 * 51);
  assert.ok(s[0]!.warn & FALLWARN_COARSE);
  assert.equal(s[0]!.warn & (FALLWARN_SHORTENED | FALLWARN_DROPPED), 0);
  assert.equal(total, 343 * 51);
  // 6 ft reached: 4 ft is 257 * 151 = 38807 (over), 6 ft 172 * 101
  s = [handShape(1024, 600)];
  fallBudget(s);
  assert.equal(s[0]!.spacing, 6);
  assert.equal(s[0]!.vertices, 172 * 101);
  // shortened: even 8 ft needs 129 * 501; cut to 129 * 254 = 32766
  s = [handShape(1024, 4000)];
  total = fallBudget(s);
  assert.equal(s[0]!.spacing, 8);
  assert.ok(s[0]!.warn & FALLWARN_SHORTENED && s[0]!.warn & FALLWARN_COARSE);
  assert.equal(s[0]!.vertices, 129 * 254);
  assert.equal(total, 129 * 254);
  s = [handShape(1024, 50, FALLEND_WATER)];
  fallBudget(s);
  assert.equal(s[0]!.vertices, 513 * 26 + 3 * 513);
  assert.equal(s[0]!.warn & FALLWARN_DRY, 0);
  s = [handShape(10, 20)];
  s[0]!.stat[0]!.endk[2] = FALLEND_WATER;
  s[0]!.stat[0]!.endk[4] = FALLEND_WATER;
  fallBudget(s);
  assert.equal(s[0]!.vertices, 66);
  s[0]!.stat[0]!.endk[3] = FALLEND_WATER;
  fallBudget(s);
  assert.equal(s[0]!.vertices, 66 + 9);
  // the sink row: every column cut short (its rows exceed R) is no foam
  s = [handShape(1024, 4000, FALLEND_WATER)];
  for (let j = 0; j < FALL_NSPACINGS; j++) for (let k = 0; k < s[0]!.stat[j]!.ncols; k++) s[0]!.stat[j]!.rows[k]++;
  fallBudget(s);
  assert.ok(s[0]!.spacing === 8 && (s[0]!.warn & FALLWARN_SHORTENED) !== 0);
  assert.equal(s[0]!.vertices, 129 * 254);
  s = [emptyFallShape()];
  assert.equal(fallBudget(s), 0);
  assert.equal(s[0]!.warn, 0);
  // the track in file order: min(32768, 262144 - used) each
  const many = Array.from({ length: 23 }, () => handShape(1024, 50));
  total = fallBudget(many.slice(0, 20));
  assert.equal(total, 19 * 513 * 26 + 6174);
  for (let k = 0; k < 19; k++) assert.equal(many[k]!.warn & (FALLWARN_DROPPED | FALLWARN_COARSE), 0);
  assert.ok(many[19]!.spacing === 3 && many[19]!.vertices === 6174 && (many[19]!.warn & FALLWARN_COARSE) !== 0);
  total = fallBudget(many);
  assert.ok(many[20]!.spacing === 6 && many[20]!.vertices === 1720);
  assert.ok(many[21]!.spacing === 8 && many[21]!.vertices === 129 * 6 && (many[21]!.warn & FALLWARN_SHORTENED) !== 0);
  assert.equal(total, 19 * 513 * 26 + 6174 + 1720 + 774);
  assert.ok(many[22]!.warn & FALLWARN_DROPPED);
  assert.equal(many[22]!.vertices, 513 * 26);
  many[22] = handShape(10, 20);
  total = fallBudget(many);
  assert.equal(many[22]!.warn & FALLWARN_DROPPED, 0);
  assert.ok(many[22]!.vertices > 0 && many[22]!.vertices <= 54);
  assert.equal(total, 19 * 513 * 26 + 6174 + 1720 + 774 + many[22]!.vertices);
  // a re-run clears stale bits
  many[0]!.warn |= FALLWARN_DROPPED | FALLWARN_COARSE;
  fallBudget(many.slice(0, 1));
  assert.equal(many[0]!.warn & (FALLWARN_DROPPED | FALLWARN_COARSE), 0);
});

/* The mist boxes (TestMist, TestMistStreams, ...) are in falls-173.test.ts. */

test(".WFL: the effective height, v1.0 unless a mist size is set, and back (TestWFL, TestWFLMistSize)", () => {
  const L = makeLake();
  const spring = fallDefaults();
  spring.npoints = 2; spring.height = 200; spring.sound = "ROAR"; spring.texture = "EWTF000";
  setPt(spring, 0, 100, 100); setPt(spring, 1, 100, 140);
  const falls = [lakeFall(), spring];
  const img = buildWfl(falls, L)!;
  assert.ok(img);
  assert.equal(img.length, 32 + 16 + 8 + 2 * 128);
  const back = parseWfl(img);
  assert.equal(back.minor, 0);
  assert.equal(back.falls[0]!.height, 100); // the lake's, not the fall's 7
  assert.equal(back.falls[1]!.soundName, "ROAR");
  const parsed = parseWflFalls(img)!;
  assert.equal(parsed[0]!.height, 100);
  assert.deepEqual(parsed[1], spring);
  falls[1]!.mistheight = 30;
  const v11 = buildWfl(falls, L)!;
  assert.equal(parseWfl(v11).minor, 1);
  assert.equal(v11.length, 32 + 16 + 8 + 2 * 132);
  falls[1]!.mistheight = 0; // 0 means 100: still v1.0
  assert.equal(parseWfl(buildWfl(falls, L)!).minor, 0);
  falls[1]!.speed = 1;
  assert.equal(buildWfl(falls, L), null, "a fall in error writes no .WFL");
  assert.equal(buildWfl([], L), null);
  assert.equal(parseWflFalls(new Uint8Array(10)), null);
});

test("the list: LakeDeleted, FallsOnLake, the derived height (TestList)", () => {
  const a = Object.assign(lakeFall(), { source: 1 }), b = Object.assign(lakeFall(), { source: 2 }), c = Object.assign(lakeFall(), { source: 3 });
  const falls = [a, b, c];
  assert.equal(fallsOnLake(falls, 1), 1);
  fallsLakeDeleted(falls, 1, 333);
  assert.deepEqual(falls.map((f) => [f.source, f.height]), [[1, 7], [0, 333], [2, 7]]);
  assert.equal(fallEffectiveHeight(falls, 1, [{ height: 1 }, { height: 2 }]), 333);
  assert.equal(fallEffectiveHeight(falls, 2, [{ height: 1 }, { height: 2 }]), 2);
  assert.equal(fallEffectiveHeight(falls, 5, []), 0);
});

test("FallPickSource: the highest lake within 48 ft, the nearer on equal heights", () => {
  const L = makeLake();
  const tmap = L.tmap;
  for (let z = 10; z < 20; z++) for (let x = 22; x < 30; x++) tmap[x + (z << 8)] = 2;
  const lakes = { lakes: [{ height: 100 }, { height: 50 }], tmap };
  // between the two lakes (x 640..704): the upper one
  assert.deepEqual(fallPickSource(lakes, [[660 * 16, 400 * 16], [660 * 16, 470 * 16]], 2), { source: 1, height: 100 });
  lakes.lakes[1]!.height = 150;
  assert.deepEqual(fallPickSource(lakes, [[660 * 16, 400 * 16], [660 * 16, 470 * 16]], 2), { source: 2, height: 150 });
  assert.deepEqual(fallPickSource(lakes, [[2000 * 16, 400 * 16], [2000 * 16, 470 * 16]], 2), { source: 0, height: 0 });
});

test("the view's helpers: the shape cache, the preview list, the shift, the strip rows", () => {
  const t = resetTrack();
  t.heights.fill(50);
  t.falls = [Object.assign(crest2(1000, 1000, 1000, 1016), { height: 300 })];
  const cache = new FallShapeCache();
  cache.ensure(t, () => null, null, () => buildLakeGround(t));
  assert.equal(cache.shapes.length, 1);
  assert.equal(cache.errors[0], 0);
  assert.ok(cache.shapes[0]!.ncols === 9 && cache.trackVerts > 0);
  const first = cache.shapes[0];
  t.falls[0]!.opacity = 40; // the look only: the shapes stand
  cache.ensure(t, () => null, null, () => null);
  assert.equal(cache.shapes[0], first);
  t.falls[0]!.speed = 200; // the shape
  cache.ensure(t, () => null, null, () => null);
  assert.notEqual(cache.shapes[0], first);
  const list = fallPreviewList(t, cache, { height: () => 100, water: null }, 0, [[16000, 16000], [16000, 16320]]);
  assert.equal(list.length, 2);
  assert.equal(list[0]!.style, 2);
  near(list[0]!.py[0]!, 150, 1e-6);
  assert.ok(list[1]!.arrowsAll && list[1]!.style === 2);
  near(list[1]!.py[0]!, 101, 1e-6);
  assert.deepEqual(fallViewShift(8000, 100, 3, 128), [-8192, 0]);
  assert.deepEqual(fallViewShift(100, 100, 128, 128), [0, 0]);
  assert.equal(fallStripRows(500, 300).length, 200);
  assert.deepEqual(fallStripRows(3, 2), [[0, 0], [1, 1], [2, 1]]);
});

test("the Waterfall window's rules: speed, percents, spins, stems, sources, read-outs", () => {
  const w = fallDefaults();
  w.npoints = 2; w.height = 20;
  setPt(w, 0, 100, 100); setPt(w, 1, 100, 140);
  assert.ok(applyFallSpeedText(w, "200"));
  assert.equal(w.speed, 1600);
  assert.ok(!liveFallSpeed(w, "."));
  assert.ok(liveFallSpeed(w, "6.5"));
  assert.equal(w.speed, 104);
  stepFallSpeed(w, 1);
  assert.equal(w.speed, 128);
  assert.ok(liveFallHeight(w, "12.25"));
  assert.equal(w.height, 25);
  assert.ok(applyFallPercent(w, "opacity", "150"));
  assert.equal(w.opacity, 100);
  assert.ok(applyFallPercent(w, "mistdepth", "0"));
  assert.equal(w.mistdepth, 1);
  stepFallMist(w, "mistheight", 1);
  assert.equal(w.mistheight, 105);
  assert.deepEqual(fallTextureStem("ART\\ewtf000.raw"), { stem: "EWTF000" });
  assert.ok("error" in fallTextureStem("ART\\ABCDEFGHIJKLMNOP.RAW"));
  assert.equal(spaced(262144), "262 144");
  assert.equal(spaced(16384), "16 384");
  assert.deepEqual(fallSourceOptions([{ height: 100 }], Object.assign(fallDefaults(), { source: 3 })).map((o) => o.label), ["None (a spring)", "Lake 1 (50 ft)", "Lake 3 (missing)"]);
  const r = fallReadouts({ falls: [w], index: 0, lakes: { lakes: [], tmap: null }, names: null, lip: null, ground: null, vertices: 3120, shapeWarn: FALLWARN_DRY, trackVerts: 3120, loopingObjects: 30 });
  assert.equal(r.points, "Crest: 2 points, 40 ft wide");
  assert.equal(r.verts, "Vertices: 3 120 of 32 768 (track 3 120 of 262 144)");
  // Traxx 1.7.2: an empty sound stem takes no looping sound
  assert.equal(r.loops, "Looping sounds: 30 of 30 (30 objects + 0 waterfalls)");
  assert.deepEqual(r.problems, ["Warning: The water lands on dry ground: no foam strip or landing rings (mist and droplets still appear)"]);
  // with a stem it takes one, and the over-30 line names no fall
  w.sound = "ROAR";
  const r2 = fallReadouts({ falls: [w], index: 0, lakes: { lakes: [], tmap: null }, names: null, lip: null, ground: null, vertices: 3120, shapeWarn: 0, trackVerts: 3120, loopingObjects: 30 });
  assert.equal(r2.loops, "Looping sounds: 31 of 30 (30 objects + 1 waterfall)");
  assert.deepEqual(r2.problems, ["Warning: 31 looping sounds of 30: some falls will be silent (the engine keeps the ones nearest the start)"]);
  // a fall with errors takes none, is not counted in the vertices and shows no shape warning
  w.speed = 1;
  const r3 = fallReadouts({ falls: [w], index: 0, lakes: { lakes: [], tmap: null }, names: null, lip: null, ground: null, vertices: 3120, shapeWarn: FALLWARN_DRY, trackVerts: 0, loopingObjects: 30, uncounted: true });
  assert.equal(r3.verts, "Vertices: 3 120 (not counted: the fall has errors) (track 0 of 262 144)");
  assert.equal(r3.loops, "Looping sounds: 30 of 30 (30 objects + 0 waterfalls)");
  assert.deepEqual(r3.problems, ["Error: The flow speed is outside 1..100 ft/s"]);
});

test("Write POD: a fall in error refuses the export, a good one packs a .WFL, its .KLP and waterfalls=<n>", () => {
  const doc = newTrackDocument();
  const t = doc.track;
  t.heights.fill(50);
  t.falls = [Object.assign(crest2(1000, 1000, 1000, 1016), { height: 300, sound: "ROAR" })];
  t.sounds.push({ name: "SOUND\\ROAR.WAV", flags: 0, data: new Uint8Array([82, 73, 70, 70]) });
  assert.equal(podRefusal(doc), null);
  const out = buildTrackPod(doc);
  const wfl = out.entries.find((e) => e.name === `WORLD\\${t.prefix}.WFL`);
  assert.ok(wfl);
  assert.equal(parseWfl(wfl.data).falls[0]!.soundName, "ROAR");
  const names = out.entries.map((e) => e.name);
  assert.ok(names.indexOf("SOUND\\ROAR.KLP") >= 0 && names.indexOf("SOUND\\ROAR.KLP") === names.indexOf("SOUND\\ROAR.WAV") - 1);
  const txv = new TextDecoder().decode(out.entries.find((e) => e.name.endsWith(".TXV"))!.data);
  assert.match(txv, /waterfalls=1\r\n/);
  t.falls[0]!.speed = 1;
  const refusal = podRefusal(doc)!;
  assert.equal(refusal.title, "Waterfalls need fixing");
  assert.equal(refusal.text, "Waterfall 1: The flow speed is outside 1..100 ft/s\n\nNothing was written.");
  const bad = buildTrackPod(doc);
  assert.ok(!bad.entries.some((e) => e.name.endsWith(".WFL")));
  assert.ok(bad.warnings.some((w) => w.includes("WITHOUT its waterfalls")));
  assert.ok(!bad.entries.some((e) => e.name === "SOUND\\ROAR.KLP"));
});

test("TXX V18: written only with falls, every field and the mist size, read back", () => {
  const t = resetTrack();
  assert.equal(txxVersionFor(t), 2);
  const w = Object.assign(crest2(1000, 1000, 1000, 1016), { mistdepth: 150, mistheight: 30, sound: "ROAR" });
  t.falls = [w];
  assert.equal(txxVersionFor(t), 18);
  const bytes = writeTxx(t);
  const back = readTxx(bytes);
  assert.equal(back.version, 18);
  assert.deepEqual(back.falls, [w]);
  assert.ok(Buffer.from(writeTxx(back)).equals(Buffer.from(bytes)));
});

// ---- The 0.53 sandbox: Traxx 1.7.1's own fog_test.pod and fog_test.txx.
const CP4_053 = process.env.JSTRAXX_CP4_053 ?? join(process.env.HOME ?? "", "games", "cp4sandbox053");
const TXX053 = join(CP4_053, "fog_test.txx"), POD053 = join(CP4_053, "fog_test.pod");
const no053 = existsSync(TXX053) && existsSync(POD053) ? false : "no cp4sandbox053 fog_test";

test("0.53 sandbox: fog_test.txx's falls build the pod's WORLD\\FOGTEST.WFL byte for byte", { skip: no053 }, () => {
  const t = readTxx(new Uint8Array(readFileSync(TXX053)));
  assert.equal(t.version, 18);
  assert.equal(t.falls.length, 2);
  const pod = new Uint8Array(readFileSync(POD053));
  const theirs = readPodEntry(pod, findPodEntry(parsePod(pod), "WORLD\\FOGTEST.WFL")!);
  const st = trackLakes(t);
  const mine = buildWfl(t.falls, { lakes: t.lakes, tmap: st.tmap });
  assert.ok(mine, `errors ${t.falls.map((_, i) => fallErrors(t.falls, i, { lakes: t.lakes, tmap: st.tmap }))}`);
  assert.ok(Buffer.from(mine).equals(Buffer.from(theirs)), "WFL differs");
  // and the pod's .WFL reads back to the same falls, the lake-fed one at its lake's height
  const back = parseWflFalls(theirs)!;
  assert.equal(back[0]!.source, 2);
  assert.equal(back[0]!.height, t.lakes[1]!.height);
  assert.deepEqual(back[1], t.falls[1]);
});

test("0.53 sandbox: the lakes rebuilt with the falls' notches give the pod's .WTR byte for byte", { skip: no053 }, () => {
  const t = readTxx(new Uint8Array(readFileSync(TXX053)));
  const pod = new Uint8Array(readFileSync(POD053));
  const theirs = readPodEntry(pod, findPodEntry(parsePod(pod), "WORLD\\FOGTEST.WTR")!);
  // Traxx 1.7.1 filled them under the tile rule: the same rule gives its file byte for byte
  t.lakeRule = LAKE_RULE_TILE;
  let st = trackLakes(t);
  assert.ok(st.notches, "the lake-fed fall cuts a notch");
  let mine = buildWtr(t.lakes, st);
  assert.ok(mine, `errors ${st.lakes.map((l) => l.errors)}`);
  assert.ok(Buffer.from(mine).equals(Buffer.from(theirs)), "WTR differs");
  // Traxx 1.7.3's edge rule (the notch EDGES) fills the same tiles: only the header's rule differs
  t.lakeRule = undefined;
  st = trackLakes(t);
  assert.equal(st.notches!.edges.length, 3);
  mine = buildWtr(t.lakes, st);
  assert.ok(mine && Buffer.from(mine).equals(Buffer.from(asEdgeRuleWtr(theirs))), "edge-rule WTR differs");
  // without the notches the lake fed by the fall leaks (the notch is what holds it)
  const plain = recomputeLakes(buildLakeGround(t), t.lakes, t.waterLevel4);
  assert.notEqual(plain.lakes[1]!.errors, 0);
});

test("0.53 sandbox: the TXX V18 round trip keeps every field; the falls block goes out as Traxx 1.7.3's version 3", { skip: no053 }, () => {
  const bytes = new Uint8Array(readFileSync(TXX053));
  const t = readTxx(bytes);
  const out = writeTxx(t);
  // version 3 is version 2 with an i32 roughfrom (0) after each fall's mist height
  assert.equal(out.length, bytes.length + 4 * t.falls.length);
  assert.deepEqual(readTxx(out).falls, t.falls);
  assert.ok(Buffer.from(writeTxx(readTxx(out))).equals(Buffer.from(out)));
});

test("0.53 sandbox: fog_test.txx writes the entries of the pod Traxx 1.7.1 wrote, the .WFL and .WTR among them", { skip: no053 }, async () => {
  const bytes = new Uint8Array(readFileSync(POD053));
  const archive = parsePod(bytes);
  const byTitle = (folder: string) => async (path: string) => {
    const e = seekToItem(archive.entries, `${folder}\\${path}`) ?? seekToItem(archive.entries, path);
    return e ? readPodEntry(bytes, e) : null;
  };
  const doc = await openTxx(new Uint8Array(readFileSync(TXX053)), "fog_test.txx", { art: byTitle("ART"), model: byTitle("MODELS") });
  const out = buildTrackPod(doc);
  const differ: string[] = [];
  let compared = 0;
  for (const e of archive.entries) {
    const name = e.name.replace(/\.SI2$/, ".SIT");
    const mine = out.entries.find((x) => x.name === name);
    if (!mine || e.name.endsWith(".TXV")) continue;
    // Traxx 1.7.3 writes only edge-rule .WTR files (the same fill here): minor 1, header flags bit 0
    const theirs = name.endsWith(".WTR") ? asEdgeRuleWtr(readPodEntry(bytes, e)) : readPodEntry(bytes, e);
    if (!Buffer.from(mine.data).equals(Buffer.from(theirs))) differ.push(e.name);
    compared++;
  }
  assert.deepEqual(differ, []);
  assert.ok(compared > 30, `${compared} entries`);
  for (const n of ["WORLD\\FOGTEST.WFL", "WORLD\\FOGTEST.WTR"]) assert.ok(out.entries.some((e) => e.name === n), n);
  // the .WFL right after the .WTR, as Traxx packs them
  const names = out.entries.map((e) => e.name);
  assert.equal(names.indexOf("WORLD\\FOGTEST.WFL"), names.indexOf("WORLD\\FOGTEST.WTR") + 1);
  const txv = new TextDecoder().decode(out.entries.find((e) => e.name.endsWith(".TXV"))!.data);
  assert.match(txv, /vegClumps=131072\r\nwaterfalls=2\r\n/);
});

test("0.53 sandbox: fog_test.pod opens with its falls, its lakes match their stored map, and both go back out", { skip: no053 }, async () => {
  const bytes = new Uint8Array(readFileSync(POD053));
  const archive = parsePod(bytes);
  const doc = await loadPodTrack({ archive, read: async (e) => readPodEntry(bytes, e) }, 0, "fog_test.pod");
  assert.equal(doc.track.falls.length, 2);
  assert.equal(doc.track.lakes.length, 2);
  assert.ok(!doc.warnings.some((w) => w.includes("lakes")), doc.warnings.join("; "));
  const out = buildTrackPod(doc);
  assert.equal(doc.track.lakeRule, LAKE_RULE_TILE, "a Traxx 1.7.1 file is shown under the tile rule");
  for (const name of ["WORLD\\FOGTEST.WFL", "WORLD\\FOGTEST.WTR"]) {
    const raw = readPodEntry(bytes, archive.entries.find((e) => e.name === name)!);
    const theirs = name.endsWith(".WTR") ? asEdgeRuleWtr(raw) : raw;
    assert.ok(Buffer.from(out.entries.find((e) => e.name === name)!.data).equals(Buffer.from(theirs)), name);
  }
});

/** A Traxx 1.7 / 1.7.1 (tile rule) .WTR as Traxx 1.7.3 writes the same lakes: minor 1, header flags bit 0. */
function asEdgeRuleWtr(b: Uint8Array): Uint8Array {
  const out = b.slice();
  out[6] = 1; out[7] = 0;
  out[20] |= 1;
  return out;
}
