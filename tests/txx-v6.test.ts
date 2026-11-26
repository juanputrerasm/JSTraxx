/*
  The .TXX generations V21..V24 (Traxx origin/main, TrackPOD/TrackPODBinary.cpp LoadBinary, SaveBinary,
  CanSaveBinary; tools/txxtest.cpp): the Traxx 1.8.2 drag templates (TRAXXV22 / V23) byte for byte; V24 round
  trips of Standard and Tall tracks at 256 and 512 with every block; Traxx's generation choice, read
  normalisation, refusals and CanSaveBinary sentences; JSTraxx's retired TRAXXV99 read and migrated (fixtures
  written by the JSTraxx that wrote V99), never written; CRAZY4X.POD (skipped when absent) to a V24 .TXX.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { buildTrackPod, podRefusal } from "../src/core/traxx/pod-writer.ts";
import { openTxx, type AssetSource } from "../src/core/doc/load-txx.ts";
import { podToTxx } from "../src/core/doc/pod-to-txx.ts";
import {
  canSaveTxx, readTxx, writeTxx, txxVersionFor, TxxError, TXX_V6_VERSION, TXX_CANNOT_SAVE_BOX, TXX_CANNOT_SAVE_BOX_TALL,
  TXX_CANNOT_SAVE_CLASSIC8, TXX_CANNOT_SAVE_TERRAIN, TXX_CANNOT_SAVE_TERRAIN_TALL, TXX_REFUSE_NOT_TALL, TXX_REFUSE_WORLD_SIZE,
  type TxxTrack,
} from "../src/core/traxx/txx.ts";
import { heightsChanged, setMode } from "../src/core/traxx/surface.ts";
import { refreshRaw, TERRAINMODE_CLASSIC16, TERRAINMODE_CLASSIC8, TERRAINMODE_FINE, TERRAINMODE_SPLINE } from "../src/core/traxx/terrain16.ts";
import { fallDefaults } from "../src/core/traxx/falls.ts";
import { buildVeg, emptyVegetation, VEG_KIND_PLACED } from "../src/core/traxx/veg.ts";
import { trackLakes } from "../src/core/traxx/lakes.ts";
import { traxxBoxDefaults, TRAXX_BOX_LIGHT } from "../src/core/traxx/sit.ts";
import { RACERULES_DRAG, RACERULES_PARALLEL, RACERULES_RACE } from "../src/core/traxx/race-types.ts";
import type { TrackDocument } from "../src/core/doc/document.ts";
import type { TrackKind } from "../src/core/traxx/track-kind.ts";
import { loadPodTrack } from "../src/core/doc/load-pod.ts";
import { writePod1 } from "../src/vendor/openphotex/pod/write.js";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";

const DATE = new Date(2026, 10, 13);
const NO_ASSETS: AssetSource = { art: async () => null, model: async () => null };
const header = (b: Uint8Array) => new TextDecoder("latin1").decode(b.subarray(0, 10)).replace(/\0.*$/, "");
const entryMap = (doc: TrackDocument) => new Map(buildTrackPod(doc, { date: DATE }).entries.map((e) => [e.name.toUpperCase(), e.data]));
const FIXTURES = join(import.meta.dirname, "fixtures");
const i32At = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(at, true);
const setI32 = (b: Uint8Array, at: number, v: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).setInt32(at, v, true);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));

test("the Traxx 1.8.2 drag templates (TRAXXV22 and V23) read and write back byte for byte", () => {
  const dir = join(FIXTURES, "drags");
  const files = readdirSync(dir).filter((n) => /\.txx$/i.test(n)).sort();
  assert.deepEqual(files, ["CrossOver_Drag.txx", "J_Drag.txx", "O_Drag.txx", "PaperClip_Drag.txx", "Straight_Drag.txx"]);
  for (const f of files) {
    const bytes = new Uint8Array(readFileSync(join(dir, f)));
    const t = readTxx(bytes);
    assert.equal(t.trackKind, "classic", f);
    assert.equal(t.raceRules.mode, RACERULES_DRAG, f);
    assert.ok(t.raceRules.walls.length > 0, f);
    assert.equal(t.version, f === "PaperClip_Drag.txx" ? 23 : 22, f);
    assert.equal(txxVersionFor(t), t.version, f);
    assert.ok(same(writeTxx(t), bytes), `${f} writes back byte for byte`);
  }
  // The research samples: Straight is one run (1, 1, 1), PaperClip looped with lead-ins [-1, -1, 0, 1, -1].
  const straight = readTxx(new Uint8Array(readFileSync(join(dir, "Straight_Drag.txx"))));
  assert.equal(straight.raceRules.laps, 1);
  const clip = readTxx(new Uint8Array(readFileSync(join(dir, "PaperClip_Drag.txx"))));
  assert.deepEqual([clip.raceRules.laps, clip.raceRules.leadinThen], [0, [-1, -1, 0, 1, -1]]);
  assert.ok(clip.boxes.some((b) => b.cpSplit !== 0 || b.cpLane !== 0), "the V21 box fields are read");
});

/* A version 6 track with something in every block: heights, boxes, a lake and its stored map, a spring, rules, walls, lead-ins. */
function v6Track(cells: number, kind: TrackKind, mode = TERRAINMODE_CLASSIC16): TrackDocument {
  const doc = newTrackDocument(cells, kind);
  const t = doc.track;
  setMode(t, mode);
  const tall = kind === "tall";
  const g = (mode === TERRAINMODE_FINE ? t.fine : t.h16)!;
  const side = Math.round(Math.sqrt(g.length)), k = side / cells;
  for (let i = 0; i < g.length; i++) g[i] = 200 * 128 + (i % 7);
  for (let z = 100 * k; z < 112 * k; z++) for (let x = 100 * k; x < 112 * k; x++) g[x + z * side] = 180 * 128;
  if (tall) for (let x = 0; x < 20; x++) g[x + 30 * side] = 3000 * 128 + 3;
  refreshRaw(t);
  heightsChanged(t);
  t.groundBoxes.push({ x: cells - 1, y: 7, w: 1, h: 1, lower: 12345, upper: tall ? 900001 : 65535, faces: [1, 2, 3, 4, 5, 6] });
  t.lakes = [{ height: 390, flags: 1, seeds: [[105, 105]] }];
  const map = new Uint8Array(cells * cells);
  map[105 + 105 * cells] = 1;
  t.storedLakeMap = { tmap: map, lakes: 1, shown: true };
  const f = fallDefaults();
  f.npoints = 2; f.height = tall ? 9000 : 410; f.pt[0] = [5000 * 16, 6000 * 16]; f.pt[1] = [5040 * 16, 6000 * 16];
  t.falls = [f];
  t.waterLevel4 = tall ? 6001 : 1023;
  const cp = traxxBoxDefaults();
  cp.type = 6; cp.cpSplit = 2; cp.cpLane = 1;
  const lamp = traxxBoxDefaults();
  lamp.type = TRAXX_BOX_LIGHT; lamp.light.allWx = 1;
  t.boxes = [cp, lamp];
  t.trackType = 1;
  t.raceRules = {
    mode: RACERULES_DRAG, laps: 0, leadinThen: [-1, -1, 1, -1, -1],
    walls: [{ name: "Left", side: 1, closed: 0, noline: 0, thickness: 256, height: 5120, points: [{ x: 1000, z: 2000, bend: -30, above: 0, gap: 0 }, { x: 9000, z: 2000, bend: 0, above: 256, gap: 1 }] }],
  };
  return doc;
}

test("V24 round trips: Standard and Tall, 256 and 512, every mode, every block", () => {
  for (const cells of [256, 512]) {
    for (const kind of ["standard", "tall"] as const) {
      for (const mode of [TERRAINMODE_CLASSIC16, TERRAINMODE_SPLINE, TERRAINMODE_FINE]) {
        const what = `${cells} ${kind} mode ${mode}`;
        const t = v6Track(cells, kind, mode).track;
        const txx = writeTxx(t);
        assert.equal(header(txx), "TRAXXV24", what);
        assert.equal(txxVersionFor(t), TXX_V6_VERSION);
        const back = readTxx(txx);
        assert.deepEqual([back.version, back.trackKind, back.worldCells, back.terrainMode], [24, kind, cells, mode], what);
        const grid = mode === TERRAINMODE_FINE ? back.fine! : back.h16!;
        assert.ok(kind === "tall" ? grid instanceof Int32Array : grid instanceof Uint16Array, `${what}: the store follows the kind`);
        assert.deepEqual(Array.from(grid), Array.from((mode === TERRAINMODE_FINE ? t.fine : t.h16)!), what);
        assert.deepEqual(back.heights, t.heights);
        assert.deepEqual(back.clr, t.clr);
        assert.deepEqual(back.groundBoxes, t.groundBoxes, what);
        assert.deepEqual(back.lakes, t.lakes);
        assert.deepEqual(back.falls, t.falls);
        assert.deepEqual(back.raceRules, t.raceRules);
        assert.deepEqual(back.boxes.map((b) => [b.cpSplit, b.cpLane, b.light.allWx]), [[2, 1, 0], [0, 0, 1]]);
        assert.equal(back.waterLevel4, t.waterLevel4);
        assert.deepEqual(back.storedLakeMap, t.storedLakeMap);
        assert.ok(same(writeTxx(back), txx), `${what}: written again, the same bytes`);
        // The v6 block last: version 3 (a stored map), flags (bit 0 tall), water4, shown, N x N, the map.
        const nn = cells * cells, at = txx.length - nn - 20;
        assert.deepEqual([i32At(txx, at), i32At(txx, at + 4), i32At(txx, at + 8), i32At(txx, at + 12), i32At(txx, at + 16)], [3, kind === "tall" ? 1 : 0, t.waterLevel4, 1, nn]);
      }
    }
  }
});

test("V24 without a stored map ends with the version 2 block; the stored map needs the lakes it was made for", () => {
  const t = v6Track(256, "tall").track;
  t.storedLakeMap!.lakes = 2; // stored for another lake count: StoredSavable is false
  const txx = writeTxx(t);
  assert.deepEqual([i32At(txx, txx.length - 12), i32At(txx, txx.length - 8), i32At(txx, txx.length - 4)], [2, 1, 6001]);
  assert.equal(readTxx(txx).storedLakeMap, null);
  // An id with no lake is cleared on read (SetStored).
  const s = v6Track(256, "standard").track;
  s.storedLakeMap!.tmap[7] = 9;
  assert.equal(readTxx(writeTxx(s)).storedLakeMap!.tmap[7], 0);
  // A classic track never carries it (StoredLakesFitTXX): V16, no v6 block.
  const c = newTrackDocument().track;
  c.lakes = [{ height: 100, flags: 0, seeds: [[3, 3]] }];
  c.storedLakeMap = { tmap: new Uint8Array(65536), lakes: 1, shown: false };
  assert.equal(header(writeTxx(c)), "TRAXXV16");
  assert.equal(readTxx(writeTxx(c)).storedLakeMap, null);
});

test("V24: the water (block 2's water4), 0..WaterLevelMax4 of the kind (txxtest test_v24_water)", () => {
  for (const level of [6000, 16384, 1021, 4093, 0, 1020]) {
    const t = newTrackDocument(256, "tall").track;
    t.waterLevel4 = level;
    const txx = writeTxx(t);
    assert.deepEqual([i32At(txx, txx.length - 12), i32At(txx, txx.length - 4)], [2, level]);
    const back = readTxx(txx);
    assert.equal(back.waterLevel4, level);
    assert.ok(same(writeTxx(back), txx));
  }
  // A Standard V6 file's water4 is held to 1023.
  const s = newTrackDocument(256, "standard").track;
  const txx = writeTxx(s);
  setI32(txx, txx.length - 4, 6000);
  assert.equal(readTxx(txx).waterLevel4, 1023);
  setI32(txx, txx.length - 4, -5);
  assert.equal(readTxx(txx).waterLevel4, 0);
});

test("LoadBinary refuses a V24 file Traxx refuses (txxtest test_v24_corrupt_blocks, test_v24_not_tall, bad world)", () => {
  const t = v6Track(256, "tall").track;
  t.storedLakeMap = null;
  const good = writeTxx(t);
  const bad = (patch: (b: Uint8Array) => void) => { const b = good.slice(); patch(b); return () => readTxx(b); };
  // The v6 block version (1..3; 3 needs the stored map), and a flag this Traxx does not know.
  for (const bv of [0, 4, -1, 0x01000000]) assert.throws(bad((b) => setI32(b, b.length - 12, bv)), TxxError, `block version ${bv}`);
  assert.throws(bad((b) => setI32(b, b.length - 12, 3)), TxxError, "block 3 with no map");
  assert.throws(bad((b) => setI32(b, b.length - 8, 3)), TxxError, "flags bit 1");
  // Marked not tall with heights above 65535: damaged.
  assert.throws(bad((b) => setI32(b, b.length - 8, 0)), new TxxError(TXX_REFUSE_NOT_TALL));
  // The V17 block: CLASSIC16 then width 32; any other width, or mode Classic 8-bit, is refused.
  let at = -1;
  for (let i = 0; i + 8 <= good.length; i++) if (i32At(good, i) === 1 && i32At(good, i + 4) === 32) at = i;
  assert.ok(at > 0);
  for (const w of [16, 0, 8, 64, -32]) assert.throws(bad((b) => setI32(b, at + 4, w)), TxxError, `width ${w}`);
  assert.throws(bad((b) => setI32(b, at, 0)), TxxError, "Classic 8-bit");
  // A height above 8,192 ft in the samples is a damaged file.
  assert.throws(bad((b) => setI32(b, at + 8, 1048577)), TxxError);
  // The world size, right before the terrain's flags word (0x8007).
  let w = -1;
  for (let i = 0; i + 6 <= good.length; i++) if (i32At(good, i) === 256 && good[i + 4] === 7 && good[i + 5] === 0x80) { w = i; break; }
  assert.ok(w > 0);
  assert.throws(bad((b) => setI32(b, w, 300)), new TxxError(TXX_REFUSE_WORLD_SIZE));
  // Everything put back: it loads.
  assert.equal(readTxx(good.slice()).trackKind, "tall");
});

test("V24 ground boxes: i32 in 1/128 ft clamped to 0..8,192 ft on read; a box outside the world is dropped", () => {
  const t = newTrackDocument(256, "tall").track;
  t.groundBoxes = [
    { x: 10, y: 10, w: 1, h: 1, lower: 0, upper: 128064, faces: [0, 0, 0, 0, 0, 0] },
    { x: 300, y: 10, w: 1, h: 1, lower: 0, upper: 256, faces: [0, 0, 0, 0, 0, 0] },
  ];
  const txx = writeTxx(t);
  const back = readTxx(txx);
  assert.deepEqual(back.groundBoxes.map((g) => [g.x, g.upper]), [[10, 128064]], "x 300 is outside a 256 world");
  // A classic track keeps one byte of 2 ft steps per height (BoxByte), as Traxx always wrote.
  const c = newTrackDocument().track;
  c.groundBoxes = [{ x: 1, y: 2, w: 1, h: 1, lower: 10 << 8, upper: 20 << 8, faces: [0, 0, 0, 0, 0, 0] }];
  assert.deepEqual(readTxx(writeTxx(c)).groundBoxes[0]!.upper, 20 << 8);
});

test("CanSaveBinary's refusals, Traxx's sentences (txxtest test_can_save_height_limits, test_v6_classic8_refused_and_file_kept)", () => {
  const std = newTrackDocument(256, "standard").track;
  assert.equal(canSaveTxx(std), null);
  std.terrainMode = TERRAINMODE_CLASSIC8;
  assert.equal(canSaveTxx(std), TXX_CANNOT_SAVE_CLASSIC8);
  assert.throws(() => writeTxx(std), new TxxError(TXX_CANNOT_SAVE_CLASSIC8));
  std.terrainMode = TERRAINMODE_CLASSIC16;
  std.h16 = new Int32Array(256 * 256).fill(100);
  std.h16[3] = 65536;
  assert.equal(canSaveTxx(std), TXX_CANNOT_SAVE_TERRAIN);
  std.h16[3] = -1;
  assert.equal(canSaveTxx(std), TXX_CANNOT_SAVE_TERRAIN);
  std.h16[3] = 65535;
  assert.equal(canSaveTxx(std), null);
  std.groundBoxes = [{ x: 0, y: 0, w: 1, h: 1, lower: 0, upper: 65536, faces: [0, 0, 0, 0, 0, 0] }];
  assert.equal(canSaveTxx(std), TXX_CANNOT_SAVE_BOX);
  const tall = newTrackDocument(512, "tall").track;
  tall.h16![9] = 1048577;
  assert.equal(canSaveTxx(tall), TXX_CANNOT_SAVE_TERRAIN_TALL);
  tall.h16![9] = 1048576;
  tall.groundBoxes = [{ x: 0, y: 0, w: 1, h: 1, lower: -1, upper: 9, faces: [0, 0, 0, 0, 0, 0] }];
  assert.equal(canSaveTxx(tall), TXX_CANNOT_SAVE_BOX_TALL);
  // A classic track's terrain and boxes are held to 0..65535 too.
  const c = newTrackDocument().track;
  c.groundBoxes = [{ x: 0, y: 0, w: 1, h: 1, lower: -256, upper: 256, faces: [0, 0, 0, 0, 0, 0] }];
  assert.equal(canSaveTxx(c), TXX_CANNOT_SAVE_BOX);
});

test("the generation: lowest needed; rules 21, walls 22, lead-ins 23, a v6 track 24, a classic track never 24 (txxtest race rules, test_classic_never_v24)", () => {
  const t = newTrackDocument().track;
  assert.equal(txxVersionFor(t), 2);
  const cp = traxxBoxDefaults();
  cp.type = 6; cp.cpSplit = 1; cp.cpLane = 2;
  t.boxes = [cp];
  assert.equal(txxVersionFor(t), 2, "the split fields alone do not stamp V21");
  const v2 = writeTxx(t);
  t.raceRules.mode = RACERULES_DRAG;
  const v21 = writeTxx(t);
  assert.equal(header(v21), "TRAXXV21");
  // The box record grows by its two ints; the tail block is 1, the mode, the laps.
  assert.deepEqual([i32At(v21, v21.length - 12), i32At(v21, v21.length - 8), i32At(v21, v21.length - 4)], [1, RACERULES_DRAG, 1]);
  assert.deepEqual(readTxx(v21).boxes.map((b) => [b.cpSplit, b.cpLane]), [[1, 2]]);
  assert.ok(v21.length > v2.length);
  t.raceRules.mode = 0;
  t.raceRules.walls = [{ name: "W", side: 0, closed: 0, noline: 0, thickness: 256, height: 5120, points: [] }];
  const v22 = writeTxx(t);
  assert.equal(header(v22), "TRAXXV22");
  assert.deepEqual(readTxx(v22).raceRules.walls, t.raceRules.walls);
  t.raceRules.walls = [];
  t.raceRules.leadinThen = [-1, -1, -1, 0, -1];
  const v23 = writeTxx(t);
  assert.equal(header(v23), "TRAXXV23");
  // V23 writes the V21 block (rules off) and an empty walls block (1, 0) too.
  assert.deepEqual(Array.from({ length: 11 }, (_, i) => i32At(v23, v23.length - 44 + 4 * i)), [1, 0, 1, 1, 0, 1, -1, -1, -1, 0, -1]);
  t.raceRules.leadinThen = [-1, -1, -1, -1, -1];
  // Content never makes a track version 6: water, a 32-bit store, fractional boxes.
  t.waterLevel4 = 1020;
  assert.ok(txxVersionFor(t) < 24);
  // Its kind does.
  assert.equal(txxVersionFor(newTrackDocument(256, "standard").track), 24);
});

test("V21 and V23 read normalisation (LoadBinary)", () => {
  const read = (trackType: number, mode: number, laps: number) => {
    const t = newTrackDocument().track;
    t.trackType = trackType;
    t.raceRules.mode = RACERULES_DRAG;
    const b = writeTxx(t);
    setI32(b, b.length - 8, mode);
    setI32(b, b.length - 4, laps);
    return readTxx(b).raceRules;
  };
  // An unknown mode is off; RACE only on a Circuit (2) or Rally (3); Parallel and Race force 0 laps; other laps are 1.
  assert.deepEqual([read(2, 9, 0).mode, read(1, RACERULES_RACE, 0).mode, read(2, RACERULES_RACE, 1).mode], [0, 0, RACERULES_RACE]);
  assert.deepEqual([read(2, RACERULES_RACE, 1).laps, read(1, RACERULES_PARALLEL, 1).laps, read(1, RACERULES_DRAG, 5).laps, read(1, RACERULES_DRAG, 0).laps], [0, 0, 1, 0]);
  // Lead-ins: [0], [1] stay -1; a target 0 / 1 no earlier course holds.
  const t = newTrackDocument().track;
  t.raceRules.leadinThen = [-1, -1, 0, -1, -1];
  const b = writeTxx(t);
  for (const [i, v] of [7, 7, 1, 1, 0].entries()) setI32(b, b.length - 20 + 4 * i, v);
  assert.deepEqual(readTxx(b).raceRules.leadinThen, [-1, -1, 1, -1, 0]);
  // A negative split or lane is 0.
  const s = newTrackDocument().track;
  s.boxes = [traxxBoxDefaults()];
  s.boxes[0]!.cpSplit = -4; s.boxes[0]!.cpLane = -1;
  s.raceRules.mode = RACERULES_DRAG;
  assert.deepEqual(readTxx(writeTxx(s)).boxes.map((x) => [x.cpSplit, x.cpLane]), [[0, 0]]);
});

test("objects: 4,096 below V24, 16,384 from it; the surplus is read and dropped, counted on open (txxtest test_objects_v6_16384_round_trip)", async () => {
  const t = newTrackDocument().track;
  t.boxes = Array.from({ length: 4100 }, traxxBoxDefaults);
  const back = readTxx(writeTxx(t));
  assert.deepEqual([back.boxes.length, back.objectsDroppedOnRead], [4096, 4]);
  const doc = await openTxx(writeTxx(t), "many.txx", NO_ASSETS);
  assert.equal(doc.objectsDropped, 4);
  assert.equal("objectsDroppedOnRead" in doc.track, false);
  const v6 = newTrackDocument(256, "standard").track;
  v6.boxes = Array.from({ length: 5000 }, traxxBoxDefaults);
  assert.equal(readTxx(writeTxx(v6)).boxes.length, 5000);
});

test("TRAXXV99 (JSTraxx's retired generation) is read and migrated, never written", () => {
  const dir = join(FIXTURES, "v99");
  const load = (f: string) => readTxx(new Uint8Array(readFileSync(join(dir, f))));
  // A ridge at 900 ft: Tall by EndV6Read's rule; the 32-bit store kept; f64 2 ft boxes as 1/128 ft; water4 from the header.
  const tall = load("v99-tall256.txx");
  assert.deepEqual([tall.version, tall.trackKind, tall.worldCells, tall.terrainMode, tall.waterLevel4], [99, "tall", 256, TERRAINMODE_CLASSIC16, 3000]);
  assert.ok(tall.h16 instanceof Int32Array);
  assert.equal(tall.h16[5 + 30 * 256], 900 * 128 + 3);
  assert.deepEqual(tall.groundBoxes.map((g) => [g.lower, g.upper]), [[Math.round(101.25 * 256), Math.round(300.5 * 256)]]);
  assert.deepEqual([tall.lakes.length, tall.falls.length, tall.heightStep, tall.heightBase], [1, 1, null, null], "step and base are dropped");
  const out = writeTxx(tall);
  assert.equal(header(out), "TRAXXV24");
  const again = readTxx(out);
  assert.deepEqual([again.trackKind, again.waterLevel4, again.groundBoxes], [tall.trackKind, tall.waterLevel4, tall.groundBoxes]);
  assert.deepEqual(Array.from(again.h16!), Array.from(tall.h16));
  assert.ok(same(writeTxx(again), out));
  // Opened from a .SI3, Classic 8-bit at 512: Standard V6, Classic 16-bit (h16 = raw << 8), the .SI3 flag dropped.
  const si3 = load("v99-si3-512.txx");
  assert.deepEqual([si3.trackKind, si3.worldCells, si3.terrainMode, si3.waterLevel4], ["standard", 512, TERRAINMODE_CLASSIC16, 401]);
  assert.ok(si3.h16 instanceof Uint16Array);
  for (let i = 0; i < 512 * 512; i += 997) assert.equal(si3.h16![i], si3.heights[i]! << 8);
  assert.deepEqual(si3.groundBoxes.map((g) => [g.lower, g.upper]), [[100 << 8, 110 << 8]]);
  assert.equal(header(writeTxx(si3)), "TRAXXV24");
  // A box below 0 ft opens as it is and refuses to save; water below 0 opens as 0.
  const sunken = load("v99-sunken-box.txx");
  assert.deepEqual([sunken.trackKind, sunken.waterLevel4, sunken.groundBoxes[0]!.lower], ["standard", 0, -5 * 256]);
  assert.equal(canSaveTxx(sunken), TXX_CANNOT_SAVE_BOX);
  assert.throws(() => writeTxx(sunken), new TxxError(TXX_CANNOT_SAVE_BOX));
  sunken.groundBoxes[0]!.lower = 0;
  assert.equal(header(writeTxx(sunken)), "TRAXXV24");
});

/* A 512-cell Tall 16-bit track at 200 ft with a basin (a lake), tall ground, a spring past 2,048 ft and a tree. */
function bigTrack(): TrackDocument {
  const doc = newTrackDocument(512, "tall");
  const t = doc.track;
  setMode(t, TERRAINMODE_CLASSIC16);
  const n = 512, h = new Int32Array(n * n).fill(200 * 128);
  for (let z = 400; z <= 411; z++) for (let x = 400; x <= 411; x++) h[x + z * n] = 180 * 128;
  for (let x = 0; x < 20; x++) h[x + 30 * n] = 900 * 128 + 3; // a ridge past 512 ft, off the 2 ft grid
  t.h16 = h;
  refreshRaw(t);
  heightsChanged(t);
  for (let i = 0; i < 2000; i++) t.clr[(i * 131) % (n * n)] = (i * 7) & 0xffff;
  t.lte![7 * 300000] = 77;
  t.groundBoxes.push({ x: 450, y: 460, w: 1, h: 1, lower: 25920, upper: 76928, faces: [1, 2, 3, 4, 5, 6] });
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

test("a 512-cell Tall document round-trips through TRAXXV24 to the same pod", async () => {
  const doc = bigTrack();
  assert.equal(trackLakes(doc.track).lakes[0]!.errors, 0, "the lake holds");
  const before = entryMap(doc);
  for (const name of ["WORLD\\TRAXX.SI3", "WORLD\\TRAXX.WTR", "WORLD\\TRAXX.WFL", "WORLD\\TRAXX.VEG"]) assert.ok(before.has(name), name);
  const txx = writeTxx(doc.track);
  assert.equal(header(txx), "TRAXXV24");
  const back = readTxx(txx);
  assert.deepEqual([back.version, back.worldCells, back.trackKind], [24, 512, "tall"]);
  assert.deepEqual(Array.from(back.h16!), Array.from(doc.track.h16!));
  assert.deepEqual(back.lte, doc.track.lte);
  assert.deepEqual(back.groundBoxes, doc.track.groundBoxes);
  assert.deepEqual(back.vegetation, doc.track.vegetation);
  assert.ok(same(writeTxx(back), txx));
  const reopened = await openTxx(txx, "big.txx", NO_ASSETS);
  const after = entryMap(reopened);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
  for (const [name, data] of before) assert.deepEqual(after.get(name), data, name);
});

test("a 256-cell classic track keeps its generation and its bytes", () => {
  const doc = newTrackDocument();
  const f = fallDefaults();
  f.npoints = 2; f.height = 410; f.pt[0] = [1600, 1600]; f.pt[1] = [2080, 1600];
  doc.track.falls = [f];
  doc.track.groundBoxes.push({ x: 40, y: 50, w: 1, h: 1, lower: 100 << 8, upper: 110 << 8, faces: [1, 2, 3, 4, 5, 6] });
  const txx = writeTxx(doc.track);
  assert.equal(header(txx), "TRAXXV18");
  const back = readTxx(txx);
  assert.deepEqual([back.worldCells, back.trackKind, back.heightStep], [256, "classic", null]);
  assert.ok(same(writeTxx(back), txx));
});

const CRAZY = join(process.env.JSTRAXX_GAMES ?? join(homedir(), "games"), "mtm2-v6-test", "CRAZY4X.POD");
test("CRAZY4X.POD converts to a TRAXXV24 .TXX and writes back with its lakes and falls", { skip: !existsSync(CRAZY) && "no CRAZY4X.POD" }, async () => {
  const pod = new Uint8Array(readFileSync(CRAZY));
  const { txx, doc } = await podToTxx(pod, "CRAZY4X", "CRAZY4X.POD");
  assert.equal(header(txx), "TRAXXV24");
  const reopened = await openTxx(txx, "CRAZY4X.txx", NO_ASSETS);
  const t = reopened.track;
  assert.equal(t.worldCells, doc.track.worldCells);
  assert.equal(t.trackKind, doc.track.trackKind);
  assert.notEqual(t.trackKind, "classic");
  assert.deepEqual(Array.from((t.fine ?? t.h16)!), Array.from((doc.track.fine ?? doc.track.h16)!));
  assert.deepEqual(t.lakes, doc.track.lakes);
  assert.deepEqual(t.falls, doc.track.falls);
  const out = buildTrackPod(reopened, { date: DATE });
  assert.equal(out.v6, true);
  assert.deepEqual(out.warnings.filter((w) => /lake|waterfall/i.test(w)), []);
  assert.equal(podRefusal(reopened), null);
  const direct = buildTrackPod(doc, { date: DATE });
  for (const ext of ["WTR", "WFL", "VEG"]) {
    const a = direct.entries.find((e) => e.name.toUpperCase().endsWith(`.${ext}`)), b = out.entries.find((e) => e.name.toUpperCase().endsWith(`.${ext}`));
    if (ext === "WTR" && doc.track.storedLakeMap) continue; // the stored map is written only when AskStoredLakes says keep
    assert.deepEqual(b?.data, a?.data, ext);
  }
});

/*
  The water detail normal and water mask (Traxx 1.7.2, TRAXXV19): on a classic track they make the file V19 and
  nothing else changes; V24 always carries both records (empty when unset), then the V21..V23 blocks and the v6 block.
*/
const WDTL = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const WMSK = Uint8Array.from([7, 7, 7, 7, 7]);

function indexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}

test("TRAXXV19: a water map makes a classic track V19, laid out as the V9 pair after the falls", () => {
  const doc = newTrackDocument();
  const plain = writeTxx(doc.track);
  doc.track.waterMaskMap = WMSK; doc.track.waterMaskExt = ".TGA";
  const txx = writeTxx(doc.track);
  assert.equal(header(txx), "TRAXXV19");
  const tail = Uint8Array.from([1, 0, 0, 0, 0, 0, 5, 0x2e, 0x54, 0x47, 0x41, 0, 5, 0, 0, 0, ...WMSK]);
  assert.deepEqual(txx.subarray(txx.length - tail.length), tail);
  const back = readTxx(txx);
  assert.deepEqual([back.version, back.waterDetailExt, back.waterDetailMap, back.waterMaskExt, back.waterMaskMap], [19, "", null, ".TGA", WMSK]);
  assert.ok(same(writeTxx(back), txx));
  assert.equal(header(plain), "TRAXXV2");
  assert.ok(same(writeTxx({ ...doc.track, waterDetailMap: null, waterMaskMap: null } as TxxTrack), plain));
});

test("TRAXXV24 always carries both water records, then the V21, V22, V23 and v6 blocks", () => {
  const doc = newTrackDocument(512);
  const none = writeTxx(doc.track);
  assert.equal(header(none), "TRAXXV24");
  // ... the falls (block 3, a count of 0), ext "" length 0 twice, [1, 0, 1] rules, [1, 0] walls, [1, -1 x 5] lead-ins, [2, 0, 0] v6.
  const ints = [1, 0, 1, 1, 0, 1, -1, -1, -1, -1, -1, 2, 0, 0];
  const tail = new Uint8Array(8 + 12 + 4 * ints.length);
  const dv = new DataView(tail.buffer);
  dv.setInt32(0, 3, true);
  dv.setInt32(4, 0, true);
  tail.set([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], 8);
  ints.forEach((v, i) => dv.setInt32(20 + 4 * i, v, true));
  assert.deepEqual(none.subarray(none.length - tail.length), tail);
  doc.track.waterDetailMap = WDTL; doc.track.waterDetailExt = ".PNG";
  doc.track.waterMaskMap = WMSK; doc.track.waterMaskExt = ".PNG";
  const txx = writeTxx(doc.track);
  const at = indexOf(txx, WMSK);
  assert.ok(at > indexOf(txx, WDTL) && indexOf(txx, WDTL) > 0);
  assert.equal(txx.length - (at + WMSK.length), 4 * ints.length);
  const back = readTxx(txx);
  assert.deepEqual([back.waterDetailExt, back.waterDetailMap, back.waterMaskExt, back.waterMaskMap], [".PNG", WDTL, ".PNG", WMSK]);
  assert.ok(same(writeTxx(back), txx));
});

test("the water maps ride into the pod as ART\\<stem>_WDTL / _WMSK, .SI3 tracks too, and back", async () => {
  for (const cells of [256, 512]) {
    const doc = newTrackDocument(cells);
    doc.track.waterDetailMap = WDTL; doc.track.waterDetailExt = ".PNG";
    doc.track.waterMaskMap = WMSK; doc.track.waterMaskExt = ".TGA";
    const out = buildTrackPod(doc, { date: DATE });
    const names = out.entries.map((e) => e.name);
    assert.ok(names.includes("ART\\TRAXX_WDTL.PNG") && names.includes("ART\\TRAXX_WMSK.TGA"), `${cells}`);
    assert.ok(names.indexOf("ART\\TRAXX_WDTL.PNG") < names.indexOf("ART\\TRAXX_WMSK.TGA"));
    const bytes = writePod1(out.comment, out.entries);
    const back = await loadPodTrack({ archive: parsePod(bytes), read: async (e) => readPodEntry(bytes, e) }, 0, "T.POD");
    const t = back.track;
    assert.deepEqual([t.waterDetailExt, t.waterDetailMap, t.waterMaskExt, t.waterMaskMap], [".PNG", WDTL, ".TGA", WMSK], `${cells}`);
    assert.deepEqual([back.carry.waterDetailFromPod, back.carry.waterMaskFromPod, back.carry.detailFromPod], [true, true, false]);
  }
});
