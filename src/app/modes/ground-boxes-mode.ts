/*
  Ground Boxes mode (EDIT_BUILDINGS; Traxx/TraxxViewInteract.cpp, TraxxViewEdit.cpp):

    - the face under the pointer is outlined in yellow, or the empty cell when there is none;
    - a click selects that face (cyan) and loads the box's heights into Top and Bottom, which
      then set its heights; with a Paint option on it also paints the texture picked in the
      Textures window on the face, the sides, top and bottom, or every face;
    - R and M turn and mirror the selected face's texture, Delete removes the box, X S [ ]
      move Top (a top face selected) or Bottom;
    - right-click: Insert, Delete, Rotate, Mirror, Cut, Copy, Paste.
*/
import type { ModeHandler, ViewPoint } from "../editor.ts";
import type { ModeContext } from "./context.ts";
import { CONTEXT_MENUS } from "../../ui/shell/commands.ts";
import { recordFields } from "../../core/edit/record.ts";
import { clampBottom, clampTop, copyGroundBox, insertGroundBox, mirrorFace, paintGroundBox, pasteGroundBox, rotateFace, type GroundBoxClip } from "../../core/edit/ground-boxes.ts";
import { outlineCells } from "./textures-mode.ts";
import { ALTITUDE_SCALE } from "../../core/view/camera.ts";
import { EDIT_BUILDINGS } from "../../core/settings.ts";
import type { TxxGroundBox } from "../../core/traxx/txx.ts";
import { devicePx } from "../../render/overlay.ts";

export function groundBoxesMode(ctx: ModeContext): ModeHandler {
  const { app, editor, view, registry } = ctx;
  let hover: [number, number] | null = null;
  let selected: [number, number] | null = null;
  let cell: [number, number] | null = null;
  let syncing = false;

  const track = () => editor.doc!.track;
  const box = () => (selected ? track().groundBoxes[selected[0]] ?? null : null);
  const touch = { groundBoxes: true };
  const edit = (label: string, change: () => unknown) => {
    const rec = recordFields(track(), ["groundBoxes"], label, touch);
    change();
    editor.commit(rec);
    editor.selectionChanged();
  };

  const locate = (p: ViewPoint) => {
    hover = view.pickGroundBox(p.clientX, p.clientY);
    cell = hover ? null : view.pick(p.clientX, p.clientY)?.cell ?? null;
  };

  /* BuildingFaceNotify: the selected box's heights into the bar. */
  const notify = () => {
    const b = box();
    if (!b) return;
    syncing = true;
    app.setTools({ gbTop: b.upper, gbBottom: b.lower });
    syncing = false;
  };

  /* SetBuildingAltitude: the bar's heights onto the selected box. */
  app.on("tools", (t) => {
    const b = box();
    if (syncing || app.mode !== EDIT_BUILDINGS || !b || !editor.canEdit) return;
    if (b.upper === t.gbTop && b.lower === t.gbBottom) return;
    edit("Box Height", () => { b.upper = t.gbTop; b.lower = t.gbBottom; });
  });

  const can = () => editor.canEdit;
  const hasBox = () => can() && box() !== null;
  const insertAt = (x: number, y: number, maker: (boxes: TxxGroundBox[]) => number | null, label: string) => {
    let index: number | null = null;
    edit(label, () => { index = maker(track().groundBoxes); });
    if (index !== null) { selected = [index, 5]; notify(); editor.selectionChanged(); }
    void x; void y;
  };
  registry.bind("ID_BUILDING_INSERT", () => {
    if (!cell) return;
    const [x, y] = cell;
    insertAt(x, y, (bx) => insertGroundBox(bx, x, y, app.tools.gbBottom, app.tools.gbTop, editor.selectedTexture), "Insert Ground Box");
  }, { enabled: () => can() && cell !== null && !hover });
  const remove = () => {
    const s = selected;
    if (!s) return;
    edit("Delete Ground Box", () => { track().groundBoxes.splice(s[0], 1); });
    selected = null;
    editor.selectionChanged();
  };
  registry.bind("ID_BUILDING_DELETE", remove, { enabled: hasBox });
  registry.bind("ID_BUILDING_ROT90", () => { const b = box(); if (b && selected) edit("Rotate Face", () => rotateFace(b, selected![1])); }, { enabled: hasBox });
  registry.bind("ID_BUILDING_MIRROR", () => { const b = box(); if (b && selected) edit("Mirror Face", () => mirrorFace(b, selected![1])); }, { enabled: hasBox });
  const copy = () => { const b = box(); if (b) { editor.clipboard.groundBox = copyGroundBox(b); app.emit("commands", undefined); } };
  registry.bind("ID_BUILDING_COPY", copy, { enabled: hasBox });
  registry.bind("ID_BUILDING_CUT", () => { copy(); remove(); }, { enabled: hasBox });
  const paste = () => {
    const clip = editor.clipboard.groundBox as GroundBoxClip | undefined;
    if (!clip || !cell) return;
    const [x, y] = cell;
    insertAt(x, y, (bx) => pasteGroundBox(bx, clip, x, y), "Paste Ground Box");
  };
  registry.bind("ID_BUILDING_PASTE", paste, { enabled: () => can() && cell !== null && !hover && Boolean(editor.clipboard.groundBox) });

  /* The two triangles of one face, from the ground-box geometry. */
  const faceOutline = (g: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => { x: number; y: number } | null, face: [number, number], colour: string) => {
    const b = track().groundBoxes[face[0]];
    if (!b) return;
    const x0 = b.x * 64, y0 = b.y * 64, x1 = x0 + 64 * b.w, y1 = y0 + 64 * b.h, zl = ALTITUDE_SCALE * b.lower, zu = ALTITUDE_SCALE * b.upper;
    const quads: [number, number, number][][] = [
      [[x0, y0, zl], [x1, y0, zl], [x1, y0, zu], [x0, y0, zu]],
      [[x0, y1, zl], [x1, y1, zl], [x1, y1, zu], [x0, y1, zu]],
      [[x1, y0, zl], [x1, y1, zl], [x1, y1, zu], [x1, y0, zu]],
      [[x0, y0, zl], [x0, y1, zl], [x0, y1, zu], [x0, y0, zu]],
      [[x0, y0, zu], [x1, y0, zu], [x1, y1, zu], [x0, y1, zu]],
      [[x0, y0, zl], [x1, y0, zl], [x1, y1, zl], [x0, y1, zl]],
    ];
    const pts = quads[face[1]].map(([x, y, z]) => project(x, y, z));
    g.strokeStyle = colour;
    g.lineWidth = devicePx(g, 3);
    for (let k = 0; k < 4; k++) {
      const p = pts[k], q = pts[(k + 1) % 4];
      if (p && q) { g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); }
    }
  };

  return {
    deactivate() { hover = selected = null; cell = null; },
    /* ApplyBuildingTexture: the selected face, as the Paint mode says. */
    applyTexture(index) {
      const b = box();
      if (b && selected && editor.canEdit) edit("Paint Ground Box", () => paintGroundBox(b, selected![1], app.tools.gbPaint, index));
    },
    hover(p) { locate(p); editor.selectionChanged(); },
    down(p) {
      locate(p);
      selected = hover;
      if (selected) {
        notify();
        const mode = app.tools.gbPaint, tex = editor.selectedTexture;
        const b = box();
        if (mode && tex >= 0 && b) edit("Paint Ground Box", () => paintGroundBox(b, selected![1], mode, tex));
      }
      editor.selectionChanged();
    },
    contextMenu(p) {
      locate(p);
      if (hover) { selected = hover; notify(); }
      editor.selectionChanged();
      return { items: CONTEXT_MENUS.Building };
    },
    keyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const topFace = selected?.[1] === 4;
      switch (e.code) {
        case "KeyR": registry.exec("ID_BUILDING_ROT90"); return true;
        case "KeyM": registry.exec("ID_BUILDING_MIRROR"); return true;
        case "KeyS": case "BracketRight":
          if (topFace) app.setTools({ gbTop: clampTop(app.tools.gbTop + 1, app.tools.gbBottom) });
          else if (selected) app.setTools({ gbBottom: clampBottom(app.tools.gbBottom + 1, app.tools.gbTop) });
          return true;
        case "KeyX": case "BracketLeft":
          if (topFace) app.setTools({ gbTop: clampTop(app.tools.gbTop - 1, app.tools.gbBottom) });
          else if (selected) app.setTools({ gbBottom: clampBottom(app.tools.gbBottom - 1, app.tools.gbTop) });
          return true;
      }
      return false;
    },
    keyUp(e) {
      if (e.code === "Delete") { remove(); return true; }
      return false;
    },
    copy,
    paste,
    canCopy: () => box() !== null,
    canPaste: () => cell !== null && Boolean(editor.clipboard.groundBox),
    drawOverlay(g, project) {
      const doc = editor.doc;
      if (!doc) return;
      if (cell && !hover) outlineCells(g, project, doc.track.heights, { x0: cell[0], y0: cell[1], x1: cell[0], y1: cell[1] });
      if (selected) faceOutline(g, project, selected, "#00ffff");
      if (hover) faceOutline(g, project, hover, "#ffff00");
    },
    selectionText: () => {
      const b = box();
      return b && selected ? `Box ${b.x}, ${b.y} ${["south", "north", "east", "west", "top", "bottom"][selected[1]]}` : "";
    },
  };
}
