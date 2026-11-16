/*
  Traxx 1.8.0's engine glow and cone (engine-glow-cone.ts, Traxx/EngineGlowCone.cpp), with every check
  of Traxx's own tools/glowconetest.cpp: vectors T1-T8 of the handover's section 3.7, the allWx gates
  of section 3.8, the coneRim = 0 guard, the brightness step at D and the tint (242 checks). Synthetic
  data only.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGINEGLOWCONE_CONESIDES, engineGlowConeBuild, engineGlowConeHasCone, engineGlowConeRimZero, engineGlowConeStep,
  engineGlowConeTint, engineGlowConeWeatherShows, type GlowConeLight, type GlowConeResult, type GlowConeVertex,
} from "../src/core/edit/engine-glow-cone.ts";
import {
  ENGINEWEATHER_CLEAR, ENGINEWEATHER_CLOUDY, ENGINEWEATHER_COUNT, ENGINEWEATHER_DENSE_FOG, ENGINEWEATHER_DUSK,
  ENGINEWEATHER_FOGGY, ENGINEWEATHER_NIGHT, ENGINEWEATHER_PITCH_BLACK, ENGINEWEATHER_SNOW, engineLightWeatherHasPools,
} from "../src/core/edit/engine-light-pool.ts";

// The C++ test's CHECK / CHECKEQ / CHECKNEAR, counted so the total can be compared with glowconetest.cpp's.
let checks = 0;
const check = (cond: boolean, what?: string) => {
  checks++;
  assert.ok(cond, what);
};
const checkEq = (got: number | boolean, want: number | boolean, what?: string) => {
  checks++;
  assert.equal(got, want, what);
};
const checkNear = (got: number, want: number, tol: number, what?: string) => {
  checks++;
  assert.ok(Math.abs(got - want) <= tol, `${what ?? ""} got ${got}, want ${want} (tol ${tol})`);
};

// The port's defaults: glow 2, glowRad 6, hgt 8, white, coneLen 125, coneRim 10, coneBase 3.5. allWx 0.
const defaults = (): GlowConeLight => ({
  glowMode: 2, glowRadius: 6, heightOffset: 8, r: 1, g: 1, b: 1, coneLength: 125, coneRimRadius: 10, coneBaseRadius: 3.5,
});

let r: GlowConeResult;

/** Build with headlightFlag 1; sets r and returns drawn, as the C++ helper does. */
function build(l: GlowConeLight, allWx: number, bx: number, by: number, bz: number, th: number, ph: number, ps: number,
  ex: number, ey: number, ez: number, fx: number, fy: number, fz: number, weather: number, vis: number): boolean {
  r = engineGlowConeBuild(l, allWx, [bx, by, bz], [th, ph, ps], [ex, ey, ez], [fx, fy, fz], weather, vis, 1);
  return r.drawn;
}

function checkWorld(v: GlowConeVertex, x: number, y: number, z: number) {
  checkNear(v.world[0], x, 1e-3);
  checkNear(v.world[1], y, 1e-3);
  checkNear(v.world[2], z, 1e-3);
}

function checkLocalUV(v: GlowConeVertex, lx: number, ly: number, lz: number, u: number, vv: number, a: number) {
  checkNear(v.local[0], lx, 5e-5);
  checkNear(v.local[1], ly, 5e-5);
  checkNear(v.local[2], lz, 5e-5);
  checkNear(v.u, u, 5e-6);
  checkNear(v.v, vv, 5e-6);
  checkEq(v.alpha8, a);
}

const D = defaults();

test("T1: NIGHT, box (1000,50,2000) unrotated, eye 100 ft in front, looking -Z, vis 40", () => {
  check(build(D, 0, 1000, 50, 2000, 0, 0, 0, 1000, 58, 2100, 0, 0, -1, ENGINEWEATHER_NIGHT, 40));
  checkNear(r.brightness, 1.0, 1e-7);
  check(r.hasGlow);
  checkEq(r.glow[0]!.alpha8, 255);
  checkWorld(r.glow[0]!, 1006, 64, 2000);
  checkWorld(r.glow[1]!, 994, 64, 2000);
  checkWorld(r.glow[2]!, 994, 52, 2000);
  checkWorld(r.glow[3]!, 1006, 52, 2000);
  checkNear(r.glow[0]!.u, 8 / 256.0, 1e-7); checkNear(r.glow[0]!.v, 8 / 256.0, 1e-7);
  checkNear(r.glow[1]!.u, 248 / 256.0, 1e-7); checkNear(r.glow[1]!.v, 8 / 256.0, 1e-7);
  checkNear(r.glow[2]!.u, 248 / 256.0, 1e-7); checkNear(r.glow[2]!.v, 248 / 256.0, 1e-7);
  checkNear(r.glow[3]!.u, 8 / 256.0, 1e-7); checkNear(r.glow[3]!.v, 248 / 256.0, 1e-7);
  check(r.hasCone);
  checkEq(r.coneBaseAlpha8, 23);
  checkNear(r.randVal1, 0.696147, 5e-7);
  checkNear(r.randVal2, 0.925887, 5e-7);
  checkEq(r.rgb[0], 255); checkEq(r.rgb[1], 255); checkEq(r.rgb[2], 255);
  // facet 0: v0 | v6 | v11 | v5
  checkLocalUV(r.cone[0]!, -1.75, 8, 0, 0.015625, 0.59194, 23);
  checkLocalUV(r.cone[1]!, -10, 8, 125, 0.984375, 0.36047, 0);
  checkLocalUV(r.cone[2]!, -4.9961, 16.6602, 125, 0.984375, 0.61047, 0);
  checkLocalUV(r.cone[3]!, -0.8711, 9.5117, 0, 0.015625, 0.63569, 23);
  // every facet carries the same four UVs (per facet, unshared), and its own vertices
  for (let i = 1; i < ENGINEGLOWCONE_CONESIDES; i++)
    for (let k = 0; k < 4; k++) {
      checkNear(r.cone[i * 4 + k]!.u, r.cone[k]!.u, 0.0);
      checkNear(r.cone[i * 4 + k]!.v, r.cone[k]!.v, 0.0);
      checkEq(r.cone[i * 4 + k]!.alpha8, r.cone[k]!.alpha8);
    }
  // quad j = {j, j+6, prev+6, prev}: facet j's last vertex is facet j-1's first, its rim pair shares likewise
  for (let i = 1; i < ENGINEGLOWCONE_CONESIDES; i++) {
    checkNear(r.cone[i * 4 + 3]!.local[0], r.cone[(i - 1) * 4 + 0]!.local[0], 0.0);
    checkNear(r.cone[i * 4 + 2]!.local[1], r.cone[(i - 1) * 4 + 1]!.local[1], 0.0);
  }
  // flat top: base vertices 4 and 5 (facet 4's first, facet 5's first) at the same height
  checkNear(r.cone[4 * 4]!.local[1], r.cone[5 * 4]!.local[1], 0.0);
  check(r.cone[4 * 4]!.local[1] > 8.0);
});

test("T2: eye BEHIND (1000,58,1900), looking +Z: no glow, cone still drawn", () => {
  check(build(D, 0, 1000, 50, 2000, 0, 0, 0, 1000, 58, 1900, 0, 0, 1, ENGINEWEATHER_NIGHT, 40));
  check(!r.hasGlow);
  check(r.hasCone);
  checkNear(r.randVal1, 0.191623, 5e-7);
  checkNear(r.randVal2, 0.152804, 5e-7);
});

test("T3: CLEAR -> nothing", () => {
  check(!build(D, 0, 1000, 50, 2000, 0, 0, 0, 1000, 58, 2100, 0, 0, -1, ENGINEWEATHER_CLEAR, 40));
  check(!r.drawn && !r.hasGlow && !r.hasCone);
});

test("T4: glow 1, tint (1,.5,0), box (500,20,500) yaw pi/2, eye (560,28,500), vis 150, DUSK", () => {
  const l = { ...D, glowMode: 1, r: 1.0, g: 0.5, b: 0.0 };
  check(build(l, 0, 500, 20, 500, 0, 0, 3.14159265358979 / 2, 560, 28, 500, -1, 0, 0, ENGINEWEATHER_DUSK, 150));
  checkNear(r.brightness, 1.0, 1e-7);
  checkEq(r.glow[0]!.alpha8, 255);
  checkEq(r.rgb[0], 255); checkEq(r.rgb[1], 128); checkEq(r.rgb[2], 0);
  checkWorld(r.glow[0]!, 500, 34, 494);
  checkWorld(r.glow[1]!, 500, 34, 506);
  checkWorld(r.glow[2]!, 500, 22, 506);
  checkWorld(r.glow[3]!, 500, 22, 494);
  check(!r.hasCone);
});

test("T5: FOGGY, eye 200 ft away, vis 40", () => {
  check(build(D, 0, 1000, 50, 2000, 0, 0, 0, 1000, 58, 2200, 0, 0, -1, ENGINEWEATHER_FOGGY, 40));
  checkEq(r.fog, 40959);
  checkNear(r.brightness, 0.375006, 5e-7);
  checkEq(r.glow[0]!.alpha8, 95);
  checkEq(r.coneBaseAlpha8, 8);
});

test("T6: DENSE_FOG, 200 ft -> fully fogged, drawn but invisible", () => {
  check(build(D, 0, 1000, 50, 2000, 0, 0, 0, 1000, 58, 2200, 0, 0, -1, ENGINEWEATHER_DENSE_FOG, 40));
  checkEq(r.fog, 65535);
  checkNear(r.brightness, 0.0, 0.0);
  check(r.drawn);
  checkEq(r.glow[0]!.alpha8, 0);
  checkEq(r.coneBaseAlpha8, 0);
});

test("T7: coneLen 60, rim 20, base 6; box (3000,80,3000) rot (-0.3,0.1,0); eye (3000,120,4500); vis 40", () => {
  const l = { ...D, coneLength: 60, coneRimRadius: 20, coneBaseRadius: 6 };
  check(build(l, 0, 3000, 80, 3000, -0.3, 0.1, 0, 3000, 120, 4500, 0, 0, -1, ENGINEWEATHER_NIGHT, 40));
  checkNear(r.zView, 1502.0, 1.0);
  checkNear(r.brightness, 0.2, 1e-7);
  checkNear(r.facingMe, 0.961485, 5e-7);
  checkEq(r.glow[0]!.alpha8, 49);
  checkEq(r.coneBaseAlpha8, 4);
});

test("T8: glowRad 3, box (100,0,100), eye (150,8,150), PITCH_BLACK", () => {
  const l = { ...D, glowRadius: 3 };
  check(build(l, 0, 100, 0, 100, 0, 0, 0, 150, 8, 150, -0.70710678, 0, -0.70710678, ENGINEWEATHER_PITCH_BLACK, 40));
  checkNear(r.facingMe, 0.707107, 5e-7);
  checkEq(r.glow[0]!.alpha8, 181);
  checkEq(r.coneBaseAlpha8, 23);
});

test("gates (section 3.8): allWx draws in Clear / Cloudy / Snow; the pool rule does not change", () => {
  for (let i = 0; i < ENGINEWEATHER_COUNT; i++) {
    checkEq(engineGlowConeWeatherShows(i, 0), engineLightWeatherHasPools(i));
    checkEq(engineGlowConeWeatherShows(i, 1), true);
  }
  checkEq(engineLightWeatherHasPools(ENGINEWEATHER_CLEAR), false);
  checkEq(engineLightWeatherHasPools(ENGINEWEATHER_CLOUDY), false);
  checkEq(engineLightWeatherHasPools(ENGINEWEATHER_SNOW), false);

  const l = { ...D };
  check(build(l, 1, 1000, 50, 2000, 0, 0, 0, 1000, 58, 2100, 0, 0, -1, ENGINEWEATHER_CLEAR, 40));
  check(r.hasGlow && r.hasCone);
  checkNear(r.brightness, 1.0, 0.0); // no fog fade in Clear
  checkEq(r.fog, 0);
  check(build(l, 1, 1000, 50, 2000, 0, 0, 0, 1000, 58, 2100, 0, 0, -1, ENGINEWEATHER_CLOUDY, 40));
  check(r.hasGlow && r.hasCone);
  // SNOW: the engine's light fog fade covers SNOW too, fogLen = 0.85 * visT * 32 ft (setFogDistance):
  // 4080 ft at vis 150, so 200 ft -> 65535 * 200/4080 = 3212.
  check(build(l, 1, 1000, 50, 2000, 0, 0, 0, 1000, 58, 2200, 0, 0, -1, ENGINEWEATHER_SNOW, 150));
  checkEq(r.fog, 3212);
  checkNear(r.brightness, (65535 - 3212) / 65535.0, 1e-6);
  check(r.hasGlow && r.hasCone);
  // glow mode 0 still draws nothing, allWx or not
  l.glowMode = 0;
  check(!build(l, 1, 1000, 50, 2000, 0, 0, 0, 1000, 58, 2100, 0, 0, -1, ENGINEWEATHER_NIGHT, 40));

  // headlightFlag 0: nothing
  check(!engineGlowConeBuild(D, 0, [1000, 50, 2000], [0, 0, 0], [1000, 58, 2100], [0, 0, -1], ENGINEWEATHER_NIGHT, 40, 0).drawn);
});

test("the coneRim = 0 guard: passes the engine's gate, divides by zero there; not built here", () => {
  let l: GlowConeLight = { ...D, coneRimRadius: 0 };
  checkEq(engineGlowConeHasCone(l), true);
  checkEq(engineGlowConeRimZero(l), true);
  check(build(l, 0, 1000, 50, 2000, 0, 0, 0, 1000, 58, 2100, 0, 0, -1, ENGINEWEATHER_NIGHT, 40));
  check(r.hasGlow);
  check(!r.hasCone);
  check(r.coneRimZero);
  l.coneBaseRadius = 0; // both 0: the engine's gate fails, nothing to warn about
  checkEq(engineGlowConeHasCone(l), false);
  checkEq(engineGlowConeRimZero(l), false);
  l = { ...D, coneBaseRadius: 0 }; // rim only: a point at the lamp, fine
  checkEq(engineGlowConeRimZero(l), false);
  check(build(l, 0, 1000, 50, 2000, 0, 0, 0, 1000, 58, 2100, 0, 0, -1, ENGINEWEATHER_NIGHT, 40));
  check(r.hasCone && !r.coneRimZero);
  l = { ...D, glowMode: 1, coneRimRadius: 0 }; // glow 1: no cone, so no warning either
  checkEq(engineGlowConeRimZero(l), false);
});

test("the brightness STEP at D = groundVisX * 32 ft", () => {
  checkNear(engineGlowConeStep(3839.99, 150), 1.0, 0.0); // vis 150 -> groundVisX 120 -> D 3840 ft
  checkNear(engineGlowConeStep(3840.0, 150), 0.2, 1e-7);
  checkNear(engineGlowConeStep(3840.0, 120), 0.2, 1e-7);
  checkNear(engineGlowConeStep(3839.99, 120), 1.0, 0.0);
  checkNear(engineGlowConeStep(1279.99, 40), 1.0, 0.0);
  checkNear(engineGlowConeStep(1280.0, 40), 0.2, 1e-7);
  checkNear(engineGlowConeStep(319.99, 1), 1.0, 0.0); // clamped up to 10
  checkNear(engineGlowConeStep(320.0, 1), 0.2, 1e-7);
  checkNear(engineGlowConeStep(0.0, 150), 1.0, 0.0);
  checkNear(engineGlowConeStep(-3839.99, 150), 1.0, 0.0); // behind the eye, truncated to 0
  checkNear(engineGlowConeStep(-3840.0, 150), 2.0, 0.0); // the engine's 2.0 behind the camera
  checkNear(engineGlowConeStep(100000.0, 150), 0.2, 1e-7);
  // the same step through the whole build: 3839 ft vs 3841 ft ahead at vis 150
  check(build(D, 0, 0, 0, 0, 0, 0, 0, 0, 8, 3839, 0, 0, -1, ENGINEWEATHER_NIGHT, 150));
  checkNear(r.brightness, 1.0, 0.0);
  check(build(D, 0, 0, 0, 0, 0, 0, 0, 0, 8, 3841, 0, 0, -1, ENGINEWEATHER_NIGHT, 150));
  checkNear(r.brightness, 0.2, 1e-7);
  checkEq(r.glow[0]!.alpha8, 51); // int(0.2 * 1 * 65535) >> 8
});

test("tint (packLightTint)", () => {
  let c = engineGlowConeTint(0.0, 0.5, 1.0);
  checkEq(c[0], 0); checkEq(c[1], 128); checkEq(c[2], 255);
  c = engineGlowConeTint(-1.0, 2.0, 0.25);
  checkEq(c[0], 0); checkEq(c[1], 255); checkEq(c[2], 64);
});

test("the check count matches glowconetest.cpp (242)", () => {
  assert.equal(checks, 242);
});

test("a TraxxLight-shaped object passes as the light (extra fields ignored)", () => {
  const traxxLight = {
    radius: 64, heightOffset: 8, r: 1, g: 1, b: 1, glowMode: 2, glowRadius: 6, coneLength: 125, coneRimRadius: 10,
    coneBaseRadius: 3.5, bright: 1, aimOffset: 0, allWx: 0,
  };
  const res = engineGlowConeBuild(traxxLight, traxxLight.allWx, [1000, 50, 2000], [0, 0, 0], [1000, 58, 2100], [0, 0, -1],
    ENGINEWEATHER_NIGHT, 40);
  assert.equal(res.cone.length, 24);
  assert.equal(res.glow.length, 4);
});
