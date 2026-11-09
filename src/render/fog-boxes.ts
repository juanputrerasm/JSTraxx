/*
  The fog volumes (CTraxxView::DrawFogVolumesOpenGL, COpenGLTerrainRenderer::DrawFogVolumes):
  every Fog in the track, and the one a dialog is previewing, as a see-through box drawn after
  the objects and the water so it tints what is inside it. Not only the selected one: fog is
  placed by looking at where it sits among the rest. No window cull: a volume can be larger
  than the view.

  The sides are one quad per footprint segment from the floor to the top, the top face a fan,
  in the fog's own colour, lighter and more transparent at the top than the bottom; then the
  firmer edges (alpha 0.7): the floor and top outlines and the verticals. Depth tested, not
  written; both faces drawn, so the inside reads too when the camera is in it.

  Shown when the objects are (Objects mode or Always Show Objects), as Traxx draws it.
*/
import * as THREE from "three";
import type { TraxxBox } from "../core/traxx/sit.ts";
import { effectiveFog, fogShapeLines, fogVolumeAlphas, fogVolumeRing, type FogPreview } from "../core/view/fog-volume.ts";

export class FogBoxLayer {
  readonly group = new THREE.Group();
  private faceMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  private lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });

  constructor() {
    // After the water (renderOrder 10): DrawFogVolumesOpenGL follows DrawLakes.
    this.group.renderOrder = 11;
  }

  rebuild(boxes: readonly TraxxBox[], preview: FogPreview | null): void {
    for (const child of [...this.group.children]) { this.group.remove(child); (child as THREE.Mesh).geometry.dispose(); }
    const faces: number[] = [], faceCol: number[] = [], lines: number[] = [], lineCol: number[] = [];
    for (const box of boxes) {
      const { fog, isFog } = effectiveFog(box, preview);
      if (!isFog) continue;
      const r = fogVolumeRing(box, fog);
      if (!r || r.ring.length < 3) continue;
      const a = fogVolumeAlphas(fog.maxop);
      const n = r.ring.length;
      const vert = (p: [number, number], z: number, alpha: number) => { faces.push(p[0], p[1], z); faceCol.push(fog.r, fog.g, fog.b, alpha); };
      for (let i = 0; i < n; i++) {
        const p = r.ring[i]!, q = r.ring[(i + 1) % n]!;
        // The quad (floor i, floor j, top j, top i) as two triangles.
        vert(p, r.floorz, a.bottom); vert(q, r.floorz, a.bottom); vert(q, r.topz, a.top);
        vert(p, r.floorz, a.bottom); vert(q, r.topz, a.top); vert(p, r.topz, a.top);
      }
      // The top face: a fan about the first point (the footprint is convex).
      for (let i = 1; i + 1 < n; i++) { vert(r.ring[0]!, r.topz, a.top); vert(r.ring[i]!, r.topz, a.top); vert(r.ring[i + 1]!, r.topz, a.top); }
      for (const [p, q] of fogShapeLines(r)) {
        lines.push(...p, ...q);
        lineCol.push(fog.r, fog.g, fog.b, a.edge, fog.r, fog.g, fog.b, a.edge);
      }
    }
    if (faces.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(faces, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(faceCol, 4));
      const mesh = new THREE.Mesh(g, this.faceMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 11;
      this.group.add(mesh);
    }
    if (lines.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(lineCol, 4));
      const seg = new THREE.LineSegments(g, this.lineMat);
      seg.frustumCulled = false;
      seg.renderOrder = 12;
      this.group.add(seg);
    }
  }

  dispose(): void {
    for (const child of [...this.group.children]) { this.group.remove(child); (child as THREE.Mesh).geometry.dispose(); }
    this.faceMat.dispose();
    this.lineMat.dispose();
  }
}
