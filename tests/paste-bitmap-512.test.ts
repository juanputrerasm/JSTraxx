/*
  Traxx 1.8.2 Paste Terrain Bitmap (d932015, TraxxViewEdit.cpp OnTerrainPasteBitmap): an N x N
  picture, and on a 512 world a 256 x 256 one into the top-left corner (cells 0..255), with
  Traxx's three refusals.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { heightsToRgba, pasteBitmapFits, pasteBitmapHeights, pasteBitmapRefusal, rgbaToHeights } from "../src/core/edit/terrain.ts";
import { TERRAINMODE_CLASSIC16, type Terrain16 } from "../src/core/traxx/terrain16.ts";

function world512(fill = 7 << 8): Terrain16 {
  const h16 = new Int32Array(512 * 512).fill(fill);
  const heights = new Uint8Array(512 * 512).fill(fill >> 8);
  return { terrainMode: TERRAINMODE_CLASSIC16, worldCells: 512, h16, fine: null, rawShadow: heights.slice(), heights };
}

test("the shapes Paste Terrain Bitmap takes", () => {
  assert.equal(pasteBitmapFits(256, 256, 256), true);
  assert.equal(pasteBitmapFits(512, 512, 512), true);
  assert.equal(pasteBitmapFits(256, 256, 512), true, "256 into a 512 world's corner");
  assert.equal(pasteBitmapFits(512, 512, 256), false);
  assert.equal(pasteBitmapFits(256, 255, 256), false);
  assert.equal(pasteBitmapFits(128, 128, 512), false);
});

test("Traxx's three refusals", () => {
  assert.equal(pasteBitmapRefusal(256, 256, 256), null);
  assert.equal(pasteBitmapRefusal(256, 256, 512), null);
  assert.equal(pasteBitmapRefusal(512, 512, 256),
    "Sorry, this bitmap is 512 x 512 pixels but this track's world is 256 x 256. A 512 x 512 bitmap needs a 512 x 512 track.");
  assert.equal(pasteBitmapRefusal(300, 300, 512), "Sorry, Bitmap must be 512 x 512 pixels (or 256 x 256, which goes in the top-left corner).");
  assert.equal(pasteBitmapRefusal(300, 300, 256), "Sorry, Bitmap must be 256 x 256 pixels.");
  assert.equal(pasteBitmapRefusal(0, 0, 256), "Sorry, Bitmap must be 256 x 256 pixels.", "no picture on the clipboard");
});

test("a 256 picture goes into cells 0..255 of a 512 world, the rest untouched", () => {
  const src = new Uint8Array(256 * 256);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) src[i + j * 256] = (i + 3 * j) & 255;
  const data = rgbaToHeights(heightsToRgba(src), 256, 256, 512);
  assert.ok(data);
  assert.equal(data.length, 65536, "rows 256 long");
  assert.deepEqual(data, src, "bottom-up, as the copy wrote it");
  const t = world512();
  assert.ok(pasteBitmapHeights(t, data));
  assert.equal(t.h16![10 + 20 * 512], ((10 + 60) & 255) << 8);
  assert.equal(t.h16![255 + 255 * 512], ((255 + 765) & 255) << 8);
  assert.equal(t.h16![256 + 0 * 512], 7 << 8, "column 256 untouched");
  assert.equal(t.h16![0 + 256 * 512], 7 << 8, "row 256 untouched");
  assert.equal(t.h16![511 + 511 * 512], 7 << 8);
  assert.equal(t.heights[10 + 20 * 512], (10 + 60) & 255, "the mirror follows");
});

test("a whole 512 picture fills a 512 world; a 512 picture is refused on 256", () => {
  const t = world512();
  const pic = new Uint8Array(512 * 512).fill(9);
  assert.ok(pasteBitmapHeights(t, pic));
  assert.ok(t.h16!.every((v) => v === 9 << 8));
  assert.equal(rgbaToHeights(new Uint8Array(512 * 512 * 4), 512, 512, 256), null);
});
