/*
  The Wall window (Traxx 1.8.2, Traxx/WallDlg.cpp, IDD_WALL 330 x 344): the end of a New Wall
  capture, right-click > Wall Properties, or a double-click on a wall point in Walls mode. It edits
  ONE wall LIVE: every change goes straight into the track's walls and the view is redrawn.

  MODELESS (7e3e1b3, bfa2c7b, 9e58b15): the 3D camera keeps working while it is open. OK and
  Cancel are the owner's (app/modes/walls-mode.ts, CTraxxView::WallDialogClose): it holds the
  backup and the undo record. The owner calls refresh / refreshPoint / selectPoint when the view
  changes the wall itself (a drag, Insert Point, Delete Point).

  UNITS. Every length is shown in feet with two decimals and stored in 1/256 ft, rounded. The
  numeric boxes apply LIVE as they are typed (when the text is a number) and tidy themselves to
  two decimals when they lose focus. The shape boxes (start, straight, arc) are read by their
  buttons.

  LEFT AND RIGHT for "Add arc" (WallDlg.cpp's note): heading 0 is +x and 90 is +z, an increasing
  heading turns counter-clockwise in Traxx's map window (+x right, +z up), a turn to the author's
  left there; so Left = AppendArc(+angle) and Right = AppendArc(-angle).

  KEYS (PreTranslateMessage): the frame's accelerators (Ctrl+S, Ctrl+W, the function keys ...)
  work from the window too, except the editing keys (Ctrl+C, V, X, Z, A, Insert, Delete,
  Backspace) while a text box has the focus, which belong to the box. Enter presses OK, Escape is
  Cancel (openModeless).
*/
import { el } from "../../shared/dom.ts";
import { openModeless } from "../shell/dialog.ts";
import { ACCELERATORS, keyName, type CommandRegistry } from "../shell/commands.ts";
import { WALL_UNIT, type TrackWalls } from "../../core/traxx/walls.ts";
import { WALL_NAMELEN } from "../../core/traxx/walls.ts";
import type { Wall, WallPoint } from "../../core/traxx/race-types.ts";
import {
  wallArcFailure, wallFt, wallInWorldFt, wallPointHasStretch, wallRaw, wallReadBox, wallRowText, wallSpinStep, WALLDLG_LIMIT_FT,
  WALL_MSG_ARC_ANGLE, WALL_MSG_ARC_RADIUS, WALL_MSG_BEND_CLAMPED, WALL_MSG_CLOSED_DROPPED, WALL_MSG_HAS_POINTS, WALL_MSG_LEAVES_WORLD,
  WALL_MSG_NO_PROBLEMS, WALL_MSG_STRAIGHT_FULL, WALL_MSG_STRAIGHT_LENGTH,
} from "../../core/edit/wall-edit.ts";
import { WALL_MAX_POINTS } from "../../core/traxx/walls.ts";

/** What the window asks of its owner (CTraxxView's half). */
export interface WallDialogHooks {
  /** The track's walls as the model (the same object between calls while the walls array is the same, so head0 survives). */
  walls(): TrackWalls;
  /** The wall being edited (wallindex). */
  index: number;
  /** The wall was just captured: the caption is "New Wall". */
  creating: boolean;
  /** Changed(): redraw the view with the edited wall and `sel` lit; `edit` false for a selection change only. */
  changed(sel: number, edit: boolean): void;
  /** WallDeletePointAt (the view's Delete Point, the same deletion); the owner refreshes the window. */
  deletePoint(p: number): void;
  /** OK and Cancel (and the close box, Escape): CTraxxView::WallDialogClose. */
  close(ok: boolean): void;
  registry: CommandRegistry;
}

/** The open window (CTraxxView::walldlg). */
export interface WallWindow {
  /** The selected point, or -1. */
  selected(): number;
  /** The view changed the wall: the list, the selected point's boxes, the shape buttons and the Problems again; select >= 0 selects that point. */
  refresh(select?: number): void;
  /** A drag step: only the selected point's row and boxes. */
  refreshPoint(): void;
  /** The view's click on a point of this wall. */
  selectPoint(p: number): void;
  /** A second request: the window comes to the front. */
  raise(): void;
  /** CanKeep's refusal: the box that needs a value takes the keyboard. */
  focusKeep(): void;
  /** Take the window down without a word (the owner has done the rest). */
  takeDown(): void;
}

type BoxId = "thick" | "height" | "aboveall" | "px" | "pz" | "pbend" | "pabove" | "startx" | "startz" | "starthead" | "strlen" | "arcradius" | "arcangle";

export function wallDialog(h: WallDialogHooks): WallWindow {
  const model = () => h.walls();
  const theWall = (): Wall | null => model().walls[h.index] ?? null;
  let sel = -1;
  let loading = false;
  let closing = false;
  const thePoint = (): WallPoint | null => {
    const w = theWall();
    return w && sel >= 0 && sel < w.points.length ? w.points[sel]! : null;
  };

  const text = (cls = "") => el("input", { type: "text", class: `spin ${cls}`, autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const boxes: Record<BoxId, HTMLInputElement> = {
    thick: text(), height: text(), aboveall: text(), px: text(), pz: text(), pbend: text(), pabove: text(),
    startx: text(), startz: text(), starthead: text("wall-short"), strlen: text(), arcradius: text(), arcangle: text("wall-short"),
  };
  const spins = {} as Record<BoxId, HTMLButtonElement[]>;
  const spun = (id: BoxId) => {
    const up = el("button", { type: "button", class: "mini", tabindex: -1, onclick: () => deltapos(id, 1) }, "▲") as HTMLButtonElement;
    const down = el("button", { type: "button", class: "mini", tabindex: -1, onclick: () => deltapos(id, -1) }, "▼") as HTMLButtonElement;
    spins[id] = [up, down];
    // UDS_ARROWKEYS: the arrow keys in the box step it.
    boxes[id].addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); deltapos(id, e.key === "ArrowUp" ? 1 : -1); }
    });
    return el("span", { class: "wall-box" }, boxes[id], el("span", { class: "fall-spin" }, up, down));
  };
  const name = el("input", { type: "text", maxlength: WALL_NAMELEN - 1, class: "wall-name", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const side = el("select", {}, el("option", { value: "0" }, "None"), el("option", { value: "1" }, "Inside"), el("option", { value: "2" }, "Outside")) as HTMLSelectElement;
  const closed = el("input", { type: "checkbox" }) as HTMLInputElement;
  const noline = el("input", { type: "checkbox" }) as HTMLInputElement;
  const gap = el("input", { type: "checkbox" }) as HTMLInputElement;
  const aboveApply = el("button", { type: "button" }, "Apply") as HTMLButtonElement;
  const delPoint = el("button", { type: "button" }, "Delete point") as HTMLButtonElement;
  const list = el("select", { size: 8, class: "wall-list" }) as HTMLSelectElement;
  const note = el("div", { class: "wall-note" });
  const setStart = el("button", { type: "button" }, "Set Start") as HTMLButtonElement;
  const addStraight = el("button", { type: "button" }, "Add straight") as HTMLButtonElement;
  const addArc = el("button", { type: "button" }, "Add arc") as HTMLButtonElement;
  const arcLeft = el("input", { type: "radio", name: "wall-arc-dir", checked: true }) as HTMLInputElement;
  const arcRight = el("input", { type: "radio", name: "wall-arc-dir" }) as HTMLInputElement;
  const problems = el("textarea", { readonly: true, rows: 3, class: "wall-problems" }) as HTMLTextAreaElement;

  const lab = (caption: string, ...rest: (Node | string)[]) => el("label", { class: "wall-field" }, caption, ...rest);
  const body = el("div", { class: "wall-body" },
    el("div", { class: "opt-row" }, lab("Name ", name), lab("Side ", side)),
    el("div", { class: "opt-row" }, lab("Thickness (ft) ", spun("thick")), lab("Height (ft) ", spun("height"))),
    el("div", { class: "opt-row" }, el("label", { class: "opt-check" }, closed, "Closed"), el("label", { class: "opt-check" }, noline, "No ground line")),
    el("div", { class: "opt-row" }, lab("Set above-ground for all points (ft) ", spun("aboveall")), aboveApply),
    el("div", { class: "opt-row wall-points-head" }, el("span", {}, "Points   (number: X, Z, bend, above ground, gap; feet)"), delPoint),
    list,
    el("div", { class: "opt-row" }, lab("X (ft) ", spun("px")), lab("Z (ft) ", spun("pz")), el("label", { class: "opt-check" }, gap, "Gap after this point")),
    el("div", { class: "opt-row" }, lab("Bend (ft) ", spun("pbend")), lab("Above ground (ft) ", spun("pabove"))),
    note,
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Shapes"),
      el("div", { class: "opt-row" }, lab("Start X (ft) ", spun("startx")), lab("Z (ft) ", spun("startz")), lab("Heading (deg) ", spun("starthead")), setStart),
      el("div", { class: "opt-row" }, lab("Length (ft) ", spun("strlen")), addStraight),
      el("div", { class: "opt-row" }, lab("Radius (ft) ", spun("arcradius")), lab("Angle (deg) ", spun("arcangle")),
        el("label", { class: "opt-check" }, arcLeft, "Left"), el("label", { class: "opt-check" }, arcRight, "Right"), addArc)),
    el("div", {}, "Problems"), problems);

  /* ---- helpers (CWallDlg) ---- */

  const setNote = (s: string) => { note.textContent = s; };
  const setBox = (id: BoxId, s: string) => { boxes[id].value = s; };
  const readBox = (id: BoxId) => wallReadBox(boxes[id].value);
  const enable = (id: BoxId, on: boolean) => { boxes[id].disabled = !on; for (const b of spins[id]) b.disabled = !on; };

  const fillList = () => {
    const w = theWall();
    loading = true;
    list.replaceChildren(...(w ? w.points.map((p, i) => el("option", { value: String(i) }, wallRowText(p, i))) : []));
    if (!w || sel >= w.points.length) sel = w ? w.points.length - 1 : -1;
    if (sel < 0 && w && w.points.length > 0) sel = 0;
    list.selectedIndex = sel;
    loading = false;
  };
  const updateRow = (p: number) => {
    const w = theWall();
    if (!w || p < 0 || p >= w.points.length || p >= list.options.length) return;
    list.options[p]!.textContent = wallRowText(w.points[p]!, p);
    list.selectedIndex = sel;
  };
  const showBox = (id: BoxId) => {
    const w = theWall(), pt = thePoint();
    if (!w) return;
    switch (id) {
      case "thick": setBox(id, wallFt(w.thickness)); break;
      case "height": setBox(id, wallFt(w.height)); break;
      case "px": if (pt) setBox(id, wallFt(pt.x)); break;
      case "pz": if (pt) setBox(id, wallFt(pt.z)); break;
      case "pbend": if (pt) setBox(id, wallFt(pt.bend)); break;
      case "pabove": if (pt) setBox(id, wallFt(pt.above)); break;
      default: break;
    }
  };
  const updateProblems = () => {
    const t = model().problemsText(h.index);
    problems.value = t ? t : WALL_MSG_NO_PROBLEMS;
  };
  /* Changed: redraw the view; an edit also marks the session and rewrites the Problems. */
  const changed = (redrawOnly = false) => {
    h.changed(sel, !redrawOnly);
    if (!redrawOnly) updateProblems();
  };
  const loadWall = () => {
    const w = theWall();
    if (!w) return;
    loading = true;
    name.value = w.name;
    side.value = String(w.side >= 0 && w.side <= 2 ? w.side : 0);
    closed.checked = w.closed === 1;
    noline.checked = w.noline === 1;
    setBox("thick", wallFt(w.thickness));
    setBox("height", wallFt(w.height));
    loading = false;
  };
  const loadPoint = () => {
    const w = theWall(), pt = thePoint();
    loading = true;
    for (const id of ["px", "pz", "pbend", "pabove"] as const) setBox(id, "");
    if (pt) {
      setBox("px", wallFt(pt.x));
      setBox("pz", wallFt(pt.z));
      setBox("pbend", wallFt(pt.bend));
      setBox("pabove", wallFt(pt.above));
    }
    gap.checked = Boolean(pt?.gap);
    loading = false;
    // The bend and the gap belong to the stretch that starts at the point: the last point of an open wall has none.
    const stretch = Boolean(pt && w && wallPointHasStretch(w, sel));
    enable("px", pt !== null);
    enable("pz", pt !== null);
    enable("pabove", pt !== null);
    enable("pbend", stretch);
    gap.disabled = !stretch;
    delPoint.disabled = pt === null;
  };
  // Start only for an empty wall; the straight and the arc grow from the last point.
  const loadShapeEnables = () => {
    const n = theWall()?.points.length ?? 0;
    setStart.disabled = n !== 0;
    for (const id of ["startx", "startz", "starthead"] as const) enable(id, n === 0);
    addStraight.disabled = n < 1;
    addArc.disabled = n < 1;
  };
  const select = (p: number) => {
    const w = theWall();
    if (!w || p < 0 || p >= w.points.length) p = -1;
    sel = p;
    list.selectedIndex = p;
    loadPoint();
  };
  // The bends that depend on point p's position: its own stretch and the one before it.
  const clampAround = (p: number) => {
    const w = theWall();
    if (!w || p < 0 || p >= w.points.length) return;
    const before = p > 0 ? p - 1 : w.closed ? w.points.length - 1 : -1;
    let clamped = false;
    if (model().clampBend(h.index, p)) clamped = true;
    if (before >= 0 && before !== p && model().clampBend(h.index, before)) { clamped = true; updateRow(before); }
    if (clamped) setNote(WALL_MSG_BEND_CLAMPED);
  };

  /* ApplyValue: a number into the wall (and the redraw). */
  const applyValue = (id: BoxId, v: number) => {
    const w = theWall(), pt = thePoint();
    if (!w) return;
    const worldFt = model().worldFt();
    switch (id) {
      case "thick": w.thickness = v < 0 ? 0 : wallRaw(v); break;
      case "height": w.height = v < 0 ? 0 : wallRaw(v); break;
      case "px": case "pz":
        if (!pt) return;
        setNote("");
        if (id === "px") pt.x = wallRaw(wallInWorldFt(v, worldFt)); else pt.z = wallRaw(wallInWorldFt(v, worldFt));
        clampAround(sel);
        updateRow(sel);
        // A moved point changes the stretches either side of it: the bend box may have been reduced.
        setBox("pbend", wallFt(pt.bend));
        break;
      case "pbend":
        if (!pt) return;
        setNote("");
        pt.bend = wallRaw(v);
        if (model().clampBend(h.index, sel)) { setNote(WALL_MSG_BEND_CLAMPED); setBox(id, wallFt(pt.bend)); }
        updateRow(sel);
        break;
      case "pabove":
        if (!pt) return;
        pt.above = wallRaw(v);
        updateRow(sel);
        break;
      default: return;
    }
    changed();
  };
  const LIVE: readonly BoxId[] = ["thick", "height", "px", "pz", "pbend", "pabove"];

  /* OnDeltapos: one step from whatever the box holds. */
  const deltapos = (id: BoxId, delta: number) => {
    if (loading || closing || boxes[id].disabled) return;
    let v = readBox(id) ?? 0.0;
    v += delta * wallSpinStep(id);
    // Held where the model holds it, so the box and the stored value stay in step.
    if (id === "thick" || id === "height") v = v < 0 ? 0 : v;
    else if (id === "px" || id === "pz") v = wallInWorldFt(v, model().worldFt());
    setBox(id, id === "starthead" || id === "arcangle" ? v.toFixed(0) : wallFt(wallRaw(v)));
    if (LIVE.includes(id)) { applyValue(id, v); showBox(id); }
  };

  /* ---- handlers ---- */

  // OnChangeName. Traxx leaves the session unmarked for a rename; JSTraxx marks it, so OK keeps the name with an undo step.
  name.addEventListener("input", () => {
    const w = theWall();
    if (loading || closing || !w) return;
    w.name = name.value.slice(0, WALL_NAMELEN - 1);
    changed();
  });
  side.addEventListener("change", () => {
    const w = theWall();
    if (loading || !w) return;
    w.side = Number(side.value);
    changed();
  });
  closed.addEventListener("change", () => {
    const w = theWall();
    if (loading || !w) return;
    w.closed = closed.checked ? 1 : 0;
    let dropped = false;
    // A last point on the first one would make a zero-length closing stretch: drop it (a closed wall joins them).
    const n = w.points.length;
    if (w.closed && n > 1 && w.points[n - 1]!.x === w.points[0]!.x && w.points[n - 1]!.z === w.points[0]!.z) {
      model().deletePoint(h.index, n - 1);
      fillList();
      dropped = true;
    }
    // The closing stretch is the last point's: its bend may now be too big.
    if (w.closed && w.points.length > 1) {
      clampAround(w.points.length - 1);
      updateRow(w.points.length - 1);
    }
    loadPoint();
    if (dropped) setNote(WALL_MSG_CLOSED_DROPPED);
    changed();
  });
  noline.addEventListener("change", () => {
    const w = theWall();
    if (loading || !w) return;
    w.noline = noline.checked ? 1 : 0;
    changed();
  });
  gap.addEventListener("change", () => {
    const pt = thePoint();
    if (loading || !pt) return;
    pt.gap = gap.checked ? 1 : 0;
    updateRow(sel);
    changed();
  });
  // "Set above-ground for all points": the box value on every point.
  aboveApply.addEventListener("click", () => {
    const w = theWall();
    if (!w) return;
    const v = readBox("aboveall") ?? 0.0;
    for (const p of w.points) p.above = wallRaw(v);
    setBox("aboveall", wallFt(wallRaw(v)));
    fillList();
    loadPoint();
    setNote("");
    changed();
  });
  list.addEventListener("change", () => {
    if (loading) return;
    select(list.selectedIndex);
    setNote("");
    changed(true);
  });
  for (const id of Object.keys(boxes) as BoxId[]) {
    // OnChangeNumber: only the thickness, the height and the selected point's boxes act on the wall.
    boxes[id].addEventListener("input", () => {
      if (loading || closing || !LIVE.includes(id)) return;
      const v = readBox(id);
      if (v !== null) applyValue(id, v);
    });
    // OnKillfocusNumber: show the stored value (two decimals), but not while the window is closing.
    boxes[id].addEventListener("blur", () => {
      if (loading || closing) return;
      if (LIVE.includes(id)) { if (!boxes[id].disabled) showBox(id); }
      else if (id === "aboveall") { const v = readBox(id); if (v !== null) setBox(id, wallFt(wallRaw(v))); }
    });
  }
  // Set Start: an empty wall gets its first point and a heading (0 = +x, 90 = +z).
  setStart.addEventListener("click", () => {
    if (!theWall()) return;
    const worldFt = model().worldFt();
    const x = wallInWorldFt(readBox("startx") ?? 0.0, worldFt), z = wallInWorldFt(readBox("startz") ?? 0.0, worldFt);
    setBox("startx", wallFt(wallRaw(x)));
    setBox("startz", wallFt(wallRaw(z)));
    const head = readBox("starthead") ?? 0.0;
    if (model().setStartAndHeading(h.index, wallRaw(x) / WALL_UNIT, wallRaw(z) / WALL_UNIT, head) !== 0) { setNote(WALL_MSG_HAS_POINTS); return; }
    sel = 0;
    fillList();
    loadPoint();
    loadShapeEnables();
    setNote("");
    changed();
  });
  addStraight.addEventListener("click", () => {
    const w = theWall();
    if (!w) return;
    let len = readBox("strlen");
    if (len === null || len * WALL_UNIT < 1.0) { setNote(WALL_MSG_STRAIGHT_LENGTH); return; }
    if (len > WALLDLG_LIMIT_FT) len = WALLDLG_LIMIT_FT;
    if (model().appendStraight(h.index, len) !== 0) {
      setNote(w.points.length >= WALL_MAX_POINTS ? WALL_MSG_STRAIGHT_FULL : WALL_MSG_LEAVES_WORLD);
      return;
    }
    sel = w.points.length - 1;
    fillList();
    loadPoint();
    loadShapeEnables();
    setNote("");
    changed();
  });
  // Add arc: radius, the angle (always typed positive) and Left or Right (see the note at the top).
  addArc.addEventListener("click", () => {
    const w = theWall();
    if (!w) return;
    let radius = readBox("arcradius");
    if (radius === null || radius <= 0.0) { setNote(WALL_MSG_ARC_RADIUS); return; }
    let angle = readBox("arcangle");
    if (angle === null || Math.abs(angle) < 0.001) { setNote(WALL_MSG_ARC_ANGLE); return; }
    angle = Math.abs(angle);
    if (angle > 36000.0) angle = 36000.0;
    if (radius > WALLDLG_LIMIT_FT) radius = WALLDLG_LIMIT_FT;
    if (model().appendArc(h.index, radius, arcLeft.checked ? angle : -angle) !== 0) {
      setNote(wallArcFailure(w.points.length, angle));
      return;
    }
    sel = w.points.length - 1;
    fillList();
    loadPoint();
    loadShapeEnables();
    setNote("");
    changed();
  });
  // Delete point: the same deletion as the view's right-click Delete Point (the owner refreshes this window).
  delPoint.addEventListener("click", () => {
    if (!theWall() || !thePoint()) return;
    h.deletePoint(sel);
    setNote("");
  });

  const win = openModeless({
    title: h.creating ? "New Wall" : "Wall",
    className: "live wall-window",
    body,
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    onButton: (v) => { if (!closing) h.close(v === "ok"); },
    onCancel: () => { if (!closing) h.close(false); },
  });
  // PreTranslateMessage: the frame's accelerators from the window's controls, the editing keys excepted in a text box.
  win.element.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || document.querySelector("dialog:modal")) return;
    const target = e.target as HTMLElement;
    if (!target.closest("input, select, textarea")) return;   // buttons: the page's own handler passes them on
    const id = ACCELERATORS[keyName(e)];
    if (!id) return;
    if (target instanceof HTMLInputElement && target.type === "text") {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && ["KeyC", "KeyV", "KeyX", "KeyZ", "KeyA"].includes(e.code)) return;
      if (e.key === "Insert" || e.key === "Delete" || e.key === "Backspace") return;
    }
    e.preventDefault();
    void h.registry.exec(id);
  });

  /* OnInitDialog */
  loading = true;
  setBox("aboveall", "0.00");
  setBox("startx", "0.00");
  setBox("startz", "0.00");
  setBox("starthead", "0");
  setBox("strlen", "100.00");
  setBox("arcradius", "50.00");
  setBox("arcangle", "90");
  loading = false;
  loadWall();
  sel = -1;
  fillList();
  loadPoint();
  loadShapeEnables();
  updateProblems();
  changed(true);

  return {
    selected: () => sel,
    refresh: (select = -1) => {
      if (closing) return;
      if (select >= 0) sel = select;
      fillList();
      loadPoint();
      loadShapeEnables();
      updateProblems();
    },
    refreshPoint: () => {
      if (closing) return;
      updateRow(sel);
      loadPoint();
    },
    selectPoint: (p) => {
      if (closing) return;
      select(p);
      setNote("");
      changed(true);
    },
    raise: () => win.raise(),
    focusKeep: () => {
      const w = theWall();
      (w && w.thickness <= 0 ? boxes.thick : boxes.height).focus();
    },
    takeDown: () => {
      if (closing) return;
      closing = true;
      win.close();
    },
  };
}
