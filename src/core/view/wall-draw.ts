/*
  The walls as the 3D view draws them (Traxx 1.8.2, CTraxxView::DrawWallsOpenGL in
  Traxx/TraxxViewWalls.cpp and COpenGLTerrainRenderer::DrawWalls / WallGLRun in
  Traxx/OpenGLTerrainRenderer.cpp), as plain data for render/walls.ts:

    - every wall is exported as Write POD exports it (core/traxx/walls.ts exportWall: about one
      point per 8 ft, the ground under every point plus its above-ground), within the pod's caps
      (WALL_MAX_EXPORT_TOTAL over all walls, WALL_MAX_EXPORT_POINTS a wall); a wall past them is
      "over the cap": not drawn as a ribbon, its points joined by a red line in Walls mode;
    - the ribbon is cut into runs at the gaps (a closed wall with no gap is one loop); at a joint
      the two stretches' normals are averaged and the offset lengthened to keep the thickness (the
      miter, at most 2x); a reversal keeps the first stretch's normal;
    - colours: Outside orange, Inside yellow, None white; the selected wall brighter and more
      solid, its line thicker;
    - the name label over point 0 is half the wall's on-screen height there, 7 to 12 px.

  Units here are feet (x, z across, y up); render/walls.ts turns them into scene units.
*/
import { exportWall, WALL_MAX_EXPORT_POINTS, WALL_MAX_EXPORT_TOTAL, WALL_MAX_WALLS, WALL_UNIT, type WallGroundFn } from "../traxx/walls.ts";
import { WALL_SIDE_INSIDE, WALL_SIDE_OUTSIDE, type Wall } from "../traxx/race-types.ts";

/** One wall to draw (TraxxGLWall), in feet. */
export interface WallDrawItem {
  /** The exported centreline: x, z, base y (ground + above), and gap per point (the stretch after it). */
  x: number[];
  z: number[];
  y: number[];
  gap: number[];
  closed: boolean;
  noline: boolean;
  height: number;
  thick: number;
  side: number;
  selected: boolean;
  /** The authored points (Walls mode), at the ground under each plus its above-ground. */
  mx: number[];
  mz: number[];
  my: number[];
  /** The hovered point among the marks, or -1. */
  hot: number;
  /** The wall being captured: yellow points joined by a yellow line, no ribbon. */
  capture: boolean;
  /** Too long to export (so to draw): only its marks, joined by a thin red line. */
  overcap: boolean;
}

/** What the view knows when it builds the list. */
export interface WallDrawInput {
  walls: readonly Wall[];
  ground: WallGroundFn;
  /** Walls mode: the points (and the capture) are drawn. */
  mode: boolean;
  /** View > Show Walls: the ribbons are drawn. */
  ribbons: boolean;
  /** wallhw / wallhp. */
  hotWall: number;
  hotPoint: number;
  /** The capture's points so far, 1/256 ft, or null. */
  capture: readonly (readonly [number, number])[] | null;
}

/** DrawWallsOpenGL: the list handed to the renderer, and the walls past the cap. */
export function wallDrawList(inp: WallDrawInput): WallDrawItem[] {
  const out: WallDrawItem[] = [];
  const { walls, ground, mode, ribbons } = inp;
  if (!ribbons && !(mode && (walls.length > 0 || inp.capture))) return out;
  let total = 0;
  for (let i = 0; i < walls.length && out.length < WALL_MAX_WALLS; i++) {
    const wl = walls[i]!;
    const G: WallDrawItem = {
      x: [], z: [], y: [], gap: [], closed: false, noline: false, height: 0, thick: 0, side: 0, selected: false,
      mx: [], mz: [], my: [], hot: -1, capture: false, overcap: false,
    };
    let room = WALL_MAX_EXPORT_TOTAL - total;
    if (room > WALL_MAX_EXPORT_POINTS) room = WALL_MAX_EXPORT_POINTS;
    if (ribbons && wl.points.length >= 2 && room < 2) G.overcap = true;
    else if (ribbons && wl.points.length >= 2) {
      const e = exportWall(wl, ground, room);
      if (e.count < 0) G.overcap = true;   // over the cap: only its points, joined by a red line (Walls mode)
      if (e.count >= 2) {
        for (const p of e.points) {
          G.x.push(p.x / WALL_UNIT);
          G.z.push(p.z / WALL_UNIT);
          G.y.push(p.baseY / WALL_UNIT);
          G.gap.push(p.gap !== 0 ? 1 : 0);
        }
        total += e.count;
      }
    }
    if (mode && wl.points.length > 0) {
      for (const p of wl.points) {
        const x = p.x / WALL_UNIT, z = p.z / WALL_UNIT;
        G.mx.push(x);
        G.mz.push(z);
        G.my.push(ground(x, z) + p.above / WALL_UNIT);
      }
      if (inp.hotWall === i) G.hot = inp.hotPoint;
    }
    if (G.x.length >= 2 || G.mx.length > 0) {
      G.closed = wl.closed === 1;
      G.noline = wl.noline === 1;
      G.height = wl.height / WALL_UNIT;
      G.thick = wl.thickness / WALL_UNIT;
      G.side = wl.side;
      G.selected = mode && inp.hotWall === i;
      out.push(G);
    }
  }
  // The wall being captured: its points and the line through them.
  const cap = inp.capture;
  if (mode && cap && cap.length > 0) {
    const G: WallDrawItem = {
      x: [], z: [], y: [], gap: [], closed: false, noline: false, height: 0, thick: 0, side: 0, selected: false,
      mx: [], mz: [], my: [], hot: -1, capture: true, overcap: false,
    };
    for (const [px, pz] of cap) {
      const x = px / WALL_UNIT, z = pz / WALL_UNIT;
      G.mx.push(x);
      G.mz.push(z);
      G.my.push(ground(x, z));
    }
    out.push(G);
  }
  return out;
}

/** One unbroken run of `len` stretches from stretch s0 (a stretch is named by its first point); loop: it closes on itself. */
export interface WallRun { s0: number; len: number; loop: boolean }

/** DrawWalls: the runs of a wall's n exported points (closed or not), broken at each gap. */
export function wallRuns(n: number, closed: boolean, gap: readonly number[]): WallRun[] {
  const out: WallRun[] = [];
  if (n < 2) return out;
  const nst = closed ? n : n - 1;
  let noGapAtAll = closed;   // a closed wall with no gap anywhere is one loop
  for (let s = 0; s < nst; s++) if (gap[s]) noGapAtAll = false;
  if (noGapAtAll) { out.push({ s0: 0, len: nst, loop: true }); return out; }
  for (let s = 0; s < nst; s++) {
    if (gap[s]) continue;
    const prevgap = s === 0 ? (closed ? gap[nst - 1] !== 0 : true) : gap[s - 1] !== 0;
    if (!prevgap) continue;
    let len = 0;
    for (;;) {
      const q = s + len;
      if (!closed && q >= nst) break;
      if (gap[q % nst]) break;
      len++;
      if (len >= nst) break;
    }
    out.push({ s0: s, len, loop: false });
  }
  return out;
}

/** WALLGL_RUNMAX: a run of more vertices than this is not drawn. */
export const WALLGL_RUNMAX = 1032;

/** One vertex of a run (WallGLVert): the centreline point, the half-thickness offset, the base height. */
export interface WallRunVertex { cx: number; cz: number; ox: number; oz: number; y: number }

/** WallGLNormal: the unit normal of the stretch a -> b, to the left of travel in (x, z); null for a zero-length one. */
function stretchNormal(x: readonly number[], z: readonly number[], a: number, b: number): [number, number] | null {
  const dx = x[b]! - x[a]!, dz = z[b]! - z[a]!;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l < 1e-6) return null;
  return [-dz / l, dx / l];
}

/** WallGLRun's vertices: per point of the run its centreline, base and the mitred half-thickness offset. */
export function wallRunVertices(x: readonly number[], z: readonly number[], y: readonly number[], run: WallRun, thick: number): WallRunVertex[] {
  const n = x.length, { s0, len, loop } = run, nv = len + 1;
  const half = thick * 0.5;
  const v: WallRunVertex[] = [];
  if (len < 1 || nv > WALLGL_RUNMAX) return v;
  for (let j = 0; j < nv; j++) {
    const pi = (s0 + j) % n;
    const sp = j > 0 ? (s0 + j - 1) % n : loop ? (s0 + len - 1) % n : -1;
    const sn = j < len ? (s0 + j) % n : loop ? s0 % n : -1;
    const a = sp >= 0 ? stretchNormal(x, z, sp, (sp + 1) % n) : null;
    const c = sn >= 0 ? stretchNormal(x, z, sn, (sn + 1) % n) : null;
    let mx = 0, mz = 0;
    if (a && c) {
      mx = a[0] + c[0];
      mz = a[1] + c[1];
      const l = Math.sqrt(mx * mx + mz * mz);
      if (l < 0.05) { mx = a[0]; mz = a[1]; }   // a reversal: no sensible average, keep the first stretch's
      else {
        let scale = 2.0 / l;   // the miter: keeps the thickness across the corner
        if (scale > 2.0) scale = 2.0;
        mx = (mx / l) * scale;
        mz = (mz / l) * scale;
      }
    } else if (a) { mx = a[0]; mz = a[1]; } else if (c) { mx = c[0]; mz = c[1]; }
    v.push({ cx: x[pi]!, cz: z[pi]!, ox: mx * half, oz: mz * half, y: y[pi]! });
  }
  return v;
}

/** The ribbon's two faces as triangles (feet, [x, y up, z] per corner): each side from the base to base + height. */
export function wallRunTriangles(v: readonly WallRunVertex[], height: number): number[] {
  const out: number[] = [];
  for (const sign of [-1, 1]) {
    for (let j = 0; j + 1 < v.length; j++) {
      const a = v[j]!, b = v[j + 1]!;
      const ax = a.cx + sign * a.ox, az = a.cz + sign * a.oz, bx = b.cx + sign * b.ox, bz = b.cz + sign * b.oz;
      const a0 = [ax, a.y, az], a1 = [ax, a.y + height, az], b0 = [bx, b.y, bz], b1 = [bx, b.y + height, bz];
      out.push(...a0, ...a1, ...b0, ...b0, ...a1, ...b1);
    }
  }
  return out;
}

/** DrawWalls' colours: Outside orange, Inside yellow, None white; the selected one brighter and more solid. */
export function wallColour(side: number, selected: boolean): { rgb: [number, number, number]; alpha: number; lineWidth: number } {
  let rgb: [number, number, number] = side === WALL_SIDE_OUTSIDE ? [1.0, 0.55, 0.05] : side === WALL_SIDE_INSIDE ? [1.0, 0.92, 0.1] : [1.0, 1.0, 1.0];
  let alpha = 0.3, lineWidth = 2.0;
  if (selected) {
    rgb = rgb.map((c) => c + (1.0 - c) * 0.55) as [number, number, number];
    alpha = 0.6;
    lineWidth = 3.0;
  }
  return { rgb, alpha, lineWidth };
}

/** The world copy nearest the grid centre (the renderer's shift; OverlayWalls' label too), feet per axis. */
export function wallViewShift(x0: number, z0: number, gridx: number, gridy: number, worldFt: number): [number, number] {
  return [worldFt * Math.floor((gridx * 32.0 - x0) / worldFt + 0.5), worldFt * Math.floor((gridy * 32.0 - z0) / worldFt + 0.5)];
}

/**
  OverlayWalls: the label's pixel size from the wall's top and base at point 0 on screen. Half their
  distance, held to 12; null (no name) under 7 px. A base that does not project keeps 12 px.
*/
export function wallLabelPx(top: { x: number; y: number }, base: { x: number; y: number } | null): number | null {
  if (!base) return 12;
  const dx = base.x - top.x, dy = base.y - top.y;
  const half = 0.5 * Math.sqrt(dx * dx + dy * dy);
  if (half < 7.0) return null;
  return half > 12.0 ? 12 : Math.trunc(half);
}

/** OverlayWalls: white when hovered, else RGB(255, 230, 64). */
export function wallLabelColour(hovered: boolean): string {
  return hovered ? "#ffffff" : "#ffe640";
}
