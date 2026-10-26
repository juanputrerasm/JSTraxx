/*
  The course and the trucks in the view (COpenGLTerrainRenderer::DrawCourseMarkers), over
  everything (no depth test):

    - the main course in (255, 32, 32), unless an extended course is being edited and
      "Always show main" is off; the extended course being edited in magenta;
    - trucks 1..8 as arrows: tip at the truck, base 40 units behind and 10 either side,
      white with a red edge, green when selected.

  Segments and trucks outside the grid window are left out. Shown in Course mode or with Always
  Show Course (F5). The segment numbers are drawn by the 2D overlay.
*/
import * as THREE from "three";
import type { TrackDocument } from "../core/doc/document.ts";
import { ALTITUDE_SCALE } from "../core/view/camera.ts";

export interface CourseState { course: number; alwaysMain: boolean; selectedTruck: number }

export class CourseLayer {
  readonly group = new THREE.Group();
  private mainMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1, 32 / 255, 32 / 255), depthTest: false, depthWrite: false });
  private extMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1, 0, 1), depthTest: false, depthWrite: false });
  private truckMat = new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  private edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1, 0, 0), depthTest: false, depthWrite: false });

  rebuild(doc: TrackDocument, state: CourseState, bounds: { minx: number; maxx: number; miny: number; maxy: number }): void {
    for (const c of [...this.group.children]) { this.group.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    const t = doc.track;
    const outside = (x0: number, y0: number, x1: number, y1: number) =>
      (x0 < bounds.minx && x1 < bounds.minx) || (x0 > bounds.maxx && x1 > bounds.maxx) || (y0 < bounds.miny && y1 < bounds.miny) || (y0 > bounds.maxy && y1 > bounds.maxy);
    const lines = (segments: typeof t.course, mat: THREE.LineBasicMaterial) => {
      const p: number[] = [];
      for (const s of segments) {
        if (outside(s.cstart[0], s.cstart[1], s.cend[0], s.cend[1])) continue;
        p.push(s.cstart[0], s.cstart[1], ALTITUDE_SCALE * s.cstart[2], s.cend[0], s.cend[1], ALTITUDE_SCALE * s.cend[2]);
      }
      if (!p.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      const l = new THREE.LineSegments(g, mat);
      l.renderOrder = 100;
      l.frustumCulled = false;
      this.group.add(l);
    };
    if (state.course === 0 || state.alwaysMain) lines(t.course, this.mainMat);
    if (state.course > 0) lines(t.extendedCourses[state.course - 1] ?? [], this.extMat);

    const tp: number[] = [], tc: number[] = [], ep: number[] = [];
    for (let v = 1; v < 9; v++) {
      const truck = t.trucks[v];
      if (!truck || outside(truck.ipos[0], truck.ipos[1], truck.ipos[0], truck.ipos[1])) continue;
      const [px, py] = truck.ipos, pz = ALTITUDE_SCALE * truck.ipos[2];
      const c = Math.cos(truck.psi), s = Math.sin(truck.psi);
      const at = (lx: number, ly: number) => [px + c * lx + s * ly, py - s * lx + c * ly, pz];
      const a = at(10, -40), b = at(-10, -40);
      tp.push(px, py, pz, ...a, ...b);
      const col = v === state.selectedTruck ? [0, 1, 0] : [1, 1, 1];
      tc.push(...col, ...col, ...col);
      ep.push(px, py, pz, ...a, ...a, ...b, ...b, px, py, pz);
    }
    if (tp.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(tp, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(tc, 3));
      const m = new THREE.Mesh(g, this.truckMat);
      m.renderOrder = 101;
      m.frustumCulled = false;
      const eg = new THREE.BufferGeometry();
      eg.setAttribute("position", new THREE.Float32BufferAttribute(ep, 3));
      const e = new THREE.LineSegments(eg, this.edgeMat);
      e.renderOrder = 102;
      e.frustumCulled = false;
      this.group.add(m, e);
    }
  }
}
