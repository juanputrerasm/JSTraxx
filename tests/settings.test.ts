import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, mergeSettings, orderLibrary, defaultAltitudeForTool } from "../src/core/settings.ts";

test("defaults are CTraxxReg's", () => {
  const s = defaultSettings();
  assert.equal(s.gamma, 1.0);
  assert.equal(s.polysize, 64);
  assert.deepEqual(s.edit, { wireframe: 2, tool: 0, orientation: 0, curvature: 3, altitude: 32, terrainw: 5, terrainh: 5, paint: true, texturew: 1, textureh: 1 });
  assert.deepEqual(s.autosave, { enabled: false, minutes: 15, specialFile: true });
  assert.deepEqual(s.lighting, { left: 0, right: 0, top: 237, bottom: 153 });
  assert.deepEqual(s.colors.slice(0, 6), ["#000000", "#008000", "#c0c0c0", "#ffffff", "#ffffff", "#ffff00"]);
  assert.equal(s.water_opacity, 50);
  assert.equal(s.show_water, true);
});

test("stored settings are held to the ranges Traxx's controls allow", () => {
  const s = mergeSettings({
    gamma: 9, polysize: 77, water_opacity: -5, mode: 12, unknown: 1,
    edit: { tool: 9, terrainw: 0, terrainh: 99, curvature: 3.4, wireframe: 1, paint: "yes" },
    colors: ["#ABCDEF", "red"],
    recent: ["a", 3, "b", "c", "d", "e"],
    panels: { textures: { x: 1, y: 2, w: 300, h: 200, open: 1 }, bad: { x: "1" } },
  });
  assert.equal(s.gamma, 2.0);
  assert.equal(s.polysize, 80);
  assert.equal(s.water_opacity, 0);
  assert.equal(s.mode, 4);
  assert.equal((s as unknown as Record<string, unknown>).unknown, undefined);
  assert.equal(s.edit.tool, 7);
  assert.equal(s.edit.terrainw, 1);
  assert.equal(s.edit.terrainh, 25);
  assert.equal(s.edit.curvature, 3);
  assert.equal(s.edit.wireframe, 1);
  assert.equal(s.edit.paint, true);
  assert.equal(s.colors[0], "#abcdef");
  assert.equal(s.colors[1], "#008000");
  assert.deepEqual(s.recent, ["a", "b", "c", "d"]);
  assert.deepEqual(s.panels, { textures: { x: 1, y: 2, w: 300, h: 200, open: true } });
});

test("garbage reads as the defaults", () => {
  assert.deepEqual(mergeSettings(null), defaultSettings());
  assert.deepEqual(mergeSettings("x"), defaultSettings());
});

test("library order keeps the stored order, then the rest by name", () => {
  assert.deepEqual(orderLibrary(["C.POD", "A.POD", "B.POD"], ["B.POD", "GONE.POD"]), ["B.POD", "A.POD", "C.POD"]);
});

test("each terrain tool family starts at its own altitude", () => {
  assert.deepEqual([0, 5, 6, 7].map(defaultAltitudeForTool), [32, 32, 100, 1]);
});
