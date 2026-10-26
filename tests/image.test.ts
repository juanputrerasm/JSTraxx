import test from "node:test";
import assert from "node:assert/strict";
import { borderInset, buildLegacyTile, clampBorder, hdDimensionRefusal, legacySize, quantize, resampleRgb } from "../src/core/image/hd-texture.ts";
import { decodeTga, detectImageFormat, imageFormatRefusal } from "../src/core/image/image-format.ts";
import { fillHdLegacy } from "../src/core/doc/hd-legacy.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";

test("HD size policy follows HDTexture.cpp", () => {
  assert.equal(hdDimensionRefusal("A", 64, 64), null);
  assert.match(hdDimensionRefusal("A", 64, 32)!, /SQUARE/);
  assert.match(hdDimensionRefusal("A", 96, 96)!, /power of two/);
  assert.match(hdDimensionRefusal("A", 16, 16)!, /32 to 1024/);
  assert.match(hdDimensionRefusal("A", 2048, 2048)!, /32 to 1024/);
  assert.deepEqual([32, 64, 128, 256, 1024].map(legacySize), [64, 64, 64, 256, 256]);
  assert.deepEqual([64, 256].map(borderInset), [2, 8]);
});

test("the box filter averages and enlarging is nearest neighbour", () => {
  const src = new Uint8Array([0, 0, 0, 100, 100, 100, 200, 200, 200, 50, 50, 50]);
  assert.deepEqual([...resampleRgb(src, 2, 2, 1, 1)], [87, 87, 87]);
  const up = resampleRgb(src, 2, 2, 4, 4);
  assert.deepEqual([...up.subarray(0, 6)], [0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...up.subarray(9, 12)], [100, 100, 100]);
});

test("the border ring clamps out from the interior", () => {
  const size = 4, img = new Uint8Array(size * size * 3);
  img.set([1, 2, 3], (1 * size + 1) * 3);
  img.set([4, 5, 6], (1 * size + 2) * 3);
  img.set([7, 8, 9], (2 * size + 1) * 3);
  img.set([10, 11, 12], (2 * size + 2) * 3);
  clampBorder(img, size, 1);
  const at = (x: number, y: number) => [...img.subarray((y * size + x) * 3, (y * size + x) * 3 + 3)];
  assert.deepEqual(at(0, 0), [1, 2, 3]);
  assert.deepEqual(at(3, 0), [4, 5, 6]);
  assert.deepEqual(at(0, 3), [7, 8, 9]);
  assert.deepEqual(at(3, 3), [10, 11, 12]);
  assert.deepEqual(at(0, 2), [7, 8, 9]);
});

test("a flat fill quantizes to its true colour, and the tail repeats the last entry", () => {
  const rgb = new Uint8Array(64 * 64 * 3);
  for (let i = 0; i < 64 * 64; i++) rgb.set([30, 60, 90], i * 3);
  const { indices, act } = quantize(rgb, 64, 64);
  assert.deepEqual([...act.subarray(0, 3)], [30, 60, 90]);
  assert.deepEqual([...act.subarray(765, 768)], [30, 60, 90]);
  assert.ok(indices.every((v) => v === 0));
});

test("two colours split into two entries", () => {
  const rgb = new Uint8Array(4 * 3);
  rgb.set([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]);
  const { indices, act } = quantize(rgb, 2, 2);
  const colours = [0, 1, 2, 3].map((i) => [...act.subarray(indices[i]! * 3, indices[i]! * 3 + 3)]);
  assert.deepEqual(colours, [[255, 0, 0], [255, 0, 0], [0, 0, 255], [0, 0, 255]]);
  assert.notEqual(indices[0], indices[2]);
});

test("a terrain tile from 512 is 256 with an 8-texel ring; a model tile has none", () => {
  // A red stripe down the first 16 source columns, blue elsewhere.
  const rgb = new Uint8Array(512 * 512 * 3);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) rgb.set(x < 16 ? [255, 0, 0] : [0, 0, 255], (y * 512 + x) * 3);
  const colour = (t: { indices: Uint8Array; act: Uint8Array }, x: number, y: number) => [...t.act.subarray(t.indices[y * 256 + x]! * 3, t.indices[y * 256 + x]! * 3 + 3)];
  const terrain = buildLegacyTile(rgb, 512, 512, "terrain");
  assert.equal(terrain.side, 256);
  // The interior starts at 8, so the stripe moves in and the ring copies it.
  assert.deepEqual(colour(terrain, 0, 100), [255, 0, 0]);
  assert.deepEqual(colour(terrain, 8, 100), [255, 0, 0]);
  const model = buildLegacyTile(rgb, 512, 512, "model");
  assert.deepEqual(colour(model, 0, 100), [255, 0, 0]);
  assert.deepEqual(colour(model, 8, 100), [0, 0, 255]);
});

function tga(type: 2 | 10, w: number, h: number, body: number[], descriptor = 0): Uint8Array {
  const head = [0, 0, type, 0, 0, 0, 0, 0, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 24, descriptor];
  return new Uint8Array([...head, ...body]);
}

test("TGA: uncompressed bottom-up and RLE", () => {
  // Bottom-up: the first row in the file is the bottom of the image. Pixels are BGR.
  const raw = decodeTga(tga(2, 1, 2, [255, 0, 0, 0, 0, 255]));
  assert.deepEqual([...raw.rgba], [255, 0, 0, 255, 0, 0, 255, 255]);
  const rle = decodeTga(tga(10, 3, 1, [0x82, 0, 255, 0], 0x20));
  assert.deepEqual([...rle.rgba], [0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]);
  assert.throws(() => decodeTga(new Uint8Array(4)));
});

test("format sniffing refuses a renamed file", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(detectImageFormat(png), "PNG");
  assert.equal(imageFormatRefusal(png, "A.PNG", "PNG"), null);
  assert.match(imageFormatRefusal(png, "A.TGA", "TGA")!, /content is PNG/);
  assert.match(imageFormatRefusal(new Uint8Array([0xff, 0xd8, 0xff, 0]), "A.PNG", "PNG")!, /content is JPEG/);
});

test("HD-only textures get their legacy tile on load", async () => {
  const doc = newTrackDocument();
  doc.textures = [{ name: "ART\\FOO.RAW", side: 0, indices: null, act: null, hd: { ext: "TGA", data: new Uint8Array(0) }, bad: false }];
  doc.track.textures = [{ name: "ART\\FOO.RAW", type: 0, depth: 0 }];
  doc.modelTextures = [{ name: "BAR.RAW", side: 0, indices: null, act: null, hd: { ext: "PNG", data: new Uint8Array(0) }, bad: false }];
  const decode = async (_b: Uint8Array, ext: string) => {
    const n = ext === "TGA" ? 128 : 48;
    const rgba = new Uint8Array(n * n * 4).fill(200);
    return { width: n, height: n, rgba };
  };
  await fillHdLegacy(doc, decode);
  assert.equal(doc.textures[0]!.side, 64);
  assert.equal(doc.textures[0]!.legacyBuilt, true);
  assert.equal(doc.modelTextures[0]!.indices, null);
  assert.match(doc.warnings.at(-1)!, /power of two/);
});
