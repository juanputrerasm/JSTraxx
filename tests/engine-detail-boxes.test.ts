/*
  Traxx 1.8.1's ground box detail light and Show Water Strength wash (engine-detail.ts), with the
  checks of Traxx's tools/detailtest.cpp Boxes() and its "Show Water Strength" block.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGDET_BOX_BACK, ENGDET_BOX_BOTTOM, ENGDET_BOX_FRONT, ENGDET_BOX_LEFT, ENGDET_BOX_RIGHT, ENGDET_BOX_TOP,
  engineDetailBoxCorner, engineDetailBoxFaceI, engineDetailBoxI, engineDetailWaterAmp, engineDetailWaterWash, engineDetailWaterWashT,
} from "../src/core/view/engine-detail.ts";

const near = (got: number, want: number, tol: number, what: string) => assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got} want ${want}`);

test("Show Water Strength: the wash value = the water strength / its strongest", () => {
  near(engineDetailWaterWashT(0), 0.2, 1e-6, "mask 0 (unpainted) -> 0.2");
  near(engineDetailWaterWashT(128 / 255), 0.601569, 1e-6, "mask 128 -> 0.601569");
  near(engineDetailWaterWashT(1), 1.0, 1e-6, "mask 255 -> 1.0");
  near(engineDetailWaterWashT(64 / 255), engineDetailWaterAmp(64, 1, 1, 100, false) / engineDetailWaterAmp(255, 1, 1, 100, false), 1e-6,
    "= amplitude / strongest amplitude (mask 64)");
  const out = engineDetailWaterWash([0.5, 0.5, 0.5], 1);
  near(out[0], 0.875, 1e-6, "white mask: grey -> red 0.875");
  near(out[2], 0.125, 1e-6, "white mask: grey -> blue 0.125");
});

// detailtest.cpp: cell corners (0,0) (1,0) (1,1) (0,1), their shadow bits, the face lights FRONT BACK RIGHT LEFT TOP BOTTOM.
const BOXCI = [0.2, 0.4, 0.9, 0.6];
const BOXSH = [0, 1, 0, 1];
const BOXFACEI = [0.31, 0.42, 0.53, 0.64, 0.0, 0.27];

test("ground boxes (handover 4.7): detail uv = world XZ on every face", () => {
  const want = [[50.5, 25.5], [50.0, 25.5], [50.0, 25.5], [50.5, 25.5]];
  const wanttop = [0, 0, 1, 1];
  for (let k = 0; k < 4; k++) {
    const c = engineDetailBoxCorner(ENGDET_BOX_BACK, k, 100, 50, 64, 256);
    near(c.u, want[k]![0]!, 1e-9, `+Z wall tile (100,50) corner ${k} detUV u`);
    near(c.v, want[k]![1]!, 1e-9, `+Z wall tile (100,50) corner ${k} detUV v`);
    assert.equal(c.top, wanttop[k], `+Z wall tile (100,50) corner ${k} top/bottom`);
    assert.equal(c.tz, 51, `+Z wall tile (100,50) corner ${k} light tile z`);
  }
  assert.equal(engineDetailBoxCorner(ENGDET_BOX_RIGHT, 1, 255, 7, 64, 256).tx, 0, "+X wall of tile 255: its far corners' light wraps to tile 0");
  assert.equal(engineDetailBoxCorner(ENGDET_BOX_RIGHT, 1, 511, 7, 64, 512).tx, 0, "512: +X wall of tile 511 wraps to tile 0");
  assert.equal(engineDetailBoxCorner(ENGDET_BOX_RIGHT, 1, 255, 7, 64, 512).tx, 256, "512: +X wall of tile 255: far corners on tile 256 (no wrap)");
  const c = engineDetailBoxCorner(ENGDET_BOX_BACK, 0, 300, 511, 64, 512);
  assert.equal(c.tz, 0, "512: +Z wall of tile (300, 511): light tile z wraps to 0");
  assert.equal(c.wx, 301 * 8192, "512: corner on x 301: world x = 301 * 8192 engine units");
  near(c.u, 150.5, 1e-9, "512: corner on x 301: detail u = 301 * 32 / 64");
  near(c.v, 256.0, 1e-9, "512: corner on z 512: detail v = 512 * 32 / 64 (not wrapped)");
});

test("ground boxes: the legacy face light, sun E, ambient 32768 (by hand)", () => {
  const sunE = [-46333, -46333, 0] as const;
  near(engineDetailBoxFaceI(ENGDET_BOX_FRONT, sunE, 32768), 1792 / 4080, 1e-6, "FRONT (-Z) faceLit i");
  near(engineDetailBoxFaceI(ENGDET_BOX_BACK, sunE, 32768), 1792 / 4080, 1e-6, "BACK (+Z) faceLit i");
  near(engineDetailBoxFaceI(ENGDET_BOX_RIGHT, sunE, 32768), 3239 / 4080, 1e-6, "RIGHT (+X, toward the sun) faceLit i");
  near(engineDetailBoxFaceI(ENGDET_BOX_LEFT, sunE, 32768), 1792 / 4080, 1e-6, "LEFT (-X, away) faceLit i");
  near(engineDetailBoxFaceI(ENGDET_BOX_BOTTOM, sunE, 32768), 1792 / 4080, 1e-6, "BOTTOM faceLit i");
  assert.equal(engineDetailBoxFaceI(6, sunE, 32768), 0, "no such face");
});

test("ground boxes: the light over a face (corners 0.2 0.4 0.9 0.6, shadow on (1,0) and (0,1))", () => {
  near(engineDetailBoxI(ENGDET_BOX_TOP, BOXCI, BOXSH, 0, 0.3, 0.6), 0.53, 1e-6, "top at (0.3, 0.6): the (0,0)-(1,1) diagonal");
  near(engineDetailBoxI(ENGDET_BOX_BOTTOM, BOXCI, BOXSH, BOXFACEI[5]!, 0.7, 0.2), 0.335, 1e-6, "bottom at (0.7, 0.2)");
  near(engineDetailBoxI(ENGDET_BOX_FRONT, BOXCI, BOXSH, BOXFACEI[0]!, 0.25, 0), 0.3325, 1e-6, "-Z wall at x 0.25");
  near(engineDetailBoxI(ENGDET_BOX_BACK, BOXCI, BOXSH, BOXFACEI[1]!, 0.25, 1), 0.555, 1e-6, "+Z wall at x 0.25");
  near(engineDetailBoxI(ENGDET_BOX_RIGHT, BOXCI, BOXSH, BOXFACEI[2]!, 1, 0.7), 0.491, 1e-6, "+X wall at z 0.7");
  near(engineDetailBoxI(ENGDET_BOX_LEFT, BOXCI, BOXSH, BOXFACEI[3]!, 0, 0.7), 0.612, 1e-6, "-X wall at z 0.7");
});
