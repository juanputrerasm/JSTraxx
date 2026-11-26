/*
  The Walls edit mode's and the Wall window's pure rules (Traxx 1.8.2, Traxx/TraxxViewWalls.cpp and
  Traxx/WallDlg.cpp). The model itself (points, bends, ClampBend, NearPoint, Export, Problems) is
  core/traxx/walls.ts; this file is what the view and the window add on top: the default name, the
  pick reach, the right-click menu's target and enables, the world-seam guard, and the window's
  feet boxes and list rows. Plain data, no DOM.
*/
import { WALL_MAX_POINTS, WALL_MAX_WALLS, WALL_UNIT } from "../traxx/walls.ts";
import type { Wall, WallPoint } from "../traxx/race-types.ts";

/** WALL_HOVER_PIXELS: a point this close to the pointer is the one under it. */
export const WALL_HOVER_PIXELS = 20;
/** WALL_MENU_PIXELS: the menu's target when no point is under the pointer, the nearest within this. */
export const WALL_MENU_PIXELS = 100;
/** WALL_CAPTURE_MIN_FT: a new point closer than this to the last one is ignored. */
export const WALL_CAPTURE_MIN_FT = 1.0;
/** WALL_REACH_MAX_FT: the pixel reach is never more than this (a pick near the horizon). */
export const WALL_REACH_MAX_FT = 1000.0;
/** WALLDLG_LIMIT_FT: a typed length beyond this is held there. */
export const WALLDLG_LIMIT_FT = 1000000.0;

/* Every message the view and the window give, in Traxx's words. */
export const WALL_MSG_FULL = "The track already has the most walls it can hold.";
export const WALL_MSG_TOO_FAR_PREV = "Too far from the previous point (the world edge?)";
export const WALL_MSG_TOO_FAR_NEIGHBOURS = "Too far from the neighbouring points (the world edge?)";
export const WALL_MSG_BEND_CLAMPED = "A bend can be at most half its stretch; it was reduced.";
export const WALL_MSG_CLOSED_DROPPED = "The last point was on the first one, so it was removed.";
export const WALL_MSG_HAS_POINTS = "The wall already has points.";
export const WALL_MSG_STRAIGHT_LENGTH = "The straight needs a length of at least 1/256 ft.";
export const WALL_MSG_STRAIGHT_FULL = "The straight could not be added (the wall is full).";
export const WALL_MSG_LEAVES_WORLD = "That piece would leave the world.";
export const WALL_MSG_ARC_RADIUS = "The arc needs a radius above 0.";
export const WALL_MSG_ARC_ANGLE = "The arc needs an angle above 0 degrees.";
export const WALL_MSG_ARC_FULL = "The arc could not be added (the wall would have too many points).";
export const WALL_MSG_NO_PROBLEMS = "No problems.";
export const WALL_MSG_KEEP = "The wall needs a thickness and a height above 0 before it can be kept.";
export const WALL_MSG_KEEP_MODESWITCH = "The wall needs a thickness and a height above 0 before it can be kept, "
  + "so the edit to it is being cancelled and the wall put back as it was.";

/** WallCaptureStatus: the status line while a new wall is being clicked out. */
export function wallCaptureStatus(n: number): string {
  return `New wall: ${n} point${n === 1 ? "" : "s"} - click along the wall; Enter or right-click finishes, Backspace drops a point, Esc cancels`;
}

/** WallMouseMove's note for a wall over the export cap. */
export function wallTooLongNote(name: string, max: number): string {
  return `Wall "${name}" is too long to draw (over ${max} points)`;
}

/** OnWallDelete's question. */
export function wallDeleteQuestion(w: Wall): string {
  const n = w.points.length;
  return `Delete the wall "${w.name}" (${n} point${n === 1 ? "" : "s"})?`;
}

/** WallCaptureFinish: "Wall 1", "Wall 2", ... the first no other wall has (compared as _stricmp does, ignoring case). */
export function wallFreeName(walls: readonly Pick<Wall, "name">[]): string {
  const taken = new Set(walls.map((w) => w.name.toLowerCase()));
  for (let k = 1; ; k++) {
    const name = `Wall ${k}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Feet to 1/256 ft as the view stores a pick: (int)floor(ft * WALL_UNIT + 0.5). */
export function wallUnits(ft: number): number {
  return Math.floor(ft * WALL_UNIT + 0.5);
}

/** WALL_SEAM_FT: a stretch longer than half the world (4096 ft at 256) is the world seam. */
export function wallSeamFt(worldFt: number): number {
  return worldFt * 0.5;
}

/** WallTooFar: two wall positions (1/256 ft) further apart than the seam guard allows (a wrapped pick). */
export function wallTooFar(worldFt: number, x0: number, z0: number, x1: number, z1: number): boolean {
  const dx = (x1 - x0) / WALL_UNIT, dz = (z1 - z0) / WALL_UNIT;
  const seam = wallSeamFt(worldFt);
  return dx * dx + dz * dz > seam * seam;
}

/**
  WallReachFeet: from the ground distances to the picks `pixels` to the right and below (null when
  that pick missed the ground), the larger, held under WALL_REACH_MAX_FT * pixels / 20 and over 0.5 ft.
*/
export function wallReachFeet(right: number | null, below: number | null, pixels: number = WALL_HOVER_PIXELS): number {
  let best = 0.0;
  if (right !== null && right > best) best = right;
  if (below !== null && below > best) best = below;
  const cap = (WALL_REACH_MAX_FT * pixels) / WALL_HOVER_PIXELS;
  if (best > cap) best = cap;
  if (best < 0.5) best = 0.5;
  return best;
}

/**
  WallHitTest with the Wall window open: only the edited wall's points can be hit; the nearest within
  `reachFt` (ties keep the first), or -1.
*/
export function wallNearestOnWall(w: Wall, xft: number, zft: number, reachFt: number): number {
  let best = reachFt * reachFt, bp = -1;
  w.points.forEach((pt, k) => {
    const dx = pt.x / WALL_UNIT - xft, dz = pt.z / WALL_UNIT - zft;
    const d = dx * dx + dz * dz;
    if (d <= best && (bp < 0 || d < best)) { best = d; bp = k; }
  });
  return bp;
}

/** The point the right-click menu acts on: under the pointer (20 px), else the nearest within 100 px, else none. */
export interface WallMenuTarget { hit: boolean; w: number; p: number }

/** WallContextMenu's target rule from the two hit tests (null = no point within that reach). */
export function wallMenuTarget(under: { w: number; p: number } | null, near: { w: number; p: number } | null): WallMenuTarget {
  if (under) return { hit: true, w: under.w, p: under.p };
  if (near) return { hit: false, w: near.w, p: near.p };
  return { hit: false, w: -1, p: -1 };
}

/** The Walls popup's enables (WallContextMenu). */
export interface WallMenuEnables { newWall: boolean; insertPoint: boolean; deletePoint: boolean; properties: boolean; deleteWall: boolean }

/**
  `ok`: the click is on the ground; `target`: the menu's point; `npoints`: the target wall's points;
  `dialogOpen`: the Wall window is up (New Wall and Delete Wall are off; only its wall is reachable).
*/
export function wallMenuEnables(ok: boolean, target: WallMenuTarget, nwalls: number, npoints: number, dialogOpen: boolean): WallMenuEnables {
  const has = target.w >= 0;
  return {
    newWall: ok && nwalls < WALL_MAX_WALLS && !dialogOpen,
    insertPoint: ok && has && npoints < WALL_MAX_POINTS,
    deletePoint: target.hit,
    properties: has,
    deleteWall: has && !dialogOpen,
  };
}

/* ---- The Wall window's boxes (WallDlg.cpp) ---- */

/** Ft: a length in feet as the boxes show it, two decimals, never "-0.00". */
export function wallFt(raw: number): string {
  const s = (raw / WALL_UNIT).toFixed(2);
  return s === "-0.00" ? "0.00" : s;
}

/** Raw: feet to 1/256 ft, rounded, held to WALLDLG_LIMIT_FT. */
export function wallRaw(ft: number): number {
  if (ft > WALLDLG_LIMIT_FT) ft = WALLDLG_LIMIT_FT;
  if (ft < -WALLDLG_LIMIT_FT) ft = -WALLDLG_LIMIT_FT;
  return Math.floor(ft * WALL_UNIT + 0.5);
}

/** InWorldFt: a position held inside the world, in feet. */
export function wallInWorldFt(ft: number, worldFt: number): number {
  if (ft < 0.0) return 0.0;
  if (ft > worldFt) return worldFt;
  return ft;
}

/**
  ReadBox: a box's text as a number, or null while it has no digit yet ("", "-", ".") or reads as
  no finite number (1e999). atof reads the leading number and gives 0 for none.
*/
export function wallReadBox(text: string): number | null {
  if (!/[0-9]/.test(text)) return null;
  const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text);
  const v = m ? Number(m[0]) : 0;
  return Number.isFinite(v) ? v : null;
}

/** RowText: "3: 120.00, 45.50, bend 0.00, above 0.00, gap" (the point number counts from 1). */
export function wallRowText(pt: WallPoint, p: number): string {
  return `${p + 1}: ${wallFt(pt.x)}, ${wallFt(pt.z)}, bend ${wallFt(pt.bend)}, above ${wallFt(pt.above)}${pt.gap ? ", gap" : ""}`;
}

/** LoadPoint: the bend and the gap belong to the stretch that starts at point `sel` (an open wall's last point has none). */
export function wallPointHasStretch(w: Wall, sel: number): boolean {
  const n = w.points.length;
  return sel >= 0 && sel < n && (sel < n - 1 || (w.closed === 1 && n > 1));
}

/** SpinStep: 5 for the heading and the arc angle, else 1 (ft). */
export function wallSpinStep(box: "starthead" | "arcangle" | string): number {
  return box === "starthead" || box === "arcangle" ? 5.0 : 1.0;
}

/** OnAddArc's refusal: "too many points" when the pieces of at most 180 degrees would overflow, else "leaves the world". */
export function wallArcFailure(npoints: number, angleDeg: number): string {
  return npoints + Math.ceil(angleDeg / 180.0 - 1e-9) > WALL_MAX_POINTS ? WALL_MSG_ARC_FULL : WALL_MSG_LEAVES_WORLD;
}

/** A deep copy of a track's walls (the window's backup, the undo's before). */
export function cloneWalls(walls: readonly Wall[]): Wall[] {
  return walls.map((w) => ({ ...w, points: w.points.map((p) => ({ ...p })) }));
}
