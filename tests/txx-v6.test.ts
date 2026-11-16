/*
  TRAXXV99 (a temporary number), JSTraxx's own .TXX generation for a track format version 6 document (txx.ts): a
  512-cell world with 32-bit heights, CLR, light, 16-bit ground boxes, a lake, a waterfall past
  8,192 ft and a .VEG round-trips through writeTxx / readTxx to the same pod; a .SI3 keeps being a
  .SI3; CRAZY4X.POD (a version 6 test track, skipped when absent) converts and writes back with its
  lakes and falls; a 256-cell Traxx track keeps its generation and bytes.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { buildTrackPod, podRefusal } from "../src/core/traxx/pod-writer.ts";
import { openTxx, type AssetSource } from "../src/core/doc/load-txx.ts";
import { podToTxx } from "../src/core/doc/pod-to-txx.ts";
import { readTxx, writeTxx, txxVersionFor, TXX_V6_VERSION } from "../src/core/traxx/txx.ts";
import { heightsChanged, setMode } from "../src/core/traxx/surface.ts";
import { refreshRaw, TERRAINMODE_CLASSIC16 } from "../src/core/traxx/terrain16.ts";
import { fallDefaults } from "../src/core/traxx/falls.ts";
import { buildVeg, emptyVegetation, VEG_KIND_PLACED } from "../src/core/traxx/veg.ts";
import { trackLakes } from "../src/core/traxx/lakes.ts";
import type { TrackDocument } from "../src/core/doc/document.ts";
import { loadPodTrack } from "../src/core/doc/load-pod.ts";
import { writePod1 } from "../src/vendor/openphotex/pod/write.js";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";

const DATE = new Date(2026, 10, 13);
const NO_ASSETS: AssetSource = { art: async () => null, model: async () => null };
const header = (b: Uint8Array) => new TextDecoder("latin1").decode(b.subarray(0, 10)).replace(/\0.*$/, "");
const entryMap = (doc: TrackDocument) => new Map(buildTrackPod(doc, { date: DATE }).entries.map((e) => [e.name.toUpperCase(), e.data]));

/* A 512-cell 16-bit track at 200 ft with a basin (a lake), tall ground, a spring past 8,192 ft and a tree. */
function bigTrack(): TrackDocument {
  const doc = newTrackDocument(512);
  const t = doc.track;
  setMode(t, TERRAINMODE_CLASSIC16);
  const n = 512, h = new Int32Array(n * n).fill(200 * 128);
  for (let z = 400; z <= 411; z++) for (let x = 400; x <= 411; x++) h[x + z * n] = 180 * 128;
  for (let x = 0; x < 20; x++) h[x + 30 * n] = 900 * 128 + 3; // a ridge past 512 ft, off the 2 ft grid
  t.h16 = h;
  refreshRaw(t); // the 8-bit mirror and its shadow follow, as every height tool leaves them
  heightsChanged(t);
  for (let i = 0; i < 2000; i++) t.clr[(i * 131) % (n * n)] = (i * 7) & 0xffff;
  t.lte![7 * 300000] = 77;
  t.groundBoxes.push({ x: 450, y: 460, w: 1, h: 1, lower: 101.25, upper: 300.5, faces: [1, 2, 3, 4, 5, 6] });
  t.lakes = [{ height: 390, flags: 1, seeds: [[405, 405]] }];
  const f = fallDefaults();
  f.npoints = 2; f.height = 410; f.pt[0] = [12000 * 16, 9000 * 16]; f.pt[1] = [12040 * 16, 9000 * 16];
  t.falls = [f];
  const v = emptyVegetation();
  v.species.push({ model: "TREE.BIN", farmodel: "", kind: VEG_KIND_PLACED, collide: 0, flags: 0, trunkdiam: 64, trunkheight: 16 });
  v.trees.push({ x: 12000 * 256, y: 0, z: 15000 * 256, species: 0, heading: 0, scale: 4096, tier: 0 });
  t.vegetation = { masks: [null, null], image: buildVeg(v, "TRAXX", "2026-11-13", 512)! };
  return doc;
}

test("a 512-cell document round-trips through TRAXXV99 to the same pod", async () => {
  const doc = bigTrack();
  assert.equal(trackLakes(doc.track).lakes[0]!.errors, 0, "the lake holds");
  const before = entryMap(doc);
  for (const name of ["WORLD\\TRAXX.SI3", "WORLD\\TRAXX.WTR", "WORLD\\TRAXX.WFL", "WORLD\\TRAXX.VEG"]) assert.ok(before.has(name), name);

  const txx = writeTxx(doc.track);
  assert.equal(header(txx), "TRAXXV99");
  assert.equal(txxVersionFor(doc.track), TXX_V6_VERSION);
  const back = readTxx(txx);
  assert.equal(back.version, 99);
  assert.equal(back.worldCells, 512);
  assert.ok(back.h16 instanceof Int32Array);
  assert.deepEqual(Array.from(back.h16!), Array.from(doc.track.h16!));
  assert.deepEqual(back.clr, doc.track.clr);
  assert.deepEqual(back.lte, doc.track.lte);
  assert.deepEqual(back.heights, doc.track.heights);
  assert.deepEqual(back.groundBoxes, doc.track.groundBoxes);
  assert.deepEqual(back.lakes, doc.track.lakes);
  assert.deepEqual(back.falls, doc.track.falls);
  assert.deepEqual(back.vegetation, doc.track.vegetation);
  // Written again: the same bytes.
  assert.deepEqual(writeTxx(back), txx);

  const reopened = await openTxx(txx, "big.txx", NO_ASSETS);
  const after = entryMap(reopened);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
  for (const [name, data] of before) assert.deepEqual(after.get(name), data, name);
});

test("a .SI3 track stays a .SI3 through its .TXX, with its step and base", async () => {
  const doc = newTrackDocument(); // 256 cells, but opened from a .SI3
  doc.carry.situationIsSi3 = true;
  doc.track.heightStep = 64;
  doc.track.heightBase = 150;
  const txx = writeTxx(doc.track, { fromSi3: true });
  assert.equal(header(txx), "TRAXXV99");
  const reopened = await openTxx(txx, "si3.txx", NO_ASSETS);
  assert.equal(reopened.carry.situationIsSi3, true);
  assert.equal("txxFromSi3" in reopened.track, false);
  assert.deepEqual([reopened.track.worldCells, reopened.track.heightStep, reopened.track.heightBase], [256, 64, 150]);
  const out = buildTrackPod(reopened, { date: DATE });
  assert.equal(out.v6, true);
  assert.ok(out.entries.some((e) => e.name === "WORLD\\TRAXX.SI3"));
  // The same track without the .SI3 intent is Traxx's own .TXX.
  assert.equal(header(writeTxx(newTrackDocument().track)), "TRAXXV2");
});

test("a 256-cell Traxx track keeps its generation and its bytes", () => {
  const doc = newTrackDocument();
  const f = fallDefaults();
  f.npoints = 2; f.height = 410; f.pt[0] = [1600, 1600]; f.pt[1] = [2080, 1600];
  doc.track.falls = [f];
  doc.track.groundBoxes.push({ x: 40, y: 50, w: 1, h: 1, lower: 100, upper: 110, faces: [1, 2, 3, 4, 5, 6] });
  const txx = writeTxx(doc.track);
  assert.equal(header(txx), "TRAXXV18");
  const back = readTxx(txx);
  assert.equal(back.worldCells, 256);
  assert.equal(back.heightStep, null);
  assert.equal("txxFromSi3" in back, false);
  assert.deepEqual(writeTxx(back), txx);
});

const CRAZY = join(process.env.JSTRAXX_GAMES ?? join(homedir(), "games"), "mtm2-v6-test", "CRAZY4X.POD");
test("CRAZY4X.POD converts to a TRAXXV99 .TXX and writes back with its lakes and falls", { skip: !existsSync(CRAZY) && "no CRAZY4X.POD" }, async () => {
  const pod = new Uint8Array(readFileSync(CRAZY));
  const { txx, doc } = await podToTxx(pod, "CRAZY4X", "CRAZY4X.POD");
  assert.equal(header(txx), "TRAXXV99");
  const reopened = await openTxx(txx, "CRAZY4X.txx", NO_ASSETS);
  const t = reopened.track;
  assert.equal(t.worldCells, doc.track.worldCells);
  assert.equal(reopened.carry.situationIsSi3, true);
  assert.deepEqual([t.heightStep, t.heightBase], [doc.track.heightStep, doc.track.heightBase]);
  assert.deepEqual(Array.from((t.fine ?? t.h16)!), Array.from((doc.track.fine ?? doc.track.h16)!));
  assert.deepEqual(t.lakes, doc.track.lakes);
  assert.deepEqual(t.falls, doc.track.falls);
  const out = buildTrackPod(reopened, { date: DATE });
  assert.equal(out.v6, true);
  const lakeOrFall = out.warnings.filter((w) => /lake|waterfall/i.test(w));
  assert.deepEqual(lakeOrFall, []);
  assert.equal(podRefusal(reopened), null);
  if (doc.track.lakes.length) assert.ok(out.entries.some((e) => /\.WTR$/i.test(e.name)), "the .WTR");
  if (doc.track.falls.length) assert.ok(out.entries.some((e) => /\.WFL$/i.test(e.name)), "the .WFL");
  // The same lakes and falls files as the pod read directly.
  const direct = buildTrackPod(doc, { date: DATE });
  for (const ext of ["WTR", "WFL", "VEG"]) {
    const a = direct.entries.find((e) => e.name.toUpperCase().endsWith(`.${ext}`)), b = out.entries.find((e) => e.name.toUpperCase().endsWith(`.${ext}`));
    assert.deepEqual(b?.data, a?.data, ext);
  }
});

/*
  The water detail normal and water mask (Traxx 1.7.2, TRAXXV19): on a Traxx track they make the
  file V19 and nothing else changes; on a version 6 track V99 always carries both records (empty
  when unset), after the waterfalls and before the version 6 block.
*/
const WDTL = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const WMSK = Uint8Array.from([7, 7, 7, 7, 7]);

/** Where `needle` first sits in `hay`, or -1. */
function indexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}

test("TRAXXV19: a water map makes a Traxx track V19, laid out as the V9 pair after the falls", () => {
  const doc = newTrackDocument();
  const plain = writeTxx(doc.track);
  doc.track.waterMaskMap = WMSK; doc.track.waterMaskExt = ".TGA";
  const txx = writeTxx(doc.track);
  assert.equal(header(txx), "TRAXXV19");
  // V19 = V18's bytes (empty V15..V18 blocks), then ext "" + 0, then ".TGA" + 5 + bytes.
  const v18 = writeTxx({ ...doc.track, waterMaskMap: null, falls: [fallDefaults()] });
  assert.equal(header(v18), "TRAXXV18");
  const tail = Uint8Array.from([1, 0, 0, 0, 0, 0, 5, 0x2e, 0x54, 0x47, 0x41, 0, 5, 0, 0, 0, ...WMSK]);
  assert.deepEqual(txx.subarray(txx.length - tail.length), tail);
  const back = readTxx(txx);
  assert.equal(back.version, 19);
  assert.deepEqual([back.waterDetailExt, back.waterDetailMap, back.waterMaskExt, back.waterMaskMap], ["", null, ".TGA", WMSK]);
  assert.deepEqual(writeTxx(back), txx);
  // Either map alone is enough; with both, both round-trip.
  doc.track.waterDetailMap = WDTL; doc.track.waterDetailExt = ".PNG";
  const both = readTxx(writeTxx(doc.track));
  assert.deepEqual([both.waterDetailExt, both.waterDetailMap, both.waterMaskExt, both.waterMaskMap], [".PNG", WDTL, ".TGA", WMSK]);
  // No water map: the bytes Traxx 1.7.1 wrote, generation and all.
  assert.equal(header(plain), "TRAXXV2");
  assert.deepEqual(writeTxx({ ...doc.track, waterDetailMap: null, waterMaskMap: null }), plain);
});

test("TRAXXV99 always carries both water records, then the version 6 block", () => {
  const doc = newTrackDocument(512);
  const none = writeTxx(doc.track);
  assert.equal(header(none), "TRAXXV99");
  // ... the falls (a count of 0), ext "" length 0 twice, then block version 1, flags, step, base.
  const tail = Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(none.subarray(none.length - tail.length), tail);
  const empty = readTxx(none);
  assert.deepEqual([empty.version, empty.waterDetailMap, empty.waterMaskMap, empty.worldCells], [99, null, null, 512]);
  assert.deepEqual(writeTxx(empty), none);

  doc.track.waterDetailMap = WDTL; doc.track.waterDetailExt = ".PNG";
  doc.track.waterMaskMap = WMSK; doc.track.waterMaskExt = ".PNG";
  doc.track.heightStep = 64; doc.track.heightBase = 150;
  const txx = writeTxx(doc.track);
  assert.equal(header(txx), "TRAXXV99");
  const at = indexOf(txx, WMSK);
  assert.ok(at > indexOf(txx, WDTL) && indexOf(txx, WDTL) > 0);
  // The version 6 block follows the mask's bytes directly.
  const dv = new DataView(txx.buffer, txx.byteOffset + at + WMSK.length, 16);
  assert.deepEqual([dv.getInt32(0, true), dv.getInt32(4, true), dv.getInt32(8, true), dv.getInt32(12, true)], [1, 2, 64, 150]);
  const back = readTxx(txx);
  assert.deepEqual([back.waterDetailExt, back.waterDetailMap, back.waterMaskExt, back.waterMaskMap, back.heightStep, back.heightBase], [".PNG", WDTL, ".PNG", WMSK, 64, 150]);
  assert.deepEqual(writeTxx(back), txx);
});

test("the water maps ride into the pod as ART\\<stem>_WDTL / _WMSK, .SI3 tracks too, and back", async () => {
  for (const cells of [256, 512]) {
    const doc = newTrackDocument(cells);
    doc.track.waterDetailMap = WDTL; doc.track.waterDetailExt = ".PNG";
    doc.track.waterMaskMap = WMSK; doc.track.waterMaskExt = ".TGA";
    const names = buildTrackPod(doc, { date: DATE }).entries.map((e) => e.name);
    assert.ok(names.includes("ART\\TRAXX_WDTL.PNG") && names.includes("ART\\TRAXX_WMSK.TGA"), `${cells}`);
    // After the terrain pair's place and before the vegetation masks, as Traxx's loop writes them.
    assert.ok(names.indexOf("ART\\TRAXX_WDTL.PNG") < names.indexOf("ART\\TRAXX_WMSK.TGA"));
    // Read back out of the pod (.SIT at 256, .SI3 at 512), byte for byte, with the extension that answered.
    const out = buildTrackPod(doc, { date: DATE });
    const bytes = writePod1(out.comment, out.entries);
    const back = await loadPodTrack({ archive: parsePod(bytes), read: async (e) => readPodEntry(bytes, e) }, 0, "T.POD");
    const t = back.track;
    assert.deepEqual([t.waterDetailExt, t.waterDetailMap, t.waterMaskExt, t.waterMaskMap], [".PNG", WDTL, ".TGA", WMSK], `${cells}`);
    assert.deepEqual([back.carry.waterDetailFromPod, back.carry.waterMaskFromPod, back.carry.detailFromPod], [true, true, false]);
  }
});
