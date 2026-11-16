/*
  Waterfalls on a track format version 6 world (openmtm2.github.io/proposals/track-format-v6.md,
  section 9.3, .WFL version 2): crest points, wraps, tiles and the walk's ground in the N world,
  the crest height range of the terrain's step and base, Write POD's .WFL version 2 on a
  512-cell world and the round trip through View POD; and a 256-cell Traxx track unchanged.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { writePod1 } from "../src/vendor/openphotex/pod/write.js";
import { parseWfl, writeWfl } from "../src/vendor/openphotex/mtm/wfl.js";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { buildTrackPod, podRefusal } from "../src/core/traxx/pod-writer.ts";
import { loadPodTrack } from "../src/core/doc/load-pod.ts";
import { fallWorldOf, isV6Document } from "../src/core/traxx/v6.ts";
import { setMode } from "../src/core/traxx/surface.ts";
import { TERRAINMODE_CLASSIC16 } from "../src/core/traxx/terrain16.ts";
import {
  buildNotches, buildWfl, crestLength, fallBadPoints, fallDefaults, fallErrorText, fallErrors, fallGroundFor, fallHeightLimits, fallNearestToMenu,
  fallUnwrap, parseWflFalls, wrapDiff, FALLERR_COORD, FALLERR_HEIGHT, FALLERR_WIDTH, FALL_WORLD_CLASSIC, type FallLakes, type TraxxFall,
} from "../src/core/traxx/falls.ts";
import type { TrackDocument } from "../src/core/doc/document.ts";

const DATE = new Date(2026, 10, 13);
const podOf = (doc: TrackDocument) => {
  const out = buildTrackPod(doc, { date: DATE });
  return { out, bytes: writePod1(out.comment, out.entries) };
};
const sourceOf = (bytes: Uint8Array) => ({ archive: parsePod(bytes), read: async (e: { offset: number; length: number }) => readPodEntry(bytes, e) });
const entry = (out: ReturnType<typeof buildTrackPod>, name: string) => out.entries.find((e) => e.name.toUpperCase() === name.toUpperCase());

/* A spring (no source lake) with its crest in feet. */
function spring(pts: [number, number][], height: number): TraxxFall {
  const w = fallDefaults();
  w.npoints = pts.length;
  pts.forEach(([x, z], k) => { w.pt[k] = [Math.round(x * 16), Math.round(z * 16)]; });
  w.height = height;
  return w;
}

test("a 512-cell world writes a version 2 .WFL with points beyond 8,192 ft and reads it back", async () => {
  const doc = newTrackDocument(512); // flat at 200 ft: step 128, base 200, so version 2 heights 401..1424
  const fall = spring([[12000, 9000], [12040, 9000], [12060, 9030]], 410);
  doc.track.falls = [fall];
  const world = fallWorldOf(doc.track, false);
  assert.deepEqual(world, { cells: 512, terrain: { step: 128, base: 200 } });
  const lakes: FallLakes = { lakes: [], tmap: null, world };
  assert.equal(fallErrors(doc.track.falls, 0, lakes), 0);
  assert.deepEqual(fallHeightLimits(doc.track.falls, lakes), { min: 401, max: 1424 });

  const { out, bytes } = podOf(doc);
  assert.equal(out.v6, true);
  assert.ok(!out.warnings.some((w) => /waterfall/i.test(w)), out.warnings.join("\n"));
  const wfl = entry(out, "WORLD\\TRAXX.WFL")!;
  assert.ok(wfl, "the .WFL is written");
  const parsed = parseWfl(wfl.data, { cells: 512 });
  assert.deepEqual([parsed.major, parsed.cells, parsed.falls.length], [2, 512, 1]);
  assert.deepEqual(parsed.falls[0]!.points[0], { x: 192000, z: 144000 });
  assert.equal(parsed.falls[0]!.height, 410);
  assert.match(new TextDecoder("latin1").decode(entry(out, "DATA\\TRAXX.TXV")!.data), /waterfalls=1\r\n/);

  const back = await loadPodTrack(sourceOf(bytes), 0, "big.pod");
  assert.equal(back.track.worldCells, 512);
  assert.deepEqual(back.track.falls, [fall]);
  assert.ok(!back.warnings.some((w) => /waterfall/i.test(w)), back.warnings.join("\n"));
  // Saved again: the same .WFL.
  assert.deepEqual(entry(podOf(back).out, "WORLD\\TRAXX.WFL")!.data, wfl.data);
});

test("a 512-cell world: crest points, the wrap at W and the height range", () => {
  const world = { cells: 512, terrain: { step: 128, base: 200 } };
  const lakes: FallLakes = { lakes: [], tmap: null, world };
  // 16,370 ft to 20 ft is 34 ft the short way across the wrap at 16,384 ft.
  const across = spring([[16370, 3200], [20, 3200]], 410);
  assert.equal(crestLength(across, 512), 34);
  assert.equal(wrapDiff(20 * 16, 16370 * 16, 512), 34 * 16);
  assert.deepEqual(fallUnwrap(across, 2, 512).px, [16370, 16404]);
  assert.equal(fallErrors([across], 0, lakes), 0);
  assert.equal(fallNearestToMenu([across], 16380, 3200, 512), 0);
  // 8,180 to 20 ft: 32 ft across a 256 world's wrap, 8,160 ft (too wide) in a 512 world.
  const wide = spring([[8180, 100], [20, 100]], 410);
  assert.equal(fallErrors([wide], 0, { lakes: [], tmap: null }) & FALLERR_WIDTH, 0);
  assert.ok(fallErrors([wide], 0, lakes) & FALLERR_WIDTH);
  // A point beyond 8,192 ft is off a 256 map, on a 512 one; 16,384 ft is off both.
  const far = spring([[12000, 100], [12030, 100]], 410);
  assert.ok(fallErrors([far], 0, { lakes: [], tmap: null }) & FALLERR_COORD);
  assert.equal(fallErrors([far], 0, lakes) & FALLERR_COORD, 0);
  far.pt[1] = [16384 * 16, 100 * 16];
  assert.ok(fallErrors([far], 0, lakes) & FALLERR_COORD);
  // The crest height: the version 2 range of the terrain's step and base, with its own text.
  const high = spring([[100, 100], [130, 100]], 1425);
  assert.ok(fallErrors([high], 0, lakes) & FALLERR_HEIGHT);
  assert.deepEqual(fallHeightLimits([high], lakes), { min: 401, max: 1424 });
  assert.equal(fallErrorText(FALLERR_HEIGHT, world), "The crest height is outside 401..1424, the terrain's range on this 512-cell track (.WFL version 2)");
  assert.equal(fallErrorText(FALLERR_HEIGHT), "The crest height is outside 1..4096");
});

test("the direction check and the notch read the N x N tile map, across the wrap", () => {
  const N = 512, tmap = new Uint8Array(N * N);
  // Lake 1 on tiles x 500..511 and 0..3, z 100..110; the crest runs along its edge z = 3,200 ft across
  // the wrap at 16,384 ft, flowing to -z (the lake 1 ft behind every point).
  for (let z = 100; z <= 110; z++) for (const x of [500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 0, 1, 2, 3]) tmap[z * N + x] = 1;
  const w = spring([[16370, 3200], [20, 3200]], 0);
  w.source = 1;
  const lakes: FallLakes = { lakes: [{ height: 900 }], tmap, world: { cells: N, terrain: { step: 32, base: 88 } } };
  assert.equal(fallBadPoints([w], 0, lakes), 0);
  assert.equal(fallBadPoints([w], 0, { ...lakes, tmap: new Uint8Array(N * N) }), 0b11);
  // The notch tiles: row 99, columns 511 and 0 (the crest crosses the wrap).
  const { notchlake } = buildNotches([w], N);
  const cut = [...notchlake.keys()].filter((i) => notchlake[i]).map((i) => [i % N, Math.floor(i / N)]);
  assert.deepEqual(cut, [[0, 99], [511, 99]]);
});

test("the walk's ground is the N x N terrain, the 32-bit store exact on a version 6 track", () => {
  const doc = newTrackDocument(512);
  const t = doc.track;
  setMode(t, TERRAINMODE_CLASSIC16);
  const h = new Int32Array(512 * 512).fill(200 * 128);
  h[400 + 300 * 512] = 3000 * 128 + 1; // 3,000 ft and 1/128 ft at the corner (400, 300): 12,800 x 9,600 ft
  t.h16 = h;
  assert.equal(isV6Document(t, false), true);
  const exact = fallGroundFor(t, null, fallWorldOf(t, false));
  assert.equal(exact.cells, 512);
  assert.equal(exact.height(400 * 32, 300 * 32), 3000 + 1 / 128);
  // Without the version 6 world it is Traxx's integer rule (CornerV / 2, truncated).
  assert.equal(fallGroundFor(t, null).height(400 * 32, 300 * 32), 3000);
  assert.equal(exact.height(100 * 32, 300 * 32), 200);
  // The world wraps at 512: column 511's far corner is column 0.
  h[0 + 300 * 512] = 400 * 128;
  assert.equal(exact.height(511 * 32 + 16, 300 * 32), 300);
});

test("a 256-cell Traxx track is unchanged: version 1 .WFL, .SIT, Traxx's ranges and reader", async () => {
  const doc = newTrackDocument();
  const fall = spring([[100, 100], [130, 100]], 410);
  doc.track.falls = [fall];
  assert.equal(isV6Document(doc.track, false), false);
  assert.equal(fallWorldOf(doc.track, false), FALL_WORLD_CLASSIC);
  const { out, bytes } = podOf(doc);
  assert.equal(out.v6, false);
  assert.ok(entry(out, "WORLD\\TRAXX.SIT"));
  const wfl = entry(out, "WORLD\\TRAXX.WFL")!.data;
  // Byte for byte what Traxx's BuildWFL wrote before (writeWfl with no options: version 1, 256 x 256).
  assert.deepEqual(wfl, buildWfl([fall], { lakes: [], tmap: null }));
  assert.deepEqual(wfl, writeWfl([{ source: 0, flags: fall.flags, speed: 96, height: 410, points: [{ x: 1600, z: 1600 }, { x: 2080, z: 1600 }], opacity: 85, mist: 100, volume: 100, mistDepth: 100, mistHeight: 100, soundName: "", textureName: "" }]));
  assert.deepEqual([wfl[4], wfl[16] | (wfl[17] << 8)], [1, 256]);
  const back = await loadPodTrack(sourceOf(bytes), 0, "small.pod");
  assert.deepEqual(back.track.falls, [fall]);
  // Traxx's reader: version 1, 256 x 256 only. A version 2 file (a 512 world's) is no falls on a .SIT track.
  const v2 = writeWfl([{ source: 0, flags: 6, speed: 96, height: 410, points: [{ x: 1600, z: 1600 }, { x: 2080, z: 1600 }], opacity: 85, mist: 100, volume: 100 }], { cells: 512 });
  assert.equal(v2[4], 2);
  assert.equal(parseWflFalls(v2), null);
  // A .SI3 reader takes the version of its own size only: version 1 at 256, version 2 at 512.
  assert.ok(parseWflFalls(wfl, 256));
  assert.equal(parseWflFalls(wfl, 512), null);
  assert.equal(parseWflFalls(v2, 256), null);
  assert.ok(parseWflFalls(v2, 512));
  // Traxx's heights: 1..4096, whatever the version 6 range would be.
  assert.ok(fallErrors([spring([[100, 100], [130, 100]], 4097)], 0, { lakes: [], tmap: null }) & FALLERR_HEIGHT);
  assert.equal(fallErrors([spring([[100, 100], [130, 100]], 4096)], 0, { lakes: [], tmap: null }), 0);
});

test("a 256-cell version 6 track writes version 1 only; a crest above 2,048 ft is an error, not version 2", () => {
  const doc = newTrackDocument();
  doc.carry.situationIsSi3 = true; // opened from a .SI3, 256 cells, flat at 200 ft
  doc.track.falls = [spring([[100, 100], [130, 100]], 410)];
  const out = buildTrackPod(doc, { date: DATE });
  assert.equal(out.v6, true);
  assert.equal(entry(out, "WORLD\\TRAXX.WFL")!.data[4], 1);
  // 5000 half-feet (2,500 ft) does not fit version 1: the fall is in error and no .WFL is written.
  doc.track.falls = [spring([[100, 100], [130, 100]], 5000)];
  const world = fallWorldOf(doc.track, true);
  const lakes: FallLakes = { lakes: [], tmap: null, world };
  assert.deepEqual(fallHeightLimits(doc.track.falls, lakes), { min: 1, max: 4096 });
  assert.ok(fallErrors(doc.track.falls, 0, lakes) & FALLERR_HEIGHT);
  assert.match(fallErrorText(FALLERR_HEIGHT, world), /256-cell track's waterfalls \(\.WFL version 1\)/);
  const bad = buildTrackPod(doc, { date: DATE });
  assert.equal(entry(bad, "WORLD\\TRAXX.WFL"), undefined);
  assert.ok(bad.warnings.some((w) => /waterfalls could not be written/.test(w)));
  // A fall never makes a track version 6: a .SIT track with that spring stays a .SIT, its fall in error.
  doc.carry.situationIsSi3 = false;
  assert.equal(isV6Document(doc.track, false), false);
  assert.equal(entry(buildTrackPod(doc, { date: DATE }), "WORLD\\TRAXX.SIT")?.name, "WORLD\\TRAXX.SIT");
  assert.equal(podRefusal(doc)?.title, "Waterfalls need fixing");
});
