/*
  Traxx 1.8.0's engine detail maps (engine-detail.ts) with every CPU-side check of Traxx's own
  tools/detailtest.cpp (the engine handover section 4.6 vectors, pinned to 6098176, and
  tools/traxx_rules/detail_port.py), plus the pure parts of GLDetailMaps.cpp (the light texture,
  the mask diff and live paint) and the translated GLSL's text (render/engine-detail-glsl.ts).
  detailtest's GPU section (compile, link, evaluate on a float framebuffer) needs a GL context and
  does not run in node; its expectations are checked here against the CPU mirror of the shader.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  engineDetailBakedI, engineDetailCellI, engineDetailDefaultMaskByte, engineDetailFineL0, engineDetailGenerate, engineDetailLightKey,
  engineDetailLightTexture, engineDetailMaskDiff, engineDetailMaskRed, engineDetailPaintMask, engineDetailRamp, engineDetailRectUnion,
  engineDetailStrength, engineDetailSunUniform, engineDetailTerrainI, engineDetailTerrainIf, engineDetailVertexByte, engineDetailVertexI,
  engineDetailWaterAmp, engineDetailWaterLod, engineDetailWaterShade, ENGDET_MAP_FT, ENGDET_TERRDETAIL_DEFAULT,
} from "../src/core/view/engine-detail.ts";
import {
  buildEngineDetailShaders, ENGDET_GLSL_DEFINES, ENGDET_TERRAIN_FS, ENGDET_TERRAIN_UNIFORMS, ENGDET_VS, ENGDET_WATER_FS, ENGDET_WATER_UNIFORMS, glslFloat,
} from "../src/render/engine-detail-glsl.ts";

const near = (got: number, want: number, tol: number, what: string) => assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got} want ${want}`);
/** The handover prints 6 decimals: allow the rounding plus float error. */
const TOL6 = 2e-6;

test("4.6 strength z", () => {
  near(engineDetailStrength(10, 100, false), 0.1, TOL6, "terrDetail 10 (own mask)");
  near(engineDetailStrength(10, 200, true), 0.2, TOL6, "default mask + slider 200%");
  near(engineDetailStrength(10, 200, false), 0.1, TOL6, "own mask + slider 200% (slider ignored)");
  near(engineDetailStrength(25, 50, true), 0.125, TOL6, "terrDetail 25 + default + 50%");
  near(engineDetailStrength(10, 999, true), 0.3, TOL6, "slider 999% -> clamped to 300");
  near(engineDetailStrength(10, 0, true), 0.0, TOL6, "slider 0 -> 0 (block off)");
  near(engineDetailStrength(10, 100, false, 1), -0.1, TOL6, "debug 1 negates");
  near(engineDetailStrength(10, 100, false, 0, true), 0.0, TOL6, "mirror pass -> 0");
  // In float, as the C: (float)0.01 * (float)10 = 0.099999994, not (float)0.1.
  assert.equal(engineDetailStrength(ENGDET_TERRDETAIL_DEFAULT, 100, false), Math.fround(Math.fround(0.01) * 10), "the preview's z");
});

test("4.6 peak scale z * mDet at z 0.1", () => {
  const sun = [-0.6, -0.5, -0.3];
  const rows: [number, number][] = [[0, 0.1], [64, 0.200392], [128, 0.300784], [255, 0.5]];
  for (const [mk, want] of rows) near(0.1 * engineDetailTerrainI(0.8, 128, 128, 255, mk, sun, 0.1).mdet, want, TOL6, `mask ${mk}`);
});

const sunA = [-0.6, -0.5, -0.3], sunB = [-0.1, -0.95, -0.05];

test("4.6 full terrain term (6098176)", () => {
  const rows: { i: number; r: number; g: number; b: number; mask: number; sun: number[]; z: number; iout: number; dlit: number; aosub: number; name: string }[] = [
    { i: 0.8, r: 200, g: 128, b: 255, mask: 0, sun: sunA, z: 0.1, iout: 0.845977, dlit: 0.045977, aosub: 0.0, name: "0.8 (200,128) b255 mask0 A z.1" },
    { i: 0.8, r: 200, g: 128, b: 255, mask: 255, sun: sunA, z: 0.1, iout: 1.029885, dlit: 0.229885, aosub: 0.0, name: "0.8 (200,128) b255 mask255 A z.1" },
    { i: 0.8, r: 60, g: 200, b: 180, mask: 128, sun: sunA, z: 0.1, iout: 0.687517, dlit: -0.059404, aosub: 0.05308, name: "0.8 (60,200) b180 mask128 A z.1" },
    { i: 0.8, r: 200, g: 128, b: 255, mask: 0, sun: sunB, z: 0.1, iout: 0.828499, dlit: 0.028499, aosub: 0.0, name: "0.8 (200,128) b255 mask0 B z.1" },
    { i: 0.5, r: 0, g: 0, b: 0, mask: 255, sun: sunA, z: 0.1, iout: 0.2, dlit: 0.0, aosub: 0.3, name: "0.5 (0,0) degenerate b0 mask255 A z.1" },
    { i: 1.2, r: 255, g: 128, b: 255, mask: 255, sun: sunB, z: 0.2, iout: 1.2, dlit: 0.0, aosub: 0.0, name: "1.2 (255,128) degenerate mask255 B z.2" },
  ];
  for (const w of rows) {
    const t = engineDetailTerrainI(w.i, w.r, w.g, w.b, w.mask, w.sun, w.z);
    near(t.i, w.iout, TOL6, `i_out  ${w.name}`);
    near(t.dlit, w.dlit, TOL6, `dLit   ${w.name}`);
    near(t.aosub, w.aosub, TOL6, `AO sub ${w.name}`);
  }
  // detail_port.py's sixth case: a flat-ish texel under the high sun (by hand: 0.800294).
  near(engineDetailTerrainI(0.8, 128, 128, 255, 0, sunB, 0.1).i, 0.800294, TOL6, "i_out 0.8 (128,128) b255 mask0 B z.1 (by hand)");
  near(engineDetailTerrainI(0.73, 200, 60, 10, 255, sunA, 0.0).i, 0.73, 1e-7, "z 0 = block off, i unchanged");
  near(engineDetailTerrainI(0.5, 200, 128, 255, 0, sunA, -0.1).i, 4.0, 1e-7, "debug z < 0 paints 4.0");
  // Overhead: sunD = the diagonal, factor 0.5.
  const dx = (200.0 / 255.0 * 2.0 - 1.0) * 0.1, dy = (128.0 / 255.0 * 2.0 - 1.0) * 0.1;
  near(engineDetailTerrainI(0.8, 200, 128, 255, 0, [0, -1, 0], 0.1).i, 0.8 - (dx + dy) * 0.70710678 * 0.5, TOL6, "overhead sun: fixed diagonal at half strength");
  // The 0..1 form is the same function.
  assert.equal(engineDetailTerrainIf(0.8, 200 / 255, 128 / 255, 1, 0, sunA, 0.1), engineDetailTerrainI(0.8, 200, 128, 255, 0, sunA, 0.1).i);
});

test("ramp", () => {
  const tex = [0.5, 0.4, 0.2];
  let out = engineDetailRamp(tex, 0.5);
  near(out[0], 0.25, 1e-7, "ramp i 0.5 r");
  near(out[2], 0.1, 1e-7, "ramp i 0.5 b");
  out = engineDetailRamp(tex, 1.5);
  near(out[0], 0.75, 1e-7, "ramp i 1.5 r (half way to white)");
  near(out[2], 0.6, 1e-7, "ramp i 1.5 b");
  near(engineDetailRamp(tex, 2.5)[1], 1.0, 1e-7, "ramp i 2.5 = white");
});

test("4.6 default mask lum -> byte -> mDet", () => {
  const rows: [number, number, number][] = [[40, 64, 2.0039], [75, 64, 2.0039], [92, 45, 1.7059], [100, 37, 1.5804], [109, 27, 1.4235], [120, 11, 1.1725], [129, 1, 1.0157], [160, 0, 1.0], [255, 0, 1.0]];
  for (const [lum, byte, mdet] of rows) {
    const d = engineDetailDefaultMaskByte(lum);
    assert.equal(d.byte, byte, `lum ${lum} byte`);
    near(d.mdet, mdet, 5e-5, `lum ${lum} mDet`);
  }
});

test("4.6 water per-layer amplitude and 4.5 still body shade", () => {
  near(engineDetailWaterAmp(0, 1, 1, 100, true), 0.02, TOL6, "mask 0");
  near(engineDetailWaterAmp(255, 1, 1, 100, true), 0.1, TOL6, "mask 255");
  near(engineDetailWaterAmp(0, 1, 1, 300, true), 0.06, TOL6, "mask 0 + default + 300%");
  near(engineDetailWaterAmp(0, 1, 1, 300, false), 0.02, TOL6, "mask 0 + own mask + 300%");
  near(engineDetailWaterAmp(128, 1, 1, 50, true), 0.030078, TOL6, "mask 128 + default + 50%");

  const flat = [0.5, 0.5], tilt = [0.3, 0.2], hard = [0, 0];
  near(engineDetailWaterShade(flat, flat, 0, 1), 1.0, 1e-6, "flat texel -> 1");
  near(engineDetailWaterShade(tilt, tilt, 0, 1), 1.06912, 1e-6, "tilted, mask 0");
  near(engineDetailWaterShade(tilt, tilt, 1, 1), 1.3, 1e-6, "tilted, mask 255 (clamps at 1.3)");
  near(engineDetailWaterShade(hard, hard, 1, 0), 1.0, 1e-6, "lod 0 -> 1");
  near(engineDetailWaterLod(1), 1.0, 1e-6, "footprint 1 ft -> lod 1");
  near(engineDetailWaterLod(3.25), 0.5, 1e-6, "footprint 3.25 ft -> lod 0.5");
  near(engineDetailWaterLod(6), 0.0, 1e-6, "footprint 6 ft -> lod 0");
});

test("baked per-vertex intensity (li = l0 << 4, i = (li - 256) / 4080)", () => {
  near(engineDetailVertexI(255, 0, 32768), 3824 / 4080, 1e-6, ".LTE l0 255");
  near(engineDetailVertexI(16, 0, 32768), 0, 1e-7, ".LTE l0 16 -> 0");
  near(engineDetailVertexI(0, 0, 32768), 0, 1e-7, ".LTE l0 0 -> clamped 0");
  near(engineDetailVertexI(128, 0, 32768), (2048 - 256) / 4080, 1e-6, ".LTE l0 128");
  near(engineDetailVertexI(200, 1, 32768), 2048 / 4080, 1e-6, "shadow bit, ambient 32768 -> groundAmbient 2304");
  let bad = 0;
  for (let g = 0; g < 256; g++) if (engineDetailVertexByte(g, 0, 0) !== (g < 16 ? 0 : g - 16)) bad++;
  assert.equal(bad, 0, "8-bit light texel = l0 - 16 exactly, every l0");
});

test("intensity over a cell's triangle (the tiles' parity split)", () => {
  // Corners 0 (0,0) = 0.2, 1 (1,0) = 0.4, 2 (1,1) = 0.9, 3 (0,1) = 0.6.
  near(engineDetailCellI(0.2, 0.4, 0.9, 0.6, 1, 1, 0), 0.9, 1e-6, "even, corner 2");
  near(engineDetailCellI(0.2, 0.4, 0.9, 0.6, 0.5, 0.5, 0), 0.55, 1e-6, "even, centre = mean of 0 and 2");
  near(engineDetailCellI(0.2, 0.4, 0.9, 0.6, 0.25, 0.75, 0), 0.2 + 0.25 * 0.3 + 0.75 * 0.4, 1e-6, "even, (0.25, 0.75) in (0,3,2)");
  near(engineDetailCellI(0.2, 0.4, 0.9, 0.6, 0.5, 0.5, 1), 0.5, 1e-6, "odd, centre = mean of 1 and 3");
  near(engineDetailCellI(0.2, 0.4, 0.9, 0.6, 0, 0, 1), 0.2, 1e-6, "odd, corner 0");
  near(engineDetailCellI(0.2, 0.4, 0.9, 0.6, 0.75, 0.75, 1), 0.9 + 0.25 * -0.3 + 0.25 * -0.5, 1e-6, "odd, (0.75, 0.75) in (3,2,1)");
});

test("the generated detail map (_createTerrDetail11 / wdGenerate256)", () => {
  const a = engineDetailGenerate(true), b = engineDetailGenerate(true), w = engineDetailGenerate(false);
  assert.deepEqual(a, b, "deterministic (two runs identical)");
  let sr = 0, sg = 0, rgdiff = 0, wblue = 0;
  for (let k = 0; k < 65536; k++) {
    sr += a[k * 4]!;
    sg += a[k * 4 + 1]!;
    if (a[k * 4] !== w[k * 4] || a[k * 4 + 1] !== w[k * 4 + 1]) rgdiff++;
    if (w[k * 4 + 2] !== 255) wblue++;
  }
  assert.equal(rgdiff, 0, "water copy: same R, G as the terrain's");
  assert.equal(wblue, 0, "water copy: blue 255 (no AO)");
  near(sr / 65536, 127.5, 2.0, "mean R near 127.5 (zero-mean normal)");
  near(sg / 65536, 127.5, 2.0, "mean G near 127.5");
  assert.ok(a.every((v, k) => (k & 3) !== 3 || v === 255), "alpha 255");
});

/*
  Smooth terrain's 8 ft relight (Ground.cpp terrainFineShade at 5e0bfd6). Sun E (-46333, -46333, 0),
  ambient 32768. Flat ground's formula l0 = 218 (by hand in detailtest.cpp).
*/
test("smooth terrain: the 8 ft relight (terrainFineShade)", () => {
  const fy0 = new Int16Array(1024 * 1024).fill(1000);
  const y0 = new Int32Array(65536).fill(1000);
  const lte = new Uint8Array(65536).fill(200);
  const sun = [-46333, -46333, 0];
  let out = engineDetailFineL0(fy0, y0, lte, sun, 32768);
  assert.ok(out.every((v) => v === 200), "flat, .LTE 200: every 8 ft vertex 200");

  // One corner brighter: the .LTE offset is bilerped over the tile, x16 then rounded.
  lte[0 * 256 + 1] = 216;
  out = engineDetailFineL0(fy0, y0, lte, sun, 32768);
  assert.equal(out[0 * 1024 + 2], 208, "flat, corner (1,0) 216: fine (2,0) = 208");
  assert.equal(out[0 * 1024 + 1], 204, "flat, corner (1,0) 216: fine (1,0) = 204");
  assert.equal(out[0 * 1024 + 4], 216, "flat, corner (1,0) 216: fine (4,0) = 216");
  assert.equal(out[2 * 1024 + 2], 204, "flat, corner (1,0) 216: fine (2,2) = 204");
  // Round half away from zero on a NEGATIVE offset: s = -276, d = -((276 + 8) / 16) = -17 -> 201.
  lte[0 * 256 + 1] = 203;
  out = engineDetailFineL0(fy0, y0, lte, sun, 32768);
  assert.equal(out[0 * 1024 + 1], 201, "flat, corner (1,0) 203: fine (1,0) = 201 (rounding)");

  // A slope of 7 per 8 ft in +X with an engine-baked .LTE (218): every interior vertex 217.
  for (let z = 0; z < 1024; z++) for (let x = 0; x < 1024; x++) fy0[z * 1024 + x] = 1000 + 7 * x;
  for (let z = 0; z < 256; z++) {
    for (let x = 0; x < 256; x++) {
      y0[z * 256 + x] = fy0[4 * z * 1024 + 4 * x]!;
      lte[z * 256 + x] = 218;
    }
  }
  out = engineDetailFineL0(fy0, y0, lte, sun, 32768);
  let bad = 0;
  for (let z = 0; z < 1024; z++) for (let x = 8; x < 1000; x++) if (out[z * 1024 + x] !== 217) bad++;
  assert.equal(bad, 0, "slope 7 / 8 ft, engine-baked .LTE: every interior vertex 217");
});

test("the light texture (EnsureLightTex): classic .LTE corners and smooth terrain's relight", () => {
  const lte = new Uint8Array(65536 * 7);
  for (let k = 0; k < 65536; k++) lte[k * 7] = 100;
  lte[5 * 7] = 255;
  lte[6 * 7] = 255; lte[6 * 7 + 1] = 1; // shadow bit: groundAmbient
  const sun = [-46333, -46333, 0];
  const classic = engineDetailLightTexture({ lte, sun, ambient: 32768 });
  assert.equal(classic.n, 256);
  assert.equal(classic.data[0], 84, "l0 100 -> 84");
  assert.equal(classic.data[5], 239, "l0 255 -> 239");
  assert.equal(classic.data[6], engineDetailVertexByte(0, 1, 32768), "a shadow corner at groundAmbient");
  assert.equal(classic.data[6], 128);

  // Smooth: flat surface, .LTE 200: the relight is 200 everywhere, as a texel 184.
  const surface = new Uint16Array(1024 * 1024).fill(2000);
  const y0 = new Int32Array(65536).fill(1000);
  for (let k = 0; k < 65536; k++) lte[k * 7] = 200, lte[k * 7 + 1] = 0;
  const fine = engineDetailLightTexture({ lte, sun, ambient: 32768, surface, y0 });
  assert.equal(fine.n, 1024);
  assert.ok(fine.data.every((v) => v === 184), "every 8 ft texel 200 - 16");

  // The sun uniform and the rebuild key.
  assert.deepEqual(engineDetailSunUniform([0, 0, 0]), [0, -1, 0], "a zero vector: straight down");
  assert.deepEqual(engineDetailSunUniform([-46333, -46333, 0]), [-46333, -46333, 0]);
  assert.notEqual(engineDetailLightKey(1, 0, 0, sun, 32768), engineDetailLightKey(1, 0, 0, sun, 40960));
  assert.notEqual(engineDetailLightKey(1, 2, 0, sun, 32768), engineDetailLightKey(1, 2, 1, sun, 32768));
});

/*
  detailtest's GPU cases, evaluated against the shader's CPU mirror (bakedI on an 8-bit light
  texture). The float-texture GPU run itself needs a GL context and is not done here.
*/
test("bakedI on the CPU: the GPU section's cells, both parities, 256 and 1024", () => {
  const c = [0.2, 0.4, 0.9, 0.6];
  const cells = [
    { n: 256, cx: 10, cz: 20, fx: 0.25, fy: 0.75 }, { n: 256, cx: 10, cz: 20, fx: 0.7, fy: 0.2 },
    { n: 256, cx: 11, cz: 20, fx: 0.75, fy: 0.75 }, { n: 256, cx: 11, cz: 20, fx: 0.3, fy: 0.4 },
    { n: 1024, cx: 100, cz: 200, fx: 0.6, fy: 0.9 }, { n: 1024, cx: 101, cz: 200, fx: 0.8, fy: 0.6 },
  ];
  for (const e of cells) {
    const light = new Uint8Array(e.n * e.n);
    const q = c.map((v) => Math.round(v * 255));
    light[e.cz * e.n + e.cx] = q[0]!;
    light[e.cz * e.n + e.cx + 1] = q[1]!;
    light[(e.cz + 1) * e.n + e.cx + 1] = q[2]!;
    light[(e.cz + 1) * e.n + e.cx] = q[3]!;
    const cellFt = ENGDET_MAP_FT / e.n;
    const want = engineDetailCellI(q[0]! / 255, q[1]! / 255, q[2]! / 255, q[3]! / 255, e.fx, e.fy, (e.cx + e.cz) & 1);
    near(engineDetailBakedI(light, e.n, (e.cx + e.fx) * cellFt, (e.cz + e.fy) * cellFt), want, 1e-5, `bakedI ${e.n} cell (${e.cx},${e.cz})`);
  }
});

test("the mask: red channel, diff rectangle, live paint", () => {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let k = 0; k < 16; k++) rgba.set([k * 10, 1, 2, 255], k * 4);
  const red = engineDetailMaskRed(rgba, 4, 4);
  assert.deepEqual([...red], Array.from({ length: 16 }, (_, k) => k * 10), "red only");
  const next = red.slice();
  next[1 * 4 + 2] = 99;
  next[3 * 4 + 1] = 98;
  assert.deepEqual(engineDetailMaskDiff(red, next, 4, 4), { x0: 1, y0: 1, x1: 3, y1: 4 });
  assert.equal(engineDetailMaskDiff(red, red.slice(), 4, 4), null, "unchanged: nothing to upload");
  assert.deepEqual(engineDetailRectUnion({ x0: 0, y0: 0, x1: 1, y1: 1 }, { x0: 2, y0: 3, x1: 4, y1: 4 }), { x0: 0, y0: 0, x1: 4, y1: 4 });
  assert.deepEqual(engineDetailRectUnion(null, { x0: 1, y0: 1, x1: 2, y1: 2 }), { x0: 1, y0: 1, x1: 2, y1: 2 });

  const mask = new Uint8Array(16);
  const brush = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]); // 3 x 3, stride 3
  assert.deepEqual(engineDetailPaintMask(mask, 4, 4, -1, -1, 3, 3, brush, 3), { x0: 0, y0: 0, x1: 2, y1: 2 }, "clipped at the top-left");
  assert.deepEqual([...mask.subarray(0, 2)], [5, 6]);
  assert.deepEqual([...mask.subarray(4, 6)], [8, 9]);
  assert.deepEqual(engineDetailPaintMask(mask, 4, 4, 3, 3, 3, 3, brush, 3), { x0: 3, y0: 3, x1: 4, y1: 4 }, "clipped at the bottom-right");
  assert.equal(mask[15], 1);
  assert.equal(engineDetailPaintMask(mask, 4, 4, 5, 0, 3, 3, brush, 3), null, "outside");
});

test("the translated GLSL: one set of numbers, every uniform present, no GLSL 1.10 built-ins", () => {
  assert.equal(glslFloat(4), "4.0");
  assert.equal(glslFloat(0.26953125), "0.26953125");
  assert.match(ENGDET_GLSL_DEFINES, /#define MASK_SPAN 4\.0\n/);
  assert.match(ENGDET_GLSL_DEFINES, /#define MAP_TILES 256\.0\n/);
  assert.match(ENGDET_GLSL_DEFINES, /#define DIAG 0\.70710678\n/);
  assert.match(buildEngineDetailShaders(512).terrainFs, /#define MAP_TILES 512\.0\n/);
  // Every define value is a float literal.
  for (const line of ENGDET_GLSL_DEFINES.trim().split("\n")) assert.match(line, /^#define [A-Z_]+ -?\d+\.\d+$/, line);
  for (const u of ENGDET_TERRAIN_UNIFORMS) assert.ok((ENGDET_VS + ENGDET_TERRAIN_FS).includes(`uniform `) && new RegExp(`uniform \\w+\\s+${u};`).test(ENGDET_VS + ENGDET_TERRAIN_FS), `terrain uniform ${u}`);
  for (const u of ENGDET_WATER_UNIFORMS) assert.ok(new RegExp(`uniform \\w+\\s+${u};`).test(ENGDET_VS + ENGDET_WATER_FS), `water uniform ${u}`);
  for (const src of [ENGDET_VS, ENGDET_TERRAIN_FS, ENGDET_WATER_FS]) {
    assert.doesNotMatch(src, /#version|gl_ModelViewMatrix|gl_Vertex|gl_Color|gl_MultiTexCoord|gl_TextureMatrix|gl_ClipVertex|ftransform|texture2D/);
    let depth = 0;
    for (const ch of src) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
    assert.equal(depth, 0, "braces balance");
  }
});
