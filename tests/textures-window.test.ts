import test from "node:test";
import assert from "node:assert/strict";
import { TextureSelection } from "../src/core/edit/texture-selection.ts";
import { addAnimationFrame, addTexture, findAnimation, normalMapRefusal, setTypeDepth, textureFromFile } from "../src/core/edit/texture-list.ts";
import { listArtFolder, previewPattern, wildcardMatch } from "../src/core/edit/art-folder.ts";
import { pod1ArtStemBudget, isAnyMapName } from "../src/core/traxx/pod-items.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import type { TextureAsset } from "../src/core/doc/document.ts";

const tex = (name: string): TextureAsset => ({ name, side: 64, indices: new Uint8Array(4096), act: null, hd: null, bad: false });

test("the ART stem budget is 18 (the tools' cap binds before _AO.PNG does)", () => {
  assert.equal(pod1ArtStemBudget(), 18);
  assert.ok(isAnyMapName("ROAD_N.PNG") && isAnyMapName("x\\GRASS_DTL.TGA"));
  assert.ok(!isAnyMapName("ROAD_NORTH.PNG"));
});

test("Load refuses normal maps and long stems, and keeps a .RAW's own palette", async () => {
  const decode = async () => { throw new Error("no"); };
  assert.match(normalMapRefusal("ROCK_N.PNG")!, /NORMAL MAP/);
  assert.equal(normalMapRefusal("ROCK_NORTH.PNG"), null);
  assert.match(String(await textureFromFile({ title: "ROCK_N.PNG", bytes: new Uint8Array(1) }, decode)), /NORMAL MAP/);
  assert.match(String(await textureFromFile({ title: "ABCDEFGHIJKLMNOPQRS.RAW", bytes: new Uint8Array(4096) }, decode)), /too long/);
  const act = new Uint8Array(768).fill(7);
  const out = await textureFromFile({ title: "grass.raw", bytes: new Uint8Array(4096), act }, decode);
  assert.ok(typeof out !== "string");
  assert.equal(out.name, "ART\\GRASS.RAW");
  assert.equal(out.side, 64);
  assert.equal(out.act![5], 7);
  const hd = await textureFromFile({ title: "rock.png", bytes: new Uint8Array(4) }, async () => ({ width: 128, height: 128, rgba: new Uint8Array(128 * 128 * 4) }));
  assert.ok(typeof hd !== "string");
  assert.equal(hd.name, "ART\\ROCK.RAW");
  assert.equal(hd.side, 64);
  assert.equal(hd.legacyBuilt, true);
});

test("a texture fills the first empty slot with grip depth 1", () => {
  const doc = newTrackDocument();
  doc.textures = [tex("ART\\A.RAW"), null, tex("ART\\C.RAW")];
  doc.track.textures = [{ name: "ART\\A.RAW", type: 0, depth: 1 }, { name: "", type: 0, depth: 0 }, { name: "ART\\C.RAW", type: 0, depth: 1 }];
  assert.equal(addTexture(doc, tex("ART\\B.RAW")), 1);
  assert.deepEqual(doc.track.textures[1], { name: "ART\\B.RAW", type: 0, depth: 1 });
  assert.equal(addTexture(doc, tex("ART\\D.RAW")), 3);
  setTypeDepth(doc.track, [0, 3], { type: 6 });
  setTypeDepth(doc.track, [3], { depth: 150 });
  assert.deepEqual(doc.track.textures.map((t) => [t.type, t.depth]), [[6, 1], [0, 1], [0, 1], [6, 99]]);
});

test("Ctrl+click builds an animation: 250 ms, 8 frames at most, names of 15 at most", () => {
  const doc = newTrackDocument();
  doc.textures = [tex("ART\\A.RAW"), tex("ART\\B.RAW"), tex("ART\\LONGNAME1234.RAW")];
  doc.track.animations = [];
  assert.equal(addAnimationFrame(doc, 0, 1), 0);
  assert.deepEqual(doc.track.animations[0], { period: 250, nframes: 2, frames: [0, 1, 0, 0, 0, 0, 0, 0] });
  assert.match(String(addAnimationFrame(doc, 0, 2)), /at most 15/);
  for (let k = 0; k < 6; k++) addAnimationFrame(doc, 0, 1);
  assert.equal(doc.track.animations[0]!.nframes, 8);
  assert.equal(addAnimationFrame(doc, 0, 1), "Max. 8 frames per animation.");
  assert.equal(findAnimation(doc.track, 0), 0);
  assert.equal(findAnimation(doc.track, 1), -1);
});

test("the selection: Shift toggles with the newest as anchor, a box replaces or adds", () => {
  const s = new TextureSelection();
  s.select(2);
  s.toggle(5, 10);
  assert.deepEqual([s.anchor, s.all()], [5, [2, 5]]);
  s.toggle(5, 10);
  assert.deepEqual([s.anchor, s.size, s.all()], [2, 0, [2]]);
  s.box([3, 4, 5], 4, false, 10);
  assert.deepEqual([s.anchor, s.all()], [4, [3, 4, 5]]);
  s.box([8], -1, true, 10);
  assert.deepEqual([s.anchor, s.all()], [4, [3, 4, 5, 8]]);
  s.select(9);
  assert.deepEqual(s.all(), [9]);
  s.box([], -1, false, 10);
  assert.equal(s.anchor, -1);
  s.box([1, 2], -1, false, 10);
  s.validate(11);
  assert.deepEqual(s.all(), [1]);
});

test("the Load pane lists HD art without a .RAW first, then RAWs of stock sizes", () => {
  const files = [
    { name: "GRASS.RAW", size: 4096 }, { name: "GRASS.ACT", size: 768 }, { name: "GRASS.PNG", size: 999 },
    { name: "ROCK.PNG", size: 999 }, { name: "ROCK_N.PNG", size: 999 }, { name: "SKY.TGA", size: 9 },
    { name: "ODD.RAW", size: 16384 }, { name: "TINY.RAW", size: 1024 },
  ];
  assert.deepEqual(listArtFolder(files, "").map((l) => l.file), ["ROCK.PNG", "SKY.TGA", "GRASS.RAW", "TINY.RAW"]);
  assert.deepEqual(listArtFolder(files, "R").map((l) => l.file), ["ROCK.PNG", "GRASS.RAW"]);
  assert.equal(previewPattern("G*", "RAW"), "G*.RAW");
  assert.ok(wildcardMatch("G*.RAW", "grass.raw"));
  assert.ok(!wildcardMatch("G*.RAW", "AGRASS.RAW"));
});

test("Paste Composite: RAW tiles with the overlap share their ring; names are hex", async () => {
  const { applyLimits, fitCount, tileName, tileOrigin, encodeTga24, sizesFor, pickSize } = await import("../src/core/image/composite.ts");
  const raw = { format: "RAW" as const, size: 256, overlap: true, xoff: 0, yoff: 0, cols: 16, rows: 16 };
  assert.deepEqual(tileOrigin(raw, 1, 2), { x: 240, y: 480 });
  assert.deepEqual(tileOrigin({ ...raw, format: "PNG" }, 1, 2), { x: 256, y: 512 });
  assert.equal(fitCount(1024, 0, 256, 240), 4);
  assert.equal(fitCount(100000, 0, 32, 32), 16);
  const lim = applyLimits({ ...raw, xoff: 900 }, 1024, 512);
  assert.deepEqual([lim.xoff, lim.cols, lim.rows], [768, 1, 2]);
  assert.equal(tileName("NEW", 10, 15), "NEWAF");
  assert.deepEqual(sizesFor("RAW", 300, 200), [32, 64]);
  assert.equal(pickSize([32, 64, 128], 256), 128);
  const tga = encodeTga24(new Uint8Array([1, 2, 3, 4, 5, 6]), 1, 2);
  assert.deepEqual([...tga.subarray(18)], [6, 5, 4, 3, 2, 1]);
});
