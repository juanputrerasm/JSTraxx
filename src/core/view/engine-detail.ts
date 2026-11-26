/*
  The game engine's DETAIL MAPS (Traxx 1.8.0, b6d56f2: Traxx/EngineDetail.h / EngineDetail.cpp, and
  the pure parts of Traxx/GLDetailMaps.cpp that build the shader's inputs): the terrain detail
  normal (_DTL) scaled by its painted mask (_MASK), the still-water body shade from the water pair
  (_WDTL / _WMSK), the baked per-vertex light the engine shades them on (the track's .LTE, or on
  smooth terrain the engine's 8 ft relight), and the engine's generated detail map.

  Ground truth there: cursh2 docs\handovers\TRAXX_HANDOVER_ENGINE_RULES.md section 4 (engine
  6098176, "strength sliders + sun-height floor") and tools\traxx_rules\detail_port.py; the engine's
  wincore\rd3d11_terrain_shaders.h PS detail block, RENDD3D11.CPP _terrDetailBind /
  _createTerrDetail11, waterdet_gen.h, rd3d11_water_shaders.h _wDetail + o_shade, core\Ground.cpp
  terrMaskLoad / terrMaskDefault / waterDetailLoad / groundCornerIntensity / terrainFineShade.

  ONE SET OF NUMBERS: every constant the shading uses is exported here, and the GLSL
  (render/engine-detail-glsl.ts) is built from these same constants.

  C rules kept: the shading is float throughout, as the shader (every operation through
  Math.fround, sqrtf as fround(sqrt)); C int division truncates; (int) casts truncate; the
  generator keeps _createTerrDetail11's own float / double split and order.

  Units: feet for world positions; intensities on the engine's terrain scale, 1.0 = the texture's
  own colour, below 1 darker, above 1 toward white (the "lightTable ramp").

  The map: Traxx tracks are 256 x 256 tiles of 32 ft and the mask spans them once. A track format
  version 6 world of N = 512 cells is the same rules over N tiles: the functions that take a grid
  take its side (default 256); ENGDET_MAP_TILES / ENGDET_MAP_FT stay Traxx's (use N * 32 ft).
*/
import { engineApproxGroundNormal, engineGroundL0, engineLightCalcDiffuse, type SunVector } from "../edit/engine-light.ts";

const f32 = Math.fround;

// ---- the player's INI defaults (core\Main.cpp, RENDD3D11.CPP _terrDetailBind) ----

/** [Graphics] terrDetail, percent; 0 = the whole block off. Traxx previews the default. */
export const ENGDET_TERRDETAIL_DEFAULT = 10;
/** [Graphics] terrDetailRep, feet per detail repeat (4..4096). */
export const ENGDET_TERRDETAILREP_FT = 64.0;
/** z = 0.01 * terrDetail * slider. */
export const ENGDET_STRENGTH_PER_PCT = 0.01;
/** terrNormalStrength / waterNormalStrength clamp 0..300. */
export const ENGDET_SLIDER_MAX_PCT = 300;

// ---- the terrain term (handover 4.3) ----

/** mDet = 1 + 4 * mask.r: black = 1x, white = 5x. */
export const ENGDET_MASK_SPAN = 4.0;
/** i -= 0.6 * z * mDet * (1 - DTL.b). */
export const ENGDET_AO_K = 0.6;
/** The relief delta is clamped to +-0.3. */
export const ENGDET_DLIT_CLAMP = 0.3;
/** lerp(0.5, 1, |L.xz|): the sun-height floor of 6098176. */
export const ENGDET_SUNH_FLOOR = 0.5;
/** Overhead sun: a fixed diagonal stands in. */
export const ENGDET_SUNH_EPS = 0.001;
/** That diagonal, (1, 1) / sqrt(2). */
export const ENGDET_DIAG = 0.70710678;

// ---- the map ----

export const ENGDET_TILE_FT = 32.0;
export const ENGDET_MAP_TILES = 256.0;
/** ENGDET_MAP_TILES * ENGDET_TILE_FT. */
export const ENGDET_MAP_FT = 8192.0;

// ---- the baked per-vertex intensity (groundCornerIntensity): li = l0 << 4, i = clamp((li - 256) / 4080, 0, 1) ----

export const ENGDET_LI_BIAS = 256.0;
export const ENGDET_LI_SCALE = 4080.0;

// ---- water (handover 4.5, _wDetail and the o_shade line) ----

/** Per layer, a constant (no INI floor). */
export const ENGDET_WATER_AMP = 0.02;
/** Layer A: one repeat every 2 tiles. */
export const ENGDET_WATER_SCALE_A = 0.5;
/** Layer B: 69 repeats over the 256-tile world. */
export const ENGDET_WATER_SCALE_B = 0.26953125;
/** Pixel footprint (ft) where the fade starts ... */
export const ENGDET_WATER_LOD_LO = 1.5;
/** ... and where the detail is gone. */
export const ENGDET_WATER_LOD_HI = 5.0;
/** Body shade = clamp(1 + 2.4 * dot(sDet, (.6, .8)), .7, 1.3). */
export const ENGDET_WATER_SHADE_K = 2.4;
export const ENGDET_WATER_SHADE_DX = 0.6;
export const ENGDET_WATER_SHADE_DY = 0.8;
export const ENGDET_WATER_SHADE_LO = 0.7;
export const ENGDET_WATER_SHADE_HI = 1.3;

// ---- the engine's default "Always On" terrain mask (terrMaskDefault): ported for the record, not previewed ----

export const ENGDET_TM_DARK_LUM = 75.0;
export const ENGDET_TM_DARK_MULT = 2.0;
export const ENGDET_TM_REF_LUM = 109.0;
export const ENGDET_TM_REF_MULT = 1.42;

// ---- editor-only colours ----

/** The strength wash (View > Show Detail Strength): texture * (1 - WASH * t), t = strength / (5 z). */
export const ENGDET_WASH_R = 0.85;
export const ENGDET_WASH_G = 0.6;
export const ENGDET_WASH_B = 0.15;
/** The world-wrap border's tint: tint * 0.35 + colour * 0.65. */
export const ENGDET_BORDER_R = 0.7;
export const ENGDET_BORDER_G = 0.8;
export const ENGDET_BORDER_B = 0.95;
export const ENGDET_BORDER_W = 0.35;

/** The 8 ft grid of a 256-cell world (terrainFineShade). */
export const ENGDET_FINE_DIM = 1024;
/** The generated detail map's side. */
export const ENGDET_GEN_SIZE = 256;

const satF = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The slider (percent, clamped 0..300) as a factor, only while the engine's default mask is in use. */
function sliderFactor(sliderPct: number, maskIsDefault: boolean): number {
  if (!maskIsDefault) return 1;
  if (sliderPct < 0) sliderPct = 0;
  if (sliderPct > ENGDET_SLIDER_MAX_PCT) sliderPct = ENGDET_SLIDER_MAX_PCT;
  return f32(sliderPct / 100);
}

/**
  EngineDetailStrength (detail_port.py terr_strength): the strength z the shader is given. The
  slider only counts with the engine's DEFAULT mask; a track's own _MASK always gets x1. dbg 1 =
  the engine's arrival test (negative z); mirror = the water-mirror pass (off). The preview uses
  engineDetailStrength(ENGDET_TERRDETAIL_DEFAULT, 100, false) = 0.1.
*/
export function engineDetailStrength(terrDetail: number, sliderPct: number, maskIsDefault: boolean, dbg = 0, mirror = false): number {
  const s = sliderFactor(sliderPct, maskIsDefault);
  let z = f32(f32(f32(ENGDET_STRENGTH_PER_PCT) * f32(terrDetail)) * s);
  if (dbg === 1) z = -z;
  if (mirror) z = 0;
  return z;
}

/**
  EngineDetailTerrainIf: the terrain term (handover 4.3) with the texel and mask as 0..1 floats,
  the shape the shader evaluates. i = the baked intensity before the detail block; sun = the LVL
  light vector, the direction light TRAVELS (any length); z = engineDetailStrength. Returns i after
  the block.
*/
export function engineDetailTerrainIf(i: number, dr: number, dg: number, db: number, mask: number, sun: readonly number[], z: number): number {
  i = f32(i); dr = f32(dr); dg = f32(dg); db = f32(db); mask = f32(mask); z = f32(z);
  if (z === 0) return i;

  // dn.xy = DTL.rg * 2 - 1; z rebuilt; a degenerate texel is flat.
  let dx = f32(f32(dr * 2) - 1);
  let dy = f32(f32(dg * 2) - 1);
  const dz = f32(Math.sqrt(satF(f32(1 - f32(f32(dx * dx) + f32(dy * dy))))));
  if (dz <= 0) dx = dy = 0;

  const mdet = f32(1 + f32(f32(ENGDET_MASK_SPAN) * mask));
  const az = Math.abs(z);
  dx = f32(dx * f32(mdet * az));
  dy = f32(dy * f32(mdet * az));

  // The AO: an ambient-floor subtraction.
  i = f32(i - f32(f32(f32(f32(f32(ENGDET_AO_K) * az) * mdet)) * f32(1 - db)));
  if (i < 0) i = 0;

  // First-order relief against the sun's horizontal direction, with the sun-height floor.
  const s0 = f32(sun[0]!), s1 = f32(sun[1]!), s2 = f32(sun[2]!);
  const l = f32(Math.sqrt(f32(f32(f32(s0 * s0) + f32(s1 * s1)) + f32(s2 * s2))));
  let lx = 0, lz = 0;
  if (l > 0) {
    lx = f32(s0 / l);
    lz = f32(s2 / l);
  }
  const sunh = f32(Math.sqrt(f32(f32(lx * lx) + f32(lz * lz))));
  let sdx: number, sdy: number;
  if (sunh > f32(ENGDET_SUNH_EPS)) {
    sdx = f32(lx / sunh);
    sdy = f32(lz / sunh);
  } else sdx = sdy = f32(ENGDET_DIAG);
  const floor = f32(ENGDET_SUNH_FLOOR);
  let dlit = f32(-f32(f32(dx * sdx) + f32(dy * sdy)) * f32(floor + f32(f32(1 - floor) * sunh)));
  const clamp = f32(ENGDET_DLIT_CLAMP);
  if (dlit < -clamp) dlit = -clamp;
  if (dlit > clamp) dlit = clamp;
  i = f32(i + dlit);
  if (i < 0) i = 0;

  if (z < 0) i = 4; // the engine's arrival test: white wherever the block runs
  return i;
}

/**
  EngineDetailTerrainI: the terrain term with the texel (r, g, b 0..255) and the mask's red
  (0..255). Also returns the pieces for a report: mDet, dLit (the relief term alone) and the AO
  subtraction.
*/
export function engineDetailTerrainI(i: number, r: number, g: number, b: number, maskR: number, sun: readonly number[], z: number): { i: number; mdet: number; dlit: number; aosub: number } {
  const dr = f32(r / 255), dg = f32(g / 255), db = f32(b / 255);
  const mk = f32(maskR / 255);
  const out = engineDetailTerrainIf(i, dr, dg, db, mk, sun, z);
  z = f32(z);
  const m = f32(1 + f32(f32(ENGDET_MASK_SPAN) * mk));
  const az = Math.abs(z);
  const ao = z === 0 ? 0 : f32(f32(f32(f32(ENGDET_AO_K) * az) * m) * f32(1 - db));
  // dLit = the term alone: run the block from a high i with no AO (b = 1), where no clamp at 0 bites.
  const iao = engineDetailTerrainIf(2, dr, dg, 1, mk, sun, z);
  const dl = z <= 0 ? 0 : f32(iao - 2);
  return { i: out, mdet: m, dlit: dl, aosub: ao };
}

/** EngineDetailRamp: the engine's ramp, tex * i up to 1, toward white above. */
export function engineDetailRamp(tex: readonly number[], i: number): [number, number, number] {
  i = f32(i);
  const one = (t: number) => (i <= 1 ? f32(f32(t) * i) : f32(f32(t) + f32(f32(1 - f32(t)) * satF(f32(i - 1)))));
  return [one(tex[0]!), one(tex[1]!), one(tex[2]!)];
}

/** EngineDetailDefaultMaskByte (terrMaskDefault): the default mask byte for a tile of average luminance `lum`, with its multiplier and mDet. */
export function engineDetailDefaultMaskByte(lum: number): { byte: number; mult: number; mdet: number } {
  lum = f32(lum);
  let m: number;
  if (lum <= f32(ENGDET_TM_DARK_LUM)) m = f32(ENGDET_TM_DARK_MULT);
  else if (lum < f32(ENGDET_TM_REF_LUM)) {
    m = f32(f32(ENGDET_TM_DARK_MULT) + f32(f32(f32(f32(ENGDET_TM_REF_MULT) - f32(ENGDET_TM_DARK_MULT)) * f32(lum - f32(ENGDET_TM_DARK_LUM))) / f32(f32(ENGDET_TM_REF_LUM) - f32(ENGDET_TM_DARK_LUM))));
  } else {
    const q = f32(f32(ENGDET_TM_REF_LUM) / lum);
    m = f32(f32(f32(ENGDET_TM_REF_MULT) * q) * q);
  }
  if (m < 1) m = 1;
  const byte = Math.trunc(f32(f32(f32(f32(m - 1) / 4) * 255) + 0.5));
  return { byte, mult: m, mdet: f32(1 + f32(f32(f32(ENGDET_MASK_SPAN) * f32(byte)) / 255)) };
}

/** EngineDetailWaterAmp: the water per-layer amplitude 0.02 * (1 + 4 * mk) * lod * watt * slider (slider only with the default mask). */
export function engineDetailWaterAmp(maskR: number, lod: number, watt: number, sliderPct: number, maskIsDefault: boolean): number {
  const s = sliderFactor(sliderPct, maskIsDefault);
  const mk = f32(f32(f32(ENGDET_MASK_SPAN) * f32(maskR)) / 255);
  return f32(f32(f32(f32(f32(ENGDET_WATER_AMP) * f32(1 + mk)) * f32(lod)) * f32(watt)) * s);
}

/** EngineDetailWaterLod: 1 - smoothstep(1.5, 5, pxft), the water detail's pixel-footprint fade. */
export function engineDetailWaterLod(pxft: number): number {
  const t = satF(f32(f32(f32(pxft) - f32(ENGDET_WATER_LOD_LO)) / f32(f32(ENGDET_WATER_LOD_HI) - f32(ENGDET_WATER_LOD_LO))));
  return f32(1 - f32(f32(t * t) * f32(3 - f32(2 * t))));
}

/** EngineDetailWaterShade: the still-water body shade from the two layers' rg (0..1), the mask (0..1) and the footprint fade. */
export function engineDetailWaterShade(na: readonly number[], nb: readonly number[], mask: number, lod: number): number {
  const amp = f32(f32(f32(ENGDET_WATER_AMP) * f32(1 + f32(f32(ENGDET_MASK_SPAN) * f32(mask)))) * f32(lod));
  const n = (v: number) => f32(f32(f32(v) * 2) - 1);
  const sx = f32(-f32(n(na[0]!) + n(nb[0]!)) * amp);
  const sy = f32(-f32(n(na[1]!) + n(nb[1]!)) * amp);
  let shade = f32(1 + f32(f32(ENGDET_WATER_SHADE_K) * f32(f32(sx * f32(ENGDET_WATER_SHADE_DX)) + f32(sy * f32(ENGDET_WATER_SHADE_DY)))));
  if (shade < f32(ENGDET_WATER_SHADE_LO)) shade = f32(ENGDET_WATER_SHADE_LO);
  if (shade > f32(ENGDET_WATER_SHADE_HI)) shade = f32(ENGDET_WATER_SHADE_HI);
  return shade;
}

/**
  EngineDetailVertexI: the baked intensity of one terrain corner from the track's .LTE, what the
  engine draws with. ground = the .LTE l0 byte (byte 0 of the cell's 7), shadowBit = bit 0 of the
  second byte (groundboxlower, groundArray[].shadow), ambient = the LVL ambientLight (0..65535;
  a shadow corner gets groundAmbient = lightCalcDiffuse(0,0,0) = ambient / 16 + 256).
*/
export function engineDetailVertexI(ground: number, shadowBit: number | boolean, ambient: number): number {
  let li: number;
  if (shadowBit) {
    if (ambient < 0) ambient = 0;
    if (ambient > 65535) ambient = 65535;
    li = Math.trunc(ambient / 16) + 0x100;
  } else li = (ground & 255) << 4;
  return satF(f32(f32(li - ENGDET_LI_BIAS) / ENGDET_LI_SCALE));
}

/** EngineDetailVertexByte: the same as an 8-bit texel, round(i * 255); exact for every non-shadow corner (l0 - 16). */
export function engineDetailVertexByte(ground: number, shadowBit: number | boolean, ambient: number): number {
  const b = Math.trunc(f32(f32(engineDetailVertexI(ground, shadowBit, ambient) * 255) + 0.5));
  return b < 0 ? 0 : b > 255 ? 255 : b;
}

/**
  EngineDetailCellI: the intensity inside a cell, over the TRIANGLE the point falls in, as the
  engine's Gouraud shading does: c0..c3 = corners (0,0) (1,0) (1,1) (0,1); fx, fy in 0..1; odd =
  the cell's parity ((x + z) & 1): even splits 0-2, odd 1-3 (the tiles' own split). The shader's
  bakedI does exactly this.
*/
export function engineDetailCellI(c0: number, c1: number, c2: number, c3: number, fx: number, fy: number, odd: number | boolean): number {
  c0 = f32(c0); c1 = f32(c1); c2 = f32(c2); c3 = f32(c3); fx = f32(fx); fy = f32(fy);
  if (!odd) {
    // Diagonal (0,0)-(1,1): triangles (0,3,2) above it, (2,1,0) below.
    if (fy > fx) return f32(f32(c0 + f32(fx * f32(c2 - c3))) + f32(fy * f32(c3 - c0)));
    return f32(f32(c0 + f32(fx * f32(c1 - c0))) + f32(fy * f32(c2 - c1)));
  }
  // Diagonal (1,0)-(0,1): triangles (1,0,3) and (3,2,1).
  if (f32(fx + fy) <= 1) return f32(f32(c0 + f32(fx * f32(c1 - c0))) + f32(fy * f32(c3 - c0)));
  return f32(f32(c2 + f32(f32(1 - fx) * f32(c3 - c2))) + f32(f32(1 - fy) * f32(c1 - c2)));
}

/**
  The shader's bakedI on the CPU: the light texture (n x n bytes, row z, as engineDetailLightTexture
  builds it, sampled NEAREST and wrapping) at world feet (x, z), over a map of mapTiles tiles of
  32 ft. Texel values are taken as byte / 255, as an 8-bit texture reads. For picking and tests.
*/
export function engineDetailBakedI(light: Uint8Array, n: number, xFt: number, zFt: number, mapTiles = ENGDET_MAP_TILES): number {
  const gx = f32(f32(xFt) * f32(n / f32(ENGDET_TILE_FT * mapTiles)));
  const gz = f32(f32(zFt) * f32(n / f32(ENGDET_TILE_FT * mapTiles)));
  const cx = Math.floor(gx), cz = Math.floor(gz);
  const m = (v: number) => ((v % n) + n) % n;
  const at = (x: number, z: number) => light[m(z) * n + m(x)]! / 255;
  return engineDetailCellI(at(cx, cz), at(cx + 1, cz), at(cx + 1, cz + 1), at(cx, cz + 1), f32(gx - cx), f32(gz - cz), (((cx + cz) % 2) + 2) % 2);
}

/**
  EngineDetailGenerate (RENDD3D11.CPP _createTerrDetail11, byte-identical in the Vulkan renderer;
  waterdet_gen.h for water): the engine's GENERATED detail map, 256 x 256 RGBA, tiling value noise,
  xorshift seed 2463534242, octaves 4..64, normals by central difference x20. withAo: blue = the
  cavity AO (terrain); otherwise blue = 255 (water). Row 0 = v 0. Used when a track has a mask but
  no detail normal (or one the engine refuses: over HDTEX_MAX_DIM a side).
*/
export function engineDetailGenerate(withAo: boolean): Uint8Array {
  const S = ENGDET_GEN_SIZE;
  const px = new Uint8Array(S * S * 4);
  const h = new Float32Array(S * S);
  const hb = new Float32Array(S * S);
  const lat = new Float32Array(64 * 64);
  let rng = 2463534242;

  for (let f = 4, oct = 0; f <= 64; f *= 2, oct++) {
    for (let k = 0; k < f * f; k++) {
      rng = (rng ^ (rng << 13)) >>> 0;
      rng = (rng ^ (rng >>> 17)) >>> 0;
      rng = (rng ^ (rng << 5)) >>> 0;
      lat[k] = f32((rng & 0xffff) / 65535);
    }
    const amp = f32(1 / (1 << oct));
    const cell = Math.trunc(S / f);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const x0 = Math.trunc(x / cell), y0 = Math.trunc(y / cell), x1 = (x0 + 1) % f, y1 = (y0 + 1) % f;
        let fx = f32((x - x0 * cell) / cell), fy = f32((y - y0 * cell) / cell);
        fx = f32(f32(fx * fx) * f32(3 - f32(2 * fx)));
        fy = f32(f32(fy * fy) * f32(3 - f32(2 * fy)));
        const a = lat[y0 * f + x0]!, bb = lat[y0 * f + x1]!, c = lat[y1 * f + x0]!, d = lat[y1 * f + x1]!;
        const top = f32(a + f32(f32(bb - a) * fx));
        const bot = f32(c + f32(f32(d - c) * fx));
        h[y * S + x] = f32(h[y * S + x]! + f32(amp * f32(top + f32(f32(bot - top) * fy))));
      }
    }
  }

  // Cavity AO into blue (terrain only): blur radius 6 step 2, d = sat((blur - h) * 2.2).
  if (withAo) {
    const RAD = 6;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let acc = 0, n = 0;
        for (let dy = -RAD; dy <= RAD; dy += 2) {
          for (let dx = -RAD; dx <= RAD; dx += 2) {
            acc = f32(acc + h[(((y + dy) % S + S) % S) * S + (((x + dx) % S + S) % S)]!);
            n++;
          }
        }
        hb[y * S + x] = f32(acc / n);
      }
    }
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hl = h[y * S + ((x + S - 1) % S)]!, hr = h[y * S + ((x + 1) % S)]!;
      const hd = h[((y + S - 1) % S) * S + x]!, hu = h[((y + 1) % S) * S + x]!;
      let nx = -f32(hr - hl) * 20.0, ny = -f32(hu - hd) * 20.0;
      const l = Math.sqrt(nx * nx + ny * ny + 1.0);
      nx /= l;
      ny /= l;
      const o = (y * S + x) * 4;
      px[o] = Math.trunc((nx * 0.5 + 0.5) * 255.0 + 0.5);
      px[o + 1] = Math.trunc((ny * 0.5 + 0.5) * 255.0 + 0.5);
      if (withAo) {
        let dd = f32(f32(hb[y * S + x]! - h[y * S + x]!) * f32(2.2));
        if (dd < 0) dd = 0;
        if (dd > 1) dd = 1;
        px[o + 2] = Math.trunc(f32(f32(f32(1 - dd) * 255) + 0.5));
      } else px[o + 2] = 255;
      px[o + 3] = 255;
    }
  }
  return px;
}

/** engine\Matrix.cpp normalizeVectorLong (double, scale 65535, truncating). */
function detNormalizeLong(a: number, b: number, c: number): [number, number, number] {
  const l = Math.sqrt(a * a + b * b + c * c);
  if (l !== 0) {
    a = (a / l) * 65535;
    b = (b / l) * 65535;
    c = (c / l) * 65535;
  } else a = b = c = 0;
  return [Math.trunc(a) | 0, Math.trunc(b) | 0, Math.trunc(c) | 0];
}

/**
  EngineDetailFineL0: SMOOTH TERRAIN's (Spline / Full Map) 8 ft relight (core\Ground.cpp
  terrainFineShade, drawn by fineDayLi / fineIntensityNorm):
    l0 = formula(fine normal) + round-half-away( bilerp over the 32 ft tile of (.LTE l0 - formula(classic normal)) )
  clamped 0..255, formula = engineGroundL0, the fine normal by central differences on the 8 ft
  heights (x groundY 4, ny = 2 * 8 * 256), the classic one engineApproxGroundNormal on y0.
    fy0  4N x 4N engine heights, v >> 1 (row-major z)
    y0   N x N coarse engine heights (lighting.ts engineY0)
    lte  N x N .LTE l0 bytes (z * N + x)
  Returns 4N x 4N fine l0 bytes. N = 256 is Traxx's (1024 fine).
  NOT PORTED (as in Traxx): the engine's per-8-ft-vertex SHADOW (lightWorldPoint against the box
  system); a smooth track's preview is unshadowed (fineDayLi with shadow 0), and on these tracks
  the engine overwrites the .LTE's shadow bit from that trace anyway.
*/
export function engineDetailFineL0(fy0: ArrayLike<number>, y0: ArrayLike<number>, lte: ArrayLike<number>, sun: SunVector, ambient: number, n = 256): Uint8Array {
  const D = 4 * n, M = D - 1, tm = n - 1, GY = 4;
  const out = new Uint8Array(D * D);
  const delta = new Int16Array(n * n);
  // .LTE l0 minus the classic formula, per 32 ft corner.
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) delta[z * n + x] = lte[z * n + x]! - engineGroundL0(sun, ambient, engineApproxGroundNormal(y0, x, z, n));
  }
  for (let Z = 0; Z < D; Z++) {
    for (let X = 0; X < D; X++) {
      const y1 = fy0[(Z & M) * D + ((X + 1) & M)]!;
      const y3 = fy0[(Z & M) * D + ((X - 1) & M)]!;
      const y2 = fy0[((Z + 1) & M) * D + (X & M)]!;
      const y4 = fy0[((Z - 1) & M) * D + (X & M)]!;
      const nrm = detNormalizeLong(-(y1 - y3) * GY, 2 * 8 * 256, -(y2 - y4) * GY);
      const f = engineGroundL0(sun, ambient, nrm);
      const tx = X >> 2, tz = Z >> 2, fx = X & 3, fz = Z & 3;
      const tx1 = (tx + 1) & tm, tz1 = (tz + 1) & tm;
      const s = delta[tz * n + tx]! * (4 - fx) * (4 - fz) + delta[tz * n + tx1]! * fx * (4 - fz)
        + delta[tz1 * n + tx]! * (4 - fx) * fz + delta[tz1 * n + tx1]! * fx * fz;
      const d = s >= 0 ? Math.trunc((s + 8) / 16) : -Math.trunc((-s + 8) / 16);
      let v = f + d;
      if (v < 0) v = 0;
      else if (v > 255) v = 255;
      out[Z * D + X] = v;
    }
  }
  return out;
}

/** The inputs EnsureLightTex reads from the track. */
export interface EngineDetailLightInput {
  /** The .LTE, 7 bytes a cell (z * N + x): byte 0 the ground l0, byte 1 bit 0 the shadow bit. */
  lte: Uint8Array;
  /** The LVL sun vector (track.sun.vector, else Traxx's default; lighting.ts trackLighting). */
  sun: SunVector;
  /** The LVL ambient (track.sun.shadowIntensity; pod.shadowintens). */
  ambient: number;
  /** The grid side N (256, or 512 on a version 6 world). */
  n?: number;
  /**
    Smooth terrain only (Spline / Full Map): the 4N x 4N surface in v (surface.ts getSurface) and
    the coarse engine heights (lighting.ts engineY0). Omit both on Classic 8-bit and 16-bit.
  */
  surface?: ArrayLike<number> | null;
  y0?: ArrayLike<number> | null;
}

/**
  EnsureLightTex's pixels: the baked intensities the engine draws the ground with, one byte a lit
  vertex (texel = round(i * 255)), row z. Classic tracks: the .LTE corners, N x N, a shadow-bit
  corner at groundAmbient. Spline / Full Map: the engine's 8 ft relight (engineDetailFineL0),
  4N x 4N, unshadowed. Upload as a one-channel (RedFormat / LUMINANCE) UnsignedByte texture, NEAREST,
  REPEAT, no mips, unpackAlignment 1, no flip; uLightN = n.

  Traxx 1.8.1 (EnsureLightTex, "two bytes a texel"): `shadow` is the second byte, the .LTE shadow
  bit as 255 or 0 (the ground boxes' walls and bottoms need the bit itself, handover 4.7); all 0
  on Spline / Full Map (the engine's 8 ft shadow trace has no port). `rg` is the pair interleaved
  (i, shadow), for a two-channel (RGFormat) upload the box shader reads as .r and .g.
*/
export function engineDetailLightTexture(input: EngineDetailLightInput): { n: number; data: Uint8Array; shadow: Uint8Array; rg: Uint8Array } {
  const N = input.n ?? 256;
  const { lte, sun, ambient } = input;
  const pair = (data: Uint8Array, shadow: Uint8Array) => {
    const rg = new Uint8Array(data.length * 2);
    for (let k = 0; k < data.length; k++) { rg[k * 2] = data[k]!; rg[k * 2 + 1] = shadow[k]!; }
    return rg;
  };
  if (!input.surface || !input.y0) {
    const data = new Uint8Array(N * N), shadow = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) {
      data[k] = engineDetailVertexByte(lte[k * 7]!, lte[k * 7 + 1]! & 1, ambient);
      shadow[k] = lte[k * 7 + 1]! & 1 ? 255 : 0;
    }
    return { n: N, data, shadow, rg: pair(data, shadow) };
  }
  const D = 4 * N;
  const surf = input.surface;
  // The engine's y0 = v >> 1 (Ground.cpp loadGround). Traxx's WORD surface fits a short after the
  // shift; a version 6 32-bit store keeps its arithmetic shift.
  const fy0 = new Int32Array(D * D);
  for (let i = 0; i < D * D; i++) fy0[i] = surf[i]! >> 1;
  const ltb = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) ltb[k] = lte[k * 7]!;
  const fine = engineDetailFineL0(fy0, input.y0, ltb, sun, ambient, N);
  for (let i = 0; i < D * D; i++) fine[i] = engineDetailVertexByte(fine[i]!, 0, ambient);
  const shadow = new Uint8Array(D * D);   // unshadowed: the engine's 8 ft shadow trace has no port
  return { n: D, data: fine, shadow, rg: pair(fine, shadow) };
}

/** The key EnsureLightTex rebuilds on: any change of it (or an invalidate) means a new light texture. */
export function engineDetailLightKey(generation: number, terrainMode: number, surfaceRevision: number, sun: SunVector, ambient: number): string {
  return `${generation}|${terrainMode}|${surfaceRevision}|${sun[0]},${sun[1]},${sun[2]}|${ambient}`;
}

/**
  The sun uniform (GLDetailBeginTerrain): the LVL light vector as floats; a zero vector would be
  NaN in normalize(), so straight down stands in (the port's answer: no horizontal part, the
  fixed diagonal).
*/
export function engineDetailSunUniform(sun: SunVector): [number, number, number] {
  const s: [number, number, number] = [f32(sun[0]!), f32(sun[1]!), f32(sun[2]!)];
  if (s[0] === 0 && s[1] === 0 && s[2] === 0) s[1] = -1;
  return s;
}

/**
  EnsureMaskCPU: a decoded mask (RGBA, rows top-down = world z 0 first) as its red channel, the
  only channel the engine reads (a coloured mask is warned about, not converted).
*/
export function engineDetailMaskRed(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  const red = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) red[k] = rgba[k * 4]!;
  return red;
}

/** A dirty rectangle [x0, x1) x [y0, y1); empty when x0 >= x1. */
export interface EngineDetailRect { x0: number; y0: number; x1: number; y1: number }

/**
  EnsureMaskCPU's diff: the rectangle where a same-size replacement mask differs from the kept
  copy, or null when nothing changed (or the sizes differ: upload whole).
*/
export function engineDetailMaskDiff(prev: Uint8Array, next: Uint8Array, w: number, h: number): EngineDetailRect | null {
  if (prev.length !== w * h || next.length !== w * h) return null;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    let rowDiff = false;
    for (let x = 0; x < w; x++) {
      if (prev[y * w + x] !== next[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        rowDiff = true;
      }
    }
    if (rowDiff) {
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 >= 0 ? { x0, y0, x1: x1 + 1, y1: y1 + 1 } : null;
}

/** The union of two dirty rectangles (either may be null or empty). */
export function engineDetailRectUnion(a: EngineDetailRect | null, b: EngineDetailRect | null): EngineDetailRect | null {
  if (!a || a.x0 >= a.x1) return b && b.x0 < b.x1 ? { ...b } : null;
  if (!b || b.x0 >= b.x1) return { ...a };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/**
  GLDetailPaintMask's CPU half: replace texels (x, y) .. (x + w - 1, y + h - 1) of the kept mask
  (mw x mh) with `red` (rows `stride` bytes apart), clipped, moving the source with the rectangle.
  Returns the rectangle written (union it into the pending upload), or null when nothing is inside.
*/
export function engineDetailPaintMask(mask: Uint8Array, mw: number, mh: number, x: number, y: number, w: number, h: number, red: Uint8Array, stride: number): EngineDetailRect | null {
  let src = 0;
  if (x < 0) { src -= x; w += x; x = 0; }
  if (y < 0) { src -= y * stride; h += y; y = 0; }
  if (x + w > mw) w = mw - x;
  if (y + h > mh) h = mh - y;
  if (w <= 0 || h <= 0) return null;
  for (let j = 0; j < h; j++) mask.set(red.subarray(src + j * stride, src + j * stride + w), (y + j) * mw + x);
  return { x0: x, y0: y, x1: x + w, y1: y + h };
}

// ---- Traxx 1.8.1: Show Water Strength and ground boxes (EngineDetail.h / EngineDetail.cpp tail) ----

/**
  The editor's WATER strength wash (View > Show Water Strength, EngineDetail.h ENGDET_WWASH_*), the
  twin of the Detail Strength wash on the water: t = the water detail's strength / its strongest =
  (1 + 4 mk) / 5, and the water's colour goes toward ORANGE by WWASH_K * t (orange because the water
  and the Detail Strength wash are both blue). Editor-only colours (the old wash's 255, 140, 0).
*/
export const ENGDET_WWASH_R = 1.0;
export const ENGDET_WWASH_G = 0.54901961;
export const ENGDET_WWASH_B = 0.0;
export const ENGDET_WWASH_K = 0.75;

/**
  EngineDetail.h ENGDET_UNTEX_S: the UNTEXTURED mark on a ground box face (an editor convention, not
  the engine's). An untextured polygon gets this texcoord, which no textured polygon has, so the box
  shader tells the two apart without trusting the colour. The shader tests s against half of it.
*/
export const ENGDET_UNTEX_S = -65536.0;

/** EngineDetailWaterWashT: the wash value at a water mask (0..1), (1 + 4 mk) / 5: 0.2 unpainted, 1.0 white. */
export function engineDetailWaterWashT(mask: number): number {
  return f32(f32(1 + f32(f32(ENGDET_MASK_SPAN) * satF(f32(mask)))) / f32(1 + ENGDET_MASK_SPAN));
}

/** EngineDetailWaterWash: rgb (0..1) toward orange by WWASH_K * t(mask). */
export function engineDetailWaterWash(rgb: readonly number[], mask: number): [number, number, number] {
  const orange = [f32(ENGDET_WWASH_R), f32(ENGDET_WWASH_G), f32(ENGDET_WWASH_B)];
  const w = f32(f32(ENGDET_WWASH_K) * engineDetailWaterWashT(mask));
  const o = (k: number) => f32(f32(rgb[k]!) + f32(f32(orange[k]! - f32(rgb[k]!)) * w));
  return [o(0), o(1), o(2)];
}

/*
  GROUND BOXES (engine handover 4.7, core\Ground.cpp buildTerrainCache Pass 3; EngineDetail.h). A
  ground box is drawn by the terrain shader: the SAME detail term, fed world X, Z on every face (Y
  never enters: a wall reads one row of the map smeared vertically). What differs is the light, per
  corner (tile x + CDX, z + CDZ), legacy rule: shadow bit -> groundAmbient; top -> l0 << 4; sides /
  bottom -> lightCalcDiffuse(face normal) - 0x100; then i = clamp((li - 256) / 4080, 0, 1). Faces in
  the engine's FACES order (normals in engine axes, Y up; Traxx grid y = engine Z).
*/
export const ENGDET_BOX_FRONT = 0;   // -Z, corners {0,1,5,4}
export const ENGDET_BOX_BACK = 1;    // +Z, {2,3,7,6}
export const ENGDET_BOX_RIGHT = 2;   // +X, {1,2,6,5}
export const ENGDET_BOX_LEFT = 3;    // -X, {3,0,4,7}
export const ENGDET_BOX_TOP = 4;     // +Y, {4,5,6,7}
export const ENGDET_BOX_BOTTOM = 5;  // -Y, {0,1,2,3}

/** EngineDetail.cpp g_BoxFaces / g_BoxCDX / g_BoxCDZ / g_BoxCTOP (Ground.cpp Pass 3 FACES, CDX, CDZ, CTOP). */
const BOX_FACES: readonly { c: readonly number[]; n: readonly number[] }[] = [
  { c: [0, 1, 5, 4], n: [0, 0, -65535] },
  { c: [2, 3, 7, 6], n: [0, 0, 65535] },
  { c: [1, 2, 6, 5], n: [65535, 0, 0] },
  { c: [3, 0, 4, 7], n: [-65535, 0, 0] },
  { c: [4, 5, 6, 7], n: [0, 65535, 0] },
  { c: [0, 1, 2, 3], n: [0, -65535, 0] },
];
const BOX_CDX = [0, 1, 1, 0, 0, 1, 1, 0];
const BOX_CDZ = [0, 0, 1, 1, 0, 0, 1, 1];
const BOX_CTOP = [0, 0, 0, 0, 1, 1, 1, 1];

/** EngineDetailBoxFaceI: a face's legacy side / bottom light as i, clamp((lightCalcDiffuse(n) - 0x100 - 256) / 4080). */
export function engineDetailBoxFaceI(face: number, sun: SunVector, ambient: number): number {
  if (face < 0 || face > 5) return 0;
  const li = engineLightCalcDiffuse(sun, ambient, BOX_FACES[face]!.n) - 0x100;   // faceLit
  return satF(f32(f32(li - ENGDET_LI_BIAS) / ENGDET_LI_SCALE));
}

/** One ground box corner (EngineDetailBoxCorner's outputs). */
export interface EngineDetailBoxCornerInfo {
  /** World position in engine units (1/256 ft): x * 8192. */
  wx: number;
  wz: number;
  /** 1 on the box's top, 0 on its bottom. */
  top: number;
  /** The tile its light is read from, wrapped at cells. */
  tx: number;
  tz: number;
  /** The detail uv, pos.xz / (rep * 256): no N in it. */
  u: number;
  v: number;
}

/**
  EngineDetailBoxCorner: corner k (0..3) of face `face` of the box on tile (x, z): its world position
  in engine units, whether it is on the top, the tile its light is read from (wrapped at cells = N),
  and the detail uv pos.xz / (rep * 256) (the VS: detUV = pos.xz / (terrDetailRep * 256)).
*/
export function engineDetailBoxCorner(face: number, k: number, x: number, z: number, rep: number, cells: number): EngineDetailBoxCornerInfo {
  const g = 32 * 256;
  const ci = BOX_FACES[face]!.c[k & 3]!;
  const X = (x + BOX_CDX[ci]!) * g, Z = (z + BOX_CDZ[ci]!) * g;
  return {
    wx: X, wz: Z, top: BOX_CTOP[ci]!,
    tx: (x + BOX_CDX[ci]!) & (cells - 1), tz: (z + BOX_CDZ[ci]!) & (cells - 1),
    u: X / (rep * 256), v: Z / (rep * 256),
  };
}

/**
  EngineDetailBoxI: the baked light at (fx, fz) (0..1 across the tile) on face `face`. ci = the four
  cell corners' .LTE i as the ground has them ((0,0) (1,0) (1,1) (0,1); a shadow-bit corner already
  holds groundAmbient's i), sh = their shadow bits, facei = engineDetailBoxFaceI(face). Top: the
  corners over the (0,0)-(1,1) diagonal. Bottom: the same with facei on unshadowed corners. Walls:
  linear along the wall between its two corners, each corner sh ? ci : facei. The shader's boxI is
  the same code.
*/
export function engineDetailBoxI(face: number, ci: readonly number[], sh: readonly (number | boolean)[], facei: number, fx: number, fz: number): number {
  fx = f32(fx); fz = f32(fz);
  if (fx < 0) fx = 0; else if (fx > 1) fx = 1;
  if (fz < 0) fz = 0; else if (fz > 1) fz = 1;
  if (face === ENGDET_BOX_TOP) return engineDetailCellI(ci[0]!, ci[1]!, ci[2]!, ci[3]!, fx, fz, 0);
  const v = [0, 1, 2, 3].map((k) => f32(sh[k] ? ci[k]! : facei));
  switch (face) {
    case ENGDET_BOX_BOTTOM: return engineDetailCellI(v[0]!, v[1]!, v[2]!, v[3]!, fx, fz, 0);
    case ENGDET_BOX_FRONT: return f32(v[0]! + f32(f32(v[1]! - v[0]!) * fx));   // z = 0: corners (0,0) (1,0)
    case ENGDET_BOX_BACK: return f32(v[3]! + f32(f32(v[2]! - v[3]!) * fx));    // z = 1: (0,1) (1,1)
    case ENGDET_BOX_RIGHT: return f32(v[1]! + f32(f32(v[2]! - v[1]!) * fz));   // x = 1: (1,0) (1,1)
    case ENGDET_BOX_LEFT: return f32(v[0]! + f32(f32(v[3]! - v[0]!) * fz));    // x = 0: (0,0) (0,1)
  }
  return 0;
}
