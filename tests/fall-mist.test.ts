/*
  Traxx 1.8.0's waterfall mist as engine fog volumes (src/core/traxx/fall-mist.ts), with every check
  of TestMistFog in Traxx's tools/wfltest.cpp (added in 35b087b; MistFog, the Freeze mask, the
  waterfallMist scale, the density cap, MistRegistered), then the slot plan of
  TraxxViewFalls.cpp / TraxxViewDisplay.cpp and MistLandings (13507dc).
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyFallShape, fallDefaults, FALLEND_GROUND, FALLEND_WATER, FALLERR_NAME, FALLFLAG_FREEZE, FALLWARN_DROPPED,
  type FallColumn, type FallGround, type FallShape, type TraxxFall,
} from "../src/core/traxx/falls.ts";
import {
  mistDrawPlan, mistFog, mistFogFromStreams, mistFogId, mistFogParams, mistLandings, mistRegistered, mistStreamStats, type MistFogVol,
} from "../src/core/traxx/fall-mist.ts";
import { engineFogSlotOverflow } from "../src/core/view/engine-fog.ts";

let checks = 0;
const check = (cond: boolean, what = "") => { checks++; assert.ok(cond, what); };
/* wfltest's NEARV. */
const nearv = (got: number, want: number, tol: number, what = "") => { checks++; assert.ok(Math.abs(got - want) <= tol, `${what} ${got} != ${want} (+-${tol})`); };

/* Crest2: a straight crest of two points, in feet (wfltest.cpp). */
function crest2(x0: number, z0: number, x1: number, z1: number): TraxxFall {
  const w = fallDefaults();
  w.npoints = 2;
  w.pt[0] = [Math.trunc(x0 * 16), Math.trunc(z0 * 16)];
  w.pt[1] = [Math.trunc(x1 * 16), Math.trunc(z1 * 16)];
  w.height = 200;
  return w;
}

/* The hand world at its reset (HandWorldReset): flat 0 ft under a 10 ft water plane. */
const handGround = (): FallGround => ({ height: () => 0, water: () => Math.fround(10.0) });

/* MistShape5: five 2-row columns; 0, 1, 2 and 4 end in water, 3 on ground; the row before is (sx, sz) back and 10 ft higher. */
function mistShape5(sx: number, sz: number): FallShape {
  const lx = [100, 102, 104, 106, 108], ly = [60, 60, 50, 30, 40], lz = [200, 201, 202, 203, 204];
  const s = emptyFallShape();
  s.col = lx.map((_, k): FallColumn => ({
    n: 2, p: Float32Array.of(lx[k]! - sx, ly[k]! + 10, lz[k]! - sz, lx[k]!, ly[k]!, lz[k]!), end: k === 3 ? FALLEND_GROUND : FALLEND_WATER, pathlen: 0, land: 0,
  }));
  s.ncols = 5;
  s.spacing = 2;
  return s;
}

/*
  TestMistFog: worked by hand from the formulas. Crest 20 ft, speed 96/16 = 6 ft/s, height 200 raw
  (crest y 100 ft), the two streams of MistShape5 flowing along +X. Stream 0 = columns 0..2 (land y
  60, 60, 50; z 200..202): drop 43.3333, 3 of 4 landing columns (share 0.75); stream 1 = column 4
  (y 40, z 204): drop 60, 1 of 4 (share 0.25).
*/
test("MistFog: the engine's fog volume per landing (TestMistFog)", () => {
  const s = mistShape5(5, 0);
  const g = handGround();
  let w = crest2(1000, 1000, 1000, 1020);
  w.speed = 96;
  w.mist = 80;
  w.mistdepth = 200;
  w.mistheight = 150;
  w.flags = 0;

  // the stream measures MistFog takes from MistVolumes
  const st = mistStreamStats(w, 200, s, g);
  assert.deepEqual(st.columns, [3, 1]);
  assert.ok(Math.abs(st.dropft[0]! - 43.33333) < 1e-4 && st.dropft[1] === 60);

  // mist 80 %, scale 100: stream 0 d = 0.541667 * 0.8 = 0.433333 (vis 276.923); stream 1 d = 0.25 * 0.8 = 0.2 (vis 600)
  let v: MistFogVol[] = mistFog(w, 200, s, g, 100);
  check(v.length === 2);
  if (v.length === 2) {
    const [a, b] = v as [MistFogVol, MistFogVol];
    nearv(a.density, 0.433333, 1e-5);
    nearv(a.vis, 276.923, 5e-3);
    nearv(a.W, 12.33333, 1e-4);
    nearv(a.L, 52.0, 1e-4); // 26 * 200 %
    nearv(a.H, 45.5, 1e-4); // 30.3333 * 150 %
    nearv(a.half, 22.75, 1e-4);
    nearv(a.x, 102.0 + 0.3 * 52.0, 1e-3);
    nearv(a.z, 201.0, 1e-3);
    nearv(a.floorY, 54.66667, 1e-3);
    nearv(a.axZx, 1.0, 1e-6);
    nearv(a.axZz, 0.0, 1e-6);
    nearv(a.axXx, 0.0, 1e-6); // axX = (-fz, fx)
    nearv(a.axXz, 1.0, 1e-6);
    nearv(b.density, 0.2, 1e-6);
    nearv(b.vis, 600.0, 1e-3);
    nearv(b.W, 12.0, 1e-4);
    nearv(b.L, 72.0, 1e-4);
    nearv(b.H, 63.0, 1e-4);
    nearv(b.half, 31.5, 1e-4);
    nearv(b.x, 108.0 + 0.3 * 72.0, 1e-3);
    nearv(b.z, 204.0, 1e-3);
    nearv(b.floorY, 38.0, 1e-4);
    check(a.stream === 0 && b.stream === 1 && a.nstreams === 2);
    // fogPropDefaults' fields and the engine's own
    nearv(a.r, 0.75, 1e-6); nearv(a.g, 0.78, 1e-6); nearv(a.b, 0.82, 1e-6);
    nearv(a.edge, 20.0, 0); nearv(a.top, 5.0, 0); nearv(a.maxop, 1.0, 0); nearv(a.bot, 0.0, 0);
    nearv(a.round, 1.0, 0); nearv(a.wisp, 0.6, 1e-6); nearv(a.wsize, 25.0, 0); nearv(a.wspeed, 2.0, 0);
    check(a.wmask === 511 && b.wmask === 511);
  }

  // the freeze flag takes the snow weather (WEATHER_SNOW = 5) out of the mask: 511 - 32 = 479
  w.flags = FALLFLAG_FREEZE;
  v = mistFog(w, 200, s, g, 100);
  check(v.length === 2 && v[0]!.wmask === 479 && v[1]!.wmask === 479);

  // the player's waterfallMist scale (50 %): d0 = 0.541667 * 0.8 * 0.5 = 0.216667 (vis 553.846); d1 = 0.25 * 0.8 * 0.5 = 0.1 (vis 1000, clamped)
  v = mistFog(w, 200, s, g, 50);
  check(v.length === 2);
  if (v.length === 2) {
    nearv(v[0]!.density, 0.216667, 1e-5);
    nearv(v[0]!.vis, 553.846, 5e-3);
    nearv(v[1]!.density, 0.1, 1e-6);
    nearv(v[1]!.vis, 1000.0, 0);
  }

  // density above the cap: a 100 ft crest, d = clamp(100 * 6 * 43.3 / 7200 * 0.75) = 2 (vis 60), stream 1 unclamped 1.25 (vis 96)
  w = crest2(1000, 1000, 1000, 1100);
  w.speed = 96;
  w.mist = 100;
  w.flags = 0;
  v = mistFog(w, 200, s, g, 100);
  check(v.length === 2);
  if (v.length === 2) {
    nearv(v[0]!.density, 2.0, 1e-6);
    nearv(v[0]!.vis, 60.0, 1e-4);
    nearv(v[1]!.density, 1.25, 1e-5); // 100 * 6 * 60 / 7200 * 0.25 = 1.25
    nearv(v[1]!.vis, 96.0, 1e-4);
  }

  // MistRegistered, the rule MistLandings shares: errors, mist 0, under 2 columns and DROPPED register nothing
  w.mist = 100;
  check(mistRegistered(w, 0, s));
  check(!mistRegistered(w, FALLERR_NAME, s));
  s.warn |= FALLWARN_DROPPED;
  check(!mistRegistered(w, 0, s));
  s.warn &= ~FALLWARN_DROPPED;
  s.ncols = 1;
  check(!mistRegistered(w, 0, s));
  s.ncols = 5;

  // mist 0: the engine registers nothing
  w.mist = 0;
  check(!mistRegistered(w, 0, s));
  check(mistFog(w, 200, s, g, 100).length === 0);

  // TestMistFog's own count: 53 checks
  assert.equal(checks, 53);
});

test("a stream whose density is 0 takes no slot (scale 0)", () => {
  const w = crest2(1000, 1000, 1000, 1020);
  w.speed = 96;
  assert.equal(mistFog(w, 200, mistShape5(5, 0), handGround(), 0).length, 0);
  assert.equal(mistFogFromStreams(w, [[0, 0, 0, 10, 20, 30, 0, 1]], [40], [3], -5).length, 0);
});

test("the slot plan: fog boxes first, then landing-outer, fall-inner; weather and the 0.5 ft skip", () => {
  const w = crest2(1000, 1000, 1000, 1020);
  w.speed = 96;
  w.flags = 0; // fallDefaults has FREEZE
  const s = mistShape5(5, 0), g = handGround();
  const two = mistFog(w, 200, s, g);
  const wf = { ...w, flags: FALLFLAG_FREEZE };
  const frozen = mistFog(wf, 200, s, g);
  const plans = [two, [], frozen];
  // room for everything: f0s0, f2s0, f0s1, f2s1
  let p = mistDrawPlan(10, plans, 0);
  assert.deepEqual(p.list.map((m) => [m.fall, m.stream, m.slot]), [[0, 0, 10], [2, 0, 11], [0, 1, 12], [2, 1, 13]]);
  assert.deepEqual(p.draw, [3, 0, 3]);
  // 61 boxes: 3 slots left, the last registered (f2s1) gets none
  p = mistDrawPlan(61, plans, 0);
  assert.deepEqual(p.draw, [3, 0, 1]);
  // Snow: the frozen fall's mist keeps its slots but is not drawn
  p = mistDrawPlan(10, plans, 5);
  assert.deepEqual(p.draw, [3, 0, 0]);
  // a mist under 0.5 ft in H is not drawn
  const tiny = [{ ...two[0]!, H: 0.5 }];
  assert.deepEqual(mistDrawPlan(0, [tiny], 0).draw, [0]);
  // the same count EngineFogSlotOverflow sees
  assert.equal(engineFogSlotOverflow(61, plans.map((q) => q.length)).dropped, 1);
  // the renderer's id and fields
  assert.equal(mistFogId(3, 2), 100014);
  const fp = mistFogParams(two[0]!);
  assert.deepEqual([fp.w, fp.l, fp.h, fp.vis, fp.round, fp.wisp], [two[0]!.W, two[0]!.L, two[0]!.H, two[0]!.vis, 1, two[0]!.wisp]);
});

test("MistLandings: the registered falls' stream counts, 0 for the rest and without ground", () => {
  const w = crest2(1000, 1000, 1000, 1020);
  const off = { ...w, mist: 0 };
  const s = mistShape5(5, 0), g = handGround();
  const lakes = { lakes: [], tmap: null };
  assert.deepEqual(mistLandings([w, off, w], lakes, [0, 0, FALLERR_NAME], [s, s, s], g), [2, 0, 0]);
  assert.deepEqual(mistLandings([w], lakes, [0], [s], null), [0]);
});
