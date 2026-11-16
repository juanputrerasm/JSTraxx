/*
  Traxx 1.8.0's engine light-pool rule (engine-light-pool.ts, Traxx/EngineLightPool.cpp), with every
  check of Traxx's own tools/lightpooltest.cpp (the handover's section 3.6 vectors and the rest, 152
  checks), then the two caller helpers (the aimed point and the ground under the lamp head).
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGINELIGHT_LVLAMBIENT_NOPOOL, ENGINELIGHT_WARN_NO_HEADROOM, ENGINELIGHT_WARN_NO_POOL_WEATHER, ENGINELIGHT_WARN_NONE,
  ENGINELIGHT_WARN_RADIUS_LOW, ENGINELIGHT_WARN_SMALL_POOL, ENGINEWEATHER_CLEAR, ENGINEWEATHER_CLOUDY, ENGINEWEATHER_DENSE_FOG,
  ENGINEWEATHER_DUSK, ENGINEWEATHER_FOGGY, ENGINEWEATHER_NIGHT, ENGINEWEATHER_PITCH_BLACK, ENGINEWEATHER_RAIN, ENGINEWEATHER_SNOW,
  engineLightAimOffset, engineLightAmbientForWeather, engineLightBrightLevel, engineLightBrightness, engineLightContribution,
  engineLightCoreRadius, engineLightCpuValue, engineLightGroundUnderHead, engineLightHeightQ, engineLightIntensity,
  engineLightMaskHasPools, engineLightPackWord, engineLightPoolWarning, engineLightPoolWarningText, engineLightRadiusClamped,
  engineLightRadiusQ, engineLightVerticalFactor, engineLightVext, engineLightWeatherHasPools,
} from "../src/core/edit/engine-light-pool.ts";

// The C++ test's CHECK / CHECKEQ, counted so the total can be compared with lightpooltest.cpp's.
let checks = 0;
const check = (cond: boolean, what?: string) => {
  checks++;
  assert.ok(cond, what);
};
const checkEq = (got: number | boolean, want: number | boolean, what?: string) => {
  checks++;
  assert.equal(got, want, what);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

interface Vec {
  name: string;
  R: number;
  bright: number;
  aboveGround: number;
  amb: number;
  dx: number;
  dy: number;
  dz: number;
  w: number;
  vext: number;
  i: number;
  saturated: boolean;
  cpu: number;
  core: number;
}

const v = (name: string, R: number, bright: number, aboveGround: number, amb: number, dx: number, dy: number, dz: number,
  w: number, vext: number, i: number, sat: number, cpu: number, core: number): Vec =>
  ({ name, R, bright, aboveGround, amb, dx, dy, dz, w, vext, i, saturated: sat !== 0, cpu, core });

// The table of section 3.6, row for row. K is case A one foot in; H's amb comes from the LVL (rain, 0x6000).
const VECTORS: Vec[] = [
  v("A R64 b1 hgt8 night, (20,-8,0)", 64, 1.0, 8, 1280, 20, -8, 0, 147520, 64, 0.94117, 0, 4095, 20.0),
  v("K same at (19,-8,0)", 64, 1.0, 8, 1280, 19, -8, 0, 147520, 64, 0.94118, 1, 4096, 20.0),
  v("B R64 b1 dusk, (36,-8,0)", 64, 1.0, 8, 2304, 36, -8, 0, 147520, 64, 0.94117, 0, 4095, 36.0),
  v("C R64 b0.25 dusk, centre", 64, 0.25, 8, 2304, 0, -8, 0, 135232, 64, 0.75294, 0, 3327, 0.0),
  v("D R64 b0.5 dusk, (8,-8,0)", 64, 0.5, 8, 2304, 8, -8, 0, 139328, 64, 0.94117, 0, 4095, 8.0),
  v("E R64 b3 pitch black, (30,-8,40)", 64, 3.0, 8, 256, 30, -8, 40, 180288, 64, 0.65881, 0, 2943, 44.0),
  v("F R64 b1 night, wall (10,+55,0)", 64, 1.0, 8, 1280, 10, 55, 0, 147520, 64, 0.72744, 0, 3223, 20.0),
  v("J R64 b1 night, (0,+60,0)", 64, 1.0, 8, 1280, 0, 60, 0, 147520, 64, 0.50196, 0, 2303, 20.0),
  v("G R64 b2 lamp 200ft up, (16,-200,0)", 64, 2.0, 200, 1280, 16, -200, 0, 3309632, 400, 0.94118, 1, 4096, 42.0),
  v("H R40 b1.5 rain LVL 0x6000, (12,-10,9)", 40, 1.5, 10, 1792, 12, -10, 9, 221224, 40, 0.94118, 1, 4096, 25.0),
  v("I R64 b1 night, (65,-8,0) outside", 64, 1.0, 8, 1280, 65, -8, 0, 147520, 64, 0.25098, 0, 1280, 20.0),
];

test("TestVectors: every section 3.6 vector (packed word, V, GPU intensity, saturation, CPU value, core)", () => {
  for (const t of VECTORS) {
    const rq = engineLightRadiusQ(t.R);
    const level = engineLightBrightLevel(t.bright);
    const hq = engineLightHeightQ(t.aboveGround);
    const w = engineLightPackWord(rq, level, hq);
    const vext = engineLightVext(rq, hq);
    const b = engineLightBrightness(t.bright);
    const rh = Math.sqrt(t.dx * t.dx + t.dz * t.dz);
    const vf = engineLightVerticalFactor(vext, t.dy);
    const sum = engineLightContribution(rq, b, rh, vf);
    const { intensity, saturated } = engineLightIntensity(sum, t.amb, -1.0);
    const cpu = engineLightCpuValue(w, t.dx, t.dy, t.dz, t.amb);
    const core = engineLightCoreRadius(rq, b, t.amb);

    checkEq(w, t.w, t.name);
    checkEq(vext, t.vext, t.name);
    check(near(intensity, t.i, 0.000006), `${t.name}: i ${intensity}`); // the handover prints 5 decimals
    checkEq(saturated, t.saturated, t.name);
    checkEq(cpu, t.cpu, t.name);
    check(near(core, t.core, 0.005), `${t.name}: core ${core}`);
  }

  // "With slope vi_day 0.2, K becomes i 0.65506."
  {
    const k = VECTORS[1]!;
    const sum = engineLightContribution(64, 1.0, k.dx, engineLightVerticalFactor(64.0, k.dy));
    check(near(engineLightIntensity(sum, 1280, 0.2).intensity, 0.65506, 0.000006));
  }

  // The vertical zone is symmetric above and below the head: full to 0.75V, nothing at V.
  check(near(engineLightVerticalFactor(64.0, 48.0), 1.0, 1e-12));
  check(near(engineLightVerticalFactor(64.0, -48.0), 1.0, 1e-12));
  check(near(engineLightVerticalFactor(64.0, 56.0), 0.5, 1e-12));
  check(near(engineLightVerticalFactor(64.0, 64.0), 0.0, 1e-12));
  check(near(engineLightVerticalFactor(64.0, -70.0), 0.0, 1e-12));
});

test("TestWarnings: one warning per light, most serious first", () => {
  const all = 511;
  checkEq(engineLightPoolWarning(64.0, all, 32768, true), ENGINELIGHT_WARN_NONE);
  checkEq(engineLightPoolWarning(0.0, all, 32768, true), ENGINELIGHT_WARN_RADIUS_LOW);
  checkEq(engineLightPoolWarning(0.9, all, 32768, true), ENGINELIGHT_WARN_RADIUS_LOW);
  checkEq(engineLightPoolWarning(-10.0, all, 32768, true), ENGINELIGHT_WARN_RADIUS_LOW);
  // Clear, cloudy and snow only: nothing ever lights.
  checkEq(engineLightPoolWarning(64.0, 1 | 2 | 32, 32768, true), ENGINELIGHT_WARN_NO_POOL_WEATHER);
  // Rain + clear with an LVL ambient of 61440: no headroom in the only pool weather.
  checkEq(engineLightPoolWarning(64.0, 1 | 16, 61440, true), ENGINELIGHT_WARN_NO_HEADROOM);
  checkEq(engineLightPoolWarning(64.0, 1 | 16, 61439, true), ENGINELIGHT_WARN_NONE);
  // ... but night in the mask keeps the track's pools alive whatever the LVL says.
  checkEq(engineLightPoolWarning(64.0, 1 | 16 | 128, 65535, true), ENGINELIGHT_WARN_NONE);
  // Small pools: only on the coarse 32 ft grid.
  checkEq(engineLightPoolWarning(31.9, all, 32768, true), ENGINELIGHT_WARN_SMALL_POOL);
  checkEq(engineLightPoolWarning(32.0, all, 32768, true), ENGINELIGHT_WARN_NONE);
  checkEq(engineLightPoolWarning(20.0, all, 32768, false), ENGINELIGHT_WARN_NONE);
  check(engineLightPoolWarningText(ENGINELIGHT_WARN_NONE) === "");
  check(engineLightPoolWarningText(ENGINELIGHT_WARN_SMALL_POOL) !== "");
});

test("TestWeatherAndAmbient: fixed and LVL ambients, which weathers and masks have pools", () => {
  checkEq(engineLightAmbientForWeather(ENGINEWEATHER_NIGHT, 0), 1280);
  checkEq(engineLightAmbientForWeather(ENGINEWEATHER_DUSK, 0), 2304);
  checkEq(engineLightAmbientForWeather(ENGINEWEATHER_PITCH_BLACK, 0), 256);
  // Fixed weathers ignore the LVL ambient.
  checkEq(engineLightAmbientForWeather(ENGINEWEATHER_NIGHT, 65535), 1280);
  // Rain / fog follow it: LVL/16 + 256.
  checkEq(engineLightAmbientForWeather(ENGINEWEATHER_RAIN, 0x6000), 1792);
  checkEq(engineLightAmbientForWeather(ENGINEWEATHER_FOGGY, 0x8000), 2304);
  checkEq(engineLightAmbientForWeather(ENGINEWEATHER_DENSE_FOG, 0), 256);
  checkEq(engineLightAmbientForWeather(ENGINEWEATHER_RAIN, -5), 256);
  checkEq(engineLightAmbientForWeather(ENGINEWEATHER_RAIN, 99999), Math.trunc(65535 / 16) + 256); // clamped to 65535 first
  // LVL >= 61440 leaves no headroom in rain / fog.
  checkEq(engineLightAmbientForWeather(ENGINEWEATHER_RAIN, ENGINELIGHT_LVLAMBIENT_NOPOOL), 4096);
  check(engineLightAmbientForWeather(ENGINEWEATHER_RAIN, ENGINELIGHT_LVLAMBIENT_NOPOOL - 1) < 4096);
  // No pools: no ambient to speak of.
  checkEq(engineLightAmbientForWeather(ENGINEWEATHER_CLEAR, 0x8000), -1);
  checkEq(engineLightAmbientForWeather(ENGINEWEATHER_SNOW, 0x8000), -1);

  // Pools exist only in RAIN / DUSK / NIGHT / PITCH_BLACK / FOGGY / DENSE_FOG.
  check(!engineLightWeatherHasPools(ENGINEWEATHER_CLEAR));
  check(!engineLightWeatherHasPools(ENGINEWEATHER_CLOUDY));
  check(!engineLightWeatherHasPools(ENGINEWEATHER_SNOW));
  check(engineLightWeatherHasPools(ENGINEWEATHER_FOGGY));
  check(engineLightWeatherHasPools(ENGINEWEATHER_DENSE_FOG));
  check(engineLightWeatherHasPools(ENGINEWEATHER_RAIN));
  check(engineLightWeatherHasPools(ENGINEWEATHER_DUSK));
  check(engineLightWeatherHasPools(ENGINEWEATHER_NIGHT));
  check(engineLightWeatherHasPools(ENGINEWEATHER_PITCH_BLACK));
  check(!engineLightWeatherHasPools(-1));
  check(!engineLightWeatherHasPools(9));

  // Track weather masks: bit (1 << weather). 1 Clear, 2 Cloudy, 32 Snow only = no pools at all.
  check(!engineLightMaskHasPools(1 | 2 | 32));
  check(engineLightMaskHasPools(1 | 2 | 32 | 128));
  check(engineLightMaskHasPools(511));
  check(!engineLightMaskHasPools(0));
});

test("TestQuantisers: R truncates with no lower clamp, level, hq, V", () => {
  // R = min(int(rad), 4095), truncating, no lower clamp, and Traxx's clamped form.
  checkEq(engineLightRadiusQ(64.9), 64);
  checkEq(engineLightRadiusQ(4095.0), 4095);
  checkEq(engineLightRadiusQ(5000.0), 4095);
  checkEq(engineLightRadiusQ(0.5), 0);
  checkEq(engineLightRadiusQ(-10.0), -10);
  checkEq(engineLightRadiusClamped(0.5), 1);
  checkEq(engineLightRadiusClamped(-10.0), 1);
  checkEq(engineLightRadiusClamped(64.9), 64);
  checkEq(engineLightRadiusClamped(9999.0), 4095);

  // Brightness level clamp(int(bright*4+0.5), 1, 15).
  checkEq(engineLightBrightLevel(1.0), 4);
  checkEq(engineLightBrightLevel(0.25), 1);
  checkEq(engineLightBrightLevel(0.0), 1);
  checkEq(engineLightBrightLevel(-3.0), 1);
  checkEq(engineLightBrightLevel(1.1), 4); // 4.9 -> 4
  checkEq(engineLightBrightLevel(1.125), 5); // 5.0
  checkEq(engineLightBrightLevel(3.75), 15);
  checkEq(engineLightBrightLevel(10.0), 15);
  check(near(engineLightBrightness(3.75), 3.75, 1e-12));

  // hq = clamp(int(h/4 + 0.5), 0, 255): 4 ft steps, rounding at 2 ft.
  checkEq(engineLightHeightQ(8.0), 2);
  checkEq(engineLightHeightQ(1.99), 0);
  checkEq(engineLightHeightQ(2.0), 1);
  checkEq(engineLightHeightQ(-30.0), 0);
  checkEq(engineLightHeightQ(200.0), 50);
  checkEq(engineLightHeightQ(5000.0), 255);

  // V = max(8*hq, R).
  checkEq(engineLightVext(64, 2), 64);
  checkEq(engineLightVext(64, 50), 400);
  checkEq(engineLightVext(10, 0), 10);
});

test("TestCore: the saturated core radius", () => {
  // The handover's worked examples at R 64.
  check(near(engineLightCoreRadius(64, 1.0, 1280), 20.0, 0.005)); // night b1
  check(near(engineLightCoreRadius(64, 1.0, 2304), 36.0, 0.005)); // dusk b1
  check(near(engineLightCoreRadius(64, 1.0, 256), 4.0, 0.005)); // pitch black b1
  check(near(engineLightCoreRadius(64, 3.75, 1280) / 64.0, 0.817, 0.0005)); // night b3.75 -> 0.817 R

  // Never saturates when b < Hd/4096: night b <= 0.5, dusk b = 0.25, pitch black b <= 0.75.
  check(engineLightCoreRadius(64, 0.25, 1280) === 0.0);
  check(engineLightCoreRadius(64, 0.5, 1280) === 0.0);
  check(engineLightCoreRadius(64, 0.25, 2304) === 0.0);
  check(engineLightCoreRadius(64, 0.75, 256) === 0.0);
  check(engineLightCoreRadius(64, 1.0, 1280) > 0.0);
  // No headroom at all (LVL ambient >= 61440 in rain / fog): the formula says the whole radius is
  // "core", but the pool adds nothing visible; the guide code warns about this case instead of drawing it.
  check(engineLightCoreRadius(64, 1.0, 4096) === 64.0);

  // The core scales with R, and a higher ambient widens it.
  check(engineLightCoreRadius(128, 1.0, 1280) > engineLightCoreRadius(64, 1.0, 1280));
  check(engineLightCoreRadius(64, 1.0, 2304) > engineLightCoreRadius(64, 1.0, 1280));
});

test("the check count matches lightpooltest.cpp (152)", () => {
  assert.equal(checks, 152);
});

test("aimed point: aimOffset times (sin psi cos theta, cos psi cos theta), not normalised", () => {
  assert.deepEqual(engineLightAimOffset(10, 0, 0), [0, 10]);
  const [x, z] = engineLightAimOffset(10, 0, Math.PI / 2);
  assert.equal(x, 10);
  assert.ok(Math.abs(z) < 1e-6);
  // A tilted prop's offset shrinks by cos(theta).
  const [, zt] = engineLightAimOffset(10, Math.PI / 3, 0);
  assert.ok(Math.abs(zt - 5) < 1e-5);
});

test("ground under the head: a ground box's top when the head is above its bottom, else the terrain", () => {
  const terrain = () => 100;
  const box = () => ({ lo: 200, hi: 120 });
  assert.equal(engineLightGroundUnderHead(0, 0, 150, box, terrain), 200);
  assert.equal(engineLightGroundUnderHead(0, 0, 120, box, terrain), 100); // not above the bottom
  assert.equal(engineLightGroundUnderHead(0, 0, 500, () => ({ lo: 50, hi: 50 }), terrain), 100); // lo == hi: no box
  assert.equal(engineLightGroundUnderHead(0, 0, 500, () => null, terrain), 100);
});
