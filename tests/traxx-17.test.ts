/*
  Traxx 1.7's file changes: the .TXX generations V12 to V17 (fog, vegetation, lakes, terrain
  modes), the .SIT 'F' fog block, the size-aware height file, the .TXV keys and the music kinds.

  The cp4sandbox checks read a track Traxx 1.7 wrote (JSTRAXX_CP4, default ~/games/cp4sandbox:
  fog_test.txx and fog_test.pod) and skip when it is absent.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { readTxx, txxVersionFor, writeTxx } from "../src/core/traxx/txx.ts";
import type { TxxTrack } from "../src/core/traxx/txx.ts";
import {
  readTraxxSit, traxxBoxDefaults, traxxFogEngineDefaults, writeTraxxSit, TRAXX_BOX_FOG,
} from "../src/core/traxx/sit.ts";
import {
  mirrorOf, parseTerrainGridKey, resolveTerrainMode, syncFromRaw, refreshRaw, loadRaw,
  TERRAINMODE_CLASSIC16, TERRAINMODE_CLASSIC8, TERRAINMODE_FINE, TERRAINMODE_SPLINE, RAWLEN_16BIT, RAWLEN_FINE,
} from "../src/core/traxx/terrain16.ts";
import { resetTrack, newTrackDocument } from "../src/core/doc/new-track.ts";
import { buildTrackPod, musicKind, writeLvl } from "../src/core/traxx/pod-writer.ts";
import { seekToItem } from "../src/core/traxx/pod-items.ts";
import { openTxx } from "../src/core/doc/load-txx.ts";
import { loadPodTrack, applyTerrainHeightsImage } from "../src/core/doc/load-pod.ts";
import { deflateSync } from "node:zlib";
import { budgetCap, budgetGroup, indexToType, typeToIndex, TYPEIDX_CRUSH, TYPEIDX_FOG, TYPEIDX_RAMP } from "../src/core/edit/objects.ts";

const CP4 = process.env.JSTRAXX_CP4 ?? join(process.env.HOME ?? "", "games", "cp4sandbox");
const TXX = join(CP4, "fog_test.txx");
const POD = join(CP4, "fog_test.pod");
const noTxx = existsSync(TXX) ? false : `no ${TXX}`;
const noPod = existsSync(POD) ? false : `no ${POD}`;
const noBoth = noTxx || noPod;

/** A track with one of everything 1.7 adds, on a 16-bit terrain. */
function track17(): TxxTrack {
  const t = resetTrack();
  t.versionFlags = 1;
  const fog = traxxBoxDefaults();
  fog.type = TRAXX_BOX_FOG;
  fog.width = 120; fog.length = 80; fog.height = 30;
  fog.fog.vis = 150; fog.fog.round = 0.25;
  const plain = traxxBoxDefaults();
  plain.fog.vis = 777;
  t.boxes = [fog, plain];
  t.vegetation = { masks: [{ ext: ".PNG", data: Uint8Array.of(1, 2, 3) }, null], image: Uint8Array.of(77, 86, 69, 71, 9) };
  t.lakes = [{ height: 412, flags: 1, seeds: [[10, 20], [11, 21]] }, { height: 9, flags: 0, seeds: [] }];
  t.terrainMode = TERRAINMODE_CLASSIC16;
  t.h16 = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) t.h16[i] = (i * 37) & 0xffff;
  t.rawShadow = new Uint8Array(65536);
  refreshRaw(t);
  return t;
}

test("V12 to V17: every block reads back as written", () => {
  const t = track17();
  const bytes = writeTxx(t);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 8)), "TRAXXV17");
  const back = readTxx(bytes);
  assert.equal(back.version, 17);
  assert.equal(back.terrainMode, TERRAINMODE_CLASSIC16);
  assert.deepEqual(back.h16, t.h16);
  assert.deepEqual(back.heights, t.heights);
  assert.deepEqual(back.lakes, t.lakes);
  assert.deepEqual(back.vegetation, t.vegetation);
  assert.equal(back.boxes[0].fog.vis, 150);
  assert.equal(back.boxes[0].fog.round, 0.25);
  // A box that is not a Fog keeps its values in a V12+ file.
  assert.equal(back.boxes[1].fog.vis, 777);
  assert.deepEqual(writeTxx(back), bytes);
});

test("the version is the lowest that holds the track: fog 14, vegetation 15, lakes 16, a 16-bit terrain 17", () => {
  const t = resetTrack();
  assert.equal(txxVersionFor(t), 2);
  const fog = traxxBoxDefaults();
  fog.type = TRAXX_BOX_FOG;
  t.boxes = [fog];
  assert.equal(txxVersionFor(t), 14);
  t.vegetation = { masks: [null, null], image: Uint8Array.of(1) };
  assert.equal(txxVersionFor(t), 15);
  t.vegetation = null;
  t.lakes = [{ height: 1, flags: 0, seeds: [[0, 0]] }];
  assert.equal(txxVersionFor(t), 16);
  t.lakes = [];
  t.terrainMode = TERRAINMODE_SPLINE;
  t.h16 = new Uint16Array(65536);
  t.rawShadow = new Uint8Array(65536);
  assert.equal(txxVersionFor(t), 17);
});

test("a lake-only track writes an empty V15 block, and the JSTraxx trailer goes after the last block", () => {
  const t = resetTrack();
  t.lakes = [{ height: 5, flags: 1, seeds: [[3, 4]] }];
  t.backdropName = "A.BIN";
  t.extraBackdrops = ["B.BIN"];
  const bytes = writeTxx(t);
  const back = readTxx(bytes);
  assert.equal(back.version, 16);
  assert.equal(back.vegetation, null);
  assert.deepEqual(back.lakes, t.lakes);
  assert.deepEqual(back.extraBackdrops, ["B.BIN"]);
  // After the lakes: "JSTRAXX1", a count and one string (a length byte, five letters, a NUL).
  const tail = 8 + 4 + 7;
  assert.equal(new TextDecoder().decode(bytes.subarray(bytes.length - tail, bytes.length - tail + 8)), "JSTRAXX1");
  // Empty V15 right before the lakes: per mask an empty string and a zero length, then a zero image length.
  const lakes = 4 + 3 * 4 + 2 * 4;
  const v15 = bytes.subarray(bytes.length - tail - lakes - 16, bytes.length - tail - lakes);
  assert.deepEqual([...v15], [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("a V12 Fog takes the engine's look defaults, a V13 Fog the engine's bottom", () => {
  const t = resetTrack();
  const fog = traxxBoxDefaults();
  fog.type = TRAXX_BOX_FOG;
  Object.assign(fog.fog, { round: 0.125, wisp: 0.375, wsize: 12, wspeed: 7, bot: 2.5 });
  t.boxes = [fog];
  const v14 = writeTxx(t);
  const tail = new Uint8Array(new Float32Array([0.125, 0.375, 12, 7, 2.5]).buffer);
  const at = Buffer.from(v14).indexOf(Buffer.from(tail));
  assert.ok(at > 0);
  const generation = (n: number, drop: number) => {
    const out = new Uint8Array(v14.length - drop);
    out.set(v14.subarray(0, at + 20 - drop));
    out.set(v14.subarray(at + 20), at + 20 - drop);
    out.set(new TextEncoder().encode(`TRAXXV${n}`));
    return readTxx(out).boxes[0].fog;
  };
  const engine = traxxFogEngineDefaults();
  const v12 = generation(12, 20), v13 = generation(13, 4);
  assert.deepEqual([v12.round, v12.wisp, v12.wsize, v12.wspeed, v12.bot], [engine.round, engine.wisp, engine.wsize, engine.wspeed, 0]);
  assert.deepEqual([v13.round, v13.wisp, v13.wsize, v13.wspeed, v13.bot], [0.125, 0.375, 12, 7, 0]);
});

test("the 8-bit mirror rounds to the nearest step, and 8-bit edits fold into the 16-bit heights", () => {
  assert.deepEqual([mirrorOf(0), mirrorOf(127), mirrorOf(128), mirrorOf(0x7f7f), mirrorOf(65535)], [0, 0, 1, 127, 255]);
  const t = { terrainMode: TERRAINMODE_CLASSIC16, h16: new Uint16Array(65536).fill(0x1280), fine: null, rawShadow: new Uint8Array(65536), heights: new Uint8Array(65536) };
  refreshRaw(t);
  assert.equal(t.heights[5], 0x13);
  t.heights[5] = 40;
  assert.equal(syncFromRaw(t), true);
  assert.equal(t.h16[5], 40 << 8);
  assert.equal(t.h16[6], 0x1280, "untouched cells keep their fraction");
  assert.equal(syncFromRaw(t), false);
  // On a Full Map an 8-bit edit has no meaning: the mirror wins back.
  const f = { terrainMode: TERRAINMODE_FINE, h16: null, fine: new Uint16Array(1024 * 1024).fill(0x0500), rawShadow: new Uint8Array(65536), heights: new Uint8Array(65536) };
  refreshRaw(f);
  f.heights[0] = 99;
  syncFromRaw(f);
  assert.equal(f.heights[0], 5);
});

test("the height file's size gives the mode; terrainGrid can only say spline, or disagree", () => {
  assert.equal(parseTerrainGridKey("formatVersion=5\r\n  TerrainGrid = Spline \r\n"), TERRAINMODE_SPLINE);
  assert.equal(parseTerrainGridKey("# terrainGrid=fine\r\nterrainGrid=fine\r\n"), TERRAINMODE_FINE);
  assert.equal(parseTerrainGridKey("terrainGrid=classic"), TERRAINMODE_CLASSIC8);
  assert.equal(parseTerrainGridKey("terrainGrid=wavy"), -2);
  assert.equal(parseTerrainGridKey(null), -1);
  assert.deepEqual(resolveTerrainMode(-1, 65536), { mode: TERRAINMODE_CLASSIC8, warning: null });
  assert.deepEqual(resolveTerrainMode(-1, RAWLEN_16BIT), { mode: TERRAINMODE_CLASSIC16, warning: null });
  assert.deepEqual(resolveTerrainMode(TERRAINMODE_SPLINE, RAWLEN_16BIT), { mode: TERRAINMODE_SPLINE, warning: null });
  assert.equal(resolveTerrainMode(TERRAINMODE_FINE, RAWLEN_FINE).warning, null);
  assert.match(resolveTerrainMode(-1, RAWLEN_FINE).warning ?? "", /no terrainGrid key/);
  assert.equal(resolveTerrainMode(TERRAINMODE_FINE, 65536).mode, TERRAINMODE_CLASSIC8);
  const t = resetTrack();
  const raw = new Uint8Array(RAWLEN_16BIT);
  raw[0] = 0x80; raw[1] = 0x12;
  assert.ok(loadRaw(t, raw));
  assert.equal(t.terrainMode, TERRAINMODE_CLASSIC16);
  assert.equal(t.h16![0], 0x1280);
  assert.equal(t.heights[0], 0x13);
  assert.equal(loadRaw(t, new Uint8Array(1000)), false);
});

test("a 16-bit track's pod: its 128 KB height file, .SI2, legacyFallback=0, formatVersion 5, terrainGrid only for spline", () => {
  const doc = newTrackDocument();
  const t = doc.track;
  t.terrainMode = TERRAINMODE_CLASSIC16;
  t.h16 = new Uint16Array(65536).fill(0x6480);
  t.rawShadow = new Uint8Array(65536);
  refreshRaw(t);
  doc.carry.txvText = "formatVersion=1\r\n  terrainGrid=fine\r\nmyKey=7\r\n";
  let out = buildTrackPod(doc, { date: new Date(2026, 10, 9) });
  const entry = (name: string) => out.entries.find((e) => e.name === name);
  assert.equal(entry("DATA\\TRAXX.RAW")!.data.length, RAWLEN_16BIT);
  assert.ok(entry("WORLD\\TRAXX.SI2"));
  let txv = new TextDecoder().decode(entry("DATA\\TRAXX.TXV")!.data);
  assert.match(txv, /formatVersion=5\r\n/);
  assert.match(txv, /legacyFallback=0\r\n/);
  assert.doesNotMatch(txv, /terrainGrid/);
  assert.match(txv, /# carried over from the previous build\r\nmyKey=7\r\n$/);
  t.terrainMode = TERRAINMODE_SPLINE;
  out = buildTrackPod(doc, { date: new Date(2026, 10, 9) });
  txv = new TextDecoder().decode(out.entries.find((e) => e.name === "DATA\\TRAXX.TXV")!.data);
  assert.match(txv, /hdTextures=0\r\nterrainGrid=spline\r\n/);
});

test("a fog track's .TXV is formatVersion 4 with fogVolumes", () => {
  const doc = newTrackDocument();
  for (let i = 0; i < 3; i++) { const b = traxxBoxDefaults(); b.type = i < 2 ? TRAXX_BOX_FOG : 12; doc.track.boxes.push(b); }
  const out = buildTrackPod(doc, { date: new Date(2026, 10, 9) });
  const txv = new TextDecoder().decode(out.entries.find((e) => e.name === "DATA\\TRAXX.TXV")!.data);
  assert.match(txv, /formatVersion=4\r\n/);
  assert.match(txv, /hdTextures=0\r\nfogVolumes=2\r\n/);
});

test("MusicKindOf: WAV, stock, OGG, MP3 (ID3 or frame sync), else MOD; packed under SOUND\\ with a .KLP", () => {
  const b = (...v: number[]) => Uint8Array.from(v);
  const ascii = (s: string) => new TextEncoder().encode(s);
  assert.equal(musicKind(ascii("RIFF....")), "wav");
  assert.equal(musicKind(ascii("MUSIC\\SNOW.WAV")), "stock");
  assert.equal(musicKind(ascii("OggS....")), "ogg");
  assert.equal(musicKind(ascii("ID3....")), "mp3");
  assert.equal(musicKind(b(0xff, 0xfb, 0x90, 0)), "mp3");
  assert.equal(musicKind(b(0xff, 0xf1, 0x50, 0)), "mod", "AAC ADTS is not MP3");
  assert.equal(musicKind(b(0xff, 0xeb, 0x90, 0)), "mod", "MPEG version bits 01 are reserved");
  assert.equal(musicKind(ascii("song title")), "mod");
  const doc = newTrackDocument();
  doc.track.music = ascii("ID3 fake mp3");
  assert.match(new TextDecoder().decode(writeLvl(doc)), /\r\ntraxx\.mp3\r\n/);
  const names = buildTrackPod(doc).entries.map((e) => e.name);
  assert.ok(names.includes("SOUND\\TRAXX.KLP") && names.includes("SOUND\\TRAXX.MP3"));
  assert.ok(names.indexOf("SOUND\\TRAXX.KLP") === names.indexOf("SOUND\\TRAXX.MP3") - 1);
});

test("the Type list: Fog is 14, Ramp 15, Top-Crush 16; at most 50 fogs", () => {
  assert.equal(typeToIndex(TRAXX_BOX_FOG), TYPEIDX_FOG);
  assert.equal(indexToType(TYPEIDX_FOG), TRAXX_BOX_FOG);
  assert.deepEqual([TYPEIDX_RAMP, TYPEIDX_CRUSH], [15, 16]);
  assert.equal(indexToType(TYPEIDX_RAMP), 99);
  assert.equal(indexToType(TYPEIDX_CRUSH), 98);
  assert.equal(typeToIndex(15), 0);
  assert.equal(budgetCap(budgetGroup(TRAXX_BOX_FOG)), 50);
});

/** A one-box SIT around `boxLines` (the record after its "********" line). */
function oneBoxSit(boxLines: string[]): string {
  const blank = readTraxxSit("x.lvl\r\n");
  const base = new TextDecoder("latin1").decode(writeTraxxSit(blank));
  return base.replace("*** Boxes ***\r\n0\r\n", `*** Boxes ***\r\n1\r\n*********************************************\r\n${boxLines.join("\r\n")}\r\n`);
}

test("the .SIT 'F' block: read tolerantly, written for a Fog only, a model-less one from its own size", () => {
  const record = (type: number, f: string | null) => [
    "ipos", "100.000000,10.000000,200.000000", "theta,phi,psi", "0.000000,0.000000,0.000000",
    "length,width,height", "64.000000,64.000000,20.000000", "mass", "0.000000", "bvel", "0.000000,0.000000,0.000000",
    "p,q,r", "0.000000,0.000000,0.000000", "!type,flags", `${type},0`, "priority", "0",
    "@sound effect entries", "NULL.WAV", "NULL.WAV", "0,0",
    ...(f ? ["Ffog w,l,h,base,vis,r,g,b,half,edge,top,maxOp,wmask,round,wisp,wsize,wspd,bot", f] : []),
  ];
  // A 13-field line: the look and the bottom keep the engine's defaults; a positive size is taken back.
  const sit = readTraxxSit(oneBoxSit(record(14, "90,70,25,-3,250,0.5,0.5,0.5,8,20,5,1,7")));
  const box = sit.boxes[0];
  assert.deepEqual([box.width, box.length, box.height], [90, 70, 25]);
  assert.deepEqual([box.fog.base, box.fog.vis, box.fog.wmask, box.fog.round, box.fog.wisp, box.fog.bot], [-3, 250, 7, 0, 0, 0]);
  const text = new TextDecoder("latin1").decode(writeTraxxSit(sit));
  assert.match(text, /\r\n0,0\r\nFfog w,l,h,base,vis,r,g,b,half,edge,top,maxOp,wmask,round,wisp,wsize,wspd,bot\r\n90\.000000,70\.000000,25\.000000,-3\.000000,250\.000000,0\.500000,0\.500000,0\.500000,8\.000000,20\.000000,5\.000000,1\.000000,7,0\.000000,0\.000000,40\.000000,3\.000000,0\.000000\r\n\*\*\* Cylinders/);
  // An 'F' block on a box that is not a Fog is read and never written back.
  const other = readTraxxSit(oneBoxSit(record(3, "1,2,3")));
  assert.doesNotMatch(new TextDecoder("latin1").decode(writeTraxxSit(other)), /Ffog/);
  // A Fog with no block at all has the engine's defaults.
  assert.deepEqual(readTraxxSit(oneBoxSit(record(14, null))).boxes[0].fog, traxxFogEngineDefaults());
});

test("Traxx 1.7's fog_test.txx reads whole and writes back byte for byte", { skip: noTxx }, () => {
  const bytes = new Uint8Array(readFileSync(TXX));
  const t = readTxx(bytes);
  assert.equal(t.version, 16);
  assert.equal(t.boxes.filter((b) => b.type === TRAXX_BOX_FOG).length, 2);
  assert.equal(t.lakes.length, 2);
  assert.ok(t.vegetation?.image && t.vegetation.image.length > 0);
  assert.equal(t.vegetation.masks.filter(Boolean).length, 2);
  assert.equal(t.terrainMode, TERRAINMODE_CLASSIC8);
  assert.equal(txxVersionFor(t), 16);
  assert.ok(Buffer.from(writeTxx(t)).equals(Buffer.from(bytes)));
});

test("Traxx 1.7's FOGTEST.SI2 reads its 'F' blocks and writes back byte for byte", { skip: noPod }, () => {
  const bytes = new Uint8Array(readFileSync(POD));
  const pod = parsePod(bytes);
  const names = new Set(pod.entries.map((e) => e.name.toUpperCase()));
  const titles = new Set(pod.entries.map((e) => e.title));
  const hasEntry = (n: string) => (n.includes("\\") ? names.has(n) : titles.has(n));
  const entry = pod.entries.find((e) => /\.SI2$/.test(e.name))!;
  const source = readPodEntry(bytes, entry);
  const sit = readTraxxSit(source, entry.title, { hasEntry });
  const fogs = sit.boxes.filter((b) => b.type === TRAXX_BOX_FOG);
  assert.equal(fogs.length, 2);
  assert.ok(fogs.every((b) => b.fog.vis === 200 && b.fog.wmask === 511));
  assert.ok(Buffer.from(writeTraxxSit(sit)).equals(Buffer.from(source)));
});

/*
  fog_test.txx with its art and models from fog_test.pod, written again: every entry both pods
  hold is Traxx's, but the .TXV (stamped JSTraxx).
  Not here: the HD-only model textures (decoded in the browser, not under node,
  which also makes this pod .SIT where Traxx's is .SI2). The .WTR is rebuilt from the lakes and compared too.
*/
test("fog_test.txx writes the entries of the pod Traxx 1.7 wrote", { skip: noBoth }, async () => {
  const bytes = new Uint8Array(readFileSync(POD));
  const archive = parsePod(bytes);
  const byTitle = (folder: string) => async (path: string) => {
    const e = seekToItem(archive.entries, `${folder}\\${path}`) ?? seekToItem(archive.entries, path);
    return e ? readPodEntry(bytes, e) : null;
  };
  const doc = await openTxx(new Uint8Array(readFileSync(TXX)), "fog_test.txx", { art: byTitle("ART"), model: byTitle("MODELS") });
  const out = buildTrackPod(doc);
  let compared = 0;
  for (const e of archive.entries) {
    const name = e.name.replace(/\.SI2$/, ".SIT");
    const mine = out.entries.find((x) => x.name === name);
    if (!mine || e.name.endsWith(".TXV")) continue;
    assert.ok(Buffer.from(mine.data).equals(Buffer.from(readPodEntry(bytes, e))), `${e.name} differs`);
    compared++;
  }
  assert.ok(compared > 30, `${compared} entries`);
  assert.ok(out.entries.some((e) => e.name === "WORLD\\FOGTEST.VEG") && out.entries.some((e) => e.name === "ART\\FOGTEST_V.PNG"));
});

test("fog_test.pod opens with its vegetation, its lakes file and its fogs, and writes them back", { skip: noPod }, async () => {
  const bytes = new Uint8Array(readFileSync(POD));
  const archive = parsePod(bytes);
  const doc = await loadPodTrack({ archive, read: async (e) => readPodEntry(bytes, e) }, 0, "fog_test.pod");
  assert.equal(doc.track.boxes.filter((b) => b.type === TRAXX_BOX_FOG).length, 2);
  assert.ok(doc.track.vegetation?.image && doc.track.lakes.length === 2 && !doc.warnings.some((w) => w.includes("lakes")));
  const out = buildTrackPod(doc);
  for (const name of ["WORLD\\FOGTEST.VEG", "WORLD\\FOGTEST.WTR", "ART\\FOGTEST_V.PNG", "ART\\FOGTEST_G.PNG"]) {
    const theirs = readPodEntry(bytes, archive.entries.find((e) => e.name === name)!);
    assert.ok(Buffer.from(out.entries.find((e) => e.name === name)!.data).equals(Buffer.from(theirs)), name);
  }
  const txv = new TextDecoder().decode(out.entries.find((e) => e.name.endsWith(".TXV"))!.data);
  assert.match(txv, /fogVolumes=2\r\nvegetation=1\r\nvegTrees=12394\r\nvegClumps=131072\r\n/);
});

/** A grey PNG (filter 0 rows, CRCs not checked by the reader). */
function greyPng(side: number, depth: 8 | 16, value: (x: number, z: number) => number): Uint8Array {
  const bpp = depth / 8, stride = side * bpp;
  const raw = new Uint8Array((stride + 1) * side);
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const o = z * (stride + 1) + 1 + x * bpp, v = value(x, z);
    if (depth === 16) { raw[o] = v >> 8; raw[o + 1] = v & 255; } else raw[o] = v;
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, side); new DataView(ihdr.buffer).setUint32(4, side);
  ihdr[8] = depth;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

test("terrainHeights= PNG: 16-bit 256 is a 16-bit track, 1024 a Full Map, a bad image falls back", () => {
  const doc = newTrackDocument();
  applyTerrainHeightsImage(doc, "terrainHeights=DATA\\X_H.PNG\r\n", "DATA\\X_H.PNG", greyPng(256, 16, (x, z) => x * 160 + z * 95), { length: -1, ok: false });
  assert.equal(doc.track.terrainMode, 1);
  assert.equal(doc.track.h16![3 * 256 + 7], 7 * 160 + 3 * 95);
  assert.equal(doc.track.pngHeights, true);
  const spline = newTrackDocument();
  applyTerrainHeightsImage(spline, "terrainGrid=spline\r\n", "DATA\\X_H.PNG", greyPng(256, 16, () => 1000), { length: -1, ok: false });
  assert.equal(spline.track.terrainMode, 2);
  const fine = newTrackDocument();
  applyTerrainHeightsImage(fine, "terrainGrid=fine\r\n", "DATA\\X_H.PNG", greyPng(1024, 8, () => 3), { length: -1, ok: false });
  assert.equal(fine.track.terrainMode, 3);
  assert.equal(fine.track.fine![0], 3 << 8);
  const bad = newTrackDocument();
  applyTerrainHeightsImage(bad, null, "DATA\\X_H.PNG", greyPng(300, 8, () => 0), { length: -1, ok: false });
  assert.ok(bad.warnings.some((w) => /300 x 300/.test(w)));
});
