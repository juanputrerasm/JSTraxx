import test from "node:test";
import assert from "node:assert/strict";
import { applyComponents, componentsOf, hdArtRefusal, bitmapRefusal, SLOT_BROWSE, SLOT_ICON, SLOT_INFO } from "../src/core/doc/components.ts";
import { infoTextFit } from "../src/ui/dialogs/components-dialog.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { makeBmp8, bmpInfo, stockIcon, stockIconCell } from "../src/core/image/bmp.ts";
import { paletteIndexFromFogMap } from "../src/core/traxx/palette.ts";

test("OK with nothing changed changes nothing; a name follows into the stem", () => {
  const doc = newTrackDocument();
  const before = structuredClone(doc.track);
  const c = componentsOf(doc);
  applyComponents(doc, c);
  // A new track holds TRAXX until OK, when the stem follows its name (SetTrackName).
  assert.deepEqual(doc.track, { ...before, prefix: "NEWTRACK" });
  c.trackName = "My New Track!";
  c.stemAuto = true;
  applyComponents(doc, c);
  assert.equal(doc.track.prefix, "MYNEWTRACK");
  c.stemAuto = false;
  c.stem = "OWN";
  c.trackName = "Other";
  applyComponents(doc, c);
  assert.deepEqual([doc.track.prefix, doc.prefixAuto], ["OWN", false]);
});

test("a stock palette brings its fog map; text gets a terminator; water in quarters", () => {
  const doc = newTrackDocument();
  const c = componentsOf(doc);
  c.paletteIndex = 3;
  c.infoText = "Hello";
  c.water4 = 41;
  const touch = applyComponents(doc, c);
  assert.equal(touch.palette, true);
  assert.equal(paletteIndexFromFogMap(doc.track.fogMap), 3);
  assert.deepEqual([...doc.track.infoText!], [72, 101, 108, 108, 111, 0]);
  assert.equal(doc.track.waterLevel4, 41);
  c.infoText = "  \n";
  applyComponents(doc, c);
  assert.equal(doc.track.infoText, null);
});

test("HD art keeps the old shape; the icon is capped; the info photo is 640x480", () => {
  assert.equal(hdArtRefusal(SLOT_BROWSE, true, 514, 420), null);
  assert.match(hdArtRefusal(SLOT_BROWSE, true, 514, 300)!, /old shape/);
  assert.match(hdArtRefusal(SLOT_BROWSE, true, 100, 82)!, /at least/);
  assert.match(hdArtRefusal(SLOT_ICON, true, 256, 192)!, /at most 128/);
  assert.equal(hdArtRefusal(SLOT_ICON, true, 128, 96), null);
  assert.match(bitmapRefusal(SLOT_INFO, true, 320, 240)!, /640x480/);
  assert.match(bitmapRefusal(SLOT_ICON, true, 64, 48)!, /48 pixels/);
});

test("the 8-bit copy is a 256-colour BMP of the legacy size; stock icons round-trip", () => {
  const rgb = new Uint8Array(64 * 48 * 3).fill(90);
  const bmp = makeBmp8(rgb, 64, 48, 32, 24);
  assert.deepEqual(bmpInfo(bmp), { width: 32, height: 24, bits: 8, compression: 0 });
  assert.equal(bmp.length, 14 + 40 + 1024 + 32 * 24);
  assert.deepEqual(stockIconCell(stockIcon(1, 4)), { col: 1, row: 4, name: "TNKING.BMP" });
  assert.equal(stockIconCell(bmp), null);
});

test("the info panel fits about 23 lines; a long text overflows", () => {
  const measure = (s: string) => s.length * 30;
  const short = infoTextFit("Title\nOne line.", measure);
  assert.deepEqual([short.used, short.over, short.capacity], [2, 0, 23]);
  const long = infoTextFit(Array(40).fill("line").join("\n"), measure);
  assert.ok(long.over > 0);
});
