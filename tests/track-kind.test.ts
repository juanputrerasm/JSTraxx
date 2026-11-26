/*
  The track kind (track-kind.ts: Traxx origin/main TrackPOD.cpp SetTrackKind, AdjustBoxHeightsForKind,
  WaterLevelMax4, LakeMaxHeightFor, FallMaxHeight, CountSpringFallsAbove; TraxxViewEdit.cpp OnSpecialTrackType),
  the feet of height-units.ts (Traxx/HeightUnits.cpp, tools/heightunitstest.cpp) and Enlarge World
  (core/edit/enlarge-world.ts: CTrackPOD::EnlargeWorld512, tools/txxtest.cpp test_enlarge_*).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { readTxx, writeTxx } from "../src/core/traxx/txx.ts";
import {
  adjustBoxHeightsForKind, countSpringFallsAbove, fallMaxHeight, lakeMaxHeight, lakeMaxHeightForKind, maxBoxes, setTrackKind,
  trackTypeQuestion, waterLevelMax4, TRACK_TYPE_QUESTION,
} from "../src/core/traxx/track-kind.ts";
import { boxByte, clampBoxBottom, clampBoxTop, feetToV, formatFeet, parseFeet, vToFeet } from "../src/core/traxx/height-units.ts";
import { enlargeWorld512, maskImageEnlarge2x, ENLARGE_ALREADY_512 } from "../src/core/edit/enlarge-world.ts";
import { refreshRaw, TERRAINMODE_CLASSIC16, TERRAINMODE_CLASSIC8, TERRAINMODE_FINE, TERRAINMODE_SPLINE } from "../src/core/traxx/terrain16.ts";
import { heightsChanged, setMode } from "../src/core/traxx/surface.ts";
import { fallDefaults } from "../src/core/traxx/falls.ts";
import { traxxBoxDefaults } from "../src/core/traxx/sit.ts";
import { trackLakes } from "../src/core/traxx/lakes.ts";
import { decodePngSamples } from "../src/vendor/openphotex/texture/png.js";
import { encodeGreyPng } from "../src/vendor/openphotex/texture/png-write.js";

const TALL = 1048576;

test("height units: FormatFeet, ParseFeet, FeetToV, the box clamps and BoxByte (heightunitstest.cpp)", () => {
  assert.equal(formatFeet(1821 * 128 + 32), "1821.25");
  assert.equal(formatFeet(0), "0.00");
  assert.equal(formatFeet(TALL), "8192.00");
  assert.equal(formatFeet(1), "0.01");
  assert.equal(formatFeet(-64), "-0.50");
  assert.equal(parseFeet("1821.255", 0, TALL), 233121);
  assert.equal(parseFeet("1821.25", 0, TALL), 233120);
  assert.equal(parseFeet("  12 ", 0, TALL), 12 * 128);
  assert.equal(parseFeet("0.5", 0, TALL), 64);
  assert.equal(parseFeet("0,5", 0, TALL), 64, "a decimal comma");
  assert.equal(parseFeet("-5", 0, TALL), 0);
  assert.equal(parseFeet("-5", -TALL, TALL), -5 * 128);
  assert.equal(parseFeet("9000", 0, TALL), TALL);
  assert.equal(parseFeet("1e3", 0, TALL), 128000);
  for (const bad of ["abc", "", "   ", null, "12abc", "-"]) assert.equal(parseFeet(bad, 0, TALL), null, String(bad));
  assert.equal(feetToV(1.0), 128);
  assert.equal(feetToV(1821.25), 233120);
  assert.equal(feetToV(-0.5), -64);
  assert.equal(feetToV(0.003), 0);
  assert.equal(feetToV(0.004), 1);
  assert.equal(vToFeet(233120), 1821.25);
  for (let k = -300; k <= TALL; k += 997) assert.equal(feetToV(vToFeet(k)), k);
  for (let k = 0; k <= TALL; k += 32 * 331) assert.equal(parseFeet(formatFeet(k), 0, TALL), k);
  assert.deepEqual([clampBoxTop(100, 100, TALL), clampBoxTop(50, 100, TALL), clampBoxTop(101, 100, TALL), clampBoxTop(2 * TALL, 100, TALL)], [101, 101, 101, TALL]);
  assert.deepEqual([clampBoxTop(65537, 100, 65536), clampBoxTop(128064, 0, TALL)], [65536, 128064]);
  assert.deepEqual([clampBoxBottom(100, 100), clampBoxBottom(500, 100), clampBoxBottom(99, 100), clampBoxBottom(-5, 100), clampBoxBottom(0, 1), clampBoxBottom(70, 128064)], [99, 99, 99, 0, 0, 70]);
  assert.equal(parseFeet("0.4", 70 + 1, TALL), 71);
  assert.equal(parseFeet("5000", 0, 128064 - 1), 128063);
  assert.deepEqual([0, 255, 256, 128064, 65280, 65535, -300, TALL].map(boxByte), [0, 0, 1, 255, 255, 255, 0, 255]);
});

test("the ceilings per kind: heights, water, lakes, falls, objects (txxtest test_v24_water)", () => {
  const c = newTrackDocument().track, s = newTrackDocument(256, "standard").track, t = newTrackDocument(256, "tall").track;
  assert.deepEqual([waterLevelMax4(c), waterLevelMax4(s), waterLevelMax4(t)], [1020, 1023, 16384]);
  assert.deepEqual([lakeMaxHeight(c), lakeMaxHeight(s), lakeMaxHeight(t)], [1023, 1023, 16384]);
  assert.deepEqual([lakeMaxHeightForKind(false, TALL), lakeMaxHeightForKind(true, TALL), lakeMaxHeightForKind(true, 65535)], [1023, 16384, 1023]);
  assert.deepEqual([fallMaxHeight(c), fallMaxHeight(s), fallMaxHeight(t)], [4096, 1023, 16384]);
  assert.deepEqual([maxBoxes(c), maxBoxes(s), maxBoxes(t)], [4096, 16384, 16384]);
  // A new v6 track is never Classic 8-bit; a 512 world is v6 only.
  assert.deepEqual([c.terrainMode, s.terrainMode, newTrackDocument(512).track.trackKind], [TERRAINMODE_CLASSIC8, TERRAINMODE_CLASSIC16, "standard"]);
  assert.equal(setTrackKind(c, "classic", 512), false);
});

test("AdjustBoxHeightsForKind: not tall clamps to 0..65535, classic rounds to 2 ft, a top stays above its bottom", () => {
  assert.equal(adjustBoxHeightsForKind(256, 5120, false, false), null, "a classic box is left exactly as it was");
  assert.deepEqual(adjustBoxHeightsForKind(300, 5200, false, false), { lower: 256, upper: 5120 });
  assert.deepEqual(adjustBoxHeightsForKind(300, 400, false, false), { lower: 256, upper: 512 }, "rounded onto its bottom: one step above");
  assert.deepEqual(adjustBoxHeightsForKind(70000, 900000, true, false), { lower: 65534, upper: 65535 });
  assert.deepEqual(adjustBoxHeightsForKind(70000, 900000, false, false), { lower: 65024, upper: 65280 });
  assert.equal(adjustBoxHeightsForKind(70000, 900000, true, true), null, "tall keeps anything");
  assert.equal(adjustBoxHeightsForKind(0, 0, true, false), null, "upper 0 is no box");
});

test("SetTrackKind: the narrowing, Classic 8-bit to 16-bit, the round trip (txxtest test_track_kind_round_trip)", () => {
  const doc = newTrackDocument();
  const t = doc.track;
  setMode(t, TERRAINMODE_CLASSIC16);
  for (let i = 0; i < 65536; i++) t.h16![i] = (i * 37 + 5) & 65535;
  refreshRaw(t);
  heightsChanged(t);
  t.groundBoxes = [0, 1].map((k) => ({ x: 10 + k, y: 20 + k, w: 3, h: 4, lower: 256 * (k + 1), upper: 256 * (20 + k), faces: [0, 0, 0, 0, 0, 0] }));
  const a = writeTxx(t);
  assert.ok(setTrackKind(t, "tall"));
  assert.ok(t.h16 instanceof Int32Array);
  assert.equal(new TextDecoder().decode(writeTxx(t).subarray(0, 8)), "TRAXXV24");
  assert.ok(setTrackKind(t, "classic"));
  assert.ok(t.h16 instanceof Uint16Array);
  assert.deepEqual(writeTxx(t), a, "back to classic: the same bytes");
  // Tall to Standard: heights and boxes above 65535 are lowered, the water, lakes and spring falls follow.
  const tl = newTrackDocument(256, "tall").track;
  tl.h16![9] = 900000;
  tl.groundBoxes = [{ x: 1, y: 1, w: 1, h: 1, lower: 70000, upper: 900000, faces: [0, 0, 0, 0, 0, 0] }];
  tl.waterLevel4 = 6000;
  tl.lakes = [{ height: 5000, flags: 0, seeds: [[3, 3]] }];
  const f = fallDefaults(); f.height = 5000; f.npoints = 2;
  const g = fallDefaults(); g.height = 5000; g.source = 1; g.npoints = 2;
  tl.falls = [f, g];
  const q = trackTypeQuestion(tl, "standard");
  assert.equal(q.refusal, null);
  assert.equal(q.message, [
    "3 heights above 511.99 ft will be lowered to 511.99 ft.",
    "The water level will be lowered to 511.50 ft.",
    "1 lake will be lowered to 511.5 ft.",
    "1 waterfall will be lowered to 511.5 ft.",
    "1 ground boxes will be adjusted (heights rounded to 2 ft steps or kept in range).",
  ].join("\n"));
  assert.ok(setTrackKind(tl, "standard"));
  assert.deepEqual([tl.h16![9], tl.groundBoxes[0]!.lower, tl.groundBoxes[0]!.upper, tl.waterLevel4, tl.lakes[0]!.height, tl.falls[0]!.height, tl.falls[1]!.height], [65535, 65534, 65535, 1023, 1023, 1023, 5000]);
  assert.ok(tl.h16 instanceof Uint16Array);
  assert.equal(countSpringFallsAbove(tl.falls, 1000), 1);
  // A Classic 8-bit track becomes Classic 16-bit on the way to v6 and stays so.
  const c8 = newTrackDocument().track;
  assert.ok(setTrackKind(c8, "tall") && setTrackKind(c8, "classic"));
  assert.equal(c8.terrainMode, TERRAINMODE_CLASSIC16);
  assert.ok(readTxx(writeTxx(c8)).version >= 17);
  // From classic: the note, no counts.
  assert.equal(trackTypeQuestion(newTrackDocument().track, "standard").message, "Version 6 tracks need Community Patch 4. Retail and Community Patch 3 won't list this track.");
  assert.equal(TRACK_TYPE_QUESTION, "\n\nChange the track type?");
});

test("Track Type refuses Classic above 4,096 objects, and SetTrackKind changes nothing then", () => {
  const t = newTrackDocument(256, "standard").track;
  t.boxes = Array.from({ length: 4097 }, traxxBoxDefaults);
  assert.equal(trackTypeQuestion(t, "classic").refusal, "This track has 4097 objects; a classic track holds at most 4,096. Delete objects first, then change the track type.");
  assert.equal(setTrackKind(t, "classic"), false);
  assert.equal(t.trackKind, "standard");
  t.boxes.length = 4096;
  assert.ok(setTrackKind(t, "classic"));
});

test("CountSpringFallsAbove (txxtest test_count_spring_falls_above)", () => {
  const mk = (h: number, source = 0) => { const w = fallDefaults(); w.height = h; w.source = source; return w; };
  const falls = [mk(1500), mk(900), mk(1800, 1)];
  assert.deepEqual([countSpringFallsAbove([], 1023), countSpringFallsAbove(falls, 1023), countSpringFallsAbove(falls, 899), countSpringFallsAbove(falls, 1500)], [0, 1, 2, 0]);
});

/* A 256 v6 track with something in every subsystem (txxtest NewEnlargeSource): a pattern, the lowest a pit. */
const PIT = 12000, RIM = 40000, PEAK = 60000, LAKE_H = 301;
function enlargeSource(mode: number, kind: "standard" | "tall") {
  const doc = newTrackDocument(256, "tall");
  const t = doc.track;
  setMode(t, mode);
  const g = (t.fine ?? t.h16)!, fw = t.fine ? 1024 : 256;
  for (let i = 0; i < fw * fw; i++) g[i] = 20000 + ((i % fw) * 31 + Math.floor(i / fw) * 17) % 5000;
  const put = (x: number, z: number, v: number) => {
    if (t.fine) { for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) t.fine[(4 * x + i) + (4 * z + j) * 1024] = v; }
    else t.h16![x + z * 256] = v;
  };
  for (let z = 99; z <= 104; z++) for (let x = 253; x <= 258; x++) put(x & 255, z, z === 99 || z === 104 || x === 253 || x === 258 ? RIM : PIT);
  for (let z = 119; z <= 124; z++) for (let x = 119; x <= 124; x++) put(x, z, z === 119 || z === 124 || x === 119 || x === 124 ? RIM : PIT);
  put(200, 200, PEAK);
  refreshRaw(t);
  heightsChanged(t);
  for (let i = 0; i < 65536; i++) { t.clr[i] = 1 + (i * 3) % 500; t.lte![i * 7] = (i * 5) & 255; t.lte![i * 7 + 1] = (i >> 2) & 255; }
  setTrackKind(t, kind);
  t.groundBoxes = [0, 1].map((k) => ({ x: k ? 100 : 10, y: k ? 100 : 20, w: 3, h: 4, lower: 300 + k, upper: 4000 + k, faces: [5 + k, 0, 0, 0, 0, 0] }));
  t.boxes = [0, 1, 2].map((k) => { const b = traxxBoxDefaults(); b.ipos = [3000 + k * 500, 7000 + k * 100, 40 + k]; b.fraction = [10 + k, 20 + k, 30 + k]; return b; });
  t.lakes = [{ height: LAKE_H, flags: 1, seeds: [[255, 101]] }, { height: LAKE_H, flags: 0, seeds: [[121, 121]] }];
  const f = fallDefaults(); f.npoints = 2; f.height = 50; f.pt[0] = [16000, 16000]; f.pt[1] = [16100, 16000];
  const s = fallDefaults(); s.npoints = 2; s.source = 1; s.pt[0] = [4090, 1620]; s.pt[1] = [4090, 1650];
  t.falls = [f, s];
  t.raceRules.walls = [{ name: "W", side: 0, closed: 0, noline: 0, thickness: 256, height: 5120, points: [{ x: 100, z: 100, bend: 0, above: 0, gap: 0 }] }];
  return doc;
}

test("Enlarge World: the old world in the corner, the rest flat at the lowest height, every record kept (txxtest test_enlarge_world)", () => {
  for (const mode of [TERRAINMODE_CLASSIC16, TERRAINMODE_SPLINE, TERRAINMODE_FINE]) {
    for (const kind of ["standard", "tall"] as const) {
      const what = `mode ${mode} ${kind}`;
      const doc = enlargeSource(mode, kind), ref = enlargeSource(mode, kind).track;
      const t = doc.track;
      const before = trackLakes(t);
      assert.ok(before.lakes.every((l) => l.errors === 0 && l.tilecount > 0), what);
      const r = enlargeWorld512(t);
      assert.ok(r.ok, r.report.reason);
      assert.deepEqual([t.worldCells, t.trackKind, t.terrainMode], [512, kind, mode], what);
      const fine = mode === TERRAINMODE_FINE, rw = fine ? 1024 : 256, nw = fine ? 2048 : 512;
      const gr = (ref.fine ?? ref.h16)!, gn = (t.fine ?? t.h16)!;
      let bad = 0;
      for (let z = 0; z < nw; z++) for (let x = 0; x < nw; x++) if (gn[x + z * nw] !== (x < rw && z < rw ? gr[x + z * rw] : PIT)) bad++;
      assert.equal(bad, 0, `${what}: the grid`);
      bad = 0;
      for (let z = 0; z < 512; z++) for (let x = 0; x < 512; x++) {
        const old = x < 256 && z < 256, n = x + z * 512, o = x + z * 256;
        if (t.clr[n] !== (old ? ref.clr[o] : 0)) bad++;
        if (t.lte![n * 7] !== (old ? ref.lte![o * 7] : 0xed) || t.lte![n * 7 + 1] !== (old ? ref.lte![o * 7 + 1] : 0)) bad++;
      }
      assert.equal(bad, 0, `${what}: clr and lte`);
      assert.deepEqual(t.groundBoxes, ref.groundBoxes);
      assert.deepEqual(t.boxes.map((b) => [b.ipos, b.fraction]), ref.boxes.map((b) => [b.ipos, b.fraction]));
      assert.deepEqual([t.lakes, t.falls, t.raceRules.walls], [ref.lakes, ref.falls, ref.raceRules.walls]);
      // The lake across the old seam no longer holds what it did; the one in the middle does.
      assert.deepEqual(r.report.lakes, [1], what);
      const after = trackLakes(t);
      assert.equal(after.lakes[1]!.tilecount, before.lakes[1]!.tilecount);
      assert.ok(r.report.falls.length >= 1 && r.report.falls.length < 2, `${what}: ${r.report.falls}`);
      // Saved and read again: the same 512 world, and the same bytes again.
      const a = writeTxx(t);
      assert.equal(new TextDecoder().decode(a.subarray(0, 8)), "TRAXXV24");
      assert.deepEqual(writeTxx(readTxx(a)), a);
      // Already 512: refused, nothing changes.
      const again = enlargeWorld512(t);
      assert.deepEqual([again.ok, again.report.reason], [false, ENLARGE_ALREADY_512]);
      assert.deepEqual(writeTxx(t), a);
    }
  }
});

test("Enlarge World: a classic 8-bit track becomes Standard V6 Classic 16-bit, as Track Type then Enlarge does (test_enlarge_classic8)", () => {
  const t = newTrackDocument().track;
  for (let i = 0; i < 65536; i++) t.heights[i] = 50 + (i % 97);
  const same = newTrackDocument().track;
  same.heights.set(t.heights);
  assert.ok(enlargeWorld512(t).ok);
  assert.deepEqual([t.trackKind, t.worldCells, t.terrainMode], ["standard", 512, TERRAINMODE_CLASSIC16]);
  let bad = 0;
  for (let z = 0; z < 512; z++) for (let x = 0; x < 512; x++) {
    const want = x < 256 && z < 256 ? same.heights[x + z * 256]! << 8 : 50 << 8;
    if (t.h16![x + z * 512] !== want || t.heights[x + z * 512] !== want >> 8) bad++;
  }
  assert.equal(bad, 0);
  assert.ok(setTrackKind(same, "standard"));
  assert.ok(enlargeWorld512(same).ok);
  assert.deepEqual(Array.from(same.h16!), Array.from(t.h16!));
  assert.equal(same.terrainMode, TERRAINMODE_CLASSIC16);
  assert.notEqual(TERRAINMODE_CLASSIC8, t.terrainMode);
});

test("Enlarge World: the masks double with the old picture top-left (test_enlarge_masks), a broken one refuses (test_enlarge_mask_refusal)", () => {
  const t = newTrackDocument().track;
  const grey = new Uint8Array(64 * 32);
  for (let i = 0; i < grey.length; i++) grey[i] = (i * 13) & 255;
  t.maskMap = encodeGreyPng(grey, 64, 32, 8); t.maskExt = ".PNG";
  // A 24-bit TGA, bottom-up.
  const tga = new Uint8Array(18 + 4 * 2 * 3);
  tga[2] = 2; tga[12] = 4; tga[14] = 2; tga[16] = 24;
  for (let i = 0; i < 8; i++) tga.set([i, 10 * i, 20 * i], 18 + 3 * i);
  t.waterMaskMap = tga; t.waterMaskExt = ".TGA";
  const r = enlargeWorld512(t);
  assert.ok(r.ok, r.report.reason);
  const png = decodePngSamples(t.maskMap!);
  assert.deepEqual([png.width, png.height, png.bitDepth, png.colorType], [128, 64, 8, 0]);
  let bad = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) if (png.samples[x + y * 128] !== (x < 64 && y < 32 ? grey[x + y * 64] : 0)) bad++;
  assert.equal(bad, 0);
  const w = t.waterMaskMap!;
  assert.deepEqual([w[2], w[12] | (w[13] << 8), w[14] | (w[15] << 8), w[16], w[17]], [2, 8, 4, 24, 0x20]);
  // Top-left origin now: row 0 is the old top row, which was stored last (pixels 4..7), in B, G, R.
  assert.deepEqual(Array.from(w.subarray(18, 21)), [4, 40, 80]);
  assert.deepEqual(Array.from(w.subarray(18 + 3 * 4, 18 + 3 * 5)), [0, 0, 0], "black beside it");
  // A mask that is not a picture: refused, nothing changed.
  const u = newTrackDocument().track;
  u.maskMap = new Uint8Array(40).fill(7); u.maskExt = ".PNG";
  const before = writeTxx(u);
  const no = enlargeWorld512(u);
  assert.deepEqual([no.ok, no.report.reason], [false, "The _MASK mask is not a PNG or TGA image, so the world cannot be enlarged. Remove or replace it first."]);
  assert.deepEqual(writeTxx(u), before);
  assert.ok("why" in maskImageEnlarge2x(new Uint8Array(4)));
});

test("Enlarge World: the stored lake map goes into the corner of a 512 map, shown as it was", () => {
  const doc = enlargeSource(TERRAINMODE_CLASSIC16, "standard");
  const t = doc.track;
  const map = trackLakes(t).tmap.slice();
  map[0] = 2; // a tile the fill does not give
  t.storedLakeMap = { tmap: map, lakes: 2, shown: true };
  assert.ok(enlargeWorld512(t).ok);
  const s = t.storedLakeMap!;
  assert.deepEqual([s.tmap.length, s.lakes, s.shown, s.tmap[0], s.tmap[256]], [512 * 512, 2, true, 2, 0]);
  assert.equal(s.tmap[121 + 121 * 512], map[121 + 121 * 256]);
  assert.deepEqual(readTxx(writeTxx(t)).storedLakeMap, s);
});
