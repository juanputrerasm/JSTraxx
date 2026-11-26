/*
  Traxx origin/main's version 6 editor UI (1.8.2 beta): File > New's tree and its id decoding, Special > Track
  Type's note and the window title's kind, Special > Enlarge World's question and report, and the boxes that
  take heights in feet on a v6 track (TraxxFrame.cpp, RaiseLowerDlg.cpp, TerrainGenDlg.cpp, TruckPropertiesDlg.cpp,
  TraxxTransitionsDlg.cpp, TraxxComponentsDlg.cpp, LakeDlg.cpp, WaterfallDlg.cpp).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { decodeFileNewV6, enlargeIdList, enlargeWorldQuestion, enlargeWorldReport, FILE_NEW_V6_IDS, trackTitleTag, trackTypeClassicEnabled, trackTypeDialogNote, NEW_512_NO_MEMORY } from "../src/core/traxx/track-kind-ui.ts";
import { CommandRegistry, MAIN_MENU, registerTraxxCommands, type MenuItem } from "../src/ui/shell/commands.ts";
import {
  amplitudeFeetFromText, amplitudeFeetRange, amplitudeFeetText, amplitudeLimit, boxBottomOnLeave, boxBottomWhileTyping, boxTopOnLeave, boxTopWhileTyping,
  followAmplitude, followBoxBar, followTransitions, stepAmplitudeFeet, transitionFeet, transitionFeetStep, truckZFromFeet, truckZStep, waterFeetText,
  waterFromFeet, waterUnitsStep, zIndicatorText,
} from "../src/core/edit/feet-fields.ts";
import { adjustHeights, effectiveIncrementV, effectiveScaleV, liftHeightV, scaleHeightV } from "../src/core/edit/terrain.ts";
import { genFeetParams, genFeetStart, genPosFromV, genVFromPos, terrainGenPreview, terrainGenV } from "../src/core/edit/terrain-gen16.ts";
import { fallBoxTexts, fallHeightText, fallSourceOptions } from "../src/core/edit/fall-properties.ts";
import { fallDefaults } from "../src/core/traxx/falls.ts";
import { TERRAINMODE_CLASSIC16, TERRAINMODE_FINE, TERRAINMODE_SPLINE } from "../src/core/traxx/terrain16.ts";
import { TERRAIN_H_TALL_MAX } from "../src/core/traxx/world.ts";
import { AMPLITUDE_MAXV } from "../src/core/edit/terrain.ts";

test("File > New > World Size decodes as OnFileNewV6: size = off / 6, tall = (off / 3) % 2, grid = off % 3", () => {
  assert.equal(FILE_NEW_V6_IDS.length, 12);
  assert.equal(FILE_NEW_V6_IDS[0], "ID_FILE_NEW_V6_256_STD_C16");
  assert.equal(FILE_NEW_V6_IDS[11], "ID_FILE_NEW_V6_512_TALL_FINE");
  assert.deepEqual(decodeFileNewV6("ID_FILE_NEW_V6_256_STD_C16"), { cells: 256, kind: "standard", grid: 0, mode: TERRAINMODE_CLASSIC16 });
  assert.deepEqual(decodeFileNewV6("ID_FILE_NEW_V6_256_TALL_SPL"), { cells: 256, kind: "tall", grid: 1, mode: TERRAINMODE_SPLINE });
  assert.deepEqual(decodeFileNewV6("ID_FILE_NEW_V6_512_STD_FINE"), { cells: 512, kind: "standard", grid: 2, mode: TERRAINMODE_FINE });
  assert.deepEqual(decodeFileNewV6("ID_FILE_NEW_V6_512_TALL_C16"), { cells: 512, kind: "tall", grid: 0, mode: TERRAINMODE_CLASSIC16 });
  for (const id of FILE_NEW_V6_IDS) {
    const d = decodeFileNewV6(id)!;
    assert.equal(id, `ID_FILE_NEW_V6_${d.cells}_${d.kind === "tall" ? "TALL" : "STD"}_${["C16", "SPL", "FINE"][d.grid]}`);
  }
  assert.equal(decodeFileNewV6("ID_FILE_NEW"), null);
  assert.equal(NEW_512_NO_MEMORY, "There isn't enough memory for a 512 x 512 world; this new track is 256 x 256.");
});

const registry = () => { const r = new CommandRegistry({ emit() {} } as never); registerTraxxCommands(r); return r; };
const popup = (items: MenuItem[], label: string) => items.find((i): i is { label: string; items: MenuItem[] } => typeof i === "object" && "items" in i && i.label === label)!;

test("File > New is Traxx's tree, with the string table's captions and prompts", () => {
  const file = MAIN_MENU.find((m) => m.label === "&File")!;
  const fresh = popup(file.items, "&New");
  assert.deepEqual(fresh.items.map((i) => (typeof i === "object" && "label" in i ? i.label : i)), ["&Classic", "World Size &256", "World Size &512"]);
  assert.deepEqual(popup(fresh.items, "&Classic").items, ["ID_FILE_NEW", "ID_FILE_NEW_CLASSIC16", "ID_FILE_NEW_SPLINE", "ID_FILE_NEW_FINE"]);
  const w512 = popup(fresh.items, "World Size &512");
  assert.deepEqual(popup(w512.items, "&Tall Heights V6").items, ["ID_FILE_NEW_V6_512_TALL_C16", "ID_FILE_NEW_V6_512_TALL_SPL", "ID_FILE_NEW_V6_512_TALL_FINE"]);
  assert.deepEqual(popup(popup(fresh.items, "World Size &256").items, "&Standard V6").items, ["ID_FILE_NEW_V6_256_STD_C16", "ID_FILE_NEW_V6_256_STD_SPL", "ID_FILE_NEW_V6_256_STD_FINE"]);
  const r = registry();
  assert.equal(r.get("ID_FILE_NEW_WORLD"), undefined);
  assert.equal(r.get("ID_FILE_NEW")!.label, "&Traditional 8-bit");
  assert.equal(r.get("ID_FILE_NEW")!.shortcut, "Ctrl+N");
  assert.equal(r.get("ID_FILE_NEW_FINE")!.prompt, "Create a Classic track with the Precision 8 ft grid and 16-bit Heights Full Map terrain grid");
  assert.equal(r.get("ID_FILE_NEW_SPLINE")!.tip, "New Finer Heights 16-bit Spline");
  assert.equal(r.get("ID_FILE_NEW_V6_256_STD_C16")!.prompt, "Create a Standard V6 track (precise ground boxes), World Size 256, with Finer Heights 16-bit");
  assert.equal(r.get("ID_FILE_NEW_V6_512_TALL_FINE")!.prompt, "Create a Tall Heights V6 track (up to 8,192 ft, precise ground boxes), World Size 512, with Precision 8 ft grid and 16-bit Heights Full Map");
  assert.equal(r.get("ID_FILE_NEW_V6_512_TALL_FINE")!.tip, "New Tall Heights V6");
  assert.equal(r.get("ID_FILE_NEW_V6_256_STD_SPL")!.label, "Finer Heights 16-bit &Spline");
});

test("Special: Terrain Grid's new names, then Track Type and Enlarge World", () => {
  const special = MAIN_MENU.find((m) => m.label === "&Special")!;
  const grid = popup(special.items, "Terrain &Grid");
  assert.equal(special.items.indexOf(grid) + 1, special.items.indexOf("ID_SPECIAL_TRACKTYPE"));
  assert.equal(special.items.at(-1), "ID_SPECIAL_ENLARGEWORLD");
  const r = registry();
  assert.equal(r.get("ID_TERRAIN_GRID_CLASSIC8")!.label, "Traditional 8-bit");
  assert.equal(r.get("ID_TERRAIN_GRID_FINE")!.label, "Precision 8 ft grid and 16-bit Heights Full Map");
  assert.equal(r.get("ID_TERRAIN_GRID_CLASSIC16")!.prompt, "Convert the terrain to Finer Heights 16-bit on the 32 ft triangle grid");
  assert.equal(r.get("ID_TERRAIN_GRID_SPLINE")!.tip, "Finer Heights 16-bit Spline");
  assert.equal(r.get("ID_TERRAIN_HEIGHTSPNG")!.prompt, "Write POD stores this track's heights as a grayscale PNG (16-bit, or 8-bit on Traditional 8-bit).");
  assert.equal(r.get("ID_SPECIAL_TRACKTYPE")!.label, "Track &Type...");
  assert.equal(r.get("ID_SPECIAL_TRACKTYPE")!.prompt, "Choose Classic, Standard V6 or Tall Heights V6 for this track");
  assert.equal(r.get("ID_SPECIAL_ENLARGEWORLD")!.label, "&Enlarge World to 512 x 512...");
  assert.equal(r.get("ID_SPECIAL_ENLARGEWORLD")!.prompt, "Make this track's world 512 x 512; the track stays in the corner");
});

test("the title's kind and the Track Type note", () => {
  assert.equal(trackTitleTag({}), "");
  assert.equal(trackTitleTag({ trackKind: "classic" }), "");
  assert.equal(trackTitleTag({ trackKind: "standard" }), " [v6 precise boxes]");
  assert.equal(trackTitleTag({ trackKind: "tall", worldCells: 512 }), " [v6 tall]");
  assert.equal(trackTypeDialogNote("classic", 256), "Works with retail, Community Patch 3 and Community Patch 4.");
  assert.equal(trackTypeDialogNote("tall", 256), "Version 6 tracks need Community Patch 4. Retail and Community Patch 3 won't list this track.");
  assert.equal(trackTypeDialogNote("standard", 512), "Classic tracks are 256 x 256; this track is 512.\r\nVersion 6 tracks need Community Patch 4. Retail and Community Patch 3 won't list this track.");
  assert.equal(trackTypeClassicEnabled(256), true);
  assert.equal(trackTypeClassicEnabled(512), false);
});

test("Enlarge World's question and its report", () => {
  const tail = "Along the old world's east and south edges the ground used to join the far side of the world; it now meets the new flat ground, so check those edges.\n\n"
    + "Undo is cleared, and this can't be undone. Save first if you want to keep the 256 x 256 version.";
  const head = "Enlarge this track's world to 512 x 512 (16,384 ft)?\n\nThe track stays where it is, in the corner from 0 to 8,192 ft. The new space is flat ground with the first texture.\n\n";
  assert.equal(enlargeWorldQuestion({ trackKind: "standard", groundBoxes: [], falls: [] }), head + tail);
  const spring = { ...fallDefaults(), source: 0, height: 2000 };
  const q = enlargeWorldQuestion({ groundBoxes: [{ lower: 100, upper: 300 }, { lower: 70000, upper: 80000 }], falls: [spring, spring] });
  assert.equal(q, head + "The track becomes a version 6 track (Standard V6). Retail Monster Truck Madness 2 and Community Patch 3 won't list it."
    + "\n1 ground boxes will be adjusted (heights rounded to 2 ft steps or kept in range).\n2 waterfalls will be lowered to 511.5 ft.\n\n" + tail);
  assert.equal(enlargeIdList([2, 5]), "#2, #5");
  assert.equal(enlargeWorldReport({ lakes: [], falls: [], reason: "" }), "");
  assert.equal(enlargeWorldReport({ lakes: [2, 5], falls: [1], reason: "" }), "The world is now 512 x 512.\n\nThese lakes hold their water differently now: #2, #5.\nThese waterfalls need attention: #1."
    + "\n\nThey were next to the old world's edge, which now meets the new flat ground. Nothing was moved; fix them by hand.");
  assert.equal(enlargeWorldReport({ lakes: [], falls: [], reason: "Why." }), "The world is now 512 x 512.\n\n\nWhy.");
});

test("the Altitude box in feet: Plane 0..limit, the rest +-limit, 1 ft a click", () => {
  assert.equal(amplitudeLimit(false, 65535), AMPLITUDE_MAXV);
  assert.equal(amplitudeLimit(true, TERRAIN_H_TALL_MAX), TERRAIN_H_TALL_MAX);
  assert.deepEqual(amplitudeFeetRange(6, 65535), [0, 65535]);
  assert.deepEqual(amplitudeFeetRange(0, 65535), [-65535, 65535]);
  assert.equal(amplitudeFeetFromText("12,5"), 1600);
  assert.equal(amplitudeFeetFromText("junk"), 0);
  assert.equal(amplitudeFeetText(-4096, amplitudeFeetRange(6, 65535)), "0.00");
  assert.equal(amplitudeFeetText(70000, amplitudeFeetRange(0, 65535)), "511.99");
  assert.equal(stepAmplitudeFeet("10.00", 1, [-65535, 65535]), 11 * 128);
  assert.equal(stepAmplitudeFeet("511.5", 1, [-65535, 65535]), 65535);
  // FollowAmplitudeKind: into a v6 limit, and back out to 255 steps (whole on Traditional 8-bit).
  assert.equal(followAmplitude(-300 * 256, 6, 65535, true), 0);
  assert.equal(followAmplitude(4000 * 256, 0, TERRAIN_H_TALL_MAX, true), 4000 * 256);
  assert.equal(followAmplitude(4000 * 256, 0, 0, true), AMPLITUDE_MAXV);
  assert.equal(followAmplitude(10 * 256 + 100, 0, 0, false), 10 * 256);
});

test("the Groundbox bar in feet: typing, leaving the box, following the kind", () => {
  assert.equal(boxTopWhileTyping("1", 64 * 256, 65535), null);
  assert.equal(boxTopWhileTyping("1000", 64 * 256, 65535), null);
  assert.equal(boxTopWhileTyping("200.5", 64 * 256, 65535), 25664);
  assert.equal(boxBottomWhileTyping("10", 128 * 256), 1280);
  assert.equal(boxBottomWhileTyping("300", 128 * 256), null);
  assert.equal(boxTopOnLeave("", 30000, 64 * 256, 65535), 30000);
  assert.equal(boxTopOnLeave("1000", 30000, 64 * 256, 65535), 65535);
  assert.equal(boxTopOnLeave("1", 30000, 64 * 256, 65535), 64 * 256 + 1);
  assert.equal(boxBottomOnLeave("x", 500, 1000), 500);
  assert.equal(boxBottomOnLeave("-5", 500, 1000), 0);
  assert.deepEqual(followBoxBar(128 << 8, 64 << 8, 65535), { top: 128 << 8, bottom: 64 << 8 });
  assert.deepEqual(followBoxBar(TERRAIN_H_TALL_MAX, TERRAIN_H_TALL_MAX, 65535), { top: 65535, bottom: 65534 });
  assert.deepEqual(followBoxBar(1000, 900, 0), { top: 4 << 8, bottom: 3 << 8 });
  assert.deepEqual(followBoxBar(65535, 65535, 0), { top: 255 << 8, bottom: 254 << 8 });
});

test("the status bar's Z: steps, or feet on a v6 track", () => {
  assert.equal(zIndicatorText(300, false), "Z: 100");
  assert.equal(zIndicatorText(300, true), "Z: 200.00 ft");
  assert.equal(zIndicatorText(301, true), "Z: 200.66 ft");
});

test("water, truck and transitions boxes in feet", () => {
  assert.equal(waterFeetText(201), "100.50");
  assert.equal(waterFromFeet("100.3", 1023), 201);
  assert.equal(waterFromFeet("", 1023), null);
  assert.equal(waterFromFeet("9999", 1023), 1023);
  assert.equal(waterUnitsStep("100.50", 1, 1023), 202);
  assert.equal(waterUnitsStep("", -1, 1023), -1);
  assert.deepEqual(truckZStep("24.5", 1, 0, 65535), { last: 25.5 * 128, shown: 25.5 * 128 });
  assert.deepEqual(truckZStep("x", -1, 64, 65535), { last: 0, shown: 0 });
  assert.equal(truckZFromFeet("24.5", 65535), 12);
  assert.equal(truckZFromFeet("25", 65535), 13);
  assert.equal(truckZFromFeet("abc", 65535), null);
  assert.equal(truckZFromFeet("8192", TERRAIN_H_TALL_MAX), 4096);
  assert.deepEqual(followTransitions({ threshold: 127, min: 0, max: 255 }, false, 65535), { threshold: 127 * 256, min: 0, max: 65280 });
  assert.deepEqual(followTransitions({ threshold: 127 * 256 + 200, min: 0, max: 70000 }, true, 0), { threshold: 128, min: 0, max: 255 });
  assert.equal(transitionFeet("bad", 777, 65535), 777);
  assert.equal(transitionFeetStep("511.99", 0, 1, 65535), 65535);
});

test("Adjust Terrain Heights in v: the dialog's arithmetic and the lift of the water", () => {
  assert.equal(effectiveIncrementV(1000, 100, 65000, 65535, true), 535);
  assert.equal(effectiveIncrementV(-1000, 100, 65000, 65535, true), -100);
  assert.equal(effectiveScaleV(2, 40000, 65535, true), 65535 / 40000);
  assert.equal(scaleHeightV(3, 0.5, 65535), 2);
  assert.equal(liftHeightV(65000, 1000, 65535), 65535);
  let lifted = 0;
  const r = adjustHeights(new Uint8Array(65536).fill(100), { scale: false, increment: 0, factor: 1, avoidClip: false }, [], 200,
    (_scale, liftv) => { lifted = liftv; }, undefined, [0, 1023], { minv: 0, maxv: 30000, hmax: 65535, liftv: 1600 });
  assert.equal(lifted, 1600);
  assert.equal(r.dq, 25);
  assert.equal(r.water4, 225);
});

test("Random Terrain on a v6 track: v units, the ceiling, the 512 world's grids", () => {
  const p = { mode: 0, seed: 7, ground: 200 * 128, hillHeight: 100 * 128, valleyDepth: 40 * 128, smoothness: 40 };
  const tall = terrainGenV(p, 512, 1, TERRAIN_H_TALL_MAX)!;
  assert.ok(tall instanceof Int32Array);
  assert.equal(tall.length, 512 * 512);
  const std = terrainGenV(p, 256, 1, 65535)!;
  assert.ok(std instanceof Uint16Array);
  let lo = Infinity, hi = 0;
  for (const v of std) { if (v < lo) lo = v; if (v > hi) hi = v; }
  assert.ok(lo >= 256 && hi <= 65535 && hi > 200 * 128);
  // unitv 256 is the old meaning.
  const s = { mode: 1, seed: 3, ground: 100, hillHeight: 128, valleyDepth: 128, smoothness: 50 };
  assert.deepEqual(terrainGenV(s, 256, 256, 65535), terrainGenV(s, 256));
  assert.equal(genVFromPos(0, 65535), 0);
  assert.equal(genVFromPos(255, 65535), 65535);
  assert.equal(genVFromPos(128, 65535), 32896);
  assert.equal(genPosFromV(32896, 65535), 128);
  assert.deepEqual(genFeetStart(65535), { ground: 25600, hill: 12800, valley: 5120, rough: 20, range: 50, smooth: 40 });
  assert.deepEqual(genFeetStart(10000).ground, 10000);
  assert.deepEqual(genFeetParams(1, genFeetStart(65535), 65535), { ground: 25600, hillHeight: genVFromPos(50, 65535), valleyDepth: 20, smoothness: 40 });
  assert.deepEqual([...terrainGenPreview(new Int32Array([0, 524288, TERRAIN_H_TALL_MAX]), TERRAIN_H_TALL_MAX)], [0, 127, 255]);
});

test("the Waterfall window's heights: 2 decimals on a v6 track", () => {
  const w = Object.assign(fallDefaults(), { source: 0 });
  assert.equal(fallHeightText(w, 101), "50.5 ft (101 raw)");
  assert.equal(fallHeightText(w, 100, true), "50.00 ft (100 raw)");
  assert.equal(fallBoxTexts(w, 101, true).height, "50.50");
  assert.deepEqual(fallSourceOptions([{ height: 100 }], w, true).map((o) => o.label), ["None (a spring)", "Lake 1 (50.00 ft)"]);
});
