/*
  Traxx 1.7.2 / 1.7.3 view rules: View > Field of View (2e6965d, RecomputeViewFocal), the sun
  marker (ec6aafb, 3d5c18b, DrawSunMarker) and their settings.
*/
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { verticalFovFor, FOV_Y, FOCAL_480 } from "../src/render/viewport.ts";
import { sunMarkerCentre, SUN_MARKER_RADIUS } from "../src/render/sun-marker.ts";
import { applyTraxxCamera } from "../src/render/camera-math.ts";
import { defaultSettings, mergeSettings } from "../src/core/settings.ts";

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

test("Field of View: focal = (longer side / 2) / tan(fov / 2), Traxx's depth stretch folded in", () => {
  for (const [w, h] of [[1920, 1080], [800, 1200], [640, 480]] as const) {
    for (const fov of [50, 60, 70, 80, 90]) {
      const focal = (Math.max(w, h) / 2) / Math.tan(rad(fov / 2));
      // What three.js draws: the vertical field for the effective focal (focal * 1024 / 1200).
      const fy = verticalFovFor(fov, w, h);
      const eff = (h / 2) / Math.tan(rad(fy / 2));
      assert.ok(Math.abs(eff - (focal * 1024) / 1200) < 1e-6, `${w}x${h} ${fov}`);
    }
  }
  // The angle across the longer side does not grow with the window: the same at 640 and 1920 wide.
  const across = (w: number, h: number) => deg(2 * Math.atan((w / 2) / ((h / 2) / Math.tan(rad(verticalFovFor(70, w, h) / 2)))));
  assert.ok(Math.abs(across(640, 480) - across(1920, 1440)) < 1e-9);
  // Legacy (0): JSTraxx 1.0's fixed field, Traxx's 512 px focal at its 640 x 480.
  assert.equal(verticalFovFor(0, 1920, 1080), FOV_Y);
  assert.ok(Math.abs(FOV_Y - deg(2 * Math.atan(240 / FOCAL_480))) < 1e-12);
  assert.ok(Math.abs(FOV_Y - 57.5) < 0.1);
});

test("Field of View and Show Sun settings: default 70 and on; only Traxx's choices are kept", () => {
  const d = defaultSettings();
  assert.equal(d.opengl_fov, 70);
  assert.equal(d.show_sun, true);
  for (const v of [0, 50, 60, 70, 80, 90]) assert.equal(mergeSettings({ opengl_fov: v }).opengl_fov, v);
  for (const v of [45, 100, -1, 75]) assert.equal(mergeSettings({ opengl_fov: v }).opengl_fov, 70);
  assert.equal(mergeSettings({ show_sun: false }).show_sun, false);
});

test("the sun marker sits opposite the LVL vector, and is not drawn below the horizon or behind", () => {
  const w = 800, h = 600;
  const cam = new THREE.PerspectiveCamera(verticalFovFor(70, w, h), w / h, 4, 40000);
  // Level, facing orientation 0 (scene +y).
  applyTraxxCamera(cam, { x: 0, y: 0, z: 0, orientation: 0, elevation: 900 });
  cam.updateProjectionMatrix();
  // Light travelling toward engine -z and a little down: the sun sits ahead (+z engine = +y scene), a little up.
  const c = sunMarkerCentre([0, -1000, -65536], cam, w, h)!;
  assert.ok(Math.abs(c[0] - w / 2) < 1e-6);
  assert.ok(c[1] > h / 2 && c[1] < h / 2 + 30, String(c[1]));
  // Behind the camera: no disc.
  assert.equal(sunMarkerCentre([0, -1000, 65536], cam, w, h), null);
  // At or below the horizon, or a zero vector: no disc.
  assert.equal(sunMarkerCentre([0, 0, -65536], cam, w, h), null);
  assert.equal(sunMarkerCentre([0, 1000, -65536], cam, w, h), null);
  assert.equal(sunMarkerCentre([0, 0, 0], cam, w, h), null);
  // Engine x is scene x: light travelling toward -x puts the sun to the right of a camera facing +y.
  const right = sunMarkerCentre([-30000, -1000, -65536], cam, w, h)!;
  assert.ok(right[0] > w / 2);
  // Noon from a level camera is overhead, off the top: wholly off screen, so not drawn.
  assert.equal(sunMarkerCentre([0, -64000, 0], cam, w, h), null);
  assert.equal(SUN_MARKER_RADIUS * 2, 140);
});
