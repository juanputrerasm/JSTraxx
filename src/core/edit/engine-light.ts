/*
  The game engine's ground lighting and the Lighting dialog's sun helpers (Traxx 1.7.2,
  TrackPOD/EngineLight.cpp and Include/EngineLight.h, themselves a literal port of cursh2
  engine\LIGHT.cpp, core\Ground.cpp, engine\Matrix.cpp and engine\64BIT.H).

  Sun vectors are 16.16 fixed point, the direction the light TRAVELS; Y negative is above the
  horizon, world Y is up. The engine functions keep C's integer rules: fmul is a 64-bit product
  shifted right 16 (an arithmetic shift, so it floors) and cast to int; every int division
  truncates toward zero; a double assigned to an int truncates.

  The ground grid is N x N (z * N + x), wrapping at N. N = 256 is Traxx's (gridMask 255); a track
  format version 6 world of 512 cells wraps at 511 the same way.
*/

/** g_SunPresets order. */
export const SUNPRESET_N = 0;
export const SUNPRESET_E = 1;
export const SUNPRESET_S = 2;
export const SUNPRESET_W = 3;
export const SUNPRESET_NOON = 4;

export type SunVector = readonly [number, number, number] | readonly number[];

/** g_SunPresets: N, E, S, W, Noon (the numbers CTrackPOD::BuildLighting's old switch used). */
export const SUN_PRESETS: readonly (readonly [number, number, number])[] = [
  [0, -46333, -46333],
  [-46333, -46333, 0],
  [0, -46333, 46333],
  [46333, -46333, 0],
  [0, -64000, 0],
];

/** The CTrackPOD constructor's sun and ambient (TrackPOD.cpp), the E preset and 32768. */
export const TRAXX_DEFAULT_SUN: readonly [number, number, number] = [-46333, -46333, 0];
export const TRAXX_DEFAULT_AMBIENT = 32768;

/** core\World.h: groundXZ = 32, groundY = 4, GROUND_NORMAL_SCALE = 1. */
const ENGINE_GROUND_XZ = 32;
const ENGINE_GROUND_Y = 4;
const ENGINE_NORMAL_SCALE = 1;

const TWO53 = 2 ** 53;

/** engine\64BIT.H fmul: (int)(((__int64)a * b) >> 16). */
export function engineFmul(a: number, b: number): number {
  const p = a * b;
  if (Math.abs(p) < TWO53) return Math.floor(p / 65536) | 0;
  return Number(BigInt.asIntN(32, (BigInt(Math.trunc(a)) * BigInt(Math.trunc(b))) >> 16n));
}

/** C's int division: truncates toward zero. */
const idiv = (a: number, b: number) => Math.trunc(a / b);

/** engine\Matrix.cpp normalizeVectorLong: double precision, scale 65535, truncating assignment. */
function normalizeVectorLong(p: readonly number[]): [number, number, number] {
  let a = p[0]!, b = p[1]!, c = p[2]!;
  const l = Math.sqrt(a * a + b * b + c * c);
  if (l !== 0) {
    a = (a / l) * 65535;
    b = (b / l) * 65535;
    c = (c / l) * 65535;
  } else a = b = c = 0;
  return [Math.trunc(a) | 0, Math.trunc(b) | 0, Math.trunc(c) | 0];
}

/**
  core\Ground.cpp approxGroundNormal: the central difference of the four wrapped neighbours,
  normalised to 65535. `y0` is N x N (z * N + x), N a power of two (256 is the engine's).
*/
export function engineApproxGroundNormal(y0: ArrayLike<number>, x: number, z: number, n = 256): [number, number, number] {
  const m = n - 1;
  const y1 = y0[((z + 0) & m) * n + ((x + 1) & m)]!;
  const y2 = y0[((z + 1) & m) * n + ((x + 0) & m)]!;
  const y3 = y0[((z + 0) & m) * n + ((x - 1) & m)]!;
  const y4 = y0[((z - 1) & m) * n + ((x + 0) & m)]!;
  const p = [
    idiv(idiv(idiv(-(y1 - y3), 2) * ENGINE_GROUND_Y, 256), ENGINE_NORMAL_SCALE),
    idiv(ENGINE_GROUND_XZ, ENGINE_NORMAL_SCALE),
    idiv(idiv(idiv(-(y2 - y4), 2) * ENGINE_GROUND_Y, 256), ENGINE_NORMAL_SCALE),
  ];
  return normalizeVectorLong(p);
}

/**
  engine\LIGHT.cpp lightCalcDiffuse: amb + (65535 - amb) * clamp(-(L.n)), all 16.16, returned as
  i / 16 + 0x100. The ambient is clamped to 0..65535 as setAmbientLight does.
*/
export function engineLightCalcDiffuse(sun: SunVector, ambient: number, n: readonly number[]): number {
  if (ambient < 0) ambient = 0;
  if (ambient > 65535) ambient = 65535;
  let diff = (engineFmul(sun[0]!, n[0]!) + engineFmul(sun[1]!, n[1]!) + engineFmul(sun[2]!, n[2]!)) | 0;
  diff = -diff | 0;
  if (diff < 0) diff = 0;
  if (diff > 65535) diff = 65535;
  diff = (ambient + engineFmul(65535 - ambient, diff)) | 0;
  if (diff < 0) diff = 0;
  if (diff > 65535) diff = 65535;
  return idiv(diff, 16) + 0x100;
}

/** core\Ground.cpp lightSourceShadeWorld: l0 = (lightCalcDiffuse(normal) - 0x100) >> 4, a byte. */
export function engineGroundL0(sun: SunVector, ambient: number, n: readonly number[]): number {
  return ((engineLightCalcDiffuse(sun, ambient, n) - 0x100) >> 4) & 0xff;
}

/** EngineBakeGround: every tile's l0 from the engine's heights, z * N + x. */
export function engineBakeGround(y0: ArrayLike<number>, sun: SunVector, ambient: number, out?: Uint8Array, n = Math.round(Math.sqrt(y0.length))): Uint8Array {
  const ground = out ?? new Uint8Array(n * n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) ground[z * n + x] = engineGroundL0(sun, ambient, engineApproxGroundNormal(y0, x, z, n));
  }
  return ground;
}

/** SunMatchPreset: the preset this vector equals exactly, or -1. */
export function sunMatchPreset(v: SunVector): number {
  for (let i = 0; i < SUN_PRESETS.length; i++) {
    const p = SUN_PRESETS[i]!;
    if (v[0] === p[0] && v[1] === p[1] && v[2] === p[2]) return i;
  }
  return -1;
}

/** SunIsTraxxDefault: the constructor's sun (-46333, -46333, 0) and ambient 32768. */
export function sunIsTraxxDefault(v: SunVector, ambient: number): boolean {
  return v[0] === -46333 && v[1] === -46333 && v[2] === 0 && ambient === 32768;
}

const roundToInt = (d: number) => Math.floor(d + 0.5);

/** SunKeepStrengthFromXZ: X/Z placed (clamped to the circle of radius S), Y below them so |v| = S. */
export function sunKeepStrengthFromXZ(x: number, z: number, S: number): [number, number, number] {
  let fx = x, fz = z;
  const len = Math.sqrt(fx * fx + fz * fz);
  if (len > S) {
    fx = (fx / len) * S;
    fz = (fz / len) * S;
  }
  const ox = roundToInt(fx), oz = roundToInt(fz);
  let y2 = S * S - ox * ox - oz * oz;
  if (y2 < 0) y2 = 0;
  return [ox, 0 - roundToInt(Math.sqrt(y2)), oz]; // 0 - r: an int has no -0
}

/** SunKeepStrengthFromY: Y set (clamped to -S..0), X/Z rescaled along their direction so |v| = S. */
export function sunKeepStrengthFromY(v: SunVector, y: number, S: number): [number, number, number] {
  const fx = v[0]!, fz = v[2]!;
  const len = Math.sqrt(fx * fx + fz * fz);
  if (y > 0) y = 0;
  if (y < -S) y = -S;
  const want = Math.sqrt(S * S - y * y);
  // No horizontal direction to keep: straight up.
  if (len > 0) return [roundToInt((fx / len) * want), y, roundToInt((fz / len) * want)];
  return [0, y, 0];
}

/** SunElevationDeg: degrees above the horizon (0 for a zero vector). */
export function sunElevationDeg(v: SunVector): number {
  if (v[0] === 0 && v[1] === 0 && v[2] === 0) return 0;
  return (Math.atan2(-v[1]!, Math.sqrt(v[0]! * v[0]! + v[2]! * v[2]!)) * 180) / Math.PI;
}

/** SunStrengthPct: |v| as a percentage of 65536. */
export function sunStrengthPct(v: SunVector): number {
  return (100 * Math.sqrt(v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!)) / 65536;
}

/**
  SunSkyDirection: the unit vector from the ground toward the sun, -v / |v|; null for a zero
  vector or a sun at or below the horizon (v[1] >= 0).
*/
export function sunSkyDirection(v: SunVector): [number, number, number] | null {
  const x = -v[0]!, y = -v[1]!, z = -v[2]!;
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len <= 0 || v[1]! >= 0) return null;
  return [x / len, y / len, z / len];
}

function cross(o: readonly number[], a: readonly number[], b: readonly number[]): number {
  return (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
}

/**
  CubeShadowHull: the unit cube (0..1)^3 on the ground, lit along the sun's travel direction; the
  convex hull (counter-clockwise, collinear points dropped; Andrew's monotone chain) of its shadow
  on y = 0 as (x, z) points. Empty when the sun is not above the horizon (sun[1] >= 0).
*/
export function cubeShadowHull(sun: SunVector): [number, number][] {
  if (sun[1]! >= 0) return [];
  const pts: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const px = i & 1 ? 1 : 0, py = i & 2 ? 1 : 0, pz = i & 4 ? 1 : 0;
    const t = -py / sun[1]!; // along the travel direction down to y = 0
    pts.push([px + t * sun[0]!, pz + t * sun[2]!]);
  }
  // Sort by x then z (insertion sort, as Traxx).
  for (let i = 1; i < 8; i++) {
    const key = pts[i]!;
    let j = i - 1;
    while (j >= 0 && (pts[j]![0] > key[0] || (pts[j]![0] === key[0] && pts[j]![1] > key[1]))) {
      pts[j + 1] = pts[j]!;
      j--;
    }
    pts[j + 1] = key;
  }
  const eps = 1e-12;
  const hull: [number, number][] = [];
  let n = 0;
  for (let i = 0; i < 8; i++) {
    while (n >= 2 && cross(hull[n - 2]!, hull[n - 1]!, pts[i]!) <= eps) n--;
    hull[n++] = [pts[i]![0], pts[i]![1]];
  }
  for (let i = 6, k = n + 1; i >= 0; i--) {
    while (n >= k && cross(hull[n - 2]!, hull[n - 1]!, pts[i]!) <= eps) n--;
    hull[n++] = [pts[i]![0], pts[i]![1]];
  }
  n--; // the last point repeats the first
  return hull.slice(0, n);
}
