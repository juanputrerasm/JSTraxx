/*
  The GLSL of the 3D view's detail-map look (Traxx 1.8.0, b6d56f2: Traxx/EngineDetailGLSL.h, bound by
  Traxx/GLDetailMaps.cpp), translated for a THREE.ShaderMaterial on WebGL2. The maths is
  core/view/engine-detail.ts (tests/engine-detail.test.ts) and the constants come from there, so the
  shader and the CPU port share one set of numbers, as ENGDET_GLSL_DEFINES does in Traxx.

  Use: new THREE.ShaderMaterial({ vertexShader: ENGDET_VS, fragmentShader: ENGDET_TERRAIN_FS (or
  ENGDET_WATER_FS), uniforms, vertexColors: true }) with the default glslVersion: three.js compiles
  it as GLSL ES 3.00 and its prefix maps varying, texture2D and gl_FragColor, and declares
  position, uv, color, modelMatrix, viewMatrix, projectionMatrix. The pieces (ENGDET_GLSL_DEFINES,
  ENGDET_GLSL_BAKED_I, ENGDET_GLSL_TERR_DETAIL_I, ENGDET_GLSL_WATER_SHADE) are also exported on
  their own, written with texture() so they also drop into a RawShaderMaterial in GLSL3 (the
  terrain's own shader in render/terrain.ts samples a texture array, not one uTex).

  TRANSLATION CHANGES (the maths is line for line; only these differ from Traxx's GLSL 1.10):
    1. No "#version 110": three.js supplies "#version 300 es" and the precision line.
    2. Every texture2D(...) is texture(...) (the GLSL ES 3.00 name; three's prefix would map
       texture2D too, but a raw GLSL3 shader would not).
    3. The defines are written from engine-detail.ts with a decimal point on every value (C's
       stringised literals were already floats: "4.0", "0.5"); a JavaScript number prints 4 as "4",
       which GLSL would read as an int.
    4. The vertex shader: Traxx rebuilt world feet from the eye-space position through the inverse
       terrain camera (uEyeToModel, uEyeOrg) because its tile lists carry model coordinates relative
       to the window's grid origin. three.js gives modelMatrix, and JSTraxx's terrain positions are
       world units (64 a 32 ft cell; the world-wrap border copies are the same geometry moved by
       their object position), so vWorldFt = (modelMatrix * position).xy * uFtPerUnit + uGridFt
       (uFtPerUnit = 0.5 for JSTraxx, uGridFt = 0). uEyeToModel and uEyeOrg are gone.
    5. gl_Color, gl_MultiTexCoord0 and gl_TextureMatrix[0] become three's color and uv attributes
       (vCol, vUv); color is vec4 with USE_COLOR_ALPHA (a 4-component colour attribute), vec3
       otherwise, and white when the material has no vertex colours. gl_ClipVertex (the
       world-wrap border's user clip planes) has no WebGL counterpart: trim the border copies by
       geometry, or use three's clippingPlanes (which a ShaderMaterial gets with clipping: true and
       the clipping chunks), as render/terrain.ts does its own way. ftransform() becomes
       projectionMatrix * viewMatrix * world.
    6. dFdx / dFdy (water) are core in GLSL ES 3.00; Traxx's GLSL 1.10 had them too.
    7. MAP_TILES is a parameter of buildEngineDetailShaders (Traxx: 256) so a version 6 world of
       512 cells can map its light texture and border over 512 tiles; the default build is Traxx's.
    8. The water fragment's body (Traxx wrote it inline in main) is the function waterShade, and
       the world-wrap border tint (inline twice) is the function borderTint, so the pieces can be
       spliced into another shader. Same statements, same order.

  Uniforms (terrain): uTex (the tile's own texture, unit 0 in Traxx), uDet (_DTL or the generated
  map), uMask (_MASK, red), uLight (the baked intensities), uDetStr, uDetRepFt, uMapFt, uSun, uLook,
  uWash, uLightN, uFtPerUnit, uGridFt. Uniforms (water): uWDet, uWMask, uMapFt, uLook, uWash, uFtPerUnit, uGridFt.
*/
import {
  ENGDET_AO_K, ENGDET_BORDER_B, ENGDET_BORDER_G, ENGDET_BORDER_R, ENGDET_BORDER_W, ENGDET_DIAG, ENGDET_DLIT_CLAMP, ENGDET_MAP_TILES,
  ENGDET_MASK_SPAN, ENGDET_SUNH_EPS, ENGDET_SUNH_FLOOR, ENGDET_TILE_FT, ENGDET_WASH_B, ENGDET_WASH_G, ENGDET_WASH_R, ENGDET_WATER_AMP,
  ENGDET_WATER_LOD_HI, ENGDET_WATER_LOD_LO, ENGDET_WATER_SCALE_A, ENGDET_WATER_SCALE_B, ENGDET_WATER_SHADE_DX, ENGDET_WATER_SHADE_DY,
  ENGDET_WATER_SHADE_HI, ENGDET_WATER_SHADE_K, ENGDET_WATER_SHADE_LO, ENGDET_UNTEX_S, ENGDET_WWASH_B, ENGDET_WWASH_G, ENGDET_WWASH_K, ENGDET_WWASH_R,
} from "../core/view/engine-detail.ts";

/** A GLSL float literal: always with a decimal point (translation change 3). */
export function glslFloat(v: number): string {
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/** ENGDET_GLSL_DEFINES: the constants as GLSL #defines, for a map of `mapTiles` tiles. */
export function engineDetailGlslDefines(mapTiles = ENGDET_MAP_TILES): string {
  const defs: [string, number][] = [
    ["MASK_SPAN", ENGDET_MASK_SPAN], ["AO_K", ENGDET_AO_K], ["DLIT_CLAMP", ENGDET_DLIT_CLAMP], ["SUNH_FLOOR", ENGDET_SUNH_FLOOR],
    ["SUNH_EPS", ENGDET_SUNH_EPS], ["DIAG", ENGDET_DIAG], ["TILE_FT", ENGDET_TILE_FT], ["MAP_TILES", mapTiles],
    ["WATER_AMP", ENGDET_WATER_AMP], ["WATER_SCALE_A", ENGDET_WATER_SCALE_A], ["WATER_SCALE_B", ENGDET_WATER_SCALE_B],
    ["WATER_LOD_LO", ENGDET_WATER_LOD_LO], ["WATER_LOD_HI", ENGDET_WATER_LOD_HI], ["WATER_SHADE_K", ENGDET_WATER_SHADE_K],
    ["WATER_SHADE_DX", ENGDET_WATER_SHADE_DX], ["WATER_SHADE_DY", ENGDET_WATER_SHADE_DY], ["WATER_SHADE_LO", ENGDET_WATER_SHADE_LO],
    ["WATER_SHADE_HI", ENGDET_WATER_SHADE_HI], ["WASH_R", ENGDET_WASH_R], ["WASH_G", ENGDET_WASH_G], ["WASH_B", ENGDET_WASH_B],
    ["BORDER_R", ENGDET_BORDER_R], ["BORDER_G", ENGDET_BORDER_G], ["BORDER_B", ENGDET_BORDER_B], ["BORDER_W", ENGDET_BORDER_W],
    // Traxx 1.8.1 (EngineDetail.h ENGDET_GLSL_DEFINES): the untextured mark and the water strength wash.
    ["UNTEX_S", ENGDET_UNTEX_S], ["WWASH_R", ENGDET_WWASH_R], ["WWASH_G", ENGDET_WWASH_G], ["WWASH_B", ENGDET_WWASH_B], ["WWASH_K", ENGDET_WWASH_K],
  ];
  return defs.map(([n, v]) => `#define ${n} ${glslFloat(v)}\n`).join("");
}

/** Traxx's ENGDET_GLSL_DEFINES (MAP_TILES 256). */
export const ENGDET_GLSL_DEFINES = engineDetailGlslDefines();

/**
  bakedI: the baked intensity at world feet wFt, interpolated over the cell's TRIANGLE with the
  tiles' parity split (engine-detail.ts engineDetailCellI / engineDetailBakedI). Needs
  uniform sampler2D uLight (NEAREST, REPEAT) and uniform float uLightN.
*/
export const ENGDET_GLSL_BAKED_I = `float bakedI(vec2 wFt)
{
    vec2 g = wFt * (uLightN / (TILE_FT * MAP_TILES));
    vec2 c = floor(g);
    vec2 f = g - c;
    float s = 1.0 / uLightN;
    vec2 t0 = (c + 0.5) * s;
    float c0 = texture(uLight, t0).r;
    float c1 = texture(uLight, t0 + vec2(s, 0.0)).r;
    float c2 = texture(uLight, t0 + vec2(s, s)).r;
    float c3 = texture(uLight, t0 + vec2(0.0, s)).r;
    if (mod(c.x + c.y, 2.0) < 0.5) {
        if (f.y > f.x) return c0 + f.x * (c2 - c3) + f.y * (c3 - c0);
        return c0 + f.x * (c1 - c0) + f.y * (c2 - c1);
    }
    if (f.x + f.y <= 1.0) return c0 + f.x * (c1 - c0) + f.y * (c3 - c0);
    return c2 + (1.0 - f.x) * (c3 - c2) + (1.0 - f.y) * (c1 - c2);
}
`;

/**
  Handover 4.4 terrDetailI (engine-detail.ts engineDetailTerrainIf), the two samples taken by the
  caller outside any branch. Needs uniform float uDetStr, uMapFt and uniform vec3 uSun.
*/
export const ENGDET_GLSL_TERR_DETAIL_I = `float terrDetailI(float i, vec4 dt, float mk)
{
    if (uDetStr == 0.0 || uMapFt == 0.0) return i;
    vec2 dn = dt.rg * 2.0 - 1.0;
    if (sqrt(clamp(1.0 - dot(dn, dn), 0.0, 1.0)) <= 0.0) dn = vec2(0.0);
    float mDet = 1.0 + MASK_SPAN * mk;
    dn *= mDet * abs(uDetStr);
    i = max(0.0, i - AO_K * abs(uDetStr) * mDet * (1.0 - dt.b));
    vec3 L = normalize(uSun);
    float sunH = length(L.xz);
    vec2 sunD = (sunH > SUNH_EPS) ? L.xz / sunH : vec2(DIAG);
    i = max(0.0, i + clamp(-dot(dn, sunD) * mix(SUNH_FLOOR, 1.0, sunH), -DLIT_CLAMP, DLIT_CLAMP));
    if (uDetStr < 0.0) i = 4.0;
    return i;
}
`;

/**
  The water's still body shade (handover 4.5; engine-detail.ts engineDetailWaterShade with the
  footprint fade engineDetailWaterLod), as a function of world feet. Needs uniform sampler2D
  uWDet, uWMask and uniform float uMapFt. Fragment stage only (dFdx / dFdy).
*/
export const ENGDET_GLSL_WATER_SHADE = `float waterShade(vec2 wFt)
{
    vec2 uv = wFt / TILE_FT;
    vec2 dxu = dFdx(uv);
    vec2 dyu = dFdy(uv);
    float pxFt = max(length(dxu), length(dyu)) * TILE_FT;
    float lod = 1.0 - smoothstep(WATER_LOD_LO, WATER_LOD_HI, pxFt);
    float mk = texture(uWMask, wFt / max(uMapFt, 1.0)).r;
    vec2 nA = texture(uWDet, uv * WATER_SCALE_A).rg * 2.0 - 1.0;
    vec2 nB = texture(uWDet, uv * WATER_SCALE_B).rg * 2.0 - 1.0;
    vec2 sDet = -(nA + nB) * (WATER_AMP * (1.0 + MASK_SPAN * mk) * lod);
    return clamp(1.0 + WATER_SHADE_K * dot(sDet, vec2(WATER_SHADE_DX, WATER_SHADE_DY)),
        WATER_SHADE_LO, WATER_SHADE_HI);
}
`;

/**
  Traxx 1.8.1 (EngineDetailGLSL.h boxI, EngineDetail.cpp EngineDetailBoxI): a ground box's baked
  light at world feet wFt on face `face` (ENGDET_BOX_*: 0 FRONT -Z, 1 BACK +Z, 2 RIGHT +X, 3 LEFT
  -X, 4 TOP, 5 BOTTOM) of the box on tile `cell`. The corners' .LTE i (.r) and shadow bit (.g) at
  the box's tile; on smooth terrain the corner is the 8 ft vertex at (4x, 4z), as the engine's
  groundArray l0 is. Needs uniform sampler2D uLight, float uLightN, vec4 uBoxSideI, float uBoxBottomI.
  TRANSLATION CHANGE: Traxx finds the face from the derivative normal of (world X, Z, height) and
  tells top from bottom by the model height against uBoxZMid; the JSTraxx box mesh carries each
  face's number as an attribute (core/view/ground-box-geometry.ts faceOf), so it is passed in.
*/
export const ENGDET_GLSL_BOX_I = `float boxSide(vec4 l, float facei) { return (l.g > 0.5) ? l.r : facei; }
float boxI(vec2 wFt, vec2 cell, float face)
{
    vec2 f = clamp(wFt / TILE_FT - cell, 0.0, 1.0);
    float k = uLightN / MAP_TILES;
    float s = 1.0 / uLightN;
    vec2 t0 = (cell * k + 0.5) * s;
    vec4 l0 = texture(uLight, t0);
    vec4 l1 = texture(uLight, t0 + vec2(k * s, 0.0));
    vec4 l2 = texture(uLight, t0 + vec2(k * s, k * s));
    vec4 l3 = texture(uLight, t0 + vec2(0.0, k * s));
    if (face > 3.5) {
        float c0, c1, c2, c3;
        if (face < 4.5) { c0 = l0.r; c1 = l1.r; c2 = l2.r; c3 = l3.r; }
        else { c0 = boxSide(l0, uBoxBottomI); c1 = boxSide(l1, uBoxBottomI);
               c2 = boxSide(l2, uBoxBottomI); c3 = boxSide(l3, uBoxBottomI); }
        if (f.y > f.x) return c0 + f.x * (c2 - c3) + f.y * (c3 - c0);
        return c0 + f.x * (c1 - c0) + f.y * (c2 - c1);
    }
    if (face < 0.5) return mix(boxSide(l0, uBoxSideI.x), boxSide(l1, uBoxSideI.x), f.x);
    if (face < 1.5) return mix(boxSide(l3, uBoxSideI.y), boxSide(l2, uBoxSideI.y), f.x);
    if (face < 2.5) return mix(boxSide(l1, uBoxSideI.z), boxSide(l2, uBoxSideI.z), f.y);
    return mix(boxSide(l0, uBoxSideI.w), boxSide(l3, uBoxSideI.w), f.y);
}
`;

/**
  Traxx 1.8.1 View > Show Water Strength on the water (g_EngDetWaterFS's uWash branch,
  EngineDetailWaterWash): rgb toward orange by WWASH_K * (1 + 4 mk) / 5, mk the _WMSK red at wFt.
  Needs uniform sampler2D uWMask and uniform float uMapFt.
*/
export const ENGDET_GLSL_WATER_WASH = `vec3 waterWash(vec3 rgb, vec2 wFt)
{
    float mk = texture(uWMask, wFt / max(uMapFt, 1.0)).r;
    return mix(rgb, vec3(WWASH_R, WWASH_G, WWASH_B), WWASH_K * (1.0 + MASK_SPAN * mk) / (1.0 + MASK_SPAN));
}
`;

/** The world-wrap border's tint, for a colour at world feet wFt. */
export const ENGDET_GLSL_BORDER = `vec3 borderTint(vec3 rgb, vec2 wFt)
{
    float mapFt = TILE_FT * MAP_TILES;
    if (wFt.x < -0.01 || wFt.y < -0.01 || wFt.x > mapFt + 0.01 || wFt.y > mapFt + 0.01)
        rgb = mix(rgb, vec3(BORDER_R, BORDER_G, BORDER_B), BORDER_W);
    return rgb;
}
`;

/** The three shaders for a map of `mapTiles` tiles (translation change 7). */
export function buildEngineDetailShaders(mapTiles = ENGDET_MAP_TILES): { vs: string; terrainFs: string; waterFs: string } {
  const defines = engineDetailGlslDefines(mapTiles);

  // Shared by both programs (g_EngDetVS).
  const vs = `${defines}uniform float uFtPerUnit;
uniform vec2 uGridFt;
varying vec2 vWorldFt;
varying vec4 vCol;
varying vec2 vUv;
void main()
{
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldFt = world.xy * uFtPerUnit + uGridFt;
#if defined( USE_COLOR_ALPHA )
    vCol = color;
#elif defined( USE_COLOR )
    vCol = vec4(color, 1.0);
#else
    vCol = vec4(1.0);
#endif
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

  // g_EngDetTerrainFS.
  const terrainFs = `${defines}uniform sampler2D uTex;
uniform sampler2D uDet;
uniform sampler2D uMask;
uniform sampler2D uLight;
uniform float uDetStr;
uniform float uDetRepFt;
uniform float uMapFt;
uniform vec3  uSun;
uniform float uLook;
uniform float uWash;
uniform float uLightN;
varying vec2 vWorldFt;
varying vec4 vCol;
varying vec2 vUv;
${ENGDET_GLSL_BAKED_I}${ENGDET_GLSL_TERR_DETAIL_I}${ENGDET_GLSL_BORDER}void main()
{
    vec4 tex = texture(uTex, vUv);
    vec4 dt  = texture(uDet, vWorldFt / uDetRepFt);
    float mk = (uMapFt > 0.0) ? texture(uMask, vWorldFt / max(uMapFt, 1.0)).r : 0.0;
    bool textured = all(greaterThanEqual(vCol.rgb, vec3(0.999)));
    vec3 rgb = textured ? tex.rgb : vCol.rgb;
    float a = textured ? tex.a : vCol.a;
    if (textured && uLook > 0.5) {
        float i = terrDetailI(bakedI(vWorldFt), dt, mk);
        rgb = (i <= 1.0) ? tex.rgb * i : mix(tex.rgb, vec3(1.0), clamp(i - 1.0, 0.0, 1.0));
    }
    if (textured && uWash > 0.5 && uMapFt > 0.0) {
        float t = (1.0 + MASK_SPAN * mk) / (1.0 + MASK_SPAN);
        rgb *= vec3(1.0) - vec3(WASH_R, WASH_G, WASH_B) * t;
    }
    rgb = borderTint(rgb, vWorldFt);
    gl_FragColor = vec4(rgb, a);
}
`;

  // g_EngDetWaterFS: the still-preview body shade (t = 0, no waves, watt = 1) times the water's own colour, alpha kept.
  // Traxx 1.8.1: uLook = the still body shade (Show Detail Maps), uWash = the water strength wash (Show Water Strength).
  const waterFs = `${defines}uniform sampler2D uWDet;
uniform sampler2D uWMask;
uniform float uMapFt;
uniform float uLook;
uniform float uWash;
varying vec2 vWorldFt;
varying vec4 vCol;
${ENGDET_GLSL_WATER_SHADE}${ENGDET_GLSL_WATER_WASH}${ENGDET_GLSL_BORDER}void main()
{
    // uv, not the engine's uv wrapped to 256 tiles: both layers repeat a whole number of times over
    // the world (128 and 69), so the sample is the same, and unwrapped uv keeps the derivatives seamless.
    float shade = waterShade(vWorldFt);
    vec3 rgb = vCol.rgb * ((uLook > 0.5) ? shade : 1.0);
    if (uWash > 0.5) rgb = waterWash(rgb, vWorldFt);
    rgb = borderTint(rgb, vWorldFt);
    gl_FragColor = vec4(rgb, vCol.a);
}
`;
  return { vs, terrainFs, waterFs };
}

const traxx = buildEngineDetailShaders();
/** g_EngDetVS, translated. */
export const ENGDET_VS = traxx.vs;
/** g_EngDetTerrainFS, translated. */
export const ENGDET_TERRAIN_FS = traxx.terrainFs;
/** g_EngDetWaterFS, translated. */
export const ENGDET_WATER_FS = traxx.waterFs;

/** Every uniform GLDetailMaps.cpp sets on each program (detailtest's "every uniform is active" list, after translation change 4). */
export const ENGDET_TERRAIN_UNIFORMS = ["uFtPerUnit", "uGridFt", "uTex", "uDet", "uMask", "uLight", "uDetStr", "uDetRepFt", "uMapFt", "uSun", "uLook", "uWash", "uLightN"] as const;
export const ENGDET_WATER_UNIFORMS = ["uFtPerUnit", "uGridFt", "uWDet", "uWMask", "uMapFt", "uLook", "uWash"] as const;
