/*
  Traxx 1.8.0: KEYFRAME64 models and full-width frame names (eaaace7, tools/podtest's keyframe
  records), and the engine's tree-trunk box (ae75b30, tools/trunktest.cpp vectors A-H, the trap
  flag, the keyframe first frame).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { keyframeCount, keyframeName, keyframeWidth, modelFrameNames, frameNameTooLongForPod, ANIFRAMEPODNAMEMAX } from "../src/core/traxx/keyframe.ts";
import { vegTrunkDerive, vegTrunkFirstFrame, vegTrunkPlace } from "../src/core/traxx/veg-trunk.ts";
import { modelGeometry } from "../src/core/view/model-geometry.ts";

const putInt = (p: Uint8Array, at: number, v: number) => { p[at] = v & 255; p[at + 1] = (v >> 8) & 255; p[at + 2] = (v >> 16) & 255; p[at + 3] = (v >> 24) & 255; };
const putStr = (p: Uint8Array, at: number, s: string) => { for (let i = 0; i < s.length; i++) p[at + i] = s.charCodeAt(i); };

function keyframe(type: 32 | 65, names: string[], n = names.length): Uint8Array {
  const w = type === 32 ? 16 : 64;
  const rec = new Uint8Array(type === 32 ? 344 : 4376);
  putInt(rec, 0, type); putInt(rec, 8, n);
  names.forEach((s, i) => putStr(rec, 24 + i * w, s));
  return rec;
}

test("KEYFRAME: 16-wide names, a full-width name without NUL is whole, upper-cased by GetAniName", () => {
  const rec = keyframe(32, ["cab_0.bin", "SIXTEENCHARS.BIN"]);
  assert.equal(keyframeWidth(rec), 16);
  assert.equal(keyframeCount(rec), 2);
  assert.equal(keyframeName(rec, 1), "SIXTEENCHARS.BIN");
  assert.deepEqual(modelFrameNames(rec), ["CAB_0.BIN", "SIXTEENCHARS.BIN"]);
  assert.equal(keyframeName(rec, 2), null);
});

test("KEYFRAME64: 64-wide names; n clamped to the capacity and to the record's size", () => {
  const long = "A_FRAME_NAME_LONGER_THAN_16.BIN";
  const rec = keyframe(65, ["F0.BIN", long]);
  assert.equal(keyframeWidth(rec), 64);
  assert.deepEqual(modelFrameNames(rec), ["F0.BIN", long]);
  assert.equal(keyframeCount(keyframe(65, [], 100)), 64);
  assert.equal(keyframeCount(keyframe(32, [], 40)), 16);
  assert.equal(keyframeCount(keyframe(32, [], -3)), 0);
  // A record cut short holds only the names wholly inside it.
  assert.equal(keyframeCount(keyframe(65, ["A", "B", "C"]).subarray(0, 24 + 2 * 64 + 10)), 2);
  assert.equal(keyframeWidth(new Uint8Array(20)), 0);
  // The model loader takes both kinds.
  assert.deepEqual(modelGeometry(rec)?.frameNames, ["F0.BIN", long]);
  assert.deepEqual(modelGeometry(keyframe(32, ["X.BIN"]))?.frameNames, ["X.BIN"]);
});

test("a frame name longer than 24 cannot be a MODELS\\ pod entry", () => {
  assert.equal(ANIFRAMEPODNAMEMAX, 24);
  assert.equal(frameNameTooLongForPod("X".repeat(24)), false);
  assert.equal(frameNameTooLongForPod("X".repeat(25)), true);
});

/* trunktest.cpp: MakeTree, BuildModel (power 65535, so a raw int is 1/256 ft), Python's round-half-even. */
function roundEven(v: number): number {
  const f = Math.floor(v), d = v - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return (f & 1) === 0 ? f : f + 1;
}
function tree(r: number, trunkTop: number, R: number, top: number, base: number): Uint8Array {
  const vs: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (2 * Math.PI * i) / 8;
    vs.push([r * Math.cos(a), base, r * Math.sin(a)], [r * Math.cos(a), trunkTop, r * Math.sin(a)], [R * Math.cos(a), trunkTop + 1, R * Math.sin(a)]);
  }
  vs.push([0, top, 0]);
  const out = new Uint8Array(20 + vs.length * 12);
  putInt(out, 0, 20); putInt(out, 4, 65535); putInt(out, 8, 2); putInt(out, 12, 0); putInt(out, 16, vs.length);
  vs.forEach((v, i) => v.forEach((c, k) => putInt(out, 20 + i * 12 + k * 4, roundEven(c * 256))));
  return out;
}

const CASES: [string, number, number, number, number, number, number, number, boolean, number, number, number, number, number, number, number, number, number, number, number][] = [
  ["A pine", 1.0, 5.0, 8.0, 30.0, 0.0, 0, 0, false, 0, 4096, 0, 7680, 2048, 332, 2304, 1.2969, 9.0, 0.0, 0],
  ["B centred, canopy in band", 1.5, -11.0, 10.0, 15.0, -15.0, 0, 0, false, 0, 4096, -3840, 3840, 2560, 3328, 2304, 13.0, 9.0, -15.0, 1],
  ["C canopy at 2 ft", 1.0, 1.0, 8.0, 20.0, 0.0, 0, 0, false, 0, 4096, 0, 5120, 2048, 2662, 1536, 10.3984, 6.0, 0.0, 1],
  ["D tiny shrub-tree", 0.2, 1.0, 1.0, 4.0, 0.0, 0, 0, false, 0, 4096, 0, 1024, 256, 332, 1024, 1.2969, 4.0, 0.0, 0],
  ["E explicit 128 / 160", 1.0, 4.0, 8.0, 30.0, 0.0, 128, 160, false, 0, 4096, 0, 7680, 2048, 512, 2560, 2.0, 10.0, 0.0, 0],
  ["F A at scale 1.5, y 100 ft", 1.0, 5.0, 8.0, 30.0, 0.0, 0, 0, false, 25600, 6144, 0, 7680, 2048, 332, 2304, 1.9453, 13.5, 100.0, 0],
  ["G keyframed, 15%", 1.0, 4.0, 8.0, 30.0, 0.0, 0, 0, true, 0, 4096, 0, 7680, 2048, 614, 2304, 2.3984, 9.0, 0.0, 0],
  ["H explicit height 1 ft", 1.0, 4.0, 8.0, 30.0, 0.0, 0, 16, false, 0, 4096, 0, 7680, 2048, 2662, 1536, 10.3984, 6.0, 0.0, 1],
];

for (const [name, r, tt, R, top, base, ed, eh, kf, treeY, scale, minY, maxY, radius, diam, height, side, h, baseFt, canopy] of CASES) {
  test(`trunktest ${name}`, () => {
    const t = vegTrunkDerive(tree(r, tt, R, top, base), kf, ed, eh);
    assert.ok(t);
    assert.deepEqual([t.minY, t.maxY, t.radius, t.trunkDiam, t.trunkHeight], [minY, maxY, radius, diam, height]);
    const p = vegTrunkPlace(t, treeY, scale);
    assert.ok(Math.abs(p.side - side) <= 0.00005, `side ${p.side}`);
    assert.ok(Math.abs(p.height - h) <= 0.00005, `height ${p.height}`);
    assert.ok(Math.abs(p.base - baseFt) <= 0.00005, `base ${p.base}`);
    assert.equal(t.canopyInBand ? 1 : 0, canopy);
  });
}

test("trunktest edge cases: band / trap flags, explicit, truncated, not MAGNIFY, first frame", () => {
  let t = vegTrunkDerive(tree(1, 5, 8, 30, 0), false, 0, 0)!;
  assert.ok(t.bandUsed && !t.canopyInBand);
  const c = tree(1, 1, 8, 20, 0);
  t = vegTrunkDerive(c, false, 0, 0)!;
  assert.ok(t.bandUsed && t.canopyInBand);
  t = vegTrunkDerive(c, true, 0, 0)!;
  assert.ok(!t.bandUsed && !t.canopyInBand);
  t = vegTrunkDerive(c, false, 128, 0)!;
  assert.ok(!t.derived && !t.bandUsed);
  assert.equal(vegTrunkDerive(c.subarray(0, 10), false, 0, 0), null);
  const bad = c.slice(); putInt(bad, 0, 32);
  assert.equal(vegTrunkDerive(bad, false, 0, 0), null);

  assert.equal(vegTrunkFirstFrame(keyframe(32, ["TREE1_0"], 3)), "TREE1_0");
  const k64 = keyframe(65, ["A_FRAME_NAME_LONGER_THAN_16.BIN"], 2);
  assert.equal(vegTrunkFirstFrame(k64), "A_FRAME_NAME_LONGER_THAN_16.BIN");
  putInt(k64, 0, 20);
  assert.equal(vegTrunkFirstFrame(k64), null);
});

test("vegetation (a2b55ca): the grass cap, the spaced counts, the _G copy of _V", async () => {
  const { VEG_MAX_CLUMPS, VEG_MAX_CLUMPS_PER_TILE, VEG_ENGINE_MAX_CLUMPS } = await import("../src/core/traxx/veg.ts");
  const { spacedInt, vegMasksIdentical, VEG_SAME_MASK_NOTE } = await import("../src/core/edit/veg-planter.ts");
  assert.deepEqual([VEG_MAX_CLUMPS, VEG_ENGINE_MAX_CLUMPS, VEG_MAX_CLUMPS_PER_TILE], [2097152, 2097152, 1024]);
  assert.deepEqual([spacedInt(2097152), spacedInt(500000), spacedInt(999), spacedInt(-1234)], ["2 097 152", "500 000", "999", "-1 234"]);
  const a = { ext: ".PNG", data: Uint8Array.of(1, 2, 3) };
  assert.equal(vegMasksIdentical({ masks: [a, { ext: ".TGA", data: Uint8Array.of(1, 2, 3) }] }), true);
  assert.equal(vegMasksIdentical({ masks: [a, { ext: ".PNG", data: Uint8Array.of(1, 2, 4) }] }), false);
  assert.equal(vegMasksIdentical({ masks: [a, null] }), false);
  assert.ok(VEG_SAME_MASK_NOTE.startsWith("Note: the grass mask (_G) is an exact copy of the tree mask (_V)"));
});
