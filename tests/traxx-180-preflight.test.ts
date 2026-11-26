/*
  The Write POD pre-flight (Traxx 1.8.0): the checks of tools/preflighttest.cpp, every limit at its
  boundary through the pure inputs (the limit passes, limit + 1 is reported). The limits are
  written out as numbers on purpose, so a typo in a constant is caught.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  engineFogSlotOverflow, pfEmptyInput, podPreflightCheck, podPreflightFallHasSound, podPreflightFormat, podPreflightLegacyWritten,
  PF_ERROR, PF_FALLFLAG_SOUND, PF_HD_NOBODY, PF_HD_NOHEADER, PF_HD_NONE, PF_HD_OK, PF_WARN,
  type PfAni, type PfBox, type PfInput, type PfList, type PfMap, type PfTex,
} from "../src/core/traxx/preflight.ts";

type Mut = { -readonly [K in keyof PfInput]: PfInput[K] } & { box: PfBox[]; tex: PfTex[]; ani: PfAni[]; map: PfMap[]; nCourseSeg: number[] };

function reset(): Mut {
  const i = pfEmptyInput() as Mut;
  i.stem = "TESTTRACK"; i.trackName = "Test Track"; i.weatherWritten = true; i.weatherMask = 1; i.bgmChecked = true;
  i.box = []; i.tex = []; i.ani = []; i.map = []; i.nCourseSeg = [0, 0, 0, 0, 0];
  return i;
}
function addBoxes(i: Mut, type: number, n: number): void {
  for (let k = 0; k < n; k++) i.box.push({ index: i.box.length + 1, type, model: null, sndImpact: null, sndCont: null, lightRad: 64, seq: 0, split: 0, lane: 0, hasModel: false, heightFt: 0 });
}
const count = (l: PfList, level: number, needle: string) => l.item.filter((x) => x.level === level && x.text.includes(needle)).length;
const boxesFlag = (type: number, n: number, level: number, needle: string) => { const i = reset(); addBoxes(i, type, n); return count(podPreflightCheck(i), level, needle) > 0 ? 1 : 0; };
function boundary(what: string, at: number, over: number): void {
  assert.equal(at, 0, `${what}: the limit passes`);
  assert.equal(over, 1, `${what}: limit+1 is reported`);
}
function oneTex(name: string, w: number, h: number, hd: number, hdw: number, hdh: number, legacy: boolean, extra: Partial<PfTex> = {}): Mut {
  const i = reset();
  i.tex.push({ name, w, h, type: 0, hdstate: hd, hdw, hdh, legacyWritten: legacy, model: false, ...extra });
  return i;
}
function oneAni(period: number, nframes: number, longest: number): Mut {
  const i = reset();
  i.ani.push({ period, nframes, longestName: longest, name: "W1.RAW" });
  return i;
}
function oneMap(stem: string, suffix: string, w: number, h: number): Mut {
  const i = reset();
  i.stem = stem;
  i.map.push({ suffix, extlen: 4, dimsKnown: w > 0, w, h });
  return i;
}

test("a clean track gives an empty list", () => {
  const l = podPreflightCheck(reset());
  assert.deepEqual([l.item.length, l.nerr, l.nwarn], [0, 0, 0]);
});

test(".SIT counts at their boundaries", () => {
  boundary("ramps 100", boxesFlag(99, 100, PF_ERROR, "Ramps"), boxesFlag(99, 101, PF_ERROR, "Ramps"));
  // Traxx origin/main: the engine holds 100 checkpoints (603e219).
  boundary("checkpoints 100", boxesFlag(6, 100, PF_ERROR, "Checkpoints"), boxesFlag(6, 101, PF_ERROR, "Checkpoints"));
  boundary("movers 103 (trains)", boxesFlag(10, 103, PF_ERROR, "Moving objects"), boxesFlag(10, 104, PF_ERROR, "Moving objects"));
  boundary("movers 103 (moving)", boxesFlag(13, 103, PF_ERROR, "Moving objects"), boxesFlag(13, 104, PF_ERROR, "Moving objects"));
  boundary("top-crush 100 (warning)", boxesFlag(98, 100, PF_WARN, "Top-crush"), boxesFlag(98, 101, PF_WARN, "Top-crush"));
  boundary("lights 128 (warning)", boxesFlag(12, 128, PF_WARN, "Lights:"), boxesFlag(12, 129, PF_WARN, "Lights:"));
  boundary("scenery 4509", boxesFlag(0, 4509, PF_ERROR, "Objects:"), boxesFlag(0, 4510, PF_ERROR, "Objects:"));
  assert.equal(boxesFlag(0, 4608, PF_ERROR, "Objects:"), 1);
  assert.equal(boxesFlag(0, 4700, PF_ERROR, "Objects:"), 1);
  const i = reset(); addBoxes(i, 0, 4509); addBoxes(i, 99, 100); addBoxes(i, 98, 100);
  assert.equal(count(podPreflightCheck(i), PF_ERROR, "Objects:"), 0, "ramps and top-crush do not count as scenery");
});

test("light radius", () => {
  const rad = [0.99, 1.0, 4095.0, 4096.0, 64.0];
  const e: number[] = [], w: number[] = [];
  for (const r of rad) {
    const i = reset(); addBoxes(i, 12, 1); i.box[0]!.lightRad = r;
    const l = podPreflightCheck(i);
    e.push(count(l, PF_ERROR, "Light radius under")); w.push(count(l, PF_WARN, "Light radius over"));
  }
  boundary("light radius 1.0 (error under)", e[1]!, e[0]!);
  boundary("light radius 4095 (warning over)", w[2]!, w[3]!);
  assert.ok(e[4] === 0 && w[4] === 0);
});

test("names: model 62, wav 63, menu 78, stem 18", () => {
  const run = (f: (i: Mut) => void, level: number, needle: string) => { const i = reset(); f(i); return count(podPreflightCheck(i), level, needle); };
  const one = (f: (b: PfBox) => void) => (i: Mut) => { addBoxes(i, 0, 1); f(i.box[0]!); };
  boundary("model name 62", run(one((b) => { b.model = "M".repeat(62); }), PF_ERROR, "Model name"), run(one((b) => { b.model = "M".repeat(63); }), PF_ERROR, "Model name"));
  boundary("impact wav 63", run(one((b) => { b.sndImpact = "W".repeat(63); }), PF_ERROR, "Sound file name"), run(one((b) => { b.sndImpact = "W".repeat(64); }), PF_ERROR, "Sound file name"));
  boundary("continuous wav 63", run(one((b) => { b.sndCont = "W".repeat(63); }), PF_ERROR, "Sound file name"), run(one((b) => { b.sndCont = "W".repeat(64); }), PF_ERROR, "Sound file name"));
  boundary("menu track name 78", run((i) => { i.trackName = "N".repeat(78); }, PF_ERROR, "Track name is"), run((i) => { i.trackName = "N".repeat(79); }, PF_ERROR, "Track name is"));
  boundary("stem 18 (warning)", run((i) => { i.stem = "S".repeat(18); }, PF_WARN, "Track file name"), run((i) => { i.stem = "S".repeat(19); }, PF_WARN, "Track file name"));
});

test("looping sounds", () => {
  const loops = (n: number, falls: number, stadium: boolean, snd = "HUM.WAV") => {
    const i = reset(); addBoxes(i, 0, n); i.box.forEach((b) => { b.sndCont = snd; }); i.nFallSounds = falls; i.stadium = stadium;
    return count(podPreflightCheck(i), PF_WARN, "Looping sounds");
  };
  boundary("looping sounds 30", loops(30, 0, false), loops(31, 0, false));
  boundary("28 boxes + waterfalls", loops(28, 2, false), loops(28, 3, false));
  boundary("29 boxes + the stadium crowd", loops(29, 0, true), loops(30, 0, true));
  assert.equal(podPreflightFallHasSound(PF_FALLFLAG_SOUND, "WATER"), true);
  assert.equal(podPreflightFallHasSound(0, "WATER"), false);
  assert.equal(podPreflightFallHasSound(PF_FALLFLAG_SOUND | 3, ""), false);
  assert.equal(podPreflightFallHasSound(PF_FALLFLAG_SOUND, null), false);
  assert.equal(loops(40, 0, false, "NULL.WAV"), 0, "NULL.WAV is no sound");
});

test("fog slots: 64, shared by the fog boxes and the waterfalls' mist", () => {
  const run = (fogs: number, land: number[] | null, other = 0) => { const i = reset(); addBoxes(i, 14, fogs); addBoxes(i, 0, other); i.mistLandings = land; return podPreflightCheck(i); };
  let land = [4, 4, 4];
  boundary("52 fogs + 12 mist = 64", count(run(52, land), PF_WARN, "Fog slots"), count(run(53, land), PF_WARN, "Fog slots"));
  const l = run(53, land);
  assert.equal(count(l, PF_WARN, "Waterfall 3 stream 4 mist"), 1);
  assert.ok(count(l, PF_WARN, "Waterfall 1 ") === 0 && count(l, PF_WARN, "Waterfall 2 ") === 0);
  assert.equal(count(l, PF_WARN, "53 fog volumes + 12 waterfall mist volumes = 65"), 1);
  land = [1, 2, 0];
  const l2 = run(63, land);
  assert.equal(count(l2, PF_WARN, "Waterfall 2 stream 1 mist, Waterfall 2 stream 2 mist"), 1, "stream 0 of every fall registers before stream 1");
  assert.equal(count(l2, PF_WARN, "Waterfall 1 "), 0);
  assert.equal(count(run(0, land, 70), PF_WARN, "Fog slots"), 0, "boxes that are not fog take none");
  assert.equal(count(run(64, [4, 4, 4, 4, 4, 4]), PF_WARN, " and 20 more"), 1, "a long list collapses");
  assert.equal(count(run(70, null), PF_WARN, "Fog slots"), 0, "no waterfall data, no warning");
  // The counting on its own (EngineFogSlotOverflow), as View > Statistics and the Waterfall window use it.
  const r = engineFogSlotOverflow(63, [1, 2, 0]);
  assert.deepEqual([r.dropped, r.totalMist, r.list], [2, 3, [{ fall: 1, stream: 0 }, { fall: 1, stream: 1 }]]);
  assert.equal(engineFogSlotOverflow(0, [9]).totalMist, 4);
});

test("course segments 249", () => {
  for (let c = 0; c < 5; c++) {
    const a = reset(); a.nCourseSeg[c] = 249;
    const b = reset(); b.nCourseSeg[c] = 250;
    boundary(`course ${c}`, podPreflightCheck(a).nerr > 0 ? 1 : 0, podPreflightCheck(b).nerr > 0 ? 1 : 0);
  }
});

test(".LVL: weather mask and stock BGM", () => {
  const run = (f: (i: Mut) => void) => { const i = reset(); f(i); return podPreflightCheck(i); };
  const a = count(run((i) => { i.weatherMask = 0; }), PF_ERROR, "Bad weather mask");
  const b = count(run((i) => { i.weatherMask = 0x200; }), PF_ERROR, "Bad weather mask");
  const c = count(run((i) => { i.weatherMask = 0x1ff; }), PF_ERROR, "Bad weather mask");
  assert.ok(a === 1 && b === 1 && c === 0);
  assert.equal(count(run((i) => { i.weatherMask = 1; }), PF_ERROR, "Bad weather mask"), 0);
  assert.equal(count(run((i) => { i.weatherMask = 0; i.weatherWritten = false; }), PF_ERROR, "Bad weather mask"), 0);

  const bgm = (name: string, checked = true) => run((i) => { i.stockBgm = name; i.bgmChecked = checked; });
  assert.equal(bgm("ROCKX.WAV").item.length, 0);
  assert.equal(count(bgm("ROCKX"), PF_ERROR, "no file extension"), 1);
  const aif = bgm("ROCKX.AIF");
  assert.ok(count(aif, PF_WARN, "default track") === 1 && aif.nerr === 0);
  assert.equal(count(bgm("MY SONG.WAV"), PF_ERROR, "has a space"), 1);
  assert.equal(bgm("MY.SONG.MP3").item.length, 0);
  assert.equal(count(bgm("ROCKX.WAV.AIF"), PF_WARN, "default track"), 1);
  assert.equal(bgm("ROCKX", false).item.length, 0);
  boundary("BGM token 39", count(bgm(`${"B".repeat(35)}.WAV`), PF_ERROR, "characters. The game cuts it"), count(bgm(`${"B".repeat(36)}.WAV`), PF_ERROR, "characters. The game cuts it"));

  boundary(".TEX count 4096", count(run((i) => { i.texCount = 4096; }), PF_ERROR, "Terrain textures"), count(run((i) => { i.texCount = 4097; }), PF_ERROR, "Terrain textures"));
});

test("textures", () => {
  const sizes = [[32, 32], [64, 64], [256, 256], [128, 128], [512, 512], [1024, 1024], [64, 32]];
  const expect = [0, 0, 0, 1, 1, 1, 1];
  sizes.forEach(([w, h], k) => assert.equal(count(podPreflightCheck(oneTex("A.RAW", w!, h!, PF_HD_NONE, 0, 0, true)), PF_ERROR, "Texture size"), expect[k], `.RAW ${w}x${h}`));
  assert.equal(count(podPreflightCheck(oneTex("A.RAW", 128, 128, PF_HD_OK, 256, 256, true)), PF_ERROR, "Texture size"), 0);
  assert.equal(count(podPreflightCheck(oneTex("A.RAW", 128, 128, PF_HD_NONE, 0, 0, false)), PF_ERROR, "Texture size"), 0);

  const c = (i: Mut, level: number, needle: string) => count(podPreflightCheck(i), level, needle);
  boundary("undecodable HD with and without a .RAW", c(oneTex("A.RAW", 64, 64, PF_HD_NOBODY, 0, 0, true), PF_ERROR, "HD texture will not read"), c(oneTex("A.RAW", 64, 64, PF_HD_NOBODY, 0, 0, false), PF_ERROR, "HD texture will not read"));
  assert.equal(c(oneTex("A.RAW", 64, 64, PF_HD_NOHEADER, 0, 0, false), PF_ERROR, "HD texture file will not read"), 1);
  const m = podPreflightCheck(oneTex("A.RAW", 64, 64, PF_HD_NOHEADER, 0, 0, false, { model: true }));
  assert.ok(m.nerr === 0 && count(m, PF_WARN, "RUSTPLAT") === 1);
  assert.equal(podPreflightCheck(oneTex("A.RAW", 64, 64, PF_HD_NOHEADER, 0, 0, true)).item.length, 0);
  assert.equal(c(oneTex("A.RAW", 64, 64, PF_HD_NOBODY, 0, 0, false, { model: true }), PF_ERROR, "HD texture will not read"), 1);

  boundary("HD 2048 (warning)", c(oneTex("A.RAW", 64, 64, PF_HD_OK, 2048, 2048, true), PF_WARN, "over 2048"), c(oneTex("A.RAW", 64, 64, PF_HD_OK, 2049, 2049, true), PF_WARN, "over 2048"));
  assert.equal(c(oneTex("A.RAW", 64, 64, PF_HD_OK, 1024, 2049, true), PF_WARN, "over 2048"), 1);
  boundary("HD square (warning)", c(oneTex("A.RAW", 64, 64, PF_HD_OK, 512, 512, true), PF_WARN, "not square"), c(oneTex("A.RAW", 64, 64, PF_HD_OK, 512, 256, true), PF_WARN, "not square"));
  boundary("HD true colour 128 (warning)", c(oneTex("A.RAW", 64, 64, PF_HD_OK, 128, 128, true), PF_WARN, "under 128"), c(oneTex("A.RAW", 64, 64, PF_HD_OK, 127, 127, true), PF_WARN, "under 128"));
  boundary("upper case texture name with a ground type", c(oneTex("GRASS.RAW", 64, 64, PF_HD_NONE, 0, 0, true, { type: 1 }), PF_WARN, "lower case"), c(oneTex("Grass.RAW", 64, 64, PF_HD_NONE, 0, 0, true, { type: 1 }), PF_WARN, "lower case"));
  assert.equal(c(oneTex("Grass.RAW", 64, 64, PF_HD_NONE, 0, 0, true, { type: 0 }), PF_WARN, "lower case"), 0);

  const i = reset();
  for (let k = 1; k <= 8; k++) i.tex.push({ name: `T${k}.RAW`, w: 128, h: 128, type: 0, hdstate: 0, hdw: 0, hdh: 0, legacyWritten: true, model: false });
  const l = podPreflightCheck(i);
  assert.ok(l.item.length === 1 && l.item[0]!.text.includes("and 4 more"), "eight bad textures are one line");
});

test("maps", () => {
  const c = (i: Mut, level: number, needle: string) => count(podPreflightCheck(i), level, needle);
  boundary("ART stem _MASK.PNG in 31", c(oneMap("S".repeat(18), "_MASK", 0, 0), PF_ERROR, "cannot be packed"), c(oneMap("S".repeat(19), "_MASK", 0, 0), PF_ERROR, "cannot be packed"));
  boundary("ART stem _WMSK / _WDTL", c(oneMap("S".repeat(18), "_WMSK", 0, 0), PF_ERROR, "cannot be packed"), c(oneMap("S".repeat(19), "_WDTL", 0, 0), PF_ERROR, "cannot be packed"));
  assert.equal(c(oneMap("S".repeat(19), "_DTL", 0, 0), PF_ERROR, "cannot be packed"), 0);
  assert.equal(c(oneMap("S".repeat(20), "_DTL", 0, 0), PF_ERROR, "cannot be packed"), 1);
  ["_MASK", "_WMSK", "_DTL", "_WDTL"].forEach((sfx, k) => {
    const a = c(oneMap("TESTTRACK", sfx, 16384, 16384), PF_WARN, "graphics card");
    const b = c(oneMap("TESTTRACK", sfx, 16385, 16384), PF_WARN, "graphics card");
    if (k < 2) boundary(`map ${sfx} 16384`, a, b);
    else assert.ok(a === 0 && b === 0);
  });
});

test("animations", () => {
  const c = (i: Mut, needle: string) => count(podPreflightCheck(i), PF_ERROR, needle);
  assert.equal(podPreflightCheck(oneAni(1, 4, 15)).item.length, 0);
  boundary("frame time > 0", c(oneAni(1, 4, 8), "no frame time"), c(oneAni(0, 4, 8), "no frame time"));
  boundary("frames >= 1", c(oneAni(1, 1, 8), "no frames"), c(oneAni(1, 0, 8), "no frames"));
  boundary("frames 8", c(oneAni(1, 8, 8), "more than 8"), c(oneAni(1, 9, 8), "more than 8"));
  boundary("frame name 15", c(oneAni(1, 2, 15), "frame name over"), c(oneAni(1, 2, 16), "frame name over"));
  const many = (n: number) => { const i = reset(); for (let k = 0; k < n; k++) i.ani.push({ period: 1, nframes: 2, longestName: 5, name: "W.RAW" }); return i; };
  boundary("animated textures 64", c(many(64), "Animated textures:"), c(many(65), "Animated textures:"));
});

test("which textures lose their .RAW; errors first; the text", () => {
  assert.equal(podPreflightLegacyWritten(false, true, false), true);
  assert.equal(podPreflightLegacyWritten(true, false, false), true);
  assert.equal(podPreflightLegacyWritten(true, true, false), false);
  assert.equal(podPreflightLegacyWritten(true, false, true), false);
  const i = reset(); addBoxes(i, 98, 101); addBoxes(i, 99, 101);
  const l = podPreflightCheck(i);
  assert.ok(l.item.length === 2 && l.item[0]!.level === PF_ERROR && l.item[1]!.level === PF_WARN);
  assert.ok(l.nerr === 1 && l.nwarn === 1);
  const text = podPreflightFormat(l);
  assert.ok(text.startsWith("ERROR") && text.includes("Warning"));
});

test("gathering a document: boxes, courses, weather, stock music, no falls", async () => {
  const { newTrackDocument } = await import("../src/core/doc/new-track.ts");
  const { gatherPreflight, podPreflightRun } = await import("../src/core/doc/preflight-gather.ts");
  const { traxxBoxDefaults } = await import("../src/core/traxx/sit.ts");
  const doc = newTrackDocument();
  const t = doc.track;
  const lamp = traxxBoxDefaults(); lamp.type = 12; lamp.light.radius = 0.5; lamp.modelName = "LAMP.BIN";
  t.boxes = [lamp];
  t.versionFlags |= 1; t.weatherMask = 0;
  t.music = new Uint8Array([...new TextEncoder().encode("MUSIC\\MY SONG.WAV"), 0]);
  const inp = gatherPreflight(doc);
  assert.deepEqual(inp.box[0], { index: 1, type: 12, model: "LAMP.BIN", sndImpact: "NULL.WAV", sndCont: "NULL.WAV", lightRad: 0.5, seq: 0, split: 0, lane: 0, hasModel: true, heightFt: 20 });
  assert.deepEqual([inp.raceRules, inp.wall, inp.worldCells, inp.isV6, inp.leadinLane], [0, [], 256, false, [0, 0, 0, 0, 0]]);
  assert.equal(inp.stockBgm, "MY SONG.WAV");
  assert.equal(inp.mistLandings, null);
  const l = podPreflightRun(doc);
  assert.ok(l.item.some((i) => i.text.startsWith("Light radius under 1 ft: Object #1 (LAMP.BIN).")));
  assert.ok(l.item.some((i) => i.text.includes("Bad weather mask")));
  assert.ok(l.item.some((i) => i.text.includes("has a space")));
});

/*
  Traxx origin/main (1.8.2-beta) preflighttest.cpp: the race rules, walls, lead-ins, the checkpoint caps and a version 6
  track's 16,384 objects.
*/
import { RACERULES_DRAG, RACERULES_NONE, RACERULES_PARALLEL, RACERULES_RACE } from "../src/core/traxx/race-types.ts";
import type { PfWall } from "../src/core/traxx/preflight.ts";

type MutRace = Mut & { raceRules?: number; wall?: PfWall[]; worldCells?: number; isV6?: boolean; leadinLane?: number[] };

/* `slots` checkpoints of `copies` boxes each, race rules `mode`; the list. A drag's first three slots are unsplit; a copied slot is split "any copy". */
function raceSlots(mode: number, slots: number, copies: number): PfList {
  const i = reset() as MutRace;
  i.raceRules = mode;
  for (let s = 0; s < slots; s++) {
    const one = copies === 1 || (mode === RACERULES_DRAG && s < 3);
    for (let c = 0; c < (one ? 1 : copies); c++) {
      addBoxes(i, 6, 1);
      const b = i.box[i.box.length - 1]!;
      b.seq = s + 1; b.split = one ? 0 : 1; b.lane = 0;
    }
  }
  return podPreflightCheck(i);
}
const raceErrors = (mode: number, slots: number, copies: number, needle: string) => count(raceSlots(mode, slots, copies), PF_ERROR, needle);

test("checkpoints: 100 slots with the rules on, 100 boxes with them off, and the more-than-20 warning", () => {
  assert.equal(raceErrors(RACERULES_DRAG, 100, 2, "Checkpoints"), 0, "race slots 100 (2 copies each)");
  assert.equal(raceErrors(RACERULES_DRAG, 101, 2, "Checkpoints"), 1);
  assert.equal(raceErrors(RACERULES_DRAG, 100, 2, "Race rules"), 0, "a valid drag map says nothing");
  assert.equal(raceErrors(RACERULES_PARALLEL, 100, 8, ""), 0, "100 slots of 8 copies (800 boxes): no error");
  assert.equal(raceErrors(RACERULES_RACE, 100, 8, "Race rules"), 0);
  assert.equal(raceErrors(RACERULES_RACE, 101, 8, "Race rules"), 1, "race boxes 800 (100 slots of 8)");
  assert.equal(raceErrors(RACERULES_PARALLEL, 100, 9, "Race rules"), 1, "9 copies of a slot");
  assert.equal(raceErrors(RACERULES_DRAG, 3, 1, "Race rules"), 1, "a drag with 3 slots");
  assert.equal(raceErrors(RACERULES_DRAG, 3, 1, "at least 4 checkpoints"), 1, "the drag message carries CpxValidate's text");
  assert.equal(raceErrors(RACERULES_PARALLEL, 3, 1, "Race rules"), 0);
  assert.equal(raceErrors(RACERULES_NONE, 101, 1, "Checkpoints: 101, the most the game can hold is 100"), 1);
  assert.equal(raceErrors(RACERULES_NONE, 3, 1, "Race rules"), 0);
  assert.equal(raceErrors(RACERULES_PARALLEL, 140, 1, "Checkpoints: 140"), 1, "rules on: the message counts slots, not boxes");
  const l = raceSlots(RACERULES_NONE, 101, 1);
  assert.equal(l.item.find((x) => x.text.startsWith("Checkpoints:"))!.text,
    "Checkpoints: 101, the most the game can hold is 100. The game refuses the next one and quits on load with \"Too many checkpoints\" (older game versions hold only 20, and first write the 21st past the end of their list and overrun memory).");
  const warn = (mode: number, slots: number, copies: number, needle: string) => { const r = raceSlots(mode, slots, copies); return [count(r, PF_ERROR, ""), count(r, PF_WARN, needle)]; };
  assert.deepEqual(warn(RACERULES_PARALLEL, 10, 3, "This track has 30 checkpoint boxes"), [0, 1]);
  assert.deepEqual(warn(RACERULES_PARALLEL, 10, 2, "checkpoint boxes (more than 20)"), [0, 0]);
  assert.deepEqual(warn(RACERULES_NONE, 21, 1, "This track has 21 checkpoint boxes (more than 20). Only new builds can load it: retail MTM2 won't list it, older community builds refuse it, and builds before 2026-11-15 may crash on it."), [0, 1]);
  assert.deepEqual(warn(RACERULES_NONE, 20, 1, "checkpoint boxes (more than 20)"), [0, 0]);
  assert.deepEqual(warn(RACERULES_NONE, 100, 1, "This track has 100 checkpoint boxes"), [0, 1]);
  assert.deepEqual(warn(RACERULES_NONE, 101, 1, "This track has 101 checkpoint boxes"), [1, 1]);
});

test("the race-rules checkpoint height: a plain box under 8 ft warns on drag and Parallel only", () => {
  const warns = (mode: number, heightFt: number, model: boolean) => {
    const i = reset() as MutRace;
    i.raceRules = mode;
    addBoxes(i, 6, 1);
    Object.assign(i.box[0]!, { seq: 1, hasModel: model, heightFt });
    return podPreflightCheck(i).item.filter((x) => x.level === PF_WARN && x.text.includes("at least 8 ft"));
  };
  assert.equal(warns(RACERULES_PARALLEL, Math.fround(7.9), false).length, 1);
  assert.equal(warns(RACERULES_PARALLEL, Math.fround(7.9), false)[0]!.text, "Checkpoint box 1 is 7.9 ft tall; race-rules checkpoints should be at least 8 ft (a truck's height) or trucks may pass without being counted.");
  assert.equal(warns(RACERULES_PARALLEL, 8, false).length, 0);
  assert.equal(warns(RACERULES_DRAG, 5, false).length, 1);
  assert.equal(warns(RACERULES_PARALLEL, 0, true).length, 0, "a model checkpoint is skipped");
  assert.equal(warns(RACERULES_NONE, 2, false).length, 0);
  assert.equal(warns(RACERULES_RACE, 2, false).length, 0, "split checkpoints: no height warning");
});

test("walls: a warning with the rules off or on split checkpoints, an error per defect on drag and Parallel", () => {
  const good = (name = "w"): PfWall => ({ name, npoints: 2, closed: false, thickness: 256, height: 2048, exportCount: 6, maxStretchFt: 40, outOfWorld: false });
  const run = (mode: number, walls: PfWall[], cells?: number) => { const i = reset() as MutRace; i.raceRules = mode; i.wall = walls; if (cells) i.worldCells = cells; return podPreflightCheck(i); };
  let l = run(RACERULES_NONE, [good(), good()]);
  assert.equal(count(l, PF_WARN, "Walls are only exported on new-style drag or Parallel tracks; this track's 2 walls will not be in the pod."), 1);
  assert.equal(count(l, PF_ERROR, ""), 0);
  assert.equal(count(run(RACERULES_NONE, []), PF_WARN, "Walls are only"), 0);
  l = run(RACERULES_PARALLEL, [good()]);
  assert.equal(count(l, PF_WARN, "Walls are only") + count(l, PF_ERROR, "Wall \""), 0, "a sound wall is silent");
  const one = (f: (w: PfWall) => void, needle: string) => { const w = good(); f(w); return count(run(RACERULES_PARALLEL, [w]), PF_ERROR, needle); };
  boundary("wall points >= 2", one((w) => { w.npoints = 2; }, "at least 2"), one((w) => { w.npoints = 1; w.exportCount = 0; }, "at least 2"));
  boundary("closed wall points >= 3", one((w) => { w.closed = true; w.npoints = 3; }, "closed with"), one((w) => { w.closed = true; w.npoints = 2; }, "closed with"));
  boundary("wall thickness > 0", one((w) => { w.thickness = 1; }, "no thickness"), one((w) => { w.thickness = 0; }, "no thickness"));
  boundary("wall height > 0", one((w) => { w.height = 1; }, "no height"), one((w) => { w.height = 0; }, "no height"));
  boundary("wall stretch 4096 ft", one((w) => { w.maxStretchFt = 4096; }, "stretch of"), one((w) => { w.maxStretchFt = 4096.5; }, "stretch of"));
  boundary("wall export points 1024", one((w) => { w.exportCount = 1024; }, "once subdivided (the most"), one((w) => { w.exportCount = -1; }, "once subdivided (the most"));
  const eight = Array.from({ length: 8 }, () => ({ ...good(), exportCount: 1024 }));
  boundary("walls export total 8192", count(run(RACERULES_PARALLEL, eight), PF_ERROR, "in all once subdivided"),
    count(run(RACERULES_PARALLEL, [...eight, { ...good(), exportCount: 1 }]), PF_ERROR, "in all once subdivided"));
  const out = { ...good("lake"), outOfWorld: true };
  assert.equal(count(run(RACERULES_PARALLEL, [good("lake")]), PF_ERROR, "goes outside the world"), 0);
  assert.equal(count(run(RACERULES_PARALLEL, [out]), PF_ERROR, "Wall \"lake\" goes outside the world (0 to 8192 ft)"), 1);
  assert.equal(count(run(RACERULES_PARALLEL, [out], 512), PF_ERROR, "Wall \"lake\" goes outside the world (0 to 16384 ft)"), 1);
  assert.equal(count(run(RACERULES_NONE, [out]), PF_ERROR, "goes outside the world"), 0);
  boundary("open wall distinct points >= 2", one((w) => { w.exportCount = 2; }, "distinct points"), one((w) => { w.exportCount = 0; }, "distinct points"));
  boundary("closed wall distinct points >= 3", one((w) => { w.closed = true; w.npoints = 3; w.exportCount = 3; }, "distinct points"), one((w) => { w.closed = true; w.npoints = 3; w.exportCount = 2; }, "distinct points"));
  assert.equal(count(run(RACERULES_PARALLEL, [{ ...good("inner"), height: 0 }]), PF_ERROR, "Wall \"inner\""), 1);
  l = run(RACERULES_RACE, [good(), { ...good(), height: 0, outOfWorld: true }]);
  assert.equal(count(l, PF_WARN, "this track's 2 walls will not be in the pod."), 1);
  assert.equal(count(l, PF_ERROR, "Wall \"") + count(l, PF_ERROR, "outside the world"), 0);
});

test("lead-ins: an empty lead-in or lane course warns on drag and Parallel; with the rules off one warning", () => {
  const run = (mode: number, lanes: number[], segs: number[]) => { const i = reset() as MutRace; i.raceRules = mode; i.leadinLane = lanes; i.nCourseSeg = segs; return podPreflightCheck(i); };
  let l = run(RACERULES_PARALLEL, [0, 0, 2, 0, 0], [0, 4, 3, 0, 0]);
  assert.equal(count(l, PF_WARN, "is a lead-in") + count(l, PF_WARN, "Lead-ins are only"), 0);
  assert.equal(count(run(RACERULES_PARALLEL, [0, 0, 2, 0, 0], [0, 4, 0, 0, 0]), PF_WARN, "Course 2 is a lead-in but has no segments."), 1);
  assert.equal(count(run(RACERULES_PARALLEL, [0, 0, 2, 0, 0], [0, 0, 3, 0, 0]), PF_WARN, "Course 2 is a lead-in for Lane 2, but Lane 2's course has no segments."), 1);
  assert.equal(count(run(RACERULES_PARALLEL, [0, 0, 0, 0, 1], [0, 0, 3, 0, 2]), PF_WARN, "Course 4 is a lead-in for Lane 1, but Lane 1's course has no segments."), 1);
  l = run(RACERULES_DRAG, [0, 0, 0, 1, 0], [0, 0, 0, 0, 0]);
  assert.equal(count(l, PF_WARN, "Course 3 is a lead-in but has no segments."), 1);
  assert.equal(count(l, PF_WARN, "but Lane"), 0, "one warning per lead-in");
  for (const mode of [RACERULES_NONE, RACERULES_RACE]) {
    l = run(mode, [0, 0, 1, 2, 0], [0, 0, 0, 0, 0]);
    assert.equal(count(l, PF_WARN, "Lead-ins are only used on new-style drag and Parallel tracks; they will not be in the pod."), 1);
    assert.equal(count(l, PF_WARN, "is a lead-in"), 0);
  }
  assert.equal(count(run(RACERULES_NONE, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]), PF_WARN, "Lead-ins are only"), 0);
});

test("split checkpoints (RACE): the map check runs, a lane is an error", () => {
  assert.equal(raceErrors(RACERULES_RACE, 3, 2, "Race rules"), 0);
  assert.equal(raceErrors(RACERULES_RACE, 3, 1, "Race rules"), 0);
  assert.equal(raceErrors(RACERULES_RACE, 101, 1, "Checkpoints: 101, the most the game can hold is 100"), 1);
  const i = reset() as MutRace;
  i.raceRules = RACERULES_RACE;
  addBoxes(i, 6, 3);
  i.box.forEach((b, k) => { b.seq = k === 2 ? 2 : 1; b.heightFt = 10; });
  Object.assign(i.box[0]!, { split: 2, lane: 1 });
  Object.assign(i.box[1]!, { split: 2, lane: 2 });
  const l = podPreflightCheck(i);
  assert.equal(count(l, PF_ERROR, "Race rules: "), 1);
  assert.equal(count(l, PF_ERROR, "no lanes"), 1);
});

test("a version 6 track holds 16,384 objects", () => {
  for (const n of [4510, 4609, 8000, 16384]) {
    const i = reset() as MutRace; i.isV6 = true; addBoxes(i, 0, n);
    assert.equal(count(podPreflightCheck(i), PF_ERROR, "Objects:"), 0, `v6: ${n}`);
  }
  const i = reset() as MutRace; i.isV6 = true; addBoxes(i, 0, 16385);
  const l = podPreflightCheck(i);
  assert.equal(count(l, PF_ERROR, "Objects:"), 1);
  assert.equal(count(l, PF_ERROR, "Objects: 16385 (ramps and top-crush not counted). A version 6 track holds 16384 objects; the game keeps the first 16384 and drops the rest. Stay at 16384 or fewer."), 1);
  const j = reset() as MutRace; j.isV6 = true; addBoxes(j, 0, 16384); addBoxes(j, 99, 100); addBoxes(j, 98, 100);
  assert.equal(count(podPreflightCheck(j), PF_ERROR, "Objects:"), 0);
  assert.equal(boxesFlag(0, 4510, PF_ERROR, "Objects:"), 1, "classic still errors at 4510");
});
