/*
  Traxx 1.7.1's view rules: the cyan course joins (e3665e5) and the world-wrap border
  (992ef9f .. 45727cb): torus-aware tile LOD, the border helpers, and picks off the map.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { courseWrapDelta, courseJoinPieces, TRAXX_COURSE_WRAP } from "../src/core/traxx/course-wrap.ts";
import {
  surfaceWrapTileDelta, surfaceBorderTileSource, surfaceBorderTileRange, surfaceBoxWrapShifts, surfaceCornerInWrapBand,
  surfaceTileLod, surfaceTileNeighbourLods, SURFACE_LOD_8FT, SURFACE_LOD_32FT,
} from "../src/core/view/surface-tiles.ts";
import { pickTerrain, pickSurface } from "../src/core/view/pick.ts";
import { interpolateRawAtPoint } from "../src/core/traxx/terrain.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { TERRAINMODE_CLASSIC16 } from "../src/core/traxx/terrain16.ts";

test("CourseWrapDelta folds mod 16384 into [-8192, 8192)", () => {
  assert.equal(TRAXX_COURSE_WRAP, 16384);
  assert.equal(courseWrapDelta(0), 0);
  assert.equal(courseWrapDelta(8191), 8191);
  assert.equal(courseWrapDelta(8192), -8192);
  assert.equal(courseWrapDelta(-8192), -8192);
  assert.equal(courseWrapDelta(-8193), 8191);
  assert.equal(courseWrapDelta(16000), -384);
  assert.equal(courseWrapDelta(-16000), 384);
  assert.equal(courseWrapDelta(16384 + 5), 5);
});

test("CourseJoinPieces: one piece inside the map, two across the seam", () => {
  assert.deepEqual(courseJoinPieces(100, 200, 300, 400), [[100, 200, 300, 400]]);
  // A at the east edge, B just past the seam on the west: the short way, then its twin at B.
  assert.deepEqual(courseJoinPieces(16300, 500, 100, 500), [[16300, 500, 16484, 500], [-84, 500, 100, 500]]);
  // Across both seams.
  assert.deepEqual(courseJoinPieces(50, 16350, 16340, 30), [[50, 16350, -44, 16414], [16434, -34, 16340, 30]]);
});

test("SurfaceWrapTileDelta and the torus-aware tile LOD (992ef9f)", () => {
  assert.equal(surfaceWrapTileDelta(63, 64), -1);
  assert.equal(surfaceWrapTileDelta(-63, 64), 1);
  assert.equal(surfaceWrapTileDelta(32, 64), -32);
  assert.equal(surfaceWrapTileDelta(-32, 64), -32);
  assert.equal(surfaceWrapTileDelta(0, 64), 0);
  assert.equal(surfaceWrapTileDelta(64, 64) + 0, 0);
  assert.equal(surfaceWrapTileDelta(130, 64), 2);
  // Camera at cell (2, 100): tile 63 is one tile away round the seam.
  assert.equal(surfaceTileLod(true, 63, 25, 2, 100), SURFACE_LOD_8FT);
  assert.equal(surfaceTileLod(true, 40, 25, 2, 100), SURFACE_LOD_32FT);
  const nbr = surfaceTileNeighbourLods(true, 63, 25, 2, 100);
  assert.equal(nbr[1], surfaceTileLod(true, 0, 25, 2, 100), "tile 63's +x neighbour is tile 0");
  assert.equal(surfaceTileNeighbourLods(true, 0, 25, 2, 100)[0], surfaceTileLod(true, 63, 25, 2, 100), "tile 0's -x neighbour is tile 63");
});

test("the border helpers: source tiles, tile ranges, object shifts, the wrap band", () => {
  assert.deepEqual(surfaceBorderTileSource(-1, 5, 64), [63, 5]);
  assert.deepEqual(surfaceBorderTileSource(64, 64, 64), [0, 0]);
  assert.deepEqual(surfaceBorderTileSource(-1, -1, 64), [63, 63]);
  assert.equal(surfaceBorderTileSource(5, 5, 64), null);
  assert.equal(surfaceBorderTileSource(-2, 5, 64), null);
  assert.equal(surfaceBorderTileSource(65, 5, 64), null);
  assert.deepEqual(surfaceBorderTileRange(-10, 64, 4, false), [-1, 13]);
  assert.deepEqual(surfaceBorderTileRange(230, 64, 4, false), [57, 64]);
  assert.deepEqual(surfaceBorderTileRange(100, 64, 4, true), [-1, 64]);
  assert.deepEqual(surfaceBoxWrapShifts(1, 100), [[256, 0]]);
  assert.deepEqual(surfaceBoxWrapShifts(3, 100), []);
  assert.deepEqual(surfaceBoxWrapShifts(253, 100), [[-256, 0]]);
  assert.deepEqual(surfaceBoxWrapShifts(100, 0), [[0, 256]]);
  assert.deepEqual(surfaceBoxWrapShifts(254, 1), [[-256, 0], [0, 256], [-256, 256]]);
  assert.ok(surfaceCornerInWrapBand(-3, 259) && !surfaceCornerInWrapBand(-4, 0) && !surfaceCornerInWrapBand(0, 260));
});

test("InterpolateRawAtPoint: cell 255 reaches column 0 (1.7.1)", () => {
  const raw = new Uint8Array(65536);
  for (const j of [5, 6]) { raw[255 + (j << 8)] = 0; raw[0 + (j << 8)] = 100; }
  assert.ok(Math.abs(interpolateRawAtPoint(raw, 255 * 64 + 32, 5 * 64 + 32) - 50) <= 1);
  assert.ok(Math.abs(interpolateRawAtPoint(raw, 255 * 64, 5 * 64 + 32)) <= 1);
});

test("a pick on the world-wrap border is no hit; cell 255 is a real cell", () => {
  const flat = new Uint8Array(65536).fill(10);
  // Straight down on cell 255: a real cell now.
  const on255 = pickTerrain(flat, [255 * 64 + 20, 1000, 500], [0, 0, -1]);
  assert.ok(on255);
  assert.deepEqual(on255.cell, [255, 15]);
  // Straight down past the west edge, on the border copy: nothing.
  assert.equal(pickTerrain(flat, [-40, 1000, 500], [0, 0, -1]), null);
  assert.equal(pickTerrain(flat, [16384 + 40, 1000, 500], [0, 0, -1]), null);
  // Just past the low edge: floored to -1, off the map.
  assert.equal(pickTerrain(flat, [-0.5, 1000, 500], [0, 0, -1]), null);
  // The drive surface the same way.
  const doc = newTrackDocument();
  const t = doc.track;
  t.terrainMode = TERRAINMODE_CLASSIC16;
  t.h16 = new Uint16Array(65536).fill(10 << 8);
  const win = { x0: 220, y0: 0, n: 64 };
  const s = pickSurface(t, [255 * 64 + 20, 1000, 500], [0, 0, -1], win);
  assert.ok(s);
  assert.equal(s.cell[0], 255);
  assert.equal(pickSurface(t, [16384 + 40, 1000, 500], [0, 0, -1], win), null);
});
