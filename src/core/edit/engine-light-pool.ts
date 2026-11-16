/*
  The game engine's BOX_LIGHT ground-pool rule for the light guides (Traxx 1.8.0,
  Traxx/EngineLightPool.h and Traxx/EngineLightPool.cpp, pinned by tools/lightpooltest.cpp; the
  ground under the lamp head is TraxxViewDisplay.cpp's LightGroundZUnderHead and the aimed point
  its aimOffset formula). Ground truth there: the cursh2 engine-rules handover, section 3, and its
  Python reference port, not re-derived.

  Units: feet; ambient on the engine's 0..4096 scale (256 = no light at all, 4096 = full). The C
  rules are kept: a float argument is rounded to float32 first (Math.fround), every int division
  truncates toward zero, and a double or float assigned to an int truncates (cInt; out of the int
  range MSVC's conversion gives INT_MIN, as cInt does).
*/

/*
  The quantiser, the bounds and the author warnings are shared with Light Properties: they live in
  src/core/traxx/light-props.ts and are re-exported here so the view reads one copy.
*/
import { ENGINELIGHT_POOL_WEATHER_MASK, ENGINELIGHT_RADIUS_MAX, engineLightRadiusQ } from "../traxx/light-props.ts";
export {
  ENGINELIGHT_LVLAMBIENT_NOPOOL, ENGINELIGHT_POOL_WEATHER_MASK, ENGINELIGHT_RADIUS_MAX, ENGINELIGHT_RADIUS_MIN, ENGINELIGHT_WARN_NONE,
  ENGINELIGHT_WARN_NO_HEADROOM, ENGINELIGHT_WARN_NO_POOL_WEATHER, ENGINELIGHT_WARN_RADIUS_LOW, ENGINELIGHT_WARN_SMALL_POOL,
  engineLightPoolWarning, engineLightPoolWarningText, engineLightRadiusQ,
} from "../traxx/light-props.ts";

const f = Math.fround;

/** A C (int) cast as MSVC x86/x64 does it: truncation, and 0x80000000 for NaN or out of range. */
function cInt(x: number): number {
  return x > -2147483649 && x < 2147483648 ? Math.trunc(x) : -2147483648;
}

/** C's int division: truncates toward zero. */
const idiv = (a: number, b: number) => Math.trunc(a / b);

const saturate = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The engine's weather numbers (bit (1 << weather) is the track's weather mask and a Fog's wmask). */
export const ENGINEWEATHER_CLEAR = 0;
export const ENGINEWEATHER_CLOUDY = 1;
export const ENGINEWEATHER_FOGGY = 2;
export const ENGINEWEATHER_DENSE_FOG = 3;
export const ENGINEWEATHER_RAIN = 4;
export const ENGINEWEATHER_SNOW = 5;
export const ENGINEWEATHER_DUSK = 6;
export const ENGINEWEATHER_NIGHT = 7;
export const ENGINEWEATHER_PITCH_BLACK = 8;
export const ENGINEWEATHER_COUNT = 9;


/** Does a light pool (and glow, and cone) exist in this weather? False for clear, cloudy, snow. */
export function engineLightWeatherHasPools(weather: number): boolean {
  if (weather < 0 || weather >= ENGINEWEATHER_COUNT) return false;
  return (ENGINELIGHT_POOL_WEATHER_MASK & (1 << weather)) !== 0;
}

/** Is there any pool weather in a track weather mask? */
export function engineLightMaskHasPools(weatherMask: number): boolean {
  return (weatherMask & ENGINELIGHT_POOL_WEATHER_MASK) !== 0;
}

/**
  Ambient (0..4096 scale) the pool is added to. NIGHT 1280, DUSK 2304, PITCH_BLACK 256 are fixed;
  RAIN, FOGGY and DENSE_FOG use the LVL ambient (0..65535): LVL/16 + 256. -1 for a weather without pools.
*/
export function engineLightAmbientForWeather(weather: number, lvlAmbient: number): number {
  switch (weather) {
    case ENGINEWEATHER_NIGHT: return idiv(0x4000, 16) + 0x100;
    case ENGINEWEATHER_DUSK: return idiv(0x8000, 16) + 0x100;
    case ENGINEWEATHER_PITCH_BLACK: return 0x100;
    case ENGINEWEATHER_RAIN:
    case ENGINEWEATHER_FOGGY:
    case ENGINEWEATHER_DENSE_FOG: {
      let lvl = lvlAmbient;
      if (lvl < 0) lvl = 0;
      if (lvl > 65535) lvl = 65535;
      return idiv(lvl, 16) + 0x100;
    }
  }
  return -1;
}

/** Brightness level 1..15 = clamp(int(bright*4 + 0.5), 1, 15). */
export function engineLightBrightLevel(bright: number): number {
  let level = cInt(f(bright) * 4.0 + 0.5);
  if (level < 1) level = 1;
  if (level > 15) level = 15;
  return level;
}

/** The brightness multiplier b = level/4 (0.25 .. 3.75). */
export function engineLightBrightness(bright: number): number {
  return engineLightBrightLevel(bright) * 0.25;
}


/** The radius Traxx draws and validates: engineLightRadiusQ held to 1..4095. */
export function engineLightRadiusClamped(rad: number): number {
  const r = engineLightRadiusQ(rad);
  return r < 1 ? 1 : r;
}

/** hq = clamp(int(h/4 + 0.5), 0, 255); h = lamp head above the ground under the AIMED point (negative -> 0). */
export function engineLightHeightQ(headAboveGroundFt: number): number {
  let h = headAboveGroundFt;
  if (h < 0.0) h = 0.0;
  let q = cInt(h / 4.0 + 0.5);
  if (q < 0) q = 0;
  if (q > 255) q = 255;
  return q;
}

/** V = max(8*hq, R): the vertical half-extent. Full strength to 0.75V, linear fade to nothing at V. */
export function engineLightVext(radiusQ: number, heightQ: number): number {
  return heightQ * 8 > radiusQ ? heightQ * 8 : radiusQ;
}

/** The packed word the engine uploads: R + level*4096 + hq*65536. */
export function engineLightPackWord(radiusQ: number, level: number, heightQ: number): number {
  return (radiusQ + level * 4096 + heightQ * 65536) | 0;
}

/** vf = saturate((V - |dy|) / (0.25 V)). */
export function engineLightVerticalFactor(vext: number, dyFt: number): number {
  return saturate((vext - Math.abs(dyFt)) / (vext * 0.25));
}

/**
  One light's contribution before the /16: 65535 * b * max(0, 1 - r/R) * vf (r horizontal). This is
  the GPU per-vertex term; the handover's per-light C is this / 16 (= 4095.9375 * ...).
*/
export function engineLightContribution(radiusQ: number, b: number, rhFt: number, vf: number): number {
  return saturate((radiusQ - rhFt) / radiusQ) * vf * 65535.0 * b;
}

/** engineLightIntensity's result: i, and whether sum/16 >= 4096 - amb (C's *saturated). */
export interface EngineLightIntensityResult {
  intensity: number;
  saturated: boolean;
}

/**
  Intensity i = ((min(sum/16, 4096 - amb) + amb) - 256) / 4080, times the slope factor
  (0.62 + 0.38*saturate(vi_day)) when slopeVi >= 0 (cached terrain path; pass a negative value for none).
*/
export function engineLightIntensity(sumContribution: number, amb: number, slopeVi: number): EngineLightIntensityResult {
  let t16 = sumContribution / 16.0;
  const headroom = 4096.0 - amb;
  const saturated = t16 >= headroom;
  if (t16 > headroom) t16 = headroom;
  let i = (t16 + amb - 256.0) / 4080.0;
  if (slopeVi >= 0.0) i *= 0.62 + 0.38 * saturate(slopeVi);
  return { intensity: i, saturated };
}

/**
  The engine CPU path (Ground.cpp lightLocalPoint, integer): value on the 256..4096 scale for one
  light at the whole-foot offsets (dx,dy,dz) from the lamp head. Pass the packed word from
  engineLightPackWord. A decoded radius of 0 at the lamp's own column is the C code's x/0 (a crash);
  here it adds nothing, as 8071a7e's rad < 1 rule does.
*/
export function engineLightCpuValue(packedWord: number, dxFt: number, dyFt: number, dzFt: number, amb: number): number {
  // Offsets are whole feet, so the engine's (feet*256)/256 division is exact.
  const hq = idiv(packedWord, 65536);
  const rem = packedWord % 65536;
  const level = idiv(rem, 4096);
  const d = rem % 4096;
  let total = 0;
  const rh2 = (dxFt * dxFt + dzFt * dzFt) | 0;

  if (rh2 <= d * d && d !== 0) {
    const vext = hq * 8 > d ? hq * 8 : d;
    const ady = dyFt < 0 ? -dyFt : dyFt;
    if (ady < vext) {
      const rh = cInt(Math.sqrt(rh2));
      let e = idiv(idiv(65535 * (d - rh), d) * level, 4); // C division, toward zero
      const vfull = idiv(vext * 3, 4);
      if (ady > vfull) e = idiv(e * (vext - ady), vext - vfull);
      total += e;
    }
  }

  total = idiv(total, 16);
  if (total > 0x1000 - amb) total = 0x1000 - amb;
  return total + amb;
}

/** Saturated core radius, feet: R * max(0, 1 - (4096 - amb)/(4095.9375*b)). 0 = never saturates. */
export function engineLightCoreRadius(radiusQ: number, b: number, amb: number): number {
  const headroom = 4096.0 - amb;
  const r = radiusQ * (1.0 - headroom / (4095.9375 * b));
  return r > 0.0 ? r : 0.0;
}


/**
  Where the engine puts the pool (TraxxViewDisplay.cpp's light overlay, from genMatrix and
  addSceneryLights): the aimed point is the box origin plus aimOffset times (m3, m9), m3 =
  sin(psi)*cos(theta), m9 = cos(psi)*cos(theta), each rounded to float32. Returns the offset in
  engine feet along engine x and engine z (Traxx x and Traxx y). Not normalised: the shrink as a
  prop tilts is the engine's. The caller truncates to its own grid units, as Traxx does
  (ipos = post + (int)(aim*2*m3)).
*/
export function engineLightAimOffset(aimOffset: number, theta: number, psi: number): [number, number] {
  const m3 = f(Math.sin(psi) * Math.cos(theta));
  const m9 = f(Math.cos(psi) * Math.cos(theta));
  const aim = f(aimOffset);
  return [f(aim * m3), f(aim * m9)];
}

/** A ground box cell's two heights (pod.GetRA0 / GetRA1: lower and upper, in either order). */
export interface EngineLightGroundBoxCell {
  lo: number;
  hi: number;
}

/**
  The surface the ENGINE measures a lamp's height over (Ground.cpp newGroundHeight, handover section
  3.1; Traxx's LightGroundZUnderHead): the ground-box TOP of the cell under the point when the lamp
  head is above that box's bottom, else the terrain. groundBoxAt returns the cell's two heights (equal
  or null = no box) and terrainAt the terrain height, both in headZ's units.
*/
export function engineLightGroundUnderHead(
  x: number,
  y: number,
  headZ: number,
  groundBoxAt: (x: number, y: number) => EngineLightGroundBoxCell | null,
  terrainAt: (x: number, y: number) => number,
): number {
  const cell = groundBoxAt(x, y);
  if (cell !== null && cell.lo !== cell.hi) {
    const bottom = Math.min(cell.lo, cell.hi);
    const top = Math.max(cell.lo, cell.hi);
    if (headZ > bottom) return top;
  }
  return terrainAt(x, y);
}
