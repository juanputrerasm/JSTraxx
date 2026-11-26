/*
  Walls mode (Traxx 1.8.2, EDIT_WALLS; Traxx/TraxxViewWalls.cpp, TraxxFrame.cpp OnEditmodeWalls,
  Traxx_Walls_GUI_Checklist.md). Only on a track whose race rules are new-style drag or Parallel;
  when the rules go off (Track Components, opening a rules-off track) the view falls back to
  Terrain, which closes the Wall window as OK. No control bar; the right-click menu and the mouse
  do the work:

    hover       the nearest wall point within 20 px lights (the reach is the ground distance 20 px
                to the right or below, 0.5 to 1000 ft)
    drag        the point follows the ground under the pointer; the bends of the two stretches it
                ends are re-clamped; a step across the world seam (further than half the world from
                a neighbour) keeps the old position
    right-click New Wall / Insert Point After / Delete Point / - / Wall Properties... / Delete Wall;
                the target is the point under the pointer, else the nearest within 100 px
    double-click the point's wall in the Wall window

  THE CAPTURE (New Wall): each left click adds a point at the picked ground position (1/256 ft); a
  click within 1 ft of the last point is ignored, one further than half the world from it refused
  with "Too far from the previous point (the world edge?)"; the 1024th point finishes. Backspace
  drops the last point, Enter or right-click finishes (2 points or more; the wall gets the first
  free "Wall %d" and the Wall window opens on it), Esc cancels; Space does nothing. A mode change,
  an undo or another track ends it.

  THE WALL WINDOW (ui/dialogs/wall-dialog.ts) is modeless: one at a time; while it is up only its
  wall can be reached from the view (the others are inert; New Wall and Delete Wall are off) and
  Edit > Undo is greyed. Its OK writes ONE undo step from the walls as they were before it opened
  (a captured wall included); Cancel puts them back exactly, drags and inserts made in the view
  included. A mode switch closes it as OK (a refusal says the edit is being cancelled and cancels);
  New, Open, Close, Save, Write POD and the rest of the file commands close it as OK first and stop
  on a refusal; another track abandons it.

  UNDO: Traxx keeps one level per mode; JSTraxx records each command as a step of its one history
  (a drag when the point first moved, each menu command, the window's OK).
*/
import type { ModeContext } from "./context.ts";
import type { ModeHandler, ViewPoint } from "../editor.ts";
import { CONTEXT_MENUS } from "../../ui/shell/commands.ts";
import { alertDialog, openDialog } from "../../ui/shell/dialog.ts";
import { el } from "../../shared/dom.ts";
import { recordFields } from "../../core/edit/record.ts";
import { EDIT_TERRAIN, EDIT_WALLS } from "../../core/settings.ts";
import { RACERULES_DRAG, RACERULES_PARALLEL, type Wall } from "../../core/traxx/race-types.ts";
import { exportWall, TrackWalls, WALL_MAX_EXPORT_POINTS, WALL_MAX_POINTS, WALL_MAX_WALLS, WALL_UNIT } from "../../core/traxx/walls.ts";
import { cellsOf, worldFtOf } from "../../core/traxx/world.ts";
import { exportWallGround } from "../../core/traxx/pod-writer.ts";
import { FILE_NEW_V6_IDS } from "../../core/traxx/track-kind-ui.ts";
import {
  cloneWalls, wallCaptureStatus, wallDeleteQuestion, wallFreeName, wallMenuEnables, wallMenuTarget, wallNearestOnWall, wallReachFeet,
  wallTooFar, wallTooLongNote, wallUnits, WALL_CAPTURE_MIN_FT, WALL_HOVER_PIXELS, WALL_MENU_PIXELS, WALL_MSG_FULL, WALL_MSG_KEEP,
  WALL_MSG_KEEP_MODESWITCH, WALL_MSG_TOO_FAR_NEIGHBOURS, WALL_MSG_TOO_FAR_PREV, type WallMenuEnables,
} from "../../core/edit/wall-edit.ts";
import { wallLabelColour, wallLabelPx, wallViewShift } from "../../core/view/wall-draw.ts";
import { ALTITUDE_SCALE } from "../../core/view/camera.ts";
import { wallDialog, type WallWindow } from "../../ui/dialogs/wall-dialog.ts";
import { takeViewFocusOnEnter } from "../../ui/input/view-focus.ts";
import type { TxxTrack } from "../../core/traxx/txx.ts";

/** OnEditmodeWalls / OnUpdateEditmodeWalls: the track's race rules allow walls (new-style drag or Parallel). */
export function wallsAllowed(t: Pick<TxxTrack, "raceRules"> | null | undefined): boolean {
  const m = t?.raceRules?.mode;
  return m === RACERULES_DRAG || m === RACERULES_PARALLEL;
}

/** The registered mode's rules check (one Walls mode per editor). */
let rulesCheck: (() => Promise<void>) | null = null;

/**
  Track Components OK (TraxxView.cpp 4157 and OnUpdateEditmodeWalls): when the race rules are no longer
  new-style drag or Parallel, an open Wall window closes as OK (a refusal cancels it) and Walls mode falls
  back to Terrain. Safe to call at any time; it does nothing while the rules allow walls.
*/
export async function closeWallDialogIfRulesOff(): Promise<void> {
  await rulesCheck?.();
}

/** The doc-wide file commands an open Wall window closes as OK before (CTraxxDoc's view loop, OnSpecialEnlargeWorld). */
const GUARDED = ["ID_FILE_NEW", "ID_FILE_NEW_CLASSIC16", "ID_FILE_NEW_SPLINE", "ID_FILE_NEW_FINE", ...FILE_NEW_V6_IDS, "ID_FILE_OPEN", "ID_FILE_SAVE",
  "ID_FILE_SAVE_AS", "ID_FILE_CLOSE", "ID_FILE_VIEWPOD", "ID_FILE_CLONE", "ID_FILE_EDITTRACK", "ID_FILE_WRITEPOD", "ID_FILE_DOWNLOAD", "ID_SPECIAL_ENLARGEWORLD"];

export function wallsMode(ctx: ModeContext): ModeHandler {
  const { app, editor, registry, view, docs } = ctx;
  const track = () => editor.doc!.track;
  const editable = () => editor.canEdit;
  const allowed = () => wallsAllowed(editor.doc?.track);

  /* The model over the track's walls array; the same object while the array is (its head0 lives here, as CTrackPODWalls'). */
  let model: TrackWalls | null = null;
  const W = (): TrackWalls => {
    const t = track();
    if (!model || model.walls !== t.raceRules.walls) model = new TrackWalls(t.raceRules.walls, cellsOf(t));
    else model.setWorldCells(cellsOf(t));
    return model;
  };
  const worldFt = () => worldFtOf(cellsOf(editor.doc?.track));

  /** wallhw / wallhp: the hovered (or dragged, or window-selected) wall and point. */
  let hw = -1, hp = -1;
  /** walldrag: the point being dragged; `before` the walls when it first moved (null with the window open: its OK records). */
  let drag: { moved: boolean; before: Wall[] | null } | null = null;
  /** wallcappt: the capture's points, 1/256 ft, or null when not capturing. */
  let capture: [number, number][] | null = null;
  /** The right-click: on the ground (ok) at (x, z) ft, and its target. */
  let menu = { ok: false, x: 0, z: 0, target: wallMenuTarget(null, null) };
  let menuEnables: WallMenuEnables = wallMenuEnables(false, menu.target, 0, 0, false);
  /** The Wall window's session (CTraxxView::walldlg and the CWallDlg fields the view reads). */
  let session: { index: number; creating: boolean; backup: Wall[]; dirty: boolean; win: WallWindow; dropFocus: () => void } | null = null;
  /** The status bar carries the "too long to draw" note. */
  let overnote = false;

  const status = (s: string) => app.status(s);
  const redraw = () => view.wallsChanged({ hotWall: hw, hotPoint: hp, capture: capture ? capture.slice() : null });

  /* SaveWallUndoFrom + the window's OK: one undo step from `before` to the walls as they are. */
  const commitFrom = (before: Wall[], label: string) => {
    const rr = track().raceRules;
    const after = rr.walls;
    rr.walls = before;
    const rec = recordFields(rr, ["walls"], label, { walls: true });
    rr.walls = after;
    editor.commit(rec);
  };

  /*
    FallPickFeet: the ground point under the pointer in world feet (0..W, wrapped), exact to the
    pick: whole ipos and the 1/256 fraction, an ipos half a foot.
  */
  const pickFeet = (clientX: number, clientY: number): [number, number] | null => {
    const hit = view.pick(clientX, clientY);
    if (!hit) return null;
    const Wft = worldFt();
    let x = (hit.ipos[0] * 256 + hit.fraction[0]) / 512, z = (hit.ipos[1] * 256 + hit.fraction[1]) / 512;
    x -= Wft * Math.floor(x / Wft);
    z -= Wft * Math.floor(z / Wft);
    return [x, z];
  };

  /* WallReachFeet: how far `pixels` is, in feet at the ground under the pointer. */
  const reachFeet = (p: ViewPoint, at: [number, number], pixels: number): number => {
    const dist = (q: [number, number] | null) => (q ? Math.sqrt((q[0] - at[0]) ** 2 + (q[1] - at[1]) ** 2) : null);
    return wallReachFeet(dist(pickFeet(p.clientX + pixels, p.clientY)), dist(pickFeet(p.clientX, p.clientY + pixels)), pixels);
  };

  /* WallHitTest: the wall point within `pixels` of the pointer (with the window open, only its wall's). */
  const hitTest = (p: ViewPoint, pixels = WALL_HOVER_PIXELS): { w: number; p: number } | null => {
    const walls = track().raceRules.walls;
    if (!walls.length) return null;
    const at = pickFeet(p.clientX, p.clientY);
    if (!at) return null;
    const reach = reachFeet(p, at, pixels);
    if (session) {
      const wl = walls[session.index];
      if (!wl) return null;
      const k = wallNearestOnWall(wl, at[0], at[1], reach);
      return k < 0 ? null : { w: session.index, p: k };
    }
    const r = W().nearPoint(at[0], at[1], reach);
    return r ? { w: r.wall, p: r.point } : null;
  };

  /* WallClearState: hover, drag and capture end (the mode or the document changed under them). */
  const clearState = () => {
    drag = null;
    hw = hp = -1;
    captureAbort();
  };

  /* ---- Capture ---- */

  const captureStatus = () => { if (capture) status(wallCaptureStatus(capture.length)); };

  const captureStart = async () => {
    if (!editable() || app.mode !== EDIT_WALLS || session) return;
    if (track().raceRules.walls.length >= WALL_MAX_WALLS) { await alertDialog("Traxx", WALL_MSG_FULL); return; }
    drag = null;
    hw = hp = -1;
    capture = [];
    captureStatus();
    redraw();
  };

  const captureClick = (p: ViewPoint) => {
    if (!capture) return;
    if (app.mode !== EDIT_WALLS) { captureCancel(); return; }
    const at = pickFeet(p.clientX, p.clientY);
    if (!at || capture.length >= WALL_MAX_POINTS) return;
    const px = wallUnits(at[0]), pz = wallUnits(at[1]);
    // Not on top of the last point.
    const last = capture[capture.length - 1];
    if (last) {
      const dx = (px - last[0]) / WALL_UNIT, dz = (pz - last[1]) / WALL_UNIT;
      if (Math.sqrt(dx * dx + dz * dz) < WALL_CAPTURE_MIN_FT) return;
      if (wallTooFar(worldFt(), last[0], last[1], px, pz)) { status(WALL_MSG_TOO_FAR_PREV); return; }
    }
    capture.push([px, pz]);
    // The last point a wall can hold finishes it by itself.
    if (capture.length >= WALL_MAX_POINTS) { void captureFinish(); return; }
    captureStatus();
    redraw();
  };

  const captureCancel = () => {
    if (!capture) return;
    capture = null;
    status("");
    redraw();
  };

  /* WallCaptureAbort: leave capture without a word (a load, an undo); the caller redraws. */
  function captureAbort(): void {
    if (!capture) return;
    capture = null;
    status("");
  }

  /*
    WallCaptureFinish: 2 or more points make a wall (AddWall's defaults: 1 ft thick, 20 ft tall, side
    None) and open its window; fewer cancel. The undo record is written only when the window's OK commits it.
  */
  const captureFinish = async () => {
    if (!capture) return;
    const pts = capture;
    capture = null;
    status("");
    if (pts.length < 2 || !editor.doc) { redraw(); return; }
    const before = cloneWalls(track().raceRules.walls);
    const walls = W();
    const w = walls.addWall(wallFreeName(walls.walls));
    if (w < 0) { redraw(); await alertDialog("Traxx", WALL_MSG_FULL); return; }
    for (let i = 0; i < pts.length; i++) if (walls.insertPoint(w, i - 1, pts[i]![0], pts[i]![1]) < 0) break;
    // The Wall window is modeless and owns the backup from here (Cancel removes the wall again).
    openWindow(w, true, before);
  };

  /* ---- The Wall window ---- */

  /* WallDialogOpen: one window at a time on wall w; `before` is what Cancel puts back. */
  const openWindow = (w: number, creating: boolean, before: Wall[]) => {
    if (session || w < 0 || w >= track().raceRules.walls.length) return;
    drag = null;
    const host = view.viewport.canvas.parentElement ?? view.viewport.canvas;
    // TakeViewFocus: the pointer over the view at open (the right-click or double-click was there) hands it the keys.
    const dropFocus = takeViewFocusOnEnter(host, host.matches(":hover"));
    const s = { index: w, creating, backup: before, dirty: creating, win: null as unknown as WallWindow, dropFocus };
    session = s;
    editor.modeless = { close: (ok, modeSwitch) => closeWindow(ok, modeSwitch) };
    s.win = wallDialog({
      walls: () => W(),
      index: w,
      creating,
      changed: (sel, edit) => {
        if (session !== s) return;
        hw = w;
        hp = sel;
        if (edit) s.dirty = true;
        redraw();
      },
      deletePoint: (p) => { deletePointAt(w, p); },
      close: (ok) => { void closeWindow(ok); },
      registry,
    });
    app.emit("commands", undefined);
  };

  /* CanKeep: a wall must end with a thickness and a height (says so if not). */
  const canKeep = async (modeSwitch: boolean): Promise<boolean> => {
    const s = session;
    const wl = s ? track().raceRules.walls[s.index] : undefined;
    if (!s || !wl || (wl.thickness > 0 && wl.height > 0)) return true;
    await alertDialog("Traxx", modeSwitch ? WALL_MSG_KEEP_MODESWITCH : WALL_MSG_KEEP);
    if (!modeSwitch && session === s) s.win.focusKeep();
    return false;
  };

  /*
    WallDialogClose: OK keeps the walls (an emptied wall is dropped) and writes the undo record, the
    whole session one step; nothing changed, no step. Cancel puts the backup back. False, the window
    staying, only when OK is refused.
  */
  async function closeWindow(ok: boolean, modeSwitch = false): Promise<boolean> {
    const s = session;
    if (!s) return true;
    if (ok && !(await canKeep(modeSwitch))) return false;
    if (session !== s) return true;
    session = null;
    editor.modeless = null;
    drag = null;
    s.win.takeDown();
    s.dropFocus();
    if (editor.doc) {
      const rr = track().raceRules;
      if (ok && s.dirty) {
        // A wall with no point left is no wall.
        if (rr.walls[s.index]?.points.length === 0) W().deleteWall(s.index);
        commitFrom(s.backup, s.creating ? "New Wall" : "Wall Properties");
      } else if (!ok) rr.walls = cloneWalls(s.backup);
    }
    hw = hp = -1;
    status("");
    redraw();
    app.emit("commands", undefined);
    return true;
  }

  /* WallDialogAbandon: the window goes without a word (the document is being closed or replaced). */
  const abandonWindow = () => {
    const s = session;
    if (!s) return;
    session = null;
    editor.modeless = null;
    s.win.takeDown();
    s.dropFocus();
    hw = hp = -1;
  };

  /* WallEditProperties: the window on wall w, or the open one brought forward. */
  const properties = (w: number) => {
    if (!editable() || !editor.doc || w < 0 || w >= track().raceRules.walls.length) return;
    if (session) { session.win.raise(); return; }
    openWindow(w, false, cloneWalls(track().raceRules.walls));
  };

  /* ---- Edits ---- */

  /*
    WallDeletePointAt: the right-click Delete Point and the window's Delete point button. Re-clamps the
    bend of the stretch before the gap (a closed wall's wrap included). False if nothing was deleted.
  */
  function deletePointAt(w: number, p: number): boolean {
    const walls = track().raceRules.walls;
    if (!editable() || w < 0 || w >= walls.length || p < 0 || p >= walls[w]!.points.length) return false;
    if (session && w !== session.index) return false;
    const before = session ? null : cloneWalls(walls);
    const m = W(), wl = walls[w]!;
    let prev = p - 1;
    if (prev < 0 && wl.closed && wl.points.length > 1) prev = wl.points.length - 2;   // the last point, as it will be after this one is gone
    m.deletePoint(w, p);
    // The stretch before the gap now ends at the point that followed; its bend may be too big for it.
    if (prev >= 0 && prev < wl.points.length) m.clampBend(w, prev);
    // A wall with no point left is no wall (with the window open it stays until the window closes).
    if (wl.points.length === 0 && !session) m.deleteWall(w);
    hw = hp = -1;
    if (session) {
      // The selection stays on the same point: the one after the deleted one slid into its place (the last one if it was the last).
      let keep = p;
      if (keep >= wl.points.length) keep = wl.points.length - 1;
      session.dirty = true;
      session.win.refresh(keep);
      if (keep < 0) session.win.selectPoint(-1);
      hw = w;
      hp = session.win.selected();
    } else commitFrom(before!, "Delete Wall Point");
    redraw();
    return true;
  }

  const insertPoint = () => {
    const walls = track().raceRules.walls;
    const { w, p } = menu.target;
    if (!editable() || !menu.ok || w < 0 || w >= walls.length || p < 0 || p >= walls[w]!.points.length) return;
    if (session && w !== session.index) return;
    const wl = walls[w]!;
    if (wl.points.length >= WALL_MAX_POINTS) return;
    const nx = wallUnits(menu.x), nz = wallUnits(menu.z);
    let next = p + 1;
    if (next >= wl.points.length && wl.closed && wl.points.length > 1) next = 0;
    // Across the world seam from either neighbour.
    if (wallTooFar(worldFt(), wl.points[p]!.x, wl.points[p]!.z, nx, nz)
      || (next < wl.points.length && wallTooFar(worldFt(), wl.points[next]!.x, wl.points[next]!.z, nx, nz))) {
      status(WALL_MSG_TOO_FAR_NEIGHBOURS);
      return;
    }
    const before = session ? null : cloneWalls(walls);
    const m = W();
    const at = m.insertPoint(w, p, nx, nz);
    if (at < 0) return;
    // The stretch it split keeps its bend on the first half; that half is shorter now.
    m.clampBend(w, p);
    hw = w;
    hp = at;
    if (session) {
      session.dirty = true;
      session.win.refresh(at);   // the new point is in its list, and selected
    } else commitFrom(before!, "Insert Wall Point");
    redraw();
  };

  const deleteWall = async () => {
    const walls = track().raceRules.walls;
    const w = menu.target.w;
    if (!editable() || session || w < 0 || w >= walls.length) return;
    const answer = await openDialog({
      title: "Traxx", body: el("p", { class: "modal-text" }, wallDeleteQuestion(walls[w]!)),
      buttons: [{ label: "Yes", value: "yes", primary: true }, { label: "No", value: "no" }],
    });
    if (answer !== "yes" || !editor.doc || track().raceRules.walls !== walls || session) return;
    const before = cloneWalls(walls);
    W().deleteWall(w);
    hw = hp = -1;
    commitFrom(before, "Delete Wall");
    redraw();
  };

  /* ---- Commands ---- */

  const can = (k: keyof WallMenuEnables) => () => editable() && menuEnables[k];
  registry.bind("ID_WALL_NEW", () => captureStart(), { enabled: can("newWall") });
  registry.bind("ID_WALL_INSERTPOINT", insertPoint, { enabled: can("insertPoint") });
  registry.bind("ID_WALL_DELETEPOINT", () => {
    const { w, p } = menu.target;
    if (menu.target.hit) deletePointAt(w, p);
  }, { enabled: can("deletePoint") });
  registry.bind("ID_WALL_PROPERTIES", () => properties(menu.target.w), { enabled: can("properties") });
  registry.bind("ID_WALL_DELETE", deleteWall, { enabled: can("deleteWall") });

  // OnEditmodeWalls: refused (the current mode stays) unless the race rules allow walls.
  registry.bind("ID_EDITMODE_WALLS", () => { if (allowed()) app.setMode(EDIT_WALLS); },
    { enabled: () => Boolean(editor.doc) && allowed(), checked: () => app.mode === EDIT_WALLS });
  // OnViewWalls: View > Visual Helpers > Show Walls, in every mode.
  registry.bind("ID_VIEW_WALLS", () => app.updateSettings((s) => { s.show_walls = !s.show_walls; }), { checked: () => app.settings.show_walls });

  // CTraxxDoc's view loop: New, Open, Close, Save, Write POD... close the window as OK first; a refusal stops them.
  registry.guard(GUARDED, async () => (session ? closeWindow(true) : true));

  /*
    OnUpdateEditmodeWalls and Track Components' OK: rules off while Walls mode is up fall back to Terrain
    (which closes the window as OK); an open window closes as OK whatever the mode.
  */
  let checking = false;
  rulesCheck = async () => {
    if (checking || allowed()) return;
    checking = true;
    try {
      if (session && !(await closeWindow(true, true))) await closeWindow(false);
      if (app.mode === EDIT_WALLS) app.setMode(EDIT_TERRAIN);
    } finally {
      checking = false;
    }
  };
  // An undo (or any other change) ends a capture (WallCaptureAbort); rules turned off by it leave Walls mode.
  editor.on("changed", () => {
    if (!session) { drag = null; if (capture) { captureAbort(); redraw(); } }
    void rulesCheck?.();
  });
  docs.on("opened", () => {
    abandonWindow();
    clearState();
    model = null;
    overnote = false;
    menu = { ok: false, x: 0, z: 0, target: wallMenuTarget(null, null) };
    void rulesCheck?.();
  });
  if (app.mode === EDIT_WALLS && !allowed()) app.setMode(EDIT_TERRAIN);

  /* WallMouseMove's hover half: the hovered point, and the "too long to draw" note for its wall. */
  const hover = (p: ViewPoint) => {
    if (capture || !editor.doc) return;
    let hit = hitTest(p);
    // With the Wall window open the edited wall keeps its selected point lit when none is under the pointer.
    if (!hit && session) hit = { w: session.index, p: session.win.selected() };
    const w = hit?.w ?? -1, pt = hit?.p ?? -1;
    if (w === hw && pt === hp) return;
    hw = w;
    hp = pt;
    const wl = w >= 0 ? track().raceRules.walls[w] : undefined;
    if (wl && wl.points.length >= 2 && exportWall(wl, null, WALL_MAX_EXPORT_POINTS).count < 0) {
      status(wallTooLongNote(wl.name, WALL_MAX_EXPORT_POINTS));
      overnote = true;
    } else if (overnote) {
      status("");
      overnote = false;
    }
    redraw();
  };

  return {
    deactivate() {
      // TX_EDITMODE: the window closes as OK (refused: cancelled), then WallClearState.
      if (session) void (async () => { if (!(await closeWindow(true, true))) await closeWindow(false); })();
      clearState();
      overnote = false;
      redraw();
    },
    activate() { redraw(); },
    hover,
    down(p) {
      if (capture) { captureClick(p); return; }
      const hit = hitTest(p);
      if (!hit) {
        // An empty click leaves the Wall window's selection as it is.
        if (session) { hw = session.index; hp = session.win.selected(); } else hw = hp = -1;
        return;
      }
      hw = hit.w;
      hp = hit.p;
      if (session) session.win.selectPoint(hit.p);   // the click selects the point in the window's list
      drag = { moved: false, before: null };
      redraw();
    },
    // Drag: the point follows the ground under the pointer; the bends of the two stretches it ends are re-clamped.
    drag(p) {
      if (capture || !drag) return;
      const walls = track().raceRules.walls;
      if (hw < 0 || hw >= walls.length || hp < 0 || hp >= walls[hw]!.points.length) return;
      const at = pickFeet(p.clientX, p.clientY);
      if (!at) return;
      const wl = walls[hw]!, n = wl.points.length;
      const nx = wallUnits(at[0]), nz = wallUnits(at[1]);
      let prev = hp - 1, next = hp + 1;
      if (prev < 0 && wl.closed && n > 1) prev = n - 1;
      if (next >= n && wl.closed && n > 1) next = 0;
      // Across the world seam: keep the old position.
      if ((prev >= 0 && wallTooFar(worldFt(), wl.points[prev]!.x, wl.points[prev]!.z, nx, nz))
        || (next >= 0 && next < n && wallTooFar(worldFt(), wl.points[next]!.x, wl.points[next]!.z, nx, nz))) return;
      if (!drag.moved) {
        drag.before = session ? null : cloneWalls(walls);   // the walls as they were, before this first step
        drag.moved = true;
      }
      wl.points[hp]!.x = nx;
      wl.points[hp]!.z = nz;
      const m = W();
      if (prev >= 0) m.clampBend(hw, prev);
      m.clampBend(hw, hp);
      if (session) {
        session.dirty = true;
        session.win.refreshPoint();   // the selected point's row and boxes follow the drag; the rest on button-up
      }
      redraw();
    },
    up() {
      const d = drag;
      if (!d) return;
      drag = null;
      if (!d.moved) return;
      if (session) session.win.refresh();   // the whole list (the neighbours' bends may have been cut back) and the Problems
      else if (d.before) commitFrom(d.before, "Move Wall Point");
      redraw();
    },
    dblclick(p) {
      if (capture) return;
      // The second press of the double-click started a drag in the first one; it is over.
      drag = null;
      const hit = hitTest(p);
      if (!hit) return;
      hw = hit.w;
      hp = hit.p;
      properties(hit.w);
    },
    // WallContextMenu: during a capture the right-click finishes it.
    contextMenu(p) {
      if (capture) { void captureFinish(); return null; }
      const walls = track().raceRules.walls;
      const at = pickFeet(p.clientX, p.clientY);
      menu = { ok: false, x: 0, z: 0, target: wallMenuTarget(null, null) };
      if (at) {
        menu.ok = true;
        menu.x = at[0];
        menu.z = at[1];
        // The point under the pointer, else the nearest within 100 px: the menu still has a target.
        const under = hitTest(p);
        menu.target = wallMenuTarget(under, under ? null : hitTest(p, WALL_MENU_PIXELS));
      }
      if (menu.target.hit) { hw = menu.target.w; hp = menu.target.p; redraw(); }
      const npoints = menu.target.w >= 0 ? walls[menu.target.w]?.points.length ?? 0 : 0;
      menuEnables = wallMenuEnables(menu.ok, menu.target, walls.length, npoints, session !== null);
      return { items: CONTEXT_MENUS.Walls! };
    },
    keyDown(e) {
      // WallCaptureKey: the capture owns Backspace, Enter, Esc and Space.
      if (!capture) return false;
      switch (e.code) {
        case "Backspace": capture.pop(); captureStatus(); redraw(); return true;
        case "Enter": case "NumpadEnter": void captureFinish(); return true;
        case "Escape": captureCancel(); return true;
        case "Space": return true;   // would apply the terrain brush
      }
      return false;
    },
    /* OverlayWalls: each wall's name above its first point, sized by the wall's on-screen height there. */
    drawOverlay(g, project) {
      const doc = editor.doc;
      if (!doc) return;
      const t = doc.track, walls = t.raceRules.walls;
      if (!walls.length) return;
      const ground = exportWallGround(t), wft = worldFt();
      const { gridx, gridy } = view.camera;
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      walls.forEach((wl, i) => {
        if (wl.points.length < 1 || !wl.name) return;
        let x = wl.points[0]!.x / WALL_UNIT, z = wl.points[0]!.z / WALL_UNIT;
        const y = ground(x, z) + (wl.points[0]!.above + wl.height) / WALL_UNIT;
        // The copy of the world nearest the view, as the renderer draws it.
        const [sx, sz] = wallViewShift(x, z, gridx, gridy, wft);
        x += sx;
        z += sz;
        const UP = ALTITUDE_SCALE / 2;
        const top = project(x * 2, z * 2, y * UP);
        if (!top) return;
        const px = wallLabelPx(top, project(x * 2, z * 2, (y - wl.height / WALL_UNIT) * UP));
        if (px === null) return;
        g.font = px === 12 ? "12px system-ui, sans-serif" : `${px}px Arial, sans-serif`;
        g.fillStyle = wallLabelColour(hw === i);
        g.fillText(wl.name, top.x, top.y - 10);
      });
    },
  };
}
