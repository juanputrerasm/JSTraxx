/*
  Traxx 1.8.0's engine fog-volume density (src/core/view/engine-fog.ts, engine-fog-noise.ts), with
  every check of Traxx's own tools/fogtest.cpp (at 34aaa67): the embedded noise, the handover
  section 1.6 density table and lines, the clamps, the wisps, the guide contours, the preview grid
  and its budget, the tall column, the per-weather ambient, the 64 fog slots and the smootherstep.
  Then the renderer's pure parts (OpenGLTerrainRenderer.cpp DrawFogVolumes), which fogtest does not
  cover.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGINEFOG_GRID_NODES, ENGINEFOG_MAX_DRAW, ENGINEFOG_RING_MAX, engineFogAlpha, engineFogAmbient, engineFogBand, engineFogBandCos, engineFogCameraLocal,
  engineFogColour, engineFogDensity, engineFogDrawn, engineFogDrawOrder, engineFogExtinction, engineFogGridBuild, engineFogHalfGuide,
  engineFogHorizontalOd, engineFogInsetRing, engineFogNoise, engineFogNoiseBytes, engineFogNoiseHash, engineFogOdAtMaxOp, engineFogOpticalDepth,
  engineFogParamsHash, engineFogParamsOf, engineFogResolve, engineFogSideDistance, engineFogSliceAlphas, engineFogSliceAxis, engineFogSliceMesh,
  engineFogSlotOverflow, engineFogSmoother, engineFogWispNoise, type EngineFogParams,
} from "../src/core/view/engine-fog.ts";

const f32 = Math.fround;
let checks = 0;
const check = (cond: boolean, what = "") => { checks++; assert.ok(cond, what); };
/* fogtest's NEAR: got within tol of want (the handover prints 6 decimals: tol 2e-6). */
const near = (got: number, want: number, tol: number, what = "") => { checks++; assert.ok(Math.abs(got - want) <= tol, `${what} ${got} != ${want} (+-${tol})`); };

/* The handover's base volume: W 400, L 300, H 40, vis 300, half 8, edge 40, top 10, maxOp 1, round 0, wisp 0, bot 0. */
const base = (): EngineFogParams => ({ w: 400, l: 300, h: 40, vis: 300, half: 8, edge: 40, top: 10, maxop: 1, round: 0, wisp: 0, wsize: 40, wspeed: 3, bot: 0 });
const F = (p: EngineFogParams, x: number, y: number, z: number, t = 0) => engineFogDensity(engineFogResolve(p, t), x, y, z);
function line(p: EngineFogParams, a: number[], b: number[], samples: number, jit: number): { od: number; alpha: number } {
  const v = engineFogResolve(p, 0);
  const od = engineFogOpticalDepth(v, a, b, samples, jit);
  return { od, alpha: engineFogAlpha(od, v.maxop) };
}
const tol = 2e-6;

test("the embedded noise is the engine's byte for byte", () => {
  const n = engineFogNoiseBytes();
  check(n.length === 262144);
  check(engineFogNoiseHash() === 0x94fba76f);
  check(n[0] === 0 && n[1] === 11 && n[2] === 33 && n[3] === 68);
  // more of the C++ table (EngineFogNoise.cpp): the second row's start, the middle, the last texels, and the byte sum
  assert.deepEqual([...n.subarray(64, 68)], [8, 19, 40, 65]);
  assert.equal(n[100000], 143);
  assert.equal(n[131072], 214);
  assert.deepEqual([...n.subarray(262140)], [118, 92, 63, 34]);
  assert.equal(n.reduce((a, c) => a + c, 0), 35700288);
  assert.equal(engineFogNoiseBytes(), n, "decoded once");
});

test("1.6 density table: f at box-local (x, height above floor, z)", () => {
  const p = base();
  near(F(p, 0, 20, 0), 0.176777, tol); // 1 centre
  near(F(p, 0, 0, 0), 1.0, tol); // 2 floor centre
  near(F(p, 0, 40, 0), 0.0, tol); // 3 top face
  near(F(p, 0, 35, 0), 0.024097, tol); // 4 top band
  near(F(p, 200, 0, 0), 0.0, tol); // 5 side face
  near(F(p, 180, 0, 0), 0.5, tol); // 6 edge band
  let q = { ...p };
  near(F(q, 170, 0, 120), 0.896484, tol); // 7 round 0
  q.round = 0.5;
  near(F(q, 170, 0, 120), 0.705328, tol); // 7 round 0.5
  q.round = 1.0;
  near(F(q, 170, 0, 120), 0.0, tol); // 7 round 1
  near(F(q, 150, 0, 100), 0.0, tol); // 8 round 1, outside the ellipse
  q = { ...p, bot: 10 };
  near(F(q, 0, 5, 0), 0.32421, tol); // 9 bot 10
  q = { ...p, half: 0 };
  near(F(q, 0, 20, 0), 1.0, tol); // 10 half 0
  q = { ...p, edge: 500 };
  near(F(q, 0, 0, 75), 0.5, tol); // 11 edge 500 clamps to 150
  q = { ...p, wisp: 0.5, wsize: 40, wspeed: 3 };
  near(F(q, 10, 5, 20, 0.0), 0.659154, tol); // 12 wisp at t = 0
  near(F(q, 10, 5, 20, 10.0), 0.652647, tol); // 12 t = 10
  near(F(q, 10, 5, 20, 100.0), 0.792562, tol); // 12 t = 100
});

test("1.6 lines: closed form, converged, the shader's 12 jittered samples, maxOp, verticals", () => {
  const p = base();
  const v = engineFogResolve(p, 0);
  const ys = [0.0, 4.0, 20.0, 35.0];
  const od = [3.6, 2.545584, 0.636396, 0.086749];
  const al = [0.972676, 0.921573, 0.470804, 0.083093];
  const od12 = [3.564413, 2.520421, 0.630105, 0.085892];
  const al12 = [0.971686, 0.919574, 0.467464, 0.082306];
  for (let i = 0; i < 4; i++) {
    const a = [-200.0, ys[i]!, 0.0], b = [200.0, ys[i]!, 0.0];
    near(engineFogHorizontalOd(v, ys[i]!), od[i]!, tol); // the closed form
    let r = line(p, a, b, 4000, 0.5);
    near(r.od, od[i]!, 5e-5); // converged numeric
    near(r.alpha, al[i]!, 5e-6);
    r = line(p, a, b, 12, 0.5);
    near(r.od, od12[i]!, tol); // the shader's 12 samples, jitter .5
    near(r.alpha, al12[i]!, tol);
  }

  // maxOp 0.6: the floor line caps at 0.6 although OD = 3.6
  {
    const r = line({ ...p, maxop: 0.6 }, [-200, 0, 0], [200, 0, 0], 4000, 0.5);
    near(r.od, 3.6, 5e-5);
    near(r.alpha, 0.6, 1e-6);
    near(engineFogOdAtMaxOp(0.6), 0.916291, 1e-6); // -ln(0.4)
    check(engineFogOdAtMaxOp(1.0) > 1e20);
  }

  // vertical lines
  let r = line(p, [0, 0, 0], [0, 40, 0], 4000, 0.5);
  near(r.od, 0.109778, 5e-6);
  near(r.alpha, 0.103967, 5e-6);
  r = line(p, [180, 0, 0], [180, 40, 0], 4000, 0.5);
  near(r.od, 0.054889, 5e-6);
  near(r.alpha, 0.05341, 5e-6);
  r = line({ ...p, bot: 10 }, [0, 0, 0], [0, 40, 0], 4000, 0.5);
  near(r.od, 0.070209, 5e-6);
  near(r.alpha, 0.067801, 5e-6);
});

test("the clamps (handover 1.1)", () => {
  const p = base();
  let c: EngineFogParams = { ...p, round: -1, wisp: 5, wsize: 0, wspeed: -3, bot: -2, edge: 0, top: 0 };
  let cv = engineFogResolve(c, 50.0);
  check(cv.round === 0.0);
  check(cv.wisp === 1.0);
  check(Math.abs(cv.nscale - 1.0 / 8.0) < 1e-12); // wsize clamped to 1
  check(cv.phase === 0.0); // wspeed clamped to 0: it cannot reverse
  check(cv.bot === 0.0);
  check(Math.abs(cv.edge - 1.0 / 256.0) < 1e-12); // 0 = a hard wall of 1/256 ft
  check(Math.abs(cv.top - 1.0 / 256.0) < 1e-12);
  c = { ...p, vis: 0.2 };
  cv = engineFogResolve(c, 0.0);
  near(cv.sigma, 3.0, 1e-12); // vis floored at 1
  c = { ...p, top: 500 };
  cv = engineFogResolve(c, 0.0);
  near(cv.top, 40.0, 1e-12); // top clamps to H
  c.bot = 500;
  cv = engineFogResolve(c, 0.0);
  near(cv.bot, 40.0, 1e-12); // bot clamps to H
  // a hard wall: the density steps from full to 0 across 1/256 ft
  c = { ...p, edge: 0 };
  near(F(c, 199.0, 0, 0), 1.0, 1e-9);
  near(F(c, 200.0, 0, 0), 0.0, 1e-9);
  // NaN goes to the safe value, as "!(x >= 0)" does in C
  const nan = engineFogResolve({ ...p, round: NaN, wisp: NaN, wsize: NaN, wspeed: NaN, bot: NaN, maxop: NaN, vis: NaN, half: NaN }, 5);
  assert.deepEqual([nan.round, nan.wisp, nan.nscale, nan.phase, nan.bot, nan.maxop, nan.sigma, nan.rate], [0, 0, 1 / 8, 0, 0, 1, 3, 0]);
});

test("wisps: the drift is along +z at wspeed ft/s (handover 1.4)", () => {
  const p = base();
  const w = { ...p, wisp: 1, wsize: 40, wspeed: 3 };
  const w0 = engineFogResolve(w, 0.0), w1 = engineFogResolve(w, 10.0);
  near(w1.phase, 30.0 / 320.0, 1e-12);
  // the main octave read at (z - phase) means the pattern at z moved to z + 40*8*phase = z + 30 ft
  near(engineFogNoise(0.1, 0.2, 0.3), engineFogNoise(0.1, 0.2, 0.3 + 1.0), 1e-12); // wraps
  const nz = engineFogWispNoise(w0, 10, 5, 20);
  check(nz >= 0.0 && nz <= 1.0);
  near(engineFogWispNoise(engineFogResolve(p, 0), 10, 5, 20), 0.5, 0.0); // wisp 0 = no noise
});

test("the guide contours", () => {
  const p = base();
  // a rectangle: the four corners inset by edge'
  let v = engineFogResolve(p, 0.0);
  let ring = engineFogInsetRing(v, v.edge);
  check(ring.length === 4);
  near(ring[2]![0], 160.0, 1e-9);
  near(ring[2]![1], 110.0, 1e-9);
  near(F(p, ring[2]![0], 0, ring[2]![1]), 1.0, 1e-9); // the fade has just ended there
  near(F(p, ring[2]![0] + 20.0, 0, ring[2]![1]), 0.5, 1e-9); // ...and is half way 20 ft further out

  // rounded: every ring point has sd == edge' (to the bisection's precision)
  for (const round of [f32(0.2), f32(0.5), 1.0]) {
    v = engineFogResolve({ ...p, round }, 0.0);
    ring = engineFogInsetRing(v, v.edge);
    check(ring.length === ENGINEFOG_RING_MAX);
    for (const pt of ring) near(engineFogSideDistance(v, pt[0], pt[1]), v.edge, 1e-6);
  }
  // the ellipse at round 1: the ring crosses the x axis at hx - edge' (first order)
  near(ring[0]![0], 160.0, 1e-6);
  // the wide-edge clamp: an inset larger than the volume collapses to the centre, not outside it
  v = engineFogResolve({ ...p, round: 1 }, 0.0);
  ring = engineFogInsetRing(v, 1e6);
  check(ring[5]![0] === 0.0 && ring[5]![1] === 0.0);
});

test("the preview grid reproduces the density at its nodes, and keeps the fade zones", () => {
  const p = base();
  for (let cases = 0; cases < 4; cases++) {
    let q = { ...p };
    if (cases === 1) q.round = f32(0.6);
    if (cases === 2) q = { ...q, round: 1, bot: 10 };
    if (cases === 3) q = { ...q, wisp: f32(0.7), w: 1500, l: 1500 }; // over budget: coarsened
    const v = engineFogResolve(q, 0.0);
    const g = engineFogGridBuild(v, ENGINEFOG_GRID_NODES);
    check(g !== null);
    if (!g) continue;
    check(g.n[0] * g.n[1] * g.n[2] <= ENGINEFOG_GRID_NODES);
    check(g.pos[0][0] === 0.0 && g.pos[0][g.n[0] - 1] === v.W);
    check(g.pos[1][0] === 0.0 && g.pos[1][g.n[1] - 1] === v.H);
    let bad = 0;
    for (let k = 0; k < g.n[2]; k++)
      for (let j = 0; j < g.n[1]; j++)
        for (let i = 0; i < g.n[0]; i++) {
          const e = engineFogExtinction(v, g.pos[0][i]! - v.hx, g.pos[1][j]!, g.pos[2][k]! - v.hz);
          if (Math.abs(g.ext[(k * g.n[1] + j) * g.n[0] + i]! - e) > 1e-6) bad++;
        }
    check(bad === 0);
    if (cases === 0) {
      // the node at the top of the side fade (edge' in from the wall) exists on the x axis
      check([...g.pos[0]].some((x) => Math.abs(x - 40.0) < 1e-9));
    }
  }
});

test("the grid always fits the budget, whatever the box size or wsize (a whole-map fog, wsize 1)", () => {
  const p = base();
  const sizes = [ // W = L, wsize, wisp
    [1500, 1, 1], [2000, 1, 1], [3000, 1, 1], [4000, 2, 1], [6000, 1, 1], [8000, 1, 1],
    [8000, 4, 1], [8000, 40, 1], [8000, 1, 0], [40000, 1, 1], [20, 1, 1], [1, 1, 1]];
  sizes.forEach(([wl, wsize, wisp], c) => {
    const v = engineFogResolve({ ...p, w: wl!, l: wl!, wsize: wsize!, wisp: wisp!, round: c & 1 ? 0.5 : 0.0 }, 0.0);
    const g = engineFogGridBuild(v, ENGINEFOG_GRID_NODES);
    check(g !== null);
    if (g) {
      check(g.n[0] * g.n[1] * g.n[2] <= ENGINEFOG_GRID_NODES);
      check(g.n[0] >= 2 && g.n[1] >= 2 && g.n[2] >= 2);
    }
  });
});

test("a tall volume with a short half-height keeps its vertical samples: H 240, half 4", () => {
  const v = engineFogResolve({ ...base(), h: 240, half: 4 }, 0.0);
  const truth = engineFogOpticalDepth(v, [0, 0, 0], [0, 240, 0], 20000, 0.5);
  const g = engineFogGridBuild(v, ENGINEFOG_GRID_NODES);
  check(g !== null);
  if (!g) return;
  // the column through the middle, trapezoid over the node heights
  let i0 = 0, k0 = 0, sum = 0;
  for (let j = 0; j < g.n[0]; j++) if (Math.abs(g.pos[0][j]! - v.hx) < Math.abs(g.pos[0][i0]! - v.hx)) i0 = j;
  for (let j = 0; j < g.n[2]; j++) if (Math.abs(g.pos[2][j]! - v.hz) < Math.abs(g.pos[2][k0]! - v.hz)) k0 = j;
  for (let j = 0; j + 1 < g.n[1]; j++)
    sum += 0.5 * (g.ext[(k0 * g.n[1] + j) * g.n[0] + i0]! + g.ext[(k0 * g.n[1] + j + 1) * g.n[0] + i0]!) * (g.pos[1][j + 1]! - g.pos[1][j]!);
  near(sum / truth, 1.0, 0.03);
});

test("the weather's ambient (core\\weather.cpp getAmbientLight, floored at 0.05)", () => {
  const want = [1.0, 0.7, 1.0, 1.0, 0.3, 1.0, 0.375, 0.25, 0.05];
  want.forEach((a, w) => near(engineFogAmbient(w), a, 0.0));
  // anything else is read as clear
  assert.equal(engineFogAmbient(-1), 1.0);
  assert.equal(engineFogAmbient(9), 1.0);
});

test("the fog slots: boxes first, then stream 0 of every fall before any fall's stream 1", () => {
  const land = [2, 0, 3];
  let r = engineFogSlotOverflow(10, land, 3, 8);
  check(r.total === 5 && r.dropped === 0);
  r = engineFogSlotOverflow(60, land, 3, 8); // 4 slots left for 5 streams
  check(r.total === 5 && r.dropped === 1);
  check(r.drops[0]!.fall === 2 && r.drops[0]!.stream === 2); // registration: f0s0, f2s0, f0s1, f2s1, f2s2 (the last)
  r = engineFogSlotOverflow(62, land, 3, 8); // 2 left: f0s0, f2s0 fit
  check(r.dropped === 3);
  check(r.drops[0]!.fall === 0 && r.drops[0]!.stream === 1 && r.drops[1]!.fall === 2 && r.drops[1]!.stream === 1 &&
    r.drops[2]!.fall === 2 && r.drops[2]!.stream === 2);
  r = engineFogSlotOverflow(64, land, 3, 0); // the boxes fill it: all mist dropped
  check(r.dropped === 5 && r.drops.length === 0);
  // preflighttest (13507dc): 52 boxes + 12 mist = 64 fits, 53 drops the last stream registered (fall 3 stream 4, 1-based)
  check(engineFogSlotOverflow(52, [4, 4, 4]).dropped === 0);
  r = engineFogSlotOverflow(53, [4, 4, 4]);
  check(r.dropped === 1 && r.total === 12 && r.drops[0]!.fall === 2 && r.drops[0]!.stream === 3);
  r = engineFogSlotOverflow(63, [1, 2, 0]);
  check(r.dropped === 2 && r.drops[0]!.fall === 1 && r.drops[0]!.stream === 0 && r.drops[1]!.fall === 1 && r.drops[1]!.stream === 1);
});

test("the smootherstep itself", () => {
  near(engineFogSmoother(0.0), 0.0, 0.0);
  near(engineFogSmoother(1.0), 1.0, 1e-15);
  near(engineFogSmoother(0.5), 0.5, 1e-15);
});

test("fogtest's check count", () => {
  // fogtest.cpp makes 295 checks (its own report, ce4aa17); the ports above make the same 295, plus the noise
  // length and 3 slot checks from preflighttest (13507dc).
  assert.equal(checks, 295 + 4);
});

// ---- the renderer's pure parts (not in fogtest) ----

test("draw skips: the weather's bit and the 0.5 ft size", () => {
  assert.equal(engineFogDrawn(511, 0, 10, 10, 10), true);
  assert.equal(engineFogDrawn(511 & ~(1 << 5), 5, 10, 10, 10), false);
  assert.equal(engineFogDrawn(511, 2, 0.5, 10, 10), false);
  assert.equal(engineFogDrawn(511, 2, 10, 10, 0.51), true);
});

test("the nearest 16, far to near, ties draw the later record first", () => {
  const d = [5, 1, 5, 3];
  assert.deepEqual(engineFogDrawOrder(d), [2, 0, 3, 1]);
  const many = Array.from({ length: 20 }, (_, i) => i);
  const o = engineFogDrawOrder(many);
  assert.equal(o.length, ENGINEFOG_MAX_DRAW);
  assert.deepEqual(o, Array.from({ length: 16 }, (_, i) => 15 - i));
  assert.equal(engineFogDrawOrder(many, true).length, 20);
});

test("slice axis, bands with hysteresis, alphas capped per column by maxOp, quads far to near", () => {
  assert.deepEqual(engineFogSliceAxis([0, -2, 0]), { axis: 1, cosv: 1, descending: false });
  assert.equal(engineFogSliceAxis([0, 0, 0]), null);
  assert.equal(engineFogBand(0.70, 0, -1, -1), 0);
  assert.equal(engineFogBand(0.74, 0, 0, 0), 0); // within 0.03 of band 0: kept
  assert.equal(engineFogBand(0.74, 1, 0, 0), 1); // another axis: no hysteresis
  assert.equal(engineFogBand(0.76, 0, 0, 0), 1);
  assert.equal(engineFogBandCos(2), 0.93);

  const v = engineFogResolve({ ...base(), maxop: 0.6 }, 0);
  const g = engineFogGridBuild(v)!;
  const alpha = engineFogSliceAlphas(g, v.maxop, 0, 1.0);
  // down the x axis through the floor's middle: the column's composite opacity is exactly maxOp
  const j = 0, k = g.n[2] >> 1;
  let trans = 1;
  for (let i = 0; i < g.n[0]; i++) trans *= 1 - alpha[(k * g.n[1] + j) * g.n[0] + i]!;
  near(1 - trans, 0.6, 1e-5);
  const mesh = engineFogSliceMesh(g, alpha, 0, true, v);
  assert.equal(mesh.positions.length, mesh.quads * 12);
  assert.equal(mesh.indices.length, mesh.quads * 6);
  // descending: the slices come high x first (the wall slice itself has no fog, so it emits nothing)
  let mono = true;
  for (let q = 1; q < mesh.quads; q++) if (mesh.positions[12 * q]! > mesh.positions[12 * (q - 1)]!) mono = false;
  assert.ok(mono && mesh.quads > 0);
  assert.ok(mesh.positions[0]! < g.pos[0][g.n[0] - 1]! - v.hx);
});

test("camera in the volume frame, colour, hash, params of a box, half guide", () => {
  const frame = { cx: 100, cy: 50, ex: [0, 2] as const, ez: [-2, 0] as const, zpf: 1.5, floorz: 10 };
  // eye = centre + 3 ex + 4 ez + 7 zpf up
  const r = engineFogCameraLocal(frame, [100 + 3 * 0 + 4 * -2, 50 + 3 * 2 + 4 * 0, 10 + 7 * 1.5], [0, 0, -1])!;
  near(r.cam[0], 3, 1e-9); near(r.cam[1], 7, 1e-9); near(r.cam[2], 4, 1e-9);
  near(r.dir[1], -1 / 1.5, 1e-12);
  assert.deepEqual(engineFogColour(0.5, 1, 0.25, 0.01), [f32(0.025), f32(0.05), f32(0.0125)]);
  const p = base();
  assert.equal(engineFogParamsHash(p), engineFogParamsHash({ ...p }));
  assert.notEqual(engineFogParamsHash(p), engineFogParamsHash({ ...p, wisp: 0.1 }));
  const bp = engineFogParamsOf({ width: 400, length: 300, height: 40 }, p);
  assert.deepEqual([bp.w, bp.l, bp.h, bp.vis], [400, 300, 40, 300]);
  assert.equal(engineFogHalfGuide(engineFogResolve(p, 0)), 8);
  assert.equal(engineFogHalfGuide(engineFogResolve({ ...p, half: 0 }, 0)), null);
});
