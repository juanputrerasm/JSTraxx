/*
  The water (COpenGLTerrainRenderer::DrawWaterTiled, DrawWaterFill), at ALTITUDESCALE x the
  level in quarter steps / 4:

    - the line grid: the outline of every cell whose four corners are all under the water, in
      palette entry 252;
    - the see-through fill: a quad over every cell with any corner under it, (30, 100, 200) at
      the Options > Advanced opacity, drawn after the objects, depth-tested but not written.

  Both are clipped to the grid window like the terrain.

  Traxx 1.7.1 (7307bc1, 45727cb): the water reaches the real seam (cell 255 takes its +1 corner
  from column / row 0), and the world-wrap border shows it again past each edge, 3 cells deep,
  tinted as the terrain's border (0.35 of (0.70, 0.80, 0.95)), keeping the water's alpha. The
  lakes do the same: cell 255 is drawn and the border cells copy the lake cells across the seam.

  Traxx 1.7.3 (165df9e, 22cad2a, a28fe7d, 71a93b8): under the lakes' EDGE rule Show Lake Walls draws
  the lake's own wall EDGES at the waterline (notch edges, the waterfall spillways, in cyan); under
  the TILE rule the ring of wall tiles as before. Where a leaking lake's water gets out is a yellow
  post with an X across the tile, and the ground exactly at a lake's height orange posts, both drawn
  without the depth test.
*/
import * as THREE from "three";
import { ENGDET_GLSL_WATER_SHADE, ENGDET_GLSL_WATER_WASH, engineDetailGlslDefines } from "./engine-detail-glsl.ts";
import { ALTITUDE_SCALE } from "../core/view/camera.ts";
import { SURFACE_WRAP_BORDER_CELLS, WRAP_BORDER_TINT, WRAP_BORDER_TINT_WEIGHT } from "../core/view/surface-tiles.ts";
import { sideOf } from "../core/traxx/world.ts";
import { LAKE_DIR_E, LAKE_DIR_N, LAKE_DIR_S, LAKE_DIR_W, LAKE_MAX_AT, LAKE_RULE_EDGE, type LakeNotchEdge } from "../core/traxx/lake-ground.ts";
import type { LakeState } from "../core/traxx/lakes.ts";

/*
  The cells a water or lake picture covers: the map and the world-wrap border round it. Track
  format version 6 (8.1): the map is N x N, N the side of the grid drawn (256 for every Traxx track).
*/
const BAND_LO = -SURFACE_WRAP_BORDER_CELLS;
const bandHi = (n: number) => n + SURFACE_WRAP_BORDER_CELLS;
const gridSide = (length: number) => (length === 65536 ? 256 : sideOf(length));
const BORDER_GLSL = `vec3(${WRAP_BORDER_TINT.map((v) => v.toFixed(2)).join(", ")})`;
const BORDER_WEIGHT_GLSL = WRAP_BORDER_TINT_WEIGHT.toFixed(2);

/** Is cell (i, j) of the band in the border (off the map)? */
function inBorder(i: number, j: number, n = 256): boolean {
  return i < 0 || j < 0 || i > n - 1 || j > n - 1;
}

/* The water detail uniforms (off until setDetail gives the track's _WDTL / _WMSK). */
function detailUniforms(): Record<string, THREE.IUniform> {
  return { detailOn: { value: false }, uWDet: { value: null }, uWMask: { value: null }, uMapFt: { value: 8192 }, uLook: { value: 0 }, uWash: { value: 0 } };
}
/** The engine-detail defines for Traxx's 256-tile map (MAP_TILES is not read by the water shade). */
const ENGDET_DEFINES = engineDetailGlslDefines();

/**
  The water detail program on a material (GLDetailBeginWater): look = the still body shade (View >
  Show Detail Maps), wash = Traxx 1.8.1's per-texel water strength wash (View > Show Water
  Strength). null, or neither: off (no _WMSK, no water detail: the mask is the switch).
*/
export function setWaterDetail(m: THREE.RawShaderMaterial, d: { det: THREE.Texture; mask: THREE.Texture } | null, mapFt: number, look = true, wash = false): void {
  const u = m.uniforms;
  u.detailOn!.value = Boolean(d) && (look || wash);
  u.uLook!.value = look ? 1 : 0;
  u.uWash!.value = wash ? 1 : 0;
  u.uWDet!.value = d?.det ?? null;
  u.uWMask!.value = d?.mask ?? null;
  u.uMapFt!.value = mapFt;
}

const vertexShader = /* glsl */ `
  in vec3 position;
  in vec3 cell;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  flat out vec3 vCell;
  out vec2 vWorldFt;
  void main() { vWorldFt = position.xy * 0.5; vCell = cell; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform vec4 window;
  uniform vec3 colour;
  uniform float opacity;
  flat in vec3 vCell;    // the cell where it is drawn, and 1 in the world-wrap border
  out vec4 outColor;
  // Traxx 1.8.0 (b6d56f2) View > Show Detail Maps: the water's still body shade (g_EngDetWaterFS).
  uniform bool detailOn;
  uniform sampler2D uWDet;
  uniform sampler2D uWMask;
  uniform float uMapFt;
  uniform float uLook;
  uniform float uWash;
  in vec2 vWorldFt;
${ENGDET_DEFINES}${ENGDET_GLSL_WATER_SHADE}${ENGDET_GLSL_WATER_WASH}  void main() {
    if (vCell.x < window.x || vCell.y < window.y || vCell.x >= window.z || vCell.y >= window.w) discard;
    float shade = detailOn ? waterShade(vWorldFt) : 1.0;
    vec3 c = colour * (uLook > 0.5 ? shade : 1.0);
    // Traxx 1.8.1 View > Show Water Strength (g_EngDetWaterFS uWash): per texel, toward orange.
    if (detailOn && uWash > 0.5) c = waterWash(c, vWorldFt);
    c = vCell.z > 0.5 ? mix(c, ${BORDER_GLSL}, ${BORDER_WEIGHT_GLSL}) : c;
    outColor = vec4(c, opacity);
  }
`;

function windowed(colour: THREE.Color, opacity: number, transparent: boolean): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader, fragmentShader, transparent, depthWrite: !transparent,
    side: THREE.DoubleSide,
    uniforms: { window: { value: new THREE.Vector4(0, 0, 256, 256) }, colour: { value: colour }, opacity: { value: opacity }, ...detailUniforms() },
  });
}

export class WaterLayer {
  readonly group = new THREE.Group();
  readonly lineMaterial = windowed(new THREE.Color(0, 0, 1), 1, false);
  readonly fillMaterial = windowed(new THREE.Color(30 / 255, 100 / 255, 200 / 255), 0.5, true);
  private lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMaterial);
  private fill = new THREE.Mesh(new THREE.BufferGeometry(), this.fillMaterial);

  constructor() {
    this.fill.renderOrder = 10;
    this.lines.frustumCulled = this.fill.frustumCulled = false;
    this.group.add(this.lines, this.fill);
  }

  /**
    `surface`: a 16-bit track's tile minima and maxima in u (tileMinMaxU), which decide the two
    pictures instead of the 8-bit corners (SurfaceWaterGridWet, SurfaceWaterFillWet).
  */
  rebuild(heights: Uint8Array, level4: number, surface: { min: Int32Array; max: Int32Array } | null = null): void {
    const z = (ALTITUDE_SCALE * level4) / 4;
    const lp: number[] = [], lc: number[] = [], fp: number[] = [], fc: number[] = [];
    const n = gridSide(heights.length), m = n - 1, hi = bandHi(n);
    // 0 is no water; no track's water is below 0 ft, so this is Traxx's "> 0".
    if (level4 !== 0) {
      for (let j = BAND_LO; j < hi; j++) {
        for (let i = BAND_LO; i < hi; i++) {
          // The source cell (& (N - 1)) and its +1 corners, wrapped.
          const si = i & m, sj = j & m, si1 = (si + 1) & m, sj1 = (sj + 1) & m, b = inBorder(i, j, n) ? 1 : 0;
          const under = [heights[si + sj * n], heights[si1 + sj * n], heights[si1 + sj1 * n], heights[si + sj1 * n]].map((h) => 4 * h! < level4);
          const x0 = i * 64, y0 = j * 64, x1 = x0 + 64, y1 = y0 + 64;
          const all = surface ? surface.max[si + sj * n]! < 32 * level4 : under.every(Boolean);
          const any = surface ? surface.min[si + sj * n]! <= 32 * level4 : under.some(Boolean);
          if (all) {
            lp.push(x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z);
            for (let k = 0; k < 8; k++) lc.push(i, j, b);
          }
          if (any) {
            fp.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z);
            for (let k = 0; k < 6; k++) fc.push(i, j, b);
          }
        }
      }
    }
    const set = (obj: THREE.LineSegments | THREE.Mesh, p: number[], c: number[]) => {
      obj.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute("cell", new THREE.Float32BufferAttribute(c, 3));
      obj.geometry = g;
    };
    set(this.lines, lp, lc);
    set(this.fill, fp, fc);
  }

  setWindow(w: THREE.Vector4): void {
    this.lineMaterial.uniforms.window.value.copy(w);
    this.fillMaterial.uniforms.window.value.copy(w);
  }

  /** Line colour: palette entry 252 with the gamma; fill opacity in percent; no fill over a wire frame. */
  /** Traxx 1.8.0 Show Detail Maps: the fill's still body shade from _WDTL / _WMSK, or null for none. */
  setDetail(d: { det: THREE.Texture; mask: THREE.Texture } | null, mapFt: number, look = true, wash = false): void {
    setWaterDetail(this.fillMaterial, d, mapFt, look, wash);
  }

  setLook(lineRgb: [number, number, number], opacity: number, fill: boolean): void {
    this.lineMaterial.uniforms.colour.value.setRGB(lineRgb[0] / 255, lineRgb[1] / 255, lineRgb[2] / 255);
    this.fillMaterial.uniforms.opacity.value = Math.round((Math.min(100, opacity) * 255 + 50) / 100) / 255;
    this.fill.visible = fill && opacity > 0;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.fill.geometry.dispose();
    this.lineMaterial.dispose();
    this.fillMaterial.dispose();
  }
}

/** The six lake tints (OpenGLTerrainRenderer.cpp lakeTint); a lake in error is drawn magenta. */
const LAKE_TINT: [number, number, number][] = [[30, 100, 200], [0, 160, 170], [40, 170, 120], [60, 130, 230], [0, 120, 140], [90, 190, 200]];

const lakeVertex = /* glsl */ `
  in vec3 position;
  in vec3 cell;
  in vec3 tint;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  flat out vec3 vCell;
  flat out vec3 vTint;
  out vec2 vWorldFt;
  void main() { vWorldFt = position.xy * 0.5; vCell = cell; vTint = tint; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const lakeFragment = /* glsl */ `
  precision highp float;
  uniform vec4 window;
  uniform float opacity;
  flat in vec3 vCell;
  flat in vec3 vTint;
  out vec4 outColor;
  // Traxx 1.8.0 (b6d56f2) View > Show Detail Maps: the water's still body shade (g_EngDetWaterFS).
  uniform bool detailOn;
  uniform sampler2D uWDet;
  uniform sampler2D uWMask;
  uniform float uMapFt;
  uniform float uLook;
  uniform float uWash;
  in vec2 vWorldFt;
${ENGDET_DEFINES}${ENGDET_GLSL_WATER_SHADE}${ENGDET_GLSL_WATER_WASH}  void main() {
    if (vCell.x < window.x || vCell.y < window.y || vCell.x >= window.z || vCell.y >= window.w) discard;
    float shade = detailOn ? waterShade(vWorldFt) : 1.0;
    vec3 c = vTint * (uLook > 0.5 ? shade : 1.0);
    // Traxx 1.8.1 View > Show Water Strength on the lakes (DrawLakes, GLDetailBeginWater's wash).
    if (detailOn && uWash > 0.5) c = waterWash(c, vWorldFt);
    c = vCell.z > 0.5 ? mix(c, ${BORDER_GLSL}, ${BORDER_WEIGHT_GLSL}) : c;
    outColor = vec4(c, opacity);
  }
`;

/**
  The ground the wall rings ride (RingZ, RingZSurface), in scene z: the ground AS DRAWN (Traxx
  1.7 fix round 1, 4cbc21a), the tile's height grid at its drawn level: through the 8 ft points
  on an 8 ft tile (straightened sides included), corner to corner on a 32 ft one.
*/
export interface LakeWallGround {
  /** Grid steps a side of cell (gi, gj): 1 at 32 ft, 4 at 8 ft. */
  per: (gi: number, gj: number) => number;
  /** The drawn z at grid point (a, b), 0..per, of cell (gi, gj). */
  z: (gi: number, gj: number, a: number, b: number) => number;
}

/** What the walls and the marks need beyond the tile map (Traxx 1.7.3): the rule, the notch edges, the lakes' escape and at-H points. */
export interface LakeMarks {
  rule: number;
  notchEdges: readonly LakeNotchEdge[];
  lakes: readonly Pick<LakeState, "escape" | "atcount" | "atstep" | "atx" | "atz">[];
}

/**
  The lakes (COpenGLTerrainRenderer::DrawLakes): a flat quad at each lake's height over every
  tile its fill holds, in the lake's tint at the water opacity, depth-tested and not written.
  With Show Lake Walls, under the TILE rule a ring of lines (opaque, in the lake's tint) round every
  dry tile next to the lake; under the EDGE rule each wall side of a lake tile (its 4-neighbour not
  in the lake) as a line along the edge, notch edges cyan. Both ride the ground but never under the
  lake's height, lifted 1 ft. The marks (escape and at-H posts) ignore the depth.
*/
export class LakesLayer {
  readonly material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: lakeVertex, fragmentShader: lakeFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { window: { value: new THREE.Vector4(0, 0, 256, 256) }, opacity: { value: 0.5 }, ...detailUniforms() },
  });
  readonly mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
  private wallMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: lakeVertex, fragmentShader: lakeFragment, transparent: true, depthWrite: false,
    uniforms: { window: { value: new THREE.Vector4(0, 0, 256, 256) }, opacity: { value: 1 }, ...detailUniforms() },
  });
  readonly walls = new THREE.LineSegments(new THREE.BufferGeometry(), this.wallMaterial);
  private markMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: lakeVertex, fragmentShader: lakeFragment, transparent: false, depthTest: false, depthWrite: false,
    uniforms: { window: { value: new THREE.Vector4(0, 0, 256, 256) }, opacity: { value: 1 }, ...detailUniforms() },
  });
  /** The escape and at-H posts (Traxx 1.7.3); the caller adds it to the scene and shows it with the water. */
  readonly marks = new THREE.LineSegments(new THREE.BufferGeometry(), this.markMaterial);

  constructor() {
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.walls.renderOrder = 11;
    this.walls.frustumCulled = false;
    this.marks.renderOrder = 105;
    this.marks.frustumCulled = false;
  }

  private last: { tmap: Uint8Array | null; heights: readonly number[]; errors: readonly number[]; marks: LakeMarks | null } = { tmap: null, heights: [], errors: [], marks: null };

  /**
    tmap: lake index + 1 per tile; heights in water units; errors per lake; the ground for the walls;
    `marks` the rule, notch edges, escape and at-H points (null: the TILE ring, no marks).
  */
  rebuild(tmap: Uint8Array | null, heights: readonly number[], errors: readonly number[], ground: LakeWallGround | null = null, marks: LakeMarks | null = null): void {
    this.last = { tmap, heights, errors, marks };
    this.rebuildWalls(tmap, heights, errors, ground, marks);
    this.rebuildMarks(tmap, heights, ground, marks);
    const p: number[] = [], c: number[] = [], t: number[] = [];
    if (tmap) {
      // Cell N - 1 too (the lake closes at the seam), and the border cells' copies.
      const n = gridSide(tmap.length), m = n - 1, hi = bandHi(n);
      for (let j = BAND_LO; j < hi; j++) {
        for (let i = BAND_LO; i < hi; i++) {
          const l = tmap[(i & m) + (j & m) * n]!;
          if (l === 0 || l > heights.length) continue;
          const z = (ALTITUDE_SCALE * heights[l - 1]!) / 4;
          const tint = errors[l - 1] ? [255, 0, 255] : LAKE_TINT[(l - 1) % 6]!;
          const x0 = i * 64, y0 = j * 64, x1 = x0 + 64, y1 = y0 + 64, b = inBorder(i, j, n) ? 1 : 0;
          p.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z);
          for (let k = 0; k < 6; k++) { c.push(i, j, b); t.push(tint[0]! / 255, tint[1]! / 255, tint[2]! / 255); }
        }
      }
    }
    this.mesh.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("cell", new THREE.Float32BufferAttribute(c, 3));
    g.setAttribute("tint", new THREE.Float32BufferAttribute(t, 3));
    this.mesh.geometry = g;
  }

  /** The drawn ground changed level (the camera's tile moved): the wall rings and the marks ride it again. */
  reride(ground: LakeWallGround | null): void {
    this.rebuildWalls(this.last.tmap, this.last.heights, this.last.errors, ground, this.last.marks);
    this.rebuildMarks(this.last.tmap, this.last.heights, ground, this.last.marks);
  }

  /*
    The walls. TILE: a dry tile 4-adjacent, wrapping, to a lake gets a line loop for each lake it
    borders. EDGE: each side of a lake tile whose 4-neighbour is not in the lake, a line along the
    edge (notch edges, marked on both of their tiles, in cyan). Cell 255 included and the border
    cells copied (1.7.1), riding the source tile's ground.
  */
  private rebuildWalls(tmap: Uint8Array | null, heights: readonly number[], errors: readonly number[], ground: LakeWallGround | null, marks: LakeMarks | null): void {
    if (marks && marks.rule === LAKE_RULE_EDGE) { this.rebuildEdgeWalls(tmap, heights, errors, ground, marks); return; }
    const p: number[] = [], c: number[] = [], t: number[] = [];
    if (tmap && ground) {
      const n = gridSide(tmap.length), m = n - 1, hi = bandHi(n);
      for (let lk = 0; lk < heights.length; lk++) {
        const id = lk + 1, w = (ALTITUDE_SCALE * heights[lk]!) / 4;
        const tint = errors[lk] ? [255, 0, 255] : LAKE_TINT[lk % 6]!;
        const ringZ = (g: number) => Math.max(g, w) + ALTITUDE_SCALE / 2;
        for (let dj = BAND_LO; dj < hi; dj++) {
          for (let di = BAND_LO; di < hi; di++) {
            const i = di & m, j = dj & m, bord = inBorder(di, dj, n) ? 1 : 0;
            if (tmap[i + j * n] !== 0) continue;
            if (tmap[((i + 1) & m) + j * n] !== id && tmap[((i - 1) & m) + j * n] !== id &&
              tmap[i + ((j + 1) & m) * n] !== id && tmap[i + ((j - 1) & m) * n] !== id) continue;
            // From corner to corner round the tile, `per` grid steps a side.
            const per = ground.per(i, j);
            const pts: number[][] = [];
            const cx = [0, 1, 1, 0, 0], cy = [0, 0, 1, 1, 0];
            for (let side = 0; side < 4; side++) {
              for (let k = 0; k < per; k++) {
                const ox = cx[side]! * per + (cx[side + 1]! - cx[side]!) * k, oy = cy[side]! * per + (cy[side + 1]! - cy[side]!) * k;
                const g = ground.z(i, j, ox, oy);
                pts.push([di * 64 + (ox * 64) / per, dj * 64 + (oy * 64) / per, ringZ(g)]);
              }
            }
            for (let k = 0; k < pts.length; k++) {
              const a = pts[k]!, b = pts[(k + 1) % pts.length]!;
              p.push(...a, ...b);
              for (let n = 0; n < 2; n++) { c.push(di, dj, bord); t.push(tint[0]! / 255, tint[1]! / 255, tint[2]! / 255); }
            }
          }
        }
      }
    }
    setLines(this.walls, p, c, t);
  }

  /* The EDGE rule's walls (DrawLakes, 165df9e): the wall sides of every lake tile, at the waterline. */
  private rebuildEdgeWalls(tmap: Uint8Array | null, heights: readonly number[], errors: readonly number[], ground: LakeWallGround | null, marks: LakeMarks): void {
    const p: number[] = [], c: number[] = [], t: number[] = [];
    if (tmap && ground) {
      const n = gridSide(tmap.length), m = n - 1, hi = bandHi(n);
      // The notch edges the lakes hold, marked on BOTH tiles of each edge, one bit a side.
      let notchbits: Uint8Array | null = null;
      if (marks.notchEdges.length) {
        notchbits = new Uint8Array(n * n);
        for (const e of marks.notchEdges) {
          const x = e.x & m, z = e.z & m, d = e.dir & 3;
          const ox = x + (d === LAKE_DIR_E ? 1 : d === LAKE_DIR_W ? -1 : 0), oz = z + (d === LAKE_DIR_S ? 1 : d === LAKE_DIR_N ? -1 : 0);
          notchbits[x + z * n]! |= 1 << d;
          notchbits[(ox & m) + (oz & m) * n]! |= 1 << ((d + 2) & 3);
        }
      }
      // N E S W: each side from (ex0, ey0) to (ex1, ey1) in tile corners
      const ex0 = [0, 1, 0, 0], ey0 = [0, 0, 1, 0], ex1 = [1, 1, 1, 0], ey1 = [0, 1, 1, 1];
      for (let dj = BAND_LO; dj < hi; dj++) {
        for (let di = BAND_LO; di < hi; di++) {
          const i = di & m, j = dj & m, bord = inBorder(di, dj, n) ? 1 : 0;
          const l = tmap[i + j * n]!;
          if (l === 0 || l > heights.length) continue;
          let wallmask = 0;
          if (tmap[i + ((j - 1) & m) * n] !== l) wallmask |= 1 << LAKE_DIR_N;
          if (tmap[((i + 1) & m) + j * n] !== l) wallmask |= 1 << LAKE_DIR_E;
          if (tmap[i + ((j + 1) & m) * n] !== l) wallmask |= 1 << LAKE_DIR_S;
          if (tmap[((i - 1) & m) + j * n] !== l) wallmask |= 1 << LAKE_DIR_W;
          if (wallmask === 0) continue;
          const w = (ALTITUDE_SCALE * heights[l - 1]!) / 4;
          const ringZ = (g: number) => Math.max(g, w) + ALTITUDE_SCALE / 2;
          const tint = errors[l - 1] ? [255, 0, 255] : LAKE_TINT[(l - 1) % 6]!;
          const per = ground.per(i, j);
          for (let d = 0; d < 4; d++) {
            if (!(wallmask & (1 << d))) continue;
            const col = notchbits && (notchbits[i + j * n]! & (1 << d)) ? [0, 255, 255] : tint;
            let prev: number[] | null = null;
            for (let k = 0; k <= per; k++) {
              const ox = ex0[d]! * per + (ex1[d]! - ex0[d]!) * k, oy = ey0[d]! * per + (ey1[d]! - ey0[d]!) * k;
              const pt = [di * 64 + (ox * 64) / per, dj * 64 + (oy * 64) / per, ringZ(ground.z(i, j, ox, oy))];
              if (prev) {
                p.push(...prev, ...pt);
                for (let q = 0; q < 2; q++) { c.push(di, dj, bord); t.push(col[0]! / 255, col[1]! / 255, col[2]! / 255); }
              }
              prev = pt;
            }
          }
        }
      }
    }
    setLines(this.walls, p, c, t);
  }

  /*
    The marks (DrawLakes, a28fe7d, 71a93b8), on the map's own tiles (not the border copies):
    a leaking lake's escape tile, a yellow post from the ground (the mean of its corners) to 40 ft
    over H and an X across the tile 1 ft above its corners; each CORNER_AT_H point (lattice
    coordinates, atstep to a tile) an orange post from the ground to 40 ft over H.
  */
  private rebuildMarks(tmap: Uint8Array | null, heights: readonly number[], ground: LakeWallGround | null, marks: LakeMarks | null): void {
    const p: number[] = [], c: number[] = [], t: number[] = [];
    if (tmap && ground && marks) {
      const n = gridSide(tmap.length), m = n - 1, sh = Math.log2(n);
      const FT = ALTITUDE_SCALE / 2; // one foot, two water units
      const line = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cell: [number, number], col: readonly number[]) => {
        p.push(x0, y0, z0, x1, y1, z1);
        for (let q = 0; q < 2; q++) { c.push(cell[0], cell[1], 0); t.push(col[0]! / 255, col[1]! / 255, col[2]! / 255); }
      };
      marks.lakes.forEach((L, lk) => {
        if (lk >= heights.length) return;
        const H = heights[lk]!;
        if (L.escape >= 0) {
          const ex = L.escape & m, ez = L.escape >> sh, per = ground.per(ex, ez);
          const zc = [ground.z(ex, ez, 0, 0), ground.z(ex, ez, per, 0), ground.z(ex, ez, per, per), ground.z(ex, ez, 0, per)];
          const zbase = (zc[0]! + zc[1]! + zc[2]! + zc[3]!) * 0.25 + FT;
          let zpost = (ALTITUDE_SCALE * (H + 80)) / 4;
          if (zpost < zbase) zpost = zbase + 40 * FT;
          const x0 = ex * 64, y0 = ez * 64, cell: [number, number] = [ex, ez], yellow = [255, 255, 0];
          line(x0 + 32, y0 + 32, zbase - FT, x0 + 32, y0 + 32, zpost, cell, yellow);
          line(x0, y0, zc[0]! + FT, x0 + 64, y0 + 64, zc[2]! + FT, cell, yellow);
          line(x0 + 64, y0, zc[1]! + FT, x0, y0 + 64, zc[3]! + FT, cell, yellow);
        }
        const S = L.atstep > 0 ? L.atstep : 1, np = Math.min(L.atcount, LAKE_MAX_AT, L.atx.length);
        for (let k = 0; k < np; k++) {
          const px = L.atx[k]!, pz = L.atz[k]!, tx = Math.floor(px / S), tz = Math.floor(pz / S);
          const per = ground.per(tx & m, tz & m);
          const zg = ground.z(tx & m, tz & m, Math.trunc(((px - S * tx) * per) / S), Math.trunc(((pz - S * tz) * per) / S));
          let zpost = (ALTITUDE_SCALE * (H + 80)) / 4; // 40 ft over H
          if (zpost < zg) zpost = zg + 40 * FT;
          const bx = (px * 64) / S, by = (pz * 64) / S;
          line(bx, by, zg, bx, by, zpost, [tx & m, tz & m], [255, 128, 0]);
        }
      });
    }
    setLines(this.marks, p, c, t);
  }

  setWindow(w: THREE.Vector4): void {
    this.material.uniforms.window.value.copy(w);
    this.wallMaterial.uniforms.window.value.copy(w);
    this.markMaterial.uniforms.window.value.copy(w);
  }

  /** Traxx 1.8.0 Show Detail Maps: the lakes' still body shade (not the walls or marks), and 1.8.1's Show Water Strength wash; null for none. */
  setDetail(d: { det: THREE.Texture; mask: THREE.Texture } | null, mapFt: number, look = true, wash = false): void {
    setWaterDetail(this.material, d, mapFt, look, wash);
  }

  setOpacity(percent: number): void {
    this.material.uniforms.opacity.value = Math.round((Math.min(100, Math.max(0, percent)) * 255 + 50) / 100) / 255;
    this.mesh.visible = percent > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.walls.geometry.dispose();
    this.wallMaterial.dispose();
    this.marks.geometry.dispose();
    this.markMaterial.dispose();
  }
}

/* A line picture's geometry: positions, cells (x, y, border) and tints. */
function setLines(obj: THREE.LineSegments, p: number[], c: number[], t: number[]): void {
  obj.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("cell", new THREE.Float32BufferAttribute(c, 3));
  g.setAttribute("tint", new THREE.Float32BufferAttribute(t, 3));
  obj.geometry = g;
}
