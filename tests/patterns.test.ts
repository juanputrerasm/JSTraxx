import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPattern, missingTextures, pasteMapping, pastePattern, patternThumbnail } from "../src/core/edit/patterns.ts";
import { readTxp, writeTxp } from "../src/core/traxx/txp.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import type { TextureAsset } from "../src/core/doc/document.ts";

const tex = (name: string, fill: number): TextureAsset => ({ name, side: 64, indices: new Uint8Array(4096).fill(fill), act: null, hd: null, bad: false, trackIndexed: true });

test("a pattern keeps its cells, names its textures in index order and pastes back", () => {
  const doc = newTrackDocument();
  doc.textures = [tex("ART\\A.RAW", 1), tex("ART\\B.RAW", 2), tex("ART\\C.RAW", 3)];
  const clr = doc.track.clr;
  clr[10 + (20 << 8)] = 2 | 0x4000;
  clr[11 + (20 << 8)] = 1;
  clr[10 + (21 << 8)] = 2;
  clr[11 + (21 << 8)] = 0x1000;
  const p = buildPattern(doc, "Test", { x0: 10, y0: 20, x1: 11, y1: 21 }, doc.track.palette)!;
  assert.deepEqual(p.textures, ["ART\\A.RAW", "ART\\B.RAW", "ART\\C.RAW"]);
  assert.deepEqual(p.cells, [2 | 0x4000, 1, 2, 0x1000]);
  assert.equal(patternThumbnail(p)!.width, 64);
  assert.equal(buildPattern(doc, "x", { x0: 0, y0: 0, x1: 0, y1: 0 }, doc.track.palette), null);
  assert.equal(buildPattern(doc, "x", { x0: 0, y0: 0, x1: 16, y1: 1 }, doc.track.palette), null);

  // Into a track whose textures sit elsewhere: renumbered by name, clipped to the area.
  const other = newTrackDocument();
  other.textures = [tex("ART\\C.RAW", 3), tex("ART\\A.RAW", 1)];
  assert.deepEqual(missingTextures(other, p), ["ART\\B.RAW"]);
  const mapping = pasteMapping(other, p);
  assert.deepEqual(mapping, [1, 0, 0]);
  pastePattern(other.track.clr, p, mapping, { x0: 5, y0: 5, x1: 5, y1: 9 });
  assert.equal(other.track.clr[5 + (5 << 8)], 0x4000);
  assert.equal(other.track.clr[5 + (6 << 8)], 0);
  assert.equal(other.track.clr[6 + (5 << 8)], 0, "outside the area");
  assert.deepEqual(readTxp(writeTxp([p]))[0]!.cells, p.cells);
});

test("Traxx's Patterns.txp reads and every thumbnail decodes", () => {
  const patterns = readTxp(new Uint8Array(readFileSync(new URL("../public/ui/Patterns.txp", import.meta.url))));
  assert.ok(patterns.length > 0);
  for (const p of patterns) assert.ok(patternThumbnail(p), p.name);
});
