/*
  The terrain, as Traxx's GL view draws it (COpenGLTerrainRenderer::CompileTerrainFillDisplayList):

    - 256 x 256 cells (Traxx 1.7.1, 992ef9f: cell 255 is textured and its far corners are
      column / row 0, the world wraps), each its own quad of two triangles split along the checkerboard
      diagonal ((gx + gy) & 1, the same split InterpolateRawAtPoint uses);
    - heights at ALTITUDESCALE (3) units per step, x and y at 64 units per cell;
    - each cell's tile and orientation from its CLR word (core/view/tiles.ts);
    - only the cells inside the grid window are drawn (halfwidth = (gridsize - 1) >> 1 cells
      either side of the window centre);
    - Wire Frame: 0 textures, 1 wire only, 2 the wire over the textures.

  Cells live in 32 x 32 chunks so an edit rewrites one chunk's attributes in place.

  Traxx 1.7 (Traxx/SurfaceMesh.cpp SurfaceTileVertices, OpenGLTerrainRenderer.cpp
  BuildSurfaceTileArray, SurfaceTileLodsFor, CompileSurfaceTileWireframeList): a 16-bit
  track's corners are its 16-bit heights (v / 256 steps, CornerV). Spline and Full Map tracks
  are drawn in 4 x 4-cell tiles: those within 8 tiles of the camera's tile (the window centre)
  from the 8 ft points (FineV), 4 x 4 fine cells a cell split by the engine's parity on the fine
  indices, with texcoords bilinear in the cell's corner mappings (SurfaceTileTexcoords); every
  other tile from the 32 ft corners. An 8 ft tile's side facing a 32 ft tile is straightened onto
  that tile's edge, so there are no cracks (core/view/surface-tiles.ts). The wire frame outlines
  the cells as drawn: 8 ft lines on an 8 ft tile, 32 ft lines elsewhere.

  A chunk is 16 x 16 cells (4 x 4 tiles); when the camera's tile moves, only the chunks whose
  tiles changed level or straightened sides are rebuilt (the tile stamp). Traxx's fast draw
  (display-list / VBO caching and grouping) draws the same picture and is not ported.

  The world-wrap border (Traxx 1.7.1, 3f26cfc .. 45727cb): past each edge a tinted, read-only
  copy of the opposite edge, 3 cells deep (cells -3..258), corners included. Each chunk on an
  edge is drawn again, shifted by 256 cells, from the same geometry (Traxx draws the source
  tile's list at the destination origin), trimmed to the band and washed 0.35 of
  (0.70, 0.80, 0.95) over 0.65 of the picture, untextured cells too. Nothing is stored; picks on
  it do nothing (core/view/pick.ts).
*/
import * as THREE from "three";
import type { TileSet } from "../core/view/tiles.ts";
import { cornerUv } from "../core/view/tiles.ts";
import { ALTITUDE_SCALE } from "../core/view/camera.ts";
import type { Terrain16 } from "../core/traxx/terrain16.ts";
import { TERRAINMODE_CLASSIC8 } from "../core/traxx/terrain16.ts";
import { cornerV } from "../core/traxx/surface.ts";
import { hasFineLod, surfaceTileStamp, SurfaceTileGrids, SURFACE_LOD_8FT, SURFACE_WRAP_BORDER_CELLS, TILE_SIZE, WRAP_BORDER_TINT, WRAP_BORDER_TINT_WEIGHT } from "../core/view/surface-tiles.ts";

const CELLS = 256;
const CHUNK = 16;
const CHUNKS = Math.ceil(CELLS / CHUNK);

const vertexShader = /* glsl */ `
  in vec3 position;
  in vec2 uv;
  in vec2 tile;
  in vec3 cell;
  in vec2 local;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  out vec2 vUv;
  flat out vec2 vTile;
  flat out vec3 vCell;
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
  uniform vec2 shift;         // a world-wrap border copy's offset in cells (0 for the real terrain)
  uniform bool border;
  uniform vec3 borderTint;
  uniform float borderWeight;
  uniform float borderCells;
  in vec2 vUv;
  flat in vec2 vTile;
  flat in vec3 vCell;    // the 32 ft cell, and its wire steps a side (1, or 4 on an 8 ft tile)
  in vec2 vLocal;        // in wire steps from the cell's corner: 0 .. vCell.z
  out vec4 outColor;
  void main() {
    vec2 at = vCell.xy + shift;
    if (at.x < window.x || at.y < window.y || at.x >= window.z || at.y >= window.w) discard;
    if (border && (at.x < -borderCells || at.y < -borderCells || at.x >= 256.0 + borderCells || at.y >= 256.0 + borderCells)) discard;
    vec3 colour;
    if (vTile.x < -0.5) colour = fallbackColor;
    else if (vTile.x < 0.5) colour = texture(smallTiles, vec3(vUv, vTile.y)).rgb;
    else colour = texture(largeTiles, vec3(vUv, vTile.y)).rgb;
    // The painted detail mask, washed over the ground (COpenGLTerrainRenderer::MaskWash).
    if (maskOn) colour *= texture(maskWash, (vCell.xy + 0.5) / 256.0).rgb;
    if (wireMode != 0 && wireCells) {
      // Distance to the nearest grid line of the drawn mesh (8 ft on an 8 ft tile, 32 ft
      // elsewhere: CompileSurfaceTileWireframeList) and the drawn diagonal, in pixels. Each
      // side draws half of a shared line, so the two halves make a line wireWidth pixels wide.
      float steps = max(vCell.z, 1.0);
      vec2 k = min(floor(vLocal), vec2(steps - 1.0));
      vec2 f = vLocal - k;
      vec2 edge = min(f, 1.0 - f);
      vec2 fw = max(fwidth(vLocal), vec2(1e-6));
      float d = min(edge.x / fw.x, edge.y / fw.y);
      if (wireDiagonals) {
        vec2 g = vCell.xy * steps + k;
        float parity = mod(g.x + g.y, 2.0);
        float diag = parity < 0.5 ? (f.x - f.y) : (f.x + f.y - 1.0);
        d = min(d, 2.0 * abs(diag) / max(fw.x + fw.y, 1e-6));
      }
      float halfWidth = 0.5 * wireWidth;
      float line = 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, d);
      if (wireMode == 1) colour = mix(backgroundColor, wireColor, line);
      else colour = mix(colour, overlayColor, line);
    }
    if (border) colour = mix(colour, borderTint, borderWeight);
    outColor = vec4(colour, 1.0);
  }
`;

export interface TerrainSource extends Partial<Terrain16> {
  heights: Uint8Array;
  clr: Uint16Array;
}

/** The view's z of a 32 ft corner: ALTITUDESCALE per step, v / 256 steps on a 16-bit track. */
function cornerZ(src: TerrainSource, vx: number, vy: number): number {
  if (!src.terrainMode || src.terrainMode === TERRAINMODE_CLASSIC8) return ALTITUDE_SCALE * src.heights[(vx & 255) + ((vy & 255) << 8)]!;
  return (ALTITUDE_SCALE * cornerV(src as Terrain16, vx, vy)) / 256;
}

function isClassic(src: TerrainSource): boolean {
  return !src.terrainMode || src.terrainMode === TERRAINMODE_CLASSIC8;
}

interface ChunkData {
  x0: number; y0: number; w: number; h: number;
  /** The tiles' stamps the geometry was built for. */
  stamp: string;
  /** Per cell: its first vertex and its points a side (per + 1). */
  start: Int32Array;
  per: Uint8Array;
}

export class TerrainMesh {
  readonly group = new THREE.Group();
  readonly material: THREE.RawShaderMaterial;
  private chunks: THREE.Mesh[] = [];
  private tiles: TileSet | null = null;
  private smallTex: THREE.DataArrayTexture | null = null;
  private largeTex: THREE.DataArrayTexture | null = null;
  private source: TerrainSource;
  /** The camera's cell the levels are for (DrawTerrainScene's lastgridx, lastgridy). */
  private camera: [number, number] = [128, 128];
  /** The world-wrap border's copies of the edge chunks, each sharing its chunk's geometry. */
  private copies = new Map<THREE.Mesh, THREE.Mesh[]>();
  private borderMaterials = new Map<string, THREE.RawShaderMaterial>();

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
        shift: { value: new THREE.Vector2(0, 0) },
        border: { value: false },
        borderTint: { value: new THREE.Color(...WRAP_BORDER_TINT) },
        borderWeight: { value: WRAP_BORDER_TINT_WEIGHT },
        borderCells: { value: SURFACE_WRAP_BORDER_CELLS },
      },
    });
    for (let cy = 0; cy < CHUNKS; cy++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const w = Math.min(CHUNK, CELLS - cx * CHUNK), h = Math.min(CHUNK, CELLS - cy * CHUNK);
        const data: ChunkData = { x0: cx * CHUNK, y0: cy * CHUNK, w, h, stamp: "", start: new Int32Array(w * h), per: new Uint8Array(w * h) };
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
        mesh.frustumCulled = true;
        mesh.userData = data;
        this.build(mesh, this.stampOf(data));
        this.chunks.push(mesh);
        this.group.add(mesh);
        this.addCopies(mesh);
      }
    }
  }

  /*
    The border copies of a chunk: shifted +256 cells when it holds cells within 3 of the low
    edge, -256 when within 3 of the high one, on each axis and both in a corner (the border
    tiles -1 and 64, SurfaceBorderTileSource, at cell rather than tile grain).
  */
  private addCopies(mesh: THREE.Mesh): void {
    const { x0, y0, w, h } = mesh.userData as ChunkData;
    const b = SURFACE_WRAP_BORDER_CELLS;
    const sx = [0, ...(x0 < b ? [256] : []), ...(x0 + w > 256 - b ? [-256] : [])];
    const sy = [0, ...(y0 < b ? [256] : []), ...(y0 + h > 256 - b ? [-256] : [])];
    const list: THREE.Mesh[] = [];
    for (const dy of sy) {
      for (const dx of sx) {
        if (!dx && !dy) continue;
        const copy = new THREE.Mesh(mesh.geometry, this.borderMaterial(dx, dy));
        copy.position.set(dx * 64, dy * 64, 0);
        copy.frustumCulled = true;
        list.push(copy);
        this.group.add(copy);
      }
    }
    if (list.length) this.copies.set(mesh, list);
  }

  /* One material per shift, every other uniform shared with the terrain's (as siblingMaterial). */
  private borderMaterial(dx: number, dy: number): THREE.RawShaderMaterial {
    const key = `${dx},${dy}`;
    let m = this.borderMaterials.get(key);
    if (!m) {
      const u = this.material.uniforms;
      m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader, fragmentShader, side: THREE.DoubleSide,
        uniforms: { ...u, shift: { value: new THREE.Vector2(dx, dy) }, border: { value: true } },
      });
      this.borderMaterials.set(key, m);
    }
    return m;
  }

  /* The stamps of the chunk's tiles (SurfaceTileStampFor's level and straightened sides). */
  private stampOf(d: ChunkData): string {
    if (!hasFineLod(this.source)) return "32";
    const out: number[] = [];
    const [gx, gy] = this.camera;
    for (let ty = d.y0 / TILE_SIZE; ty * TILE_SIZE < d.y0 + d.h; ty++) {
      for (let tx = d.x0 / TILE_SIZE; tx * TILE_SIZE < d.x0 + d.w; tx++) out.push(surfaceTileStamp(this.source, tx, ty, gx, gy));
    }
    return out.join(",");
  }

  /* The chunk's geometry for its tiles' levels: (per + 1)^2 points and 2 per^2 triangles a cell. */
  private build(mesh: THREE.Mesh, stamp: string): void {
    const d = mesh.userData as ChunkData;
    const fine = hasFineLod(this.source);
    const [gx, gy] = this.camera;
    let nv = 0, nt = 0;
    for (let j = 0; j < d.h; j++) {
      for (let i = 0; i < d.w; i++) {
        const gi = d.x0 + i, gj = d.y0 + j;
        const per = fine && surfaceTileStamp(this.source, gi >> 2, gj >> 2, gx, gy) >> 4 === SURFACE_LOD_8FT ? 4 : 1;
        d.per[j * d.w + i] = per;
        d.start[j * d.w + i] = nv;
        nv += (per + 1) * (per + 1);
        nt += 2 * per * per;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
    g.setAttribute("tile", new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
    const cell = new Float32Array(nv * 3), local = new Float32Array(nv * 2);
    const index = new Uint32Array(nt * 3);
    let k = 0;
    for (let j = 0; j < d.h; j++) {
      for (let i = 0; i < d.w; i++) {
        const gi = d.x0 + i, gj = d.y0 + j, c = j * d.w + i;
        const per = d.per[c]!, v = d.start[c]!, row = per + 1;
        for (let b = 0; b <= per; b++) {
          for (let a = 0; a <= per; a++) {
            const q = v + b * row + a;
            cell[q * 3] = gi; cell[q * 3 + 1] = gj; cell[q * 3 + 2] = per;
            local[q * 2] = a; local[q * 2 + 1] = b;
          }
        }
        for (let b = 0; b < per; b++) {
          for (let a = 0; a < per; a++) {
            const p00 = v + b * row + a, p10 = p00 + 1, p01 = p00 + row, p11 = p01 + 1;
            // The engine's split on the drawn grid's global indices: odd cuts p10-p01, even p00-p11.
            const tri = ((gi * per + a + gj * per + b) & 1) ? [p01, p11, p10, p10, p00, p01] : [p00, p01, p11, p11, p10, p00];
            index.set(tri, k);
            k += 6;
          }
        }
      }
    }
    g.setAttribute("cell", new THREE.BufferAttribute(cell, 3));
    g.setAttribute("local", new THREE.BufferAttribute(local, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    mesh.geometry.dispose();
    mesh.geometry = g;
    for (const c of this.copies.get(mesh) ?? []) c.geometry = g;
    d.stamp = stamp;
    this.write(mesh, 0, 0, d.w, d.h, null);
  }

  /*
    Positions, texcoords and tiles for cells [i0, i1) x [j0, j1) of a chunk. The heights are the
    tile's height grid at its drawn level (SurfaceTileHeightGrid) off Classic 8-bit.
  */
  private write(mesh: THREE.Mesh, i0: number, j0: number, i1: number, j1: number, grids: SurfaceTileGrids | null): void {
    const d = mesh.userData as ChunkData;
    const src = this.source;
    const g = mesh.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const tile = g.getAttribute("tile") as THREE.BufferAttribute;
    const P = pos.array as Float32Array, U = uv.array as Float32Array, T = tile.array as Float32Array;
    const classic = isClassic(src);
    if (!classic && !grids) grids = new SurfaceTileGrids(src as Terrain16, this.camera[0], this.camera[1]);
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const gi = d.x0 + i, gj = d.y0 + j, c = j * d.w + i;
        const per = d.per[c]!, v = d.start[c]!, row = per + 1;
        const word = src.clr[gi + (gj << 8)]!;
        const texIndex = word & 0x0fff;
        const where = this.tiles && texIndex < this.tiles.where.length ? this.tiles.where[texIndex]! : -1;
        const side = where >= 0 ? this.tiles!.side[texIndex]! : 64;
        const m = [0, 1, 2, 3].map((k) => cornerUv(k, word, side));
        const tg = grids ? grids.grid(gi >> 2, gj >> 2) : null;
        for (let b = 0; b <= per; b++) {
          for (let a = 0; a <= per; a++) {
            const q = v + b * row + a, s = a / per, t = b / per;
            P[q * 3] = gi * 64 + (a * 64) / per;
            P[q * 3 + 1] = gj * 64 + (b * 64) / per;
            P[q * 3 + 2] = tg
              ? (ALTITUDE_SCALE * tg.v[((gj & 3) * tg.per + b) * tg.n + (gi & 3) * tg.per + a]!) / 256
              : cornerZ(src, gi + a, gj + b);
            // Bilinear in the four corner mappings: m[0] (0,0), m[1] (1,0), m[2] (1,1), m[3] (0,1).
            U[q * 2] = (1 - s) * (1 - t) * m[0]![0] + s * (1 - t) * m[1]![0] + s * t * m[2]![0] + (1 - s) * t * m[3]![0];
            U[q * 2 + 1] = (1 - s) * (1 - t) * m[0]![1] + s * (1 - t) * m[1]![1] + s * t * m[2]![1] + (1 - s) * t * m[3]![1];
            T[q * 2] = where < 0 ? -1 : where >> 15;
            T[q * 2 + 1] = where < 0 ? 0 : where & 0x7fff;
          }
        }
      }
    }
    pos.needsUpdate = uv.needsUpdate = tile.needsUpdate = true;
    g.computeBoundingSphere();
    g.computeBoundingBox();
  }

  /** Cells changed (heights or CLR): rewrite the chunks they touch. Bounds are cells, inclusive. */
  updateCells(minX: number, minY: number, maxX: number, maxY: number): void {
    // The spline moves the surface up to two cells round an edited point.
    const spread = this.source.terrainMode === 2 ? 2 : 1;
    const grids = isClassic(this.source) ? null : new SurfaceTileGrids(this.source as Terrain16, this.camera[0], this.camera[1]);
    // A height change moves the cells on both sides of a vertex, so widen by one; a tile's
    // straightened side reads its corners, so whole tiles are rewritten. The world wraps
    // (ComputeTerrainWindowStamp folds & 255, df1daa5): an edit at column 0 rewrites tile 63,
    // whose far corners read it.
    const ranges = (lo: number, hi: number): [number, number][] => {
      lo = (lo - spread) & ~3; hi = (hi + spread) | 3;
      if (hi - lo >= 255) return [[0, 255]];
      const out: [number, number][] = [[Math.max(0, lo), Math.min(255, hi)]];
      if (lo < 0) out.push([lo + 256, 255]);
      if (hi > 255) out.push([0, hi - 256]);
      return out;
    };
    const xs = ranges(minX, maxX), ys = ranges(minY, maxY);
    for (const mesh of this.chunks) {
      const { x0, y0, w, h } = mesh.userData as ChunkData;
      for (const [ya, yb] of ys) {
        for (const [xa, xb] of xs) {
          const i0 = Math.max(0, xa - x0), j0 = Math.max(0, ya - y0);
          const i1 = Math.min(w, xb - x0 + 1), j1 = Math.min(h, yb - y0 + 1);
          if (i0 >= i1 || j0 >= j1) continue;
          this.write(mesh, i0, j0, i1, j1, grids);
        }
      }
    }
  }

  /*
    The levels follow the track's mode and the camera's tile: rebuilds only the chunks whose
    tiles' stamps changed. Called after a mode change and when the window moves.
  */
  updateLevels(): void {
    for (const mesh of this.chunks) {
      const stamp = this.stampOf(mesh.userData as ChunkData);
      if (stamp !== (mesh.userData as ChunkData).stamp) this.build(mesh, stamp);
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
      uniforms: { ...u, maskOn: { value: false }, wireCells: { value: false }, shift: { value: new THREE.Vector2(0, 0) }, border: { value: false } },
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
    this.camera = [gridx, gridy];
    this.updateLevels();
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
    for (const m of this.borderMaterials.values()) m.dispose();
    this.smallTex?.dispose();
    this.largeTex?.dispose();
  }
}
