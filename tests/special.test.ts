import test from "node:test";
import assert from "node:assert/strict";
import { MsvcRand, generateTerrain } from "../src/core/edit/terrain-gen.ts";
import { buildLighting, buildLte, sunPosition } from "../src/core/edit/lighting.ts";
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

test("flat ground at noon is lit evenly; a lit slope faces the sun", () => {
  const raw = new Uint8Array(65536).fill(100);
  const lte = buildLte(raw, 100, 200, 0);
  assert.equal(lte[0], 200);
  assert.equal(lte[7 * 500], 200);
  assert.equal(buildLte(raw, 120, 120, 2)[7 * 9], 120);
  assert.deepEqual([sunPosition([0, -64000, 0]), sunPosition([0, -46333, -46333]), sunPosition([46333, -46333, 0])], [0, 1, 4]);
  const doc = newTrackDocument();
  buildLighting(doc.track, { minLight: 100, maxLight: 200, sun: 2, altBias: 0, shadow: 50 }, () => null);
  assert.deepEqual(doc.track.sun!.vector, [-46333, -46333, 0]);
  assert.equal(doc.track.sun!.shadowIntensity, 2 * 200 * 50);
  assert.equal(doc.track.lte!.length, 65536 * 7);
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
