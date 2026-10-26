/*
  The backdrop and the arena.

  The backdrop model is drawn first, around the camera: it turns with the view but does not
  move with it, at full scale, without depth (COpenGLTerrainRenderer::DrawBackdrop). A track
  with several backdrops (backdropCount above 1) has them drawn in the order listed, each
  over the one before. Not when
  the track is an arena, nor in wire-only mode, nor with Show Backdrop (F9) off.

  An arena's model is the stadium, placed at its grid position, on the terrain under its lowest
  vertex (CTrackPOD::FindArenaAnchor, ArenaZPos), with the objects' Z stretch.
*/
import * as THREE from "three";
import type { ModelLibrary } from "./models.ts";
import { OBJECT_ZSTRETCH } from "../core/view/model-geometry.ts";
import { ALTITUDE_SCALE } from "../core/view/camera.ts";

export class BackdropLayer {
  /** Drawn in its own pass with the camera at the origin. */
  readonly scene = new THREE.Scene();
  readonly arena = new THREE.Group();

  build(models: ModelLibrary, names: readonly string[], arena: { x: number; y: number } | null, heights: Uint8Array): void {
    this.scene.clear();
    this.arena.clear();
    const name = names[0] ?? "";
    const meshes = name ? models.meshesFor(name) : null;
    if (!arena) {
      let order = 0;
      for (const n of names) {
        const m = n ? models.meshesFor(n) : null;
        if (!m) continue;
        for (const part of m.parts) {
          const mat = (part.material as THREE.MeshBasicMaterial).clone();
          mat.depthTest = false;
          mat.depthWrite = false;
          const mesh = new THREE.Mesh(part.geometry, mat);
          mesh.renderOrder = order;
          this.scene.add(mesh);
        }
        order++;
      }
      return;
    }
    if (!meshes) return;
    // The arena anchor: the lowest vertex's x and y, in cells (model units >> 12).
    const raw = meshes.geometry.raw;
    let minz = Infinity, ax = 0, ay = 0;
    for (let i = 0; i < raw.length; i += 3) if (raw[i + 2] < minz) { minz = raw[i + 2]; ax = raw[i] >> 12; ay = raw[i + 1] >> 12; }
    const gi = (arena.x + ax) & 255, gj = (arena.y + ay) & 255;
    const z = ALTITUDE_SCALE * heights[gi + (gj << 8)];
    for (const part of meshes.parts) {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.position.set(arena.x * 64, arena.y * 64, z);
      mesh.scale.set(1, 1, OBJECT_ZSTRETCH);
      this.arena.add(mesh);
    }
  }
}
