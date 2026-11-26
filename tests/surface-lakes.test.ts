/*
  Traxx 1.7's drive surface, Terrain Grid conversions and lakes (TrackPODTerrain.cpp,
  TrackPODLakes.cpp). The cp4sandbox check rebuilds fog_test.txx's lakes into a .WTR and compares
  it with WORLD\FOGTEST.WTR in the fog_test.pod Traxx 1.7 wrote; it skips when absent.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { findPodEntry, readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { readTxx } from "../src/core/traxx/txx.ts";
import { resetTrack, newTrackDocument } from "../src/core/doc/new-track.ts";
import { buildTrackPod } from "../src/core/traxx/pod-writer.ts";
import { interpolateRawAtPoint } from "../src/core/traxx/terrain.ts";
import {
  TERRAINMODE_CLASSIC16, TERRAINMODE_CLASSIC8, TERRAINMODE_FINE, TERRAINMODE_SPLINE,
} from "../src/core/traxx/terrain16.ts";
import {
  applyStamp16, buildLakeGround, cornerV, fineVertexAtPoint, getSurface, groundAt, importHeights, planarExpand, setMode,
  smoothFineFromCoarse, surfaceHeightV, terrainConvertMessage,
} from "../src/core/traxx/surface.ts";
import {
  buildWtr, fitHeight8, lakeFitHeight, lakeSpill, nearestLegalHeight8, parseWtrLakes, recomputeLakes, LAKEERR_LEAK,
  LAKEERR_CORNER_AT_H, LAKE_NO_BASIN, LAKES_NOT_SAVED, lakeNotches, lakeHasNotches, lakeHoldsUpTo, lakeMinHeight, lakeNearestLegalHeight,
  setNotchFarHolds, trackLakes,
} from "../src/core/traxx/lakes.ts";
import { LAKE_LIP_W, LAKE_RULE_TILE, setLakeDefaultRule } from "../src/core/traxx/lake-ground.ts";
import { fallDefaults } from "../src/core/traxx/falls.ts";

/*
  Every test here is the TILE rule's (Traxx 1.7.0 / 1.7.1, the rule of the .WTR files built before
  Traxx 1.7.3): the default flips for this file, as laketest does for its tests of that rule. The
  EDGE rule's tests are in lakes-edge.test.ts.
*/
setLakeDefaultRule(LAKE_RULE_TILE);

const CP4 = process.env.JSTRAXX_CP4 ?? join(process.env.HOME ?? "", "games", "cp4sandbox");
const TXX = join(CP4, "fog_test.txx");
const POD = join(CP4, "fog_test.pod");
const noBoth = existsSync(TXX) && existsSync(POD) ? false : "no cp4sandbox fog_test";

function hilly() {
  const t = resetTrack();
  for (let z = 0; z < 256; z++) for (let x = 0; x < 256; x++) t.heights[x + (z << 8)] = 100 + ((x * 7 + z * 13) % 40);
  return t;
}

test("PlanarExpand keeps the classic triangles: every fine point is the 8-bit surface << 8 at its corners", () => {
  const t = hilly();
  const h = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) h[i] = t.heights[i] << 8;
  const f = planarExpand(h);
  for (let z = 0; z < 254; z += 17) for (let x = 0; x < 254; x += 13) assert.equal(f[(4 * z << 10) + 4 * x], t.heights[x + (z << 8)] << 8);
  // Inside cells the surface is the triangle of SurfaceHeightV on h16.
  const c = resetTrack();
  c.heights.set(t.heights);
  setMode(c, TERRAINMODE_CLASSIC16);
  for (let k = 0; k < 200; k++) {
    const fx = (k * 37) % 1020, fy = (k * 91) % 1020;
    assert.equal(f[fx + (fy << 10)], surfaceHeightV(c, fx * 4096, fy * 4096));
  }
});

test("SetMode table: up from 8-bit is exact, down rounds, Full Map to 32 ft keeps every 4th point", () => {
  const t = hilly();
  const raw = t.heights.slice();
  assert.ok(setMode(t, TERRAINMODE_CLASSIC16));
  assert.equal(t.h16![300], raw[300] << 8);
  t.h16![300] += 100;
  assert.ok(setMode(t, TERRAINMODE_SPLINE));
  assert.equal(t.h16![300], (raw[300] << 8) + 100);
  assert.ok(getSurface(t));
  assert.ok(setMode(t, TERRAINMODE_FINE));
  assert.equal(t.h16, null);
  assert.equal(t.fine!.length, 1024 * 1024);
  const corner = t.fine![(4 * 1 << 10) + 4 * 44];
  assert.ok(setMode(t, TERRAINMODE_CLASSIC16));
  assert.equal(t.h16![44 + 256], corner);
  assert.ok(setMode(t, TERRAINMODE_CLASSIC8));
  assert.equal(t.h16, null);
  assert.equal(t.rawShadow, null);
  assert.equal(t.heights[44 + 256], (corner + 128) >> 8);
  assert.equal(setMode(t, 7), false);
});

test("8-bit tracks keep InterpolateRawAtPoint; 16-bit ground carries the fraction", () => {
  const t = hilly();
  assert.equal(groundAt(t, 100, 200).z, interpolateRawAtPoint(t.heights, 100, 200));
  setMode(t, TERRAINMODE_CLASSIC16);
  t.h16![0] = 25600 + 128;
  assert.deepEqual(groundAt(t, 0, 0), { z: 100, zfrac: 128 });
  assert.equal(cornerV(t, 256, 0), t.h16![0]);
});

test("Smooth Full Map rebuilds from the 32 ft points; Import of a coarse file into Full Map is planar", () => {
  const t = hilly();
  const file = t.heights.slice();
  const f = resetTrack();
  assert.ok(importHeights(f, file, TERRAINMODE_FINE));
  assert.equal(f.terrainMode, TERRAINMODE_FINE);
  assert.equal(f.fine![(4 * 3 << 10) + 4 * 5], file[5 + 3 * 256] << 8);
  assert.ok(smoothFineFromCoarse(f));
  assert.equal(f.fine![(4 * 3 << 10) + 4 * 5] > 0, true);
  assert.equal(importHeights(resetTrack(), new Uint8Array(2 * 1024 * 1024), TERRAINMODE_CLASSIC16), false);
});

test("Terrain Grid message names both modes and ends with the undo line", () => {
  const m = terrainConvertMessage(TERRAINMODE_CLASSIC8, TERRAINMODE_SPLINE);
  assert.match(m, /^Convert this track's terrain from Traditional 8-bit to Finer Heights 16-bit Spline\?\n\n8-bit heights become 16-bit exactly\./);
  assert.match(m, /The terrain undo is cleared by this\.$/);
});

test("ApplyStamp16 clamps and smooths with half-up rounding; FineVertexAtPoint rounds to nearest", () => {
  const g = new Uint16Array(16).fill(1000);
  applyStamp16(g, 4, 3, new Int32Array(9).fill(-5000), 3, 3, 1, 1, 0, 0, null, false);
  assert.equal(g[0], 512);
  const u = Uint16Array.from({ length: 16 }, (_, i) => i);
  const s = u.slice();
  applyStamp16(s, 4, 3, [], 3, 3, 1, 1, 5, 0, u, false);
  assert.equal(s[5], (1 + 9 + 6 + 4 + 2) >> 2);
  assert.equal(fineVertexAtPoint(2048, 2047), 1);
});

test("Lakes on 8-bit ground: a crater fills to its rim minus one, a corner at H is refused", () => {
  const t = resetTrack();
  t.heights.fill(100);
  for (let z = 120; z <= 130; z++) for (let x = 120; x <= 130; x++) t.heights[x + (z << 8)] = 80;
  for (let z = 10; z <= 12; z++) for (let x = 10; x <= 12; x++) t.heights[x + (z << 8)] = 50;
  const g = buildLakeGround(t)!;
  const s = lakeSpill(g, null, 0, 125, 125, -1);
  assert.equal(s, 399);
  assert.equal(fitHeight8(400, 400), 399);
  assert.equal(nearestLegalHeight8(320, 300, 400), 319);
  const lake = { height: fitHeight8(s, s), flags: 1, seeds: [[125, 125]] as [number, number][] };
  const st = recomputeLakes(g, [lake], 0);
  assert.equal(st.lakes[0].errors, 0);
  assert.equal(st.lakes[0].tilecount, 12 * 12);
  assert.deepEqual([st.lakes[0].minx, st.lakes[0].maxx], [119, 130]);
  assert.ok(buildWtr([lake], st));
  const leak = recomputeLakes(g, [{ ...lake, height: 401 }], 0);
  assert.ok(leak.lakes[0].errors & LAKEERR_LEAK);
  const at = recomputeLakes(g, [{ ...lake, height: 320 }], 0);
  assert.ok(at.lakes[0].errors & LAKEERR_CORNER_AT_H);
  assert.equal(buildWtr([{ ...lake, height: 320 }], at), null);
  assert.equal(lakeSpill(g, null, 0, 200, 200, -1), LAKE_NO_BASIN);
  assert.equal(lakeSpill(g, null, 0, 11, 11, -1), 399);
});

test("Lakes on 8-bit-exact 16-bit ground give the 8-bit answers", () => {
  const t = resetTrack();
  t.heights.fill(100);
  for (let z = 120; z <= 130; z++) for (let x = 120; x <= 130; x++) t.heights[x + (z << 8)] = 80;
  for (let z = 10; z <= 12; z++) for (let x = 10; x <= 12; x++) t.heights[x + (z << 8)] = 50;
  const g8 = buildLakeGround(t)!;
  setMode(t, TERRAINMODE_CLASSIC16);
  const g16 = buildLakeGround(t)!;
  assert.equal(lakeSpill(g16, null, 0, 125, 125, -1), lakeSpill(g8, null, 0, 125, 125, -1));
  const lake = { height: 399, flags: 1, seeds: [[125, 125]] as [number, number][] };
  assert.equal(lakeFitHeight(g16, lake, 399, 399), 399);
  const a = recomputeLakes(g8, [lake], 0), b = recomputeLakes(g16, [lake], 0);
  assert.deepEqual(b.lakes, a.lakes);
  assert.ok(Buffer.from(b.tmap).equals(Buffer.from(a.tmap)));
});

test("fog_test.txx's lakes build the WORLD\\FOGTEST.WTR Traxx 1.7 wrote, and read back", { skip: noBoth }, () => {
  const t = readTxx(new Uint8Array(readFileSync(TXX)));
  const pod = new Uint8Array(readFileSync(POD));
  const theirs = readPodEntry(pod, findPodEntry(parsePod(pod), "WORLD\\FOGTEST.WTR")!);
  const st = recomputeLakes(buildLakeGround(t), t.lakes, t.waterLevel4);
  const mine = buildWtr(t.lakes, st);
  assert.ok(mine, `errors ${st.lakes.map((l) => l.errors)}`);
  assert.ok(Buffer.from(mine).equals(Buffer.from(theirs)), "WTR differs");
  const back = parseWtrLakes(theirs)!;
  assert.deepEqual(back.lakes, t.lakes);
  assert.ok(Buffer.from(back.tmap!).equals(Buffer.from(st.tmap)));
});

test("Write POD: heights as PNG replaces the .RAW outside classic, and the .TXV names it", () => {
  const doc = newTrackDocument();
  setMode(doc.track, TERRAINMODE_SPLINE);
  doc.track.pngHeights = true;
  const out = buildTrackPod(doc);
  const p = doc.track.prefix;
  assert.ok(out.entries.some((e) => e.name === `DATA\\${p}_H.PNG`));
  assert.ok(!out.entries.some((e) => e.name === `DATA\\${p}.RAW`));
  const txv = new TextDecoder().decode(out.entries.find((e) => e.name.endsWith(".TXV"))!.data);
  assert.match(txv, new RegExp(`terrainGrid=spline\\r\\nterrainHeights=DATA\\\\${p}_H\\.PNG\\r\\n`));
});

test("Write POD packs a .WTR built from the lakes, and none (with Traxx's report) for a lake in error", () => {
  const doc = newTrackDocument();
  const t = doc.track;
  t.heights.fill(100);
  for (let z = 120; z <= 130; z++) for (let x = 120; x <= 130; x++) t.heights[x + (z << 8)] = 80;
  for (let z = 10; z <= 12; z++) for (let x = 10; x <= 12; x++) t.heights[x + (z << 8)] = 50;
  t.lakes = [{ height: 399, flags: 1, seeds: [[125, 125]] }];
  const ok = buildTrackPod(doc);
  const wtr = ok.entries.find((e) => e.name === `WORLD\\${t.prefix}.WTR`);
  assert.ok(wtr);
  assert.deepEqual(parseWtrLakes(wtr.data)!.lakes, t.lakes);
  t.lakes[0]!.height = 500;
  const bad = buildTrackPod(doc);
  assert.ok(!bad.entries.some((e) => e.name.endsWith(".WTR")));
  assert.ok(bad.warnings.includes(LAKES_NOT_SAVED));
});

test("fog_test.txx's .TXV counts the .VEG it packs", { skip: noBoth }, () => {
  const doc = newTrackDocument();
  doc.track = readTxx(new Uint8Array(readFileSync(TXX)));
  const out = buildTrackPod(doc);
  const txv = new TextDecoder().decode(out.entries.find((e) => e.name.endsWith(".TXV"))!.data);
  assert.match(txv, /vegetation=1\r\nvegTrees=12394\r\nvegClumps=131072\r\n/);
});

test("Write POD packs a model's .SRF right after it (PodAddSurfaceSidecar)", () => {
  const doc = newTrackDocument();
  doc.models.push({ name: "MODELS\\ROCK.BIN", bytes: Uint8Array.of(1), textureNames: [], frameNames: [], bad: false, srf: Uint8Array.of(9) });
  doc.track.models = ["MODELS\\ROCK.BIN"];
  const out = buildTrackPod(doc);
  const at = out.entries.findIndex((e) => e.name === "MODELS\\ROCK.BIN");
  assert.equal(out.entries[at + 1]!.name, "MODELS\\ROCK.SRF");
});

/*
  Traxx 1.7.1's spillway notches (TrackPODLakes.cpp SetNotches, BuildView; tools/laketest.cpp
  test_notch_classic8 and test_notch_holds_up_to): a 6 x 6-tile lake (tiles 102..107, floor byte 10,
  H = 100) whose east wall tile (108,104) is the notch, lip vertices at byte `lip`, far at `far`.
*/
const NTILE = (x: number, z: number) => x + (z << 8);
function notchTrack(lip: number, far: number) {
  const t = resetTrack();
  t.heights.fill(80);
  for (let z = 0; z < 256; z++) for (let x = 110; x < 256; x++) t.heights[NTILE(x, z)] = 10;
  for (let z = 103; z < 108; z++) for (let x = 103; x < 108; x++) t.heights[NTILE(x, z)] = 10;
  t.heights[NTILE(108, 104)] = t.heights[NTILE(108, 105)] = lip;
  t.heights[NTILE(109, 104)] = t.heights[NTILE(109, 105)] = far;
  return t;
}
function notchMap() {
  const nl = new Uint8Array(65536), lp = new Uint8Array(65536);
  nl[NTILE(108, 104)] = 1; // lake 1 (index 0)
  lp[NTILE(108, 104)] = LAKE_LIP_W; // the lake is to the notch tile's west
  return lakeNotches(nl, lp)!;
}
const notchLake = (h: number) => [{ height: h, flags: 1, seeds: [[104, 104]] as [number, number][] }];

test("1.7.1 spillway notch: the wall without it leaks, with it the lake is clean; its tile is a barrier", () => {
  const t = notchTrack(25, 22);
  const g = buildLakeGround(t)!;
  const plain = recomputeLakes(g, notchLake(100), 0);
  assert.ok(plain.lakes[0]!.errors & LAKEERR_LEAK && plain.lakes[0]!.errors & LAKEERR_CORNER_AT_H);
  const n = notchMap();
  assert.ok(lakeHasNotches(n, 0) && !lakeHasNotches(n, 1));
  assert.equal(lakeNotches(new Uint8Array(65536), null), null, "a map with no tile is no notches");
  const st = recomputeLakes(g, notchLake(100), 0, n);
  assert.equal(st.lakes[0]!.errors, 0);
  assert.equal(st.lakes[0]!.tilecount, 36);
  assert.equal(st.tmap[NTILE(108, 104)], 0);
  assert.equal(st.tmap[NTILE(107, 104)], 1);
  assert.equal(st.lakes[0]!.spill, 100);
  assert.equal(lakeSpill(g, st.tmap, 0, 104, 104, 0, n, notchLake(100)), 100);
  // NOTCH_FAR_HOLDS off: the literal reading leaks through the flank tiles
  setNotchFarHolds(false);
  assert.ok(recomputeLakes(g, notchLake(100), 0, n).lakes[0]!.errors & LAKEERR_LEAK);
  setNotchFarHolds(true);
  // a side-wall corner at H that is not a lip corner: LEAK, as without notches
  t.heights[NTILE(108, 103)] = 25;
  assert.ok(recomputeLakes(buildLakeGround(t)!, notchLake(100), 0, n).lakes[0]!.errors & LAKEERR_LEAK);
});

test("1.7.1 HoldsUpTo: the highest legal height of a lake with notches, on every ground", () => {
  let t = notchTrack(25, 22);
  let g = buildLakeGround(t)!;
  const n = notchMap();
  for (let h = 92; h <= 100; h++) {
    const lakes = notchLake(h);
    const st = recomputeLakes(g, lakes, 0, n);
    assert.equal(st.lakes[0]!.errors, 0, `h ${h}`);
    assert.ok(st.lakes[0]!.spill <= h);
    assert.equal(lakeHoldsUpTo(g, lakes, st, 0, 0), 100);
    assert.equal(lakeFitHeight(g, lakes[0]!, h, 1000, n, 0), h);
    assert.equal(lakeNearestLegalHeight(g, lakes[0]!, h, 41, 100, n, 0), h);
    assert.equal(lakeMinHeight(g, 0, lakes[0]!, n, 0), 41);
  }
  let lakes = notchLake(101);
  let st = recomputeLakes(g, lakes, 0, n);
  assert.ok(st.lakes[0]!.errors & LAKEERR_LEAK);
  assert.equal(lakeHoldsUpTo(g, lakes, st, 0, 0), st.lakes[0]!.spill);
  assert.ok(st.lakes[0]!.spill < 101);
  lakes = notchLake(100);
  st = recomputeLakes(g, lakes, 0);
  assert.equal(lakeHoldsUpTo(g, lakes, st, 0, 0), st.lakes[0]!.spill);
  t = notchTrack(23, 22);
  g = buildLakeGround(t)!;
  lakes = notchLake(90);
  st = recomputeLakes(g, lakes, 0, n);
  assert.equal(lakeHoldsUpTo(g, lakes, st, 0, 0), 92);
  assert.equal(lakeHoldsUpTo(g, lakes, st, 0, 5), LAKE_NO_BASIN);
  assert.equal(lakeHoldsUpTo(g, lakes, st, 0, -1), LAKE_NO_BASIN);
  // Classic 16-bit and Full Map holding the same ground say the same
  for (const mode of [TERRAINMODE_CLASSIC16, TERRAINMODE_FINE]) {
    t = notchTrack(25, 22);
    setMode(t, mode);
    g = buildLakeGround(t)!;
    lakes = notchLake(96);
    st = recomputeLakes(g, lakes, 0, n);
    assert.equal(st.lakes[0]!.errors, 0, `mode ${mode}`);
    assert.equal(lakeHoldsUpTo(g, lakes, st, 0, 0), 100, `mode ${mode}`);
  }
});

test("1.7.1: a fall's crest cuts its lake's notch (trackLakes derives the lakes with it)", () => {
  const t = notchTrack(25, 22);
  t.lakes = notchLake(100);
  assert.ok(trackLakes(t).lakes[0]!.errors & LAKEERR_LEAK);
  const f = fallDefaults();
  f.source = 1; f.npoints = 2;
  f.pt[0] = [3456 * 16, 3329 * 16];
  f.pt[1] = [3456 * 16, 3359 * 16];
  t.falls = [f];
  const st = trackLakes(t);
  assert.equal(st.lakes[0]!.errors, 0);
  assert.equal(st.lakes[0]!.tilecount, 36);
});
