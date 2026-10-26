/*
  More than one backdrop (a .SIT's backdropCount above 1, as Wastelands has): kept through the
  .TXX in a trailer Traxx does not read, and written back to the situation file in order.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { readTxx, writeTxx } from "../src/core/traxx/txx.ts";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import type { PodEntry } from "../src/vendor/openphotex/pod/types.js";
import { loadPodTrack } from "../src/core/doc/load-pod.ts";
import { buildTrackPod } from "../src/core/traxx/pod-writer.ts";

test("extra backdrops go after the sun record and come back; none means no trailer", () => {
  const doc = newTrackDocument();
  const plain = writeTxx(doc.track);
  doc.track.backdropName = "CS4DROP1.BIN";
  const one = writeTxx(doc.track);
  doc.track.extraBackdrops = ["CS4DROP2.BIN", "CS4DROP3.BIN"];
  const more = writeTxx(doc.track);
  assert.equal(readTxx(one).extraBackdrops.length, 0);
  assert.deepEqual(readTxx(more).extraBackdrops, ["CS4DROP2.BIN", "CS4DROP3.BIN"]);
  // The trailer is the only difference: what Traxx reads is the same file.
  assert.deepEqual(more.subarray(0, one.length), one);
  assert.equal(new TextDecoder().decode(more.subarray(one.length, one.length + 8)), "JSTRAXX1");
  assert.ok(plain.length < one.length);
  // An arena has no extra backdrops.
  doc.track.arena = { x: 128, y: 128, sx: 1, sy: 1 };
  const arena = writeTxx(doc.track);
  doc.track.extraBackdrops = [];
  assert.deepEqual(arena, writeTxx(doc.track));
});

const WASTELANDS = `${process.env.HOME}/Desktop/WASTELND.POD`;
test("Wastelands keeps both backdrops and writes them back", { skip: existsSync(WASTELANDS) ? false : "no WASTELND.POD" }, async () => {
  const bytes = new Uint8Array(readFileSync(WASTELANDS));
  const doc = await loadPodTrack({ archive: parsePod(bytes), read: async (e: PodEntry) => readPodEntry(bytes, e) }, 0, "WASTELND.POD");
  assert.equal(doc.track.backdropName, "CS4DROP1.BIN");
  assert.deepEqual(doc.track.extraBackdrops, ["CS4DROP2.BIN"]);
  const pod = buildTrackPod(doc, { extras: new Map(), date: new Date(0) });
  const sit = pod.entries.find((e) => /^WORLD\\.*\.SI[T2]$/i.test(e.name))!;
  const text = new TextDecoder("latin1").decode(sit.data);
  assert.match(text, /backdropType,backdropCount\r?\n0,2\r?\nbackdropModelName\r?\nCS4DROP1\.BIN\r?\nCS4DROP2\.BIN/i);
});

test("the Backdrops list reorders, adds and removes; an arena keeps one", async () => {
  const { applyComponents, componentsOf, MAX_BACKDROPS } = await import("../src/core/doc/components.ts");
  const model = (name: string) => ({ name, bytes: new Uint8Array(4), textureNames: [], frameNames: [], bad: false });
  const doc = newTrackDocument();
  doc.track.backdropName = "A.BIN";
  doc.track.extraBackdrops = ["B.BIN", "C.BIN"];
  doc.models.push(model("A.BIN"), model("B.BIN"), model("MODELS\\C.BIN"));
  const c = componentsOf(doc);
  assert.deepEqual(c.backdrops, ["A.BIN", "B.BIN", "C.BIN"]);
  c.backdrops = ["C.BIN", "A.BIN", "D.BIN"];
  c.loadedBackdrops = [{ model: model("D.BIN"), textures: [] }];
  const touch = applyComponents(doc, c);
  assert.ok(touch.models);
  assert.equal(doc.track.backdropName, "C.BIN");
  assert.deepEqual(doc.track.extraBackdrops, ["A.BIN", "D.BIN"]);
  assert.deepEqual(doc.models.map((m) => m.name).sort(), ["A.BIN", "D.BIN", "MODELS\\C.BIN"]);
  // No more than the limit; an arena is its stadium alone.
  const c2 = componentsOf(doc);
  c2.backdrops = ["C.BIN", "A.BIN", "D.BIN", "E.BIN", "F.BIN"];
  applyComponents(doc, c2);
  assert.equal(1 + doc.track.extraBackdrops.length, MAX_BACKDROPS);
  const c3 = componentsOf(doc);
  c3.isArena = true;
  applyComponents(doc, c3);
  assert.deepEqual([doc.track.backdropName, doc.track.extraBackdrops, doc.track.arena], ["C.BIN", [], { x: 128, y: 128, sx: 1, sy: 1 }]);
});
