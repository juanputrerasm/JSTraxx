/*
  Traxx 1.7's 16-bit terrain editing (Traxx/TraxxViewEdit.cpp MakeEditGrid, ApplyEditGrid,
  OnTerrainCopy, OnTerrainPaste, OnTerrainPasteBitmap; TraxxViewDisplay.cpp OverlayTerrainGrid;
  TraxxFrame.cpp's Altitude box), after tools/terraintest.cpp's Task 6 and 7 checks.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  altitudeV, applyBrush, applyEditGrid, brushPreview, copyArea, makeEditGrid, pasteArea, pasteBitmapHeights, pasteFits,
  previewLabel, stampWindow, terrainWholeSteps, type BrushParams,
} from "../src/core/edit/terrain.ts";
import { amplitudeFractional, amplitudeFromText, amplitudeText, editSizeMax, stepAmplitude, wholeAmplitude } from "../src/core/edit/amplitude.ts";
import { recordWindow } from "../src/core/edit/record.ts";
import { TERRAINMODE_CLASSIC8, TERRAINMODE_CLASSIC16, TERRAINMODE_FINE, type Terrain16 } from "../src/core/traxx/terrain16.ts";

const base: BrushParams = { tool: 0, width: 5, height: 5, orientation: 0, curvature: 3, altitude: 32 };

function classic16(fill = 100 * 256 + 77): Terrain16 {
  const h16 = new Uint16Array(65536).fill(fill);
  const heights = new Uint8Array(65536).fill((fill + 128) >> 8);
  return { terrainMode: TERRAINMODE_CLASSIC16, h16, fine: null, rawShadow: heights.slice(), heights };
}

function fullMap(fill = 50 * 256 + 33): Terrain16 {
  const fine = new Uint16Array(1024 * 1024).fill(fill);
  const heights = new Uint8Array(65536).fill((fill + 128) >> 8);
  return { terrainMode: TERRAINMODE_FINE, h16: null, fine, rawShadow: heights.slice(), heights };
}

test("TerrainWholeSteps rounds half away from zero; the Altitude travels in v", () => {
  assert.equal(terrainWholeSteps(128), 1);
  assert.equal(terrainWholeSteps(127), 0);
  assert.equal(terrainWholeSteps(-128), -1);
  assert.equal(terrainWholeSteps(-127), 0);
  assert.equal(altitudeV(0.5), 128);
  assert.equal(altitudeV(-32), -8192);
});

test("MakeEditGrid builds terraingridv at the fractional amplitude", () => {
  const whole = makeEditGrid(base);
  assert.ok(whole.gridV.every((v) => v === 32 * 256), "a whole Platform is its steps << 8");
  const half = makeEditGrid({ ...base, altitude: 0.5 });
  assert.ok(half.grid.every((v) => v === 1), "the classic stamp takes the nearest whole step");
  assert.ok(half.gridV.every((v) => v === 128), "the 16-bit stamp keeps the half step");
  const hill = makeEditGrid({ ...base, tool: 1, width: 9, height: 9, altitude: 10.25 });
  assert.equal(hill.gridV[4 * 9 + 4], 2624, "a hill peaks at the altitude in v");
  assert.ok(hill.gridV[0]! < 2624 && hill.gridV[0]! >= 0);
  const curved = makeEditGrid({ ...base, tool: 3, width: 9, height: 9, altitude: 0.75, curvature: 5 });
  assert.equal(curved.grid[4 * 9 + 4], 1);
  assert.equal(curved.gridV[4 * 9 + 4], 192, "the curvature works on the v table too");
  const flat = makeEditGrid({ ...base, tool: 1, altitude: 0, curvature: 5 });
  assert.ok(flat.gridV.every((v) => v === 0), "no amplitude, no stamp (fpixelv 0)");
});

test("the brush counts 8 ft points, 1-100, on a Full Map and 32 ft cells, 1-25, elsewhere", () => {
  assert.equal(makeEditGrid({ ...base, width: 80, height: 3 }).width, 25, "a stale width never builds an outsized stamp");
  assert.equal(makeEditGrid({ ...base, width: 80, height: 3, fine: true }).width, 80);
  assert.equal(makeEditGrid({ ...base, width: 100, height: 100, orientation: 1, fine: true }).width, 141, "rotation widens it by up to sqrt 2");
  assert.equal(makeEditGrid({ ...base, width: 25, height: 25, orientation: 1 }).width, 35);
  assert.equal(editSizeMax(TERRAINMODE_FINE), 100);
  assert.equal(editSizeMax(TERRAINMODE_CLASSIC16), 25);
  assert.equal(editSizeMax(null), 25);
});

test("the brush on CLASSIC16 writes h16 and keeps fractions; classic 8-bit keeps its bytes", () => {
  const t = classic16();
  t.h16![200 + 200 * 256] = 1234;
  const p = { ...base, altitude: 0.5 };
  applyBrush(t, makeEditGrid(p), p, 10, 10);
  assert.equal(t.h16![10 + 10 * 256], 100 * 256 + 77 + 128, "half a step added on top of the fraction");
  assert.equal(t.h16![7 + 10 * 256], 100 * 256 + 77, "outside the stamp untouched");
  assert.equal(t.h16![200 + 200 * 256], 1234);
  assert.equal(t.heights[10 + 10 * 256], (100 * 256 + 77 + 128 + 128) >> 8, "the mirror follows");
  assert.deepEqual(t.rawShadow, t.heights);
  const m = { ...base, tool: 7, altitude: -0.25 };
  applyBrush(t, makeEditGrid(m), m, 50, 50);
  assert.equal(t.h16![50 + 50 * 256], 100 * 256 + 77 - 64, "Direct Edit steps a quarter");
  const pl = { ...base, tool: 6, altitude: 3.5 };
  applyBrush(t, makeEditGrid(pl), pl, 60, 60);
  assert.equal(t.h16![60 + 60 * 256], 896, "Plane sets the level in v");
  // The 16-bit stamp clips at the map edge, as the 8-bit brush does.
  applyBrush(t, makeEditGrid(p), p, 0, 0);
  assert.equal(t.h16![255 + 255 * 256], 100 * 256 + 77);

  const raw = new Uint8Array(65536).fill(100);
  const c8: Terrain16 = { terrainMode: TERRAINMODE_CLASSIC8, h16: null, fine: null, rawShadow: null, heights: raw };
  applyBrush(c8, makeEditGrid({ ...base, altitude: 2 }), { ...base, altitude: 2 }, 10, 10);
  assert.equal(raw[10 + 10 * 256], 102);
  applyEditGrid(raw, makeEditGrid(base), { ...base, tool: 7, altitude: 3 }, 20, 20);
  assert.equal(raw[20 + 20 * 256], 103);
});

test("the Full Map brush works on 8 ft points and wraps", () => {
  const t = fullMap();
  const p = { ...base, altitude: 1.5, fine: true };
  const eg = makeEditGrid(p);
  applyBrush(t, eg, p, 0, 1023);
  const at = (x: number, y: number) => t.fine![(x & 1023) + (y & 1023) * 1024];
  const raised = 50 * 256 + 33 + 384;
  assert.equal(at(0, 1023), raised);
  assert.equal(at(1022, 1021), raised, "wraps to the far side on both axes");
  assert.equal(at(2, 1), raised);
  assert.equal(at(3, 1023), 50 * 256 + 33);
  assert.equal(at(0, 2), 50 * 256 + 33);
  assert.equal(t.heights[0 + 0 * 256], (raised + 128) >> 8, "the mirror reads the 32 ft points");
  assert.equal(t.heights[1], (50 * 256 + 33 + 128) >> 8);

  // Smooth reads the grid as it was and wraps its neighbours too.
  const s = fullMap(1000);
  s.fine![5 + 5 * 1024] = 2000;
  const sp = { ...base, tool: 5, width: 3, height: 3, fine: true };
  applyBrush(s, makeEditGrid(sp), sp, 5, 5);
  assert.equal(s.fine![5 + 5 * 1024], 1000);
  const e = fullMap(1000);
  e.fine![1023] = 2000;
  applyBrush(e, makeEditGrid(sp), sp, 0, 0);
  assert.equal(e.fine![0], 1250, "(2000 + 3 * 1000 + 2) >> 2 across the seam");
});

test("the undo window wraps with the grid", () => {
  const t = fullMap();
  const p = { ...base, width: 7, height: 7, altitude: 2, fine: true };
  const eg = makeEditGrid(p);
  const win = stampWindow(t, eg.width, eg.height, 1, 1);
  assert.deepEqual([win.x0, win.y0, win.w, win.h], [-2, -2, 7, 7]);
  assert.deepEqual(win.touch, { minX: 0, minY: 0, maxX: 255, maxY: 255 }, "across the seam: the whole axis");
  const inner = stampWindow(t, 7, 7, 400, 400);
  assert.deepEqual(inner.coarse, { x0: 99, y0: 99, w: 2, h: 2 }, "points 397..403 hold the 32 ft points 99 and 100");
  assert.deepEqual(inner.touch, { minX: 98, minY: 98, maxX: 101, maxY: 101 });
  const before = t.fine!.slice(), raw = t.heights.slice();
  const recs = [recordWindow(t.fine!, 1024, win.x0, win.y0, win.w, win.h, "x", {}),
    recordWindow(t.heights, 256, win.coarse.x0, win.coarse.y0, win.coarse.w, win.coarse.h, "x", {})];
  applyBrush(t, eg, p, 1, 1);
  const changes = recs.map((r) => r.finish()!);
  assert.ok(changes.every(Boolean));
  const after = t.fine!.slice();
  changes.forEach((c) => c.undo());
  assert.deepEqual(t.fine, before, "undo puts every point back, the far side included");
  assert.deepEqual(t.heights, raw);
  changes.forEach((c) => c.redo());
  assert.deepEqual(t.fine, after);
});

test("Copy / Paste Area: h16 whole with fractions, 8 ft blocks wrap, each on its own kind of grid", () => {
  const t = classic16(0);
  for (let i = 0; i < 65536; i++) t.h16![i] = (i * 37) & 0xffff;
  const block = copyArea(t, 3, 5, 10, 20);
  assert.equal(block.fine, false);
  assert.equal(block.data[0], t.h16![9 + 18 * 256]);
  const dst = classic16(0);
  assert.ok(pasteArea(dst, block, 100, 50));
  assert.equal(dst.h16![99 + 48 * 256], t.h16![9 + 18 * 256], "a block that is not square pastes as copied");
  assert.equal(dst.h16![101 + 52 * 256], t.h16![11 + 22 * 256]);
  assert.equal(dst.h16![102 + 50 * 256], 0);
  assert.equal(dst.heights[99 + 48 * 256], Math.min(255, (t.h16![9 + 18 * 256]! + 128) >> 8));
  const edge = copyArea(t, 3, 3, 0, 0);
  assert.equal(edge.data[0], -1, "off the map is not copied on a clipped grid");

  const raw = new Uint8Array(65536);
  for (let i = 0; i < 65536; i++) raw[i] = i & 255;
  const c8: Terrain16 = { terrainMode: TERRAINMODE_CLASSIC8, h16: null, fine: null, rawShadow: null, heights: raw };
  const b8 = copyArea(c8, 5, 1, 10, 0);
  assert.equal(b8.data[0], 8 << 8, "a classic block is kept in v");
  const r8: Terrain16 = { ...c8, heights: new Uint8Array(65536) };
  pasteArea(r8, b8, 30, 30);
  assert.deepEqual([...r8.heights.subarray(28 + 30 * 256, 33 + 30 * 256)], [8, 9, 10, 11, 12], "and pasted back as the same bytes");

  const f = fullMap(0);
  for (let i = 0; i < f.fine!.length; i++) f.fine![i] = i & 0xffff;
  const fb = copyArea(f, 4, 4, 0, 0);
  assert.equal(fb.fine, true);
  assert.equal(fb.data[0], f.fine![1023 + 1023 * 1024], "an 8 ft block wraps");
  assert.equal(pasteFits(fb, t), false, "8 ft points do not paste on a 32 ft grid");
  assert.equal(pasteFits(block, f), false, "nor 32 ft cells on a Full Map");
  assert.equal(pasteArea(t, fb, 5, 5), false);
  const g = fullMap(0);
  pasteArea(g, fb, 1023, 1023);
  assert.equal(g.fine![1022 + 1022 * 1024], f.fine![1023 + 1023 * 1024]);
  assert.equal(g.fine![1 + 1 * 1024], f.fine![2 + 2 * 1024], "and pastes across the seam");
});

test("Paste Bitmap writes b << 8 into h16 and refuses a Full Map", () => {
  const t = classic16();
  const pic = new Uint8Array(65536).fill(40);
  assert.ok(pasteBitmapHeights(t, pic));
  assert.ok(t.h16!.every((v) => v === 40 << 8), "every cell, fractions gone, as Traxx");
  assert.equal(t.heights[123], 40);
  assert.equal(pasteBitmapHeights(fullMap(), pic), false);
});

test("the overlay: v on 16-bit tracks, thinned 8 ft points on a Full Map", () => {
  const t = classic16(10 * 256 + 64);
  const p = { ...base, altitude: 1.5 };
  const pv = brushPreview(t, makeEditGrid(p), p, 50, 50);
  assert.equal(pv.precise, true);
  assert.equal(pv.spacing, 64);
  assert.equal(pv.cols.length, 5);
  assert.equal(pv.baseV, 10 * 256 + 64);
  assert.equal(pv.editV, 10 * 256 + 64 + 384);
  assert.equal(previewLabel(pv.editV, true), "11.8");
  assert.equal(previewLabel(pv.baseV, true), "10.2", "%.1f of 10.25: the exact tie goes to even");
  assert.equal(previewLabel(-10 * 256 - 64 - 1, true), "-10.3");
  const plane = brushPreview(t, makeEditGrid({ ...p, tool: 6, altitude: 0 }), { ...p, tool: 6, altitude: 0 }, 50, 50);
  assert.equal(plane.editV, 256, "a Plane at 0 or below previews one step");

  const f = fullMap();
  const big = { ...base, width: 90, height: 45, fine: true };
  const fp = brushPreview(f, makeEditGrid(big), big, 3, 3);
  assert.equal(fp.spacing, 16);
  assert.equal(fp.cols[1], 4, "every 4th point above 80");
  assert.ok(fp.cols.includes(44) && fp.cols.includes(89), "with the centre and the far edge");
  assert.equal(fp.cols[fp.ci], 44);
  assert.equal(fp.rows[fp.cj], 22);

  const raw = new Uint8Array(65536).fill(100);
  const c8: Terrain16 = { terrainMode: TERRAINMODE_CLASSIC8, h16: null, fine: null, rawShadow: null, heights: raw };
  const cp = brushPreview(c8, makeEditGrid(base), base, 0, 0);
  assert.equal(cp.precise, false);
  assert.equal(cp.v[0], 0, "off the map is drawn at 0");
  assert.equal(previewLabel(cp.editV, false), "132");
});

test("the Altitude box: decimal steps on 16-bit tracks, whole steps on classic", () => {
  assert.equal(amplitudeFractional(TERRAINMODE_CLASSIC16), true);
  assert.equal(amplitudeFractional(TERRAINMODE_CLASSIC8), false);
  assert.equal(amplitudeFractional(null), false);
  assert.equal(amplitudeFromText("1,5", true), 384, "a decimal comma");
  assert.equal(amplitudeFromText("0.1", true), 26);
  assert.equal(amplitudeFromText("2.5", false), 768, "half away from zero");
  assert.equal(amplitudeFromText("-2.5", false), -768);
  assert.equal(amplitudeFromText("junk", true), 0);
  assert.equal(amplitudeFromText("1e9", true), 100000 * 256);
  assert.equal(amplitudeText(26, true), "0.1");
  assert.equal(amplitudeText(384, true), "1.5");
  assert.equal(amplitudeText(8192, true), "32");
  assert.equal(amplitudeText(32, true), "0.12", "%.2f prints the exact tie 0.125 to even");
  assert.equal(amplitudeText(-1, true), "0", "-0 reads as 0");
  assert.equal(amplitudeText(-26, true), "-0.1");
  assert.equal(amplitudeText(300 * 256, true), "255");
  assert.equal(amplitudeText(-384, false), "-2");
  assert.equal(stepAmplitude("0.1", 1), 51, "a click is 0.1 from the text as it reads");
  assert.equal(amplitudeText(stepAmplitude("0.1", 1), true), "0.2");
  assert.equal(stepAmplitude("254.95", 1), 255 * 256);
  assert.equal(stepAmplitude("-0,1", -1), -51);
  assert.equal(wholeAmplitude(384), 512);
  assert.equal(wholeAmplitude(-384), -512);
});
