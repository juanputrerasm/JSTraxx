/*
  Track format version 6 in JSTraxx: .SI3 listing and loading, Write POD choosing .SI3 or the
  Traxx situation file, the .TXV keys (unknown keys kept), the automatic height step and base on
  import, and 512-cell grids.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { writePod1 } from "../src/vendor/openphotex/pod/write.js";
import { readTxvV6, readTxvInfo } from "../src/vendor/openphotex/mtm/txv.js";
import { encodeMtm2HeightRaw16 } from "../src/vendor/openphotex/mtm/heights.js";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { buildTrackPod } from "../src/core/traxx/pod-writer.ts";
import { countTracks, loadPodTrack, situationKind } from "../src/core/doc/load-pod.ts";
import { setMode } from "../src/core/traxx/surface.ts";
import { TERRAINMODE_CLASSIC16, TERRAINMODE_FINE } from "../src/core/traxx/terrain16.ts";
import { TRACK_WATER_MAX4, pickStepAndBase, trackWaterRange, v6WaterRange } from "../src/core/traxx/v6.ts";
import { isV6 } from "../src/core/traxx/track-kind.ts";
import { readTxx } from "../src/core/traxx/txx.ts";
import { adjustHeights } from "../src/core/edit/terrain.ts";
import { v6ApplyImport, v6ExportBytes, v6ImportHeights } from "../src/core/edit/heightmap-io.ts";
import { writeTxx, TxxError } from "../src/core/traxx/txx.ts";
import type { TrackDocument } from "../src/core/doc/document.ts";

const DATE = new Date(2026, 10, 13);
const podOf = (doc: TrackDocument) => {
  const out = buildTrackPod(doc, { date: DATE });
  return { out, bytes: writePod1(out.comment, out.entries) };
};
const sourceOf = (bytes: Uint8Array) => ({ archive: parsePod(bytes), read: async (e: { offset: number; length: number }) => readPodEntry(bytes, e) });
const entry = (out: ReturnType<typeof buildTrackPod>, name: string) => out.entries.find((e) => e.name.toUpperCase() === name.toUpperCase());
const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

test("a .SI3 is a situation file and is listed as its own track beside a .SIT of the same stem", async () => {
  assert.equal(situationKind("WORLD\\X.SI3"), "si3");
  const a = podOf(newTrackDocument()).out.entries;
  const doc = newTrackDocument(512);
  doc.track.trackName = "Big";
  const b = podOf(doc).out.entries.filter((e) => e.name.toUpperCase().endsWith(".SI3"));
  const pod = writePod1("pack", [...a, ...b]);
  const list = await countTracks(sourceOf(pod));
  assert.deepEqual(list.stems, ["TRAXX", "TRAXX"]);
  assert.deepEqual(list.names, ["new track", "Big"]);
});

test("a track with no version 6 feature writes exactly as before: .SIT, no version 6 keys", () => {
  const { out } = podOf(newTrackDocument());
  assert.equal(out.v6, false);
  assert.ok(entry(out, "WORLD\\TRAXX.SIT"));
  assert.ok(!out.entries.some((e) => /\.SI3$/i.test(e.name)));
  const txv = text(entry(out, "DATA\\TRAXX.TXV")!.data);
  assert.match(txv, /formatVersion=1\r\n/);
  assert.doesNotMatch(txv, /worldCells|terrainHeight(Map|Step|Base)/);
  // A 16-bit track: .SI2 as Traxx 1.7 writes it.
  const d16 = newTrackDocument();
  setMode(d16.track, TERRAINMODE_CLASSIC16);
  const o16 = podOf(d16).out;
  assert.ok(entry(o16, "WORLD\\TRAXX.SI2"));
  assert.equal(entry(o16, "DATA\\TRAXX.RAW")!.data.length, 131072);
});

test("a 512-cell world saves as .SI3 with formatVersion 6, N x N grids, and loads back", async () => {
  const doc = newTrackDocument(512);
  assert.equal(doc.track.heights.length, 512 * 512);
  assert.equal(doc.track.clr.length, 512 * 512);
  assert.equal(doc.track.lte!.length, 512 * 512 * 7);
  assert.equal(doc.track.trackKind, "standard", "512 is version 6 only: Standard V6 unless asked for Tall");
  assert.equal(isV6(doc.track), true);
  doc.track.groundBoxes.push({ x: 400, y: 300, w: 1, h: 1, lower: 100 << 8, upper: 110 << 8, faces: [1, 2, 3, 4, 5, 6] });
  const { out, bytes } = podOf(doc);
  assert.equal(out.v6, true);
  assert.ok(entry(out, "WORLD\\TRAXX.SI3"));
  assert.ok(!out.entries.some((e) => /\.SI[T2]$/i.test(e.name)));
  // Traxx origin/main: .RA0 / .RA1 are always 16-bit on a v6 track (BuildRA01CL0_16).
  for (const [ext, per] of [["CLR", 2], ["LTE", 7], ["RA0", 2], ["RA1", 2], ["RA2", 1], ["RA5", 1], ["CL0", 12], ["CL1", 4], ["CL2", 12]] as const) {
    assert.equal(entry(out, `DATA\\TRAXX.${ext}`)!.data.length, 512 * 512 * per, ext);
  }
  const v6 = readTxvV6(entry(out, "DATA\\TRAXX.TXV")!.data);
  assert.equal(v6.worldCells, 512);
  // The map is always the 16-bit DATA\<stem>_H.PNG, with the 8-bit N*N .RAW mirror before it; no terrainGrid on Classic 16-bit.
  assert.equal(v6.terrainHeightMap, "DATA\\TRAXX_H.PNG");
  assert.equal(v6.terrainHeightStep, 128);
  assert.equal(v6.terrainHeightBase, 200); // a new track is flat at 200 ft
  assert.doesNotMatch(text(entry(out, "DATA\\TRAXX.TXV")!.data), /terrainGrid/);
  assert.equal(entry(out, "DATA\\TRAXX.RAW")!.data.length, 512 * 512);
  assert.equal(entry(out, "DATA\\TRAXX.RAW")!.data[0], 100, "the mirror: 200 ft is byte 100");
  const names = out.entries.map((e) => e.name.toUpperCase());
  assert.equal(names.indexOf("DATA\\TRAXX.RAW") + 1, names.indexOf("DATA\\TRAXX_H.PNG"));

  const back = await loadPodTrack(sourceOf(bytes), 0, "big.pod");
  assert.equal(back.track.trackKind, "standard", "EndV6Read: nothing above 512 ft, so not tall");
  assert.equal(back.track.worldCells, 512);
  assert.equal(back.track.terrainMode, TERRAINMODE_CLASSIC16);
  assert.ok(back.track.h16 instanceof Uint16Array, "a Standard V6 track keeps the 16-bit store");
  assert.equal(back.track.h16!.length, 512 * 512);
  assert.equal(back.track.h16![1000], 200 * 128);
  assert.deepEqual(back.track.groundBoxes.map((g) => [g.x, g.y, g.lower, g.upper, g.faces[5]]), [[400, 300, 100 << 8, 110 << 8, 6]]);
  // Saved again it stays a .SI3 with the same keys.
  const again = podOf(back).out;
  assert.ok(entry(again, "WORLD\\TRAXX.SI3"));
  assert.equal(readTxvV6(entry(again, "DATA\\TRAXX.TXV")!.data).worldCells, 512);
});

test("a 256 Tall Heights V6 track is a .SI3 with a picked step and base; its .TXX is TRAXXV24; the kind is never content", () => {
  // The same heights on a classic track do not make it version 6: its .TXX refuses them (CanSaveBinary).
  const classic = newTrackDocument();
  setMode(classic.track, TERRAINMODE_CLASSIC16);
  classic.track.h16 = new Int32Array(256 * 256).fill(12 * 128);
  classic.track.h16[5] = 1821 * 128;
  assert.equal(isV6(classic.track), false);
  assert.throws(() => writeTxx(classic.track), /The terrain holds a height this track kind cannot store/);
  const doc = newTrackDocument(256, "tall");
  assert.equal(doc.track.terrainMode, TERRAINMODE_CLASSIC16, "a v6 track is never Classic 8-bit");
  // Pikes Peak (spec 11): 12 ft to 1,821 ft gives base 12, step 32.
  const h = new Int32Array(256 * 256).fill(12 * 128);
  h[5] = 1821 * 128;
  doc.track.h16 = h;
  assert.equal(isV6(doc.track), true);
  assert.deepEqual(pickStepAndBase(doc.track), { step: 32, base: 12 });
  const { out } = podOf(doc);
  assert.ok(entry(out, "WORLD\\TRAXX.SI3"));
  const v6 = readTxvV6(entry(out, "DATA\\TRAXX.TXV")!.data);
  assert.deepEqual([v6.worldCells, v6.terrainHeightStep, v6.terrainHeightBase], [256, 32, 12]);
  const txx = writeTxx(doc.track);
  assert.equal(new TextDecoder("latin1").decode(txx.subarray(0, 8)), "TRAXXV24");
});

test("the .TXV keeps unknown keys and comments and sets the version 6 keys in place", () => {
  const doc = newTrackDocument(512);
  doc.carry.txvText = "# from my converter\r\nconverter=mm1conversion\r\nworldCells=256\r\nterrainHeightStep=64\r\n";
  const { out } = podOf(doc);
  const txv = text(entry(out, "DATA\\TRAXX.TXV")!.data);
  assert.match(txv, /converter=mm1conversion/);
  const info = readTxvInfo(txv);
  assert.equal(info.formatVersion, 6);
  assert.equal(info.worldCells, 512);
  assert.equal(info.terrainHeightStep, 128);
  assert.equal((txv.match(/worldCells=/gi) ?? []).length, 1);
});

test("Import Heightmap (Version 6) picks the step and base from the imported range", () => {
  const doc = newTrackDocument(256, "tall");
  // A 16-bit RAW read at step 8, base 100: samples 0..15000 are 100 ft .. 1975 ft.
  const samples = new Uint16Array(256 * 256);
  for (let i = 0; i < samples.length; i++) samples[i] = i % 15001;
  const res = v6ImportHeights(encodeMtm2HeightRaw16(samples), "peak.raw", doc.track, 8, 100);
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.v.lowFt, 100);
  assert.equal(res.v.highFt, 1975);
  assert.deepEqual([res.v.step, res.v.base], [32, 100]);
  v6ApplyImport(doc.track, res.v);
  assert.ok(doc.track.h16 instanceof Int32Array, "a tall track keeps the 32-bit store");
  assert.equal(doc.track.h16![1], 100 * 128 + 16);
  // Export gives the same samples back at the picked step and base.
  const ex = v6ExportBytes(doc.track, "raw");
  assert.deepEqual([ex.step, ex.base, ex.side], [32, 100, 256]);
  assert.equal(ex.bytes[2] | (ex.bytes[3] << 8), 4);
  // A CP4 heightmap (step 128, base 0) imports into the 16-bit store unchanged.
  const cp4 = v6ImportHeights(encodeMtm2HeightRaw16(new Uint16Array(256 * 256).fill(1000)), "a.raw", newTrackDocument().track, 128, 0);
  assert.ok(cp4.ok && cp4.v.grid instanceof Uint16Array);
  // The wrong size for the world is refused.
  const bad = v6ImportHeights(encodeMtm2HeightRaw16(new Uint16Array(512 * 512)), "a.raw", doc.track, 128, 0);
  assert.equal(bad.ok, false);
});

test("a .SI3 with a bad version 6 key is refused, naming the key", async () => {
  const doc = newTrackDocument(512);
  const out = buildTrackPod(doc, { date: DATE });
  const entries = out.entries.map((e) => (e.name.toUpperCase() === "DATA\\TRAXX.TXV" ? { ...e, data: new TextEncoder().encode("formatVersion=6\r\nworldCells=300\r\n") } : e));
  const pod = writePod1("x", entries);
  await assert.rejects(loadPodTrack(sourceOf(pod), 0, "bad.pod"), /worldCells/);
});

test("a Full Map 512 track writes a 2048 x 2048 height file and reads it back as a Full Map", async () => {
  const doc = newTrackDocument(512);
  setMode(doc.track, TERRAINMODE_FINE);
  assert.equal(doc.track.fine!.length, 2048 * 2048);
  const { out, bytes } = podOf(doc);
  assert.equal(entry(out, "DATA\\TRAXX.RAW")!.data.length, 512 * 512);
  assert.ok(entry(out, "DATA\\TRAXX_H.PNG"));
  assert.equal(readTxvV6(entry(out, "DATA\\TRAXX.TXV")!.data).terrainGrid, "fine");
  const back = await loadPodTrack(sourceOf(bytes), 0, "fine.pod");
  assert.equal(back.track.terrainMode, TERRAINMODE_FINE);
  assert.equal(back.track.fine!.length, 2048 * 2048);
});

const CRAZY = join(process.env.JSTRAXX_GAMES ?? join(homedir(), "games"), "mtm2-v6-test", "CRAZY4X.POD");
test("CRAZY4X.POD (version 6 test track) loads, saves back as .SI3 and reloads with its keys", { skip: !existsSync(CRAZY) && "no CRAZY4X.POD" }, async () => {
  const bytes = new Uint8Array(readFileSync(CRAZY));
  const src = sourceOf(bytes);
  const list = await countTracks(src);
  const which = list.stems.findIndex((s) => s.toUpperCase() === "CRAZY4X");
  assert.ok(which >= 0);
  const doc = await loadPodTrack(src, which, "CRAZY4X.POD");
  const t = doc.track;
  assert.equal(t.worldCells, 512);
  assert.equal(isV6(t), true);
  const keys = readTxvV6(readPodEntry(bytes, parsePod(bytes).entries.find((e) => e.name.toUpperCase() === "DATA\\CRAZY4X.TXV")!));
  assert.deepEqual([t.heightStep, t.heightBase], [keys.terrainHeightStep, keys.terrainHeightBase]);
  assert.ok(t.h16 && t.h16.length === 512 * 512);
  assert.ok(t.groundBoxes.length > 0, "ground boxes");
  assert.ok(t.lakes.length >= 1, "lakes");
  assert.ok((t.falls?.length ?? 0) >= 1, "waterfalls");
  assert.ok(t.vegetation?.image, "vegetation");
  doc.viewOnly = false;
  const out = buildTrackPod(doc, { date: DATE });
  assert.equal(out.v6, true);
  assert.ok(entry(out, "WORLD\\CRAZY4X.SI3"));
  assert.ok(entry(out, "WORLD\\CRAZY4X.WTR"), `no .WTR: ${out.warnings.join(" | ")}`);
  assert.ok(entry(out, "WORLD\\CRAZY4X.WFL"), `no .WFL: ${out.warnings.join(" | ")}`);
  assert.deepEqual(out.warnings.filter((w) => /lake|waterfall/i.test(w)), [], "the lakes and falls pass Traxx's checks");
  const v6 = readTxvV6(entry(out, "DATA\\CRAZY4X.TXV")!.data);
  // Re-picked (never the pod's 32 / 150): its 95 ft water counts in the span (TrackHeightSpan), so base 95, step 16.
  assert.deepEqual([v6.worldCells, v6.terrainHeightStep, v6.terrainHeightBase, v6.terrainGrid], [512, 16, 95, "spline"]);
  const again = await loadPodTrack(sourceOf(writePod1(out.comment, out.entries)), 0, "again.pod");
  assert.equal(again.track.worldCells, 512);
  // Each height is the floor of its sample at the new step (HeightToSample), 1/16 ft = 8 v.
  assert.deepEqual(Array.from(again.track.h16!.subarray(0, 4096)), Array.from(t.h16.subarray(0, 4096), (h) => (((h - 95 * 128) >> 3) << 3) + 95 * 128));
  assert.equal(again.track.groundBoxes.length, t.groundBoxes.length);
  assert.equal(again.track.lakes[0]!.height, t.lakes[0]!.height);
});

test("the track's own water: 0..WaterLevelMax4 of the kind (1020 classic, 1023 Standard, 16384 Tall), never below 0", () => {
  // A classic track: 0..1020 half feet, as before.
  const plain = newTrackDocument();
  assert.deepEqual(trackWaterRange(plain.track), [0, TRACK_WATER_MAX4]);
  plain.track.waterLevel4 = 400;
  assert.match(text(entry(podOf(plain).out, "LEVELS\\TRAXX.LVL")!.data), /!waterHeight\r\n400\r\n/);
  const r = adjustHeights(new Uint8Array(65536).fill(100), { scale: false, increment: 200, factor: 1, avoidClip: false }, [], 1000);
  assert.equal(r.water4, TRACK_WATER_MAX4);
  assert.deepEqual(trackWaterRange(newTrackDocument(512).track), [0, 1023]);

  // A tall 512-cell world: water at 1,500 ft (3,000 half feet) is kept, written and counted into the .TXV's range.
  const big = newTrackDocument(512, "tall");
  setMode(big.track, TERRAINMODE_CLASSIC16);
  big.track.h16 = new Int32Array(512 * 512).fill(1400 * 128);
  big.track.h16[7] = 1700 * 128;
  assert.deepEqual(trackWaterRange(big.track), [0, 16384]);
  big.track.waterLevel4 = 3000;
  const { step, base } = pickStepAndBase(big.track);
  const [wlo, whi] = v6WaterRange(step, base);
  assert.ok(3000 >= wlo && 3000 <= whi, `${wlo}..${whi}`);
  const out = podOf(big).out;
  assert.match(text(entry(out, "LEVELS\\TRAXX.LVL")!.data), /!waterHeight\r\n3000\r\n/);
  const v6 = readTxvV6(entry(out, "DATA\\TRAXX.TXV")!.data);
  assert.ok(3000 >= 2 * v6.terrainHeightBase && 3000 <= 2 * (v6.terrainHeightBase + 65536 / v6.terrainHeightStep));
  // Water above every point widens the range to reach it: 4,000 ft over ground of 1,400 to 1,700 ft.
  big.track.waterLevel4 = 8000;
  const tall = pickStepAndBase(big.track);
  assert.ok(8000 <= v6WaterRange(tall.step, tall.base)[1], JSON.stringify(tall));
  // TRAXXV24 keeps it (the v6 block's water4); Adjust Heights lifts it past 510 ft on a tall track.
  big.track.waterLevel4 = 3001;
  assert.equal(readTxx(writeTxx(big.track)).waterLevel4, 3001);
  const lifted = adjustHeights(new Uint8Array(512 * 512).fill(100), { scale: false, increment: 200, factor: 1, avoidClip: false }, [], 1000, undefined, undefined, trackWaterRange(big.track));
  assert.equal(lifted.water4, 1800);

  // Water outside 0..510 ft does not make a classic track version 6: it is still a .SIT.
  const wet = newTrackDocument();
  wet.track.waterLevel4 = 1020;
  assert.equal(isV6(wet.track), false);
  assert.ok(entry(podOf(wet).out, "WORLD\\TRAXX.SIT"));
});

import { objectLimit } from "../src/core/traxx/v6.ts";
import { TRAXX_MAX_BOXES, V6_MAX_BOXES, readTraxxSit, traxxBoxDefaults, traxxSitDefaults, writeTraxxSit } from "../src/core/traxx/sit.ts";
import { insertObject, pasteObject } from "../src/core/edit/objects.ts";

test("objects: 16,384 on a version 6 track (MaxBoxes), Traxx's 4096 on a classic one", () => {
  assert.equal(V6_MAX_BOXES, 4 * TRAXX_MAX_BOXES);
  const classic = newTrackDocument(), big = newTrackDocument(512);
  assert.equal(objectLimit(classic.track), 4096);
  assert.equal(objectLimit(newTrackDocument(256, "standard").track), 16384, "a 256 Standard V6 track keeps the version 6 limit");
  assert.equal(objectLimit(big.track), 16384);
  // Insert and paste stop at the limit they are given.
  const t = classic.track;
  t.boxes = Array.from({ length: 4096 }, traxxBoxDefaults);
  assert.equal(insertObject(t, [0, 0, 0]), null);
  assert.equal(pasteObject(t, traxxBoxDefaults(), [0, 0, 0]).refusal, "Max. 4096 Objects!");
  assert.equal(insertObject(t, [0, 0, 0], [0, 0, 0], V6_MAX_BOXES), 4096);
  t.boxes.length = V6_MAX_BOXES;
  t.boxes.fill(traxxBoxDefaults(), 4097);
  assert.equal(pasteObject(t, traxxBoxDefaults(), [0, 0, 0], [0, 0, 0], V6_MAX_BOXES).refusal, "Max. 16384 Objects!");
});

test("reading a situation: the objects past the limit are counted, 4096 by default, 16,384 for a .SI3", () => {
  const sit = traxxSitDefaults();
  sit.boxes = Array.from({ length: 6553 }, traxxBoxDefaults);
  const bytes = writeTraxxSit(sit);
  const classic = readTraxxSit(bytes);
  assert.equal(classic.boxes.length, 4096);
  assert.equal(classic.objectsDropped, 2457);
  const v6 = readTraxxSit(bytes, "", { maxBoxes: V6_MAX_BOXES });
  assert.equal(v6.boxes.length, 6553);
  assert.equal(v6.objectsDropped, 0);
});
