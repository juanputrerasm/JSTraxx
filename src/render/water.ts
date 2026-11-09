/*
  The water (COpenGLTerrainRenderer::DrawWaterTiled, DrawWaterFill), at ALTITUDESCALE x the
  level in quarter steps / 4:

    - the line grid: the outline of every cell whose four corners are all under the water, in
      palette entry 252;
    - the see-through fill: a quad over every cell with any corner under it, (30, 100, 200) at
      the Options > Advanced opacity, drawn after the objects, depth-tested but not written.

  Both are clipped to the grid window like the terrain.
*/
import * as THREE from "three";
import { ALTITUDE_SCALE } from "../core/view/camera.ts";

const vertexShader = /* glsl */ `
  in vec3 position;
  in vec2 cell;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  flat out vec2 vCell;
  void main() { vCell = cell; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform vec4 window;
  uniform vec3 colour;
  uniform float opacity;
  flat in vec2 vCell;
  out vec4 outColor;
  void main() {
    if (vCell.x < window.x || vCell.y < window.y || vCell.x >= window.z || vCell.y >= window.w) discard;
    outColor = vec4(colour, opacity);
  }
`;

function windowed(colour: THREE.Color, opacity: number, transparent: boolean): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader, fragmentShader, transparent, depthWrite: !transparent,
    side: THREE.DoubleSide,
    uniforms: { window: { value: new THREE.Vector4(0, 0, 256, 256) }, colour: { value: colour }, opacity: { value: opacity } },
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
    if (level4 > 0) {
      for (let j = 0; j < 255; j++) {
        for (let i = 0; i < 255; i++) {
          const under = [heights[i + (j << 8)], heights[i + 1 + (j << 8)], heights[i + 1 + ((j + 1) << 8)], heights[i + ((j + 1) << 8)]].map((h) => 4 * h! < level4);
          const x0 = i * 64, y0 = j * 64, x1 = x0 + 64, y1 = y0 + 64;
          const all = surface ? surface.max[i + (j << 8)]! < 32 * level4 : under.every(Boolean);
          const any = surface ? surface.min[i + (j << 8)]! <= 32 * level4 : under.some(Boolean);
          if (all) {
            lp.push(x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z);
            for (let k = 0; k < 8; k++) lc.push(i, j);
          }
          if (any) {
            fp.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z);
            for (let k = 0; k < 6; k++) fc.push(i, j);
          }
        }
      }
    }
    const set = (obj: THREE.LineSegments | THREE.Mesh, p: number[], c: number[]) => {
      obj.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute("cell", new THREE.Float32BufferAttribute(c, 2));
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
  in vec2 cell;
  in vec3 tint;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  flat out vec2 vCell;
  flat out vec3 vTint;
  void main() { vCell = cell; vTint = tint; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const lakeFragment = /* glsl */ `
  precision highp float;
  uniform vec4 window;
  uniform float opacity;
  flat in vec2 vCell;
  flat in vec3 vTint;
  out vec4 outColor;
  void main() {
    if (vCell.x < window.x || vCell.y < window.y || vCell.x >= window.z || vCell.y >= window.w) discard;
    outColor = vec4(vTint, opacity);
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

/**
  The lakes (COpenGLTerrainRenderer::DrawLakes): a flat quad at each lake's height over every
  tile its fill holds, in the lake's tint at the water opacity, depth-tested and not written.
  With Show Lake Walls, a ring of lines (opaque, in the lake's tint) round every dry tile next to
  the lake, riding the ground but never under the lake's height, lifted 1 ft.
*/
export class LakesLayer {
  readonly material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: lakeVertex, fragmentShader: lakeFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { window: { value: new THREE.Vector4(0, 0, 256, 256) }, opacity: { value: 0.5 } },
  });
  readonly mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
  private wallMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: lakeVertex, fragmentShader: lakeFragment, transparent: true, depthWrite: false,
    uniforms: { window: { value: new THREE.Vector4(0, 0, 256, 256) }, opacity: { value: 1 } },
  });
  readonly walls = new THREE.LineSegments(new THREE.BufferGeometry(), this.wallMaterial);

  constructor() {
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.walls.renderOrder = 11;
    this.walls.frustumCulled = false;
  }

  private last: { tmap: Uint8Array | null; heights: readonly number[]; errors: readonly number[] } = { tmap: null, heights: [], errors: [] };

  /** tmap: lake index + 1 per tile; heights in water units; errors per lake; the ground for the walls. */
  rebuild(tmap: Uint8Array | null, heights: readonly number[], errors: readonly number[], ground: LakeWallGround | null = null): void {
    this.last = { tmap, heights, errors };
    this.rebuildWalls(tmap, heights, errors, ground);
    const p: number[] = [], c: number[] = [], t: number[] = [];
    if (tmap) {
      for (let j = 0; j < 255; j++) {
        for (let i = 0; i < 255; i++) {
          const l = tmap[i + (j << 8)]!;
          if (l === 0 || l > heights.length) continue;
          const z = (ALTITUDE_SCALE * heights[l - 1]!) / 4;
          const tint = errors[l - 1] ? [255, 0, 255] : LAKE_TINT[(l - 1) % 6]!;
          const x0 = i * 64, y0 = j * 64, x1 = x0 + 64, y1 = y0 + 64;
          p.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z);
          for (let k = 0; k < 6; k++) { c.push(i, j); t.push(tint[0]! / 255, tint[1]! / 255, tint[2]! / 255); }
        }
      }
    }
    this.mesh.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("cell", new THREE.Float32BufferAttribute(c, 2));
    g.setAttribute("tint", new THREE.Float32BufferAttribute(t, 3));
    this.mesh.geometry = g;
  }

  /** The drawn ground changed level (the camera's tile moved): the wall rings ride it again. */
  reride(ground: LakeWallGround | null): void {
    this.rebuildWalls(this.last.tmap, this.last.heights, this.last.errors, ground);
  }

  /*
    The wall rings: a dry tile (not the map's last row or column) 4-adjacent, wrapping, to a lake
    gets a line loop for each lake it borders.
  */
  private rebuildWalls(tmap: Uint8Array | null, heights: readonly number[], errors: readonly number[], ground: LakeWallGround | null): void {
    const p: number[] = [], c: number[] = [], t: number[] = [];
    if (tmap && ground) {
      for (let lk = 0; lk < heights.length; lk++) {
        const id = lk + 1, w = (ALTITUDE_SCALE * heights[lk]!) / 4;
        const tint = errors[lk] ? [255, 0, 255] : LAKE_TINT[lk % 6]!;
        const ringZ = (g: number) => Math.max(g, w) + ALTITUDE_SCALE / 2;
        for (let j = 0; j < 255; j++) {
          for (let i = 0; i < 255; i++) {
            if (tmap[i + (j << 8)] !== 0) continue;
            if (tmap[((i + 1) & 255) + (j << 8)] !== id && tmap[((i - 1) & 255) + (j << 8)] !== id &&
              tmap[i + (((j + 1) & 255) << 8)] !== id && tmap[i + (((j - 1) & 255) << 8)] !== id) continue;
            // From corner to corner round the tile, `per` grid steps a side.
            const per = ground.per(i, j);
            const pts: number[][] = [];
            const cx = [0, 1, 1, 0, 0], cy = [0, 0, 1, 1, 0];
            for (let side = 0; side < 4; side++) {
              for (let k = 0; k < per; k++) {
                const ox = cx[side]! * per + (cx[side + 1]! - cx[side]!) * k, oy = cy[side]! * per + (cy[side + 1]! - cy[side]!) * k;
                const g = ground.z(i, j, ox, oy);
                pts.push([i * 64 + (ox * 64) / per, j * 64 + (oy * 64) / per, ringZ(g)]);
              }
            }
            for (let k = 0; k < pts.length; k++) {
              const a = pts[k]!, b = pts[(k + 1) % pts.length]!;
              p.push(...a, ...b);
              for (let n = 0; n < 2; n++) { c.push(i, j); t.push(tint[0]! / 255, tint[1]! / 255, tint[2]! / 255); }
            }
          }
        }
      }
    }
    this.walls.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("cell", new THREE.Float32BufferAttribute(c, 2));
    g.setAttribute("tint", new THREE.Float32BufferAttribute(t, 3));
    this.walls.geometry = g;
  }

  setWindow(w: THREE.Vector4): void {
    this.material.uniforms.window.value.copy(w);
    this.wallMaterial.uniforms.window.value.copy(w);
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
  }
}
