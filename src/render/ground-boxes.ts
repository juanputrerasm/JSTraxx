/*
  The ground boxes, drawn with the terrain's own material (its tiles, window and gamma), so a
  face and the ground beside it look alike. Shown in Groundbox mode or with Always Show Ground
  Boxes.
*/
import * as THREE from "three";
import type { TxxGroundBox } from "../core/traxx/txx.ts";
import type { TileSet } from "../core/view/tiles.ts";
import { groundBoxGeometry, type GroundBoxGeometry } from "../core/view/ground-box-geometry.ts";

export class GroundBoxLayer {
  readonly mesh: THREE.Mesh;
  geometry: GroundBoxGeometry | null = null;

  constructor(material: THREE.Material) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false;
  }

  rebuild(boxes: readonly TxxGroundBox[], tiles: TileSet | null): void {
    const g = groundBoxGeometry(boxes, tiles);
    this.geometry = g;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(g.positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(g.uvs, 2));
    geo.setAttribute("tile", new THREE.BufferAttribute(g.tiles, 2));
    geo.setAttribute("cell", new THREE.BufferAttribute(g.cells, 2));
    // Mid-cell, so the terrain shader's wire lines stay off the faces.
    geo.setAttribute("local", new THREE.BufferAttribute(new Float32Array(g.cells.length).fill(0.5), 2));
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
