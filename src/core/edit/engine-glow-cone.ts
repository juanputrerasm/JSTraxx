/*
  The game engine's BOX_LIGHT glow and cone, the visible lamp a light prop draws on top of its ground
  pool (Traxx 1.8.0, Traxx/EngineGlowCone.h and Traxx/EngineGlowCone.cpp, pinned by
  tools/glowconetest.cpp; called by TraxxViewDisplay.cpp DrawLightGlowsOpenGL and OpenGLLightGlow.cpp
  DrawLightGlows). Ground truth there: the cursh2 engine-rules handover, sections 3.7 and 3.8 (allWx),
  and its reference port box_light(); engine core\weather.cpp drawLight, setFogDistance and
  core\Ground.cpp computeFog.

  Units: feet, engine axes (x, y UP, z), radians. The box frame is the box's own full rotation
  (genMatrix: pitch theta, roll phi, yaw psi); the lamp origin is box-local (0, hgt, 0). float32
  (Math.fround) is used exactly where the engine uses float, so the "dust" hash is bit-exact; every
  int division truncates toward zero and every float-to-int assignment truncates.

  NOT MODELLED (player settings and engine paths Traxx cannot know): [Graphics] headlightFlag (the
  caller passes it; the player default is 1), [Graphics] lightFogFade (default 0), the world wrap,
  the eye-under-water fog, the water-reflection pass, the engine's 16-bit angle matrix and its
  fixed-point view rotation (both below 1/256 ft).
*/
import {
  ENGINEWEATHER_DENSE_FOG, ENGINEWEATHER_FOGGY, ENGINEWEATHER_SNOW, engineLightWeatherHasPools,
} from "./engine-light-pool.ts";

const f = Math.fround;

/** A C (int) cast as MSVC x86/x64 does it: truncation, and 0x80000000 for NaN or out of range. */
function cInt(x: number): number {
  return x > -2147483649 && x < 2147483648 ? Math.trunc(x) : -2147483648;
}

/** C's int division: truncates toward zero. */
const idiv = (a: number, b: number) => Math.trunc(a / b);

/**
  [Graphics] visibleTiles as Traxx previews it: the live install has 150, which caps groundVisX at
  120, so the brightness step sits at D = 120 * 32 = 3840 ft. (The engine's own pre-INI default is 40.)
*/
export const ENGINEGLOWCONE_DEFAULT_VISTILES = 150;

/**
  The engine's MAX_LIGHT_PROPS: only the first 128 BOX_LIGHT boxes in .SIT order are kept
  (Simobj.cpp); the rest are dropped silently, pool, glow and cone alike. Glow mode 0 lights count.
*/
export const ENGINEGLOWCONE_MAX_LIGHT_PROPS = 128;

/** The engine's [Graphics] headlightFlag default. 0 = no glow or cone anywhere. */
export const ENGINEGLOWCONE_DEFAULT_HEADLIGHTFLAG = 1;

/**
  Texture names (ART\), read through the user's pod mount order, never hard-coded art: LITEFUZZ
  differs by pod set (stock grey noise, a modded gradient on some installs).
*/
export const ENGINEGLOWCONE_GLOWTEX = "headlite.raw"; // 64 x 64, own .ACT, keyed
export const ENGINEGLOWCONE_GLOWACT = "headlite.act";
export const ENGINEGLOWCONE_CONETEX = "litefuzz.raw"; // 256 x 256, own .ACT, greyscale
export const ENGINEGLOWCONE_CONEACT = "litefuzz.act";
export const ENGINEGLOWCONE_GLOWSIDE = 64;
export const ENGINEGLOWCONE_CONESIDE = 256;

/** The engine's texture colour key: a texel is transparent when r, g and b are ALL below this. */
export const ENGINEGLOWCONE_KEY_BELOW = 8;

export const ENGINEGLOWCONE_CONESIDES = 6;
/** 24, unshared: UVs are per facet. */
export const ENGINEGLOWCONE_CONEVERTS = 4 * ENGINEGLOWCONE_CONESIDES;

const GC_PI = 3.1415926535; // engine\matrix.h pi_

/**
  The light's fields by their engine meaning, named as TraxxLight (src/core/traxx/sit.ts) names
  them, so a TraxxLight passes as is. allWx is a separate argument of engineGlowConeBuild.
*/
export interface GlowConeLight {
  /** 0 nothing visible, 1 glow, 2 glow + cone. */
  glowMode: number;
  /** glowRad: the glow square's HALF size, ft. */
  glowRadius: number;
  /** hgt: the lamp origin above the box origin, box-local y, ft. */
  heightOffset: number;
  /** Tint 0..1. */
  r: number;
  g: number;
  b: number;
  /** coneLen, ft along box +z. */
  coneLength: number;
  /** coneRim: a RADIUS at z = coneLen. */
  coneRimRadius: number;
  /** coneBase: a DIAMETER at the lamp (radius coneBase/2), despite the name. */
  coneBaseRadius: number;
}

/** One vertex of the glow or the cone. */
export interface GlowConeVertex {
  /** Box-local feet, float32 (the light origin is (0, hgt, 0)). */
  local: [number, number, number];
  /** Engine world feet: box position + M * local. */
  world: [number, number, number];
  /** Texture coordinates 0..1 (engine texel / 256), float32. */
  u: number;
  v: number;
  /** Vertex alpha 0..255 (the engine's intensity >> 8). */
  alpha8: number;
}

export interface GlowConeResult {
  /** False = the gates said no: nothing at all. */
  drawn: boolean;
  /** The step (1.0 / 0.2) times the fog fade, float32; 0 = drawn but invisible. */
  brightness: number;
  /** computeFog 0..65535 (0 outside FOGGY / DENSE_FOG / SNOW). */
  fog: number;
  /** The light's eye-space depth along the camera forward, ft. */
  zView: number;
  /** lEye.z / |lEye|, float32: the glow shows only when > 0. */
  facingMe: number;
  /** The lamp origin, engine world feet. */
  lightWorld: [number, number, number];
  /** packLightTint. */
  rgb: [number, number, number];

  hasGlow: boolean;
  /** Triangles (0,1,2), (0,2,3); blend SRC_ALPHA, ONE. Empty when !hasGlow. */
  glow: GlowConeVertex[];

  hasCone: boolean;
  /**
    The cone passed the gate but coneRim = 0 with coneBase > 0: older engines divide by zero there
    (8071a7e guards it), so Traxx does NOT build it (hasCone false); warn the author.
  */
  coneRimZero: boolean;
  /** The dust hash, float32. */
  randVal1: number;
  randVal2: number;
  coneBaseAlpha8: number;
  /**
    Facet j = cone[4j..4j+3] = {j, j+6, prev+6, prev}; triangles (0,1,2), (0,2,3); blend SRC_ALPHA,
    INV_SRC_ALPHA; alpha linear in SCREEN space. Empty when !hasCone.
  */
  cone: GlowConeVertex[];
}

type Vec3 = readonly [number, number, number] | readonly number[];

/**
  Do the glow and cone show in this weather at all? RAIN, DUSK, NIGHT, PITCH_BLACK, FOGGY, DENSE_FOG
  (wouldHeadlightsShowUp), or ANY weather when allWx (the engine's type -2). The ground pool keeps its
  own rule (engineLightWeatherHasPools): allWx does not touch it.
*/
export function engineGlowConeWeatherShows(weather: number, allWx: number): boolean {
  return engineLightWeatherHasPools(weather) || allWx !== 0;
}

/* engineGlowConeHasCone and engineGlowConeRimZero are shared with Light Properties (src/core/traxx/light-props.ts). */
export { engineGlowConeHasCone, engineGlowConeRimZero } from "../traxx/light-props.ts";
import { engineGlowConeHasCone } from "../traxx/light-props.ts";

/** packLightTint: 0..1 -> bytes, int(c*255 + 0.5) clamped (NaN -> 0). */
export function engineGlowConeTint(r: number, g: number, b: number): [number, number, number] {
  const c = [f(r), f(g), f(b)];
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const x = c[i]! * 255.0 + 0.5;
    let v: number;
    if (!(x > 0.0)) v = 0;
    else if (x >= 256.0) v = 255;
    else v = Math.trunc(x);
    if (v > 255) v = 255;
    rgb[i] = v;
  }
  return rgb;
}

/** genMatrix (core\Sim.cpp) for pitch theta, roll phi, yaw psi, float32, rows m1..m9: world = M * local. */
export function engineGlowConeMatrix(theta: number, phi: number, psi: number): number[] {
  if (theta === 0 && phi === 0 && psi === 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];

  const sp = f(Math.sin(theta)), cp = f(Math.cos(theta));
  const sb = f(Math.sin(phi)), cb = f(Math.cos(phi));
  const sh = f(Math.sin(psi)), ch = f(Math.cos(psi));
  const ts = f(sh * sp);
  const tc = f(ch * sp);
  return [
    f(f(ch * cb) + f(ts * sb)),
    f(f(-ch * sb) + f(ts * cb)),
    f(sh * cp),
    f(sb * cp),
    f(cb * cp),
    -sp,
    f(f(-sh * cb) + f(tc * sb)),
    f(f(sb * sh) + f(tc * cb)),
    f(ch * cp),
  ];
}

/** Sim.cpp xformb2i: box-local -> world-oriented, float32. */
function b2i(v: Vec3, m: readonly number[]): [number, number, number] {
  return [
    f(f(f(v[0]! * m[0]!) + f(v[1]! * m[1]!)) + f(v[2]! * m[2]!)),
    f(f(f(v[0]! * m[3]!) + f(v[1]! * m[4]!)) + f(v[2]! * m[5]!)),
    f(f(f(v[0]! * m[6]!) + f(v[1]! * m[7]!)) + f(v[2]! * m[8]!)),
  ];
}

/** Sim.cpp xformi2b: world-oriented -> box-local, float32. */
function i2b(v: Vec3, m: readonly number[]): [number, number, number] {
  return [
    f(f(f(v[0]! * m[0]!) + f(v[1]! * m[3]!)) + f(v[2]! * m[6]!)),
    f(f(f(v[0]! * m[1]!) + f(v[1]! * m[4]!)) + f(v[2]! * m[7]!)),
    f(f(f(v[0]! * m[2]!) + f(v[1]! * m[5]!)) + f(v[2]! * m[8]!)),
  ];
}

/** setVisibility, LEGACY_GROUND_VIS: visibleTiles clamped 10..150, then capped at 120. */
function groundVisX(visTiles: number): number {
  let v = visTiles;
  if (v < 10) v = 10;
  if (v > 150) v = 150;
  return v > 120 ? 120 : v;
}

/**
  The brightness STEP before the fog fade (weather.cpp drawLight): 1.0 while
  int(zview*256) / (groundVisX*32*256) (C integer division) is 0, 0.2 floor once zview >= D. Behind
  the camera by D or more it is the engine's 2.0 (and more). float32.
*/
export function engineGlowConeStep(zViewFt: number, visTiles: number): number {
  const zi = cInt(zViewFt * 256.0);
  const d = groundVisX(visTiles) * 32 * 256;
  const q = idiv(zi, d);
  let brightness = f(1.0 * (1.0 - f(q)));
  if (brightness < f(0.2)) brightness = f(0.2);
  return brightness;
}

/**
  computeFog for a weather that fogs the lights (FOGGY, DENSE_FOG, SNOW; 0 for the rest): 0..65535
  from the light and eye in engine world feet. fogLen = sat * visT * 32 ft: FOGGY sat 10/visT (320 ft),
  DENSE_FOG 4/visT (128 ft), SNOW 0.85 (0.85 * visT * 32 ft).
*/
export function engineGlowConeFog(lightWorld: Vec3, eye: Vec3, weather: number, visTiles: number): number {
  let visT = visTiles;
  if (visT < 10) visT = 10;
  if (visT > 150) visT = 150;

  // setFogDistance: start 0 for all three.
  let sat: number;
  if (weather === ENGINEWEATHER_FOGGY) sat = f((1.0 * 10.0) / visT);
  else if (weather === ENGINEWEATHER_DENSE_FOG) sat = f((0.4 * 10.0) / visT);
  else if (weather === ENGINEWEATHER_SNOW) sat = f(0.85);
  else return 0;

  let fs = f(sat * f(visT));
  fs = f(fs * 32.0);
  fs = f(fs * 256.0);
  const fogMax = cInt(fs); // iSaturate; fogMinDist = 0
  const fogLen = fogMax;
  const fogMax2 = Math.imul(idiv(fogMax, 256), idiv(fogMax, 256));

  if (fogLen <= 0) return 0;

  const d = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    // wPos = int(light * 256) (the light position is float); vx = the eye's int. C int / truncates.
    const lw = cInt(f(lightWorld[k]!) * 256.0);
    const ew = cInt(eye[k]! * 256.0);
    d[k] = idiv((lw - ew) | 0, 256);
  }

  // int arithmetic: wraps on overflow as MSVC does, which the r2 < 0 test catches.
  const r2 = (Math.imul(d[0]!, d[0]!) + Math.imul(d[1]!, d[1]!) + Math.imul(d[2]!, d[2]!)) | 0;
  if (r2 < 0) return 0;
  if (r2 > fogMax2) return 0xffff;

  const r = cInt(Math.sqrt(r2 * 65536.0));
  return Math.trunc((65535 * r) / fogLen); // IMULIDIV(65535, r - fogMin, fogLen), 64-bit
}

function emptyResult(): GlowConeResult {
  return {
    drawn: false, brightness: 0, fog: 0, zView: 0, facingMe: 0, lightWorld: [0, 0, 0], rgb: [0, 0, 0],
    hasGlow: false, glow: [], hasCone: false, coneRimZero: false, randVal1: 0, randVal2: 0, coneBaseAlpha8: 0, cone: [],
  };
}

function vertex(local: [number, number, number], m: readonly number[], boxPos: Vec3, u: number, v: number, alpha8: number): GlowConeVertex {
  const w = b2i(local, m);
  return {
    local,
    world: [boxPos[0]! + w[0], boxPos[1]! + w[1], boxPos[2]! + w[2]],
    u, v, alpha8,
  };
}

const GLOW_SX = [1, -1, -1, 1];
const GLOW_SY = [1, 1, -1, -1];
const GLOW_UV = [[8, 8], [248, 8], [248, 248], [8, 248]] as const;

/**
  box_light(): everything one light draws this frame. boxPos = the box's position (engine world
  feet, the .SIT's floats), rot = (theta, phi, psi) as stored on the box, eye = the eye (engine world
  feet), camFwd = the unit camera forward (eye-space +z) in engine world axes. allWx = the light's
  all-weather flag (0 / 1). result.drawn is C's return value.
*/
export function engineGlowConeBuild(
  light: GlowConeLight,
  allWx: number,
  boxPos: Vec3,
  rot: Vec3,
  eye: Vec3,
  camFwd: Vec3,
  weather: number,
  visTiles: number = ENGINEGLOWCONE_DEFAULT_VISTILES,
  headlightFlag: number = ENGINEGLOWCONE_DEFAULT_HEADLIGHTFLAG,
): GlowConeResult {
  const out = emptyResult();
  const glowMode = light.glowMode | 0;

  // weather.cpp (headlightFlag), (glowMode 0), (the weather arm, -2 = allWx).
  if (!headlightFlag || glowMode === 0) return out;
  if (!engineGlowConeWeatherShows(weather, allWx)) return out;

  const m = engineGlowConeMatrix(rot[0]!, rot[1]!, rot[2]!);
  const hgt = f(light.heightOffset);
  const off = b2i([0, hgt, 0], m);
  const lw = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    lw[k] = f(boxPos[k]! + off[k]!);
    out.lightWorld[k] = lw[k]!;
  }

  // Brightness: the step, then the fog fade (FOGGY / DENSE_FOG / SNOW; SNOW reachable for a prop
  // only through allWx).
  let zView = 0.0;
  for (let k = 0; k < 3; k++) zView += (lw[k]! - eye[k]!) * camFwd[k]!;
  out.zView = zView;

  let brightness = engineGlowConeStep(zView, visTiles);
  if (weather === ENGINEWEATHER_FOGGY || weather === ENGINEWEATHER_DENSE_FOG || weather === ENGINEWEATHER_SNOW) {
    out.fog = engineGlowConeFog(out.lightWorld, eye, weather, visTiles);
    brightness = f(brightness * f((0xffff - out.fog) / 0xffff));
  }
  out.brightness = brightness;
  out.drawn = true;

  out.rgb = engineGlowConeTint(light.r, light.g, light.b);

  // The eye in the light frame; a prop's light heading is 0, so lEyeSpun = lEye.
  const ieye = [0, 0, 0];
  for (let k = 0; k < 3; k++) ieye[k] = f(f(eye[k]!) - f(boxPos[k]!)); // subvector(&wEye, &ipos), floats
  const beye = i2b(ieye, m);
  const leye = [beye[0], f(beye[1] - hgt), beye[2]];

  const mag = Math.sqrt(leye[0]! * leye[0]! + leye[1]! * leye[1]! + leye[2]! * leye[2]!);
  const facingMe = mag > 0.0 ? f(leye[2]! / mag) : 0;
  out.facingMe = facingMe;

  // THE GLOW: a square in box-local XY facing +Z, the "left" UV arm.
  if (facingMe > 0) {
    const bf = f(brightness * facingMe);
    const q = cInt(bf * 65535.0);
    const a8 = (q >> 8) & 0xff; // RGBA_MAKE keeps the low byte
    const R = f(f(cInt(f(f(light.glowRadius) * 256))) / 256); // p.x = radius*256, an int
    for (let k = 0; k < 4; k++) {
      const local: [number, number, number] = [f(GLOW_SX[k]! * R), f(hgt + f(GLOW_SY[k]! * R)), 0];
      out.glow.push(vertex(local, m, boxPos, f(GLOW_UV[k]![0] / 256), f(GLOW_UV[k]![1] / 256), a8));
    }
    out.hasGlow = true;
  }

  // THE CONE.
  if (engineGlowConeHasCone(light)) {
    const N = ENGINEGLOWCONE_CONESIDES;
    const BORDER = 4, FAN = 64;
    const base = f(light.coneBaseRadius), rim = f(light.coneRimRadius);
    const pos: [number, number, number][] = [];
    let angle = f(((2 + (N & 1)) * GC_PI) / 2);
    const step = f((2 * GC_PI) / N);
    const rimz = cInt(256.0 * f(light.coneLength));

    if (rim === 0 && base > 0) {
      out.coneRimZero = true; // the engine's x/0: not built
      return out;
    }

    for (let j = 0; j < N; j++) {
      const c = f(Math.cos(angle) * 256.0);
      const s = f(Math.sin(angle) * 256.0);
      pos[j] = [
        f(f(cInt(f(f(c * base) / 2))) / 256),
        f(hgt + f(f(cInt(f(f(s * base) / 2))) / 256)),
        0,
      ];
      pos[j + N] = [
        f(f(cInt(f(c * rim))) / 256),
        f(hgt + f(f(cInt(f(s * rim))) / 256)),
        f(f(rimz) / 256),
      ];
      angle = f(angle + step);
    }

    const basea = cInt(brightness * 0.09 * 65535) >> 8;

    // The dust hash: float, summed left to right.
    let r = f(boxPos[0]!);
    r = f(r + f(boxPos[1]!));
    r = f(r + f(boxPos[2]!));
    r = f(r + leye[0]!);
    r = f(r + leye[1]!);
    r = f(r + leye[2]!);

    const rv1 = f((cInt(f(r * 493)) & 65535) / 65535.0);
    const rv2 = f((cInt(f(r * 581)) & 65535) / 65535.0);
    out.randVal1 = rv1;
    out.randVal2 = rv2;
    out.coneBaseAlpha8 = basea;

    // 16.16 texel coordinates, as the engine stores them (ints); the same for every facet.
    const yj = cInt((FAN + BORDER + rv1 * (256.0 - (FAN + BORDER) * 2)) * 65536);
    const yprev = cInt(f(f(yj) + f(f(f(f(FAN * base) / 2) / rim) * 65536))); // int + float is float
    const yrj = cInt(f(f(yj) - f(f(rv2 * FAN) * 65536)));
    const yrp = (yrj + FAN * 65536) | 0;
    const xs = [BORDER * 65536, (256 - BORDER) * 65536, (256 - BORDER) * 65536, BORDER * 65536];
    const ys = [yj, yrj, yrp, yprev];
    const as = [basea, 0, 0, basea];

    let prev = N - 1;
    for (let j = 0; j < N; j++) {
      const idx = [j, j + N, prev + N, prev];
      for (let k = 0; k < 4; k++) {
        const p = pos[idx[k]!]!;
        out.cone.push(vertex([p[0], p[1], p[2]], m, boxPos, f(xs[k]! / 65536.0 / 256.0), f(ys[k]! / 65536.0 / 256.0), as[k]!));
      }
      prev = j;
    }
    out.hasCone = true;
  }

  return out;
}
