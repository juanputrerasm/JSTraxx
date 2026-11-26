/*
  The ground boxes, drawn with the terrain's own material (its tiles, window and gamma), so a
  face and the ground beside it look alike. Shown in Groundbox mode or with Always Show Ground
  Boxes.

  Traxx 1.8.1 (e6dff38; TraxxViewDisplay.cpp DrawBuildingOpenGL, OpenGLTerrainRenderer.cpp
  DrawGroundBoxPolyobj): under Show Detail Maps / Show Detail Strength each 1 x 1 box is drawn
  through the terrain detail program with the engine's per-face baked light (engine-detail.ts
  engineDetailBoxI, the GLSL boxI). Each vertex carries its face (ENGDET_BOX_*, the same numbers
  as the geometry's faces 0 south .. 5 bottom); a box over more than one tile, or of zero height
  (the engine bakes none), gets -1 and is drawn plain.
*/
import * as THREE from "three";
import type { TxxGroundBox } from "../core/traxx/txx.ts";
import type { TileSet } from "../core/view/tiles.ts";
import { groundBoxGeometry, type GroundBoxGeometry } from "../core/view/ground-box-geometry.ts";

/** The face of every vertex (three a triangle), -1 on a box drawn plain. */
export function boxFaces(boxes: readonly TxxGroundBox[], faceOf: Int32Array): Float32Array {
  const out = new Float32Array(faceOf.length * 3);
  for (let t = 0; t < faceOf.length; t++) {
    const b = boxes[faceOf[t]! >> 3]!;
    const face = b.w !== 1 || b.h !== 1 || b.upper === b.lower ? -1 : faceOf[t]! & 7;
    out[t * 3] = out[t * 3 + 1] = out[t * 3 + 2] = face;
  }
  return out;
}

export class GroundBoxLayer {
  readonly mesh: THREE.Mesh;
  geometry: GroundBoxGeometry | null = null;

  constructor(material: THREE.Material) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false;
  }

  /** `cells`: the world's N (256, or a track format version 6 worldCells). */
  rebuild(boxes: readonly TxxGroundBox[], tiles: TileSet | null, cells = 256): void {
    const g = groundBoxGeometry(boxes, tiles, cells);
    this.geometry = g;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(g.positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(g.uvs, 2));
    geo.setAttribute("tile", new THREE.BufferAttribute(g.tiles, 2));
    geo.setAttribute("cell", new THREE.BufferAttribute(g.cells, 2));
    // Mid-cell, so the terrain shader's wire lines stay off the faces.
    geo.setAttribute("local", new THREE.BufferAttribute(new Float32Array(g.cells.length).fill(0.5), 2));
    geo.setAttribute("boxFace", new THREE.BufferAttribute(boxFaces(boxes, g.faceOf), 1));
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
