/*
  The waterfalls in the view (Traxx 1.7.1, COpenGLTerrainRenderer::DrawWaterfalls), drawn after
  the lakes:

    - the sheet: a translucent white strip between neighbouring 2 ft columns, at the fall's
      opacity * 0.006 (never under 0.05: this is the editor), a long column resampled to at most
      200 rows; depth tested, not written. Traxx 1.7.2: the slab's FRONT face (each row pushed out
      along the smooth normal by the thickness, FallColumn.front);
    - the column ends: blue water, brown ground, red limit (5 px points), at the path ends;
    - the mist volumes' outlines, one per stream (Traxx 1.7.3, up to 4): the ellipse at the floor
      and at the top (32 segments) and four verticals at its extremes, soft white, depth tested;
    - the crest line and its points, cyan (red with errors, yellow while edited or captured),
      and the flow arrow at the crest's middle (at every point while capturing), ignoring depth.

  Each fall is in feet unwrapped from crest point 0 and is moved by the multiple of 8192 ft (W,
  the world's side, on a track format version 6 world) per axis that puts point 0 nearest the
  grid centre (fallViewShift). Feet to scene units: x and y
  2 a foot (ipos), up ALTITUDE_SCALE / 2 a foot (a 2 ft step is ALTITUDE_SCALE).
*/
import * as THREE from "three";
import { ALTITUDE_SCALE } from "../core/view/camera.ts";
import { FALLEND_GROUND, FALLEND_WATER } from "../core/traxx/falls.ts";
import { fallArrow, fallMiddleArrow, fallStripRows, fallViewShift, type FallPreview } from "../core/view/fall-shapes.ts";

const XY = 2;
const UP = ALTITUDE_SCALE / 2;
const CREST_COLOURS: [number, number, number][] = [[0.0, 0.86, 1.0], [1.0, 0.15, 0.15], [1.0, 0.92, 0.0]];

export class WaterfallsLayer {
  readonly group = new THREE.Group();
  private materials: THREE.Material[] = [];

  constructor() {
    this.group.renderOrder = 12;
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

  /** Rebuild every fall for the grid centre (gridx, gridy), in cells, in a world `worldFt` a side. */
  /**
    `mistDim[i]`: a bit per mist outline of falls[i] drawn dim and dashed (Traxx 1.8.0, 35b087b: a
    stream the fog pass does not draw, or a DROPPED fall's, while the fog pass runs).
  */
  rebuild(falls: readonly FallPreview[], gridx: number, gridy: number, worldFt = 8192, mistDim: readonly number[] = []): void {
    this.clear();
    falls.forEach((f, fi) => {
      if (f.px.length < 1) return;
      const [sx, sz] = fallViewShift(f.px[0]!, f.pz[0]!, gridx, gridy, worldFt);
      const at = (x: number, y: number, z: number): [number, number, number] => [(x + sx) * XY, (z + sz) * XY, y * UP];

      // The sheet and the column ends (depth tested, not written).
      const S = f.shape;
      if (S && S.ncols >= 2) {
        let alpha = f.opacity * 0.006;
        if (alpha < 0.05) alpha = 0.05; // a 0% fall is still seen, faintly
        const p: number[] = [];
        for (let k = 0; k + 1 < S.ncols; k++) {
          const A = S.col[k]!, B = S.col[k + 1]!;
          if (A.n < 2 || B.n < 2) continue;
          // the slab's FRONT face (handover 4.6): the path pushed out along the smooth normal by the thickness
          const PA = A.front ?? A.p, PB = B.front ?? B.p;
          const rows = fallStripRows(A.n, B.n);
          for (let j = 0; j + 1 < rows.length; j++) {
            const [ia0, ib0] = rows[j]!, [ia1, ib1] = rows[j + 1]!;
            const a0 = at(PA[3 * ia0]!, PA[3 * ia0 + 1]!, PA[3 * ia0 + 2]!), b0 = at(PB[3 * ib0]!, PB[3 * ib0 + 1]!, PB[3 * ib0 + 2]!);
            const a1 = at(PA[3 * ia1]!, PA[3 * ia1 + 1]!, PA[3 * ia1 + 2]!), b1 = at(PB[3 * ib1]!, PB[3 * ib1 + 1]!, PB[3 * ib1 + 2]!);
            p.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1); // the strip's two triangles
          }
        }
        if (p.length) {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
          const mesh = new THREE.Mesh(g, this.mat(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: alpha, depthWrite: false, side: THREE.DoubleSide })));
          mesh.renderOrder = 12;
          mesh.frustumCulled = false;
          this.group.add(mesh);
        }
        const ep: number[] = [], ec: number[] = [];
        for (const A of S.col) {
          if (A.n < 1) continue;
          const e = 3 * (A.n - 1);
          ep.push(...at(A.p[e]!, A.p[e + 1]!, A.p[e + 2]!));
          ec.push(...(A.end === FALLEND_WATER ? [0.15, 0.35, 1.0] : A.end === FALLEND_GROUND ? [0.55, 0.32, 0.1] : [1.0, 0.1, 0.1]));
        }
        this.points(ep, ec, 5, true);
      }

      // The mist volumes' outlines, one per stream: W across the flow (fx, fz), L along it.
      f.mist.forEach((M, mi) => {
        const hw = M[3]! * 0.5, hl = M[4]! * 0.5, ux = -M[7]!, uz = M[6]!;
        const y0 = M[1]!, y1 = M[1]! + M[5]!;
        const SEG = 32;
        const lp: number[] = [];
        for (const y of [y0, y1]) {
          for (let k = 0; k < SEG; k++) {
            const pt = (n: number) => {
              const t = (6.283185307179586 * n) / SEG, a = hw * Math.cos(t), b = hl * Math.sin(t);
              return at(M[0]! + a * ux + b * M[6]!, y, M[2]! + a * uz + b * M[7]!);
            };
            lp.push(...pt(k), ...pt((k + 1) % SEG));
          }
        }
        for (let k = 0; k < 4; k++) {
          const a = k === 0 ? hw : k === 2 ? -hw : 0.0, b = k === 1 ? hl : k === 3 ? -hl : 0.0;
          const vx = M[0]! + a * ux + b * M[6]!, vz = M[2]! + a * uz + b * M[7]!;
          lp.push(...at(vx, y0, vz), ...at(vx, y1, vz));
        }
        if ((mistDim[fi] ?? 0) & (1 << mi)) this.lines(lp, new THREE.Color(0.92, 0.92, 0.95), 0.25, true, true);
        else this.lines(lp, new THREE.Color(0.92, 0.92, 0.95), 0.6, true);
      });

      // The crest and the flow arrows (depth ignored, so the line is always seen).
      const col = new THREE.Color(...CREST_COLOURS[f.style] ?? CREST_COLOURS[0]!);
      const cp: number[] = [];
      for (let k = 0; k + 1 < f.px.length; k++) cp.push(...at(f.px[k]!, f.py[k]!, f.pz[k]!), ...at(f.px[k + 1]!, f.py[k + 1]!, f.pz[k + 1]!));
      const pts: number[] = [], pcs: number[] = [];
      for (let k = 0; k < f.px.length; k++) { pts.push(...at(f.px[k]!, f.py[k]!, f.pz[k]!)); pcs.push(col.r, col.g, col.b); }
      if (f.px.length >= 2) {
        const arrow = (x: number, y: number, z: number, dx: number, dz: number) => { for (const v of fallArrow(x, y + 0.5, z, dx, dz, 14.0)) cp.push(...at(v[0], v[1], v[2])); };
        if (f.arrowsAll) for (let k = 0; k < f.px.length; k++) arrow(f.px[k]!, f.py[k]!, f.pz[k]!, f.dx[k]!, f.dz[k]!);
        else {
          const m = fallMiddleArrow(f);
          if (m) arrow(m.x, m.y, m.z, m.dx, m.dz);
        }
      }
      this.lines(cp, col, 1, false);
      this.points(pts, pcs, 6, false);
    });
  }

  private lines(p: number[], colour: THREE.Color, opacity: number, depth: boolean, dashed = false): void {
    if (!p.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    const m = dashed
      ? new THREE.LineDashedMaterial({ color: colour, transparent: true, opacity, depthTest: depth, depthWrite: false, dashSize: 4, gapSize: 4 })
      : new THREE.LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity, depthTest: depth, depthWrite: false });
    const l = new THREE.LineSegments(g, this.mat(m));
    if (dashed) l.computeLineDistances();
    l.renderOrder = depth ? 12 : 103;
    l.frustumCulled = false;
    this.group.add(l);
  }

  private points(p: number[], c: number[], size: number, depth: boolean): void {
    if (!p.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const pts = new THREE.Points(g, this.mat(new THREE.PointsMaterial({ size: size * dpr, sizeAttenuation: false, vertexColors: true, depthTest: depth, depthWrite: false })));
    pts.renderOrder = depth ? 12 : 104;
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  dispose(): void {
    this.clear();
  }
}
