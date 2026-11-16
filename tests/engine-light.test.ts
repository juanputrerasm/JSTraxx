/*
  Traxx 1.7.2's engine ground lighting and sun helpers (engine-light.ts), with the expectations of
  Traxx's own tools/lighttest.cpp, and the engine heights the bake reads (lighting.ts engineY0,
  CTrackPODTerrain::GetEngineY0) in every terrain mode and on a 512-cell world.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cubeShadowHull, engineApproxGroundNormal, engineBakeGround, engineFmul, sunElevationDeg, sunIsTraxxDefault, sunKeepStrengthFromXZ,
  sunKeepStrengthFromY, sunMatchPreset, sunSkyDirection, sunStrengthPct, SUN_PRESETS,
} from "../src/core/edit/engine-light.ts";
import { bakeEngineLighting, buildLighting, engineY0, fillLteFlat } from "../src/core/edit/lighting.ts";
import { getSurface, setMode } from "../src/core/traxx/surface.ts";
import { TERRAINMODE_CLASSIC16, TERRAINMODE_FINE, TERRAINMODE_SPLINE, refreshRaw, type Terrain16 } from "../src/core/traxx/terrain16.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";

const SUN_E = [-46333, -46333, 0];
const SUN_BAJARUN = [19585, -59396, 19585];
const flat = () => new Int32Array(65536);
const allTiles = (out: Uint8Array, v: number) => out.every((b) => b === v);

test("fmul is the 64-bit product shifted 16 and cast to int", () => {
  assert.equal(engineFmul(-46333, 65535), -46333);
  assert.equal(engineFmul(32767, 46333), 23165);
  // Beyond 2^53 the product is still exact (the cast keeps the low 32 bits, as MSVC does).
  assert.equal(engineFmul(2147483647, 2147483647), Number(BigInt.asIntN(32, (2147483647n * 2147483647n) >> 16n)));
});

test("flat ground: noon 255, the E preset 218, a back light the ambient, a zero sun the ambient", () => {
  const y0 = flat();
  assert.deepEqual(engineApproxGroundNormal(y0, 100, 100), [0, 65535, 0]);
  assert.ok(allTiles(engineBakeGround(y0, [0, -65536, 0], 32768), 255));
  assert.ok(allTiles(engineBakeGround(y0, SUN_E, 32768), 218));
  assert.ok(allTiles(engineBakeGround(y0, [0, 46333, 0], 32768), 128));
  assert.ok(allTiles(engineBakeGround(y0, [0, 46333, 0], 0), 0));
  assert.ok(allTiles(engineBakeGround(y0, [0, 0, 0], 40960), 160));
});

test("a slope's normal matches the engine's integer reference, wrapping at the edge", () => {
  const y0 = new Int32Array(65536);
  for (let z = 0; z < 256; z++) for (let x = 0; x < 256; x++) y0[z * 256 + x] = 128 * x;
  assert.deepEqual(engineApproxGroundNormal(y0, 10, 5), [-4087, 65407, 0]);
  assert.ok(engineApproxGroundNormal(y0, 0, 5)[0] > 60000);
});

test("presets, exact matching and the Traxx defaults", () => {
  const want = [[0, -46333, -46333], [-46333, -46333, 0], [0, -46333, 46333], [46333, -46333, 0], [0, -64000, 0]];
  assert.deepEqual(SUN_PRESETS, want);
  want.forEach((p, i) => assert.equal(sunMatchPreset(p), i));
  assert.equal(sunMatchPreset(SUN_BAJARUN), -1);
  assert.equal(sunMatchPreset(SUN_PRESETS[1]!), 1);
  assert.ok(sunIsTraxxDefault(SUN_E, 32768));
  assert.ok(!sunIsTraxxDefault(SUN_E, 40960));
  assert.ok(!sunIsTraxxDefault(SUN_BAJARUN, 32768));
});

test("Keep strength from X/Z and from Y", () => {
  assert.deepEqual(sunKeepStrengthFromXZ(0, 0, 65536), [0, -65536, 0]);
  const o = sunKeepStrengthFromXZ(19585, 19585, 65536);
  assert.ok(o[0] === 19585 && o[2] === 19585 && Math.abs(o[1] - -59396) <= 1);
  assert.ok(Math.abs(Math.hypot(...o) - 65536) <= 2);
  assert.deepEqual(sunKeepStrengthFromXZ(100000, 0, 65536), [65536, 0, 0]);

  const w = [46333, -46333, 0];
  assert.deepEqual(sunKeepStrengthFromY(w, -65536, 65536), [0, -65536, 0]);
  let out = sunKeepStrengthFromY(w, 0, 65536);
  assert.ok(Math.abs(out[0] - 65536) <= 1 && out[1] === 0 && out[2] === 0);
  // The horizontal direction and its sign are kept.
  out = sunKeepStrengthFromY(SUN_E, 0, 65536);
  assert.ok(Math.abs(out[0] - -65536) <= 1 && out[1] === 0 && out[2] === 0);
  // Straight up has no horizontal direction to keep.
  assert.deepEqual(sunKeepStrengthFromY([0, -65536, 0], -30000, 65536), [0, -30000, 0]);
});

test("readouts and the direction toward the sun", () => {
  assert.ok(Math.abs(sunElevationDeg(SUN_BAJARUN) - 65) < 0.1);
  assert.ok(Math.abs(sunStrengthPct(SUN_E) - 99.98) < 0.1);
  assert.equal(sunElevationDeg([0, 0, 0]), 0);
  const d = sunSkyDirection(SUN_E)!;
  assert.ok(Math.abs(d[0] - 0.7071) < 1e-4 && Math.abs(d[1] - 0.7071) < 1e-4 && Math.abs(d[2]) < 1e-4);
  const noon = sunSkyDirection([0, -64000, 0])!;
  assert.ok(Math.abs(noon[0]) < 1e-9 && Math.abs(noon[1] - 1) < 1e-9 && Math.abs(noon[2]) < 1e-9);
  assert.equal(sunSkyDirection([0, 0, 0]), null);
  assert.equal(sunSkyDirection([1000, 10, 0]), null);
  assert.equal(sunSkyDirection([1000, 0, 0]), null);
});

test("the cube's shadow hull", () => {
  const bounds = (h: [number, number][]) => ({
    minx: Math.min(...h.map((p) => p[0])), maxx: Math.max(...h.map((p) => p[0])),
    minz: Math.min(...h.map((p) => p[1])), maxz: Math.max(...h.map((p) => p[1])),
  });
  const noon = cubeShadowHull([0, -65536, 0]);
  assert.equal(noon.length, 4);
  const b = bounds(noon);
  assert.ok(Math.abs(b.minx) < 1e-9 && Math.abs(b.maxx - 1) < 1e-9 && Math.abs(b.minz) < 1e-9 && Math.abs(b.maxz - 1) < 1e-9);

  const low = cubeShadowHull(SUN_E);
  assert.equal(low.length, 4);
  const l = bounds(low);
  assert.ok(Math.abs(l.minx + 1) < 1e-9 && Math.abs(l.maxx - 1) < 1e-9 && Math.abs(l.minz) < 1e-9 && Math.abs(l.maxz - 1) < 1e-9);
  let area = 0;
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; area += low[i]![0] * low[j]![1] - low[j]![0] * low[i]![1]; }
  assert.ok(area > 0, "counter-clockwise");

  assert.equal(cubeShadowHull([0, 46333, 0]).length, 0);
  assert.equal(cubeShadowHull([0, 0, 0]).length, 0);
});

test("the engine's heights in every terrain mode (GetEngineY0)", () => {
  const t = newTrackDocument().track;
  t.heights.fill(0);
  t.heights[5 * 256 + 3] = 10;
  let y0 = engineY0(t);
  assert.equal(y0[5 * 256 + 3], 1280);
  assert.equal(y0[5 * 256 + 4], 0);
  assert.equal(y0[3 * 256 + 5], 0);

  assert.ok(setMode(t, TERRAINMODE_CLASSIC16));
  assert.equal(engineY0(t)[5 * 256 + 3], (10 << 8) >> 1);
  t.h16![5 * 256 + 3] = 2561;
  assert.equal(engineY0(t)[5 * 256 + 3], 1280);

  assert.ok(setMode(t, TERRAINMODE_SPLINE));
  y0 = engineY0(t);
  const s = getSurface(t)!;
  assert.ok(s);
  assert.equal(y0[5 * 256 + 3], s[20 * 1024 + 12]! >> 1);
  assert.equal(y0[40 * 256 + 77], s[4 * 40 * 1024 + 4 * 77]! >> 1);

  const f = newTrackDocument().track;
  assert.ok(setMode(f, TERRAINMODE_FINE));
  f.fine![4 * 7 * 1024 + 4 * 9] = 4001;
  assert.equal(engineY0(f)[7 * 256 + 9], 2000);
});

test("the flat fill: ground 0xed, the other six bytes 0", () => {
  const lte = fillLteFlat(65536);
  assert.equal(lte.length, 65536 * 7);
  assert.ok(lte.every((v, i) => (i % 7 === 0 ? v === 0xed : v === 0)));
});

test("a 512-cell world bakes N x N, wrapping at 511, a 32-bit store halved like the engine's int", () => {
  const N = 512;
  const h16 = new Int32Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) h16[x + z * N] = x * 256 - 20000; // negative heights too
  const t: Terrain16 = { terrainMode: TERRAINMODE_CLASSIC16, worldCells: N, h16, fine: null, rawShadow: new Uint8Array(N * N), heights: new Uint8Array(N * N) };
  refreshRaw(t);
  const y0 = engineY0(t);
  assert.equal(y0.length, N * N);
  assert.equal(y0[0], -10000);
  assert.equal(y0[1], (256 - 20000) >> 1);
  // Across the wrap the slope reverses sharply: x = 0's west neighbour is x = 511.
  assert.ok(engineApproxGroundNormal(y0, 0, 7, N)[0] > 60000);
  assert.ok(Math.abs(engineApproxGroundNormal(y0, 100, 7, N)[0]) < 20000);
  const ground = bakeEngineLighting(t, [0, -65536, 0], 32768);
  assert.equal(ground.length, N * N);
  // Every row alike (the slope runs along x only).
  for (let x = 0; x < N; x++) assert.equal(ground[300 * N + x], ground[x]);
  // A 512 track's BuildLighting fills N x N x 7.
  const doc = newTrackDocument(512);
  buildLighting(doc.track, SUN_E, 32768);
  assert.equal(doc.track.lte!.length, N * N * 7);
  assert.equal(doc.track.lte![7 * 1000], 218);
});

/* Traxx 1.8.0 (b6d56f2) tools/lighttest.cpp: test_visible_sun_direction, test_sun_ball_and_world_mapping. */
import { engineDirToTraxxWorld, engineSunBallDirection, engineVisibleSunDirection } from "../src/core/view/engine-sky.ts";

test("the visible sun: engine y halved, same azimuth, the zenith kept, none at the horizon", () => {
  const sun45 = [32768, -32768, 0], noon = [0, -64000, 0], none = [1000, 0, 0];
  const d = engineVisibleSunDirection(sun45)!, u = sunSkyDirection(sun45)!;
  assert.ok(d && u);
  const elev = (Math.asin(d[1]) * 180) / Math.PI;
  assert.ok(Math.abs(elev - (Math.atan(0.5 * Math.tan(Math.PI / 4)) * 180) / Math.PI) < 1e-9);
  assert.ok(Math.abs(elev - 26.565051) < 1e-5);
  assert.ok(Math.abs(Math.atan2(d[2], d[0]) - Math.atan2(u[2], u[0])) < 1e-12);
  assert.ok(Math.abs(d[0] * d[0] + d[1] * d[1] + d[2] * d[2] - 1) < 1e-12);
  const s = [20000, -30000, -15000];
  const ds = engineVisibleSunDirection(s)!, us = sunSkyDirection(s)!;
  assert.ok(ds && us);
  assert.ok(Math.abs(Math.atan2(ds[2], ds[0]) - Math.atan2(us[2], us[0])) < 1e-12);
  assert.ok(ds[1] < us[1]);
  const z = engineVisibleSunDirection(noon)!;
  assert.ok(Math.abs(z[0]) < 1e-12 && Math.abs(z[1] - 1) < 1e-12 && Math.abs(z[2]) < 1e-12);
  assert.equal(engineVisibleSunDirection(none), null);
});

test("the sky's ball: one formula with no horizon test; engine to Traxx world mapping", () => {
  const sun45 = [32768, -32768, 0], below = [32768, 20000, -5000];
  assert.deepEqual(engineSunBallDirection(sun45), engineVisibleSunDirection(sun45));
  assert.equal(engineVisibleSunDirection(below), null);
  const d = engineSunBallDirection(below)!;
  assert.ok(d[1] < 0 && Math.abs(d[1] + 10000 / Math.sqrt(32768 * 32768 + 10000 * 10000 + 5000 * 5000)) < 1e-12);
  assert.equal(engineSunBallDirection([0, 0, 0]), null);
  let w = engineDirToTraxxWorld([0, Math.sqrt(0.5), Math.sqrt(0.5)]);
  assert.ok(Math.abs((Math.atan2(w[2], Math.hypot(w[0], w[1])) * 180) / Math.PI - 36.869898) < 1e-5);
  assert.ok(w[0] === 0 && w[1] > 0);
  w = engineDirToTraxxWorld([1, 0, 0]);
  assert.deepEqual(w, [128, 0, 0]);
});
