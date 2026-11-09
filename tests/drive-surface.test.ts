/*
  Traxx 1.7's drive surface in the view and in placement: the 8 ft LOD ring and its straightened
  edges (SurfaceMesh.cpp), the surface pick (TrackPODTerrain.cpp PickRay, with the 9f861ea
  step-back), and snap to ground (BoxHeightPairOf / Load / Store, ShiftPlacedPoints, the camera).
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  SURFACE_LOD_8FT, SURFACE_LOD_32FT, SURFACE_SIDE_LEFT, SURFACE_SIDE_RIGHT, SURFACE_SIDE_TOP, SURFACE_SIDE_BOTTOM,
  surfaceTileLod, surfaceTileNeighbourLods, surfaceTileStraightSides, surfaceTileHeightGrid, surfaceTileLodsFor, SurfaceTileGrids,
} from "../src/core/view/surface-tiles.ts";
import { pickRay, rayCoarseHit } from "../src/core/traxx/surface-pick.ts";
import { pickSurface } from "../src/core/view/pick.ts";
import { cornerV, fineV, surfaceHeightV } from "../src/core/traxx/surface.ts";
import {
  boxHeightPairLoad, boxHeightPairOf, boxHeightPairStore, cameraGround, copyForClipboard, lightGroundZ, placedGround, shiftPlaced, type PlacedPoint,
} from "../src/core/traxx/box-ground.ts";
import { TERRAINMODE_CLASSIC8, TERRAINMODE_CLASSIC16, TERRAINMODE_FINE, type Terrain16 } from "../src/core/traxx/terrain16.ts";
import { traxxBoxDefaults } from "../src/core/traxx/sit.ts";
import { interpolateRawAtPoint } from "../src/core/traxx/terrain.ts";
import { TraxxCamera } from "../src/core/view/camera.ts";
import { deriveBoxHeights } from "../src/core/doc/load-pod.ts";
import { dragObjects, insertObject, moveObjects, raiseObjects } from "../src/core/edit/objects.ts";

/* A pseudo-random generator, so the grids are the same every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
}

function fullMap(fill: (fx: number, fy: number) => number): Terrain16 {
  const fine = new Uint16Array(1024 * 1024);
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) fine[x + (y << 10)] = fill(x, y);
  return { terrainMode: TERRAINMODE_FINE, h16: null, fine, rawShadow: new Uint8Array(65536), heights: new Uint8Array(65536) };
}

function sixteen(fill: (gx: number, gy: number) => number): Terrain16 {
  const h16 = new Uint16Array(65536);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) h16[x + (y << 8)] = fill(x, y);
  return { terrainMode: TERRAINMODE_CLASSIC16, h16, fine: null, rawShadow: new Uint8Array(65536), heights: new Uint8Array(65536) };
}

test("the 8 ft ring: tiles within 8 tiles of the camera's tile, 32 ft beyond and on 16-bit", () => {
  // Camera at cell (130, 61): tile (32, 15).
  assert.equal(surfaceTileLod(true, 32, 15, 130, 61), SURFACE_LOD_8FT);
  assert.equal(surfaceTileLod(true, 24, 7, 130, 61), SURFACE_LOD_8FT);
  assert.equal(surfaceTileLod(true, 40, 23, 130, 61), SURFACE_LOD_8FT);
  assert.equal(surfaceTileLod(true, 23, 15, 130, 61), SURFACE_LOD_32FT);
  assert.equal(surfaceTileLod(true, 32, 24, 130, 61), SURFACE_LOD_32FT);
  assert.equal(surfaceTileLod(false, 32, 15, 130, 61), SURFACE_LOD_32FT, "no 8 ft surface: 32 ft everywhere");
  // A negative cell floors into tile -1 (SurfaceFloorDiv).
  assert.equal(surfaceTileLod(true, 7, 0, -1, 0), SURFACE_LOD_8FT);
  assert.equal(surfaceTileLod(true, 8, 0, -1, 0), SURFACE_LOD_32FT);
  // Neighbours: the ring's last tile faces a 32 ft one; off the map counts as the tile's own.
  const nbr = surfaceTileNeighbourLods(true, 40, 15, 130, 61);
  assert.deepEqual(nbr, [SURFACE_LOD_8FT, SURFACE_LOD_32FT, SURFACE_LOD_8FT, SURFACE_LOD_8FT]);
  assert.equal(surfaceTileStraightSides(SURFACE_LOD_8FT, nbr), 1 << SURFACE_SIDE_RIGHT);
  assert.equal(surfaceTileStraightSides(SURFACE_LOD_32FT, [32, 32, 32, 32]), 0, "a 32 ft tile never straightens");
  assert.deepEqual(surfaceTileNeighbourLods(true, 0, 0, 2, 2), [SURFACE_LOD_8FT, SURFACE_LOD_8FT, SURFACE_LOD_8FT, SURFACE_LOD_8FT]);
  assert.equal(surfaceTileLodsFor({ terrainMode: TERRAINMODE_CLASSIC16 }, 32, 15, 130, 61).lod, SURFACE_LOD_32FT);
});

test("an 8 ft tile's grid: the 8 ft points inside, straightened onto the 32 ft chord where it meets a 32 ft tile", () => {
  const r = lcg(7);
  const t = fullMap(() => 2000 + (r() % 30000));
  const lods = [SURFACE_LOD_32FT, SURFACE_LOD_8FT, SURFACE_LOD_32FT, SURFACE_LOD_8FT];
  const tx = 10, ty = 20;
  const { n, v } = surfaceTileHeightGrid(t, tx, ty, SURFACE_LOD_8FT, lods);
  assert.equal(n, 17);
  // Interior points and the unstraightened sides are FineV.
  assert.equal(v[5 * n + 6], fineV(t, tx * 16 + 6, ty * 16 + 5));
  assert.equal(v[3 * n + 16], fineV(t, tx * 16 + 16, ty * 16 + 3), "the right side faces an 8 ft tile");
  // Left (x = 0) and top (y = 0) are on the 32 ft neighbours' straight edges, per 32 ft cell.
  for (let k = 0; k < n; k++) {
    const c = Math.trunc(k / 4), f = k % 4;
    const left = (cornerV(t, tx * 4, ty * 4 + c) * (4 - f) + cornerV(t, tx * 4, ty * 4 + c + 1) * f) / 4;
    const top = (cornerV(t, tx * 4 + c, ty * 4) * (4 - f) + cornerV(t, tx * 4 + c + 1, ty * 4) * f) / 4;
    assert.equal(v[k * n], left);
    assert.equal(v[k], top);
  }
  // The neighbour's own 32 ft grid along the shared edge: the same line, so no crack.
  const west = surfaceTileHeightGrid(t, tx - 1, ty, SURFACE_LOD_32FT, [32, 32, 32, 32]);
  assert.equal(west.n, 5);
  for (let c = 0; c <= 4; c++) assert.equal(west.v[c * 5 + 4], v[c * 4 * n], "the corners agree");
  for (let c = 0; c < 4; c++) {
    const a = west.v[c * 5 + 4]!, b = west.v[(c + 1) * 5 + 4]!;
    for (let f = 1; f < 4; f++) assert.equal(v[(c * 4 + f) * n], a + ((b - a) * f) / 4, "mid-edge points lie on the chord");
  }
  // The cache hands out the tile's grid at its drawn level, `per` points a cell side.
  assert.equal(new SurfaceTileGrids(t, 0, 0).per(tx * 4, ty * 4), 1, "far from the camera: 32 ft");
  const g2 = new SurfaceTileGrids(t, tx * 4, ty * 4);
  assert.equal(g2.per(tx * 4, ty * 4), 4);
  assert.equal(g2.at(tx * 4 + 1, ty * 4 + 2, 3, 2), fineV(t, (tx * 4 + 1) * 4 + 3, (ty * 4 + 2) * 4 + 2));
});

test("the surface pick: exact on 16-bit, through the window's cells, with the pick's fractions", () => {
  // A plane rising 256 v (one step) a cell along x: v = 4000 + 256 gx.
  const t = sixteen((gx) => 4000 + 256 * gx);
  // Straight down at (10.25 cells, 7.5 cells) from high up.
  const org = [10.25 * 16384, 7.5 * 16384, 60000] as const, dir = [0, 0, -1] as const;
  const hit = pickRay(t, org, dir, 0, 0, 0, 30, 30)!;
  assert.ok(hit);
  const z = org[2] - hit.t;
  assert.ok(Math.abs(z - surfaceHeightV(t, org[0], org[1])) < 1e-6, "the hit is on the surface");
  assert.deepEqual([hit.cellx, hit.celly], [10, 7]);
  assert.equal(rayCoarseHit(t, org, dir, 0, 11, 0, 30, 30), null, "outside the window: no hit");
  assert.equal(pickRay({ ...t, terrainMode: TERRAINMODE_CLASSIC8 }, org, dir, 0, 0, 0, 30, 30), null, "Classic 8-bit picks elsewhere");
  // In scene units: x, y ipos, z 3 per step.
  const scene = pickSurface(t, [10.25 * 64, 7.5 * 64, 2000], [0, 0, -1], { x0: 0, y0: 0, n: 64 })!;
  assert.deepEqual(scene.ipos, [656, 480, Math.floor((4000 + 256 * 10.25) / 256)]);
  assert.deepEqual(scene.fraction, [0, 0, (4000 + 256 * 10.25) & 255]);
  assert.deepEqual(scene.cell, [10, 7]);
  assert.deepEqual(scene.vertex, [10, 8], "the nearer corner on each axis");
});

test("the surface pick on a Full Map meets the 8 ft surface, stepping back in front of a crest (9f861ea)", () => {
  // Low (1000 v) on the 32 ft points, high (7000 v) on every 8 ft point between: the coarse
  // triangles see only the low flat, the drawn surface is a wall of crests.
  const t = fullMap((fx) => ((fx & 3) !== 0 ? 7000 : 1000));
  // A shallow ray along +x at y = 20.5 cells, falling 80 v a foot from v 7100: it meets the coarse
  // flat at 76.25 ft, but 64 ft (of ray) before that it is already under a crest, so the march
  // steps back to the ray's start and finds the first crest's flank, inside the first 9 ft.
  const y = 20.5 * 16384;
  const org = [0, y, 7100] as const, dir = [512, 0, -80] as const;
  const coarse = rayCoarseHit(t, org, dir, 0, 0, 0, 255, 255)!;
  assert.ok(Math.abs(coarse.t - 76.25) < 1e-6);
  const hit = pickRay(t, org, dir, 0, 0, 0, 255, 255)!;
  const x = org[0] + hit.t * dir[0], z = org[2] + hit.t * dir[2];
  assert.ok(x < 4608, `the first crest, not the coarse hit (x ${x})`);
  assert.ok(Math.abs(z - surfaceHeightV(t, Math.floor(x + 0.5), Math.floor(y + 0.5))) < 2, "on the drawn surface");
});

test("BoxHeightPairOf / Load / Store: the height above the drive surface, zfraction absolute", () => {
  // A slope with fractions: v = 3000 + 37 gx + 11 gy.
  const t = sixteen((gx, gy) => 3000 + 37 * gx + 11 * gy);
  const b = traxxBoxDefaults();
  b.ipos = [100 * 64 + 13, 50 * 64 + 40, 0];
  b.fraction = [77, 200, 0];
  b.heightAboveGround = 5;
  b.fraction[2] = 100;
  boxHeightPairStore(t, b);
  const ground = surfaceHeightV(t, b.ipos[0] * 256 + 77, b.ipos[1] * 256 + 200);
  assert.equal(b.ipos[2] * 256 + b.fraction[2], ground + 5 * 256 + 100);
  assert.deepEqual(boxHeightPairOf(t, b), [5, 100]);
  // Moved across the slope it keeps its height above the ground, fraction and all.
  moveObjects([b], t, 64000, 3000);
  assert.deepEqual(boxHeightPairOf(t, b), [5, 100]);
  raiseObjects([b], t, 50);
  assert.deepEqual(boxHeightPairOf(t, b), [5, 228]);
  // Load gives the pair; Store puts it back.
  const before = [...b.ipos, b.fraction[2]];
  boxHeightPairLoad(t, b);
  assert.deepEqual([b.heightAboveGround, b.fraction[2]], [5, 228]);
  boxHeightPairStore(t, b);
  assert.deepEqual([...b.ipos, b.fraction[2]], before);
  // The clipboard holds the pair.
  const c = copyForClipboard(t, b);
  assert.deepEqual([c.heightAboveGround, c.fraction[2]], [5, 228]);
  // DeriveBoxHeightsAboveGround keeps the absolute position and floors the height.
  const track = { boxes: [structuredClone(b)], ...t };
  track.boxes[0]!.heightAboveGround = 99;
  deriveBoxHeights(track);
  assert.equal(track.boxes[0]!.heightAboveGround, 5);
  assert.deepEqual(track.boxes[0]!.ipos, b.ipos);
});

test("Classic 8-bit keeps the whole-step rules", () => {
  const heights = new Uint8Array(65536).map((_, i) => (i * 7) & 127);
  const b = traxxBoxDefaults();
  b.ipos = [1000, 2000, 0];
  b.heightAboveGround = 3;
  b.fraction[2] = 40;
  boxHeightPairLoad(heights, b);
  assert.deepEqual([b.heightAboveGround, b.fraction[2]], [3, 40], "Load does nothing");
  boxHeightPairStore(heights, b);
  assert.equal(b.ipos[2], interpolateRawAtPoint(heights, 1000, 2000) + 3);
  assert.equal(b.fraction[2], 40);
  assert.equal(cameraGround(heights, 1000, 2000), interpolateRawAtPoint(heights, 1000, 2000));
  assert.equal(lightGroundZ(heights, 1000, 2000, 3), 3 * interpolateRawAtPoint(heights, 1000, 2000));
});

test("insert and drag seat on the drive surface with the pick's x / y fractions", () => {
  const t = sixteen((gx, gy) => 3000 + 37 * gx + 11 * gy);
  const track = { ...t, boxes: [] as ReturnType<typeof traxxBoxDefaults>[] } as unknown as Parameters<typeof insertObject>[0];
  const i = insertObject(track, [6413, 3240, 999], [77, 200, 5])!;
  const b = track.boxes[i]!;
  assert.deepEqual(b.fraction.slice(0, 2), [77, 200]);
  assert.deepEqual(boxHeightPairOf(t, b), [0, 0], "on the ground, the pick's z ignored");
  b.heightAboveGround = 2; b.fraction[2] = 0;
  boxHeightPairStore(t, b);
  dragObjects(track, [i], [7000, 3000, 0], [10, 20, 0]);
  assert.deepEqual([b.ipos[0], b.ipos[1], b.fraction[0], b.fraction[1]], [7000, 3000, 10, 20]);
  assert.deepEqual(boxHeightPairOf(t, b), [2, 0], "the height above the ground kept");
});

test("ShiftPlacedPoints: an object takes the exact change, a truck the nearest step, telescoping", () => {
  const t = sixteen(() => 5000);
  const obj: PlacedPoint = { ipos: [3000, 3000, 30], fraction: [0, 0, 10] };
  const truck: PlacedPoint = { ipos: [3000, 3000, 30] };
  const g0 = [placedGround(t, obj), placedGround(t, truck)];
  t.h16!.fill(5000 + 300);
  shiftPlaced(t, obj, g0[0]!);
  shiftPlaced(t, truck, g0[1]!);
  assert.deepEqual([obj.ipos[2], obj.fraction![2]], [31, 10 + 300 - 256]);
  assert.equal(truck.ipos[2], 30 + (((5300 + 128) >> 8) - ((5000 + 128) >> 8)));
  // Undo: the ground goes back, and both points with it.
  const g1 = [placedGround(t, obj), placedGround(t, truck)];
  t.h16!.fill(5000);
  shiftPlaced(t, obj, g1[0]!);
  shiftPlaced(t, truck, g1[1]!);
  assert.deepEqual([obj.ipos[2], obj.fraction![2], truck.ipos[2]], [30, 10, 30]);
});

test("the camera keeps the ground's fraction: (ALTITUDESCALE x total) >> 8", () => {
  const t = sixteen(() => 100 * 256 + 171);
  const cam = new TraxxCamera();
  cam.resetForTrack((x, y) => cameraGround(t, x, y));
  assert.equal(cam.z, ((3 * (100 * 256 + 171)) >> 8) + 300);
  assert.equal(lightGroundZ(t, 8192, 8192, 3), (3 * ((100 * 256 + 171) >> 2)) / 64);
});

test("16-bit has no 8 ft tiles; the side constants are Traxx's", () => {
  assert.deepEqual([SURFACE_SIDE_LEFT, SURFACE_SIDE_RIGHT, SURFACE_SIDE_TOP, SURFACE_SIDE_BOTTOM], [0, 1, 2, 3]);
  const t = sixteen((gx, gy) => gx * 100 + gy);
  const { n, v } = surfaceTileHeightGrid(t, 3, 4, SURFACE_LOD_8FT, [8, 8, 8, 8]);
  assert.equal(n, 5);
  assert.equal(v[2 * 5 + 1], cornerV(t, 13, 18));
});
