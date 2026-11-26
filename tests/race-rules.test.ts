/*
  Traxx 1.8.2's race rules (TrackPOD/TrackPODRaceRules.cpp, ApplyRaceRulesCpx and Save in
  TrackPOD/TrackPODFile.cpp, the setters in TrackPOD/TrackPOD.cpp), ported from Traxx's own console
  test tools/racerulestest.cpp: ranking, roles, the validator, the sort, the quantisers, the
  renumbering, the .CPX image (with the FNV-1a hashes the C++ test measured), the parse and its
  refusals, walls and lead-ins.

  Then the five drag templates Traxx 1.8.2 wrote (tests/fixtures/drags): each .CPX is rebuilt from
  its .SI2 boxes, the walls of its .TXX (the V21..V23 tail, TXXTAIL, cut from the template: V21
  mode and laps, the V22 wall block, the V23 lead-ins) and compared byte for byte, then applied
  back to the plain .SI2 track as a pod load does.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CPX_MAX_BOXES, CPX_MAX_SLOTS, TRACKTYPE_CIRCUIT, TRACKTYPE_DRAG, TRACKTYPE_RALLY, TRACKTYPE_RUMBLE,
  applyRaceRulesCpx, buildTrackCpx, clearLeadIns, commitTrackCpx, cpxBuild, cpxBuildEx, cpxFormatLabel, cpxFreeLane, cpxMainCopyIndex,
  cpxParse, cpxQuantPos, cpxQuantPsi, cpxRankSlots, cpxRenumber, cpxRoleForSlot, cpxSortForExport, cpxValidate, decideRaceRulesCpx,
  gatherCpxBoxes, getLeadIn, hasLeadIns, setLeadIn, setRaceRules, setTrackType, sitBoxCpxText,
  type CpxBoxIn, type CpxCourseIn, type CpxWallIn, type RaceTrack,
} from "../src/core/traxx/race-rules.ts";
import {
  CPX_ROLE_FINISH, CPX_ROLE_GATE, CPX_ROLE_LAUNCH, CPX_ROLE_PRESTAGE, CPX_ROLE_STAGE, CPX_SPLIT_ANY, CPX_SPLIT_LANE, CPX_SPLIT_NONE,
  RACERULES_DRAG, RACERULES_NONE, RACERULES_PARALLEL, RACERULES_RACE, WALL_SIDE_INSIDE, WALL_SIDE_OUTSIDE, raceRulesDefaults, type RaceRules,
} from "../src/core/traxx/race-types.ts";
import { decodeWallsBlock, exportWall, type WallExportPoint } from "../src/core/traxx/walls.ts";
import { readTraxxSit, traxxBoxDefaults, TRAXX_BOX_CHECKPOINT, type TraxxBox } from "../src/core/traxx/sit.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "drags");

/** One box; the position text is the same for every box (racerulestest.cpp Box). */
function box(seq: number, split: number, lane: number): CpxBoxIn {
  return { seq, split, lane, sitpos: ["10.000000", "0.000000", "-20.500000"], sitpsi: "1.570796" };
}
const boxes = (n: number, f: (i: number) => [number, number, number]) => Array.from({ length: n }, (_, i) => box(...f(i)));
const plain = (n: number) => boxes(n, (i) => [i, 0, 0]);

const U16 = (p: Uint8Array, o: number) => p[o]! | (p[o + 1]! << 8);
const U32 = (p: Uint8Array, o: number) => (p[o]! | (p[o + 1]! << 8) | (p[o + 2]! << 16) | (p[o + 3]! << 24)) >>> 0;
const S32 = (p: Uint8Array, o: number) => U32(p, o) | 0;
function putU32(p: Uint8Array, o: number, v: number) { p[o] = v & 255; p[o + 1] = (v >>> 8) & 255; p[o + 2] = (v >>> 16) & 255; p[o + 3] = (v >>> 24) & 255; }

function fnv(p: Uint8Array): number {
  let h = 2166136261;
  for (const b of p) h = Math.imul(h ^ b, 16777619) >>> 0;
  return h >>> 0;
}

/** The data offset of a chunk (0 if absent), and its size. */
function findChunk(img: Uint8Array, id: string): [number, number] {
  const n = U32(img, 12);
  for (let i = 0; i < n; i++) {
    const e = 32 + i * 16;
    if (String.fromCharCode(...img.subarray(e, e + 4)) === id) return [U32(img, e + 8), U32(img, e + 12)];
  }
  return [0, 0];
}

function built(r: ReturnType<typeof cpxBuildEx>): Uint8Array {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return (r as { image: Uint8Array }).image;
}
function refused(r: ReturnType<typeof cpxBuildEx>, why: string): boolean {
  return !r.ok && r.error.includes(why);
}
function refusedValidate(mode: number, input: CpxBoxIn[], why: string): boolean {
  const err = cpxValidate(mode, input);
  return err !== null && err.includes("checkpoint") && err.includes(why);
}
function parseErr(img: Uint8Array | null, why: string | null): boolean {
  const r = cpxParse(img);
  return !r.ok && (why === null || r.error.includes(why));
}

test("CpxRankSlots: distinct seqs ascending, holes closed, equal to the O(n^3) definition", () => {
  const r = cpxRankSlots([box(0, 0, 0), box(3, 0, 0), box(3, 0, 0), box(7, 0, 0)]);
  assert.equal(r.count, 3);
  assert.deepEqual(r.slot, [0, 1, 1, 2]);

  const naive = (input: CpxBoxIn[]) => {
    let k = 0;
    const slot = input.map((b, i) => {
      let rank = 0;
      for (let j = 0; j < input.length; j++) {
        if (input[j]!.seq >= input[i]!.seq) continue;
        let s = 0;
        for (; s < j; s++) if (input[s]!.seq === input[j]!.seq) break;
        if (s === j) rank++;
      }
      if (rank + 1 > k) k = rank + 1;
      return rank;
    });
    return { count: k, slot };
  };
  let rng = 12345;
  for (const n of [0, 1, 2, 7, 20, 21, 100, 160, 400, 801, 802]) {
    for (let mod = 1; mod <= (n > 400 ? 64 : 4096); mod *= 8) {
      const input = Array.from({ length: n }, () => {
        rng = (Math.imul(rng, 1103515245) + 12345) >>> 0;
        return box(((rng >>> 8) % mod) - Math.floor(mod / 2), 0, 0);
      });
      assert.deepEqual(cpxRankSlots(input), naive(input));
    }
  }
});

test("CpxRoleForSlot", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => cpxRoleForSlot(RACERULES_DRAG, i, 5)), [1, 2, 3, 5, 4]);
  assert.deepEqual([0, 1, 2].map((i) => cpxRoleForSlot(RACERULES_PARALLEL, i, 3)), [5, 5, 4]);
  assert.equal(cpxRoleForSlot(RACERULES_PARALLEL, 0, 1), CPX_ROLE_FINISH);
  assert.deepEqual([0, 1, 2].map((i) => cpxRoleForSlot(3, i, 3)), [CPX_ROLE_GATE, CPX_ROLE_GATE, CPX_ROLE_FINISH]);
  assert.equal(cpxRoleForSlot(3, 0, 1), CPX_ROLE_FINISH);
});

test("CpxValidate accepts the valid maps", () => {
  assert.equal(cpxValidate(RACERULES_DRAG, plain(4)), null);
  assert.equal(cpxValidate(RACERULES_DRAG, boxes(8, (i) => [i >> 1, 2, 1 + (i & 1)])), null);   // Chicago
  assert.equal(cpxValidate(RACERULES_PARALLEL, plain(1)), null);
  assert.equal(cpxValidate(RACERULES_PARALLEL, [box(0, 0, 0), box(1, 1, 0), box(1, 1, 0), box(1, 1, 0), box(2, 0, 0)]), null);
  // Unsplit start slots with a split-2 gate: rule 7 only binds split starts.
  assert.equal(cpxValidate(RACERULES_DRAG, [box(0, 0, 0), box(1, 0, 0), box(2, 0, 0), box(3, 2, 1), box(3, 2, 2), box(4, 0, 0)]), null);
});

test("CpxValidate refuses with Traxx's messages", () => {
  assert.ok(refusedValidate(RACERULES_DRAG, plain(3), "at least 4"));
  assert.equal(cpxValidate(RACERULES_DRAG, plain(3)), "a drag needs at least 4 checkpoints (pre-stage, stage, launch, finish), this track has 3");
  assert.equal(cpxValidate(RACERULES_PARALLEL, []), "the track has no checkpoint boxes");
  assert.ok(refusedValidate(RACERULES_DRAG, [...plain(4), box(4, 2, 1), box(4, 2, 1)], "per-lane split"));
  assert.ok(refusedValidate(RACERULES_DRAG, [...plain(4), box(4, 2, 1), box(4, 2, 2), box(4, 2, 1)], "per-lane split"));
  assert.equal(cpxValidate(RACERULES_DRAG, [...plain(4), box(4, 2, 1), box(4, 2, 1)]), "checkpoint 5: per-lane split needs exactly one lane 1 and one lane 2 copy");
  const one = plain(4);
  one[3]!.split = 1;
  assert.equal(cpxValidate(RACERULES_DRAG, one), "checkpoint 4: a split checkpoint needs two or more copies");
  assert.equal(cpxValidate(RACERULES_DRAG, [...plain(3), box(3, 0, 0), box(3, 0, 0)]), "checkpoint 4: an unsplit checkpoint needs exactly one box");
  assert.equal(cpxValidate(RACERULES_DRAG, [...plain(3), box(3, 1, 0), box(3, 0, 0)]), "checkpoint 4: its copies do not all have the same split");
  assert.equal(cpxValidate(RACERULES_DRAG, [...boxes(6, (i) => [i >> 1, 2, 1 + (i & 1)]), box(3, 0, 0), box(4, 2, 1), box(4, 2, 2)]),
    "checkpoint 4: with per-lane starts every checkpoint must be split per lane, one copy for each lane");
  assert.equal(cpxValidate(RACERULES_DRAG, [box(0, 2, 1), box(0, 2, 2), box(1, 0, 0), box(2, 0, 0), box(3, 0, 0)]),
    "the pre-stage, stage and launch checkpoints must all be split per lane, or none of them");
  assert.equal(cpxValidate(RACERULES_DRAG, [box(0, 0, 0), box(1, 1, 0), box(1, 1, 0), box(2, 0, 0), box(3, 0, 0)]),
    "checkpoint 2: a pre-stage, stage or launch checkpoint is split per lane or not split at all, never as any copy");

  // The cap is 100 slots: 100 pass, 101 are refused.
  assert.equal(CPX_MAX_SLOTS, 100);
  assert.equal(CPX_MAX_BOXES, 800);
  for (const mode of [RACERULES_DRAG, RACERULES_PARALLEL, RACERULES_RACE]) assert.equal(cpxValidate(mode, plain(100)), null);
  assert.equal(cpxValidate(RACERULES_DRAG, plain(101)), "101 checkpoints is too many (at most 100)");
  // The box cap is 800 (100 slots of 8 copies).
  const big = boxes(800, (i) => [i >> 3, 1, 0]);
  assert.equal(cpxValidate(RACERULES_RACE, big), null);
  assert.equal(cpxValidate(RACERULES_RACE, [...big, box(100, 1, 0)]), "801 checkpoint boxes is too many (at most 100 slots of 8 copies)");
  assert.equal(cpxValidate(RACERULES_DRAG, [...plain(4), ...boxes(9, () => [4, 1, 0])]), "checkpoint 5: 9 copies is too many (at most 8)");
  assert.equal(cpxValidate(RACERULES_DRAG, [box(0, 0, 0), box(1, 0, 0), box(2, 1, 0), box(3, 0, 0), box(2, 1, 0), box(4, 0, 0)]),
    "checkpoint 3: its copies are not next to each other in the box order");
  assert.equal(cpxValidate(3, plain(4)), null);
  assert.equal(cpxValidate(0, plain(4)), "unknown race rules mode 0, so the checkpoints cannot be checked");
  assert.equal(cpxValidate(RACERULES_DRAG, [...plain(4), box(4, 7, 0)]), "checkpoint 5: unknown split 7");
});

test("CpxSortForExport: by (slot, lane), stable", () => {
  const input = [box(5, 2, 2), box(2, 0, 0), box(5, 2, 1), box(9, 0, 0)];
  const order = cpxSortForExport(input);
  assert.deepEqual(input.map((b) => [b.seq, b.lane]), [[2, 0], [5, 1], [5, 2], [9, 0]]);
  assert.deepEqual(order, [1, 2, 0, 3]);
  const same = [box(1, 1, 0), box(1, 1, 0)];
  same[0]!.sitpsi = "A";
  same[1]!.sitpsi = "B";
  assert.deepEqual(cpxSortForExport(same), [0, 1]);
  assert.equal(same[0]!.sitpsi, "A");
});

test("CpxQuantPos / CpxQuantPsi: halves away from zero, psi wrapped", () => {
  assert.equal(cpxQuantPos("12.500000"), 3200);
  assert.equal(cpxQuantPos("-0.003906"), -1);
  assert.equal(cpxQuantPos("0.001953"), 0);
  assert.equal(cpxQuantPos("0.001954"), 1);
  assert.equal(cpxQuantPos("-0.001954"), -1);
  assert.equal(cpxQuantPos("0.001953125"), 1);
  assert.equal(cpxQuantPos("-0.001953125"), -1);
  assert.equal(cpxQuantPsi("3.141593"), 32768);
  assert.equal(cpxQuantPsi("-1.570796"), 49152);
  assert.equal(cpxQuantPsi("0.000000"), 0);
  assert.equal(cpxQuantPsi("6.283185"), 0);
  assert.equal(cpxQuantPsi("7.853982"), 16384);
});

test("the .CPX image: header, directory, RULE and CPBX bytes", () => {
  const img = built(cpxBuild(RACERULES_DRAG, 1, plain(4)));
  assert.equal(String.fromCharCode(...img.subarray(0, 4)), "MCPX");
  assert.ok(U16(img, 4) === 1 && U16(img, 6) === 0 && U32(img, 8) === 32 && U32(img, 12) === 2 && U32(img, 16) === 0);
  assert.equal(img.length, U32(img, 56) + U32(img, 60));
  assert.equal(U32(img, 40), 64);
  assert.equal(U32(img, 56), 96);
  assert.equal(U32(img, 60), 8 + 4 * 24);
  const rule = U32(img, 40);
  assert.deepEqual([U16(img, rule), U16(img, rule + 2), U32(img, rule + 4), U32(img, rule + 8), U32(img, rule + 12), U32(img, rule + 16)], [1, 1, 0, 5000, 1000, 0]);
  const cpbx = U32(img, 56);
  assert.ok(U32(img, cpbx) === 4 && U16(img, cpbx + 4) === 24);
  const rec = cpbx + 8 + 3 * 24;
  assert.deepEqual([U16(img, rec), img[rec + 2], img[rec + 3], img[rec + 4], img[rec + 5], U16(img, rec + 6)], [3, 4, 0, 0, 1, 16384]);
  assert.deepEqual([S32(img, rec + 8), S32(img, rec + 12), S32(img, rec + 16), U32(img, rec + 20)], [2560, 0, -5248, 0]);
  assert.ok(img[cpbx + 8 + 2] === 1 && img[cpbx + 8 + 5] === 1);   // pre-stage is painted

  assert.equal(U16(built(cpxBuild(RACERULES_DRAG, 0, plain(4))), 64 + 2), 0);   // a looped drag
  const par = built(cpxBuild(RACERULES_PARALLEL, 0, plain(3)));
  assert.ok(U16(par, 64) === 2 && par[96 + 8 + 2] === 5 && par[96 + 8 + 5] === 0 && par[96 + 8 + 48 + 2] === 4 && par[96 + 8 + 48 + 5] === 1);
  const ch = built(cpxBuild(RACERULES_DRAG, 0, boxes(8, (i) => [i >> 1, 2, 1 + (i & 1)])));
  assert.ok(ch[96 + 8 + 3] === 2 && ch[96 + 8 + 4] === 1 && ch[96 + 8 + 24 + 3] === 2 && ch[96 + 8 + 24 + 4] === 2);

  assert.ok(refused(cpxBuild(RACERULES_DRAG, 2, plain(4)), "lap setting"));
  assert.ok(refused(cpxBuild(RACERULES_DRAG, -1, plain(4)), "lap setting"));
  assert.ok(refused(cpxBuild(RACERULES_PARALLEL, 1, plain(3)), "lap setting"));
  assert.deepEqual(cpxBuild(RACERULES_PARALLEL, 2, plain(3)), { ok: false, error: "a Parallel race's lap setting must be 0, not 2" });
  assert.deepEqual(cpxBuild(RACERULES_DRAG, 2, plain(4)), { ok: false, error: "a drag's lap setting must be one run (1) or looped (0), not 2" });
  assert.ok(refused(cpxBuild(RACERULES_DRAG, 1, plain(3)), "at least 4"));
});

test("the image without walls is the one measured before walls existed (200 bytes, FNV-1a)", () => {
  const a = built(cpxBuild(RACERULES_DRAG, 1, plain(4)));
  assert.deepEqual(built(cpxBuildEx(RACERULES_DRAG, 1, plain(4), null, null, null)), a);
  assert.equal(a.length, 200);
  assert.equal(fnv(a), 848673821);
});

test("mode 3: gates and a finish, no lines, no penalties; refusals", () => {
  const input = [box(0, CPX_SPLIT_NONE, 0), box(1, CPX_SPLIT_ANY, 0), box(1, CPX_SPLIT_ANY, 0), box(2, CPX_SPLIT_NONE, 0)];
  const img = built(cpxBuild(3, 0, input));
  const rule = U32(img, 40), cpbx = U32(img, 56);
  assert.ok(U16(img, rule) === 3 && U16(img, rule + 2) === 0);
  for (let i = 4; i < 32; i++) assert.equal(img[rule + i], 0);
  assert.deepEqual([0, 1, 2, 3].map((i) => img[cpbx + 8 + 24 * i + 2]), [5, 5, 5, 4]);
  for (let i = 0; i < 4; i++) assert.ok(img[cpbx + 8 + 24 * i + 5] === 0 && img[cpbx + 8 + 24 * i + 4] === 0);
  assert.ok(img[cpbx + 8 + 24 + 3] === 1 && img[cpbx + 8 + 3] === 0);
  const p = cpxParse(img);
  assert.ok(p.ok);
  assert.ok(p.parsed.mode === 3 && p.parsed.laps === 0 && p.parsed.boxes.length === 4 && p.parsed.walls.length === 0);
  assert.ok(p.parsed.boxes[1]!.split === 1 && p.parsed.boxes[2]!.slot === 1 && p.parsed.boxes[3]!.role === CPX_ROLE_FINISH && p.parsed.boxes[0]!.role === CPX_ROLE_GATE);

  assert.deepEqual(cpxBuild(3, 1, input), { ok: false, error: "a race with race rules has no lap setting of its own (it must be 0), not 1" });
  assert.deepEqual(cpxBuild(3, 0, [input[0]!, box(1, CPX_SPLIT_LANE, 1), box(1, CPX_SPLIT_LANE, 2), input[3]!]),
    { ok: false, error: "checkpoint 2: a race with race rules has no lanes, so a checkpoint cannot be split per lane" });
  assert.ok(cpxValidate(3, [box(0, CPX_SPLIT_NONE, 1), ...input.slice(1)])!.includes("lane"));
  assert.ok(cpxValidate(3, [box(0, 0, 0), box(1, CPX_SPLIT_ANY, 0), box(1, CPX_SPLIT_ANY, 2), box(2, 0, 0)])!.includes("lane"));   // the second copy
  assert.notEqual(cpxValidate(3, []), null);
  assert.deepEqual(cpxBuildEx(3, 0, input, null, null, [{ course: 2, firstpass: 1, thencourse: 0 }]),
    { ok: false, error: "COUR: lead-ins are not allowed in mode 3 (a race with race rules)" });
});

test("a mode-3 file carrying WALL / WPNT, or a drag image patched to mode 3, is refused", () => {
  const w: CpxWallIn[] = [{ name: "w", side: 0, closed: 0, noline: 0, thickness: 256, height: 256, first: 0, count: 2 }];
  const pts: WallExportPoint[] = [{ x: 0, z: 0, baseY: 0, bend: 0, above: 0, gap: 0 }, { x: 2560, z: 0, baseY: 0, bend: 0, above: 0, gap: 0 }];
  const img = built(cpxBuildEx(RACERULES_PARALLEL, 0, plain(4), w, pts)).slice();
  const rule = U32(img, 40);
  img[rule] = 3;
  putU32(img, rule + 8, 0);
  putU32(img, rule + 12, 0);
  assert.deepEqual(cpxParse(img), { ok: false, error: "a race with race rules cannot carry WALL or WPNT chunks (walls are not part of a race)" });
});

test("CpxRenumber, CpxFreeLane, CpxMainCopyIndex, CpxFormatLabel", () => {
  let r = cpxRenumber([5, 5, 2, 9], [2, 1, 0, 0], false);
  assert.deepEqual(r, { count: 3, order: [2, 1, 0, 3], newseq: [0, 1, 1, 2] });
  r = cpxRenumber([1, 1, 1], [0, 0, 0], false);
  assert.deepEqual(r, { count: 1, order: [0, 1, 2], newseq: [0, 0, 0] });
  r = cpxRenumber([1, 1, 1], [0, 0, 0], true);
  assert.deepEqual(r, { count: 3, order: [0, 1, 2], newseq: [0, 1, 2] });
  r = cpxRenumber([0, 1, 1001, 1000], [0, 0, 0, 0], false);
  assert.ok(r.count === 4 && r.order[2] === 3 && r.order[3] === 2 && r.newseq[3] === 3);
  assert.equal(cpxRenumber([], [], false).count, 0);

  assert.equal(cpxFreeLane([1], 1), 2);
  assert.equal(cpxFreeLane([1], 2), 2);
  assert.equal(cpxFreeLane([2], 2), 1);
  assert.equal(cpxFreeLane([2], 1), 1);
  assert.equal(cpxFreeLane([], 0), 1);
  assert.equal(cpxFreeLane([1, 2], 1), 1);
  assert.equal(cpxFreeLane([0], 0), 1);

  const ids = [0, 1, 1, 2, 1];
  assert.deepEqual([1, 0, 2, 7].map((s) => cpxMainCopyIndex(ids, s)), [1, 0, 3, -1]);
  assert.equal(cpxMainCopyIndex([], 0), -1);

  assert.equal(cpxFormatLabel(3, CPX_ROLE_FINISH, CPX_SPLIT_LANE, 2), "CP 03 FIN L2");
  assert.equal(cpxFormatLabel(0, CPX_ROLE_PRESTAGE, CPX_SPLIT_LANE, 1), "CP 00 PS L1");
  assert.equal(cpxFormatLabel(1, CPX_ROLE_STAGE, CPX_SPLIT_ANY, 1), "CP 01 ST");
  assert.equal(cpxFormatLabel(2, CPX_ROLE_LAUNCH, CPX_SPLIT_NONE, 0), "CP 02 LA");
  assert.equal(cpxFormatLabel(12, CPX_ROLE_GATE, CPX_SPLIT_NONE, 0), "CP 12 G");
  assert.ok(cpxFormatLabel(19, CPX_ROLE_FINISH, CPX_SPLIT_LANE, 2).length < 16);
  assert.equal(cpxFormatLabel(99, CPX_ROLE_FINISH, CPX_SPLIT_LANE, 2), "CP 99 FIN L2");
  assert.equal(cpxFormatLabel(5, CPX_ROLE_GATE, CPX_SPLIT_NONE, 0, 4), "CP ");
});

test("CpxParse: a round trip, and Traxx's refusals in Traxx's words", () => {
  const input = [box(0, CPX_SPLIT_LANE, 1), box(0, CPX_SPLIT_LANE, 2), box(1, CPX_SPLIT_ANY, 0), box(1, CPX_SPLIT_ANY, 0), box(2, CPX_SPLIT_NONE, 0)];
  input[1]!.sitpos[0] = "-3.250000";
  input[3]!.sitpsi = "-0.500000";
  const rt = cpxParse(built(cpxBuild(RACERULES_PARALLEL, 0, input)));
  assert.ok(rt.ok);
  assert.ok(rt.parsed.mode === RACERULES_PARALLEL && rt.parsed.laps === 0 && rt.parsed.boxes.length === 5);
  rt.parsed.boxes.forEach((b, i) => {
    assert.equal(b.slot, i < 2 ? 0 : i < 4 ? 1 : 2);
    assert.equal(b.split, input[i]!.split);
    assert.equal(b.lane, input[i]!.split === CPX_SPLIT_LANE ? input[i]!.lane : 0);
    assert.deepEqual([b.fx, b.fy, b.fz, b.fpsi], [...input[i]!.sitpos.map(cpxQuantPos), cpxQuantPsi(input[i]!.sitpsi)]);
  });
  assert.ok(rt.parsed.boxes[4]!.role === CPX_ROLE_FINISH && rt.parsed.boxes[0]!.role === CPX_ROLE_GATE);
  assert.ok(rt.parsed.walls.length === 0 && rt.parsed.points.length === 0);

  const img = built(cpxBuild(RACERULES_DRAG, 1, plain(4)));
  const bad = (edit: (b: Uint8Array) => void) => { const b = img.slice(); edit(b); return b; };
  const err = (b: Uint8Array | null) => { const r = cpxParse(b); return r.ok ? "" : r.error; };
  assert.equal(err(bad((b) => b.set([88], 0))), "it is not a race-rules file");
  assert.equal(err(bad((b) => { b[4] = 2; })), "it was written by a newer version of the tools");
  assert.equal(err(bad((b) => b.set([90, 90, 90, 90], 48))), "it has no CPBX chunk");
  assert.equal(err(bad((b) => b.set([90, 90, 90, 90], 32))), "it has no RULE chunk");
  assert.equal(err(bad((b) => putU32(b, 36, 2))), "its RULE chunk is version 2, which this version does not know");
  assert.equal(err(bad((b) => putU32(b, 52, 9))), "its CPBX chunk is version 9, which this version does not know");
  assert.equal(err(bad((b) => { b[64] = 3; })), "a race with race rules has no lap setting of its own (it must be 0), not 1");
  assert.equal(err(bad((b) => { b[64] = 9; })), "it asks for race mode 9, which this version does not know");
  assert.equal(err(bad((b) => { b[66] = 2; })), "a drag's lap setting must be one run (1) or looped (0), not 2");
  assert.ok(!parseErr(bad((b) => { b[66] = 0; }), null));
  assert.equal(err(bad((b) => { b[64] = 2; })), "a Parallel race's lap setting must be 0, not 1");
  assert.ok(!parseErr(bad((b) => { b[64] = 2; b[66] = 0; }), null));
  assert.equal(err(bad((b) => { b[64] = 3; b[66] = 0; })), "a race with race rules must have no time-out and no wall penalty");
  assert.equal(err(img.subarray(0, 20)), "it is not a race-rules file");
  assert.equal(err(img.subarray(0, 40)), "its chunk directory is cut short");
  assert.equal(err(img.subarray(0, img.length - 10)), "its CPBX chunk is cut short");
  assert.equal(err(null), "the file is empty");
  assert.equal(err(bad((b) => putU32(b, 96, 400))), "its checkpoint map is cut short");
  assert.equal(err(bad((b) => putU32(b, 96, 900))), "it has 900 checkpoint boxes, more than the 800 allowed");
  assert.equal(err(bad((b) => { b[100] = 20; })), "its checkpoint map is cut short");
});

test("CpxParse: unknown chunks are skipped and the first RULE wins", () => {
  const img = built(cpxBuild(RACERULES_DRAG, 1, plain(4)));
  const bodyLen = img.length - (32 + 32);
  const dir = 32 + 64;
  const big = new Uint8Array(dir + bodyLen + 32);
  big.set(img.subarray(0, 32));
  putU32(big, 12, 4);
  big.set(img.subarray(64), dir);
  const entry = (k: number, id: string, ver: number, off: number, size: number) => {
    const e = 32 + 16 * k;
    for (let i = 0; i < 4; i++) big[e + i] = id.charCodeAt(i);
    putU32(big, e + 4, ver); putU32(big, e + 8, off); putU32(big, e + 12, size);
  };
  entry(0, "RULE", 1, dir, 32);
  entry(1, "ZZZZ", 7, dir, 4);
  entry(2, "CPBX", 1, dir + 32, bodyLen - 32);
  entry(3, "RULE", 1, dir + bodyLen, 32);
  big.copyWithin(dir + bodyLen, dir, dir + 32);
  big[dir + bodyLen + 2] = 0;   // the duplicate RULE: laps 0, which must lose
  const p = cpxParse(big);
  assert.ok(p.ok && p.parsed.mode === RACERULES_DRAG && p.parsed.laps === 1 && p.parsed.boxes.length === 4);
});

// ---- walls and lead-ins in the image ----

function squareFixture(): { input: CpxBoxIn[]; w: CpxWallIn[]; pts: WallExportPoint[] } {
  return {
    input: plain(4),
    w: [{ name: "pit wall", side: WALL_SIDE_INSIDE, closed: 1, noline: 0, thickness: 256, height: 2048, first: 0, count: 4 }],
    pts: [
      { x: 0, z: 0, baseY: 100, bend: 0, above: 5, gap: 0 }, { x: 2560, z: 0, baseY: 200, bend: 300, above: 6, gap: 1 },
      { x: 2560, z: 2560, baseY: 300, bend: -400, above: 7, gap: 0 }, { x: 0, z: 2560, baseY: 400, bend: 0, above: 8, gap: 0 },
    ],
  };
}
const wallIn = (name: string, first: number, count: number, extra: Partial<CpxWallIn> = {}): CpxWallIn =>
  ({ name, side: 0, closed: 0, noline: 0, thickness: 256, height: 256, first, count, ...extra });
const pt = (x: number, z: number, baseY = 0, bend = 0, above = 0, gap = 0): WallExportPoint => ({ x, z, baseY, bend, above, gap });
const wallRefused = (mode: number, w: CpxWallIn[] | null, pts: WallExportPoint[] | null, why: string, nwalls?: number) =>
  refused(cpxBuildEx(mode, mode === RACERULES_DRAG ? 1 : 0, plain(4), w, pts, null, nwalls), why);

test("walls: the golden image (392 bytes, FNV-1a measured before COUR existed) and its bytes", () => {
  const { input, w, pts } = squareFixture();
  const img = built(cpxBuildEx(RACERULES_DRAG, 1, input, w, pts));
  assert.equal(img.length, 392);
  assert.equal(fnv(img), 2419672184);
  assert.deepEqual(built(cpxBuildEx(RACERULES_DRAG, 1, input, w, pts, [])), img);

  assert.equal(U32(img, 12), 4);
  assert.deepEqual(["RULE", "CPBX", "WALL", "WPNT"].map((id, k) => String.fromCharCode(...img.subarray(32 + 16 * k, 36 + 16 * k))), ["RULE", "CPBX", "WALL", "WPNT"]);
  const [cpbxOff, cpbxSize] = findChunk(img, "CPBX");
  const [off, size] = findChunk(img, "WALL");
  assert.ok(off === cpbxOff + cpbxSize && size === 56);
  const r = off + 8;
  assert.equal(String.fromCharCode(...img.subarray(r, r + 8)), "pit wall");
  assert.ok(img[r + 20] === 0 && img[r + 31] === 0);
  assert.deepEqual([U32(img, r + 32), U16(img, r + 36), img[r + 38], img[r + 39], U32(img, r + 40), U32(img, r + 44)], [0, 4, 1, 1, 256, 2048]);
  const [po, ps] = findChunk(img, "WPNT");
  assert.ok(ps === 8 + 4 * 24 && img.length === po + ps);
  const p2 = po + 8 + 24;
  assert.deepEqual([S32(img, p2), S32(img, p2 + 4), S32(img, p2 + 8), S32(img, p2 + 12), S32(img, p2 + 16), img[p2 + 20], img[p2 + 21]], [2560, 0, 200, 300, 6, 1, 0]);
  assert.deepEqual([S32(img, p2 + 24 + 12), S32(img, p2 + 24 + 16), img[p2 + 24 + 20]], [-400, 7, 0]);
  assert.equal(S32(img, po + 8 + 8), 100);

  const open = squareFixture();
  open.w[0] = { ...open.w[0]!, closed: 0, noline: 1, side: WALL_SIDE_OUTSIDE };
  const o2 = built(cpxBuildEx(RACERULES_PARALLEL, 0, open.input, open.w, open.pts));
  const r2 = findChunk(o2, "WALL")[0] + 8;
  assert.ok(o2[r2 + 38] === 2 && o2[r2 + 39] === 2);
});

test("walls: the build's refusals", () => {
  let f = squareFixture();
  assert.ok(wallRefused(RACERULES_DRAG, f.w, f.pts.slice(0, 1), "pit wall"));
  f.w[0]!.count = 1;
  assert.deepEqual(cpxBuildEx(RACERULES_DRAG, 1, f.input, f.w, f.pts.slice(0, 1)), { ok: false, error: "wall \"pit wall\": it has 1 point(s), at least 2 are needed" });
  f = squareFixture();
  f.w[0]!.count = 2;
  assert.deepEqual(cpxBuildEx(RACERULES_DRAG, 1, f.input, f.w, f.pts.slice(0, 2)), { ok: false, error: "wall \"pit wall\": a closed wall needs at least 3 points, it has 2" });
  f.w[0]!.closed = 0;
  assert.ok(cpxBuildEx(RACERULES_DRAG, 1, f.input, f.w, f.pts.slice(0, 2)).ok);   // open with 2 is fine

  f = squareFixture();
  f.pts[1]!.bend = 1281;
  f.pts[0]!.bend = 1281;
  assert.deepEqual(cpxBuildEx(RACERULES_DRAG, 1, f.input, f.w, f.pts),
    { ok: false, error: "wall \"pit wall\": the bend at point 1 is 1281, more than half its chord (1280), which is the most an arc can bend" });
  f.pts[0]!.bend = 1280;
  f.pts[1]!.bend = -1280;
  assert.ok(cpxBuildEx(RACERULES_DRAG, 1, f.input, f.w, f.pts).ok);   // exactly the limit
  // the floor of chord / 2: (0,0)-(3,4) is 5, so 2
  assert.ok(wallRefused(RACERULES_DRAG, [wallIn("tiny", 0, 2)], [pt(0, 0, 0, 3), pt(3, 4)], "tiny"));
  assert.ok(wallRefused(RACERULES_DRAG, [wallIn("tiny", 0, 2)], [pt(0, 0, 0, -3), pt(3, 4)], "bend"));
  f = squareFixture();
  f.pts[3]!.bend = 1281;
  assert.ok(wallRefused(RACERULES_DRAG, f.w, f.pts, "bend"));   // the closing stretch counts
  f.w[0]!.closed = 0;
  f.pts[3]!.bend = 99999;
  assert.ok(cpxBuildEx(RACERULES_DRAG, 1, f.input, f.w, f.pts).ok);   // the last bend of an open wall is ignored

  f = squareFixture();
  f.w[0]!.height = 0;
  assert.ok(wallRefused(RACERULES_DRAG, f.w, f.pts, "height"));
  f = squareFixture();
  f.w[0]!.thickness = 0;
  assert.deepEqual(cpxBuildEx(RACERULES_DRAG, 1, f.input, f.w, f.pts), { ok: false, error: "wall \"pit wall\": its thickness must be greater than 0" });
  f = squareFixture();
  assert.deepEqual(cpxBuildEx(3, 0, f.input, f.w, f.pts), { ok: false, error: "walls are not allowed in mode 3 (a race with race rules)" });
  f.w[0]!.side = 3;
  assert.ok(wallRefused(RACERULES_DRAG, f.w, f.pts, "unknown side 3"));

  f = squareFixture();
  f.w[0]!.count = 5;
  assert.deepEqual(cpxBuildEx(RACERULES_DRAG, 1, f.input, f.w, f.pts), { ok: false, error: "wall \"pit wall\": its points run past the end of the point list" });
  const two = [wallIn("a", 0, 2), wallIn("b", 1, 2)];
  assert.deepEqual(cpxBuildEx(RACERULES_DRAG, 1, f.input, two, f.pts),
    { ok: false, error: "wall \"b\": its points overlap another wall's or leave a gap (they must follow the previous wall's)" });
  two[1]!.first = 3;
  assert.ok(wallRefused(RACERULES_DRAG, two, f.pts, "\"b\""));
  assert.ok(wallRefused(RACERULES_DRAG, two.slice(0, 1), null, "\"a\""));
  assert.ok(wallRefused(RACERULES_DRAG, [wallIn("a", 0, 2)], f.pts, "the wall points are 4 but the walls use 2"));
  assert.ok(wallRefused(RACERULES_DRAG, null, f.pts, "2 walls were given but no wall list", 2));
});

test("walls: the caps", () => {
  const w65 = Array.from({ length: 65 }, (_, i) => wallIn("w", i * 2, 2));
  const p130 = Array.from({ length: 130 }, (_, i) => pt((i >> 1) * 512 + (i & 1) * 256, 0));
  assert.ok(wallRefused(RACERULES_DRAG, w65, p130, "65 walls is too many (at most 64)"));
  assert.ok(cpxBuildEx(RACERULES_DRAG, 1, plain(4), w65.slice(0, 64), p130.slice(0, 128)).ok);
  const line = Array.from({ length: 9300 }, (_, i) => pt(i * 256, 0));
  assert.ok(wallRefused(RACERULES_DRAG, [wallIn("long", 0, 1025)], line.slice(0, 1025), "1024"));
  assert.ok(cpxBuildEx(RACERULES_DRAG, 1, plain(4), [wallIn("long", 0, 1024)], line.slice(0, 1024)).ok);
  assert.ok(wallRefused(RACERULES_DRAG, Array.from({ length: 9 }, (_, i) => wallIn("big", i * 1024, 1024)), line.slice(0, 9216), "9216 wall points is too many (at most 8192 in all)"));
});

test("lead-ins: the COUR bytes and the build's refusals", () => {
  const c: CpxCourseIn[] = [{ course: 2, firstpass: 1, thencourse: 0 }, { course: 3, firstpass: 1, thencourse: 1 }];
  const img = built(cpxBuildEx(RACERULES_DRAG, 1, plain(4), null, null, c));
  const plainImg = built(cpxBuild(RACERULES_DRAG, 1, plain(4)));
  assert.equal(U32(img, 12), 3);
  assert.equal(String.fromCharCode(...img.subarray(64, 68)), "COUR");
  const [cpbxOff, cpbxSize] = findChunk(img, "CPBX");
  const [off, size] = findChunk(img, "COUR");
  assert.ok(off === cpbxOff + cpbxSize && size === 24 && img.length === off + size);
  assert.deepEqual([...img.subarray(off, off + 24)], [2, 0, 0, 0, 8, 0, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 3, 1, 1, 0, 0, 0, 0, 0]);
  assert.equal(U32(plainImg, 12), 2);
  assert.deepEqual(img.subarray(cpbxOff, cpbxOff + cpbxSize), plainImg.subarray(findChunk(plainImg, "CPBX")[0], findChunk(plainImg, "CPBX")[0] + cpbxSize));
  assert.ok(cpxBuildEx(RACERULES_PARALLEL, 0, plain(4), null, null, c.slice(0, 1)).ok);

  const courRefused = (mode: number, cs: CpxCourseIn[], why: string) => refused(cpxBuildEx(mode, mode === RACERULES_DRAG ? 1 : 0, plain(4), null, null, cs), why);
  const C = (course: number, firstpass: number, thencourse: number): CpxCourseIn => ({ course, firstpass, thencourse });
  assert.ok(courRefused(RACERULES_DRAG, [C(1, 1, 0)], "COUR: course 1 is Lane 2's own course and cannot be a lead-in"));
  assert.ok(courRefused(RACERULES_PARALLEL, [C(0, 1, 1)], "COUR"));
  assert.ok(courRefused(RACERULES_DRAG, [C(2, 1, 0), C(3, 1, 0)], "COUR: two lead-ins for Lane 1"));
  assert.ok(courRefused(RACERULES_DRAG, [C(2, 1, 1), C(3, 1, 1)], "Lane 2"));
  assert.ok(courRefused(RACERULES_DRAG, [C(2, 1, 2)], "COUR: course 2 leads to course 2, but a lead-in must lead to course 0 or 1"));
  assert.ok(courRefused(RACERULES_DRAG, [C(5, 1, 0)], "COUR: course 5 does not exist (0..4)"));
  assert.ok(courRefused(RACERULES_DRAG, [C(-1, 1, 0)], "COUR"));
  assert.ok(courRefused(RACERULES_DRAG, [C(2, 1, 0), C(2, 1, 1)], "COUR: course 2 is listed twice"));
  assert.ok(courRefused(RACERULES_DRAG, [C(2, 0, 0)], "COUR: course 2 is not marked first pass only"));
  assert.ok(courRefused(3, [C(2, 1, 0)], "mode 3"));
  assert.ok(cpxBuild(3, 0, plain(4)).ok);

  const { input, w, pts } = squareFixture();
  const both = built(cpxBuildEx(RACERULES_DRAG, 1, input, w, pts, [C(2, 1, 0)]));
  assert.equal(U32(both, 12), 5);
  assert.equal(String.fromCharCode(...both.subarray(96, 100)), "COUR");
  const [wo, ws] = findChunk(both, "WPNT");
  const [co, cs] = findChunk(both, "COUR");
  assert.ok(co === wo + ws && both.length === co + cs);
});

test("a mode-3 file with a valid COUR from another tool still parses", () => {
  const img = built(cpxBuildEx(RACERULES_DRAG, 1, plain(4), null, null, [{ course: 2, firstpass: 1, thencourse: 0 }])).slice();
  const rule = U32(img, 40), cpbx = U32(img, 56);
  img[rule] = 3;
  img.fill(0, rule + 1, rule + 16);
  for (let i = 0; i < 4; i++) {
    img[cpbx + 8 + 24 * i + 2] = i < 3 ? 5 : 4;
    img[cpbx + 8 + 24 * i + 5] = 0;
  }
  const p = cpxParse(img);
  assert.ok(p.ok && p.parsed.mode === 3 && p.parsed.laps === 0 && p.parsed.boxes.length === 4 && p.parsed.walls.length === 0);
  assert.equal(p.parsed.courses.length, 1);
});

test("CpxParse: COUR defects never fail the parse", () => {
  const img = built(cpxBuildEx(RACERULES_DRAG, 1, plain(4), null, null, [{ course: 2, firstpass: 1, thencourse: 0 }, { course: 4, firstpass: 1, thencourse: 1 }])).slice();
  const off = findChunk(img, "COUR")[0];
  const parse = () => { const r = cpxParse(img); assert.ok(r.ok); return r.parsed; };
  let p = parse();
  assert.deepEqual(p.courses, [{ course: 2, firstpass: 1, thencourse: 0 }, { course: 4, firstpass: 1, thencourse: 1 }]);
  assert.ok(!p.courseBad && p.courseNote === "" && p.boxes.length === 4);
  const noCour = cpxParse(built(cpxBuild(RACERULES_DRAG, 1, plain(4))));
  assert.ok(noCour.ok && noCour.parsed.courses.length === 0 && !noCour.parsed.courseBad);

  img[off + 8 + 8 + 2] = 0;
  p = parse();
  assert.ok(p.courses.length === 0 && p.courseBad && p.courseNote === "two lead-ins for Lane 1" && p.boxes.length === 4 && p.laps === 1);
  img[off + 8 + 8 + 2] = 1;
  img[off + 8] = 1;
  p = parse();
  assert.ok(p.courses.length === 0 && p.courseBad && p.courseNote === "course 1 is Lane 2's own course and cannot be a lead-in");
  img[off + 8] = 7;
  assert.equal(parse().courseNote, "course 7 does not exist (0..4)");
  img[off + 8] = 2;
  img[off + 8 + 2] = 2;
  assert.ok(parse().courseBad);
  img[off + 8 + 2] = 0;
  img[off + 8 + 1] = 0;   // a flags-0 record is valid but no lead-in: skipped
  p = parse();
  assert.ok(p.courses.length === 1 && !p.courseBad && p.courses[0]!.course === 4);
  img[off + 8 + 2] = 1;   // and it does not count towards "two lead-ins"
  p = parse();
  assert.ok(p.courses.length === 1 && !p.courseBad);
  img[off + 8 + 2] = 0;
  img[off + 8 + 1] = 1;
  img[off + 4] = 4;
  assert.equal(parse().courseNote, "its COUR record list is cut short");
  img[off + 4] = 8;

  const big = new Uint8Array(img.length + 8);
  big.set(img);
  big[off + 4] = 12;
  big[64 + 12] = 8 + 2 * 12;
  big.fill(0xee, off + 8, off + 32);
  big.set([2, 0xff, 0], off + 8);
  big.set([4, 1, 1], off + 8 + 12);
  const bp = cpxParse(big);
  assert.ok(bp.ok && bp.parsed.courses.length === 2 && !bp.parsed.courseBad);
  assert.deepEqual(bp.parsed.courses.map((c) => [c.course, c.thencourse]), [[2, 0], [4, 1]]);

  img[64 + 4] = 2;
  assert.equal(parse().courseNote, "its COUR chunk is version 2, which this version does not know");
  img[64 + 4] = 1;
  img[64 + 12] = 0xff; img[64 + 13] = 0xff;
  assert.equal(parse().courseNote, "its COUR chunk is cut short");
  img[64 + 12] = 24; img[64 + 13] = 0;
  img[off] = 200;
  assert.equal(parse().courseNote, "200 lead-ins, at most 5 courses exist");
  img[off] = 2;
  p = parse();
  assert.ok(p.courses.length === 2 && !p.courseBad);
});

test("CpxParse: walls read back, and a corrupt wall refuses the whole file", () => {
  const { input, w, pts } = squareFixture();
  const ws = [...w, wallIn("fence", 4, 3, { side: WALL_SIDE_OUTSIDE, noline: 1, thickness: 512, height: 4096 })];
  const ps = [...pts, pt(5000, 5000, -50), pt(5100, 5000, -60, 20, -2, 1), pt(5100, 5100, -70)];
  const img = built(cpxBuildEx(RACERULES_DRAG, 1, input, ws, ps));
  const p = cpxParse(img);
  assert.ok(p.ok);
  assert.deepEqual(p.parsed.walls, ws);
  assert.deepEqual(p.parsed.points, ps);

  const wall = findChunk(img, "WALL")[0] + 8, wpnt = findChunk(img, "WPNT")[0] + 8;
  const bad = (edit: (b: Uint8Array) => void) => { const b = img.slice(); edit(b); return b; };
  assert.ok(parseErr(bad((b) => { b[wall + 36] = 1; }), "pit wall"));
  assert.ok(parseErr(bad((b) => { b[wall + 36] = 2; putU32(b, wall + 48 + 32, 2); }), "at least 3"));
  assert.ok(parseErr(bad((b) => putU32(b, wpnt + 12, 1281)), "bend"));
  assert.ok(parseErr(bad((b) => putU32(b, wpnt + 3 * 24 + 12, 5000)), "bend"));
  assert.ok(parseErr(bad((b) => putU32(b, wall + 44, 0)), "height"));
  assert.ok(parseErr(bad((b) => putU32(b, wall + 40, 0)), "thickness"));
  assert.ok(parseErr(bad((b) => putU32(b, wall + 48 + 32, 3)), "fence"));
  assert.ok(parseErr(bad((b) => putU32(b, wall + 32, 5)), null));
  assert.ok(parseErr(bad((b) => putU32(b, wpnt - 8, 3)), null));
  assert.ok(parseErr(bad((b) => { b[wall - 8 + 4] = 0; b[wall - 8 + 5] = 0; }), "its wall list is cut short"));
  assert.ok(parseErr(bad((b) => putU32(b, 64 + 4, 2)), "its WALL chunk is version 2, which this version does not know"));
  assert.ok(parseErr(bad((b) => putU32(b, 80 + 4, 2)), "its WPNT chunk is version 2, which this version does not know"));
  assert.ok(parseErr(bad((b) => b.set([90, 90, 90, 90], 80)), "it has a WALL chunk but no WPNT chunk"));
  assert.ok(!parseErr(bad((b) => b.set([90, 90, 90, 90], 64)), null));   // WPNT without WALL: ignored
  assert.ok(parseErr(bad((b) => { b[U32(img, 40)] = 3; }), "WALL"));
  assert.ok(parseErr(bad((b) => putU32(b, wall - 8, 65)), "it has 65 walls, more than the 64 allowed"));
  assert.ok(parseErr(bad((b) => putU32(b, wpnt - 8, 9000)), "it has 9000 wall points, more than the 8192 allowed"));
  // A WALL chunk of 0 walls is no walls, whatever the WPNT holds.
  const none = cpxParse(bad((b) => { putU32(b, wall - 8, 0); putU32(b, wpnt - 8, 9000); }));
  assert.ok(none.ok && none.parsed.walls.length === 0 && none.parsed.points.length === 0);
});

// ---- applying, the setters ----

/** A track with n checkpoint boxes in a row along x, plus a plain box in front, every split 0 (a pod read as an old one). */
function cpTrack(n: number, trackType = TRACKTYPE_DRAG): RaceTrack {
  const plainBox = traxxBoxDefaults();
  const cps = Array.from({ length: n }, (_, i): TraxxBox => {
    const b = traxxBoxDefaults();
    b.type = TRAXX_BOX_CHECKPOINT;
    b.checkpointSeq = i;
    b.ipos = [8000 + 20 * i, 8100, 100];
    b.psi = Math.fround(1.570796);
    return b;
  });
  return { trackType, boxes: [plainBox, ...cps] };
}

test("ApplyRaceRulesCpx: all or nothing, with the note", () => {
  const track = cpTrack(8, TRACKTYPE_CIRCUIT);
  const cin = gatherCpxBoxes(track.boxes).map((b, i) => ({ ...b, seq: i >> 1, split: CPX_SPLIT_LANE, lane: 1 + (i & 1) }));
  const img = built(cpxBuildEx(RACERULES_DRAG, 0, cin, null, null, [{ course: 3, firstpass: 1, thencourse: 1 }]));
  const rules = raceRulesDefaults();
  const d = applyRaceRulesCpx(track, rules, img, "WORLD\\T.CPX");
  assert.ok(d.ok);
  assert.equal(d.note, "");
  assert.deepEqual(track.boxes.slice(1).map((b) => [b.checkpointSeq, b.cpSplit, b.cpLane]), cin.map((b) => [b.seq, 2, b.lane]));
  assert.ok(rules.mode === RACERULES_DRAG && rules.laps === 0 && track.trackType === TRACKTYPE_DRAG);
  assert.deepEqual(rules.leadinThen, [-1, -1, -1, 1, -1]);
  assert.equal(track.boxes[0]!.cpSplit, 0);

  // A box moved after the rules were written: nothing applied.
  const moved = cpTrack(8);
  moved.boxes[3]!.fraction[0] = 40;   // 40 / 512 ft: 20 / 256 ft, over the 16 allowed
  const r2 = raceRulesDefaults();
  const d2 = applyRaceRulesCpx(moved, r2, img, "WORLD\\T.CPX");
  assert.ok(!d2.ok);
  assert.equal(d2.note, "Race rules (WORLD\\T.CPX) not applied: checkpoint box 3 is not where the file says it was (the track was changed after the rules were written).");
  assert.ok(r2.mode === RACERULES_NONE && moved.boxes[3]!.cpSplit === 0);
  moved.boxes[3]!.fraction[0] = 16;   // 8 / 256 ft: inside the tolerance
  assert.ok(applyRaceRulesCpx(moved, raceRulesDefaults(), img, "WORLD\\T.CPX").ok);
  const turned = cpTrack(8);
  turned.boxes[1]!.psi = Math.fround(1.570796 + 0.007);   // 73 / 65536 turn
  assert.ok(!decideRaceRulesCpx(img, "N", gatherCpxBoxes(turned.boxes), TRACKTYPE_DRAG).ok);

  assert.equal(decideRaceRulesCpx(img, "WORLD\\T.CPX", gatherCpxBoxes(cpTrack(7).boxes), TRACKTYPE_DRAG).note,
    "Race rules (WORLD\\T.CPX) not applied: the track has 7 checkpoint boxes and the file describes 8.");
  assert.equal(decideRaceRulesCpx(null, "WORLD\\T.CPX", [], TRACKTYPE_DRAG).note, "Race rules (WORLD\\T.CPX) not applied: the file is empty.");
  assert.equal(decideRaceRulesCpx(null, null, [], TRACKTYPE_DRAG).note, "Race rules (WORLD\\.CPX) not applied: the file is empty.");

  // Mode 3 on a track that is no Circuit or Rally, and the dropped COUR notes.
  const t3 = cpTrack(4, TRACKTYPE_CIRCUIT);
  const in3 = gatherCpxBoxes(t3.boxes);
  const race = built(cpxBuild(3, 0, in3));
  assert.equal(decideRaceRulesCpx(race, "X", in3, TRACKTYPE_RUMBLE).note, "Race rules (X) not applied: split checkpoints need a Circuit or Rally track type.");
  assert.ok(decideRaceRulesCpx(race, "X", in3, TRACKTYPE_RALLY).ok);
  const withCour = built(cpxBuildEx(RACERULES_DRAG, 1, in3, null, null, [{ course: 2, firstpass: 1, thencourse: 0 }])).slice();
  const rule = U32(withCour, 40), cpbx = U32(withCour, 56);
  withCour[rule] = 3;
  withCour.fill(0, rule + 1, rule + 16);
  for (let i = 0; i < 4; i++) { withCour[cpbx + 8 + 24 * i + 2] = i < 3 ? 5 : 4; withCour[cpbx + 8 + 24 * i + 5] = 0; }
  const d3 = decideRaceRulesCpx(withCour, "X", in3, TRACKTYPE_CIRCUIT);
  assert.ok(d3.ok && d3.leadIns.length === 0);
  assert.equal(d3.note, "This pod's lead-ins (COUR) are not kept by Traxx on circuit/rally tracks.");
  const badCour = built(cpxBuildEx(RACERULES_DRAG, 1, in3, null, null, [{ course: 2, firstpass: 1, thencourse: 0 }])).slice();
  badCour[findChunk(badCour, "COUR")[0] + 8] = 1;
  const d4 = decideRaceRulesCpx(badCour, "X", in3, TRACKTYPE_DRAG);
  assert.ok(d4.ok);
  assert.equal(d4.note, "Lead-ins (COUR) not applied: course 1 is Lane 2's own course and cannot be a lead-in.");

  // A record whose role does not fit, and a lane on an unsplit box.
  const role = built(cpxBuild(RACERULES_DRAG, 1, in3)).slice();
  role[U32(role, 56) + 8 + 2] = 5;
  assert.equal(decideRaceRulesCpx(role, "X", in3, TRACKTYPE_DRAG).note, "Race rules (X) not applied: checkpoint box 1 has a role that does not fit its place in the map.");
  const holes = built(cpxBuild(RACERULES_DRAG, 1, in3)).slice();
  holes[U32(holes, 56) + 8 + 72] = 7;   // slot 7 for the finish: valid as a map, not as the engine's slots
  assert.equal(decideRaceRulesCpx(holes, "X", in3, TRACKTYPE_DRAG).note, "Race rules (X) not applied: checkpoint box 4 has a slot or lane the engine would not accept.");
});

test("SetRaceRules, SetTrackType, the lead-ins", () => {
  const t = cpTrack(4, TRACKTYPE_RUMBLE);
  const r: { mode: number; laps: number } & RaceRules = raceRulesDefaults();
  setRaceRules(t, r, 7, 1);
  assert.equal(r.mode, RACERULES_NONE);
  setRaceRules(t, r, RACERULES_RACE, 0);
  assert.equal(r.mode, RACERULES_NONE, "RACE needs a Circuit or Rally");
  setRaceRules(t, r, RACERULES_DRAG, 5);
  assert.ok((r.mode as number) === RACERULES_DRAG && (r.laps as number) === 1 && (t.trackType as number) === TRACKTYPE_DRAG);
  setRaceRules(t, r, RACERULES_PARALLEL, 1);
  assert.ok((r.mode as number) === RACERULES_PARALLEL && (r.laps as number) === 0 && (t.trackType as number) === TRACKTYPE_CIRCUIT);
  setRaceRules(t, r, RACERULES_RACE, 1);
  assert.ok((r.mode as number) === RACERULES_RACE && (r.laps as number) === 0 && (t.trackType as number) === TRACKTYPE_CIRCUIT);

  // Leaving Circuit / Rally clears RACE: splits gone, laps 1, checkpoints numbered one each in their order.
  t.boxes[1]!.checkpointSeq = 1; t.boxes[1]!.cpSplit = CPX_SPLIT_ANY;
  t.boxes[2]!.checkpointSeq = 1; t.boxes[2]!.cpSplit = CPX_SPLIT_ANY;
  t.boxes[3]!.checkpointSeq = 0;
  t.boxes[4]!.checkpointSeq = 2;
  const [b1, b2, b3, b4] = t.boxes.slice(1);
  setTrackType(t, r, TRACKTYPE_RALLY);
  assert.ok((r.mode as number) === RACERULES_RACE && (t.trackType as number) === TRACKTYPE_RALLY);
  setTrackType(t, r, TRACKTYPE_DRAG);
  assert.ok((r.mode as number) === RACERULES_NONE && (r.laps as number) === 1 && (t.trackType as number) === TRACKTYPE_DRAG);
  assert.deepEqual(t.boxes.slice(1), [b3, b1, b2, b4]);
  assert.deepEqual(t.boxes.slice(1).map((b) => [b.checkpointSeq, b.cpSplit, b.cpLane]), [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]);
  setTrackType(t, r, 9);
  assert.equal(t.trackType, TRACKTYPE_DRAG);

  const l = raceRulesDefaults();
  assert.equal(setLeadIn(l, 1, 0), 0);
  assert.equal(setLeadIn(l, 2, 2), 0);
  assert.equal(setLeadIn(l, 2, 0), 1);
  assert.ok(hasLeadIns(l));
  assert.equal(setLeadIn(l, 3, 0), 2, "lane 1's lead-in moves to course 3");
  assert.deepEqual(l.leadinThen, [-1, -1, -1, 0, -1]);
  assert.equal(setLeadIn(l, 3, -1), 1);
  assert.ok(!hasLeadIns(l));
  assert.equal(getLeadIn(l, 0), -1);
  setLeadIn(l, 4, 1);
  assert.equal(getLeadIn(l, 4), 1);
  clearLeadIns(l);
  assert.deepEqual(l.leadinThen, [-1, -1, -1, -1, -1]);
});

// ---- the five drag templates ----

const TEMPLATES: Array<{ stem: string; layout: (i: number) => [number, number, number] }> = [
  // The checkpoints as the template's .TXX holds them (V21 box records; the .SI2's order is already the export's).
  { stem: "STRAIGHTDRAG", layout: (i) => [i, CPX_SPLIT_NONE, 0] },
  { stem: "JDRAG", layout: (i) => [i >> 1, CPX_SPLIT_LANE, 1 + (i & 1)] },
  { stem: "ODRAG", layout: (i) => [i >> 1, CPX_SPLIT_LANE, 1 + (i & 1)] },
  { stem: "PAPERCLIPDRAG", layout: (i) => [i >> 1, CPX_SPLIT_LANE, 1 + (i & 1)] },
  { stem: "CROSSOVERDRAG", layout: (i) => [i >> 1, CPX_SPLIT_LANE, 1 + (i & 1)] },
];

/**
  The race-rules blocks at the end of the template's .TXX: V21 (1, race_rules, race_laps), V22 (the
  walls, decodeWallsBlock) and, in a V23 file, the lead-ins (1, leadin_then[5], with LoadTXX's rule:
  courses 2..4 take 0 or 1, an earlier course keeping a target two claim).
*/
function txxRaceTail(tail: Uint8Array): RaceRules {
  const v = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  assert.equal(v.getInt32(0, true), 1);
  const rules = raceRulesDefaults();
  rules.mode = v.getInt32(4, true) as RaceRules["mode"];
  rules.laps = v.getInt32(8, true);
  const { walls, length } = decodeWallsBlock(tail, 12);
  rules.walls = walls;
  let o = 12 + length;
  if (o < tail.length) {
    assert.equal(v.getInt32(o, true), 1);
    for (let c = 2; c <= 4; c++) {
      const lt = v.getInt32(o + 4 + 4 * c, true);
      if ((lt === 0 || lt === 1) && ![2, 3, 4].some((e) => e < c && rules.leadinThen[e] === lt)) rules.leadinThen[c] = lt;
    }
    o += 24;
  }
  assert.equal(o, tail.length);
  return rules;
}

for (const { stem, layout } of TEMPLATES) {
  test(`${stem}: the .CPX rebuilt from the .SI2, the .TXX walls and lead-ins is Traxx's, byte for byte`, () => {
    const cpx = new Uint8Array(readFileSync(join(FIXTURES, `${stem}.CPX`)));
    const si2 = new Uint8Array(readFileSync(join(FIXTURES, `${stem}.SI2`)));
    const rules = txxRaceTail(new Uint8Array(readFileSync(join(FIXTURES, `${stem}.TXXTAIL`))));
    const txv = readFileSync(join(FIXTURES, `${stem}.TXV`), "latin1");
    assert.match(txv, /\r\nformatVersion=6\r\n[\s\S]*\r\nraceRules=drag\r\n$/);

    const sit = readTraxxSit(si2);
    assert.equal(sit.prefix, stem);
    assert.equal(sit.trackType, TRACKTYPE_DRAG);
    const cps = sit.boxes.filter((b) => b.type === TRAXX_BOX_CHECKPOINT);
    cps.forEach((b, i) => { [b.checkpointSeq, b.cpSplit, b.cpLane] = layout(i); });
    assert.equal(rules.mode, RACERULES_DRAG);

    // The fingerprint text is the .SI2's own text, field for field.
    const text = new TextDecoder("latin1").decode(si2);
    for (const b of cps) {
      const t = sitBoxCpxText(b);
      assert.ok(text.includes(`\r\n${t.sitpos.join(",")}\r\n`), `${stem} ${t.sitpos.join(",")}`);
      assert.ok(text.includes(`,${t.sitpsi}\r\n`));
    }

    // The templates' ground is a flat 200 ft at every wall point (baseY - above = 51200 throughout).
    const track: RaceTrack = sit;
    const order = track.boxes.slice();
    const out = buildTrackCpx(track, rules, { prefix: sit.prefix, ground: () => 200 });
    assert.ok(out && out.ok, out && !out.ok ? out.message : "no build");
    assert.equal(out.name, `WORLD\\${stem}.CPX`);
    assert.deepEqual(out.image, cpx);
    commitTrackCpx(track, out);
    assert.deepEqual(track.boxes, order, "the .SI2 is in the export order already");
    assert.equal(track.trackType, TRACKTYPE_DRAG);

    // Applied to the plain .SI2 track (a pod read as an old one): the rules, the walls as their
    // exported pieces, the lead-ins; and that wall set exports to the same points again.
    const old = readTraxxSit(si2);
    const back = raceRulesDefaults();
    const d = applyRaceRulesCpx(old, back, cpx, out.name);
    assert.ok(d.ok, d.note);
    assert.equal(d.note, "");
    assert.deepEqual(old.boxes.filter((b) => b.type === TRAXX_BOX_CHECKPOINT).map((b) => [b.checkpointSeq, b.cpSplit, b.cpLane]), cps.map((_, i) => layout(i)));
    assert.ok(back.mode === rules.mode && back.laps === rules.laps);
    assert.deepEqual(back.leadinThen, rules.leadinThen);
    assert.equal(back.walls.length, rules.walls.length);
    back.walls.forEach((w, k) => {
      const orig = rules.walls[k]!;
      assert.deepEqual([w.name, w.side, w.closed, w.noline, w.thickness, w.height], [orig.name, orig.side, orig.closed, orig.noline, orig.thickness, orig.height]);
      const a = exportWall(orig, () => 200), b = exportWall(w, () => 200);
      assert.equal(b.count, a.count);
      assert.deepEqual(b.points, a.points);
    });
    const again = buildTrackCpx(old, back, { prefix: old.prefix, ground: () => 200 });
    assert.ok(again && again.ok);
    assert.deepEqual(again.image, cpx, "a pod read back writes the same .CPX");
  });
}

test("the template tails match the templates' own .TXX files (when JSTRAXX_DRAG_TEMPLATES is set)", (t) => {
  const dir = process.env.JSTRAXX_DRAG_TEMPLATES;
  if (!dir || !existsSync(dir)) { t.skip("JSTRAXX_DRAG_TEMPLATES not set"); return; }
  const names: Record<string, string> = { STRAIGHTDRAG: "Straight_Drag", JDRAG: "J_Drag", ODRAG: "O_Drag", PAPERCLIPDRAG: "PaperClip_Drag", CROSSOVERDRAG: "CrossOver_Drag" };
  for (const [stem, tpl] of Object.entries(names)) {
    const txx: Uint8Array = new Uint8Array(readFileSync(join(dir, `${tpl}.txx`)));
    const tail = new Uint8Array(readFileSync(join(FIXTURES, `${stem}.TXXTAIL`)));
    assert.deepEqual(txx.subarray(txx.length - tail.length), tail, stem);
  }
});

test("Write POD's refusals: walls by name, the entry name, the rules off", () => {
  const t = cpTrack(4);
  const r = raceRulesDefaults();
  assert.equal(buildTrackCpx(t, r, { prefix: "T", ground: null }), null);
  setRaceRules(t, r, RACERULES_DRAG, 1);
  r.walls.push({ name: "short", side: 0, closed: 0, noline: 0, thickness: 256, height: 256, points: [{ x: 0, z: 0, bend: 0, above: 0, gap: 0 }] });
  assert.deepEqual(buildTrackCpx(t, r, { prefix: "T", ground: null }), { ok: false, message: "Race rules: wall \"short\": it has 1 point(s), at least 2 are needed" });
  r.walls[0]!.points.push({ x: 0, z: 0, bend: 0, above: 0, gap: 0 });
  assert.deepEqual(buildTrackCpx(t, r, { prefix: "T", ground: null }), { ok: false, message: "Race rules: wall \"short\" has fewer than 2 distinct points" });
  r.walls[0]!.points[1]!.x = 9000 * 256;
  assert.deepEqual(buildTrackCpx(t, r, { prefix: "T", ground: null }), { ok: false, message: "Race rules: wall \"short\" needs more than 1024 points; shorten it or split it" });
  r.walls[0]!.points[0]!.x = 8000 * 256;
  r.walls[0]!.points[1]!.x = 8200 * 256;
  assert.deepEqual(buildTrackCpx(t, r, { prefix: "T", ground: null }), { ok: false, message: "Race rules: wall \"short\" goes outside the world (0 to 8192 ft)" });
  assert.ok(buildTrackCpx(t, r, { prefix: "T", ground: null, worldFt: 16384 })!.ok);
  r.walls[0]!.points[0]!.x = 0;
  r.walls[0]!.points[1]!.x = 100 * 256;
  assert.deepEqual(buildTrackCpx(t, r, { prefix: "ABCDEFGHIJKLMNOPQRSTUV", ground: null }),
    { ok: false, message: "Race rules: the track name does not fit a pod entry (WORLD\\<name>.CPX)" });
  const ok = buildTrackCpx(t, r, { prefix: "abc", ground: null });
  assert.ok(ok && ok.ok && ok.name === "WORLD\\ABC.CPX");
  // Mode 3 exports no walls and no lead-ins.
  setRaceRules(t, r, RACERULES_NONE, 1);
  t.trackType = TRACKTYPE_CIRCUIT;
  setRaceRules(t, r, RACERULES_RACE, 0);
  setLeadIn(r, 2, 0);
  const race = buildTrackCpx(t, r, { prefix: "T", ground: null });
  assert.ok(race && race.ok && U32(race.image, 12) === 2 && race.trackType === TRACKTYPE_CIRCUIT);
  assert.deepEqual(buildTrackCpx(cpTrack(3), { ...raceRulesDefaults(), mode: RACERULES_DRAG }, { prefix: "T", ground: null }),
    { ok: false, message: "Race rules: a drag needs at least 4 checkpoints (pre-stage, stage, launch, finish), this track has 3" });
});

test("Write POD sorts the boxes and permutes them among the checkpoint slots", () => {
  const t = cpTrack(4, TRACKTYPE_CIRCUIT);
  const r = raceRulesDefaults();
  setRaceRules(t, r, RACERULES_PARALLEL, 0);
  const [b1, b2, b3, b4] = t.boxes.slice(1);
  [b1!.checkpointSeq, b2!.checkpointSeq, b3!.checkpointSeq, b4!.checkpointSeq] = [3, 1, 2, 0];
  const out = buildTrackCpx(t, r, { prefix: "T", ground: null });
  assert.ok(out && out.ok);
  assert.deepEqual(out.slots, [1, 2, 3, 4]);
  assert.deepEqual(out.order, [3, 1, 2, 0]);
  commitTrackCpx(t, out);
  assert.deepEqual(t.boxes.slice(1), [b4, b2, b3, b1]);
  assert.equal(t.trackType, TRACKTYPE_CIRCUIT);
});
