import test from "node:test";
import assert from "node:assert/strict";
import { MsvcRand, generateTerrain } from "../src/core/edit/terrain-gen.ts";
import { buildLighting, engineY0, trackLighting } from "../src/core/edit/lighting.ts";
import { optimalPalette } from "../src/core/edit/optimal-palette.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";

test("rand() is MSVC's: srand(1) gives 41, 18467, 6334, 26500", () => {
  const r = new MsvcRand(1);
  assert.deepEqual([r.next(), r.next(), r.next(), r.next()], [41, 18467, 6334, 26500]);
  assert.equal(new MsvcRand(0).next(), 38);
});

test("generated terrain is repeatable and stays in range", () => {
  const s = { mode: 0, seed: 7, ground: 100, hillHeight: 50, valleyDepth: 20, smoothness: 40 };
  const a = generateTerrain(s), b = generateTerrain(s);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, generateTerrain({ ...s, seed: 8 }));
  const f = generateTerrain({ ...s, mode: 1, hillHeight: 128, valleyDepth: 64 });
  assert.ok(f.some((v) => v !== f[0]));
});

test("BuildLighting writes the LVL values verbatim and bakes the engine formula (Traxx 1.7.2)", () => {
  const doc = newTrackDocument();
  assert.deepEqual(trackLighting(doc.track), { sun: [-46333, -46333, 0], ambient: 32768 });
  const before = { ...doc.track.sun! };
  // An arbitrary sun is kept exactly: no snapping to a preset, no normalising, no range check.
  buildLighting(doc.track, [19585, -59396, 19585], 40960);
  assert.deepEqual(doc.track.sun!.vector, [19585, -59396, 19585]);
  assert.equal(doc.track.sun!.shadowIntensity, 40960);
  // The boss light is left as it was.
  assert.deepEqual(doc.track.sun!.position, before.position);
  assert.equal(doc.track.sun!.intensity, before.intensity);
  const lte = doc.track.lte!;
  assert.equal(lte.length, 65536 * 7);
  // Flat ground (raw 100 everywhere): every ground byte the same, the other six 0.
  assert.ok(Array.from({ length: 65536 }, (_, c) => lte[c * 7]).every((v) => v === lte[0]));
  assert.ok(lte.every((v, i) => i % 7 === 0 || v === 0));
  // The E preset on flat ground with ambient 32768 is 218 (lighttest test_flat_e_preset); no 8..255 clamp.
  buildLighting(doc.track, [-46333, -46333, 0], 32768);
  assert.equal(doc.track.lte![0], 218);
  buildLighting(doc.track, [0, 46333, 0], 0);
  assert.equal(doc.track.lte![0], 0);
  // Classic 8-bit heights reach the engine as 128 * raw.
  doc.track.heights[5 * 256 + 3] = 10;
  assert.equal(engineY0(doc.track)[5 * 256 + 3], 1280);
});

test("the optimal palette keeps the system and standard colours", () => {
  const doc = newTrackDocument();
  const indices = new Uint8Array(64 * 64);
  for (let i = 0; i < indices.length; i++) indices[i] = i & 255;
  const act = new Uint8Array(768);
  for (let c = 0; c < 256; c++) act.set([c, 255 - c, (c * 7) & 255], c * 3);
  doc.textures = [{ name: "ART\\A.RAW", side: 64, indices, act, hd: null, bad: false }];
  doc.track.clr.fill(0);
  const pal = optimalPalette(doc)!;
  assert.deepEqual([...pal.subarray(10 * 3, 11 * 3)], [63, 0, 0]);
  assert.deepEqual([...pal.subarray(255 * 3)], [255, 255, 255]);
  assert.equal(optimalPalette(newTrackDocument()), null);
});
