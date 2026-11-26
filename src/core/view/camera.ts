/*
  Traxx's fly camera (Traxx/TraxxView.cpp: NavigationTick, OnKeyDown, OnKeyUp, OnMapClick and
  the F2/F3/F4 handlers). Pure state and rules; the renderer turns it into a three.js camera.

  Units are Traxx's own:
    x, y         ipos, 64 per terrain cell, 0..16383 (0..64 N - 1 in a track format version 6
                 world of N cells, spec section 8.1: the camera roams the whole world)
    z            ALTITUDESCALE (3) per terrain step, 0..2304 (on a version 6 track whose ground
                 goes below 0 or above 512 ft, the range follows the ground: setWorld)
    orientation  tenths of a degree, 0..3599, 0 looking north, increasing clockwise
    elevation    tenths of a degree, 0..1800: 900 level, 1800 straight down
  The grid window follows the camera in steps of two cells (gridx, gridy).
*/

export const ALTITUDE_SCALE = 3;
export const MAX_XY_CHANGE = 500;
export const MAX_ARG_CHANGE = 50;
export const MAX_Z_CHANGE = ALTITUDE_SCALE * 10;
export const MAX_Z_POSITION = 3 * ALTITUDE_SCALE * 256;

/**
  CTraxxView::CameraMaxZ (Traxx origin/main): the camera's ceiling in scene z (1.5 per ft). MAX_Z_POSITION
  (1,536 ft) on a classic or Standard V6 track; on a Tall Heights track the terrain's height limit
  (`heightLimitV`, in v = 1/128 ft) plus 1,024 ft, so the camera still climbs well above the highest ground.
*/
export function cameraMaxZ(tall: boolean, heightLimitV: number): number {
  if (!tall) return MAX_Z_POSITION;
  return Math.trunc(((Math.trunc(heightLimitV / 128) + 1024) * ALTITUDE_SCALE) / 2);
}

/**
  JSTraxx (not Traxx): the highest object origin in scene z (ALTITUDE_SCALE per 2 ft step), 0 with none.
  The view passes it to setWorld with the ground's high, so the camera keeps its 1,024 ft of headroom
  above objects placed far above the ground (a sky track on flat terrain).
*/
export function objectsHighZ(boxes: readonly { ipos: readonly number[]; fraction: readonly number[] }[]): number {
  let hi = 0;
  for (const b of boxes) { const z = ALTITUDE_SCALE * (b.ipos[2]! + b.fraction[2]! / 256); if (z > hi) hi = z; }
  return hi;
}
/** The 55 ms timer tick every speed is tuned to (NAV_BASELINE_TICK_MS). */
export const NAV_TICK_MS = 55;

/** The navigation keys held (KEY_* in TraxxView.h). */
export interface NavKeys {
  up: boolean; down: boolean; left: boolean; right: boolean;
  pgUp: boolean; pgDown: boolean; a: boolean; z: boolean;
  strafeLeft: boolean; strafeRight: boolean; shift: boolean;
}

export function noKeys(): NavKeys {
  return { up: false, down: false, left: false, right: false, pgUp: false, pgDown: false, a: false, z: false, strafeLeft: false, strafeRight: false, shift: false };
}

export interface CameraPlace { x: number; y: number; z: number; orientation: number; elevation: number }

/**
  The lowest and highest ground of a track in scene z (ALTITUDESCALE per step): the 8-bit heights
  on Classic 8-bit, else the 16-bit (or version 6 32-bit) grid in v (v / 256 steps). For the
  camera's z range (spec section 10 item 8: nothing may assume 0..512 ft).
*/
export function terrainZRange(t: { terrainMode?: number; heights: ArrayLike<number>; h16?: ArrayLike<number> | null; fine?: ArrayLike<number> | null }): [number, number] {
  const g = t.terrainMode ? t.fine ?? t.h16 ?? null : null;
  const src = g ?? t.heights;
  const scale = g ? ALTITUDE_SCALE / 256 : ALTITUDE_SCALE;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < src.length; i++) { const v = src[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo > hi) return [0, 0];
  return [Math.floor(lo * scale), Math.ceil(hi * scale)];
}

/* The ground in scene z: ALTITUDESCALE x the step, floored (whole steps on Classic 8-bit are exact). */
function groundZ(groundAt: (x: number, y: number) => number, x: number, y: number): number {
  return Math.floor(ALTITUDE_SCALE * groundAt(x, y));
}

export class TraxxCamera {
  x = 128 << 6;
  y = 128 << 6;
  z = MAX_Z_POSITION / 2;
  orientation = 0;
  elevation = 900;
  gridx = 128;
  gridy = 128;
  /** F4: keep the same height above the ground while moving. */
  lockZ = false;
  keys: NavKeys = noKeys();
  /** The facing as Traxx keeps it: (0, 256) rotated by the orientation. */
  dvector: [number, number] = [0, 256];
  private saved: CameraPlace | null = null;
  private dxy = 0; private dyx = 0; private dz = 0;
  private dorientation = 0; private delevation = 0;
  private resid = { x: 0, y: 0, z: 0, or: 0, el: 0 };
  /** The highest x and y: 16383 for 256 cells, 64 N - 1 for a version 6 world (setWorld). */
  xyMax = 16383;
  /** The z range: 0..MAX_Z_POSITION unless the ground goes beyond 0..512 ft (setWorld). */
  zMin = 0;
  zMax = MAX_Z_POSITION;
  /** N, the world's cells a side. */
  cells = 256;

  /**
    The track's world (track format version 6, spec sections 8.1 and 10 item 8): N cells a side,
    and its ground from groundLowZ to groundHighZ in scene z. x and y run over the whole world;
    z keeps Traxx's 0..MAX_Z_POSITION, widened only so the camera can go below ground below 0 ft
    and keeps the same headroom (MAX_Z_POSITION less the 512 ft of a retail track) above ground
    above 512 ft. `ceilingZ` is the track's own ceiling (cameraMaxZ: higher on a Tall Heights
    track). A 256-cell track inside 0..512 ft gets exactly Traxx's ranges.
  */
  setWorld(cells: number, groundLowZ = 0, groundHighZ = 0, ceilingZ = MAX_Z_POSITION): void {
    this.cells = cells;
    this.xyMax = (cells << 6) - 1;
    this.zMin = Math.min(0, groundLowZ);
    this.zMax = Math.max(ceilingZ, groundHighZ + (MAX_Z_POSITION - ALTITUDE_SCALE * 256));
    this.x = Math.min(this.xyMax, Math.max(0, this.x));
    this.y = Math.min(this.xyMax, Math.max(0, this.y));
    this.z = Math.min(this.zMax, Math.max(this.zMin, this.z));
    this.updateGrid();
  }

  /**
    Called when a track opens (CTraxxView::OnUpdate): level view, 100 steps above the ground here.
    `groundAt` is in steps; on a 16-bit, Spline or Full Map track it carries the ground's 1/256
    fraction (box-ground.ts cameraGround), floored in z as Traxx 1.7's
    (ALTITUDESCALE * (z * 256 + zfrac)) >> 8 is (e4e034d).
  */
  resetForTrack(groundAt: (x: number, y: number) => number): void {
    if (this.elevation < 900) this.elevation = 900;
    this.z = Math.min(this.zMax, groundZ(groundAt, this.x, this.y) + ALTITUDE_SCALE * 100);
    this.stop();
    this.lockZ = false;
  }

  /** OnKillFocus: every key released and all motion stopped. */
  stop(): void {
    this.keys = noKeys();
    this.dxy = this.dyx = this.dz = this.dorientation = this.delevation = 0;
    this.resid = { x: 0, y: 0, z: 0, or: 0, el: 0 };
  }

  /** A key released: OnKeyUp drops that axis's speed at once. */
  release(key: keyof NavKeys): void {
    this.keys[key] = false;
    if (key === "up" || key === "down") this.dxy = 0;
    if (key === "left" || key === "right") this.dorientation = 0;
    if (key === "pgUp" || key === "pgDown") this.delevation = 0;
    if (key === "strafeLeft" || key === "strafeRight") this.dyx = 0;
    if (key === "a" || key === "z") this.dz = 0;
  }

  get moving(): boolean {
    const k = this.keys;
    return k.up || k.down || k.left || k.right || k.pgUp || k.pgDown || k.a || k.z || k.strafeLeft || k.strafeRight;
  }

  /** Num5: level view. */
  level(): void { this.elevation = 900; }
  /** Vertical View. */
  vertical(): void { this.elevation = 1800; }
  /** Home: face north. */
  home(): void { this.setOrientation(0); }

  setOrientation(tenths: number): void {
    this.orientation = ((Math.round(tenths) % 3600) + 3600) % 3600;
    const r = (this.orientation * Math.PI) / 1800;
    this.dvector = [Math.round(256 * Math.sin(r)), Math.round(256 * Math.cos(r))];
  }

  /** F2: save the location. F3: return to it (does nothing until one is saved). */
  saveLocation(): void {
    this.saved = { x: this.x, y: this.y, z: this.z, orientation: this.orientation, elevation: this.elevation };
  }

  /** The camera where it was before its world changed (Enlarge World keeps it), held inside the new ranges. */
  get place(): { x: number; y: number; z: number; orientation: number; elevation: number } {
    return { x: this.x, y: this.y, z: this.z, orientation: this.orientation, elevation: this.elevation };
  }

  setPlace(p: { x: number; y: number; z: number; orientation: number; elevation: number }): void {
    this.x = Math.min(this.xyMax, Math.max(0, p.x));
    this.y = Math.min(this.xyMax, Math.max(0, p.y));
    this.z = Math.min(this.zMax, Math.max(this.zMin, p.z));
    this.elevation = p.elevation;
    this.setOrientation(p.orientation);
    this.updateGrid();
  }

  restoreLocation(): boolean {
    if (!this.saved) return false;
    Object.assign(this, { x: this.saved.x, y: this.saved.y, z: this.saved.z, elevation: this.saved.elevation });
    this.setOrientation(this.saved.orientation);
    this.updateGrid();
    return true;
  }

  /** OnMapClick: jump to a map point, 0..1 across and down. */
  mapClick(fx: number, fy: number): void {
    const last = this.cells - 1;
    this.gridx = Math.trunc(last * Math.min(Math.max(fx, 0), 0.9999)) & ~1;
    this.gridy = (last - Math.trunc(last * Math.min(Math.max(fy, 0), 0.9999))) & ~1;
    this.x = this.gridx << 6;
    this.y = this.gridy << 6;
  }

  private updateGrid(): boolean {
    const gx = (this.x >> 6) & ~1, gy = (this.y >> 6) & ~1;
    if (gx === this.gridx && gy === this.gridy) return false;
    this.gridx = gx;
    this.gridy = gy;
    return true;
  }

  /*
    NavigationTick: one step of `ms` milliseconds. Speeds build up while a key is held, as
    Traxx's do, scaled to its 55 ms tick. Returns what changed.
  */
  tick(ms: number, groundAt: (x: number, y: number) => number): { moved: boolean; turned: boolean } {
    const s = Math.min(200, Math.max(0, ms)) / NAV_TICK_MS;
    const k = this.keys;
    let dxyinc = 11, dxymax = MAX_XY_CHANGE;
    if (k.shift) { dxyinc *= 6; dxymax *= 4; }
    if (k.down && (this.dxy -= dxyinc * s) < -dxymax) this.dxy = -dxymax;
    if (k.up && (this.dxy += dxyinc * s) > dxymax) this.dxy = dxymax;
    if (k.strafeLeft && (this.dyx -= 9 * s) < -dxymax) this.dyx = -MAX_XY_CHANGE;
    if (k.strafeRight && (this.dyx += 9 * s) > dxymax) this.dyx = MAX_XY_CHANGE;
    if (k.left && (this.dorientation -= 3 * s) < -MAX_ARG_CHANGE) this.dorientation = -MAX_ARG_CHANGE;
    if (k.right && (this.dorientation += 3 * s) > MAX_ARG_CHANGE) this.dorientation = MAX_ARG_CHANGE;
    if (k.pgUp && (this.delevation -= 3 * s) < -MAX_ARG_CHANGE) this.delevation = -MAX_ARG_CHANGE;
    if (k.pgDown && (this.delevation += 3 * s) > MAX_ARG_CHANGE) this.delevation = MAX_ARG_CHANGE;
    if (k.z && (this.dz -= s) < -MAX_Z_CHANGE) this.dz = -MAX_Z_CHANGE;
    if (k.a && (this.dz += s) > MAX_Z_CHANGE) this.dz = MAX_Z_CHANGE;

    let moved = false, turned = false;
    if (this.dorientation !== 0) {
      this.resid.or += this.dorientation * s;
      const di = Math.trunc(this.resid.or);
      this.resid.or -= di;
      if (di) this.setOrientation(this.orientation + di);
      turned = true;
    }
    if (this.delevation !== 0) {
      this.resid.el += this.delevation * s;
      const di = Math.trunc(this.resid.el);
      this.resid.el -= di;
      if (di) this.elevation = Math.min(1800, Math.max(0, this.elevation + di));
      turned = true;
    }
    if (this.dz !== 0) {
      this.resid.z += this.dz * s;
      const di = Math.trunc(this.resid.z);
      this.resid.z -= di;
      if (di) this.z = Math.min(this.zMax, Math.max(this.zMin, this.z + di));
      moved = true;
    }
    if (this.dxy !== 0 || this.dyx !== 0) {
      const above = this.lockZ ? this.z - groundZ(groundAt, this.x, this.y) : 0;
      const [dv0, dv1] = this.dvector;
      this.resid.x += ((this.dxy * dv0 + this.dyx * dv1) / 2048) * s;
      this.resid.y += ((this.dxy * dv1 - this.dyx * dv0) / 2048) * s;
      const dx = Math.trunc(this.resid.x), dy = Math.trunc(this.resid.y);
      this.resid.x -= dx;
      this.resid.y -= dy;
      this.x = Math.min(this.xyMax, Math.max(0, this.x + dx));
      this.y = Math.min(this.xyMax, Math.max(0, this.y + dy));
      if (this.lockZ) this.z = above + groundZ(groundAt, this.x, this.y);
      this.updateGrid();
      moved = true;
    }
    if (this.dxy === 0 && this.dyx === 0) this.resid.x = this.resid.y = 0;
    if (this.dorientation === 0) this.resid.or = 0;
    if (this.delevation === 0) this.resid.el = 0;
    if (this.dz === 0) this.resid.z = 0;
    return { moved, turned };
  }

  /* Mouse additions (JSTraxx): look, pan and dolly, in the same units. */
  look(dOrientation: number, dElevation: number): void {
    this.setOrientation(this.orientation + dOrientation);
    this.elevation = Math.min(1800, Math.max(0, this.elevation + dElevation));
  }

  /** Move by (forward, right, up) in ipos and z units, along the current facing. */
  move(forward: number, right: number, up: number, groundAt: (x: number, y: number) => number): void {
    const r = (this.orientation * Math.PI) / 1800;
    const above = this.z - groundZ(groundAt, this.x, this.y);
    this.x = Math.min(this.xyMax, Math.max(0, Math.round(this.x + forward * Math.sin(r) + right * Math.cos(r))));
    this.y = Math.min(this.xyMax, Math.max(0, Math.round(this.y + forward * Math.cos(r) - right * Math.sin(r))));
    this.z = this.lockZ ? above + groundZ(groundAt, this.x, this.y) : Math.min(this.zMax, Math.max(this.zMin, Math.round(this.z + up)));
    this.updateGrid();
  }

  /*
    Orbit (JSTraxx): swing the camera around a point by a yaw and a pitch (tenths of a degree),
    keeping its distance, and face the point. Scene units throughout.
  */
  orbit(pivot: [number, number, number], dYaw: number, dPitch: number): void {
    const dx = this.x - pivot[0], dy = this.y - pivot[1], dz = this.z - pivot[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1) return;
    let yaw = Math.atan2(dx, dy) + (dYaw * Math.PI) / 1800;
    let pitch = Math.asin(Math.max(-1, Math.min(1, dz / dist))) + (dPitch * Math.PI) / 1800;
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
    this.x = Math.min(this.xyMax, Math.max(0, Math.round(pivot[0] + dist * Math.cos(pitch) * Math.sin(yaw))));
    this.y = Math.min(this.xyMax, Math.max(0, Math.round(pivot[1] + dist * Math.cos(pitch) * Math.cos(yaw))));
    this.z = Math.min(this.zMax, Math.max(this.zMin, Math.round(pivot[2] + dist * Math.sin(pitch))));
    // Face the pivot: heading from the camera to it, and the pitch down to it.
    yaw = Math.atan2(pivot[0] - this.x, pivot[1] - this.y);
    const flat = Math.hypot(pivot[0] - this.x, pivot[1] - this.y);
    const look = Math.atan2(pivot[2] - this.z, flat);
    this.setOrientation((yaw * 1800) / Math.PI);
    this.elevation = Math.min(1800, Math.max(0, Math.round(900 - (look * 1800) / Math.PI)));
    this.updateGrid();
  }

  /** What the status bar shows: X and Y in cells, Z in terrain steps (CTraxxFrame::OnNotify). */
  indicators(): { x: string; y: string; z: string } {
    return { x: `X: ${this.x >> 6}`, y: `Y: ${this.y >> 6}`, z: `Z: ${Math.trunc(this.z / ALTITUDE_SCALE)}` };
  }
}
