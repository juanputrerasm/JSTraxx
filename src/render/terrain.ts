/*
  The terrain, as Traxx's GL view draws it (COpenGLTerrainRenderer::CompileTerrainFillDisplayList):

    - 255 x 255 cells, each its own quad of two triangles split along the checkerboard
      diagonal ((gx + gy) & 1, the same split InterpolateRawAtPoint uses);
    - heights at ALTITUDESCALE (3) units per step, x and y at 64 units per cell;
    - each cell's tile and orientation from its CLR word (core/view/tiles.ts);
    - only the cells inside the grid window are drawn (halfwidth = (gridsize - 1) >> 1 cells
      either side of the window centre);
    - Wire Frame: 0 textures, 1 wire only, 2 the wire over the textures.

  Cells live in 8 x 8 chunks so an edit rewrites one chunk's attributes in place.
*/
import * as THREE from "three";
import type { TileSet } from "../core/view/tiles.ts";
import { cornerUv } from "../core/view/tiles.ts";
import { ALTITUDE_SCALE } from "../core/view/camera.ts";

const CELLS = 255;
const CHUNK = 32;
const CHUNKS = Math.ceil(CELLS / CHUNK);

const vertexShader = /* glsl */ `
  in vec3 position;
  in vec2 uv;
  in vec2 tile;
  in vec2 cell;
  in vec2 local;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  out vec2 vUv;
  flat out vec2 vTile;
  flat out vec2 vCell;
  out vec2 vLocal;
  void main() {
    vUv = uv;
    vTile = tile;
    vCell = cell;
    vLocal = local;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  precision highp sampler2DArray;
  uniform sampler2DArray smallTiles;
  uniform sampler2DArray largeTiles;
  uniform vec4 window;        // min x, min y, max x, max y, in cells (exclusive max)
  uniform int wireMode;       // 0 textures, 1 wire only, 2 wire over textures
  uniform bool wireCells;     // false for the ground boxes: their faces are not cells
  uniform bool wireDiagonals;
  uniform float wireWidth;    // device pixels
  uniform vec3 wireColor;
  uniform vec3 overlayColor;
  uniform vec3 fallbackColor;
  uniform vec3 backgroundColor;
  uniform sampler2D maskWash;
  uniform bool maskOn;
  in vec2 vUv;
  flat in vec2 vTile;
  flat in vec2 vCell;
  in vec2 vLocal;
  out vec4 outColor;
  void main() {
    if (vCell.x < window.x || vCell.y < window.y || vCell.x >= window.z || vCell.y >= window.w) discard;
    vec3 colour;
    if (vTile.x < -0.5) colour = fallbackColor;
    else if (vTile.x < 0.5) colour = texture(smallTiles, vec3(vUv, vTile.y)).rgb;
    else colour = texture(largeTiles, vec3(vUv, vTile.y)).rgb;
    // The painted detail mask, washed over the ground (COpenGLTerrainRenderer::MaskWash).
    if (maskOn) colour *= texture(maskWash, (vCell + 0.5) / 256.0).rgb;
    if (wireMode != 0 && wireCells) {
      // Distance to the cell's four edges (and its diagonal), in pixels. Each cell draws half
      // of a shared edge, so the two halves make a line wireWidth pixels wide.
      vec2 edge = min(vLocal, 1.0 - vLocal);
      vec2 fw = max(fwidth(vLocal), vec2(1e-6));
      float d = min(edge.x / fw.x, edge.y / fw.y);
      if (wireDiagonals) {
        float parity = mod(vCell.x + vCell.y, 2.0);
        float diag = parity < 0.5 ? (vLocal.x - vLocal.y) : (vLocal.x + vLocal.y - 1.0);
        d = min(d, 2.0 * abs(diag) / max(fw.x + fw.y, 1e-6));
      }
      float halfWidth = 0.5 * wireWidth;
      float line = 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, d);
      if (wireMode == 1) colour = mix(backgroundColor, wireColor, line);
      else colour = mix(colour, overlayColor, line);
    }
    outColor = vec4(colour, 1.0);
  }
`;

export interface TerrainSource {
  heights: Uint8Array;
  clr: Uint16Array;
}

export class TerrainMesh {
  readonly group = new THREE.Group();
  readonly material: THREE.RawShaderMaterial;
  private chunks: THREE.Mesh[] = [];
  private tiles: TileSet | null = null;
  private smallTex: THREE.DataArrayTexture | null = null;
  private largeTex: THREE.DataArrayTexture | null = null;
  private source: TerrainSource;

  constructor(source: TerrainSource) {
    this.source = source;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      uniforms: {
        smallTiles: { value: null },
        largeTiles: { value: null },
        window: { value: new THREE.Vector4(0, 0, 256, 256) },
        wireMode: { value: 0 },
        wireCells: { value: true },
        wireDiagonals: { value: false },
        wireWidth: { value: 1 },
        wireColor: { value: new THREE.Color(0, 0.5, 0) },
        overlayColor: { value: new THREE.Color(0.75, 0.75, 0.75) },
        fallbackColor: { value: new THREE.Color(0, 0, 0) },
        backgroundColor: { value: new THREE.Color(0, 0, 0) },
        maskWash: { value: null },
        maskOn: { value: false },
      },
    });
    for (let cy = 0; cy < CHUNKS; cy++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const w = Math.min(CHUNK, CELLS - cx * CHUNK), h = Math.min(CHUNK, CELLS - cy * CHUNK);
        const geometry = this.chunkGeometry(cx * CHUNK, cy * CHUNK, w, h);
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.frustumCulled = true;
        mesh.userData = { x0: cx * CHUNK, y0: cy * CHUNK, w, h };
        this.chunks.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  private chunkGeometry(x0: number, y0: number, w: number, h: number): THREE.BufferGeometry {
    const n = w * h;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 4 * 2), 2));
    g.setAttribute("tile", new THREE.BufferAttribute(new Float32Array(n * 4 * 2), 2));
    const cell = new Float32Array(n * 4 * 2), local = new Float32Array(n * 4 * 2);
    const index = new Uint32Array(n * 6);
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const c = j * w + i, gi = x0 + i, gj = y0 + j, v = c * 4;
        for (let k = 0; k < 4; k++) {
          cell.set([gi, gj], (v + k) * 2);
          local.set(corners[k], (v + k) * 2);
        }
        // v00 = 0, v10 = 1, v11 = 2, v01 = 3; odd cells split v10-v01, even ones v00-v11.
        index.set(((gi + gj) & 1) ? [v + 3, v + 2, v + 1, v + 1, v, v + 3] : [v, v + 3, v + 2, v + 2, v + 1, v], c * 6);
      }
    }
    g.setAttribute("cell", new THREE.BufferAttribute(cell, 2));
    g.setAttribute("local", new THREE.BufferAttribute(local, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    this.writeCells(g, x0, y0, w, h, 0, 0, w, h);
    return g;
  }

  /** Recompute positions and tile attributes for cells [i0, i1) x [j0, j1) of a chunk. */
  private writeCells(g: THREE.BufferGeometry, x0: number, y0: number, w: number, _h: number, i0: number, j0: number, i1: number, j1: number): void {
    const { heights, clr } = this.source;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const tile = g.getAttribute("tile") as THREE.BufferAttribute;
    const P = pos.array as Float32Array, U = uv.array as Float32Array, T = tile.array as Float32Array;
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const gi = x0 + i, gj = y0 + j, v = (j * w + i) * 4;
        const word = clr[gi + (gj << 8)];
        const texIndex = word & 0x0fff;
        const where = this.tiles && texIndex < this.tiles.where.length ? this.tiles.where[texIndex] : -1;
        const side = where >= 0 ? this.tiles!.side[texIndex] : 64;
        for (let k = 0; k < 4; k++) {
          const vx = gi + corners[k][0], vy = gj + corners[k][1];
          const hgt = heights[Math.min(255, vx) + (Math.min(255, vy) << 8)];
          P[(v + k) * 3] = vx * 64;
          P[(v + k) * 3 + 1] = vy * 64;
          P[(v + k) * 3 + 2] = ALTITUDE_SCALE * hgt;
          const [u, t] = cornerUv(k, word, side);
          U[(v + k) * 2] = u;
          U[(v + k) * 2 + 1] = t;
          T[(v + k) * 2] = where < 0 ? -1 : where >> 15;
          T[(v + k) * 2 + 1] = where < 0 ? 0 : where & 0x7fff;
        }
      }
    }
    pos.needsUpdate = uv.needsUpdate = tile.needsUpdate = true;
    g.computeBoundingSphere();
    g.computeBoundingBox();
  }

  /** Cells changed (heights or CLR): rewrite the chunks they touch. Bounds are cells, inclusive. */
  updateCells(minX: number, minY: number, maxX: number, maxY: number): void {
    for (const mesh of this.chunks) {
      const { x0, y0, w, h } = mesh.userData as { x0: number; y0: number; w: number; h: number };
      // A height change moves the cells on both sides of a vertex, so widen by one.
      const i0 = Math.max(0, minX - 1 - x0), j0 = Math.max(0, minY - 1 - y0);
      const i1 = Math.min(w, maxX + 1 - x0 + 1), j1 = Math.min(h, maxY + 1 - y0 + 1);
      if (i0 >= i1 || j0 >= j1) continue;
      this.writeCells(mesh.geometry, x0, y0, w, h, i0, j0, i1, j1);
    }
  }

  /** New tiles (a texture added, the palette or gamma changed): upload and re-point every cell. */
  setTiles(tiles: TileSet): void {
    this.tiles = tiles;
    const make = (a: TileSet["small"]) => {
      const t = new THREE.DataArrayTexture(a.rgba as Uint8Array<ArrayBuffer>, a.side, a.side, a.count);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.colorSpace = THREE.NoColorSpace;
      // TRAXX_GL_TEXTURE_QUALITY: linear, nearest mip level.
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapNearestFilter;
      t.generateMipmaps = true;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    this.smallTex?.dispose();
    this.largeTex?.dispose();
    this.smallTex = make(tiles.small);
    this.largeTex = make(tiles.large);
    this.material.uniforms.smallTiles.value = this.smallTex;
    this.material.uniforms.largeTiles.value = this.largeTex;
    this.updateCells(0, 0, CELLS - 1, CELLS - 1);
  }

  /*
    The same look for another mesh (the ground boxes): every uniform shared, but the mask wash
    off, as Traxx washes only the terrain fill, and no wire lines: Traxx draws the wire over
    the terrain cells only, and a face is not a cell.
  */
  siblingMaterial(): THREE.RawShaderMaterial {
    const u = this.material.uniforms;
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader, fragmentShader, side: THREE.DoubleSide,
      uniforms: { ...u, maskOn: { value: false }, wireCells: { value: false } },
    });
  }

  /*
    The detail mask overlay: one wash colour per cell from the mask image, sampled at
    (gi * w / 256, gj * h / 256) (CompileTerrainFillDisplayList), or null for none.
  */
  setMask(mask: { width: number; height: number; grey: Uint8Array } | null, on: boolean): void {
    const u = this.material.uniforms;
    (u.maskWash.value as THREE.Texture | null)?.dispose();
    u.maskWash.value = null;
    u.maskOn.value = false;
    if (!mask || !on) return;
    const rgba = new Uint8Array(256 * 256 * 4);
    for (let gj = 0; gj < 256; gj++) {
      for (let gi = 0; gi < 256; gi++) {
        const mx = Math.min(mask.width - 1, Math.trunc((gi * mask.width) / 256)), my = Math.min(mask.height - 1, Math.trunc((gj * mask.height) / 256));
        const k = mask.grey[my * mask.width + mx] / 255;
        let r = 1, g = 1, b = 1;
        if (k > 0) { const t = 0.3 + 0.7 * k; r = 1 - 0.85 * t; g = 1 - 0.6 * t; b = 1 - 0.15 * t; }
        rgba.set([r * 255, g * 255, b * 255, 255], (gi + gj * 256) * 4);
      }
    }
    const tex = new THREE.DataTexture(rgba, 256, 256, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    u.maskWash.value = tex;
    u.maskOn.value = true;
  }

  /** The grid window: gridsize cells centred on (gridx, gridy) (GetGLGridBounds). */
  setWindow(gridx: number, gridy: number, gridsize: number): void {
    const half = (gridsize - 1) >> 1;
    this.material.uniforms.window.value.set(gridx - half, gridy - half, gridx + half, gridy + half);
  }

  setLook(options: { wireMode: 0 | 1 | 2; wire: string; overlay: string; background: string; fallback: [number, number, number]; diagonals: boolean; width: number }): void {
    const u = this.material.uniforms;
    u.wireMode.value = options.wireMode;
    u.wireDiagonals.value = options.diagonals;
    u.wireWidth.value = options.width * Math.min(window.devicePixelRatio || 1, 2);
    u.wireColor.value.set(options.wire);
    u.overlayColor.value.set(options.overlay);
    u.backgroundColor.value.set(options.background);
    u.fallbackColor.value.setRGB(options.fallback[0] / 255, options.fallback[1] / 255, options.fallback[2] / 255);
  }

  dispose(): void {
    for (const m of this.chunks) m.geometry.dispose();
    this.material.dispose();
    this.smallTex?.dispose();
    this.largeTex?.dispose();
  }
}
