/*
  The game engine's fog-volume (BOX_FOG) density, Traxx 1.8.0 (Traxx/EngineFog.h and
  Traxx/EngineFog.cpp at 34aaa67, a statement-for-statement port of cursh2
  tools\traxx_rules\fog\fogport.py, itself the engine's rd3d11_fogvol_shaders.h density loop;
  engine handover TRAXX_HANDOVER_ENGINE_RULES.md section 1, commit ba2eb79), plus the pure parts of
  the renderer that draws it (Traxx/OpenGLTerrainRenderer.cpp DrawFogVolumes, FogMeshCompile,
  FogCameraLocal, FogHash and the band helpers; Traxx/TraxxViewDisplay.cpp DrawFogVolumesOpenGL's
  skips and colour). Pinned by tests/engine-fog.test.ts, the port of Traxx's tools/fogtest.cpp.

  Units: feet. The box-local frame is the handover's: x across (the box's own X), z along (its
  heading, the wisps' drift axis), both from the footprint CENTRE; y is the height above the
  volume's floor.

  The rules: density f = 2^(-y/half) * S(side) * S(top) * S(bot) (S the smootherstep), extinction
  3 f / vis per foot, the footprint a rectangle or a superellipse of exponent 16 - 14 round, alpha
  min(1 - exp(-od), maxOp), the wisps the engine's own 64^3 noise (engine-fog-noise.ts). The
  parameters are C floats (EngineFogParams): engineFogResolve reads each through Math.fround, the
  rest is double arithmetic as in the C++. The grid's extinctions are floats (Float32Array).

  HOW A RENDERER USES THIS (DrawFogVolumes, a slice renderer):
    1. Collect the volumes: every fog box whose wmask has the previewed weather's bit and whose W,
       L and H are all over 0.5 ft (engineFogDrawn), then the waterfall mist the slot plan lets
       through (fall-mist.ts). Every fog box takes an engine slot, drawn or not.
    2. Per volume, once per change of its fields (cache on an id plus engineFogParamsHash):
       vol = engineFogResolve(params, 0) (t = 0: the still preview), grid = engineFogGridBuild(vol)
       (null = cache as failed), and the guides engineFogInsetRing(vol, vol.edge) and
       engineFogInsetRing(vol, 0), with engineFogHalfGuide(vol) for the dashed loop.
    3. Per frame: the camera in each volume's frame (engineFogCameraLocal), the horizontal distance
       sqrt(x^2 + z^2) of the local eye, and engineFogDrawOrder(distances, drawAll): far to near,
       cut to the nearest ENGINEFOG_MAX_DRAW (16) unless drawAll.
    4. Per drawn volume: engineFogSliceAxis(local look) gives the axis, |cos| and the far-to-near
       direction; engineFogBand(cos, previous) the baked |cos| band; engineFogSliceAlphas(grid,
       vol.maxop, axis, engineFogBandCos(band)) the per-node alphas (maxOp stops each column);
       engineFogSliceMesh(grid, alphas, axis, descending, vol) the quads, already far to near.
       Draw them depth tested, depth write off, culling off, alpha blended (SRC_ALPHA,
       ONE_MINUS_SRC_ALPHA) in engineFogColour(r, g, b, engineFogAmbient(weather)).
*/
import { engineFogSlotOverflow as preflightFogSlotOverflow } from "../traxx/preflight.ts";
import { engineFogNoiseBytes } from "./engine-fog-noise.ts";

export { engineFogNoiseBytes, engineFogNoiseHash } from "./engine-fog-noise.ts";

const f32 = Math.fround;

/** FOG_MINFEET: the shader floors edge and top at 1 engine unit. */
const FOG_MINFEET = 1.0 / 256.0;

/** ENGINEFOG_RING_MAX: the points of a rounded volume's guide loop. */
export const ENGINEFOG_RING_MAX = 48;
/** ENGINEFOG_GRID_NODES: the preview grid's node budget. */
export const ENGINEFOG_GRID_NODES = 24000;
/** ENGINEFOG_SLOTS: the engine's fog volumes per track, fog boxes and waterfall mist together. */
export const ENGINEFOG_SLOTS = 64;
/** The game draws only the nearest fogVolumeMaxDraw() volumes (INI fogVolumeMax, default and ceiling 16). */
export const ENGINEFOG_MAX_DRAW = 16;
/** FogMeshCompile: a quad whose four alphas are all under this is not emitted. */
export const ENGINEFOG_QUAD_MIN_ALPHA = 0.0005;

/**
  EngineFogParams: the .SIT 'F' block's fields that shape the volume, plus the box's own size (the
  handover's W, L, H). Raw as authored (C floats): engineFogResolve applies the engine's clamps.
*/
export interface EngineFogParams {
  /** Footprint across, along, and the height, feet (the box's own size). */
  w: number;
  l: number;
  h: number;
  vis: number;
  half: number;
  edge: number;
  top: number;
  maxop: number;
  round: number;
  wisp: number;
  wsize: number;
  wspeed: number;
  bot: number;
}

/** EngineFogParams' fields in the struct's order (FogHash reads them as 13 consecutive floats). */
export const ENGINEFOG_PARAM_KEYS = ["w", "l", "h", "vis", "half", "edge", "top", "maxop", "round", "wisp", "wsize", "wspeed", "bot"] as const;

/** EngineFogVol: the numbers the density loop uses, after the engine's clamps (handover 1.1 / 1.2). */
export interface EngineFogVol {
  W: number;
  L: number;
  H: number;
  /** Half extents, feet. */
  hx: number;
  hz: number;
  /** 3 / vis, per foot. */
  sigma: number;
  /** 1 / half (0 = uniform in height). */
  rate: number;
  /** edge' and top' (floored at 1/256 ft), bot' (0 = no soft bottom). */
  edge: number;
  top: number;
  bot: number;
  maxop: number;
  round: number;
  wisp: number;
  /** Noise coordinate per foot = 1 / (wsize * 8). */
  nscale: number;
  /** frac(t * wspeed / (wsize * 8)). */
  phase: number;
}

const sat = (x: number) => (x < 0.0 ? 0.0 : x > 1.0 ? 1.0 : x);

function smoothStep(a: number, b: number, x: number): number {
  const t = sat((x - a) / (b - a));
  return t * t * (3.0 - 2.0 * t);
}

/** EngineFogSmoother: S(t) = t^3 (t (6 t - 15) + 10), t already saturated. */
export function engineFogSmoother(t: number): number {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

/**
  EngineFogResolve: fogClampLook (core\FogVolume.cpp) and drawFogVolumes' per-volume constants
  (core\Ground.cpp). t = game seconds (0 = a still preview). A NaN fails every comparison, so the
  "!(x >= 0)" forms send it to the safe value exactly as the C++ does.
*/
export function engineFogResolve(p: EngineFogParams, t: number): EngineFogVol {
  let round = f32(p.round), wisp = f32(p.wisp), wsize = f32(p.wsize), wspeed = f32(p.wspeed), bot = f32(p.bot);
  let vis = f32(p.vis);
  const half = f32(p.half), edge = f32(p.edge), top = f32(p.top);

  if (!(round >= 0.0)) round = 0.0;
  if (round > 1.0) round = 1.0;
  if (!(wisp >= 0.0)) wisp = 0.0;
  if (wisp > 1.0) wisp = 1.0;
  if (!(wsize >= 1.0)) wsize = 1.0;
  if (!(wspeed >= 0.0)) wspeed = 0.0;
  if (!(bot >= 0.0)) bot = 0.0;

  const W = f32(p.w), L = f32(p.l), H = f32(p.h);
  if (!(vis > 1.0)) vis = 1.0;
  const hw = (W < L ? W : L) * 0.5;
  const e = edge < hw ? edge : hw;
  const tp = top < H ? top : H;

  let maxop = f32(p.maxop);
  if (maxop !== maxop) maxop = 1.0;
  if (maxop < 0.0) maxop = 0.0;
  if (maxop > 1.0) maxop = 1.0;

  const ph = (t * wspeed) / (wsize * 8.0);
  const b = bot < H ? bot : H;

  return {
    W, L, H,
    hx: W * 0.5,
    hz: L * 0.5,
    sigma: 3.0 / vis,
    rate: half > 0.0 ? 1.0 / half : 0.0,
    edge: e > FOG_MINFEET ? e : FOG_MINFEET,
    top: tp > FOG_MINFEET ? tp : FOG_MINFEET,
    bot: b > 0.0 ? b : 0.0,
    maxop,
    round,
    wisp,
    nscale: 1.0 / (wsize * 8.0),
    phase: ph - Math.floor(ph),
  };
}

// ---- the noise ----

/**
  EngineFogNoise: the 64^3 wisp noise, Texture3D.SampleLevel(LINEAR, WRAP): trilinear, wrapped,
  texel centres at (i + 0.5) / 64; u v w in tiles (1 = the whole volume). 0..1. The GPU's 8-bit
  fixed-point weights are not modelled (the handover says the same of its port).
*/
export function engineFogNoise(u: number, v: number, w: number): number {
  const tex = engineFogNoiseBytes();
  const cx = u * 64.0 - 0.5, cy = v * 64.0 - 0.5, cz = w * 64.0 - 0.5;
  const x0 = Math.floor(cx), y0 = Math.floor(cy), z0 = Math.floor(cz);
  const fx = cx - x0, fy = cy - y0, fz = cz - z0;
  const ix = x0 | 0, iy = y0 | 0, iz = z0 | 0;
  let out = 0.0;
  for (let dz = 0; dz < 2; dz++) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const wgt = (dx ? fx : 1.0 - fx) * (dy ? fy : 1.0 - fy) * (dz ? fz : 1.0 - fz);
        if (wgt === 0.0) continue;
        const X = (ix + dx) & 63, Y = (iy + dy) & 63, Z = (iz + dz) & 63;
        out += (wgt * tex[(Z * 64 + Y) * 64 + X]!) / 255.0;
      }
    }
  }
  return out;
}

// ---- the density ----

/**
  EngineFogSideDistance: the inward distance to the footprint edge, feet (handover 1.2: the
  rectangle, or the superellipse's first-order estimate). Negative outside. x, z from the centre.
*/
export function engineFogSideDistance(v: EngineFogVol, x: number, z: number): number {
  if (v.round < 0.001) {
    const a = v.hx - Math.abs(x), b = v.hz - Math.abs(z);
    return a < b ? a : b;
  }
  const ne = 16.0 + (2.0 - 16.0) * v.round;
  const qx = Math.abs(x) / v.hx, qz = Math.abs(z) / v.hz;
  let m = qx > qz ? qx : qz;
  if (m < 1e-6) m = 1e-6;
  const rx = qx / m, rz = qz / m;
  let sr = Math.pow(Math.pow(rx, ne) + Math.pow(rz, ne), 1.0 / ne);
  if (sr < 1e-6) sr = 1e-6;
  const F = m * sr;
  const gx = Math.pow(rx / sr, ne - 1.0) / v.hx;
  const gz = Math.pow(rz / sr, ne - 1.0) / v.hz;
  let g = Math.sqrt(gx * gx + gz * gz);
  if (g < 1e-9) g = 1e-9;
  return (1.0 - F) / g;
}

/** EngineFogWispNoise: the wisp noise value nz (0.5 when wisp is off) at a box-local point. */
export function engineFogWispNoise(v: EngineFogVol, x: number, y: number, z: number): number {
  const s = v.nscale, ph = v.phase;
  const py = y - v.H * 0.5;
  const qx = x * s, qy = py * s, qz = z * s;
  if (!(v.wisp > 0.001)) return 0.5;
  const n1 = engineFogNoise(qx, qy, qz - ph);
  const n2 = engineFogNoise(qx * 2.7 - ph, qy * 2.7, qz * 2.7 - 2.0 * ph);
  return 0.65 * n1 + 0.35 * n2;
}

/** EngineFogDensity: the normalised density f (the floor of a smooth volume = 1) at a box-local point, feet; 0 outside the box. */
export function engineFogDensity(v: EngineFogVol, x: number, y: number, z: number): number {
  let nz = 0.5, bf = 1.0;
  if (y < 0.0 || y > v.H) return 0.0;
  let dens = Math.pow(2.0, -v.rate * y);
  if (v.wisp > 0.001) {
    nz = engineFogWispNoise(v, x, y, z);
    dens *= 1.0 + (smoothStep(0.25, 0.75, nz) * 1.6 - 1.0) * v.wisp;
  }
  let sd = engineFogSideDistance(v, x, z);
  const pulled = sd + (nz - 0.5) * v.edge * v.wisp * 1.5;
  if (pulled < sd) sd = pulled;
  const side = sat(sd / v.edge);
  const tf = sat((v.H - y) / v.top);
  if (v.bot > 0.5 / 256.0) bf = engineFogSmoother(sat(y / v.bot));
  return dens * engineFogSmoother(side) * engineFogSmoother(tf) * bf;
}

/** EngineFogExtinction: per foot, f * 3 / vis. */
export function engineFogExtinction(v: EngineFogVol, x: number, y: number, z: number): number {
  return engineFogDensity(v, x, y, z) * v.sigma;
}

/**
  EngineFogOpticalDepth: along the segment a -> b (box-local feet), `samples` midpoint samples
  offset by jit in [0, 1) as the shader does (12 samples, jittered per pixel). Use >= 400 for the
  converged value.
*/
export function engineFogOpticalDepth(v: EngineFogVol, a: readonly number[], b: readonly number[], samples: number, jit: number): number {
  const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, dz = b[2]! - a[2]!;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  let sum = 0.0;
  if (samples < 1) return 0.0;
  for (let s = 0; s < samples; s++) {
    const t = (s + jit) / samples;
    sum += engineFogDensity(v, a[0]! + dx * t, a[1]! + dy * t, a[2]! + dz * t);
  }
  return sum * v.sigma * (len / samples);
}

/** EngineFogAlpha: alpha = min(1 - exp(-od), maxop). */
export function engineFogAlpha(od: number, maxop: number): number {
  const a = 1.0 - Math.exp(-od);
  return a < maxop ? a : maxop;
}

/** EngineFogOdAtMaxOp: the optical depth at which maxop is reached, -ln(1 - maxop) (1e30 for maxop >= 1). */
export function engineFogOdAtMaxOp(maxop: number): number {
  if (!(maxop < 1.0)) return 1e30;
  if (!(maxop > 0.0)) return 0.0;
  return -Math.log(1.0 - maxop);
}

/** EngineFogHorizontalOd: the closed form for a full line along the box's X through z = 0 at height y, rectangle, wisps off (handover 1.3). */
export function engineFogHorizontalOd(v: EngineFogVol, y: number): number {
  const dens = Math.pow(2.0, -v.rate * y);
  const tf = engineFogSmoother(sat((v.H - y) / v.top));
  let bf = 1.0;
  if (v.bot > 0.5 / 256.0) bf = engineFogSmoother(sat(y / v.bot));
  // the side fade integrates to (W - edge'): the integral of S over [0,1] is 1/2 per wall
  return v.sigma * dens * tf * bf * (v.W - v.edge);
}

/**
  EngineFogAmbient: the weather's ambient light, the fixed table in cursh2 core\weather.cpp
  getAmbientLight (Clear 1, Cloudy 0.7, Foggy 1, Dense fog 1, Rain 0.3, Snow 1, Dusk 0.375, Night
  0.25, Pitch black 0), floored at 0.05 as core\Ground.cpp drawFogVolumes does. weather is the
  engine's number (ENGINEWEATHER_*); anything else is read as clear. The fog's colour is rgb * this.
*/
export function engineFogAmbient(weather: number): number {
  const table = [1.0, 0.7, 1.0, 1.0, 0.3, 1.0, 0.375, 0.25, 0.0];
  const a = Number.isInteger(weather) && weather >= 0 && weather < 9 ? table[weather]! : 1.0;
  return a < 0.05 ? 0.05 : a;
}

// ---- the guide contour ----

/**
  EngineFogInsetRing: the footprint contour where the side fade ends (sd = inset), as a loop of
  [x, z] from the centre. A rectangle returns its 4 corners (FogVolumeCorners' order: --, +-, ++,
  -+ in (across, along)); a rounded volume returns ENGINEFOG_RING_MAX points (a bisection along
  each ray). inset = vol.edge draws "where the edge fade ends", 0 the footprint itself.
*/
export function engineFogInsetRing(v: EngineFogVol, inset: number): [number, number][] {
  if (v.round < 0.001) {
    let a = v.hx - inset, b = v.hz - inset;
    if (a < 0.0) a = 0.0;
    if (b < 0.0) b = 0.0;
    return [[-a, -b], [a, -b], [a, b], [-a, b]];
  }
  const ring: [number, number][] = [];
  for (let i = 0; i < ENGINEFOG_RING_MAX; i++) {
    const t = (6.283185307179586 * i) / ENGINEFOG_RING_MAX;
    const cs = Math.cos(t), sn = Math.sin(t);
    let lo = 1e-3, hi = 2.0 * Math.sqrt(v.hx * v.hx + v.hz * v.hz) + 1.0, r: number;
    // sd falls linearly along a ray from the centre, so this is a plain bisection
    if (engineFogSideDistance(v, cs * lo, sn * lo) < inset) r = 0.0;
    else {
      for (let it = 0; it < 60; it++) {
        const mid = 0.5 * (lo + hi);
        if (engineFogSideDistance(v, cs * mid, sn * mid) >= inset) lo = mid;
        else hi = mid;
      }
      r = 0.5 * (lo + hi);
    }
    ring.push([r * cs, r * sn]);
  }
  return ring;
}

/** DrawFogVolumes' dashed guide: the height where 2^(-y/half) has halved (y = half), or null when the volume is uniform or shorter. */
export function engineFogHalfGuide(v: EngineFogVol): number | null {
  return v.rate > 0.0 && 1.0 / v.rate < v.H ? 1.0 / v.rate : null;
}

// ---- the grid ----

/**
  EngineFogGrid: a tensor-product grid of extinctions over the box, finer inside the fade zones
  (side walls, top, soft bottom) and, when wisps are on, fine enough to carry the noise. pos[a][i]
  is the node coordinate along axis a from the box's LOW corner, feet (0..W across, 0..H up, 0..L
  along); ext[(k * ny + j) * nx + i] is the extinction per foot at (i, j, k), a float.
*/
export interface EngineFogGrid {
  /** Nodes across (x), up (y), along (z). */
  n: [number, number, number];
  pos: [Float64Array, Float64Array, Float64Array];
  ext: Float32Array;
}

/*
  AxisNodes: the node coordinates along one axis of length len: both ends, nuniform equal steps
  over [0, uend], and each fade zone (a z0-long one at the low end, a z1-long one at the high end)
  cut into up to 6 pieces, so the S-curves have nodes to ride on. A hard wall (a 1/256 ft zone)
  gets just its two ends. uend < len is for the height axis when the density has decayed to
  nothing well below the top. Sorted, nodes within 1e-3 ft merged, the far end kept exactly.
*/
function axisNodes(len: number, nuniform: number, uend: number, z0: number, z1: number): Float64Array {
  const a: number[] = [];
  if (uend > len) uend = len;
  for (let i = 0; i <= nuniform; i++) a.push((uend * i) / nuniform);
  a.push(len);
  if (z0 > len) z0 = len;
  if (z1 > len) z1 = len;
  if (z0 > 0.0) {
    let pieces = Math.trunc(z0 / 0.5);
    if (pieces < 1) pieces = 1;
    if (pieces > 6) pieces = 6;
    for (let i = 1; i <= pieces; i++) a.push((z0 * i) / pieces);
  }
  if (z1 > 0.0) {
    let pieces = Math.trunc(z1 / 0.5);
    if (pieces < 1) pieces = 1;
    if (pieces > 6) pieces = 6;
    for (let i = 1; i <= pieces; i++) a.push(len - (z1 * i) / pieces);
  }
  a.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  let w = 1;
  for (let i = 1; i < a.length; i++) if (a[i]! - a[w - 1]! > 1e-3) a[w++] = a[i]!;
  // a node closer than 1e-3 ft to the far end was dropped above: keep the end itself exactly
  a[w - 1] = len;
  return Float64Array.from(a.slice(0, w));
}

/**
  EngineFogGridBuild: the preview grid, at most maxnodes nodes (clamped to 6859..65000). THE
  BUDGET: the wanted counts are capped per axis up front (X, Z 160 steps; Y 64) and the largest
  axis is shrunk by 15 % per pass until the grid fits; at 4 steps per axis plus the fade-zone nodes
  (19 per axis, 6859 nodes) there is always a usable grid, so a huge or tiny-wsize volume gets
  coarser wisps, never a failure. null only for a degenerate box (an axis with under 2 nodes).
*/
export function engineFogGridBuild(v: EngineFogVol, maxnodes = ENGINEFOG_GRID_NODES): EngineFogGrid | null {
  const nu = [0, 0, 0];
  const wsize = 1.0 / v.nscale / 8.0;
  let uend = v.H;
  if (maxnodes > 65000) maxnodes = 65000;
  if (maxnodes < 6859) maxnodes = 6859;

  // The wanted uniform step counts: enough for the noise when wisps are on, otherwise a modest
  // number (the fade zones add their own nodes). Height follows the exponential decay: 2 steps per
  // half-height over the range that holds any fog (12 half-lives).
  nu[0] = v.round >= 0.001 ? 24 : 12;
  nu[2] = nu[0];
  if (v.wisp > 0.001) {
    let nxw = Math.ceil(v.W / (wsize * 0.3)), nzw = Math.ceil(v.L / (wsize * 0.3));
    if (nxw > 160.0) nxw = 160.0;
    if (nzw > 160.0) nzw = 160.0;
    if ((nxw | 0) > nu[0]) nu[0] = nxw | 0;
    if ((nzw | 0) > nu[2]) nu[2] = nzw | 0;
  }
  if (v.rate > 0.0) {
    const reach = 12.0 / v.rate; // 12 half-lives
    if (reach < uend) uend = reach;
    nu[1] = Math.ceil(uend * v.rate * 2.0) | 0;
  } else nu[1] = 8;
  if (nu[1] < 8) nu[1] = 8;
  if (v.wisp > 0.001) {
    let nyw = Math.ceil(uend / (wsize * 0.3));
    if (nyw > 64.0) nyw = 64.0;
    if ((nyw | 0) > nu[1]) nu[1] = nyw | 0;
  }
  if (nu[1] > 64) nu[1] = 64;

  let pos: [Float64Array, Float64Array, Float64Array] = [new Float64Array(0), new Float64Array(0), new Float64Array(0)];
  let total = 0;
  for (let guard = 0; guard < 400; guard++) {
    pos = [
      axisNodes(v.W, nu[0]!, v.W, v.edge, v.edge),
      axisNodes(v.H, nu[1]!, uend, v.bot, v.top),
      axisNodes(v.L, nu[2]!, v.L, v.edge, v.edge),
    ];
    total = pos[0].length * pos[1].length * pos[2].length;
    if (total <= maxnodes) break;
    // shrink the axis with the most uniform steps; at 4 everywhere the grid is within budget anyway
    let big = 0;
    for (let axis = 1; axis < 3; axis++) if (nu[axis]! > nu[big]!) big = axis;
    if (nu[big]! <= 4) break;
    nu[big] = Math.trunc((nu[big]! * 85) / 100);
    if (nu[big]! < 4) nu[big] = 4;
  }
  const cnt: [number, number, number] = [pos[0].length, pos[1].length, pos[2].length];
  total = cnt[0] * cnt[1] * cnt[2];
  if (cnt[0] < 2 || cnt[1] < 2 || cnt[2] < 2 || total > maxnodes) return null;

  const ext = new Float32Array(total);
  let idx = 0;
  for (let k = 0; k < cnt[2]; k++)
    for (let j = 0; j < cnt[1]; j++)
      for (let i = 0; i < cnt[0]; i++) ext[idx++] = engineFogExtinction(v, pos[0][i]! - v.hx, pos[1][j]!, pos[2][k]! - v.hz);
  return { n: cnt, pos, ext };
}

// ---- the engine's fog slots (handover 1.1 and core\FogVolume.cpp) ----

/** One mist volume the engine drops: 0-based fall and stream (landing). */
export interface EngineFogDrop {
  fall: number;
  stream: number;
}

/**
  EngineFogSlotOverflow: ENGINEFOG_SLOTS volumes per track: the .SIT fog boxes first (at box load),
  then one per waterfall landing (mist, registered last; stream 0 of every fall before any fall's
  stream 1). Whatever does not fit is dropped. nfogs = the fog boxes; landings[f] = the mist
  volumes fall f registers (0 for a fall the engine never registers; mistLandings in fall-mist.ts).
  Returns how many mist volumes do not fit, the total mist (each fall capped at 4), and the first
  `maxlist` of the dropped ones in the engine's registration order (its drop order).
*/
export function engineFogSlotOverflow(nfogs: number, landings: readonly number[], nfalls = landings.length,
  maxlist = Infinity): { dropped: number; total: number; drops: EngineFogDrop[] } {
  // One copy of the count: Write POD's (src/core/traxx/preflight.ts), here with the C signature.
  const r = preflightFogSlotOverflow(nfogs, landings.slice(0, nfalls), maxlist);
  return { dropped: r.dropped, total: r.totalMist, drops: r.list };
}

// ---- the renderer's pure parts (OpenGLTerrainRenderer.cpp DrawFogVolumes, TraxxViewDisplay.cpp DrawFogVolumesOpenGL) ----

/**
  EngineFogParams of a fog box (DrawFogVolumesOpenGL): W, L, H are the BOX's width, length and
  height (feet), the rest the fog's fields.
*/
export function engineFogParamsOf(box: { width: number; length: number; height: number },
  fog: Omit<EngineFogParams, "w" | "l" | "h">): EngineFogParams {
  return {
    w: f32(box.width), l: f32(box.length), h: f32(box.height),
    vis: fog.vis, half: fog.half, edge: fog.edge, top: fog.top, maxop: fog.maxop,
    round: fog.round, wisp: fog.wisp, wsize: fog.wsize, wspeed: fog.wspeed, bot: fog.bot,
  };
}

/**
  The engine's draw-time skips, applied before a volume joins the nearest-16 list: the wmask must
  have the weather's bit (handover 1.1), and W, L and H must all be over 0.5 ft (core\Ground.cpp
  drawFogVolumes; float compares). A skipped volume still holds its slot.
*/
export function engineFogDrawn(wmask: number, weather: number, w: number, l: number, h: number): boolean {
  if (!(wmask & (1 << weather))) return false;
  return f32(w) > 0.5 && f32(l) > 0.5 && f32(h) > 0.5;
}

/** FogHash: FNV-1a32 over the params' 13 floats, little-endian, the struct's order; the grid cache's key (with the volume's id). */
export function engineFogParamsHash(p: EngineFogParams): number {
  const buf = new DataView(new ArrayBuffer(4 * ENGINEFOG_PARAM_KEYS.length));
  ENGINEFOG_PARAM_KEYS.forEach((k, i) => buf.setFloat32(4 * i, p[k], true));
  let h = 2166136261;
  for (let i = 0; i < buf.byteLength; i++) {
    h ^= buf.getUint8(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** The fog's colour (DrawFogVolumes): rgb * ambient as floats, the ambient floored at 0.05 (NaN too). */
export function engineFogColour(r: number, g: number, b: number, ambient: number): [number, number, number] {
  let amb = f32(ambient);
  if (!(amb >= f32(0.05))) amb = f32(0.05);
  return [f32(f32(r) * amb), f32(f32(g) * amb), f32(f32(b) * amb)];
}

/** The guides' pale colour (DrawFogVolumes): rgb * 0.4 + 0.6, at alpha 0.85. */
export function engineFogGuideColour(r: number, g: number, b: number): [number, number, number, number] {
  const p = (c: number) => f32(f32(f32(c) * f32(0.4)) + f32(0.6));
  return [p(r), p(g), p(b), f32(0.85)];
}

/**
  A volume's frame in the renderer's world (TraxxGLFogVolume cx, cy, ex, ez, zpf, floorz): local
  (x across, y up from the floor, z along), in feet, is world (cx + x ex[0] + z ez[0],
  cy + x ex[1] + z ez[1], floorz + y zpf), world z up.
*/
export interface EngineFogFrame {
  cx: number;
  cy: number;
  ex: readonly [number, number];
  ez: readonly [number, number];
  zpf: number;
  floorz: number;
}

/**
  FogCameraLocal: the camera's eye and look direction in a volume's own frame (feet from the
  footprint centre / floor), local = A^-1 (world - t); null when the frame is singular.
*/
export function engineFogCameraLocal(f: EngineFogFrame, eye: readonly number[], look: readonly number[]): { cam: [number, number, number]; dir: [number, number, number] } | null {
  // A's columns: local x -> (ex0, ex1, 0), local y -> (0, 0, zpf), local z -> (ez0, ez1, 0)
  const A = [[f.ex[0], 0, f.ez[0]], [f.ex[1], 0, f.ez[1]], [0, f.zpf, 0]];
  const det = A[0]![0]! * (A[1]![1]! * A[2]![2]! - A[1]![2]! * A[2]![1]!) - A[0]![1]! * (A[1]![0]! * A[2]![2]! - A[1]![2]! * A[2]![0]!) +
    A[0]![2]! * (A[1]![0]! * A[2]![1]! - A[1]![1]! * A[2]![0]!);
  if (Math.abs(det) <= 1e-30) return null;
  const id = 1.0 / det;
  const a = (r: number, c: number) => A[r]![c]!;
  const inv = [
    [(a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) * id, (a(0, 2) * a(2, 1) - a(0, 1) * a(2, 2)) * id, (a(0, 1) * a(1, 2) - a(0, 2) * a(1, 1)) * id],
    [(a(1, 2) * a(2, 0) - a(1, 0) * a(2, 2)) * id, (a(0, 0) * a(2, 2) - a(0, 2) * a(2, 0)) * id, (a(0, 2) * a(1, 0) - a(0, 0) * a(1, 2)) * id],
    [(a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0)) * id, (a(0, 1) * a(2, 0) - a(0, 0) * a(2, 1)) * id, (a(0, 0) * a(1, 1) - a(0, 1) * a(1, 0)) * id],
  ];
  const d = [eye[0]! - f.cx, eye[1]! - f.cy, eye[2]! - f.floorz];
  const mul = (v: readonly number[]): [number, number, number] =>
    [0, 1, 2].map((r) => inv[r]![0]! * v[0]! + inv[r]![1]! * v[1]! + inv[r]![2]! * v[2]!) as [number, number, number];
  return { cam: mul(d), dir: mul(look) };
}

/**
  DrawFogVolumes' order and the game's cap: indices into `dists` (each volume's horizontal distance
  from the camera to its footprint centre, sqrt(cam x^2 + cam z^2) in its local frame), far to
  near. Equal distances: the later record is drawn first (the engine keeps the earlier one
  nearer). Unless drawAll, only the nearest ENGINEFOG_MAX_DRAW are kept (the cut is the front of
  the list); a volume cut draws nothing, not even its outline.
*/
export function engineFogDrawOrder(dists: readonly number[], drawAll = false): number[] {
  const order = dists.map((_, i) => i);
  // insertion sort, farthest first (<=: of equal distances the later record goes first)
  for (let i1 = 1; i1 < order.length; i1++) {
    const key = order[i1]!;
    let j1 = i1;
    while (j1 > 0 && dists[order[j1 - 1]!]! <= dists[key]!) {
      order[j1] = order[j1 - 1]!;
      j1--;
    }
    order[j1] = key;
  }
  if (!drawAll && order.length > ENGINEFOG_MAX_DRAW) return order.slice(order.length - ENGINEFOG_MAX_DRAW);
  return order;
}

/** The three |cos| bands the slices' 1/|cos| is baked at (FogBandCos). */
export const ENGINEFOG_BAND_COS: readonly number[] = [0.65, 0.79, 0.93];

/** FogBandCos: the |cos| a band is baked at. */
export function engineFogBandCos(band: number): number {
  return ENGINEFOG_BAND_COS[band]!;
}

/** FogBandOf: the band of a |cos| (boundaries 0.72 and 0.86). */
export function engineFogBandOf(cosv: number): number {
  return cosv < 0.72 ? 0 : cosv < 0.86 ? 1 : 2;
}

/**
  The band DrawFogVolumes bakes, with 0.03 of hysteresis: when the slice axis is the one compiled
  last (prevAxis) and the previous band still holds cosv within 0.03 of its range, it is kept, so a
  camera sitting on a boundary does not recompile. prevBand < 0 = nothing compiled yet.
*/
export function engineFogBand(cosv: number, axis: number, prevAxis: number, prevBand: number): number {
  const band = engineFogBandOf(cosv);
  if (prevAxis === axis && prevBand >= 0 && prevBand !== band) {
    const lo = [0.0, 0.72, 0.86], hi = [0.72, 0.86, 2.0];
    if (cosv >= lo[prevBand]! - 0.03 && cosv < hi[prevBand]! + 0.03) return prevBand;
  }
  return band;
}

/**
  The slice axis (DrawFogVolumes): the box axis (0 x across, 1 y up, 2 z along) the local look
  direction runs down most, |cos| of the angle to it (0.577..1), and descending = the camera looks
  toward +axis (slices drawn high index first, far to near). null for a zero direction.
*/
export function engineFogSliceAxis(dir: readonly number[]): { axis: number; cosv: number; descending: boolean } | null {
  const len = Math.sqrt(dir[0]! * dir[0]! + dir[1]! * dir[1]! + dir[2]! * dir[2]!);
  if (!(len > 1e-30)) return null;
  let axis = 0;
  for (let k = 1; k < 3; k++) if (Math.abs(dir[k]!) > Math.abs(dir[axis]!)) axis = k;
  return { axis, cosv: Math.abs(dir[axis]!) / len, descending: dir[axis]! > 0.0 };
}

/**
  FogMeshCompile's alphas: each node's 1 - exp(-extinction * thickness / cosv), the thickness half
  the gap to each neighbour along the slice axis; each column along the axis is scaled so its
  whole optical depth stops at -ln(1 - maxOp) (maxOp caps opacity, not density: exact looking down
  the axis, close elsewhere). Indexed like grid.ext. Floats.
*/
export function engineFogSliceAlphas(g: EngineFogGrid, maxop: number, axis: number, cosv: number): Float32Array {
  const a = axis, b = a === 0 ? 1 : 0, c = a === 2 ? 1 : 2;
  const stride = [1, g.n[0], g.n[0] * g.n[1]];
  const na = g.n[a]!, nb = g.n[b]!, nc = g.n[c]!;
  const pa = g.pos[a]!;
  const alpha = new Float32Array(g.ext.length);
  const thick = new Float64Array(na);
  const odmax = engineFogOdAtMaxOp(maxop);
  for (let s = 0; s < na; s++) {
    const lo = s > 0 ? pa[s - 1]! : pa[s]!;
    const hi = s + 1 < na ? pa[s + 1]! : pa[s]!;
    thick[s] = 0.5 * (hi - lo);
  }
  for (let w = 0; w < nc; w++) {
    for (let u = 0; u < nb; u++) {
      const base = u * stride[b]! + w * stride[c]!;
      let od = 0.0, scale = 1.0;
      for (let s = 0; s < na; s++) od += (g.ext[base + s * stride[a]!]! * thick[s]!) / cosv;
      if (od > odmax) scale = od > 0.0 ? odmax / od : 1.0;
      for (let s = 0; s < na; s++) {
        const o = ((g.ext[base + s * stride[a]!]! * thick[s]!) / cosv) * scale;
        alpha[base + s * stride[a]!] = 1.0 - Math.exp(-o);
      }
    }
  }
  return alpha;
}

/** The slice quads (FogMeshCompile's geometry): 4 vertices per quad, two triangles each, in draw order. */
export interface EngineFogSliceMesh {
  /** x, y, z per vertex, box-local feet (x, z from the footprint centre, y from the floor). */
  positions: Float32Array;
  /** The node's alpha per vertex. */
  alphas: Float32Array;
  /** Two triangles per quad (0 1 2, 0 2 3). */
  indices: Uint32Array;
  quads: number;
}

/**
  FogMeshCompile's geometry: the slices far to near (descending: high index first), each cut into
  the quads between its nodes; a quad whose four alphas are all under ENGINEFOG_QUAD_MIN_ALPHA is
  left out. Vertex order per quad as the C++ (n0, n0 + b, n0 + b + c, n0 + c).
*/
export function engineFogSliceMesh(g: EngineFogGrid, alpha: Float32Array, axis: number, descending: boolean,
  v: Pick<EngineFogVol, "hx" | "hz">): EngineFogSliceMesh {
  const a = axis, b = a === 0 ? 1 : 0, c = a === 2 ? 1 : 2;
  const stride = [1, g.n[0], g.n[0] * g.n[1]];
  const na = g.n[a]!, nb = g.n[b]!, nc = g.n[c]!;
  const pos: number[] = [], al: number[] = [];
  for (let oi = 0; oi < na; oi++) {
    const sl = descending ? na - 1 - oi : oi;
    for (let w = 0; w + 1 < nc; w++) {
      for (let u = 0; u + 1 < nb; u++) {
        const n0 = sl * stride[a]! + u * stride[b]! + w * stride[c]!;
        const nn = [n0, n0 + stride[b]!, n0 + stride[b]! + stride[c]!, n0 + stride[c]!];
        let amax = 0;
        for (const q of nn) if (alpha[q]! > amax) amax = alpha[q]!;
        if (amax < f32(ENGINEFOG_QUAD_MIN_ALPHA)) continue;
        for (const q of nn) {
          let rem = q;
          const i2 = Math.trunc(rem / stride[2]!); rem -= i2 * stride[2]!;
          const i1 = Math.trunc(rem / stride[1]!); rem -= i1 * stride[1]!;
          pos.push(g.pos[0][rem]! - v.hx, g.pos[1][i1]!, g.pos[2][i2]! - v.hz);
          al.push(alpha[q]!);
        }
      }
    }
  }
  const quads = al.length / 4;
  const indices = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) indices.set([4 * q, 4 * q + 1, 4 * q + 2, 4 * q, 4 * q + 2, 4 * q + 3], 6 * q);
  return { positions: Float32Array.from(pos), alphas: Float32Array.from(al), indices, quads };
}
