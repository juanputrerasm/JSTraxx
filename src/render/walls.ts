/*
  The walls in the view (Traxx 1.8.2, COpenGLTerrainRenderer::DrawWalls in
  Traxx/OpenGLTerrainRenderer.cpp), drawn after the waterfalls:

    - the ribbon: a blended band from the base to base + height at +-thickness/2 of the
      centreline, two faces per run (core/view/wall-draw.ts), depth tested, not written;
    - the ground line along the centreline at the base (not on a gap, not with No ground line),
      depth ignored like the waterfall's crest, so it shows through hills;
    - in Walls mode the authored points as 7 px white dots, the hovered one 12 px red; a wall over
      the export cap as its points joined by a thin red line; the capture's points and line yellow.

  Each wall is moved by the multiple of the world's side per axis that puts its first point
  nearest the grid centre (wallViewShift). Feet to scene units: x and z across 2 a foot (ipos),
  up ALTITUDE_SCALE / 2 a foot.

  Changed: WebGL draws every line 1 px wide, so the 2 px line (3 px when selected) is 1 px here;
  the selected wall still shows brighter and more solid.
*/
import * as THREE from "three";
import { ALTITUDE_SCALE } from "../core/view/camera.ts";
import { wallColour, wallRunTriangles, wallRunVertices, wallRuns, wallViewShift, WALLGL_RUNMAX, type WallDrawItem } from "../core/view/wall-draw.ts";

const XY = 2;
const UP = ALTITUDE_SCALE / 2;

export class WallsLayer {
  readonly group = new THREE.Group();
  private materials: THREE.Material[] = [];

  constructor() {
    this.group.renderOrder = 13;
  }

  private clear(): void {
    for (const c of [...this.group.children]) { this.group.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    for (const m of this.materials) m.dispose();
    this.materials = [];
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  /** Rebuild every wall for the grid centre (gridx, gridy), in cells, in a world `worldFt` a side. */
  rebuild(walls: readonly WallDrawItem[], gridx: number, gridy: number, worldFt = 8192): void {
    this.clear();
    for (const W of walls) {
      const haveline = W.x.length >= 2 && !W.capture && W.x.length <= WALLGL_RUNMAX - 2;
      const havemark = W.mx.length > 0;
      if (!haveline && !havemark) continue;
      const [sx, sz] = haveline ? wallViewShift(W.x[0]!, W.z[0]!, gridx, gridy, worldFt) : wallViewShift(W.mx[0]!, W.mz[0]!, gridx, gridy, worldFt);
      const at = (x: number, y: number, z: number): [number, number, number] => [(x + sx) * XY, (z + sz) * XY, y * UP];
      const { rgb, alpha } = wallColour(W.side, W.selected);
      const colour = new THREE.Color(rgb[0], rgb[1], rgb[2]);

      // The band (depth tested, not written) and the ground line (depth ignored).
      if (haveline) {
        const tri: number[] = [], line: number[] = [];
        for (const run of wallRuns(W.x.length, W.closed, W.gap)) {
          const v = wallRunVertices(W.x, W.z, W.y, run, W.thick);
          if (v.length < 2) continue;
          const t = wallRunTriangles(v, W.height);
          for (let k = 0; k < t.length; k += 3) tri.push(...at(t[k]!, t[k + 1]!, t[k + 2]!));
          if (!W.noline) for (let j = 0; j + 1 < v.length; j++) line.push(...at(v[j]!.cx, v[j]!.y, v[j]!.cz), ...at(v[j + 1]!.cx, v[j + 1]!.y, v[j + 1]!.cz));
        }
        if (tri.length) {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute(tri, 3));
          const mesh = new THREE.Mesh(g, this.mat(new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: alpha, depthWrite: false, side: THREE.DoubleSide })));
          mesh.renderOrder = 13;
          mesh.frustumCulled = false;
          this.group.add(mesh);
        }
        this.lines(line, colour, false);
      }

      // The authored points (Walls mode) and the capture's line: depth ignored, always seen.
      if (havemark) {
        const marks = W.mx.map((x, k) => at(x, W.my[k]!, W.mz[k]!));
        const strip = (closed: boolean) => {
          const p: number[] = [];
          for (let k = 0; k + 1 < marks.length; k++) p.push(...marks[k]!, ...marks[k + 1]!);
          if (closed && marks.length > 2) p.push(...marks[marks.length - 1]!, ...marks[0]!);
          return p;
        };
        // A wall too long to draw (over the export cap): its points joined by a thin red line.
        if (W.overcap && marks.length >= 2) this.lines(strip(W.closed), new THREE.Color(1.0, 0.15, 0.15), false);
        if (W.capture && marks.length >= 2) this.lines(strip(false), new THREE.Color(1.0, 0.92, 0.0), false);
        const dot = W.capture ? new THREE.Color(1.0, 0.92, 0.0) : new THREE.Color(1, 1, 1);
        this.points(marks.filter((_, k) => k !== W.hot).flat(), dot, 7);
        if (W.hot >= 0 && W.hot < marks.length) this.points(marks[W.hot]!, new THREE.Color(1.0, 0.15, 0.15), 12);
      }
    }
  }

  private lines(p: number[], colour: THREE.Color, depth: boolean): void {
    if (!p.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    const l = new THREE.LineSegments(g, this.mat(new THREE.LineBasicMaterial({ color: colour, depthTest: depth, depthWrite: false })));
    l.renderOrder = depth ? 13 : 105;
    l.frustumCulled = false;
    this.group.add(l);
  }

  private points(p: number[], colour: THREE.Color, size: number): void {
    if (!p.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const pts = new THREE.Points(g, this.mat(new THREE.PointsMaterial({ color: colour, size: size * dpr, sizeAttenuation: false, depthTest: false, depthWrite: false })));
    pts.renderOrder = size > 7 ? 107 : 106;
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  dispose(): void {
    this.clear();
  }
}
