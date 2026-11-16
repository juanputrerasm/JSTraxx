/*
  The game engine's sky in the 3D view (Traxx 1.8.0, b6d56f2: Traxx/EngineSky.h / EngineSky.cpp,
  the pure parts of Traxx/OpenGLSky.cpp, and EngineSunBallDirection / EngineDirToTraxxWorld of
  TrackPOD/EngineLight.cpp). Ground truth there: cursh2 core\Sky.cpp loadSky / sphereMe /
  sphericalSky / fogOutWindow / drawBallInTheSky / drawSky, core\weather.cpp setFogTable and the
  sun vector, engine\texload.cpp (the HD probe order), engine\Matrix.cpp (the ball's size).

  Axes are the ENGINE's unless a name says otherwise: +y up, heading 0 = +z, heading 90 degrees =
  +x. engineDirToTraxxWorld turns an engine direction into Traxx's world (x, y ground, z up), the
  axes JSTraxx's scene uses too.

  The weather numbers are the engine's (EngineLightPool.h ENGINEWEATHER_*), the order of View >
  Preview Weather: Clear, Cloudy, Foggy, Dense fog, Rain, Snow, Dusk, Night, Pitch black.

  C rules kept: EngineSkyGrey works in float (Math.fround) and truncates; everything else in
  EngineSky.cpp is double. The art comes through game-pods.ts (the game library, read-only).
  Palettes are the .ACT's bytes as stored, as the engine's fread copies them (no 6-bit guess).
*/
import { decodeIndexedImage } from "../../vendor/openphotex/texture/raw.js";
import { hdGetInfoMem } from "../image/hd-texture.ts";
import type { RgbaImage } from "./tiles.ts";
import type { GamePods } from "./game-pods.ts";

const f32 = Math.fround;
const SKY_PI = 3.14159265358979323846;

// ---- the engine's weather numbers (EngineLightPool.h) ----

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

/** View > Preview Weather's names, by engine weather number. */
export const ENGINE_WEATHER_NAMES = ["Clear", "Cloudy", "Foggy", "Dense fog", "Rain", "Snow", "Dusk", "Night", "Pitch black"] as const;

// ---- EngineSky.h ----

/** RING_COUNT: segments around. */
export const ENGINESKY_RING = 16;
/** HEIGHT_COUNT: rings, so 3 bands of quads. */
export const ENGINESKY_HEIGHT = 4;
export const ENGINESKY_RADIUS = 1024.0;
/** The main pass's bottom ring, radians below the horizon. */
export const ENGINESKY_DIP = -0.005;
/** SKY_COLOR_BASE: global palette slots 230..245. */
export const ENGINESKY_BASE = 230;
/** SKY_COLOR_LENGTH. */
export const ENGINESKY_LENGTH = 16;
/** The .ACT entries copied there: 192..207. */
export const ENGINESKY_ACTFIRST = 192;
/** readLevel's %39s. */
export const ENGINESKY_NAMEMAX = 39;

/** TraxxView.h TRAXX_WORLDXY_PERFOOT / TRAXX_WORLDZ_PERFOOT (EngineLight.h ENGINELIGHT_WORLD*). */
export const ENGINELIGHT_WORLDXY_PERFOOT = 128.0;
export const ENGINELIGHT_WORLDZ_PERFOOT = 96.0;

/**
  EngineSkyHasDome: true when the weather draws the textured dome (and the backdrop): Clear,
  Cloudy, Rain, Dusk, Night (and anything unknown). False for Snow, Foggy, Dense fog, Pitch black:
  a full-screen fog-colour fill, no dome, no backdrop.
*/
export function engineSkyHasDome(weather: number): boolean {
  switch (weather) {
    case ENGINEWEATHER_SNOW:
    case ENGINEWEATHER_FOGGY:
    case ENGINEWEATHER_DENSE_FOG:
    case ENGINEWEATHER_PITCH_BLACK:
      return false;
  }
  return true;
}

/** EngineSkyFogColour: the fog colour (setFogTable -> APIsetFogColor2), which fogOutWindow fills the screen with. */
export function engineSkyFogColour(weather: number): [number, number, number] {
  switch (weather) {
    case ENGINEWEATHER_RAIN: return [72, 72, 74];
    case ENGINEWEATHER_SNOW: return [192, 192, 192];
    case ENGINEWEATHER_DUSK: return [134, 96, 102];
    case ENGINEWEATHER_NIGHT: return [22, 28, 45];
    case ENGINEWEATHER_FOGGY: return [140, 140, 140];
    case ENGINEWEATHER_DENSE_FOG: return [139, 139, 139];
    case ENGINEWEATHER_PITCH_BLACK: return [0, 0, 0];
    case ENGINEWEATHER_CLEAR: return [150, 170, 200];
    case ENGINEWEATHER_CLOUDY:
    default: return [140, 140, 140];
  }
}

/** The ball drawBallInTheSky draws (EngineSkyBall). */
export interface EngineSkyBall {
  /** 1 the sun, 2 the moon. */
  kind: 1 | 2;
  /** "suncram.raw" / "moon.raw". */
  raw: string;
  /** .5 / .07. */
  radius: number;
  /** x1, y1, x2, y2 in texels. */
  tex: readonly [number, number, number, number];
  /** The texture side those texels are in (128 / 256). */
  side: number;
}

/** EngineSkyBallFor (drawSkyBall): the sun in Clear, the moon at Night, else null. */
export function engineSkyBallFor(weather: number): EngineSkyBall | null {
  if (weather === ENGINEWEATHER_CLEAR) return { kind: 1, raw: "suncram.raw", radius: 0.5, tex: [4, 4, 124, 124], side: 128 };
  if (weather === ENGINEWEATHER_NIGHT) return { kind: 2, raw: "moon.raw", radius: 0.07, tex: [8, 8, 248, 248], side: 256 };
  return null;
}

/**
  EngineSkyBallHalfTangent (drawBallInTheSky + Matrix.cpp): the ball's half size as a tangent of
  the view angle, both axes: radius * 66536/65536 * (window width / window height). Independent of
  the field of view; times the focal length in pixels it is the half size in pixels.
*/
export function engineSkyBallHalfTangent(radius: number, aspect: number): number {
  return radius * (66536.0 / 65536.0) * aspect;
}

/**
  EngineSunBallDirection (EngineLight.cpp): where the sky's sun / moon ball is drawn, the LVL light
  vector (16.16, the direction light travels) negated with its engine y halved ("!KLUDGE! Lower
  sun in the sky a bit", weather.cpp:300-302), normalised. No horizon test: the engine draws the
  ball wherever it is in front of the eye. null only for a zero vector.
*/
export function engineSunBallDirection(v: readonly number[]): [number, number, number] | null {
  const x = -v[0]!, y = -v[1]! * 0.5, z = -v[2]!;
  const len = Math.sqrt(x * x + y * y + z * z);
  if (!(len > 0)) return null;
  return [x / len, y / len, z / len];
}

/**
  EngineVisibleSunDirection (EngineLight.cpp): where the game draws the visible sun, the ball's
  direction plus the horizon test (v[1] >= 0 is none). View > Show Sun's big disc.
*/
export function engineVisibleSunDirection(v: readonly number[]): [number, number, number] | null {
  if (v[1]! >= 0) return null;
  return engineSunBallDirection(v);
}

/**
  EngineDirToTraxxWorld: an engine direction (feet: x, y up, z) as a Traxx world direction (x, y
  ground, z up) in world units, 128 per foot across and 96 up. Not normalised. JSTraxx's scene
  (64 units a 32 ft cell across, ALTITUDESCALE 3 a 2 ft step up) has the same 4 : 3 ratio, so the
  result is a scene direction too, up to one uniform factor.
*/
export function engineDirToTraxxWorld(e: readonly number[]): [number, number, number] {
  return [e[0]! * ENGINELIGHT_WORLDXY_PERFOOT, e[2]! * ENGINELIGHT_WORLDXY_PERFOOT, e[1]! * ENGINELIGHT_WORLDZ_PERFOOT];
}

// ---- which image (loadSky) ----

/** EngineSkyLengthFn: the game's dosFileLength, the length of <dir>\<name>, -1 when nowhere. */
export type EngineSkyLengthFn = (dir: string, name: string) => number;

/** %39s: the first whitespace-delimited token, at most 39 characters. */
function skyToken(s: string | null | undefined): string {
  if (!s) return "";
  let i = 0;
  const ws = (c: string) => c === " " || c === "\t" || c === "\r" || c === "\n";
  while (i < s.length && ws(s[i]!)) i++;
  let out = "";
  while (i < s.length && !ws(s[i]!) && out.length < ENGINESKY_NAMEMAX) out += s[i++]!;
  return out;
}

/**
  The .LVL sky names Traxx's Write POD writes (WriteLVLFile; the DrawSky caller in
  TraxxViewDisplay.cpp): cloudy2 for an MTM2-only track, aliensky / earthsky with level type 4
  otherwise (versionFlags without MTM2_ONLY). levelType4 is that same test.
*/
export function engineSkyTrackNames(mtm2Only: boolean): { raw: string; act: string; levelType4: boolean } {
  return mtm2Only ? { raw: "cloudy2.raw", act: "cloudy2.act", levelType4: false } : { raw: "aliensky.raw", act: "earthsky.act", levelType4: true };
}

/**
  EngineSkyPickNames: the final .RAW / .ACT names before the "is it there" fallback: the .LVL's
  lines 11/12 (cut to 39 characters), cloudy2 for an original MTM level (levelType 4), then the
  weather override (Dusk dusksky, Rain cclouds, Night nitesky). The fill weathers keep the
  track's names (no dome is drawn).
*/
export function engineSkyPickNames(weather: number, levelType4: boolean, lvlRaw: string | null, lvlAct: string | null): { raw: string; act: string } {
  let raw = skyToken(lvlRaw), act = skyToken(lvlAct);
  if (levelType4) { raw = "cloudy2.raw"; act = "cloudy2.act"; }
  if (weather === ENGINEWEATHER_DUSK) { raw = "dusksky.raw"; act = "dusksky.act"; }
  else if (weather === ENGINEWEATHER_RAIN) { raw = "cclouds.raw"; act = "cclouds.act"; }
  else if (weather === ENGINEWEATHER_NIGHT) { raw = "nitesky.raw"; act = "nitesky.act"; }
  return { raw, act };
}

/** EngineSkyChoice: loadSky's whole choice. */
export interface EngineSkyChoice {
  raw: string;
  act: string;
  /** True when the picked sky was missing and cloudy2 stands in. */
  fellback: boolean;
  /** True in Cloudy: the sky's palette window (and an HD sky's pixels) greyed. */
  greyscale: boolean;
}

/**
  EngineSkyResolve: the picked names, then cloudy2 when ART\<raw> or ART\<act> is missing or empty
  (length <= 0) - "If we can't find this sky, the default to the basic sky".
*/
export function engineSkyResolve(weather: number, levelType4: boolean, lvlRaw: string | null, lvlAct: string | null, len: EngineSkyLengthFn | null): EngineSkyChoice {
  let { raw, act } = engineSkyPickNames(weather, levelType4, lvlRaw, lvlAct);
  let fellback = false;
  if (len === null || raw === "" || act === "" || len("art", raw) <= 0 || len("art", act) <= 0) {
    if (raw !== "cloudy2.raw" || act !== "cloudy2.act") fellback = true;
    raw = "cloudy2.raw";
    act = "cloudy2.act";
  }
  return { raw, act, fellback, greyscale: weather === ENGINEWEATHER_CLOUDY };
}

/** texload.cpp artSwapExt: the LAST dot's extension replaced; a name with no dot gets one appended. */
function skySwapExt(name: string, ext: string): string | null {
  if (!name) return null;
  const dot = name.lastIndexOf(".");
  const stem = dot >= 0 ? dot : name.length;
  if (stem + 1 + ext.length + 1 > ENGINESKY_NAMEMAX + 8) return null;
  return `${name.slice(0, stem)}.${ext}`;
}

/** The HD extensions in probe order (texload.cpp artProbeImageOnly). */
export const ENGINESKY_HD_EXTS = ["PNG", "TGA"] as const;

/** One HD probe: read <dir>\<name>. */
export interface EngineSkyProbe { dir: "WeatherArt" | "art"; name: string; ext: "PNG" | "TGA" }

/**
  EngineSkyHDProbes (texload.cpp artProbeImageOnly / artPickDir): for .PNG then .TGA, ONE directory
  each, WeatherArt when <stem>.<ext> is there (length > 0), else art. Two probes (a name with no
  dot gets the extension appended); none for an empty or over-long name. Read them in order: the
  first whose signature and header answer is THE image (a non-PNG/TGA signature, or no readable
  header, moves on); a decode failure after that means the legacy .RAW. HD art applies to sky
  stems and the sun / moon only (artIsWeatherStem).
*/
export function engineSkyHDProbes(rawName: string, len: EngineSkyLengthFn | null): EngineSkyProbe[] {
  const out: EngineSkyProbe[] = [];
  for (const ext of ENGINESKY_HD_EXTS) {
    const name = skySwapExt(rawName, ext);
    if (name === null) continue;
    out.push({ dir: len !== null && len("WeatherArt", name) > 0 ? "WeatherArt" : "art", name, ext });
  }
  return out;
}

// ---- palette ----

/**
  EngineSkyGrey (loadSky's Cloudy grey), one colour in place at `o`: m = (int)sqrt((r*.5773)^2 +
  (g*.5773)^2 + (b*.5773)^2), the products in double cast to float, the rest in float.
*/
export function engineSkyGrey(rgb: Uint8Array | Uint8ClampedArray | number[], o = 0): void {
  const r = f32(rgb[o]! * 0.5773), g = f32(rgb[o + 1]! * 0.5773), b = f32(rgb[o + 2]! * 0.5773);
  const m = Math.trunc(f32(Math.sqrt(f32(f32(f32(r * r) + f32(g * g)) + f32(b * b)))));
  rgb[o] = rgb[o + 1] = rgb[o + 2] = m & 255;
}

/**
  EngineSkyPalette: the global palette the sky's .RAW resolves through after loadSky: the level
  palette (768 bytes) with the sky .ACT's bytes 576..623 (entries 192..207) read over slots
  230..245 (as many as the file has: fseek + fread of a short file), then those 16 slots greyed in
  Cloudy. So index 230..245 is act[i - 38], anything else the level's.
*/
export function engineSkyPalette(level: Uint8Array, act: Uint8Array | null, greyscale: boolean): Uint8Array {
  const out = new Uint8Array(768);
  out.set(level.subarray(0, 768));
  const first = ENGINESKY_ACTFIRST * 3;
  if (act !== null && act.length > first) {
    const have = Math.min(act.length - first, ENGINESKY_LENGTH * 3);
    out.set(act.subarray(first, first + have), ENGINESKY_BASE * 3);
  }
  if (greyscale) for (let i = ENGINESKY_BASE; i < ENGINESKY_BASE + ENGINESKY_LENGTH; i++) engineSkyGrey(out, i * 3);
  return out;
}

// ---- geometry and mapping (sphereMe, main pass) ----

function skyRingPitch(j: number): number {
  return j === 0 ? ENGINESKY_DIP : (j / ENGINESKY_HEIGHT) * SKY_PI / 2.0;
}

/**
  EngineSkyVertex: ring vertex (i = 0..16 around, j = 0..3 up) on the R = 1024 sphere and its
  texture coordinate, u in IMAGE WIDTHS (0..4 around 360 degrees; the texture wraps) and v in
  image heights, rows 254, 170.67, 85.33, 2 over 256 (assigned by ring index, not the dipped
  pitch). v = 0 is the image's first (top) row.
*/
export function engineSkyVertex(i: number, j: number): { pos: [number, number, number]; uv: [number, number] } {
  const h = (i / ENGINESKY_RING) * SKY_PI * 2.0;
  const p = skyRingPitch(j);
  const pos: [number, number, number] = [Math.sin(h) * Math.cos(p) * ENGINESKY_RADIUS, Math.sin(p) * ENGINESKY_RADIUS, Math.cos(h) * Math.cos(p) * ENGINESKY_RADIUS];
  let v = (1.0 - ((j / (ENGINESKY_HEIGHT - 1)) * SKY_PI / 2.0) / SKY_PI * 2.0) * 256.0;
  if (v < 2.0) v = 2.0;
  if (v > 254.0) v = 254.0;
  return { pos, uv: [(h / SKY_PI / 2.0) * 4.0, v / 256.0] };
}

/**
  EngineSkyCapCorners: the cap, the flat square (y = R, half size R sin(3 pi / 16)) drawn first in
  one colour (the sky page's top-left texel). Corners in order (+,+) (-,+) (-,-) (+,-) in x, z.
*/
export function engineSkyCapCorners(): [number, number, number][] {
  const s = Math.sin(((ENGINESKY_HEIGHT - 1) * SKY_PI) / ENGINESKY_HEIGHT / 4.0) * ENGINESKY_RADIUS;
  const R = ENGINESKY_RADIUS;
  return [[s, R, s], [-s, R, s], [-s, R, -s], [s, R, -s]];
}

/** Moller-Trumbore from the eye (origin), as sky_port.py ray_tri. */
function skyRayTri(d: readonly number[], A: readonly number[], B: readonly number[], C: readonly number[], ua: readonly number[], ub: readonly number[], uc: readonly number[]): [number, number] | null {
  const eps = 1e-9;
  const e1 = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!];
  const e2 = [C[0]! - A[0]!, C[1]! - A[1]!, C[2]! - A[2]!];
  const t0 = [-A[0]!, -A[1]!, -A[2]!];
  const pv = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!, d[0]! * e2[1]! - d[1]! * e2[0]!];
  const det = e1[0]! * pv[0]! + e1[1]! * pv[1]! + e1[2]! * pv[2]!;
  if (Math.abs(det) < 1e-12) return null;
  const b1 = (t0[0]! * pv[0]! + t0[1]! * pv[1]! + t0[2]! * pv[2]!) / det;
  const q = [t0[1]! * e1[2]! - t0[2]! * e1[1]!, t0[2]! * e1[0]! - t0[0]! * e1[2]!, t0[0]! * e1[1]! - t0[1]! * e1[0]!];
  const b2 = (d[0]! * q[0]! + d[1]! * q[1]! + d[2]! * q[2]!) / det;
  const t = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) / det;
  if (t <= 0 || b1 < -eps || b2 < -eps || b1 + b2 > 1 + eps) return null;
  const b0 = 1 - b1 - b2;
  return [b0 * ua[0]! + b1 * ub[0]! + b2 * uc[0]!, b0 * ua[1]! + b1 * ub[1]! + b2 * uc[1]!];
}

/**
  EngineSkyLookup: exact mapping of a view direction (a ray from the eye). kind 1 = the dome, uv
  filled (two triangles a quad, (v1,v2,v3) + (v1,v3,v4) as the APImode split draws them); 2 =
  above the dome, the cap colour; 0 = no sky (below the bottom ring).
*/
export function engineSkyLookup(dir: readonly number[]): { kind: 0 | 1 | 2; uv: [number, number] | null } {
  let hd = Math.atan2(dir[0]!, dir[2]!);
  if (hd < 0) hd += 2 * SKY_PI;
  let i = Math.trunc(hd / ((2 * SKY_PI) / ENGINESKY_RING));
  if (i > ENGINESKY_RING - 1) i = ENGINESKY_RING - 1;
  for (let tries = 0; tries < 3; tries++) {
    const ii = tries === 0 ? i : tries === 1 ? (i + 1) % ENGINESKY_RING : (i + ENGINESKY_RING - 1) % ENGINESKY_RING;
    for (let j = 0; j < ENGINESKY_HEIGHT - 1; j++) {
      const v1 = engineSkyVertex(ii, j), v2 = engineSkyVertex(ii, j + 1), v3 = engineSkyVertex(ii + 1, j + 1), v4 = engineSkyVertex(ii + 1, j);
      const uv = skyRayTri(dir, v1.pos, v2.pos, v3.pos, v1.uv, v2.uv, v3.uv) ?? skyRayTri(dir, v1.pos, v3.pos, v4.pos, v1.uv, v3.uv, v4.uv);
      if (uv) return { kind: 1, uv };
    }
  }
  return { kind: Math.atan2(dir[1]!, Math.sqrt(dir[0]! * dir[0]! + dir[2]! * dir[2]!)) > 0 ? 2 : 0, uv: null };
}

/** EngineSkyApprox: the closed form (piecewise linear in elevation, ignores the triangle kink); null below the dome or above its top ring. */
export function engineSkyApprox(dir: readonly number[]): [number, number] | null {
  const V = [254.0, 170.6667, 85.3333, 2.0];
  let hd = Math.atan2(dir[0]!, dir[2]!);
  const el = Math.atan2(dir[1]!, Math.sqrt(dir[0]! * dir[0]! + dir[2]! * dir[2]!));
  if (hd < 0) hd += 2 * SKY_PI;
  for (let j = 0; j < ENGINESKY_HEIGHT - 1; j++) {
    const p0 = skyRingPitch(j), p1 = skyRingPitch(j + 1);
    if (el >= p0 && el <= p1) return [(hd / (2 * SKY_PI)) * 4.0, (V[j]! + (V[j + 1]! - V[j]!) * (el - p0) / (p1 - p0)) / 256.0];
  }
  return null;
}

/**
  The dome as OpenGLSky.cpp draws it, ready for a buffer: 16 x 3 quads as 96 triangles, (v1, v2,
  v3) + (v1, v3, v4) a quad with v1 = (i, j), v2 = (i, j + 1), v3 = (i + 1, j + 1), v4 = (i + 1, j);
  288 vertices, not indexed (u runs 0..4 and the seam vertex i = 16 has u = 4, so nothing is
  shared across it). Positions in the engine's axes on the R = 1024 sphere; uv as engineSkyVertex.
*/
export function engineSkyDomeTriangles(): { positions: Float64Array; uvs: Float64Array; count: number } {
  const ci = [0, 1, 2, 0, 2, 3];
  const count = ENGINESKY_RING * (ENGINESKY_HEIGHT - 1) * 6;
  const positions = new Float64Array(count * 3), uvs = new Float64Array(count * 2);
  let n = 0;
  for (let i = 0; i < ENGINESKY_RING; i++) {
    for (let j = 0; j < ENGINESKY_HEIGHT - 1; j++) {
      const v = [engineSkyVertex(i, j), engineSkyVertex(i, j + 1), engineSkyVertex(i + 1, j + 1), engineSkyVertex(i + 1, j)];
      for (const k of ci) {
        positions.set(v[k]!.pos, n * 3);
        uvs.set(v[k]!.uv, n * 2);
        n++;
      }
    }
  }
  return { positions, uvs, count };
}

/**
  The dome, cap and a ball direction in Traxx's (and JSTraxx's scene's) world axes: each engine
  point through engineDirToTraxxWorld, times `scale` (choose it so the dome sits between the near
  and far planes: Traxx puts the R = 1024 dome about 4096 world units from the eye, i.e. scale =
  4096 / (1024 * 128)). Float32, for a THREE.BufferGeometry: `positions` (288 x 3) and `uvs`
  (288 x 2) for the dome's triangles, `cap` (4 x 3, a quad: triangles 0 1 2 and 0 2 3).
*/
export function engineSkyDomeWorld(scale: number): { positions: Float32Array; uvs: Float32Array; cap: Float32Array } {
  const dome = engineSkyDomeTriangles();
  const positions = new Float32Array(dome.count * 3);
  for (let k = 0; k < dome.count; k++) {
    const w = engineDirToTraxxWorld([dome.positions[k * 3]!, dome.positions[k * 3 + 1]!, dome.positions[k * 3 + 2]!]);
    positions[k * 3] = w[0] * scale; positions[k * 3 + 1] = w[1] * scale; positions[k * 3 + 2] = w[2] * scale;
  }
  const cap = new Float32Array(12);
  engineSkyCapCorners().forEach((c, k) => {
    const w = engineDirToTraxxWorld(c);
    cap[k * 3] = w[0] * scale; cap[k * 3 + 1] = w[1] * scale; cap[k * 3 + 2] = w[2] * scale;
  });
  return { positions, uvs: Float32Array.from(dome.uvs), cap };
}

/**
  Where the ball is drawn on screen (OpenGLSky.cpp DrawSky's ball block). `cam` is the ball's
  direction in CAMERA space with the camera looking down -z (three.js view space: the world
  direction engineDirToTraxxWorld(engineSunBallDirection(sun)) times the view matrix's rotation);
  `focal` the focal length in pixels ((height / 2) / tan(vertical fov / 2)); w x h the view.
  null when the ball is behind the eye (only vPos.z > 0 is tested: below the horizon is drawn).
  Returns the square's centre (pixels, y DOWN from the top-left), its half size r in pixels, and
  the texture rectangle in 0..1 of the uploaded texture: corners (sx - r, sy + r) (u1, v1),
  (sx + r, sy + r) (u2, v1), (sx + r, sy - r) (u2, v2), (sx - r, sy - r) (u1, v2) - the texture's
  first rows land at the BOTTOM of the square, as the game draws it.
*/
export function engineSkyBallScreen(ball: EngineSkyBall, texSide: number, cam: readonly number[], focal: number, w: number, h: number): { sx: number; sy: number; r: number; u1: number; v1: number; u2: number; v2: number } | null {
  if (!(cam[2]! < 0)) return null;
  const d = -cam[2]!;
  const sx = w / 2 + (cam[0]! * focal) / d;
  const sy = h / 2 - (cam[1]! * focal) / d;
  const r = engineSkyBallHalfTangent(ball.radius, h > 0 ? w / h : 1.0) * focal;
  return { sx, sy, r, u1: ball.tex[0] / texSide, v1: ball.tex[1] / texSide, u2: ball.tex[2] / texSide, v2: ball.tex[3] / texSide };
}

// ---- an HD (true-colour) sky ----

/**
  EngineSkyHDSide: the square power of two an HD sky is uploaded at: the image's own size when it
  already is one (<= 2048), otherwise the largest power of two not above its longer side, capped
  at 2048.
*/
export function engineSkyHDSide(w: number, h: number): number {
  let longer = w > h ? w : h;
  if (w === h && w > 0 && w <= 2048 && (w & (w - 1)) === 0) return w;
  if (longer > 2048) longer = 2048;
  let s = 1;
  while (s * 2 <= longer) s *= 2;
  return s;
}

/**
  EngineSkyResample: RGBA w x h into side x side, each output texel the average of a 4 x 4 grid of
  samples over its footprint (an area average reducing, a nearest-ish stretch enlarging).
*/
export function engineSkyResample(rgba: ArrayLike<number>, w: number, h: number, side: number): Uint8Array {
  const out = new Uint8Array(side * side * 4);
  for (let oy = 0; oy < side; oy++) {
    for (let ox = 0; ox < side; ox++) {
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
      for (let sy = 0; sy < 4; sy++) {
        let y = Math.trunc(((oy + (sy + 0.5) / 4.0) * h) / side);
        if (y >= h) y = h - 1;
        for (let sx = 0; sx < 4; sx++) {
          let x = Math.trunc(((ox + (sx + 0.5) / 4.0) * w) / side);
          if (x >= w) x = w - 1;
          const p = (y * w + x) * 4;
          a0 += rgba[p]!; a1 += rgba[p + 1]!; a2 += rgba[p + 2]!; a3 += rgba[p + 3]!;
        }
      }
      const o = (oy * side + ox) * 4;
      out[o] = (a0 + 8) >>> 4; out[o + 1] = (a1 + 8) >>> 4; out[o + 2] = (a2 + 8) >>> 4; out[o + 3] = (a3 + 8) >>> 4;
    }
  }
  return out;
}

// ---- the art, read-only through the game library (OpenGLSky.cpp) ----

/** Decodes a PNG or TGA to RGBA, null on failure (shared/image-decode.ts tryDecodeImage on the page). */
export type HdDecode = (bytes: Uint8Array, ext: "PNG" | "TGA", name: string) => Promise<RgbaImage | null>;

/** A sky image as a texture wants it: RGBA, rows top-down, side x side, opaque. */
export interface EngineSkyImage {
  rgba: Uint8Array;
  side: number;
  /** The dome's cap colour (the 8-bit page's top-left texel). */
  cap: [number, number, number];
  /** True when it came from an HD sibling (PNG / TGA). */
  hd: boolean;
}

/** SkyHash: FNV-1a over the bytes (the dome's cache key hashes the level palette with it). */
export function engineSkyHash(p: ArrayLike<number>): number {
  let h = 2166136261;
  for (let i = 0; i < p.length; i++) h = Math.imul(h ^ p[i]!, 16777619) >>> 0;
  return h >>> 0;
}

/** The dome's cache key (DrawSky): rebuild the dome texture only when this changes. */
export function engineSkyDomeKey(generation: number, choice: EngineSkyChoice, levelPal: Uint8Array): string {
  return `${generation >>> 0}|${choice.raw}|${choice.act}|${choice.greyscale ? 1 : 0}|${engineSkyHash(levelPal.subarray(0, 768)).toString(16).padStart(8, "0")}`;
}

/** The ball's cache key (DrawSky). */
export function engineSkyBallKey(generation: number, ball: EngineSkyBall): string {
  return `${generation >>> 0}|${ball.raw}`;
}

/** SkyLoadAct: ART\<name>, exactly 768 bytes, a short file padded with 0; null when it is nowhere. `length` is the file's own. */
export async function engineSkyLoadAct(pods: GamePods, name: string): Promise<{ act: Uint8Array; length: number } | null> {
  const b = await pods.read("art", name);
  if (b === null) return null;
  const act = new Uint8Array(768);
  act.set(b.subarray(0, 768));
  return { act, length: b.length };
}

/** engineSkyResolve with the lengths asked of the game library (the two picked names in art). */
export async function engineSkyChoose(pods: GamePods, weather: number, levelType4: boolean, lvlRaw: string | null, lvlAct: string | null): Promise<EngineSkyChoice> {
  const { raw, act } = engineSkyPickNames(weather, levelType4, lvlRaw, lvlAct);
  const known = new Map<string, number>();
  for (const name of [raw, act]) if (name) known.set(name, await pods.length("art", name));
  return engineSkyResolve(weather, levelType4, lvlRaw, lvlAct, (dir, name) => (dir === "art" ? known.get(name) ?? -1 : -1));
}

/** engineSkyHDProbes with the WeatherArt lengths asked of the game library. */
export async function engineSkyHDProbesFrom(pods: GamePods, rawName: string): Promise<EngineSkyProbe[]> {
  const known = new Map<string, number>();
  for (const ext of ENGINESKY_HD_EXTS) {
    const name = skySwapExt(rawName, ext);
    if (name !== null) known.set(name, await pods.length("WeatherArt", name));
  }
  return engineSkyHDProbes(rawName, (dir, name) => (dir === "WeatherArt" ? known.get(name) ?? -1 : -1));
}

/**
  SkyLoadHD (texload.cpp artProbeImageOnly / artOpenImageEx): the two probes in order; the first
  whose signature is PNG / TGA and whose header reads is THE image. If that one then fails to
  decode, the legacy .RAW stands: no further probe. null = no HD sibling (or it failed).
*/
export async function engineSkyLoadHD(pods: GamePods, rawName: string, decode: HdDecode): Promise<RgbaImage | null> {
  for (const probe of await engineSkyHDProbesFrom(pods, rawName)) {
    const file = await pods.read(probe.dir, probe.name);
    if (file === null) continue;
    const info = hdGetInfoMem(file, probe.name);
    if (file.length <= 0 || "err" in info || info.width <= 0 || info.height <= 0) continue; // a renamed JPEG, a damaged header: the next probe
    const img = await decode(file, probe.ext, probe.name);
    return img && img.width > 0 && img.height > 0 ? img : null; // null here = decode failed = the legacy art
  }
  return null;
}

/**
  SkyBuildDome: the dome image for `choice`: an HD sibling (true colour, greyed in Cloudy, at
  engineSkyHDSide) when there is one, else the .RAW through engineSkyPalette (a 4096-byte file is
  a 64 page, anything else a 256 page read as far as it goes, missing texels index 0). levelPal is
  the track's palette, or ART\oldmtm.act for levelType 4 (engineSkyLevelPalette). Opaque. A
  string is the note to show when ART\<raw> could not be read.
*/
export async function engineSkyBuildDome(pods: GamePods, choice: EngineSkyChoice, levelPal: Uint8Array, decode: HdDecode | null): Promise<EngineSkyImage | string> {
  const act = await engineSkyLoadAct(pods, choice.act);
  const pal = engineSkyPalette(levelPal, act ? act.act.subarray(0, Math.min(act.length, 768)) : null, choice.greyscale);
  const raw = await pods.read("art", choice.raw);
  if (raw === null) return `Sky: ART\\${choice.raw} could not be read from the game library.`;

  let rgba: Uint8Array | null = null, side = 0, hd = false;
  let cap: [number, number, number] = [0, 0, 0];
  const img = decode ? await engineSkyLoadHD(pods, choice.raw, decode) : null;
  if (img) {
    side = engineSkyHDSide(img.width, img.height);
    rgba = img.width === side && img.height === side ? Uint8Array.from(img.rgba) : engineSkyResample(img.rgba, img.width, img.height, side);
    if (choice.greyscale) for (let i = 0; i < side * side; i++) engineSkyGrey(rgba, i * 4); // gSkyGreyscale: the decoded PIXELS greyed
    // The cap is the 8-bit page's top-left texel; for an HD sky that page is the image reduced to
    // 256, so the average of the image's top-left 1/256 square (inferred, as Traxx).
    const block = side >= 256 ? side / 256 : 1;
    const acc = [0, 0, 0];
    for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) for (let c = 0; c < 3; c++) acc[c]! += rgba[(y * side + x) * 4 + c]!;
    cap = [Math.trunc(acc[0]! / (block * block)), Math.trunc(acc[1]! / (block * block)), Math.trunc(acc[2]! / (block * block))];
    hd = true;
  }
  if (rgba === null) {
    side = raw.length === 4096 ? 64 : 256;
    const indices = new Uint8Array(side * side);
    indices.set(raw.subarray(0, side * side));
    rgba = new Uint8Array(decodeIndexedImage(indices, pal, side, side).rgba.buffer);
    const c0 = (raw.length > 0 ? raw[0]! : 0) * 3;
    cap = [pal[c0]!, pal[c0 + 1]!, pal[c0 + 2]!];
  }
  for (let i = 0; i < side * side; i++) rgba[i * 4 + 3] = 255; // the dome is opaque
  return { rgba, side, cap, hd };
}

/**
  SkyBuildBall: the sun or moon texture. An HD sibling resampled to engineSkyHDSide; else the .RAW
  through its own .ACT, else ART\DEFAULT.ACT (the engine's defaultPal), else black; a square
  power-of-two length gives the side, anything else ball.side. `texSide` is the side the ball's
  texel rectangle is measured in: ball.side for an HD ball (the engine's rectangle is in the legacy
  texture's size), the .RAW's own side otherwise. Draw it additive (ONE, ONE). null when nothing
  could be read.
*/
export async function engineSkyBuildBall(pods: GamePods, ball: EngineSkyBall, decode: HdDecode | null): Promise<{ rgba: Uint8Array; side: number; texSide: number; hd: boolean } | null> {
  const img = decode ? await engineSkyLoadHD(pods, ball.raw, decode) : null;
  if (img) {
    const side = engineSkyHDSide(img.width, img.height);
    return { rgba: engineSkyResample(img.rgba, img.width, img.height, side), side, texSide: ball.side, hd: true };
  }
  const raw = await pods.read("art", ball.raw);
  if (raw === null) return null;
  const actName = `${ball.raw.slice(0, ball.raw.lastIndexOf("."))}.act`;
  const act = (await engineSkyLoadAct(pods, actName)) ?? (await engineSkyLoadAct(pods, "default.act"));
  const pal = act ? act.act : new Uint8Array(768);
  let side = 1;
  while (side * side < raw.length) side *= 2;
  if (side * side !== raw.length) side = ball.side;
  const indices = new Uint8Array(side * side);
  indices.set(raw.subarray(0, side * side));
  const rgba = new Uint8Array(decodeIndexedImage(indices, pal, side, side).rgba.buffer);
  for (let i = 0; i < side * side; i++) rgba[i * 4 + 3] = 255;
  // SkyUpload(rgba, EngineSkyHDSide(side, side)): side is already a power of two here.
  return { rgba, side: engineSkyHDSide(side, side), texSide: side, hd: false };
}

/**
  The level palette the .RAW's other indices resolve through (DrawSky): ART\oldmtm.act for an
  original MTM level (levelType 4, when the library has it; read once per generation by the
  caller), else the track's own 768-byte palette.
*/
export async function engineSkyLevelPalette(pods: GamePods, levelType4: boolean, trackPalette: Uint8Array): Promise<Uint8Array> {
  const level = new Uint8Array(768);
  level.set(trackPalette.subarray(0, 768));
  if (levelType4 && pods.mounted) {
    const old = await engineSkyLoadAct(pods, "oldmtm.act");
    if (old) return old.act;
  }
  return level;
}

/**
  DrawSky's status-bar note for a dome weather, "" when the sky shows as the game shows it. The
  wording follows Traxx's, with the game folder replaced by the game library. `rawLength` is
  pods.length("art", choice.raw).
*/
export function engineSkyNote(mounted: boolean, choice: EngineSkyChoice, rawLength: number, weather: number, levelType4: boolean, lvlRaw: string | null, lvlAct: string | null): string {
  if (!mounted) return "Sky: no game PODs are in the library (Options > Folders), so a plain colour is shown.";
  if (rawLength <= 0) return `Sky: ART\\${choice.raw} is not in the game library's PODs, so a plain colour is shown.`;
  if (choice.fellback) {
    const picked = engineSkyPickNames(weather, levelType4, lvlRaw, lvlAct);
    return `Sky: ART\\${picked.raw} or ART\\${picked.act} is missing, so the game shows cloudy2 - as here.`;
  }
  return "";
}
