/*
  Traxx 1.8.0's format changes (a114974): the light's allWx in the .TXX (TRAXXV20, and always in
  JSTraxx's V99). The cases of tools/txxtest.cpp test_light_allwx_txx: three boxes, pass 0 with
  allwx off everywhere (stays the old V3 file), pass 1 one light on (V20), pass 2 on plus a fog
  (V20 wins over V14); the flag survives a second generation.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { readTxx, writeTxx } from "../src/core/traxx/txx.ts";
import { traxxBoxDefaults, TRAXX_BOX_FOG, TRAXX_BOX_LIGHT } from "../src/core/traxx/sit.ts";

const header = (b: Uint8Array) => new TextDecoder("latin1").decode(b.subarray(0, 10)).replace(/\0.*$/, "");

function lights(pass: number) {
  const doc = newTrackDocument();
  doc.track.boxes = [0, 1, 2].map((i) => {
    const b = traxxBoxDefaults();
    b.type = i === 2 && pass === 2 ? TRAXX_BOX_FOG : TRAXX_BOX_LIGHT;
    b.ipos = [1000 + i * 100, 2000, 40];
    b.light.glowMode = 2;
    b.light.allWx = pass > 0 && i === 1 ? 1 : 0;
    return b;
  });
  return doc;
}

for (const pass of [0, 1, 2]) {
  test(`txxtest allwx pass ${pass}: V${pass === 0 ? 3 : 20}, the flag round-trips twice`, () => {
    const doc = lights(pass);
    const a = writeTxx(doc.track);
    assert.equal(header(a), pass === 0 ? "TRAXXV3" : "TRAXXV20");
    const p2 = readTxx(a);
    p2.boxes.forEach((b, i) => {
      assert.equal(b.light.allWx, pass > 0 && i === 1 ? 1 : 0);
      assert.equal(b.light.glowMode, 2);
      assert.equal(b.ipos[0], 1000 + i * 100);
    });
    const b2 = writeTxx(p2);
    assert.equal(header(b2), header(a));
    assert.deepEqual(b2, a);
    readTxx(b2).boxes.forEach((b, i) => assert.equal(b.light.allWx, pass > 0 && i === 1 ? 1 : 0));
  });
}

test("a track whose lights all have allWx clear keeps its old generation and bytes", () => {
  const on = lights(1);
  on.track.boxes[1]!.light.allWx = 0;
  const v3 = writeTxx(on.track);
  assert.equal(header(v3), "TRAXXV3");
  assert.deepEqual(writeTxx(lights(0).track), v3);
  // Turned on, it becomes V20, and V20 reads back with every box's flag.
  on.track.boxes[1]!.light.allWx = 1;
  assert.deepEqual(readTxx(writeTxx(on.track)).boxes.map((b) => b.light.allWx), [0, 1, 0]);
});

test("V24 carries allWx on every box as held, as V20 does (CTrackPODBox::Save)", () => {
  const doc = newTrackDocument(512);
  const lamp = traxxBoxDefaults();
  lamp.type = TRAXX_BOX_LIGHT; lamp.light.allWx = 1;
  const plain = traxxBoxDefaults();
  plain.light.allWx = 1; // not a light: written as held, as Traxx writes the int
  doc.track.boxes = [lamp, plain];
  const txx = writeTxx(doc.track);
  assert.equal(header(txx), "TRAXXV24");
  const back = readTxx(txx);
  assert.deepEqual(back.boxes.map((b) => b.light.allWx), [1, 1]);
  // Without any flag set V24 still carries the field (every block below it is written).
  lamp.light.allWx = 0;
  assert.equal(writeTxx(doc.track).length, txx.length);
});
