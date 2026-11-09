import test from "node:test";
import assert from "node:assert/strict";
import {
  ddxParseFloat, fogDialogDefaults, fogDialogResult, fogDialogStart, fogHeightsText, fogPreview, fogToRgb, formatFeet,
  readDlgFloat, roundPercentText, validateFogFields, weatherMask, type FogFieldTexts,
} from "../src/core/edit/fog-properties.ts";
import { applyObjectFields, objectFields } from "../src/core/edit/object-properties.ts";
import { effectiveFog, fogDriftArrow, fogShapeLines, fogVolumeAlphas, fogVolumeCentre, fogVolumeCorners, fogVolumeRing, FOG_RING } from "../src/core/view/fog-volume.ts";
import { traxxBoxDefaults, traxxFogDefaults, traxxFogEngineDefaults, TRAXX_BOX_FOG } from "../src/core/traxx/sit.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";

const fogBox = () => ({ ...traxxBoxDefaults(), type: TRAXX_BOX_FOG, width: 40, length: 60, height: 20, ipos: [1000, 2000, 48] as [number, number, number], fraction: [0, 0, 0] as [number, number, number] });

test("OnInitDialog shows the box's size, the percents and the fog's colour", () => {
  const s = fogDialogStart(traxxFogDefaults(), fogBox());
  assert.deepEqual([s.texts.w, s.texts.l, s.texts.h], ["40", "60", "20"]);
  assert.equal(s.texts.vis, "300");
  assert.equal(s.texts.maxop, "100");
  assert.equal(s.texts.wisp, "50");
  assert.equal(s.round, 100);
  assert.deepEqual(s.rgb, [191, 199, 209]);
  assert.equal(s.wmask, 511);
  // A file's out-of-range value is clamped first (ClampFog), so DDV cannot reject it on OK.
  assert.equal(fogDialogStart({ ...traxxFogDefaults(), vis: 0, base: -20000 }, null).texts.vis, "1");
  assert.equal(fogDialogStart({ ...traxxFogDefaults(), base: -20000 }, null).texts.base, "-10000");
});

test("the heights line is the object's z in feet plus the base, and the height", () => {
  const box = fogBox();
  assert.equal(fogHeightsText(box, "0", 0), "Floor 96 ft, top 116 ft");
  assert.equal(fogHeightsText(box, "-4.5", 0), "Floor 91.5 ft, top 111.5 ft");
  // An empty field keeps the last good value.
  assert.equal(fogHeightsText(box, "", 10), "Floor 106 ft, top 126 ft");
  box.fraction[2] = 64;
  assert.equal(fogHeightsText(box, "0", 0), "Floor 96.5 ft, top 116.5 ft");
  assert.equal(formatFeet(96.02), "96");
});

test("DDX parsing and the DDV ranges", () => {
  assert.equal(ddxParseFloat(" 12.5 "), 12.5);
  assert.equal(ddxParseFloat(""), null);
  assert.equal(ddxParseFloat("abc"), null);
  assert.equal(ddxParseFloat("0"), 0);
  assert.equal(ddxParseFloat("12x"), null);
  const texts: FogFieldTexts = { ...fogDialogStart(traxxFogDefaults(), fogBox()).texts };
  const ok = validateFogFields(texts);
  assert.ok("values" in ok);
  assert.deepEqual(validateFogFields({ ...texts, vis: "0.5" }), { field: "vis", message: "Please enter a number between 1 and 100000." });
  assert.deepEqual(validateFogFields({ ...texts, base: "-10001" }), { field: "base", message: "Please enter a number between -10000 and 10000." });
  assert.deepEqual(validateFogFields({ ...texts, maxop: "101" }), { field: "maxop", message: "Please enter a number between 0 and 100." });
  assert.deepEqual(validateFogFields({ ...texts, wsize: "x" }), { field: "wsize", message: "Please enter a number." });
});

test("OnOK: percents back to 0..1, the round kept unless moved, the size from the box", () => {
  const box = fogBox();
  const fog = { ...traxxFogEngineDefaults(), round: 0.333 };
  const s = fogDialogStart(fog, box);
  const v = validateFogFields({ ...s.texts, maxop: "40", wisp: "25" });
  assert.ok("values" in v);
  const out = fogDialogResult(fog, v.values, s.round, [255, 0, 128], weatherMask([true, false, true]), box);
  assert.ok(Math.abs(out.round - 0.333) < 1e-6);
  assert.ok(Math.abs(out.maxop - 0.4) < 1e-6);
  assert.ok(Math.abs(out.wisp - 0.25) < 1e-6);
  assert.equal(out.r, 1);
  assert.equal(out.g, 0);
  assert.equal(out.wmask, 5);
  assert.deepEqual([out.w, out.l, out.h], [40, 60, 20]);
  const moved = fogDialogResult(fog, v.values, 50, [0, 0, 0], 511, box);
  assert.equal(moved.round, 0.5);
  assert.equal(fog.round, 0.333);
});

test("Defaults is the new-object set; the preview reads only what the volume draws", () => {
  const d = fogDialogDefaults();
  assert.equal(d.round, 100);
  assert.equal(d.texts.wisp, "50");
  assert.equal(d.texts.half, "8");
  assert.equal(d.texts.edge, "20");
  assert.equal(d.texts.top, "5");
  assert.equal(d.texts.wsize, "40");
  assert.equal(d.texts.wspeed, "3");
  assert.deepEqual(d.rgb, fogToRgb(traxxFogDefaults()));
  const fog = traxxFogDefaults();
  const p = fogPreview(fog, { base: "-5", maxop: "", wisp: "200", wspeed: "1" }, 30, [0, 255, 0]);
  assert.equal(p.base, -5);
  assert.equal(p.maxop, 1);
  assert.equal(p.wisp, 1);
  assert.ok(Math.abs(p.round - 0.3) < 1e-6);
  assert.equal(p.g, 1);
  assert.equal(readDlgFloat("12abc", 0, 0, 10), 10);
  assert.equal(roundPercentText(100), "100 %");
});

test("the volume: upright, heading only, floor at the object's height plus base", () => {
  const box = { ...fogBox(), theta: 0.5, phi: 0.3 };
  const c = fogVolumeCorners(box, { base: 10 })!;
  // z: 3 * 48 = 144 scene units, base 10 ft = 15, height 20 ft = 30.
  assert.equal(c[0]![2], 159);
  assert.equal(c[4]![2], 189);
  assert.deepEqual([c[0]![0], c[0]![1]], [960, 1940]);
  assert.deepEqual([c[2]![0], c[2]![1]], [1040, 2060]);
  assert.equal(fogVolumeCorners({ ...box, height: 0 }, { base: 0 }), null);
  assert.deepEqual(fogVolumeCentre(box, { base: 10 }), [1000, 2000, 174]);
  // Round 0 is the rectangle; any rounding is the 48-point superellipse.
  const rect = fogVolumeRing(box, { base: 0, round: 0 })!;
  assert.equal(rect.ring.length, 4);
  assert.equal(fogShapeLines(rect).length, 12);
  const ell = fogVolumeRing(box, { base: 0, round: 1 })!;
  assert.equal(ell.ring.length, FOG_RING);
  assert.ok(Math.abs(ell.ring[0]![0] - 1040) < 1e-9 && Math.abs(ell.ring[0]![1] - 2000) < 1e-9);
  assert.ok(Math.abs(Math.hypot(ell.ring[6]![0] - 1000, (ell.ring[6]![1] - 2000) * (40 / 60)) - 40) < 1e-6);
  assert.equal(fogShapeLines(ell).length, 48 * 2 + 8);
});

test("opacities, the drift arrow and the preview", () => {
  assert.deepEqual(fogVolumeAlphas(0), { bottom: 0.15, top: 0.04, edge: 0.7 });
  const a = fogVolumeAlphas(2);
  assert.ok(Math.abs(a.bottom - 0.45) < 1e-9 && Math.abs(a.top - 0.1) < 1e-9);
  const box = fogBox();
  assert.equal(fogDriftArrow(box, { base: 0, wisp: 0, wspeed: 3 }), null);
  assert.equal(fogDriftArrow(box, { base: 0, wisp: 0.5, wspeed: 0 }), null);
  const arrow = fogDriftArrow(box, { base: 0, wisp: 0.5, wspeed: 3 })!;
  assert.equal(arrow.length, 5);
  // Heading 0 drifts north: 40 % of 60 is 24 ft, 48 ipos, from -24 to +24 about the middle.
  assert.deepEqual(arrow[0], [[1000, 1976, 174], [1000, 2024, 174]]);
  const other = { ...box, type: 0 };
  assert.equal(effectiveFog(other, null).isFog, false);
  const preview = { box: other, fog: { ...traxxFogDefaults(), base: 3 }, isFog: true };
  assert.equal(effectiveFog(other, preview).isFog, true);
  assert.equal(effectiveFog(other, preview).fog.base, 3);
  assert.equal(effectiveFog(box, preview).fog, box.fog);
});

test("Object Properties carries the fog for every type", () => {
  const doc = newTrackDocument();
  const box = fogBox();
  doc.track.boxes = [box];
  const f = objectFields(box);
  f.fog = { ...f.fog, vis: 42 };
  applyObjectFields(doc.track, 0, f, doc.track.heights, { cont: null, impact: null }, box.heightAboveGround);
  assert.equal(doc.track.boxes[0]!.fog.vis, 42);
});
