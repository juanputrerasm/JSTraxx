/*
  Track format version 6 in the view (openmtm2.github.io/proposals/track-format-v6.md, section
  8.1 and section 10 item 8): every world constant of the view, the picks, the camera, the map,
  the course joins and the SIT positions follow N = worldCells; 256 stays exactly as before.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { courseWrapDelta, courseJoinPieces } from "../src/core/traxx/course-wrap.ts";
import {
  surfaceBorderTileRange, surfaceBoxWrapShifts, surfaceCornerInWrapBand, surfaceTileLod, surfaceTileLodsFor, SURFACE_LOD_8FT, SURFACE_LOD_32FT,
} from "../src/core/view/surface-tiles.ts";
import { pickTerrain } from "../src/core/view/pick.ts";
import { MAX_Z_POSITION, TraxxCamera, cameraMaxZ, objectsHighZ, terrainZRange } from "../src/core/view/camera.ts";
import { terrainMap } from "../src/core/traxx/map.ts";
import { traxxSitToIpos } from "../src/core/traxx/sit.ts";
import { boxGrids, groundBoxGeometry } from "../src/core/view/ground-box-geometry.ts";
import { TERRAINMODE_CLASSIC16, TERRAINMODE_SPLINE } from "../src/core/traxx/terrain16.ts";

test("v6 view: the world-wrap border and tile LOD wrap at N", () => {
  // A 512 world: 128 tiles an axis, the camera at cell 2 sees tile 127 as a neighbour.
  assert.equal(surfaceTileLod(true, 127, 25, 2, 100, 4, 8, 512), SURFACE_LOD_8FT);
  assert.equal(surfaceTileLod(true, 63, 25, 2, 100, 4, 8, 512), SURFACE_LOD_32FT, "tile 63 is mid-world in a 512 world");
  assert.equal(surfaceTileLod(true, 63, 25, 2, 100), SURFACE_LOD_8FT, "and still the neighbour across the seam at 256");
  const t = { terrainMode: TERRAINMODE_SPLINE, worldCells: 512 };
  assert.equal(surfaceTileLodsFor(t, 127, 25, 2, 100).lod, SURFACE_LOD_8FT);
  assert.equal(surfaceTileLodsFor(t, 127, 25, 2, 100).nbr[1], surfaceTileLod(true, 0, 25, 2, 100, 4, 8, 512), "tile 127's +x neighbour is tile 0");
  assert.deepEqual(surfaceBoxWrapShifts(1, 300, 3, 512), [[512, 0]]);
  assert.deepEqual(surfaceBoxWrapShifts(510, 300, 3, 512), [[-512, 0]]);
  assert.deepEqual(surfaceBoxWrapShifts(254, 300, 3, 512), [], "cell 254 is not near an edge in a 512 world");
  assert.ok(surfaceCornerInWrapBand(515, 0, 512) && !surfaceCornerInWrapBand(516, 0, 512));
  assert.deepEqual(surfaceBorderTileRange(100, 64, 4, true, 512), [-1, 128]);
});

test("v6 view: a pick on a 512 world reaches cell 511 and refuses the border past it", () => {
  const flat = new Uint8Array(512 * 512).fill(10);
  const hit = pickTerrain(flat, [400 * 64 + 20, 300 * 64 + 5, 500], [0, 0, -1]);
  assert.ok(hit);
  assert.deepEqual(hit.cell, [400, 300]);
  assert.equal(hit.point[2], 30);
  const last = pickTerrain(flat, [511 * 64 + 20, 1000, 500], [0, 0, -1]);
  assert.deepEqual(last?.cell, [511, 15]);
  assert.equal(pickTerrain(flat, [512 * 64 + 40, 1000, 500], [0, 0, -1]), null);
});

test("v6 view: the camera roams the whole world and follows tall or sunken ground", () => {
  const cam = new TraxxCamera();
  cam.setWorld(256);
  assert.equal(cam.xyMax, 16383);
  assert.equal(cam.zMin, 0);
  assert.equal(cam.zMax, MAX_Z_POSITION, "a retail track keeps Traxx's ranges");
  cam.setWorld(512);
  cam.move(100000, 0, 0, () => 0);
  assert.equal(cam.y, 32767);
  cam.mapClick(1, 0);
  assert.equal(cam.gridx, 510);
  assert.equal(cam.gridy, 510);
  // Ground from -100 ft (-50 steps, -150 z) to 2000 ft (1000 steps, 3000 z).
  cam.setWorld(512, -150, 3000);
  assert.equal(cam.zMin, -150);
  assert.equal(cam.zMax, 3000 + MAX_Z_POSITION - 768);
  // terrainZRange reads the 32-bit store in v (1/128 ft).
  const h16 = new Int32Array(4);
  h16.set([-100 * 128, 0, 1000 * 128, 2000 * 128]);
  assert.deepEqual(terrainZRange({ terrainMode: TERRAINMODE_CLASSIC16, heights: new Uint8Array(4), h16 }), [-150, 3000]);
});

test("v6 view: course joins and SIT positions wrap at W", () => {
  assert.equal(courseWrapDelta(16000), -384, "256: as before");
  assert.equal(courseWrapDelta(16000, 32768), 16000, "512: no wrap within half the world");
  assert.equal(courseWrapDelta(30000, 32768), -2768);
  assert.deepEqual(courseJoinPieces(32700, 500, 100, 500, 32768), [[32700, 500, 32868, 500], [-68, 500, 100, 500]]);
  assert.deepEqual(traxxSitToIpos(-1), [16382, 0]);
  assert.deepEqual(traxxSitToIpos(-1, 32768), [32766, 0]);
  assert.deepEqual(traxxSitToIpos(10000, 32768), [20000, 0], "a position past 8192 ft is kept");
});

test("v6 view: the overhead map covers a 512 world; ground boxes past cell 255", () => {
  const heights = new Uint8Array(512 * 512);
  heights[8 * 10 + 8 * 20 * 512] = 255;
  const palette = new Uint8Array(768);
  for (let i = 0; i < 256; i++) palette.set([i, i, i], i * 3);
  const map = terrainMap(heights, palette, [[300 * 64, 100 * 64]]);
  assert.equal(map.width, 64);
  // Pixel (10, 20) holds cell (80, 160)'s height; bottom-up rows.
  const at = (i: number, j: number) => map.rgba[(i + (63 - j) * 64) * 4];
  assert.ok(at(10, 20) > 200);
  assert.equal(at(11, 20), at(0, 0));
  // The course start at cell (300, 100) is map pixel (37, 12), marked (not a grey).
  assert.notEqual(at(37, 12), at(36, 12));
  const faces = [0, 0, 0, 0, 0, 0];
  const { ra1 } = boxGrids([{ x: 400, y: 300, w: 1, h: 1, lower: -10, upper: 600, faces }], 512);
  assert.equal(ra1[400 + 300 * 512], 600, "a version 6 box's height is not cut to a byte");
  const pair = groundBoxGeometry([
    { x: 400, y: 300, w: 1, h: 1, lower: 0, upper: 20, faces },
    { x: 401, y: 300, w: 1, h: 1, lower: 0, upper: 20, faces },
  ], null, 512);
  const lone = groundBoxGeometry([{ x: 400, y: 300, w: 1, h: 1, lower: 0, upper: 20, faces }], null, 512);
  assert.ok(pair.faceOf.length < 2 * lone.faceOf.length, "the shared side of two boxes past cell 255 is hidden");
});

test("CameraMaxZ: 1,536 ft unless Tall Heights, then the height limit plus 1,024 ft", () => {
  assert.equal(cameraMaxZ(false, 8192 * 128), MAX_Z_POSITION);
  assert.equal(cameraMaxZ(true, 8192 * 128), (8192 + 1024) * 1.5);
  const cam = new TraxxCamera();
  cam.setWorld(512, 0, 0, cameraMaxZ(true, 8192 * 128));
  assert.equal(cam.zMax, 13824);
});

test("objectsHighZ: objects far above the ground lift the camera ceiling with 1,024 ft of headroom", () => {
  assert.equal(objectsHighZ([]), 0);
  const hi = objectsHighZ([{ ipos: [0, 0, 100], fraction: [0, 0, 0] }, { ipos: [0, 0, 1435], fraction: [0, 0, 128] }]);
  assert.equal(hi, 3 * 1435.5);
  const cam = new TraxxCamera();
  cam.setWorld(256, 0, hi, cameraMaxZ(false, 0));
  assert.equal(cam.zMax, hi + MAX_Z_POSITION - 768);
});
