import test from "node:test";
import assert from "node:assert/strict";
import { applyObjectFields, isStockSound, objectFields, setObjectSound, SOUND_CONTINUOUS } from "../src/core/edit/object-properties.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { traxxBoxDefaults } from "../src/core/traxx/sit.ts";
import { lightPoolLines } from "../src/core/view/light-pool.ts";

test("OK with nothing changed leaves the object as it was", () => {
  const doc = newTrackDocument();
  const box = { ...traxxBoxDefaults(), ipos: [1000, 2000, 60] as [number, number, number], fraction: [128, 64, 32] as [number, number, number], psi: 1.25, heightAboveGround: 10, mass: 500 };
  doc.track.boxes = [box];
  const before = structuredClone(box);
  const f = objectFields(box);
  assert.equal(f.fx, 1000.5);
  const msgs = applyObjectFields(doc.track, 0, f, doc.track.heights, { cont: null, impact: null }, box.heightAboveGround);
  assert.deepEqual(msgs, []);
  assert.deepEqual(box.ipos, before.ipos);
  assert.deepEqual(box.fraction, before.fraction);
  assert.ok(Math.abs(box.psi - before.psi) < 1e-5);
  assert.equal(box.soundCont, "NULL.WAV");
});

test("a checkpoint takes its number and the others move up and are renumbered", () => {
  const doc = newTrackDocument();
  const cp = (seq: number) => ({ ...traxxBoxDefaults(), type: 6, checkpointSeq: seq });
  doc.track.boxes = [cp(0), cp(1), cp(2), { ...traxxBoxDefaults() }];
  const moved = doc.track.boxes[2]!;
  const f = objectFields(moved);
  f.checkpoint = 0;
  applyObjectFields(doc.track, 2, f, doc.track.heights, { cont: null, impact: null }, 0);
  assert.equal(doc.track.boxes[0], moved);
  assert.deepEqual(doc.track.boxes.slice(0, 3).map((b) => b.checkpointSeq), [0, 1, 2]);
});

test("sounds: stock names, a WAV added once, and no sound used both ways", () => {
  const doc = newTrackDocument();
  const box = traxxBoxDefaults();
  assert.ok(isStockSound("AIRHORN.WAV"));
  assert.equal(setObjectSound(doc.track, box, false, "airhorn", null), null);
  assert.equal(box.soundImpact, "AIRHORN.WAV");
  assert.equal(doc.track.sounds.length, 0);
  assert.equal(setObjectSound(doc.track, box, true, "mine", new Uint8Array([1])), null);
  assert.deepEqual([doc.track.sounds.length, doc.track.sounds[0]!.name, doc.track.sounds[0]!.flags], [1, "SOUND\\MINE.WAV", SOUND_CONTINUOUS]);
  assert.match(setObjectSound(doc.track, box, false, "MINE", null)!, /already loaded as continuous/);
  assert.equal(box.soundImpact, "NULL.WAV");
});

test("a light's pool is a ring of 72 segments plus the stem", () => {
  const doc = newTrackDocument();
  const box = { ...traxxBoxDefaults(), type: 12 };
  const lines = lightPoolLines(box, box.light, doc.track.heights);
  assert.equal(lines.length, 73);
  assert.equal(lightPoolLines(box, { ...box.light, radius: 0 }, doc.track.heights).length, 0);
});

test("Group Properties: shared fields shown, differing ones blank, only changes applied", async () => {
  const { groupStart, applyGroup, parses, GP_MASS, GP_ANGLE, GP_SIZEW } = await import("../src/core/edit/group-properties.ts");
  const doc = newTrackDocument();
  const a = { ...traxxBoxDefaults(), mass: 100, psi: 0 };
  const b = { ...traxxBoxDefaults(), mass: 200, psi: 0, modelName: "TREE.BIN" };
  doc.track.boxes = [a, b];
  const start = groupStart([a, b]);
  assert.equal(start.text[GP_MASS], "");
  assert.equal(start.text[GP_ANGLE], "0.00");
  assert.equal(start.text[GP_SIZEW], "64");
  assert.ok(start.anyPlain);
  const text = [...start.text];
  text[GP_MASS] = "300";
  text[GP_SIZEW] = "80";
  applyGroup(doc.track, [0, 1], { start, typeIndex: start.typeIndex, level: start.level, soundCont: start.soundCont, soundImpact: start.soundImpact, text, wavs: { cont: null, impact: null } });
  assert.deepEqual([a.mass, b.mass, a.width, b.width], [300, 300, 80, 64]);
  assert.ok(parses(GP_MASS, "12") && !parses(GP_MASS, "1.5") && parses(GP_ANGLE, "-.5") && !parses(GP_ANGLE, "-"));
});
