/*
  WALLS (Traxx 1.8.2: Include/TrackPODWalls.h, TrackPOD/TrackPODWalls.cpp, CTrackPODWalls): authored
  polylines of straights and circular arcs that a new-style drag or a Parallel race carries in its
  .CPX as the WALL / WPNT chunks (race-rules.ts builds them, OpenPhotex writeCpx lays out the bytes)
  and in the .TXX as the V22 block (encodeWallsBlock / decodeWallsBlock below, for txx.ts).

  Ported 1:1. The C++ does the wall maths in double, as JavaScript does, so no Math.fround here;
  RoundInt and the (int) casts are reproduced exactly (roundInt, cInt).

  UNITS. Every stored int is 1/256 ft (WALL_UNIT per foot). The geometry API takes and returns FEET
  and degrees. Headings: 0 deg = +x, 90 deg = +z.

  BEND SIGN (TrackPODWalls.h). With d = next - this in (x, z), a POSITIVE bend moves the arc's
  midpoint toward (-d.z, +d.x). An arc that starts along +x and curves toward +z (a left turn,
  +angle in appendArc, the heading increasing) bulges toward -z of its chord: a NEGATIVE bend.

  THE WORLD. cells x cells tiles of 32 ft (256 or 512), so 0..cells * 32 ft in x and z. Walls are
  not cleared by a change of N; one left outside a smaller world is reported by problems, the
  preflight and Write POD's range check, as any out-of-range wall is.

  head0 is the start heading of a one-point wall. Like Traxx's, it lives in memory only (TrackWalls
  keeps it beside the walls) and is never saved: a wall loaded with one point heads along +x.
*/
import type { Wall, WallPoint } from "./race-types.ts";
import { WALL_SIDE_NONE } from "./race-types.ts";
import { cFixed } from "./cformat.ts";

export const WALL_MAX_WALLS = 64;
/** Stored, per wall: as many as one exported wall, so a pod read back fits. */
export const WALL_MAX_POINTS = 1024;
export const WALL_MAX_EXPORT_POINTS = 1024;
export const WALL_MAX_EXPORT_TOTAL = 8192;
export const WALL_SUBDIV_FT = 8;
export const WALL_UNIT = 256;
/** char name[32]: at most 31 characters and the NUL. */
export const WALL_NAMELEN = 32;
/** The 256-cell world's side in feet (worldFt() for any N). */
export const WALL_WORLD_FT = 8192;
/** The .TXX block version (CTrackPODWalls::SaveTXX). */
export const WALL_TXX_VERSION = 1;
/** WALL_COORD_LIMIT: the sanity bound on a loaded coordinate, 2^30 - 1. */
export const WALL_COORD_LIMIT = 1073741823;
/** Problems' (and the preflight's) longest stretch, ft. */
export const WALL_LONGEST_STRETCH_FT = 4096;

const WALL_PI = 3.14159265358979323846;

/** One exported point (WallExportPoint): a WPNT record. */
export interface WallExportPoint {
  x: number;
  z: number;
  baseY: number;
  bend: number;
  above: number;
  gap: number;
}

/** The ground under a wall for Export: feet in, feet out (Write POD passes VegGroundHeight). */
export type WallGroundFn = (xft: number, zft: number) => number;

/** (int)v for a double, as MSVC's cvttsd2si does it: truncation, 0x80000000 when out of range. */
export function cInt(v: number): number {
  const t = Math.trunc(v);
  return t >= -2147483648 && t <= 2147483647 ? t | 0 : -2147483648;
}

/** RoundInt (TrackPODWalls.cpp): half away from zero. */
export function roundInt(v: number): number {
  if (v < 0.0) return -cInt(Math.floor(-v + 0.5)) | 0;
  return cInt(Math.floor(v + 0.5));
}

const toRad = (deg: number) => deg * WALL_PI / 180.0;
const toDeg = (rad: number) => rad * 180.0 / WALL_PI;

function inWorld(v: number, ft: number): boolean {
  return v >= 0 && v <= ft * WALL_UNIT;
}

/** HalfAngle: half the total turn of the arc over a chord c with signed bend s (both feet), 2 atan(2|s|/c). */
export function halfAngle(c: number, s: number): number {
  if (c <= 0.0) return 0.0;
  return 2.0 * Math.atan(2.0 * Math.abs(s) / c);
}

/** C's abs() on an int. */
const iabs = (v: number) => Math.abs(v);

export function wallDefaults(name = ""): Wall {
  return { name: truncName(name), side: WALL_SIDE_NONE, closed: 0, noline: 0, thickness: 1 * WALL_UNIT, height: 20 * WALL_UNIT, points: [] };
}

export function wallPointDefaults(): WallPoint {
  return { x: 0, z: 0, bend: 0, above: 0, gap: 0 };
}

/** strncpy(name, WALL_NAMELEN - 1) with the last byte NUL: at most 31 characters, cut at a NUL. */
function truncName(name: string): string {
  const nul = name.indexOf("\0");
  return (nul >= 0 ? name.slice(0, nul) : name).slice(0, WALL_NAMELEN - 1);
}

function cloneWall(w: Wall): Wall {
  return { ...w, points: w.points.map((p) => ({ ...p })) };
}

/**
  CTrackPODWalls::Export: wall w subdivided into pieces of about 8 ft, as the WPNT chunk wants.
  Skips a stretch whose end points coincide (and its start point), so no two points in a row are
  equal and the closing point of a closed wall is never a copy of point 0. `count` is every point
  the wall needs (-1 when over `max` or WALL_MAX_EXPORT_POINTS, 0 when under 2 are left); `points`
  holds the ones written, the first min(max, 1024).
*/
export function exportWall(p: Wall, ground: WallGroundFn | null = null, max = WALL_MAX_EXPORT_POINTS): { count: number; points: WallExportPoint[] } {
  const out: WallExportPoint[] = [];
  const np = p.points.length;
  if (np < 2) return { count: 0, points: out };
  let count = 0;
  const nst = p.closed ? np : np - 1;

  for (let s = 0; s < nst; s++) {
    const A = p.points[s]!;
    const B = p.points[(s + 1) % np]!;
    const ax = A.x / WALL_UNIT, az = A.z / WALL_UNIT;
    const dx = (B.x - A.x) / WALL_UNIT, dz = (B.z - A.z) / WALL_UNIT;
    const c = Math.sqrt(dx * dx + dz * dz);
    const bf = A.bend / WALL_UNIT;
    const arc = A.bend !== 0 && c > 0.0;
    let R = 0.0, phi = 0.0, T = 0.0, a0 = 0.0, sgnT = 1.0, arclen = c;
    const h = Math.atan2(dz, dx);
    let subbend = 0;

    // A stretch whose end points coincide (once rounded to 1/256 ft) is skipped, its start point with it.
    if (A.x === B.x && A.z === B.z) continue;

    if (arc) {
      const sa = Math.abs(bf);
      R = (c * c / 4.0 + sa * sa) / (2.0 * sa);
      phi = halfAngle(c, sa);
      a0 = h + (bf > 0.0 ? phi : -phi);
      T = bf > 0.0 ? -2.0 * phi : 2.0 * phi;
      sgnT = T > 0.0 ? 1.0 : -1.0;
      arclen = R * 2.0 * phi;
    }

    // 1/64 ft of slack: a piece read back from a pod (rounded to 1/256 ft) is a hair over 8 ft at
    // worst and must stay one piece, or a re-saved pod would grow.
    let k = cInt(Math.ceil((arclen - 1.0 / 64.0) / WALL_SUBDIV_FT));
    if (k < 1) k = 1;
    if (arc) subbend = roundInt((bf > 0.0 ? 1.0 : -1.0) * R * (1.0 - Math.cos(Math.abs(T) / (2.0 * k))) * WALL_UNIT);

    for (let i = 0; i < k; i++) {
      const t = i / k;
      const ab = A.above + (B.above - A.above) * t;
      let x: number, z: number;
      if (arc && i > 0) {
        const psi = T * t;
        x = ax + (R / sgnT) * (Math.sin(a0 + psi) - Math.sin(a0));
        z = az + (R / sgnT) * (Math.cos(a0) - Math.cos(a0 + psi));
      } else {
        x = ax + dx * t;
        z = az + dz * t;
      }
      if (count < max && count < WALL_MAX_EXPORT_POINTS) {
        out.push({
          x: roundInt(x * WALL_UNIT), z: roundInt(z * WALL_UNIT), above: roundInt(ab),
          baseY: roundInt((ground ? ground(x, z) : 0.0) * WALL_UNIT + ab), bend: subbend, gap: A.gap,
        });
      }
      count++;
    }
  }

  if (!p.closed) {
    const L = p.points[np - 1]!;
    if (count < max && count < WALL_MAX_EXPORT_POINTS) {
      const x = L.x / WALL_UNIT, z = L.z / WALL_UNIT;
      out.push({ x: L.x, z: L.z, above: L.above, baseY: roundInt((ground ? ground(x, z) : 0.0) * WALL_UNIT + L.above), bend: 0, gap: 0 });
    }
    count++;
  }

  if (count > max || count > WALL_MAX_EXPORT_POINTS) return { count: -1, points: out };
  if (count < 2) return { count: 0, points: out };   // every point on the same spot: nothing to export
  return { count, points: out };
}

/** CTrackPODWalls::PointsOutOfWorld: true if any of the exported points lies outside 0..worldFt ft in x or z. */
export function pointsOutOfWorld(e: readonly WallExportPoint[], n: number, worldFt: number): boolean {
  for (let i = 0; i < n && i < e.length; i++) if (!inWorld(e[i]!.x, worldFt) || !inWorld(e[i]!.z, worldFt)) return true;
  return false;
}

/** The longest authored stretch of a wall in feet (the closing one included when closed), as Problems measures it. */
export function wallLongestStretchFt(p: Wall): number {
  const np = p.points.length;
  const nst = np < 2 ? 0 : (p.closed ? np : np - 1);
  let longest = 0.0;
  for (let i = 0; i < nst; i++) {
    const a = p.points[i]!, b = p.points[(i + 1) % np]!;
    const dx = (b.x - a.x) / WALL_UNIT, dz = (b.z - a.z) / WALL_UNIT;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > longest) longest = d;
  }
  return longest;
}

/**
  CTrackPODWalls: the walls of a track (the array RaceRules.walls holds, kept by reference and edited
  in place), the world size and the in-memory head0 per wall. Methods keep Traxx's names, return
  values and refusals.
*/
export class TrackWalls {
  /** The walls, edited in place (pass a track's RaceRules.walls to edit it). */
  walls: Wall[];
  /** The start heading (deg) of a one-point wall, per wall; in memory only. */
  head0: number[];
  private cells: number;

  constructor(walls: Wall[] = [], cells = 256) {
    this.walls = walls;
    this.head0 = walls.map(() => 0);
    this.cells = cells === 512 ? 512 : 256;
  }

  get nwalls(): number {
    return this.walls.length;
  }

  /** Clear: keeps the world size and the array. */
  clear(): void {
    this.walls.length = 0;
    this.head0.length = 0;
  }

  /** SetWorldCells: true, or false (unchanged) for anything but 256 or 512. */
  setWorldCells(n: number): boolean {
    if (n !== 256 && n !== 512) return false;
    this.cells = n;
    return true;
  }

  cellsCount(): number {
    return this.cells;
  }

  worldFt(): number {
    return this.cells * 32;
  }

  /** CopyFrom: the walls (deep), head0 and the world size; this object's array is kept. */
  copyFrom(o: TrackWalls): void {
    if (o === this) return;
    this.cells = o.cells;
    this.walls.length = 0;
    for (const w of o.walls) this.walls.push(cloneWall(w));
    this.head0 = o.walls.map((_, i) => o.h0(i));
  }

  private h0(w: number): number {
    return this.head0[w] ?? 0;
  }

  /** AddWall: the index, or -1 at 64 walls. Thickness 1 ft, height 20 ft, side NONE. */
  addWall(name: string | null): number {
    if (this.walls.length >= WALL_MAX_WALLS) return -1;
    const i = this.walls.length;
    this.walls.push(wallDefaults(name ?? ""));
    this.head0[i] = 0.0;
    return i;
  }

  deleteWall(w: number): void {
    if (w < 0 || w >= this.walls.length) return;
    this.walls.splice(w, 1);
    this.head0.splice(w, 1);
  }

  /** InsertPoint: after -1 = at the start; the index or -1. The new point's above is its neighbour's. */
  insertPoint(w: number, after: number, x: number, z: number): number {
    if (w < 0 || w >= this.walls.length) return -1;
    const p = this.walls[w]!;
    const np = p.points.length;
    if (np >= WALL_MAX_POINTS || after < -1 || after >= np) return -1;
    if (!inWorld(x, this.worldFt()) || !inWorld(z, this.worldFt())) return -1;
    let above = 0;
    if (np > 0) above = after >= 0 ? p.points[after]!.above : p.points[0]!.above;   // the neighbour's height
    const i = after + 1;
    p.points.splice(i, 0, { x, z, bend: 0, above, gap: 0 });
    return i;
  }

  deletePoint(w: number, pi: number): void {
    if (w < 0 || w >= this.walls.length) return;
    const p = this.walls[w]!;
    if (pi < 0 || pi >= p.points.length) return;
    if (p.points.length === 2) this.head0[w] = this.endHeadingDeg(w);   // down to one point: keep the heading the stretch had
    p.points.splice(pi, 1);
  }

  /** EndHeadingDeg: the tangent at the last point (arc-aware), past zero-length stretches; head0 when there is none. */
  endHeadingDeg(w: number): number {
    if (w < 0 || w >= this.walls.length) return 0.0;
    const p = this.walls[w]!;
    for (let i = p.points.length - 2; i >= 0; i--) {
      const dx = p.points[i + 1]!.x - p.points[i]!.x;
      const dz = p.points[i + 1]!.z - p.points[i]!.z;
      const c = Math.sqrt(dx * dx + dz * dz);
      if (c <= 0.0) continue;
      let h = toDeg(Math.atan2(dz, dx));
      const b = p.points[i]!.bend;
      if (b !== 0.0) {
        const phi = toDeg(halfAngle(c, b));
        h -= b > 0.0 ? phi : -phi;   // end tangent = chord heading - sign(bend) * half angle
      }
      return h;
    }
    return this.h0(w);
  }

  /** SetStartAndHeading: for an empty wall, inside the world. 0 or -1. */
  setStartAndHeading(w: number, xft: number, zft: number, headingDeg: number): number {
    if (w < 0 || w >= this.walls.length || this.walls[w]!.points.length !== 0) return -1;
    const ft = this.worldFt();
    if (!(xft >= 0.0 && xft <= ft && zft >= 0.0 && zft <= ft)) return -1;
    this.walls[w]!.points.push({ x: roundInt(xft * WALL_UNIT), z: roundInt(zft * WALL_UNIT), bend: 0, above: 0, gap: 0 });
    this.head0[w] = headingDeg;
    return 0;
  }

  /**
    AppendStraight: from the last point along the end heading. 0, or -1 under 1/256 ft, with no
    point to start from, at the cap, or leaving the world. On a closed wall it overwrites the last
    point's bend and gap (they belong to the closing stretch).
  */
  appendStraight(w: number, lengthFt: number): number {
    if (w < 0 || w >= this.walls.length || lengthFt * WALL_UNIT < 1.0) return -1;
    const p = this.walls[w]!;
    const np = p.points.length;
    if (np < 1 || np >= WALL_MAX_POINTS) return -1;
    const h = toRad(this.endHeadingDeg(w));
    const last = p.points[np - 1]!;
    const nx = last.x + lengthFt * WALL_UNIT * Math.cos(h), nz = last.z + lengthFt * WALL_UNIT * Math.sin(h);
    const lim = this.worldFt() * WALL_UNIT + 0.5;
    if (!(nx >= -0.5 && nx <= lim && nz >= -0.5 && nz <= lim)) return -1;
    p.points.push({
      ...last,
      x: roundInt(last.x + lengthFt * WALL_UNIT * Math.cos(h)), z: roundInt(last.z + lengthFt * WALL_UNIT * Math.sin(h)), bend: 0, gap: 0,
    });
    last.bend = 0;
    last.gap = 0;
    if (np === 1) this.head0[w] = toDeg(h);
    return 0;
  }

  /**
    AppendArc: + turns toward +heading; over 180 deg it is split into stretches of at most 180. The
    points Export would put along each sub-arc must be inside the world too (an arc can bulge out
    past its end points); otherwise the wall is put back as it was and -1 returned.
  */
  appendArc(w: number, radiusFt: number, angleDeg: number): number {
    if (w < 0 || w >= this.walls.length || radiusFt <= 0.0 || angleDeg === 0.0) return -1;
    const p = this.walls[w]!;
    if (p.points.length < 1) return -1;
    let n = cInt(Math.ceil(Math.abs(angleDeg) / 180.0 - 1e-9));
    if (n < 1) n = 1;
    if (p.points.length + n > WALL_MAX_POINTS) return -1;

    const a = angleDeg / n;
    const sg = a > 0.0 ? 1.0 : -1.0;
    let h = this.endHeadingDeg(w);
    if (p.points.length === 1) this.head0[w] = h;
    const n0 = p.points.length;
    const saved = { ...p.points[n0 - 1]! };
    const savedHead = this.h0(w);
    const ft = this.worldFt();
    const lim = ft * WALL_UNIT + 0.5;

    for (let i = 0; i < n; i++) {
      const last = p.points[p.points.length - 1]!;
      const hc = toRad(h + a / 2.0);
      const chord = 2.0 * radiusFt * Math.sin(toRad(Math.abs(a)) / 2.0) * WALL_UNIT;
      const x = last.x + chord * Math.cos(hc);
      const z = last.z + chord * Math.sin(hc);
      let bad = !(x >= -0.5 && x <= lim && z >= -0.5 && z <= lim);

      if (!bad) {
        // the points Export puts along this sub-arc (one per 8 ft, as RoundInt'd ints) must be inside too
        const rr = radiusFt * WALL_UNIT, arclen = radiusFt * toRad(Math.abs(a));
        const m = cInt(Math.ceil(arclen / WALL_SUBDIV_FT)) + 1;
        const h0 = toRad(h);
        for (let j = 1; j < m && !bad; j++) {
          const phi = toRad(a) * j / m;
          const px = last.x + rr * sg * (Math.sin(h0 + phi) - Math.sin(h0));
          const pz = last.z + rr * sg * (Math.cos(h0) - Math.cos(h0 + phi));
          if (!inWorld(roundInt(px), ft) || !inWorld(roundInt(pz), ft)) bad = true;
        }
      }

      if (bad) {
        // leaves the world: put the wall back as it was
        p.points.length = n0;
        p.points[n0 - 1] = saved;
        this.head0[w] = savedHead;
        return -1;
      }

      p.points.push({ ...last, x: roundInt(x), z: roundInt(z), bend: 0, gap: 0 });
      // the bend lies on the side of the chord the arc bulges to; a turn toward +heading bulges to
      // the opposite side of (-d.z, +d.x), so its bend is negative
      last.bend = roundInt(-sg * radiusFt * (1.0 - Math.cos(toRad(Math.abs(a)) / 2.0)) * WALL_UNIT);
      last.gap = 0;
      this.clampBend(w, p.points.length - 2);
      h += a;
    }
    return 0;
  }

  /** ClampBend: |bend| <= floor(chord / 2); 1 if it was clamped. The closing stretch counts on a closed wall. */
  clampBend(w: number, pi: number): number {
    if (w < 0 || w >= this.walls.length) return 0;
    const p = this.walls[w]!;
    const np = p.points.length;
    if (pi < 0 || pi >= np) return 0;
    const a = p.points[pi]!;
    let b: WallPoint;
    if (pi + 1 < np) b = p.points[pi + 1]!;
    else if (p.closed && np > 1) b = p.points[0]!;
    else return 0;
    const dx = b.x - a.x, dz = b.z - a.z;
    const lim = Math.floor(Math.sqrt(dx * dx + dz * dz) / 2.0);
    if (iabs(a.bend) <= lim) return 0;
    a.bend = a.bend > 0 ? cInt(lim) : -cInt(lim) | 0;
    return 1;
  }

  /** NearPoint: the closest point within reachFt of (xFt, zFt); ties keep the first found. */
  nearPoint(xft: number, zft: number, reachFt: number): { wall: number; point: number } | null {
    let bw = -1, bp = -1;
    let best = reachFt * reachFt;
    for (let i = 0; i < this.walls.length; i++) {
      const pts = this.walls[i]!.points;
      for (let k = 0; k < pts.length; k++) {
        const dx = pts[k]!.x / WALL_UNIT - xft;
        const dz = pts[k]!.z / WALL_UNIT - zft;
        const d = dx * dx + dz * dz;
        if (d <= best && (bw < 0 || d < best)) {
          best = d;
          bw = i;
          bp = k;
        }
      }
    }
    return bw < 0 ? null : { wall: bw, point: bp };
  }

  /** CTrackPODWalls::Export of wall w (exportWall); an index out of range exports nothing. */
  export(w: number, ground: WallGroundFn | null = null, max = WALL_MAX_EXPORT_POINTS): { count: number; points: WallExportPoint[] } {
    if (w < 0 || w >= this.walls.length) return { count: 0, points: [] };
    return exportWall(this.walls[w]!, ground, max);
  }

  /** ExportOutOfWorld: true if wall w, as Write POD exports it, has a point outside this world. */
  exportOutOfWorld(w: number): boolean {
    if (w < 0 || w >= this.walls.length || this.walls[w]!.points.length < 2) return false;
    const e = exportWall(this.walls[w]!, null, WALL_MAX_EXPORT_POINTS);
    const n = e.count < 0 ? WALL_MAX_EXPORT_POINTS : e.count;   // over the cap: the points that were written still count
    return pointsOutOfWorld(e.points, n, this.worldFt());
  }

  /**
    Problems: the defects the preflight would report on wall w, in its words, one string each (the
    Wall window joins them with CR LF: problemsText). Also notes a bend larger than half its
    stretch (it may be clamped when edited).
  */
  problems(w: number): string[] {
    const out: string[] = [];
    if (w < 0 || w >= this.walls.length) return out;
    const p = this.walls[w]!;
    const nm = p.name;
    const np = p.points.length;
    const ft = this.worldFt();

    if (np < 2) out.push(`Wall "${nm}" has ${np} point(s); a wall needs at least 2.`);
    else if (p.closed && np < 3) out.push(`Wall "${nm}" is closed with ${np} points; a closed wall needs at least 3.`);
    if (p.thickness <= 0) out.push(`Wall "${nm}" has no thickness; it must be greater than 0.`);
    if (p.height <= 0) out.push(`Wall "${nm}" has no height; it must be greater than 0.`);

    let outpoint = false;
    for (let i = 0; i < np; i++) {
      if (!inWorld(p.points[i]!.x, ft) || !inWorld(p.points[i]!.z, ft)) {
        out.push(`Wall "${nm}": point ${i + 1} is outside the world (0 to ${ft} ft).`);
        outpoint = true;
      }
    }
    if (!outpoint && this.exportOutOfWorld(w)) out.push(`Wall "${nm}" goes outside the world (0 to ${ft} ft).`);   // an arc bulges out

    const nst = np < 2 ? 0 : (p.closed ? np : np - 1);
    let longest = 0.0, over = 0;
    for (let i = 0; i < nst; i++) {
      const a = p.points[i]!, b = p.points[(i + 1) % np]!;
      const dx = (b.x - a.x) / WALL_UNIT, dz = (b.z - a.z) / WALL_UNIT;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > longest) longest = d;
      if (iabs(a.bend) > Math.floor(d * WALL_UNIT / 2.0)) over++;
    }
    if (longest > WALL_LONGEST_STRETCH_FT) {
      out.push(`Wall "${nm}" has a stretch of ${cFixed(longest, 0)} ft; the longest allowed is ${cFixed(WALL_LONGEST_STRETCH_FT, 0)} ft.`);
    }
    if (nst > 0 && exportWall(p, null, WALL_MAX_EXPORT_POINTS).count < 0) {
      out.push(`Wall "${nm}" needs more than ${WALL_MAX_EXPORT_POINTS} points once subdivided (the most one wall can have); shorten it or split it.`);
    }
    if (over > 0) out.push(`Wall "${nm}" has ${over} bend(s) larger than half their stretch; they may be clamped.`);
    return out;
  }

  /** The Wall window's list: problems joined with CR LF. */
  problemsText(w: number): string {
    return this.problems(w).join("\r\n");
  }
}

/** Thrown by decodeWallsBlock for a block that aborts the .TXX load (LoadTXX returns 0). */
export class WallsBlockError extends Error {
  override name = "WallsBlockError";
}

/**
  CTrackPODWalls::SaveTXX, block version 1, every number a little-endian int:
    int 1, int nwalls, then per wall char name[32], int side, closed, noline, thickness, height,
    npoints, then npoints x { int x, z, bend, above, gap }.
  The name is written NUL-padded (Traxx writes its 32 raw bytes, which AddWall zero-fills).
*/
export function encodeWallsBlock(walls: readonly Wall[]): Uint8Array {
  const n = walls.length;
  let size = 8;
  for (let i = 0; i < n && i < WALL_MAX_WALLS; i++) size += WALL_NAMELEN + 24 + Math.min(walls[i]!.points.length, WALL_MAX_POINTS) * 20;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let o = 0;
  const put = (x: number) => { v.setInt32(o, x | 0, true); o += 4; };
  put(WALL_TXX_VERSION);
  put(n);
  for (let i = 0; i < n && i < WALL_MAX_WALLS; i++) {
    const w = walls[i]!;
    const name = truncName(w.name);
    for (let k = 0; k < name.length; k++) out[o + k] = name.charCodeAt(k) & 0xff;
    o += WALL_NAMELEN;
    put(w.side); put(w.closed); put(w.noline); put(w.thickness); put(w.height); put(w.points.length);
    for (let k = 0; k < w.points.length && k < WALL_MAX_POINTS; k++) {
      const pt = w.points[k]!;
      put(pt.x); put(pt.z); put(pt.bend); put(pt.above); put(pt.gap);
    }
  }
  return out;
}

/**
  CTrackPODWalls::LoadTXX: the block at `offset`, and its length in bytes. Throws a WallsBlockError
  where Traxx's load fails (and clears the walls, aborting the .TXX load): a block version other
  than 1, a count outside 0..64, side outside 0..2, closed or noline not 0 / 1, a thickness or
  height outside 1..2^30 - 1, a point count outside 0..1024, a coordinate, bend or above outside
  +-(2^30 - 1), a gap not 0 / 1, or a file that ends inside the block. name[31] is forced to NUL.
*/
export function decodeWallsBlock(bytes: Uint8Array, offset: number): { walls: Wall[]; length: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = offset;
  const get = (what: string) => {
    if (o + 4 > bytes.length) throw new WallsBlockError(`the file ends inside ${what}`);
    const x = v.getInt32(o, true);
    o += 4;
    return x;
  };
  const corrupt = (what: string) => new WallsBlockError(`the walls block is corrupt (${what})`);
  const version = get("the walls block");
  if (version !== WALL_TXX_VERSION) throw corrupt(`block version ${version}`);
  const n = get("the walls block");
  if (n < 0 || n > WALL_MAX_WALLS) throw corrupt(`${n} walls`);
  const walls: Wall[] = [];
  for (let i = 0; i < n; i++) {
    if (o + WALL_NAMELEN > bytes.length) throw new WallsBlockError("the file ends inside a wall's name");
    let name = "";
    for (let k = 0; k < WALL_NAMELEN - 1 && bytes[o + k] !== 0; k++) name += String.fromCharCode(bytes[o + k]!);
    o += WALL_NAMELEN;
    const side = get("a wall");
    if (side < 0 || side > 2) throw corrupt(`wall ${i + 1} side ${side}`);
    const closed = get("a wall");
    if (closed < 0 || closed > 1) throw corrupt(`wall ${i + 1} closed ${closed}`);
    const noline = get("a wall");
    if (noline < 0 || noline > 1) throw corrupt(`wall ${i + 1} noline ${noline}`);
    const th = get("a wall");
    if (th <= 0 || th > WALL_COORD_LIMIT) throw corrupt(`wall ${i + 1} thickness ${th}`);
    const ht = get("a wall");
    if (ht <= 0 || ht > WALL_COORD_LIMIT) throw corrupt(`wall ${i + 1} height ${ht}`);
    const np = get("a wall");
    if (np < 0 || np > WALL_MAX_POINTS) throw corrupt(`wall ${i + 1} has ${np} points`);
    const points: WallPoint[] = [];
    for (let k = 0; k < np; k++) {
      const x = get("a wall point"), z = get("a wall point"), bend = get("a wall point"), above = get("a wall point"), gap = get("a wall point");
      const out = (c: number) => c < -WALL_COORD_LIMIT || c > WALL_COORD_LIMIT;
      if (out(x) || out(z) || out(bend) || out(above) || (gap !== 0 && gap !== 1)) throw corrupt(`wall ${i + 1} point ${k + 1}`);
      points.push({ x, z, bend, above, gap: gap as 0 | 1 });
    }
    walls.push({ name, side, closed: closed as 0 | 1, noline: noline as 0 | 1, thickness: th, height: ht, points });
  }
  return { walls, length: o - offset };
}
