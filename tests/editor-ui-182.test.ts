/*
  Traxx 1.8.1 / 1.8.2 editor items with pure parts: Edit This Track's free stem and naming
  (TrackPODFile.cpp Pod1PickFreeStem, MakeEditableFromView), the extract's byte comparison
  (ExtractArtAndModels), ExtractConflictMessage, the checkpoint label sizes (OverlayCheckpoints),
  the View Controls grid modes (EffectiveGridMode, WantedGridSize, the Whole Grid migration) and
  Group Properties' non-finite numbers (93419dd).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { editableName, numberedTrackName, pickFreeStem, stemNumber, stemTakenInPod } from "../src/core/traxx/free-stem.ts";
import { extractArtAndModels, extractConflictMessage, extractReportText, type ExtractFolders } from "../src/core/doc/extract-art.ts";
import { makeEditableFromView } from "../src/core/doc/edit-this-track.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { MTM2_ONLY } from "../src/core/doc/document.ts";
import { checkpointLabelEnds, checkpointLabelPx, checkpointLabelText } from "../src/core/view/checkpoint-label.ts";
import { effectiveGridMode, mergeSettings, wantedGridSize } from "../src/core/settings.ts";
import { GP_ANGLE, GP_HEIGHT, GP_MASS, parses } from "../src/core/edit/group-properties.ts";

test("Pod1PickFreeStem: stem2 .. stem999, the digits out of the 20-character budget", () => {
  assert.equal(pickFreeStem("CHICAGO", () => false), "CHICAGO2");
  const taken = new Set(["CHICAGO2", "CHICAGO3"]);
  assert.equal(pickFreeStem("CHICAGO", (s) => taken.has(s)), "CHICAGO4");
  assert.equal(pickFreeStem("ABCDEFGHIJKLMNOPQRST", () => false), "ABCDEFGHIJKLMNOPQRS2", "a full stem gives up its last character");
  assert.equal(pickFreeStem("ABCDEFGHIJKLMNOPQRST", (s) => /\d$/.test(s) && s.length === 20 && !s.endsWith("10")), "ABCDEFGHIJKLMNOPQR10");
  assert.equal(pickFreeStem("X", () => true), null, "every candidate taken");
  assert.equal(pickFreeStem("", () => false), null);
  const inPod = stemTakenInPod(["WORLD\\CHICAGO2.SIT", "levels\\chicago3.lvl", "WORLD\\CHICAGO4.SI3", "ART\\CHICAGO5.RAW"]);
  assert.equal(pickFreeStem("CHICAGO", inPod), "CHICAGO5", "only WORLD .SIT/.SI2/.SI3 and LEVELS .LVL count, in any case");
});

test("MakeEditableFromView's number and name", () => {
  assert.equal(stemNumber("CHICAGO", "CHICAGO3"), "3");
  assert.equal(stemNumber("TRACK1", "TRACK12"), "2", "TRACK1 becomes TRACK12, and its number is 2");
  assert.equal(stemNumber("ABCDEFGHIJKLMNOPQRST", "ABCDEFGHIJKLMNOPQR10"), "10");
  assert.equal(numberedTrackName("Chicago", "3"), "Chicago3");
  assert.equal(numberedTrackName("A".repeat(31), "12"), "A".repeat(29) + "12", "a full name gives up its last characters");
  assert.deepEqual(editableName("CHICAGO", "Chicago", ["WORLD\\CHICAGO.SIT", "LEVELS\\CHICAGO.LVL", "WORLD\\CHICAGO2.SI2"]), { prefix: "CHICAGO3", trackName: "Chicago3" });
  assert.deepEqual(editableName("", "x", []), { error: "This track has no file name to build an editable copy's name from." });
});

test("MakeEditableFromView on a document", () => {
  const doc = newTrackDocument();
  doc.viewOnly = true;
  doc.track.prefix = "VALPO";
  doc.track.trackName = "Valparaiso";
  doc.track.logoBmpName = "VALPOS.BMP";
  doc.track.mapBmpName = "VALPOL.BMP";
  doc.track.versionFlags = 0;
  doc.carry.txvText = "x";
  doc.carry.detailFromPod = doc.carry.maskFromPod = true;
  assert.equal(makeEditableFromView(doc, ["WORLD\\VALPO.SIT", "LEVELS\\VALPO.LVL"]), null);
  assert.equal(doc.track.prefix, "VALPO2");
  assert.equal(doc.track.trackName, "Valparaiso2");
  assert.equal(doc.track.logoBmpName, "");
  assert.equal(doc.track.mapBmpName, "");
  assert.equal(doc.track.versionFlags & MTM2_ONLY, MTM2_ONLY);
  assert.equal(doc.carry.txvText, null);
  assert.equal(doc.carry.detailFromPod || doc.carry.maskFromPod, false);
  assert.equal(doc.viewOnly, false);
  assert.equal(doc.prefixAuto, false, "the stem stays fixed through a rename");
});

/** An in-memory ART / MODELS folder pair. */
function memFolders(start: Record<string, Uint8Array | "dir"> = {}): ExtractFolders & { files: Map<string, Uint8Array | "dir"> } {
  const files = new Map<string, Uint8Array | "dir">(Object.entries(start).map(([k, v]) => [k.toUpperCase(), v]));
  return {
    files,
    read: async (folder, path) => files.get(`${folder}\\${path}`.toUpperCase()) ?? null,
    write: async (folder, path, bytes) => { if (path.includes("BAD")) return false; files.set(`${folder}\\${path}`.toUpperCase(), bytes); return true; },
  };
}
const b = (...v: number[]) => new Uint8Array(v);
const item = (name: string, bytes: Uint8Array) => ({ name, read: async () => bytes });

test("ExtractArtAndModels: never overwrites, lists what differs, keeps an HD source off a differing .RAW", async () => {
  const f = memFolders({ "ART\\SAME.RAW": b(1, 2), "ART\\DIFF.RAW": b(9), "ART\\HD.RAW": b(7), "MODELS\\CAR.BIN": b(5), "MODELS\\TREE.BIN": b(4), "ART\\SUB": "dir" });
  const r = await extractArtAndModels([
    item("ART\\SAME.RAW", b(1, 2)), item("ART\\DIFF.RAW", b(1)), item("ART\\NEW.RAW", b(3)),
    item("ART\\HD.RAW", b(8)), item("ART\\HD.PNG", b(0x89)), item("ART\\OTHER.PNG", b(1)),
    item("MODELS\\CAR.BIN", b(6)), item("MODELS\\TREE.BIN", b(4)), item("MODELS\\NEW.BIN", b(2)), item("MODELS\\LOOSE.BIN", b(1)),
    item("ART\\..\\EVIL.RAW", b(1)), item("ART\\BAD.RAW", b(1)), item("ART\\SUB", b(1)), item("DATA\\X.TXV", b(1)), item("ART\\", b()),
  ], f, true, (n) => /CAR|TREE|NEW\.BIN/.test(n));
  assert.deepEqual(r.report, [
    "ART\\DIFF.RAW", "ART\\HD.RAW", "ART\\HD.PNG (not copied: your HD.RAW differs)",
    "ART\\..\\EVIL.RAW (could not write)", "ART\\BAD.RAW (could not write)", "ART\\SUB (could not write)",
  ]);
  assert.deepEqual(r.modelConflicts, ["MODELS\\CAR.BIN"], "a track model's differing .BIN is the caller's to read and list");
  assert.deepEqual(r.modelSources, ["MODELS\\TREE.BIN", "MODELS\\NEW.BIN", "MODELS\\LOOSE.BIN"]);
  assert.equal(r.written, 4, "NEW.RAW, OTHER.PNG, NEW.BIN, LOOSE.BIN");
  assert.deepEqual(f.files.get("ART\\DIFF.RAW"), b(9), "never overwritten");
  assert.equal(f.files.has("ART\\HD.PNG"), false);
  const plain = await extractArtAndModels([item("MODELS\\CAR.BIN", b(6))], memFolders({ "MODELS\\CAR.BIN": b(5) }), false, () => true);
  assert.deepEqual(plain.report, ["MODELS\\CAR.BIN"], "Extract Components (no readConflicts): listed plain");
});

test("ExtractConflictMessage: 20 lines, then 'and N more'", () => {
  const lines = Array.from({ length: 23 }, (_, i) => `ART\\T${i}.RAW`);
  const text = extractConflictMessage(lines);
  assert.equal(text.split("\n").length, 21);
  assert.ok(text.startsWith("ART\\T0.RAW\nART\\T1.RAW\n"));
  assert.ok(text.endsWith("ART\\T19.RAW\nand 3 more"));
  assert.equal(extractConflictMessage(["A"]), "A\n");
  assert.equal(extractReportText([]), null);
  assert.ok(extractReportText(["A"])!.startsWith("These files were already in your folders with different contents. Write POD and a reopened .TXX will use your copies, not the pod's:\nA"));
});

test("OverlayCheckpoints: a model-less gate's label shrinks with its width on screen", () => {
  assert.equal(checkpointLabelText(3), "CP 03");
  assert.equal(checkpointLabelText(3, { label: (n) => (n === 3 ? "Stage" : null) }), "Stage");
  assert.equal(checkpointLabelText(4, { label: () => null }), "CP 04");
  assert.deepEqual(checkpointLabelEnds({ width: 10, height: 4 }), [[-10, 0, -4], [10, 0, -4]]);
  const width = (px: number) => px * 3;   // "CP nn" about 3 px wide per px of size
  assert.equal(checkpointLabelPx(null, width), 12, "a model box, or ends that did not project: plain 12 px");
  assert.equal(checkpointLabelPx([{ x: 0, y: 0 }, { x: 100, y: 0 }], width), 12, "wide: capped at 12");
  assert.equal(checkpointLabelPx([{ x: 0, y: 0 }, { x: 0, y: 34 }], width), 10, "limit 30: 10 px fits (30), 11 does not (33)");
  assert.equal(checkpointLabelPx([{ x: 0, y: 0 }, { x: 20, y: 0 }], width), null, "limit 18: not even 7 px fits (21)");
});

test("View Controls grid radios: EffectiveGridMode, WantedGridSize, the Whole Grid migration", () => {
  assert.equal(effectiveGridMode(1, 256), 2, "256 x 256 on a 256 world shows as Whole world");
  assert.equal(effectiveGridMode(1, 512), 1);
  assert.equal(effectiveGridMode(0, 256), 0);
  assert.equal(wantedGridSize({ grid_mode: 0, polysize: 96 }, 512), 96);
  assert.equal(wantedGridSize({ grid_mode: 1, polysize: 96 }, 512), 256);
  assert.equal(wantedGridSize({ grid_mode: 1, polysize: 96 }, 256), 256);
  assert.equal(wantedGridSize({ grid_mode: 2, polysize: 96 }, 512), 512);
  assert.equal(mergeSettings({ show_whole_grid: true }).grid_mode, 2, "the old Whole Grid becomes Whole world");
  assert.equal(mergeSettings({ show_whole_grid: false }).grid_mode, 0);
  assert.equal(mergeSettings({ show_whole_grid: true, grid_mode: 1 }).grid_mode, 1, "a stored Grid Mode wins");
  assert.equal(mergeSettings({ grid_mode: 7 }).grid_mode, 0);
  assert.equal(mergeSettings({}).traditional_clicking, false);
});

test("Group Properties: inf, nan and 1e999 are not numbers (93419dd)", () => {
  assert.ok(!parses(GP_HEIGHT, "1e999"));
  assert.ok(!parses(GP_ANGLE, "-1e400"));
  assert.ok(!parses(GP_ANGLE, "inf") && !parses(GP_ANGLE, "nan") && !parses(GP_ANGLE, "Infinity"));
  assert.ok(parses(GP_ANGLE, "1e30") && parses(GP_HEIGHT, "-2.5"));
  assert.ok(parses(GP_MASS, "+12") && !parses(GP_MASS, "1e3"));
});

test("ObjectHeightCap: 500 steps, or the ceiling on a Tall Heights V6 track", async () => {
  const { objectHeightCap } = await import("../src/core/edit/objects.ts");
  const { heightLimitOf } = await import("../src/core/traxx/track-kind.ts");
  assert.equal(objectHeightCap({ trackKind: "classic" }), 500);
  assert.equal(objectHeightCap({ trackKind: "standard" }), 500);
  assert.equal(objectHeightCap({ trackKind: "tall" }), Math.trunc(heightLimitOf("tall") / 256));
  assert.equal(objectHeightCap(new Uint8Array(65536)), 500, "a bare 8-bit grid is a classic track");
});
