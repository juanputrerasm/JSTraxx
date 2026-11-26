/*
  The editor side of Traxx 1.8.2's race rules (core/edit/race-edit.ts): RenumberCheckpoints,
  JoinSlot, MakeMainRoute, ApplyObjectProperties' checkpoint block (rules off and on, the caps, the
  main route), ObjectDialogContext and the Role text, the paste rules, Set Type, Track Components'
  OK, the Course Tools texts, passes, labels and lead-in pick, the checkpoint overlay labels and
  arrow, and the map's Lane 2. The expectations follow Traxx/TraxxViewEdit.cpp, TraxxView.cpp,
  TraxxFrame.cpp, TraxxViewDisplay.cpp and the GUI checklists (Traxx_RaceRules_GUI_Checklist.md,
  Traxx_CircuitSplits_GUI_Checklist.md, Traxx_Courses_GUI_Checklist.md).
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCheckpointRace, applyTrackRules, checkpointRaceLabels, checkpointRolePreview, checkpointShowsArrow, componentsRaceRows, countCheckpointSlots,
  courseBarTexts, courseLaneTrack, courseLines, dlgItemInt, joinSlot, makeMainRoute, objectRaceContext, pasteCheckpoint, pickLeadIn,
  renumberCheckpoints, resetRaceRulesOfBoxes, trackRulesChoiceOf, MAX_CHECKPOINTS_TEXT, MAX_COPIES_TEXT, type CheckpointRaceFields,
} from "../src/core/edit/race-edit.ts";
import { CPX_SPLIT_ANY, CPX_SPLIT_LANE, CPX_SPLIT_NONE, RACERULES_DRAG, RACERULES_NONE, RACERULES_PARALLEL, RACERULES_RACE, raceRulesDefaults } from "../src/core/traxx/race-types.ts";
import { TRACKTYPE_CIRCUIT, TRACKTYPE_DRAG, TRACKTYPE_RALLY, TRACKTYPE_RUMBLE } from "../src/core/traxx/race-rules.ts";
import { traxxBoxDefaults, type TraxxBox } from "../src/core/traxx/sit.ts";
import { checkpointArrow } from "../src/core/view/arrows.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { applyObjectFields, objectFields } from "../src/core/edit/object-properties.ts";
import { pasteObject, setTypeOfObjects } from "../src/core/edit/objects.ts";
import { terrainMap } from "../src/core/traxx/map.ts";

const cp = (seq: number, split = 0, lane = 0): TraxxBox => ({ ...traxxBoxDefaults(), type: 6, checkpointSeq: seq, cpSplit: split, cpLane: lane });
const plain = (): TraxxBox => ({ ...traxxBoxDefaults() });
const fields = (checkpoint: number, cpSplit = 0, cpLane = 0, cpMain = false, cpMainEdit = false): CheckpointRaceFields => ({ checkpoint, cpSplit, cpLane, cpMain, cpMainEdit });
const seqs = (boxes: TraxxBox[]) => boxes.filter((b) => b.type === 6).map((b) => b.checkpointSeq);

test("RenumberCheckpoints: sorted among the checkpoint positions, unique or sharing", () => {
  const a = cp(5), b = plain(), c = cp(2), d = cp(5, 1), e = cp(9);
  const boxes = [a, b, c, d, e];
  assert.equal(renumberCheckpoints(boxes, false), 3);
  assert.deepEqual(boxes, [c, b, a, d, e], "the plain box keeps its place, ties keep their order");
  assert.deepEqual(seqs(boxes), [0, 1, 1, 2]);
  assert.equal(renumberCheckpoints(boxes, true), 4);
  assert.deepEqual(seqs(boxes), [0, 1, 2, 3]);
  assert.equal(countCheckpointSlots([cp(1), cp(1), cp(4), plain()]), 2);
  const off = [cp(0, 2, 1), cp(0, 2, 2), { ...plain(), cpSplit: 1 }];
  resetRaceRulesOfBoxes(off);
  assert.deepEqual(off.map((x) => [x.checkpointSeq, x.cpSplit, x.cpLane]), [[0, 0, 0], [1, 0, 0], [0, 0, 0]], "rules off: copies become separate checkpoints");
});

test("JoinSlot and MakeMainRoute", () => {
  const other = cp(3, 0, 0), me = cp(3, CPX_SPLIT_LANE, 1);
  joinSlot([other, me], me, 1);
  assert.deepEqual([other.cpSplit, other.cpLane], [CPX_SPLIT_LANE, 2], "the copy with no lane takes the other one");
  const any = cp(3, CPX_SPLIT_ANY);
  joinSlot([other, me, any], any, 2);
  assert.deepEqual([other.cpSplit, other.cpLane, me.cpSplit, me.cpLane], [CPX_SPLIT_ANY, 0, CPX_SPLIT_ANY, 0], "not per lane: lanes go");

  const x = cp(0), m1 = cp(1, 1), y = plain(), m2 = cp(1, 1), m3 = cp(1, 1), z = cp(2);
  const boxes = [x, m1, y, m2, m3, z];
  assert.equal(makeMainRoute(boxes, m3), 1);
  assert.deepEqual(boxes, [x, m3, y, m1, m2, z]);
  assert.equal(makeMainRoute(boxes, y), -1, "not a checkpoint");
  const gap = [cp(1, 1), cp(0), cp(1, 1)];
  assert.equal(makeMainRoute(gap, gap[2]!), -1, "not contiguous: left alone");
});

test("Object Properties, rules off: the classic bump, 100 at most", () => {
  const boxes = [cp(0), cp(1), cp(2), plain()];
  const me = boxes[3]!;
  me.type = 6;
  assert.deepEqual(applyCheckpointRace(boxes, RACERULES_NONE, me, fields(1, 2, 1), false, 0), []);
  assert.deepEqual(seqs(boxes), [0, 1, 2, 3]);
  assert.equal(boxes[1], me);
  assert.deepEqual([me.cpSplit, me.cpLane], [0, 0]);
  const full = Array.from({ length: 100 }, (_, i) => cp(i));
  const extra = cp(50);
  full.push(extra);
  assert.deepEqual(applyCheckpointRace(full, RACERULES_NONE, extra, fields(50), false, 0), [MAX_CHECKPOINTS_TEXT]);
  assert.equal(extra.type, 0);
  assert.equal(MAX_CHECKPOINTS_TEXT, "Max. 100 Checkpoints!");
  assert.deepEqual(seqs(full), Array.from({ length: 100 }, (_, i) => i));
});

test("Object Properties, rules on: join, bump, caps and the main route", () => {
  // A 4-slot drag; a fifth box joins the Finish per lane, lane 2: the Finish takes lane 1 on its own.
  const boxes = [cp(0), cp(1), cp(2), cp(3), plain()];
  const me = boxes[4]!;
  me.type = 6;
  assert.deepEqual(applyCheckpointRace(boxes, RACERULES_DRAG, me, fields(3, CPX_SPLIT_LANE, 1), false, 0), []);
  assert.deepEqual(seqs(boxes), [0, 1, 2, 3, 3]);
  assert.deepEqual([boxes[3]!.cpSplit, boxes[3]!.cpLane, me.cpSplit, me.cpLane], [CPX_SPLIT_LANE, 1, CPX_SPLIT_LANE, 2]);
  // Split None on a used number: it takes the place and bumps the rest.
  const b2 = [cp(0), cp(1), cp(2), cp(3)];
  applyCheckpointRace(b2, RACERULES_DRAG, b2[3]!, fields(1), true, 3);
  assert.deepEqual(b2.map((b) => b.checkpointSeq), [0, 1, 2, 3]);
  assert.equal(b2[1]!.checkpointSeq, 1);
  // RACE: a per-lane split becomes any-copy.
  const b3 = [cp(0), cp(1), plain()];
  b3[2]!.type = 6;
  applyCheckpointRace(b3, RACERULES_RACE, b3[2]!, fields(1, CPX_SPLIT_LANE, 1), false, 0);
  assert.deepEqual(b3.map((b) => [b.checkpointSeq, b.cpSplit, b.cpLane]), [[0, 0, 0], [1, 1, 0], [1, 1, 0]]);
  // A 9th copy.
  const eight = Array.from({ length: 8 }, () => cp(0, CPX_SPLIT_ANY));
  const ninth = cp(5);
  eight.push(ninth);
  assert.deepEqual(applyCheckpointRace(eight, RACERULES_PARALLEL, ninth, fields(0, CPX_SPLIT_ANY), true, 5), [MAX_COPIES_TEXT]);
  assert.equal(ninth.type, 0);
  assert.equal(MAX_COPIES_TEXT, "Max. 8 copies of one checkpoint!");
  // A 101st slot; copies do not count.
  const many = Array.from({ length: 100 }, (_, i) => cp(i));
  many.push(cp(7, CPX_SPLIT_ANY));
  const new1 = plain();
  new1.type = 6;
  many.push(new1);
  assert.deepEqual(applyCheckpointRace(many, RACERULES_PARALLEL, new1, fields(200), false, 0), [MAX_CHECKPOINTS_TEXT]);
  // Main route: ticked moves this copy first; not ticked, the old main stays main.
  const a = cp(0), m = cp(1, CPX_SPLIT_ANY), n = cp(1, CPX_SPLIT_ANY), z = cp(2);
  const r = [a, m, n, z];
  applyCheckpointRace(r, RACERULES_RACE, n, fields(1, CPX_SPLIT_ANY, 0, true, true), true, 1);
  assert.deepEqual(r, [a, n, m, z]);
  applyCheckpointRace(r, RACERULES_RACE, n, fields(1, CPX_SPLIT_ANY, 0, false, true), true, 1);
  assert.deepEqual(r, [a, n, m, z], "unticking does nothing");
  // A box moved into the slot by its Sequence stays behind the old main, wherever the sort put it.
  const early = cp(9);
  const r2 = [early, a, m, n, z];
  applyCheckpointRace(r2, RACERULES_RACE, early, fields(1, CPX_SPLIT_ANY), true, 9);
  const slot = r2.filter((b) => b.type === 6 && b.checkpointSeq === 1);
  assert.equal(slot[0], m, "the old main copy stays first");
});

test("ObjectDialogContext and the Role text", () => {
  const boxes = [cp(0), cp(1), cp(2), cp(3)];
  const ctx = objectRaceContext(boxes, RACERULES_DRAG, boxes[0]!);
  assert.deepEqual(ctx.othersSeq, [1, 2, 3]);
  assert.equal(checkpointRolePreview(RACERULES_DRAG, ctx.othersSeq, 0, 0), "Pre-stage (checkpoint 1 of 4)");
  assert.equal(checkpointRolePreview(RACERULES_DRAG, [0, 1, 2], 3, 0), "Finish (checkpoint 4 of 4)");
  assert.equal(checkpointRolePreview(RACERULES_DRAG, [0, 1, 2, 3], 9, 0), "Finish (checkpoint 5 of 5)");
  assert.equal(checkpointRolePreview(RACERULES_DRAG, [0, 1, 2, 3], 1, 0), "Stage (checkpoint 2 of 5)", "split None on a used number bumps");
  assert.equal(checkpointRolePreview(RACERULES_DRAG, [0, 1, 2, 3], 3, CPX_SPLIT_LANE), "Finish (checkpoint 4 of 4)", "a split joins");
  assert.equal(checkpointRolePreview(RACERULES_PARALLEL, [0, 1, 2], 1, 0), "Gate (checkpoint 2 of 4)");
  assert.equal(checkpointRolePreview(RACERULES_DRAG, [], null, 0), "");
  assert.deepEqual([dlgItemInt(" 12 "), dlgItemInt("-3"), dlgItemInt(""), dlgItemInt("1.5")], [12, -3, null, null]);
  const pair = [cp(0), cp(1, CPX_SPLIT_ANY), cp(1, CPX_SPLIT_ANY)];
  assert.deepEqual([objectRaceContext(pair, RACERULES_RACE, pair[1]!).mainAvail, objectRaceContext(pair, RACERULES_RACE, pair[1]!).main], [true, true]);
  assert.deepEqual([objectRaceContext(pair, RACERULES_RACE, pair[2]!).main, objectRaceContext(pair, RACERULES_NONE, pair[1]!).mainAvail], [false, false]);
  assert.equal(objectRaceContext([cp(0, CPX_SPLIT_ANY)], RACERULES_RACE, cp(0, CPX_SPLIT_ANY)).mainAvail, false, "a slot of one");
});

test("applyObjectFields keeps the object across a renumber and writes the race fields", () => {
  const doc = newTrackDocument();
  const t = doc.track;
  t.raceRules.mode = RACERULES_DRAG;
  t.trackType = TRACKTYPE_DRAG;
  t.boxes = [cp(0), cp(1), cp(2), cp(3), plain()];
  const box = t.boxes[4]!;
  const f = objectFields(box, null, RACERULES_DRAG);
  f.typeIndex = 6;
  f.checkpoint = 0;
  f.cpSplit = CPX_SPLIT_LANE;
  f.cpLane = 1;
  assert.deepEqual(applyObjectFields(t, 4, f, t.heights, { cont: null, impact: null }, 0), []);
  assert.equal(t.boxes.indexOf(box), 1, "found again by identity");
  assert.deepEqual([box.checkpointSeq, box.cpSplit, box.cpLane, t.boxes[0]!.cpLane], [0, CPX_SPLIT_LANE, 2, 1]);
  assert.equal(objectFields(box, null, RACERULES_RACE).cpSplit, CPX_SPLIT_ANY, "RACE has no Per lane entry");
  assert.equal(objectFields(box, null, RACERULES_DRAG).cpLane, 1);
  // Retyped away from a checkpoint: no split, no lane.
  const g = objectFields(box, null, RACERULES_DRAG);
  g.typeIndex = 0;
  applyObjectFields(t, t.boxes.indexOf(box), g, t.heights, { cont: null, impact: null }, 0);
  assert.deepEqual([box.type, box.cpSplit, box.cpLane], [0, 0, 0]);
});

test("Paste: own or join, the free lane, RACE lane to any, the caps", () => {
  const off = [cp(0), cp(1), cp(2)];
  const p0 = cp(0, CPX_SPLIT_ANY);
  off.unshift(p0);
  assert.equal(pasteCheckpoint(off, RACERULES_NONE, p0), null);
  assert.deepEqual([p0.checkpointSeq, p0.cpSplit, off.at(-1)], [3, 0, p0], "rules off: last, its own number");
  // Copy a lane-1 box of a slot with one copy: the paste is lane 2.
  const drag = [cp(0), cp(1), cp(2), cp(3, CPX_SPLIT_LANE, 1)];
  const p1 = cp(3, CPX_SPLIT_LANE, 1);
  drag.push(p1);
  assert.equal(pasteCheckpoint(drag, RACERULES_DRAG, p1), null);
  assert.deepEqual([p1.checkpointSeq, p1.cpLane], [3, 2]);
  // Split None with the rules on: a new last slot.
  const p2 = cp(1);
  drag.push(p2);
  pasteCheckpoint(drag, RACERULES_DRAG, p2);
  assert.equal(p2.checkpointSeq, 4);
  // RACE: a lane split pasted is any-copy; the old main stays main though the paste sits earlier (a hole).
  const main = cp(1, CPX_SPLIT_ANY), c2 = cp(1, CPX_SPLIT_ANY);
  const p3 = cp(1, CPX_SPLIT_LANE, 2);
  const race = [p3, cp(0), main, c2];
  assert.equal(pasteCheckpoint(race, RACERULES_RACE, p3), null);
  assert.deepEqual([p3.cpSplit, p3.cpLane], [CPX_SPLIT_ANY, 0]);
  assert.equal(race.filter((b) => b.checkpointSeq === 1)[0], main);
  // The caps.
  const eight = Array.from({ length: 8 }, () => cp(0, CPX_SPLIT_ANY));
  const p4 = cp(0, CPX_SPLIT_ANY);
  eight.push(p4);
  assert.equal(pasteCheckpoint(eight, RACERULES_PARALLEL, p4), MAX_COPIES_TEXT);
  assert.deepEqual([p4.type, p4.cpSplit], [0, 0]);
  const hundred = Array.from({ length: 100 }, (_, i) => cp(i));
  const p5 = cp(3);
  hundred.push(p5);
  assert.equal(pasteCheckpoint(hundred, RACERULES_NONE, p5), MAX_CHECKPOINTS_TEXT);
  assert.equal(p5.type, 0);
  // Through pasteObject: the index is where the box ended up.
  const doc = newTrackDocument();
  doc.track.boxes = [plain(), cp(0), cp(1)];
  const r = pasteObject(doc.track, cp(0), [100, 100, 0]);
  assert.equal(r.refusal, null);
  assert.equal(doc.track.boxes[r.index!]!.checkpointSeq, 2);
});

test("Set Type: slots counted with the rules on, the split dropped, renumbered", () => {
  const doc = newTrackDocument();
  const t = doc.track;
  t.raceRules.mode = RACERULES_PARALLEL;
  t.boxes = [...Array.from({ length: 99 }, (_, i) => cp(i)), cp(98, CPX_SPLIT_ANY), plain(), plain()];
  const r = setTypeOfObjects(t, [100, 101], 6);
  assert.equal(r.refused, 1, "99 slots: room for one more");
  assert.equal(countCheckpointSlots(t.boxes), 100);
  t.raceRules.mode = RACERULES_NONE;
  const s = setTypeOfObjects(t, [t.boxes.findIndex((b) => b.cpSplit === CPX_SPLIT_ANY)], 0);
  assert.equal(s.refused, 0);
  assert.ok(t.boxes.every((b) => b.type !== 0 || b.cpSplit === 0));
  assert.deepEqual(seqs(t.boxes), Array.from({ length: 100 }, (_, i) => i), "rules off: one number each");
});

test("Track Components: the rows, the choice and OK", () => {
  assert.deepEqual(componentsRaceRows(0, false, false), { splitShown: true, splitEnabled: true, dragShown: false, dragEnabled: false, loopedEnabled: false });
  assert.deepEqual(componentsRaceRows(3, true, false), { splitShown: false, splitEnabled: false, dragShown: true, dragEnabled: true, loopedEnabled: true });
  assert.deepEqual(componentsRaceRows(4, true, false).loopedEnabled, false, "Parallel has no lap control");
  assert.equal(componentsRaceRows(3, true, true).dragEnabled, false, "view only");

  const rules = raceRulesDefaults();
  const track = { trackType: TRACKTYPE_CIRCUIT, boxes: [cp(0), cp(1, CPX_SPLIT_LANE, 1), cp(1, CPX_SPLIT_LANE, 2)] };
  assert.deepEqual(trackRulesChoiceOf(TRACKTYPE_RALLY, rules), { typeIndex: 1, newDrag: false, splitCp: false, looped: false });
  // Drag + new-style, looped.
  let r = applyTrackRules(track, rules, { typeIndex: 3, newDrag: true, splitCp: false, looped: true });
  assert.deepEqual([track.trackType, rules.mode, rules.laps, r.wallsGo, r.note], [TRACKTYPE_DRAG, RACERULES_DRAG, 0, false, null]);
  assert.deepEqual(trackRulesChoiceOf(track.trackType, rules), { typeIndex: 3, newDrag: true, splitCp: false, looped: true });
  // Parallel.
  applyTrackRules(track, rules, { typeIndex: 4, newDrag: false, splitCp: false, looped: true });
  assert.deepEqual([track.trackType, rules.mode, rules.laps], [TRACKTYPE_CIRCUIT, RACERULES_PARALLEL, 0]);
  assert.equal(trackRulesChoiceOf(track.trackType, rules).typeIndex, 4);
  // Circuit with split checkpoints: per-lane becomes any-copy, the pair kept.
  r = applyTrackRules(track, rules, { typeIndex: 0, newDrag: false, splitCp: true, looped: false });
  assert.deepEqual([rules.mode, r.wallsGo], [RACERULES_RACE, true]);
  assert.deepEqual(track.boxes.map((b) => [b.checkpointSeq, b.cpSplit, b.cpLane]), [[0, 0, 0], [1, 1, 0], [1, 1, 0]]);
  // RACE to Drag new-style keeps the any-copy pair.
  applyTrackRules(track, rules, { typeIndex: 3, newDrag: true, splitCp: false, looped: false });
  assert.deepEqual([rules.mode, rules.laps, seqs(track.boxes)], [RACERULES_DRAG, 1, [0, 1, 1]]);
  // Rules off: reset, unique again.
  r = applyTrackRules(track, rules, { typeIndex: 2, newDrag: false, splitCp: false, looped: false });
  assert.deepEqual([track.trackType, rules.mode, r.rulesOff, seqs(track.boxes)], [TRACKTYPE_RUMBLE, RACERULES_NONE, true, [0, 1, 2]]);
  assert.ok(track.boxes.every((b) => b.cpSplit === 0 && b.cpLane === 0));
  // Over 100 boxes once the copies count.
  const big = { trackType: TRACKTYPE_CIRCUIT, boxes: [...Array.from({ length: 100 }, (_, i) => cp(i)), cp(5, CPX_SPLIT_ANY)] };
  const br = raceRulesDefaults();
  br.mode = RACERULES_RACE;
  r = applyTrackRules(big, br, { typeIndex: 0, newDrag: false, splitCp: false, looped: false });
  assert.equal(r.note, "The track has 101 checkpoints, over the 100 the game can hold. Write POD will refuse until some are removed.");
});

test("Course Tools: lane texts, passes, labels and the lead-in pick", () => {
  assert.equal(courseLaneTrack(TRACKTYPE_DRAG, RACERULES_NONE), true);
  assert.equal(courseLaneTrack(TRACKTYPE_CIRCUIT, RACERULES_PARALLEL), true);
  assert.equal(courseLaneTrack(TRACKTYPE_CIRCUIT, RACERULES_RACE), false);
  assert.deepEqual(courseBarTexts(true), { radios: ["Lane 1", "Lane 2", "2", "3", "4"], always: "Always show lanes" });
  assert.deepEqual(courseBarTexts(false), { radios: ["Main (0)", "1", "2", "3", "4"], always: "Always show main" });

  const rules = raceRulesDefaults();
  const names = (l: ReturnType<typeof courseLines>) => l.map((x) => [x.which, x.colour, x.joins, x.label]);
  assert.deepEqual(names(courseLines(TRACKTYPE_CIRCUIT, rules, 2, true)), [[0, "main", true, ""], [2, "magenta", false, ""]]);
  assert.deepEqual(names(courseLines(TRACKTYPE_CIRCUIT, rules, 2, false)), [[2, "magenta", false, ""]]);
  assert.deepEqual(names(courseLines(TRACKTYPE_DRAG, rules, 1, false)), [[1, "lane2", true, "Lane 2"]]);
  assert.deepEqual(names(courseLines(TRACKTYPE_DRAG, rules, 0, true)), [[0, "main", true, "Lane 1"], [1, "lane2", true, "Lane 2"]]);
  assert.deepEqual(names(courseLines(TRACKTYPE_DRAG, rules, 3, false)), [[3, "selected", false, ""]], "no lane with 2..4 selected and the tick off");

  // The pick: refused with the rules off (None still clears), moved, set.
  rules.leadinThen[3] = 1;
  assert.deepEqual(names(courseLines(TRACKTYPE_DRAG, rules, 3, false)), [[3, "selected", false, "Lead-in -> Lane 2 (rules off)"]]);
  assert.deepEqual(pickLeadIn(rules, 2, 1), { changed: false, status: "Lead-ins need new-style drag or Parallel race rules." });
  assert.deepEqual(pickLeadIn(rules, 3, 0), { changed: true, status: "" });
  assert.equal(rules.leadinThen[3], -1);
  rules.mode = RACERULES_DRAG;
  assert.deepEqual(pickLeadIn(rules, 2, 2), { changed: true, status: "" });
  assert.deepEqual(pickLeadIn(rules, 4, 2), { changed: true, status: "Lane 2's lead-in moved here from another course." });
  assert.deepEqual([rules.leadinThen[2], rules.leadinThen[4]], [-1, 1]);
  assert.deepEqual(pickLeadIn(rules, 4, 2), { changed: false, status: "" }, "the same pick: nothing");
  assert.deepEqual(names(courseLines(TRACKTYPE_DRAG, rules, 4, false)), [[4, "selected", false, "Lead-in -> Lane 2"]]);
});

test("Checkpoint overlay: race labels with the main route star, the arrow rule and its geometry", () => {
  assert.equal(checkpointRaceLabels([cp(0)], RACERULES_NONE), null);
  assert.deepEqual(checkpointRaceLabels([cp(0), cp(1), cp(2), cp(3, 2, 1), plain(), cp(3, 2, 2)], RACERULES_DRAG), ["CP 00 PS", "CP 01 ST", "CP 02 LA", "CP 03 FIN L1", "CP 03 FIN L2"]);
  assert.deepEqual(checkpointRaceLabels([cp(0), cp(4, 1), cp(4, 1), cp(7, 1), cp(7, 1)], RACERULES_RACE), ["CP 00 G", "CP 01 G*", "CP 01 G", "CP 02 FIN*", "CP 02 FIN"]);
  assert.deepEqual([checkpointShowsArrow(TRACKTYPE_RUMBLE, RACERULES_NONE, 0), checkpointShowsArrow(TRACKTYPE_DRAG, RACERULES_NONE, 4), checkpointShowsArrow(TRACKTYPE_DRAG, RACERULES_DRAG, 9), checkpointShowsArrow(TRACKTYPE_RALLY, RACERULES_NONE, 30)], [false, false, true, true]);
  // OverlayCheckpoints' local arrow in Traxx's x64 units, then / 64 (the scene's units).
  for (const [width, length] of [[0, 10], [3, 7], [40, 2]] as const) {
    const w = width > 1 ? width : 1;
    const reach = (length + w) * 64, back = Math.trunc((w * 64) / 4), spread = Math.trunc((w * 64) / 8);
    const traxx = [[0, -reach, 0], [0, reach, 0], [spread, reach - back, 0], [-spread, reach - back, 0], [0, reach - back, spread], [0, reach - back, -spread]];
    assert.deepEqual(checkpointArrow({ ...plain(), width, length }), traxx.map((p) => p.map((v) => v / 64 + 0)));
  }
});

test("The map plots Lane 2 in palette entry 253", () => {
  const heights = new Uint8Array(256 * 256);
  const palette = new Uint8Array(768);
  palette.set([10, 20, 30], 253 * 3);
  palette.set([0, 255, 0], 5 * 3);
  const img = terrainMap(heights, palette, [[0, 0]], [[64 * 40, 64 * 8]]);
  // x 40 cells -> map pixel 10, y 8 -> 2; the map is bottom-up.
  const at = (10 + (63 - 2) * 64) * 4;
  assert.deepEqual([...img.rgba.slice(at, at + 3)], [10, 20, 30]);
});
