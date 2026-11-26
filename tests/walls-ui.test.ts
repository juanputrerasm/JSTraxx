/*
  Traxx 1.8.2's Walls mode and Wall window rules (src/core/edit/wall-edit.ts, from
  Traxx/TraxxViewWalls.cpp and Traxx/WallDlg.cpp) and the view's wall drawing
  (src/core/view/wall-draw.ts, from DrawWallsOpenGL, COpenGLTerrainRenderer::DrawWalls and
  OverlayWalls).
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cloneWalls, wallArcFailure, wallCaptureStatus, wallDeleteQuestion, wallFreeName, wallFt, wallInWorldFt, wallMenuEnables, wallMenuTarget,
  wallNearestOnWall, wallPointHasStretch, wallRaw, wallReachFeet, wallReadBox, wallRowText, wallSpinStep, wallTooFar, wallUnits,
  WALL_MSG_ARC_FULL, WALL_MSG_LEAVES_WORLD,
} from "../src/core/edit/wall-edit.ts";
import {
  wallColour, wallDrawList, wallLabelColour, wallLabelPx, wallRunTriangles, wallRunVertices, wallRuns, wallViewShift,
} from "../src/core/view/wall-draw.ts";
import { wallDefaults, WALL_MAX_POINTS, WALL_MAX_WALLS, WALL_UNIT } from "../src/core/traxx/walls.ts";
import { WALL_SIDE_INSIDE, WALL_SIDE_NONE, WALL_SIDE_OUTSIDE, type Wall } from "../src/core/traxx/race-types.ts";

const U = WALL_UNIT;
const pt = (xft: number, zft: number, extra: Partial<Wall["points"][number]> = {}) => ({ x: xft * U, z: zft * U, bend: 0, above: 0, gap: 0 as 0 | 1, ...extra });
const wall = (pts: ReturnType<typeof pt>[], extra: Partial<Wall> = {}): Wall => ({ ...wallDefaults("W"), points: pts, ...extra });
const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test("names: the first free Wall %d, case-insensitive as _stricmp", () => {
  assert.equal(wallFreeName([]), "Wall 1");
  assert.equal(wallFreeName([{ name: "Wall 1" }, { name: "wall 2" }, { name: "Wall 4" }]), "Wall 3");
  assert.equal(wallFreeName([{ name: "WALL 1" }]), "Wall 2");
  assert.equal(wallFreeName([{ name: "Wall 10" }]), "Wall 1");
});

test("messages in Traxx's words", () => {
  assert.equal(wallCaptureStatus(0), "New wall: 0 points - click along the wall; Enter or right-click finishes, Backspace drops a point, Esc cancels");
  assert.equal(wallCaptureStatus(1), "New wall: 1 point - click along the wall; Enter or right-click finishes, Backspace drops a point, Esc cancels");
  assert.equal(wallDeleteQuestion(wall([pt(0, 0)], { name: "Pit" })), "Delete the wall \"Pit\" (1 point)?");
  assert.equal(wallDeleteQuestion(wall([pt(0, 0), pt(10, 0)], { name: "Pit" })), "Delete the wall \"Pit\" (2 points)?");
});

test("the right-click target: under the pointer, else the nearest within 100 px, else none", () => {
  assert.deepEqual(wallMenuTarget({ w: 1, p: 2 }, { w: 0, p: 0 }), { hit: true, w: 1, p: 2 });
  assert.deepEqual(wallMenuTarget(null, { w: 0, p: 3 }), { hit: false, w: 0, p: 3 });
  assert.deepEqual(wallMenuTarget(null, null), { hit: false, w: -1, p: -1 });
});

test("the Walls popup's enables (WallContextMenu)", () => {
  const far = wallMenuEnables(true, wallMenuTarget(null, null), 3, 0, false);
  assert.deepEqual(far, { newWall: true, insertPoint: false, deletePoint: false, properties: false, deleteWall: false });
  const nearOnly = wallMenuEnables(true, wallMenuTarget(null, { w: 0, p: 1 }), 3, 5, false);
  assert.deepEqual(nearOnly, { newWall: true, insertPoint: true, deletePoint: false, properties: true, deleteWall: true });
  const under = wallMenuEnables(true, wallMenuTarget({ w: 0, p: 1 }, null), 3, 5, false);
  assert.equal(under.deletePoint, true);
  // The window open: New Wall and Delete Wall off.
  const open = wallMenuEnables(true, wallMenuTarget({ w: 0, p: 1 }, null), 3, 5, true);
  assert.deepEqual(open, { newWall: false, insertPoint: true, deletePoint: true, properties: true, deleteWall: false });
  // Full walls, full points, off the ground.
  assert.equal(wallMenuEnables(true, wallMenuTarget(null, null), WALL_MAX_WALLS, 0, false).newWall, false);
  assert.equal(wallMenuEnables(true, wallMenuTarget(null, { w: 0, p: 0 }), 1, WALL_MAX_POINTS, false).insertPoint, false);
  assert.equal(wallMenuEnables(false, wallMenuTarget(null, null), 0, 0, false).newWall, false);
});

test("pick reach and the world seam", () => {
  assert.equal(wallReachFeet(3, 5), 5);
  assert.equal(wallReachFeet(null, null), 0.5);
  assert.equal(wallReachFeet(0.1, null), 0.5);
  assert.equal(wallReachFeet(5000, 2), 1000);
  assert.equal(wallReachFeet(9000, null, 100), 5000);
  assert.equal(wallTooFar(8192, 0, 0, 4096 * U, 0), false);
  assert.equal(wallTooFar(8192, 0, 0, 4096 * U + 1, 0), true);
  assert.equal(wallTooFar(16384, 0, 0, 5000 * U, 0), false);
  assert.equal(wallUnits(1.5), 384);
  assert.equal(wallUnits(-0.001), 0);
});

test("the window's hit test reaches only its wall's nearest point (ties keep the first)", () => {
  const w = wall([pt(0, 0), pt(10, 0), pt(5, 0)]);
  assert.equal(wallNearestOnWall(w, 9, 0, 2), 1);
  assert.equal(wallNearestOnWall(w, 2.5, 0, 2.5), 0);
  assert.equal(wallNearestOnWall(w, 100, 0, 2), -1);
});

test("the Wall window's feet boxes", () => {
  assert.equal(wallFt(256), "1.00");
  assert.equal(wallFt(-1), "0.00");
  assert.equal(wallFt(-256 * 3 - 128), "-3.50");
  assert.equal(wallRaw(1.001), 256);
  assert.equal(wallRaw(-0.5), -128);
  assert.equal(wallRaw(1e9), 1000000 * 256);
  assert.equal(wallInWorldFt(-3, 8192), 0);
  assert.equal(wallInWorldFt(9000, 8192), 8192);
  assert.equal(wallReadBox(""), null);
  assert.equal(wallReadBox("-"), null);
  assert.equal(wallReadBox("."), null);
  assert.equal(wallReadBox("12.5"), 12.5);
  assert.equal(wallReadBox(" -3x"), -3);
  assert.equal(wallReadBox("1e999"), null);
  assert.equal(wallReadBox("abc5"), 0);
  assert.equal(wallRowText(pt(120, 45.5), 2), "3: 120.00, 45.50, bend 0.00, above 0.00");
  assert.equal(wallRowText(pt(1, 2, { bend: -64, above: 2560, gap: 1 }), 0), "1: 1.00, 2.00, bend -0.25, above 10.00, gap");
  assert.equal(wallSpinStep("starthead"), 5);
  assert.equal(wallSpinStep("arcangle"), 5);
  assert.equal(wallSpinStep("thick"), 1);
  const open = wall([pt(0, 0), pt(10, 0)]);
  assert.equal(wallPointHasStretch(open, 0), true);
  assert.equal(wallPointHasStretch(open, 1), false);
  assert.equal(wallPointHasStretch({ ...open, closed: 1 }, 1), true);
  assert.equal(wallArcFailure(1021, 720), WALL_MSG_ARC_FULL);
  assert.equal(wallArcFailure(10, 720), WALL_MSG_LEAVES_WORLD);
  const c = cloneWalls([open]);
  c[0]!.points[0]!.x = 99;
  assert.equal(open.points[0]!.x, 0);
});

test("runs: broken at gaps, a closed wall with no gap one loop", () => {
  assert.deepEqual(wallRuns(4, false, [0, 0, 0, 0]), [{ s0: 0, len: 3, loop: false }]);
  assert.deepEqual(wallRuns(4, true, [0, 0, 0, 0]), [{ s0: 0, len: 4, loop: true }]);
  assert.deepEqual(wallRuns(5, false, [0, 1, 0, 0, 0]), [{ s0: 0, len: 1, loop: false }, { s0: 2, len: 2, loop: false }]);
  // Closed with a gap after point 1: one run from 2 round to 1.
  assert.deepEqual(wallRuns(4, true, [0, 1, 0, 0]), [{ s0: 2, len: 3, loop: false }]);
  assert.deepEqual(wallRuns(1, false, [0]), []);
});

test("run vertices: the half-thickness offset to the left, mitred at a corner", () => {
  const x = [0, 10, 10], z = [0, 0, 10], y = [1, 2, 3];
  const v = wallRunVertices(x, z, y, { s0: 0, len: 2, loop: false }, 2);
  assert.equal(v.length, 3);
  near(v[0]!.ox, 0); near(v[0]!.oz, 1);
  // The corner: the normals (0,1) and (-1,0) averaged, lengthened to keep the thickness.
  near(v[1]!.ox, -1); near(v[1]!.oz, 1);
  near(v[2]!.ox, -1); near(v[2]!.oz, 0);
  assert.equal(v[1]!.y, 2);
  // A reversal keeps the first stretch's normal.
  const r = wallRunVertices([0, 10, 0], [0, 0, 0], [0, 0, 0], { s0: 0, len: 2, loop: false }, 2);
  near(r[1]!.ox, 0); near(r[1]!.oz, 1);
  // Two faces of two triangles a stretch, base to base + height.
  const tri = wallRunTriangles(v, 20);
  assert.equal(tri.length, 2 * 2 * 2 * 3 * 3);
  assert.deepEqual(tri.slice(0, 6), [0, 1, -1, 0, 21, -1]);
});

test("the draw list: export, marks, the hot point, the capture, the cap", () => {
  const ground = () => 5;
  const a = wall([pt(0, 0), pt(16, 0, { above: 2 * U })], { side: WALL_SIDE_OUTSIDE, height: 10 * U });
  const list = wallDrawList({ walls: [a], ground, mode: true, ribbons: true, hotWall: 0, hotPoint: 1, capture: [[0, 0], [256, 0]] });
  assert.equal(list.length, 2);
  const G = list[0]!;
  assert.deepEqual(G.x, [0, 8, 16]);
  assert.deepEqual(G.y, [5, 6, 7]);
  assert.deepEqual(G.my, [5, 7]);
  assert.equal(G.hot, 1);
  assert.equal(G.selected, true);
  assert.equal(G.height, 10);
  assert.equal(list[1]!.capture, true);
  assert.deepEqual(list[1]!.mx, [0, 1]);
  // Show Walls off and not in Walls mode: nothing.
  assert.equal(wallDrawList({ walls: [a], ground, mode: false, ribbons: false, hotWall: -1, hotPoint: -1, capture: null }).length, 0);
  // Show Walls off in Walls mode: the marks only.
  const marks = wallDrawList({ walls: [a], ground, mode: true, ribbons: false, hotWall: -1, hotPoint: -1, capture: null });
  assert.equal(marks[0]!.x.length, 0);
  assert.equal(marks[0]!.mx.length, 2);
  // A wall over the export cap: no ribbon, flagged.
  const long = wall([pt(0, 0), pt(4000, 0), pt(4000, 4000), pt(0, 4000)]);
  const over = wallDrawList({ walls: [long], ground, mode: true, ribbons: true, hotWall: -1, hotPoint: -1, capture: null });
  assert.equal(over[0]!.overcap, true);
  assert.equal(over[0]!.x.length, 0);
});

test("colours, the view shift and the labels", () => {
  assert.deepEqual(wallColour(WALL_SIDE_OUTSIDE, false), { rgb: [1.0, 0.55, 0.05], alpha: 0.3, lineWidth: 2 });
  assert.deepEqual(wallColour(WALL_SIDE_INSIDE, false).rgb, [1.0, 0.92, 0.1]);
  assert.deepEqual(wallColour(WALL_SIDE_NONE, false).rgb, [1, 1, 1]);
  const sel = wallColour(WALL_SIDE_OUTSIDE, true);
  near(sel.rgb[1], 0.55 + 0.45 * 0.55);
  assert.equal(sel.alpha, 0.6);
  assert.deepEqual(wallViewShift(100, 100, 3, 3, 8192), [0, 0]);
  assert.deepEqual(wallViewShift(8000, 100, 2, 255, 8192), [-8192, 8192]);
  // Half the on-screen height, 7..12 px; under 7 no name; no base keeps 12.
  assert.equal(wallLabelPx({ x: 0, y: 0 }, { x: 0, y: 40 }), 12);
  assert.equal(wallLabelPx({ x: 0, y: 0 }, { x: 0, y: 19 }), 9);
  assert.equal(wallLabelPx({ x: 0, y: 0 }, { x: 0, y: 14 }), 7);
  assert.equal(wallLabelPx({ x: 0, y: 0 }, { x: 0, y: 13.9 }), null);
  assert.equal(wallLabelPx({ x: 0, y: 0 }, null), 12);
  assert.equal(wallLabelColour(true), "#ffffff");
  assert.equal(wallLabelColour(false), "#ffe640");
});
