/*
  Traxx origin/main (1.8.2-beta) Write POD, Open POD and Clone of a version 6 track, and the race rules in a pod: the
  cases of tools/podtest.cpp (test_v6_bad_txv_key_refused, test_v6_no_height_map, test_v6_load_512_refusals,
  test_v6_clone_512_refusals, the race-rules export) and the rules of TrackPODHeightScale.cpp, TrackPODFile.cpp Save /
  Load / WriteTXVFile and TrackPODClone.cpp, with upstream's sentences.

  The five drag templates Traxx 1.8.2 wrote are compared entry by entry when their pods are on this machine
  (JSTRAXX_DRAG_TEMPLATES, a folder of <Name>_Drag.pod and .txx); the pods are 5 MB each and stay out of the repo.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { writePod1 } from "../src/vendor/openphotex/pod/write.js";
import { decodePngSamples } from "../src/vendor/openphotex/texture/png.js";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { buildTrackPod, countCheckpointBoxes, maxTextureIndex, podExportForcedNote, podRefusal, writeTex, writeTxvFile, PodBuildRefused, type TextureExtras } from "../src/core/traxx/pod-writer.ts";
import { loadPodTrack, PodLoadRefused, texturePlaceholder } from "../src/core/doc/load-pod.ts";
import { cloneFromSit, CloneError, type TrackedFolder } from "../src/core/doc/clone.ts";
import { openTxx } from "../src/core/doc/load-txx.ts";
import { setMode } from "../src/core/traxx/surface.ts";
import { refreshRaw, TERRAINMODE_CLASSIC16 } from "../src/core/traxx/terrain16.ts";
import {
  heightToSample, pickHeightStepBase, sampleToHeight, trackHeightSpan, v6EncodeBoxTop, v6EncodeSamples, v6ParseTxv, v6PickWriteScale,
  v6TxvFormatVersion, v6TxvLevelRefusal, v6WriteScaleRefusal, V6W_BELOW_ZERO, V6W_OK, V6W_TOO_TALL,
} from "../src/core/traxx/v6.ts";
import { lakeHeightWindowFor, storedLakesNotWritableText } from "../src/core/traxx/lakes.ts";
import { traxxBoxDefaults, TRAXX_BOX_CHECKPOINT } from "../src/core/traxx/sit.ts";
import { RACERULES_DRAG, RACERULES_PARALLEL } from "../src/core/traxx/race-types.ts";
import { wallDefaults } from "../src/core/traxx/walls.ts";
import type { TrackDocument } from "../src/core/doc/document.ts";

const DATE = new Date(2026, 10, 21);
const sourceOf = (bytes: Uint8Array) => ({ archive: parsePod(bytes), read: async (e: { offset: number; length: number }) => readPodEntry(bytes, e) });
const entry = (out: { entries: { name: string; data: Uint8Array }[] }, name: string) => out.entries.find((e) => e.name.toUpperCase() === name.toUpperCase());
const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const enc = (s: string) => new TextEncoder().encode(s);

/* V6PrecisePod: a Standard V6 256 track, 16-bit heights 100..200 ft with fractions, one ground box at (5, 6). */
function precise(): TrackDocument {
  const doc = newTrackDocument(256, "standard");
  const t = doc.track;
  setMode(t, TERRAINMODE_CLASSIC16);
  const h = new Uint16Array(256 * 256);
  for (let i = 0; i < h.length; i++) h[i] = 100 * 128 + ((i * 37) % (100 * 128));
  t.h16 = h;
  refreshRaw(t); // the 8-bit mirror follows, as every edit keeps it
  t.groundBoxes = [{ x: 5, y: 6, w: 1, h: 1, lower: 12800 - 1280, upper: 12900 - 1280, faces: [1, 2, 3, 4, 5, 6] }];
  return doc;
}
const podBytes = (doc: TrackDocument) => { const out = buildTrackPod(doc, { date: DATE }); return { out, bytes: writePod1(out.comment, out.entries) }; };
/** The pod with entry `name` replaced (null: removed). */
function patched(out: { comment: string; entries: { name: string; data: Uint8Array }[] }, name: string, data: Uint8Array | null): Uint8Array {
  const entries = out.entries.flatMap((e) => (e.name.toUpperCase() !== name.toUpperCase() ? [e] : data ? [{ ...e, data }] : []));
  return writePod1(out.comment, entries);
}
const txvOf = (out: { entries: { name: string; data: Uint8Array }[] }) => text(entry(out, "DATA\\TRAXX.TXV")!.data);
const refusalOf = async (bytes: Uint8Array) => {
  try { await loadPodTrack(sourceOf(bytes), 0, "x.pod"); } catch (e) { assert.ok(e instanceof PodLoadRefused, String(e)); return (e as Error).message; }
  return null;
};

// ---- the scale (TrackPODHeightScale.cpp) ----

test("PickHeightStepBase, HeightToSample (the floor), V6EncodeBoxTop", () => {
  assert.deepEqual(pickHeightStepBase(12 * 128, 1821 * 128), { step: 32, base: 12 });
  assert.deepEqual(pickHeightStepBase(0, 65535), { step: 128, base: 0 });
  assert.deepEqual(pickHeightStepBase(0, 65536), { step: 64, base: 0 });
  assert.equal(pickHeightStepBase(-1, 100), null, "base below 0");
  assert.equal(pickHeightStepBase(0, 65536 * 128 + 128 * 2), null, "more than 65,535 ft");
  // Floor, not round: at step 32 a sample is 4 v.
  assert.equal(heightToSample(12 * 128 + 7, 32, 12), 1);
  assert.equal(sampleToHeight(1, 32, 12), 12 * 128 + 4);
  assert.deepEqual(Array.from(v6EncodeSamples([-50, 0, 65535 * 128 + 500], 128, 0)), [0, 0, 65535]);
  assert.equal(v6EncodeBoxTop(0, 128, 0), 0, "no box");
  assert.equal(v6EncodeBoxTop(50 * 128, 128, 100), 1, "a top on the floor of the window is 1");
});

test("TrackHeightSpan: boxes with upper 0 skipped, water above 0, lakes and falls count on a v6 track", () => {
  const doc = precise();
  const t = doc.track;
  let [lo, hi] = trackHeightSpan(t);
  assert.equal(lo, 12800 - 1280, "the box's lower");
  t.groundBoxes.push({ x: 9, y: 9, w: 1, h: 1, lower: 0, upper: 0, faces: [0, 0, 0, 0, 0, 0] });
  assert.deepEqual(trackHeightSpan(t), [lo, hi], "a box with upper 0 is no box");
  t.waterLevel4 = 60; // 30 ft, under the ground: still lowers the base
  [lo, hi] = trackHeightSpan(t);
  assert.equal(lo, 60 * 64);
  assert.deepEqual(v6PickWriteScale(t), { verdict: V6W_OK, step: 128, base: 30, lowest: 60 * 64 });
  t.lakes = [{ height: 1023, flags: 0, seeds: [[1, 1]] }];
  assert.equal(trackHeightSpan(t)[1], 1023 * 64);
  // A classic track's step does not depend on them (and has no step at all).
  const c = newTrackDocument().track;
  c.waterLevel4 = 10;
  assert.equal(trackHeightSpan(c)[0], 100 << 8);
});

test("Write POD refuses a v6 track below 0 ft and one spanning more than 65,535 ft, with Traxx's sentences", () => {
  const doc = newTrackDocument(256, "tall");
  doc.viewOnly = false;
  doc.track.groundBoxes = [{ x: 1, y: 1, w: 1, h: 1, lower: -384, upper: 256, faces: [0, 0, 0, 0, 0, 0] }];
  const s = v6PickWriteScale(doc.track);
  assert.equal(s.verdict, V6W_BELOW_ZERO);
  assert.equal(v6WriteScaleRefusal(s), "Write POD can't write this track: its lowest point is -3.00 ft, and version 6 tracks can't go below 0 ft. Raise the terrain or ground boxes below 0 ft (Adjust Heights) and try again.");
  assert.deepEqual(podRefusal(doc), { title: "Write POD", text: v6WriteScaleRefusal(s)! });
  assert.throws(() => buildTrackPod(doc, { date: DATE }), (e: unknown) => e instanceof PodBuildRefused && e.caption === "Write POD"
    && e.message === "Write POD can't write this track: version 6 tracks can't go below 0 ft. Raise the terrain or ground boxes below 0 ft (Adjust Heights) and try again.");
  assert.equal(v6WriteScaleRefusal({ verdict: V6W_TOO_TALL, step: 128, base: 0, lowest: 0 }), "Write POD can't write this track: from its lowest to its highest point it spans more than 65,535 ft.");
});

// ---- Write POD's entries ----

test("a v6 pod: the 8-bit N*N .RAW mirror then the 16-bit _H.PNG, 16-bit .RA0 / .RA1, the .TXV in Traxx's key order", () => {
  const doc = precise();
  doc.track.waterLevel4 = 300;
  doc.track.versionFlags = 0; // not MTM2-only: a v6 track writes its water all the same
  const { out } = podBytes(doc);
  const names = out.entries.map((e) => e.name.toUpperCase());
  const raw = names.indexOf("DATA\\TRAXX.RAW");
  assert.equal(names[raw + 1], "DATA\\TRAXX_H.PNG");
  assert.equal(names[raw - 1], "DATA\\TRAXX.RA5");
  assert.equal(entry(out, "DATA\\TRAXX.RAW")!.data.length, 65536);
  const png = decodePngSamples(entry(out, "DATA\\TRAXX_H.PNG")!.data);
  assert.deepEqual([png.width, png.bitDepth], [256, 16]);
  const scale = out.v6Scale!;
  assert.equal(scale.base, 90, "the box's 90 ft lower is the lowest point");
  assert.equal(png.samples[1], heightToSample(doc.track.h16![1]!, scale.step, scale.base));
  const ra0 = entry(out, "DATA\\TRAXX.RA0")!.data, ra1 = entry(out, "DATA\\TRAXX.RA1")!.data;
  assert.deepEqual([ra0.length, ra1.length], [131072, 131072]);
  const at = 2 * (5 + 6 * 256);
  assert.equal(ra0[at]! | (ra0[at + 1]! << 8), heightToSample(12800 - 1280, scale.step, scale.base));
  assert.equal(ra1[at]! | (ra1[at + 1]! << 8), heightToSample(12900 - 1280, scale.step, scale.base));
  assert.equal(txvOf(out), [
    "# MTM2 track version record - written by JSTraxx", "formatVersion=6", "tool=JSTraxx", `toolVersion=${/toolVersion=(.*)/.exec(txvOf(out))![1]}`,
    "built=2026-11-21", "legacyFallback=0", "hdTextures=0", "worldCells=256", "terrainHeightMap=DATA\\TRAXX_H.PNG",
    `terrainHeightStep=${scale.step}`, `terrainHeightBase=${scale.base}`, "",
  ].join("\r\n"));
  assert.match(text(entry(out, "LEVELS\\TRAXX.LVL")!.data), /!waterHeight\r\n300\r\n$/);
});

test("the .TXV: stale v6 keys and raceRules are never carried; spline writes terrainGrid before the v6 keys", () => {
  const doc = precise();
  setMode(doc.track, 2); // SPLINE
  doc.carry.txvText = "worldCells=512\r\nterrainHeightMap=OLD\r\nterrainHeightStep=1\r\nterrainHeightBase=7\r\nraceRules=drag\r\nmine=1\r\n";
  const txv = txvOf(buildTrackPod(doc, { date: DATE }));
  assert.match(txv, /hdTextures=0\r\nterrainGrid=spline\r\nworldCells=256\r\nterrainHeightMap=DATA\\TRAXX_H\.PNG\r\nterrainHeightStep=\d+\r\nterrainHeightBase=\d+\r\n# carried over from the previous build\r\nmine=1\r\n$/);
});

test("the .TEX is positional: GetMaxTextureIndex + 1 slots, an empty one RUSTPLAT.RAW; a placeholder lists and packs nothing", () => {
  const doc = newTrackDocument();
  const t = doc.track;
  const tex = (name: string) => ({ name, side: 64, indices: new Uint8Array(4096), act: null, hd: null, bad: false });
  doc.textures = [tex("ART\\A.RAW"), null, texturePlaceholder("ART\\MISSING.RAW"), tex("ART\\D.RAW")];
  t.textures = doc.textures.map((x) => ({ name: x?.name ?? "", type: 0, depth: 1 }));
  t.clr[7] = 2;
  assert.equal(maxTextureIndex(t), 2);
  t.groundBoxes = [{ x: 1, y: 1, w: 1, h: 1, lower: 0, upper: 256, faces: [0, 0, 3, 0, 0, 0] }];
  assert.equal(maxTextureIndex(t), 3);
  assert.equal(text(writeTex(doc.textures, 3)), "4\r\nA.RAW\r\nRUSTPLAT.RAW\r\nMISSING.RAW\r\nD.RAW\r\n");
  const out = buildTrackPod(doc, { date: DATE });
  assert.ok(entry(out, "ART\\A.RAW") && entry(out, "ART\\D.RAW"));
  assert.equal(entry(out, "ART\\MISSING.RAW"), undefined, "a placeholder is not packed");
});

test("Open POD: a listed texture the pod lacks, or listed twice, keeps its slot as a placeholder", async () => {
  const doc = newTrackDocument();
  const tile = { side: 64, indices: new Uint8Array(4096).fill(3), act: null, hd: null, bad: false };
  doc.textures = [{ ...tile, name: "ART\\A.RAW" }, { ...tile, name: "ART\\B.RAW" }];
  doc.track.textures = [{ name: "ART\\A.RAW", type: 0, depth: 1 }, { name: "ART\\B.RAW", type: 0, depth: 1 }];
  doc.track.clr[0] = 3;
  const out = buildTrackPod(doc, { date: DATE });
  const bytes = writePod1(out.comment, out.entries.map((e) => (/\.TEX$/i.test(e.name) ? { ...e, data: enc("4\r\nA.RAW\r\nGONE.RAW\r\nA.RAW\r\nB.RAW\r\n") } : e)));
  const back = await loadPodTrack(sourceOf(bytes), 0, "t.pod");
  assert.deepEqual(back.textures.map((x) => [x?.name, Boolean(x?.placeholder)]), [["ART\\A.RAW", false], ["ART\\GONE.RAW", true], ["ART\\A.RAW", true], ["ART\\B.RAW", false]]);
  assert.deepEqual(back.missingTextures, ["GONE.RAW"]);
  back.viewOnly = false;
  assert.equal(text(entry(buildTrackPod(back, { date: DATE }), "DATA\\TRAXX.TEX")!.data), "4\r\nA.RAW\r\nGONE.RAW\r\nA.RAW\r\nB.RAW\r\n");
});

// ---- Open POD of a .SI3 (podtest.cpp) ----

test("test_v6_bad_txv_key_refused: a key value the engine refuses names the key", async () => {
  const { out } = podBytes(precise());
  for (const [from, to, key] of [["terrainHeightStep=", "terrainHeightStep=1x8", "terrainHeightStep"], ["terrainHeightBase=", "terrainHeightBase=1x", "terrainHeightBase"], ["worldCells=256", "worldCells=25x", "worldCells"]] as const) {
    const t = txvOf(out).replace(new RegExp(`${from}[^\\r]*`), to);
    assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.TXV", enc(t))), `This track's .TXV has an invalid ${key} value; it cannot be opened.`);
  }
  // A negative base is refused (the engine takes 0..32767).
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.TXV", enc(txvOf(out).replace(/terrainHeightBase=\d+/, "terrainHeightBase=-5")))), "This track's .TXV has an invalid terrainHeightBase value; it cannot be opened.");
  // formatVersion under 6.
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.TXV", enc(txvOf(out).replace("formatVersion=6", "formatVersion=5")))), "This track cannot be opened: a .SI3 needs formatVersion=6 in its .TXV (this one has 5).");
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.TXV", null)), "This track cannot be opened: a .SI3 needs formatVersion=6 in its .TXV (this one has 0).");
});

test("V6ParseTXV, V6TxvFormatVersion and V6TxvLevelRefusal", () => {
  assert.deepEqual(v6ParseTxv("worldCells=512\r\n# terrainHeightStep=1\r\n  TERRAINHEIGHTSTEP = 16 \r\nterrainHeightStep=32\r\nterrainHeightMap= DATA\\X.raw \r\n"),
    { any: true, cells: 512, step: 32, base: 0, mapName: "DATA\\X.raw", badKey: "" });
  assert.equal(v6ParseTxv("terrainHeightStep=3\r\nworldCells=300\r\n").badKey, "worldCells", "the first refused key in Traxx's order");
  assert.equal(v6ParseTxv("terrainHeightBase=+12").base, 12);
  assert.equal(v6ParseTxv("terrainHeightBase=1000001").badKey, "terrainHeightBase");
  assert.deepEqual([v6TxvFormatVersion(null), v6TxvFormatVersion("x=1"), v6TxvFormatVersion("formatVersion=0"), v6TxvFormatVersion("formatVersion=6\r\nformatVersion=4")], [0, 1, 1, 4]);
  assert.equal(v6TxvLevelRefusal(false, "formatVersion=6\r\nraceRules=drag\r\n"), null, "formatVersion=6 alone is not v6-only");
  assert.equal(v6TxvLevelRefusal(false, "formatVersion=6\r\nterrainHeightStep=8\r\n"), "This track cannot be opened: this level is a version 6 level (its .TXV has terrainHeightStep), but its situation file is not a .SI3.");
});

test("a .SIT / .SI2 whose own .TXV carries a v6-only key is refused", async () => {
  const doc = newTrackDocument();
  const out = buildTrackPod(doc, { date: DATE });
  const t = text(entry(out, "DATA\\TRAXX.TXV")!.data) + "worldCells=256\r\n";
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.TXV", enc(t))), "This track cannot be opened: this level is a version 6 level (its .TXV has worldCells), but its situation file is not a .SI3.");
});

test("test_v6_no_height_map: a .SI3 with no terrainHeightMap takes the CP4 path, the 8-bit .RAW at step 128, base 0", async () => {
  const doc = precise();
  const { out } = podBytes(doc);
  const back = await loadPodTrack(sourceOf(patched(out, "DATA\\TRAXX.TXV", enc(txvOf(out).replace("terrainHeightMap=", "terrainHeightMaq=")))), 0, "n.pod");
  assert.equal(back.track.trackKind, "standard");
  assert.equal(back.track.terrainMode, TERRAINMODE_CLASSIC16);
  const o = doc.track.h16!;
  let bad = 0;
  for (let i = 0; i < 65536; i++) if (back.track.h16![i] !== (((o[i]! + 128) >> 8) << 8)) bad++;
  assert.equal(bad, 0);
  // The step and base are ignored without a map: the 16-bit boxes decode at 128 and 0.
  const b = back.track.groundBoxes.find((g) => g.x === 5 && g.y === 6)!;
  const s = out.v6Scale!;
  assert.deepEqual([b.lower, b.upper], [heightToSample(12800 - 1280, s.step, s.base) << 0, heightToSample(12900 - 1280, s.step, s.base) << 0]);
  // ...and with no .RAW either it is refused.
  const noRaw = patched({ comment: out.comment, entries: out.entries.filter((e) => !/\.RAW$/i.test(e.name) || !/^DATA\\TRAXX/i.test(e.name)) }, "DATA\\TRAXX.TXV", enc(txvOf(out).replace("terrainHeightMap=", "terrainHeightMaq=")));
  assert.equal(await refusalOf(noRaw), "This track has no height map and its TRAXX.RAW is missing.");
});

test("Open POD: the map by its exact name, the grid sizes, the box pair, the water window", async () => {
  const doc = precise();
  doc.track.waterLevel4 = 300;
  const { out } = podBytes(doc);
  // A pod with no entry by the map's name.
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX_H.PNG", null)), "This track's height map DATA\\TRAXX_H.PNG cannot be used: the pod has no entry by that name.");
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX_H.PNG", enc("not a png at all, really not one"))), "This track's height map DATA\\TRAXX_H.PNG cannot be used: not a PNG file.");
  // A u16 RAW map is fine (any name but .png), an unknown terrainGrid is not refused.
  const samples = new Uint8Array(2 * 65536);
  const ok = patched(writePodOut(out, "DATA\\TRAXX_H.RAW", samples), "DATA\\TRAXX.TXV", enc(txvOf(out).replace("TRAXX_H.PNG", "TRAXX_H.RAW") + "terrainGrid=bogus\r\n"));
  assert.equal(await refusalOf(ok), null);
  assert.equal(await refusalOf(patched(writePodOut(out, "DATA\\TRAXX_H.RAW", samples.subarray(2)), "DATA\\TRAXX.TXV", enc(txvOf(out).replace("TRAXX_H.PNG", "TRAXX_H.RAW")))),
    "This track's height map DATA\\TRAXX_H.RAW cannot be used: RAW size 131070 bytes is not 131072 (256x256) or 2097152 (1024x1024) 16-bit samples.");
  // .RA2..RA5, .CL1 and .CL2 are not checked.
  assert.equal(await refusalOf(patched({ comment: out.comment, entries: out.entries.filter((e) => e.name.toUpperCase() !== "DATA\\TRAXX.RA3") }, "DATA\\TRAXX.CL2", new Uint8Array(7))), null);
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.CLR", null)), "This track's colour file TRAXX.CLR is missing.");
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.CLR", new Uint8Array(10))), "The grid file TRAXX.CLR is 10 bytes; a 256-cell world needs exactly 131072.");
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.LTE", null)), null, "a .SI3 with no .LTE opens");
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.RA1", null)), "This track's ground box file TRAXX.RA0 has no partner TRAXX.RA1.");
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.RA0", new Uint8Array(65536))), "This track's ground box files TRAXX.RA0 (65536 bytes) and TRAXX.RA1 (131072 bytes) must be the same size, 65536 (8-bit) or 131072 (16-bit).");
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.CL0", null)), "This track's ground box texture file TRAXX.CL0 is missing.");
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.CL0", new Uint8Array(12))), "The ground box texture file TRAXX.CL0 is 12 bytes; a 256-cell world needs exactly 786432.");
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.RA0", null)), null, "no .RA0: no boxes, nothing asked");
  const s = out.v6Scale!;
  const hi = 2 * (s.base + 65536 / s.step);
  const lvl = text(entry(out, "LEVELS\\TRAXX.LVL")!.data).replace("!waterHeight\r\n300", `!waterHeight\r\n${hi + 1}`);
  assert.equal(await refusalOf(patched(out, "LEVELS\\TRAXX.LVL", enc(lvl))), `This track's !waterHeight is ${hi + 1}; a track with this height range allows 0 to ${hi}.`);
});

/** `out` with an entry added (or replaced). */
function writePodOut(out: { comment: string; entries: { name: string; data: Uint8Array }[] }, name: string, data: Uint8Array) {
  return { comment: out.comment, entries: [...out.entries.filter((e) => e.name.toUpperCase() !== name.toUpperCase()), { name, data }] };
}

test("test_v6_load_512_refusals: wrong-size files name the file; 8-bit box layers decode at base + 2 * byte", async () => {
  const doc = newTrackDocument(512);
  const out = buildTrackPod(doc, { date: DATE });
  const short = (name: string) => entry(out, name)!.data.subarray(12);
  assert.match((await refusalOf(patched(out, "DATA\\TRAXX.CLR", short("DATA\\TRAXX.CLR"))))!, /TRAXX\.CLR/);
  assert.match((await refusalOf(patched(out, "DATA\\TRAXX.LTE", short("DATA\\TRAXX.LTE"))))!, /TRAXX\.LTE/);
  assert.match((await refusalOf(patched(out, "DATA\\TRAXX.CL0", short("DATA\\TRAXX.CL0"))))!, /TRAXX\.CL0/);
  assert.match((await refusalOf(patched(out, "DATA\\TRAXX.RA0", short("DATA\\TRAXX.RA0"))))!, /same size/);
  assert.equal(await refusalOf(patched(out, "DATA\\TRAXX.TXV", enc(txvOf(out).replace("terrainHeightMap=", "terrainHeightMaq=")))),
    "This 512-cell track's .TXV names no terrainHeightMap; a 512-cell world needs one, so it cannot be opened.");
  const ra0 = new Uint8Array(512 * 512), ra1 = new Uint8Array(512 * 512);
  ra0[0] = 10; ra1[0] = 20;
  const back = await loadPodTrack(sourceOf(patched(writePodOut(out, "DATA\\TRAXX.RA0", ra0), "DATA\\TRAXX.RA1", ra1)), 0, "b.pod");
  const s = out.v6Scale!;
  assert.deepEqual(back.track.groundBoxes.map((g) => [g.x, g.y, g.lower, g.upper]), [[0, 0, s.base * 128 + 2560, s.base * 128 + 5120]]);
});

test("Open POD: heights above 8,192 ft are lowered to it, said once", async () => {
  const doc = newTrackDocument(256, "tall");
  const out = buildTrackPod(doc, { date: DATE });
  // Base 8000 ft, step 1: a sample of 300 is 8,300 ft.
  const samples = new Uint8Array(2 * 65536);
  samples[0] = 44; samples[1] = 1;
  const t = txvOf(out).replace(/terrainHeightStep=\d+/, "terrainHeightStep=1").replace(/terrainHeightBase=\d+/, "terrainHeightBase=8000").replace("TRAXX_H.PNG", "TRAXX_H.RAW");
  const back = await loadPodTrack(sourceOf(patched(writePodOut(out, "DATA\\TRAXX_H.RAW", samples), "DATA\\TRAXX.TXV", enc(t))), 0, "t.pod");
  assert.equal(back.track.h16![0], 8192 * 128);
  assert.equal(back.track.h16![1], 8000 * 128);
  assert.deepEqual(back.notices, [{ caption: "Terrain heights", text: "Some of this track's heights are above 8192 ft, which Traxx cannot hold: they were lowered to it." }]);
  assert.equal(back.track.trackKind, "tall");
});

// ---- Clone of a .SI3 (TrackPODClone.cpp, test_v6_clone_512_refusals) ----

function folderOf(entries: { name: string; data: Uint8Array }[]): TrackedFolder {
  const map = new Map(entries.map((e) => [e.name.toUpperCase(), e.data]));
  return { read: async (p) => map.get(p.toUpperCase()) ?? null, has: (p) => map.has(p.toUpperCase()) };
}
const NO_ASSETS = { art: async () => null, model: async () => null };
const cloneRefusal = async (entries: { name: string; data: Uint8Array }[]) => {
  try { await cloneFromSit(folderOf(entries), "WORLD\\TRAXX.SI3", NO_ASSETS); } catch (e) { assert.ok(e instanceof CloneError, String(e)); return (e as Error).message; }
  return null;
};

test("Clone of a .SI3 goes through the v6 path; the 512 refusals name the file", async () => {
  const doc = newTrackDocument(512);
  doc.track.groundBoxes = [{ x: 400, y: 400, w: 1, h: 1, lower: 10 * 256 + 5 * 128, upper: 20 * 256 + 5 * 128, faces: [1, 2, 3, 4, 5, 6] }];
  const out = buildTrackPod(doc, { date: DATE });
  const c = await cloneFromSit(folderOf(out.entries), "WORLD\\TRAXX.SI3", NO_ASSETS);
  assert.deepEqual([c.track.worldCells, c.track.trackKind, c.track.prefix], [512, "standard", "TRAXX2"]);
  assert.deepEqual(c.track.groundBoxes.map((g) => [g.x, g.y, g.lower, g.upper]), [[400, 400, 10 * 256 + 5 * 128, 20 * 256 + 5 * 128]]);
  const minus = (name: string, cut = 1) => out.entries.map((e) => (e.name.toUpperCase() === name ? { ...e, data: e.data.subarray(cut) } : e));
  for (const f of ["CLR", "LTE", "CL0"]) assert.match((await cloneRefusal(minus(`DATA\\TRAXX.${f}`)))!, new RegExp(`TRAXX\\.${f}`));
  assert.match((await cloneRefusal(minus("DATA\\TRAXX.RA1")))!, /same size/);
  const txv = (t: string) => out.entries.map((e) => (e.name.toUpperCase() === "DATA\\TRAXX.TXV" ? { ...e, data: enc(t) } : e));
  assert.equal(await cloneRefusal(txv(txvOf(out).replace("terrainHeightMap=", "terrainHeightMaq="))), "This 512-cell track's .TXV names no terrainHeightMap; a 512-cell world needs one, so it cannot be cloned.");
  assert.match((await cloneRefusal([...txv(txvOf(out).replace("TRAXX_H.PNG", "TRAXX_H.RAW")), { name: "DATA\\TRAXX_H.RAW", data: new Uint8Array(2 * 512 * 512 + 2) }]))!, /RAW size/);
  assert.equal(await cloneRefusal(txv(txvOf(out).replace("worldCells=512", "worldCells=51x"))), "This track's .TXV has an invalid worldCells value; it cannot be cloned.");
  // A 256 x 256 PNG over a 512-cell world.
  const small = buildTrackPod(newTrackDocument(256, "standard"), { date: DATE });
  const png = entry(small, "DATA\\TRAXX_H.PNG")!.data;
  const msg = await cloneRefusal(out.entries.map((e) => (e.name.toUpperCase() === "DATA\\TRAXX_H.PNG" ? { ...e, data: png } : e)));
  assert.match(msg!, /TRAXX_H\.PNG/);
  assert.match(msg!, /512/);
});

// ---- race rules in a pod ----

/** A Parallel track: 3 checkpoints in reverse box order, a wall. */
function parallelDoc(): TrackDocument {
  const doc = newTrackDocument();
  doc.viewOnly = false;
  const t = doc.track;
  t.trackType = 2;
  for (const [seq, x] of [[3, 3000], [1, 1000], [2, 2000]] as const) {
    const b = traxxBoxDefaults();
    b.type = TRAXX_BOX_CHECKPOINT; b.checkpointSeq = seq; b.ipos = [x, 4000, 100]; b.height = 20;
    t.boxes.push(b);
  }
  t.raceRules.mode = RACERULES_PARALLEL;
  t.raceRules.laps = 0;
  const w = wallDefaults("rail");
  w.points = [{ x: 100 * 256, z: 100 * 256, bend: 0, above: 0, gap: 0 }, { x: 140 * 256, z: 100 * 256, bend: 0, above: 0, gap: 0 }];
  t.raceRules.walls.push(w);
  return doc;
}

test("race rules on Write POD: .SI2, the boxes in the .CPX's order, WORLD\\<stem>.CPX after the .TXV, raceRules= and formatVersion 6", async () => {
  const doc = parallelDoc();
  const out = buildTrackPod(doc, { date: DATE });
  assert.equal(out.cpx, true);
  const names = out.entries.map((e) => e.name.toUpperCase());
  const at = names.indexOf("WORLD\\TRAXX.SI2");
  assert.ok(at >= 0, "the rules force .SI2");
  assert.deepEqual(names.slice(at, at + 3), ["WORLD\\TRAXX.SI2", "DATA\\TRAXX.TXV", "WORLD\\TRAXX.CPX"]);
  assert.deepEqual(doc.track.boxes.map((b) => b.checkpointSeq), [1, 2, 3], "Save permutes the type-6 boxes");
  const txv = txvOf(out);
  assert.match(txv, /^# MTM2 track version record - written by JSTraxx\r\nformatVersion=6\r\n/);
  assert.match(txv, /hdTextures=0\r\nraceRules=parallel\r\n$/);
  assert.match(txv, /legacyFallback=0/);
  // Opened again, the .CPX applies to the same boxes and says nothing.
  const back = await loadPodTrack(sourceOf(writePod1(out.comment, out.entries)), 0, "r.pod");
  assert.equal(back.track.raceRules.mode, RACERULES_PARALLEL);
  assert.equal(back.track.raceRules.walls.length, 1);
  assert.deepEqual(back.notices, []);
  // A box moved after the rules were written: the rules are not applied, and the note says why, once.
  const moved = writePod1(out.comment, out.entries.map((e) => (/\.SI2$/i.test(e.name) ? { ...e, data: enc(text(e.data).replace("1000.000000", "1300.000000")) } : e)));
  const stale = await loadPodTrack(sourceOf(moved), 0, "s.pod");
  assert.equal(stale.track.raceRules.mode, 0);
  assert.equal(stale.notices!.length, 1);
  assert.equal(stale.notices![0]!.caption, "Race rules");
  assert.match(stale.notices![0]!.text, /^Race rules \(WORLD\\TRAXX\.CPX\) not applied: /);
});

test("race rules that refuse stop Write POD before anything is written: \"Race rules: ...\", caption \"Cannot build the pod\"", () => {
  const doc = parallelDoc();
  doc.track.raceRules.mode = RACERULES_DRAG;
  doc.track.trackType = 1;
  const before = doc.track.boxes.map((b) => b.checkpointSeq);
  assert.throws(() => buildTrackPod(doc, { date: DATE }), (e: unknown) => e instanceof PodBuildRefused && e.caption === "Cannot build the pod" && /^Race rules: .*at least 4 checkpoints/.test(e.message));
  assert.deepEqual(doc.track.boxes.map((b) => b.checkpointSeq), before, "nothing changed");
});

test("more than 20 checkpoint boxes (copies count): .SI2, formatVersion 6, no raceRules key, the dialog's forced note", () => {
  const doc = newTrackDocument();
  for (let i = 0; i < 21; i++) { const b = traxxBoxDefaults(); b.type = TRAXX_BOX_CHECKPOINT; b.checkpointSeq = i; doc.track.boxes.push(b); }
  assert.equal(countCheckpointBoxes(doc.track), 21);
  const out = buildTrackPod(doc, { date: DATE });
  assert.ok(entry(out, "WORLD\\TRAXX.SI2"));
  assert.equal(out.cpx, false);
  const txv = txvOf(out);
  assert.match(txv, /formatVersion=6\r\n/);
  assert.match(txv, /legacyFallback=0\r\n/);
  assert.doesNotMatch(txv, /raceRules/);
  assert.equal(podExportForcedNote(doc.track), "More than 20 checkpoints: only new builds can load this track, so it is written as .SI2.");
  doc.track.boxes.pop();
  assert.equal(podExportForcedNote(doc.track), null);
  assert.ok(entry(buildTrackPod(doc, { date: DATE }), "WORLD\\TRAXX.SIT"), "20 stay a .SIT");
  assert.match(text(writeTxvFile(doc, true, false, DATE)), /formatVersion=1\r\n/);
});

test("the stored lake map's refusal and LakeHeightWindowFor", () => {
  assert.equal(storedLakesNotWritableText(2), "The stored lake map can't be written: lake 3 does not pass the game's own checks (a height out of range, no tiles, or water at or below the main water).\n\nRecompute the lakes at the prompt, or fix the lake.\n\nNothing was written.");
  assert.deepEqual(lakeHeightWindowFor(false, 256, 128, 0), { lo1: 1, hi1: 4096, lo2: 1, hi2: 0 });
  assert.deepEqual(lakeHeightWindowFor(true, 256, 8, 10), { lo1: 1, hi1: 4096, lo2: 21, hi2: 2 * (10 + 8192) });
  assert.deepEqual(lakeHeightWindowFor(true, 512, 128, 0), { lo1: 1, hi1: 1024, lo2: 1, hi2: 0 });
});

// ---- the drag templates Traxx 1.8.2 wrote ----

const TEMPLATES = process.env.JSTRAXX_DRAG_TEMPLATES ?? "/private/tmp/claude-501/-Users-juanpabloutreras-dev-JTraxx3/43e2ca2c-e5d3-4fbd-9d5d-42cc0fa54076/scratchpad/templates";
const haveTemplates = existsSync(join(TEMPLATES, "Straight_Drag.pod"));

test("each drag template's .TXX writes its pod entry for entry, byte for byte (the .TXV but its tool lines)", { skip: !haveTemplates && "no drag template pods (JSTRAXX_DRAG_TEMPLATES)" }, async () => {
  for (const n of ["Straight", "J", "O", "CrossOver", "PaperClip"]) {
    const pod = new Uint8Array(readFileSync(join(TEMPLATES, `${n}_Drag.pod`)));
    const arch = parsePod(pod);
    const get = (name: string) => { const e = arch.entries.find((x) => x.name.toUpperCase() === name.toUpperCase()); return e ? readPodEntry(pod, e) : null; };
    // Traxx's ART and MODELS folders held what the pod holds; its HD sources sit beside the .RAW.
    const doc = await openTxx(new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "drags", `${n}_Drag.txx`))), `${n}_Drag.txx`,
      { art: async (p) => get(`ART\\${p}`), model: async (p) => get(`MODELS\\${p}`) });
    const extras = new Map<string, TextureExtras>();
    for (const t of [...doc.textures, ...doc.modelTextures]) {
      if (!t) continue;
      for (const ext of ["PNG", "TGA"] as const) {
        const hd = get(t.name.replace(/\.RAW$/i, `.${ext}`));
        if (hd) { extras.set(t.name.toUpperCase(), { hd: { ext, data: hd }, maps: [] }); break; }
      }
    }
    const out = buildTrackPod(doc, { date: DATE, extras });
    assert.deepEqual(out.entries.map((e) => e.name.toUpperCase()), arch.entries.map((e) => e.name.toUpperCase()), `${n}: the entries and their order`);
    const strip = (b: Uint8Array) => text(b).split("\r\n").filter((l) => !/^(tool|toolVersion|built)=|^# MTM2 track version record/.test(l)).join("\r\n");
    for (const e of arch.entries) {
      const mine = entry(out, e.name)!.data, theirs = readPodEntry(pod, e);
      if (/\.TXV$/i.test(e.name)) assert.equal(strip(mine), strip(theirs), `${n}: ${e.name}`);
      else assert.ok(mine.length === theirs.length && mine.every((v, i) => v === theirs[i]), `${n}: ${e.name} byte for byte`);
    }
  }
});
