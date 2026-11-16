/*
  Track format version 6 (track-format-v6.md sections 7 and 8) in the terrain core: 512-cell
  grids and the 32-bit height store.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { terrainSplineExpand } from "../src/vendor/openphotex/terrain/spline.js";
import { cornerV, getSurface, setMode, splineExpandV, surfaceHeightV, buildLakeGround, planarExpand, applyStamp16 } from "../src/core/traxx/surface.ts";
import { mirrorOf, refreshRaw, TERRAINMODE_CLASSIC16, TERRAINMODE_FINE, TERRAINMODE_SPLINE, type Terrain16 } from "../src/core/traxx/terrain16.ts";
import { interpolateRawAtPoint } from "../src/core/traxx/terrain.ts";
import { applyBrush, makeEditGrid } from "../src/core/edit/terrain.ts";
import { bakeEngineLighting, fillLteFlat } from "../src/core/edit/lighting.ts";

const N = 512;

function wide512(fill: (x: number, z: number) => number, mode = TERRAINMODE_CLASSIC16): Terrain16 {
  const h16 = new Int32Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) h16[x + z * N] = fill(x, z);
  const t: Terrain16 = { terrainMode: mode, worldCells: N, h16, fine: null, rawShadow: new Uint8Array(N * N), heights: new Uint8Array(N * N) };
  refreshRaw(t);
  return t;
}

test("a 16-bit 256 grid splines exactly as terrainSplineExpand", () => {
  const h = new Uint16Array(256 * 256);
  for (let i = 0; i < h.length; i++) h[i] = (i * 2654435761) & 0xffff;
  assert.deepEqual(splineExpandV(h), terrainSplineExpand(h));
});

test("a 32-bit grid splines in sample units and keeps its 32 ft points", () => {
  // 1000 ft plus multiples of 1/32 ft: step 32 base 1000 holds them exactly.
  const t = wide512((x, z) => 1000 * 128 + 4 * ((x * 7 + z * 13) % 4000), TERRAINMODE_SPLINE);
  const s = getSurface(t)!;
  assert.ok(s instanceof Int32Array);
  assert.equal(s.length, 16 * N * N);
  for (const [x, z] of [[0, 0], [511, 3], [200, 511]]) assert.equal(s[4 * x + 4 * z * 4 * N], t.h16![x + z * N]);
});

test("a 512 world wraps at cell 511, and 32-bit heights pass 512 ft", () => {
  const t = wide512((x) => (x === 511 ? 80000 : x === 0 ? 70000 : 0));
  assert.equal(cornerV(t, 512, 0), 70000);
  assert.equal(cornerV(t, -1, 0), 80000);
  // Halfway along cell 511's south edge: halfway between 80000 and 70000.
  assert.equal(surfaceHeightV(t, 511 * 16384 + 8192, 0), 75000);
  assert.equal(t.heights[511], 255);
});

test("mirrorOf holds negative heights at 0", () => {
  assert.equal(mirrorOf(-5000), 0);
  assert.equal(mirrorOf(300 * 256), 255);
});

test("Terrain Grid to a Full Map keeps the 32-bit store and the 4N side", () => {
  const t = wide512((x, z) => -1280 + x + z);
  assert.ok(setMode(t, TERRAINMODE_FINE));
  assert.ok(t.fine instanceof Int32Array);
  assert.equal(t.fine!.length, 2048 * 2048);
  assert.equal(t.fine![4 * 300 + 4 * 7 * 2048], -1280 + 307);
  assert.ok(setMode(t, TERRAINMODE_CLASSIC16));
  assert.ok(t.h16 instanceof Int32Array);
  assert.equal(t.h16![300 + 7 * N], -1280 + 307);
});

test("planarExpand of a 512 grid wraps at 512", () => {
  const h = new Uint16Array(N * N);
  h[0] = 4000;
  const f = planarExpand(h);
  assert.equal(f.length, 2048 * 2048);
  assert.equal(f[0], 4000);
  // The last fine point of row 0 leans toward corner 0 across the wrap.
  assert.ok(f[2047]! > 0);
});

test("the brush on a 32-bit grid is not held to 0..65535", () => {
  const t = wide512(() => 65000);
  const p = { tool: 0, width: 3, height: 3, orientation: 0, curvature: 3, altitude: 10 };
  applyBrush(t, makeEditGrid(p), p, 500, 500);
  assert.equal(t.h16![500 + 500 * N], 65000 + 2560);
  const plane = { ...p, tool: 6, altitude: -20 };
  applyBrush(t, makeEditGrid(plane), plane, 10, 10);
  assert.equal(t.h16![10 + 10 * N], -5120);
  // A 16-bit grid keeps Traxx's clamps.
  const g = new Uint16Array(256 * 256).fill(65000);
  applyStamp16(g, 256, 255, [2560], 1, 1, 5, 5, 0, 0, null, false);
  assert.equal(g[5 + 5 * 256], 65535);
});

test("raw interpolation, the lake ground and the light plane follow N", () => {
  const raw = new Uint8Array(N * N);
  raw[511] = 100;
  // Halfway along cell 510's south edge toward 511 (ipos 64 a cell).
  assert.equal(interpolateRawAtPoint(raw, 510 * 64 + 32, 0), 50);
  const t = wide512((x, z) => (x + z) * 2);
  const g = buildLakeGround(t)!;
  assert.equal(g.tilemin!.length, N * N);
  assert.equal(g.tilemin![511 + 511 * N], 0); // wraps to corner (0, 0)
  assert.equal(fillLteFlat(N * N).length, N * N * 7);
  assert.equal(bakeEngineLighting(t, [0, -65536, 0], 32768).length, N * N);
});
