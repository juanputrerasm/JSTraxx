/*
  Traxx 1.8.0's 3D view rules that run without a GPU: the settings (View > Visual Helpers, Light
  Guide, Preview Weather), the light pool and guide (6616ea5, ce4aa17), the glow list and its art
  keying (58c5475), the water mask cell table (2e8a268) and the sun ring (b6d56f2). The shaders,
  the sky dome and the fog slices draw on the GPU and are checked in the browser.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, mergeSettings } from "../src/core/settings.ts";
import { lightPoolDrawing, LIGHTCORE_COLOUR, LIGHTPOOL_COLOUR, LIGHTPOOL_DIM_COLOUR } from "../src/core/view/light-pool.ts";
import { traxxBoxDefaults, TRAXX_BOX_LIGHT } from "../src/core/traxx/sit.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { glowImage, glowLightsOf, ownLight } from "../src/render/light-glows.ts";
import { stbiGrey, waterMaskCells } from "../src/render/terrain-detail.ts";
import { engineLightCoreRadius, engineLightBrightness, engineLightVext, engineLightHeightQ } from "../src/core/edit/engine-light-pool.ts";

test("settings: the 1.8.0 switches' defaults, and a Preview Weather outside 0..8 is Clear", () => {
  const d = defaultSettings();
  assert.deepEqual([d.show_sky, d.show_light_glows, d.show_detail_maps, d.show_water_mask, d.draw_all_fog, d.show_light_core, d.preview_weather],
    [true, true, true, false, false, false, 0]);
  assert.equal(mergeSettings({ preview_weather: 7 }).preview_weather, 7);
  for (const bad of [9, -1, 2.5, Number.NaN]) assert.equal(mergeSettings({ preview_weather: bad }).preview_weather, 0);
});

const lightBox = () => ({ ...traxxBoxDefaults(), type: TRAXX_BOX_LIGHT, ipos: [8192, 8192, 10] as [number, number, number] });
const ctx = { weatherMask: 0x1ff, lvlAmbient: 32768, coarseGrid: false };

test("light pool: R = min(int(rad), 4095); dim with no pool weather; no ring under 1, the stem kept", () => {
  const doc = newTrackDocument();
  const box = lightBox();
  const full = lightPoolDrawing(box, { ...box.light, radius: 64.9 }, doc.track, null, ctx, { show: false, weather: 7 });
  assert.equal(full.ringColour, LIGHTPOOL_COLOUR);
  assert.equal(full.lines.length, 73);
  // The ring is 2R ipos from the centre (R = 64, truncated).
  const r = Math.hypot(full.lines[0]![0][0] - 8192, full.lines[0]![0][1] - 8192);
  assert.ok(Math.abs(r - 128) <= 1);
  const dim = lightPoolDrawing(box, box.light, doc.track, null, { ...ctx, weatherMask: 1 | 2 | 32 }, { show: false, weather: 7 });
  assert.equal(dim.ringColour, LIGHTPOOL_DIM_COLOUR);
  assert.match(dim.labels[0]!.text, /No pools/);
  const none = lightPoolDrawing(box, { ...box.light, radius: 0.5 }, doc.track, null, ctx, { show: false, weather: 7 });
  assert.equal(none.lines.length, 1);
  assert.match(none.labels[0]!.text, /Radius under 1/);
});

test("light pool: a ground box's top when the head is above its bottom, else the terrain", () => {
  const doc = newTrackDocument();
  const box = lightBox();
  // The box at cell (128, 128): bottom 0, top 120 steps; the head is 10 steps + 8 ft over the terrain.
  const gb = { boxes: [{ x: 128, y: 128, lower: 0, upper: 120 }], cells: 256 };
  const bare = lightPoolDrawing(box, box.light, doc.track, null, ctx, { show: false, weather: 7 });
  const terrainZ = bare.lines[bare.lines.length - 1]![0][2];
  box.ipos[2] = terrainZ / 3 + 10;
  const on = lightPoolDrawing(box, box.light, doc.track, gb, ctx, { show: false, weather: 7 });
  const stem = on.lines[on.lines.length - 1]!;
  assert.equal(stem[0][2], 3 * 120);
  // The head under the box's bottom: the terrain.
  const below = lightPoolDrawing(box, box.light, doc.track, { boxes: [{ x: 128, y: 128, lower: 250, upper: 255 }], cells: 256 }, ctx, { show: false, weather: 7 });
  assert.equal(below.lines[below.lines.length - 1]![0][2], terrainZ);
});

test("light guide: the core ring and extent for the preview weather, and its words", () => {
  const doc = newTrackDocument();
  const box = lightBox();
  const light = { ...box.light, radius: 100, bright: 2 };
  const g = lightPoolDrawing(box, light, doc.track, null, ctx, { show: true, weather: 7 });
  // Night: a fixed ambient; core = engineLightCoreRadius(R, b, amb).
  const core = engineLightCoreRadius(100, engineLightBrightness(2), 1024);
  const vext = engineLightVext(100, engineLightHeightQ(light.heightOffset));
  assert.ok(g.guide.length > 0);
  assert.equal(g.labels.length, 2);
  assert.equal(g.labels[0]!.colour, LIGHTCORE_COLOUR);
  assert.match(g.labels[1]!.text, new RegExp(`gone at \\+/-${vext} ft`));
  if (core > 0) assert.match(g.labels[0]!.text, /^Night: core /);
  const clear = lightPoolDrawing(box, light, doc.track, null, ctx, { show: true, weather: 0 });
  assert.equal(clear.guide.length, 0);
  assert.equal(clear.labels[0]!.text, "No pools in Clear");
  const off = lightPoolDrawing(box, light, doc.track, null, { ...ctx, weatherMask: 1 << 7 }, { show: true, weather: 4 });
  assert.match(off.labels[0]!.text, /\(not in this track's weather mask\)$/);
});

test("glows: the first 128 lights count (glow mode 0 too), allWx read when the model has it", () => {
  const boxes = Array.from({ length: 140 }, (_, i) => ({ ...lightBox(), light: { ...lightBox().light, glowMode: i === 0 ? 0 : 1, allWx: i === 5 ? 1 : 0 } }));
  const list = glowLightsOf(boxes, ownLight);
  assert.equal(list.length, 127);
  assert.equal(list[4]!.allWx, 1);
  assert.equal(list[0]!.allWx, 0);
});

test("glow art: own .ACT keyed on colour (all under 8), level palette keyed on index 0", () => {
  const raw = Uint8Array.from({ length: 64 * 64 }, (_, i) => i & 3);
  const act = new Uint8Array(768);
  act.set([7, 7, 7], 3); act.set([8, 0, 0], 6); act.set([200, 200, 200], 9);
  const own = glowImage(raw, act, new Uint8Array(768), 64);
  assert.equal(own.side, 64);
  assert.deepEqual([own.rgba[3], own.rgba[7], own.rgba[11], own.rgba[15]], [0, 0, 255, 255]);
  const level = glowImage(raw, null, act, 64);
  assert.deepEqual([level.rgba[3], level.rgba[7], level.rgba[11]], [0, 255, 255]);
  // An odd length is read at the expected side.
  assert.equal(glowImage(new Uint8Array(100), null, act, 256).side, 256);
});

test("water mask: stb grey (77 r + 150 g + 29 b) >> 8 at pixel (gi w / N, gj h / N)", () => {
  assert.deepEqual(Array.from(stbiGrey([255, 255, 255, 0, 255, 0, 0, 255, 10, 20, 30, 255], 3, 1)), [255, 76, 18]);
  const grey = Uint8Array.from({ length: 4 * 2 }, (_, i) => i * 10);
  const cells = waterMaskCells(grey, 4, 2, 8);
  assert.equal(cells[0], 0);
  assert.equal(cells[7], 30);           // gi 7 -> x 3
  assert.equal(cells[4 * 8 + 0], 40);   // gj 4 -> y 1
});
