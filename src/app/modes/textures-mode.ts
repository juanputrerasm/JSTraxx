/*
  Textures mode (EDIT_TEXTURES; Traxx/TraxxViewInteract.cpp and TraxxViewEdit.cpp):

    Paint Mode on   a brush of Width x Height cells follows the pointer (kept on the map);
                    a click paints the texture picked in the Textures window. Holding the
                    button and moving paints on (a JSTraxx addition; one undo step).
    Paint Mode off  a click picks a cell, Shift+click stretches the selection to a rectangle;
                    Space paints it.

  R and M turn and mirror the selected area, Ctrl+R and Ctrl+M each cell in place. Right-click:
  the Texture menu, enabled as Traxx enables it (OnContextMenu).
*/
import type { ModeHandler, ViewPoint } from "../editor.ts";
import type { ModeContext } from "./context.ts";
import { CONTEXT_MENUS } from "../../ui/shell/commands.ts";
import { recordFields, recordGrid } from "../../core/edit/record.ts";
import { applyTexture, floodTexture, mirrorArea, mirrorCells, pasteArea, purgeTextures, rotateArea, rotateCells, transitionTextures, unusedTextures, type Area, type TransitionSettings } from "../../core/edit/textures.ts";
import { alertDialog, confirmDialog } from "../../ui/shell/dialog.ts";
import { ALTITUDE_SCALE } from "../../core/view/camera.ts";
import { devicePx } from "../../render/overlay.ts";

/**
  What Copy Area keeps: the area copied (texturecopyfirst and texturecopylast), or a pattern
  picked with the Patterns window's Copy, which pastes itself (it may load textures first).
*/
export type TextureClip = { kind: "area"; from: { x: number; y: number }; rect: Area } | { kind: "pattern"; paste: (area: Area) => Promise<void> };

export function texturesMode(ctx: ModeContext): ModeHandler {
  const { app, editor, view, registry } = ctx;
  let cell: [number, number] | null = null;
  let area: Area | null = null;
  let painting: ReturnType<typeof recordGrid> | null = null;
  let paintedArea: Area | null = null;

  const clr = () => editor.doc!.track.clr;
  const locate = (p: ViewPoint): [number, number] | null => view.pick(p.clientX, p.clientY)?.cell ?? null;
  const paintMode = () => app.settings.edit.paint;

  /* The paint brush around a cell, pushed back inside the map (OnMouseMove, paint mode). */
  const brushAt = (c: [number, number]): Area => {
    const w = app.settings.edit.texturew, h = app.settings.edit.textureh;
    let x0 = c[0] - (w >> 1), y0 = c[1] - (h >> 1);
    let x1 = x0 + w - 1, y1 = y0 + h - 1;
    if (x0 < 0) { x1 -= x0; x0 = 0; } else if (x1 > 255) { x0 -= x1 - 255; x1 = 255; }
    if (y0 < 0) { y1 -= y0; y0 = 0; } else if (y1 > 255) { y0 -= y1 - 255; y1 = 255; }
    return { x0, y0, x1, y1 };
  };
  const rect = (a: Area) => ({ minX: a.x0, minY: a.y0, maxX: a.x1, maxY: a.y1 });
  const edit = (label: string, a: Area, write: () => Area | void) => {
    if (!editor.doc) return;
    // A turned area can land outside its rectangle; record both shapes.
    const w = a.x1 - a.x0 + 1, h = a.y1 - a.y0 + 1;
    const span = { minX: a.x0, minY: a.y0, maxX: Math.min(255, a.x0 + Math.max(w, h) - 1), maxY: Math.min(255, a.y0 + Math.max(w, h) - 1) };
    const rec = recordGrid(clr(), span, label, (r) => ({ clr: r }));
    const written = write();
    if (written && written !== a) area = written;
    editor.commit(rec);
  };

  const applySelected = (tex = editor.selectedTexture) => {
    if (!area || tex < 0) return;
    const a = area;
    edit("Paint Texture", a, () => applyTexture(clr(), a, tex));
  };

  const bind = (id: string, run: () => unknown, enabled: () => boolean) => registry.bind(id, run, { enabled: () => editor.canEdit && enabled() });
  const hasArea = () => area !== null;
  bind("ID_TEXTURE_ROTATE90", () => area && edit("Rotate", area, () => rotateCells(clr(), area!)), hasArea);
  bind("ID_TEXTURE_MIRROR", () => area && edit("Mirror", area, () => mirrorCells(clr(), area!)), hasArea);
  bind("ID_TEXTURE_AREAROT90", () => area && edit("Rotate Area", area, () => rotateArea(clr(), area!)), hasArea);
  bind("ID_TEXTURE_AREAMIRROR", () => area && edit("Mirror Area", area, () => mirrorArea(clr(), area!)), hasArea);
  bind("ID_TEXTURE_AREACOPY", () => { if (area) { editor.clipboard.texture = { kind: "area", from: { x: area.x0, y: area.y0 }, rect: { ...area } } satisfies TextureClip; app.emit("commands", undefined); } }, hasArea);
  bind("ID_TEXTURE_AREAPASTE", () => paste(), () => hasArea() && Boolean(editor.clipboard.texture));
  bind("ID_TEXTURE_SELECT", () => { if (cell && editor.doc) editor.selectTexture(clr()[cell[0] + (cell[1] << 8)] & 0x0fff); }, () => cell !== null);
  bind("ID_TEXTURE_FLOOD", async () => {
    const tex = editor.selectedTexture;
    if (!area || tex < 0) return;
    if (area.x0 !== area.x1 || area.y0 !== area.y1) { await alertDialog("Replace", "Must have single square selected!"); return; }
    const a = area;
    edit("Replace Texture", { x0: 0, y0: 0, x1: 255, y1: 255 }, () => floodTexture(clr(), a.x0, a.y0, tex));
  }, () => hasArea() && editor.selectedTexture >= 0);
  registry.bind("ID_TEXTURE_PURGE", async () => {
    const doc = editor.doc;
    if (!doc) return;
    const unused = unusedTextures(doc);
    if (!unused.length) { await alertDialog("Purge Textures", "There are no unused textures."); return; }
    if (!(await confirmDialog("Purge Textures", `There are ${unused.length} unused textures.\nGo ahead and remove them?`, "Yes"))) return;
    const t = doc.track;
    const recs = [
      recordGrid(t.clr, { minX: 0, minY: 0, maxX: 255, maxY: 255 }, "Purge Textures", (r) => ({ clr: r })),
      recordFields(t, ["groundBoxes", "animations", "textures"], "Purge Textures", { groundBoxes: true, textures: true }),
      recordFields(doc, ["textures"], "Purge Textures", { textures: true }),
    ];
    purgeTextures(doc, unused);
    editor.selectTexture(-1);
    editor.commitAll("Purge Textures", recs);
  }, { enabled: () => editor.canEdit });

  /*
    TX_APPLYTRANS (TransitionTexture): the selected cells when more than one is selected and
    Paint Mode is off, else the whole map.
  */
  editor.actions.applyTransition = ((t: TransitionSettings) => {
    if (!editor.canEdit) return;
    const many = area && !paintMode() && (area.x1 > area.x0 || area.y1 > area.y0);
    const a: Area = many ? { ...area! } : { x0: 0, y0: 0, x1: 255, y1: 255 };
    edit("Texture Transitions", a, () => transitionTextures(clr(), editor.doc!.track.heights, a, t));
  }) as never;

  const paste = () => {
    const clip = editor.clipboard.texture as TextureClip | undefined;
    if (!area || !clip) return;
    const a = area;
    if (clip.kind === "pattern") void clip.paste(a);
    else edit("Paste Area", a, () => pasteArea(clr(), clip.from, a));
  };

  return {
    deactivate() { area = null; cell = null; },
    applyTexture: (index) => applySelected(index),
    hover(p) {
      const c = locate(p);
      if (c?.[0] === cell?.[0] && c?.[1] === cell?.[1]) return;
      cell = c;
      if (paintMode()) area = c ? brushAt(c) : null;
      editor.selectionChanged();
    },
    down(p) {
      cell = locate(p);
      if (!cell) return;
      if (paintMode()) {
        area = brushAt(cell);
        if (editor.selectedTexture < 0) return;
        // One undo step for the whole stroke.
        painting = recordGrid(clr(), { minX: 0, minY: 0, maxX: 255, maxY: 255 }, "Paint Texture", () => ({}));
        paintedArea = { ...area };
        applyTexture(clr(), area, editor.selectedTexture);
        view.refresh({ clr: rect(area) });
        return;
      }
      if (!area || !p.shift) area = { x0: cell[0], y0: cell[1], x1: cell[0], y1: cell[1] };
      else {
        // Shift+click: Traxx's own stretch (OnLButtonDown).
        const [tx, ty] = cell;
        if (tx < area.x0) { area.x1 = area.x0; area.x0 = tx; } else area.x1 = tx;
        if (ty < area.y0) { area.y1 = area.y0; area.y0 = ty; } else area.y1 = ty;
      }
      editor.selectionChanged();
    },
    drag(p) {
      if (!painting) return;
      const c = locate(p);
      if (!c || (c[0] === cell?.[0] && c[1] === cell?.[1])) return;
      cell = c;
      area = brushAt(c);
      applyTexture(clr(), area, editor.selectedTexture);
      paintedArea = { x0: Math.min(paintedArea!.x0, area.x0), y0: Math.min(paintedArea!.y0, area.y0), x1: Math.max(paintedArea!.x1, area.x1), y1: Math.max(paintedArea!.y1, area.y1) };
      view.refresh({ clr: rect(area) });
    },
    up() {
      if (!painting) return;
      const c = painting.finish();
      painting = null;
      if (c && paintedArea) editor.commit({ ...c, touch: { clr: rect(paintedArea) } });
    },
    contextMenu(p) {
      const c = locate(p);
      // A right-click outside the selection selects that cell first.
      if (c && (!area || c[0] < area.x0 || c[0] > area.x1 || c[1] < area.y0 || c[1] > area.y1)) {
        area = { x0: c[0], y0: c[1], x1: c[0], y1: c[1] };
        cell = c;
        editor.selectionChanged();
      }
      return { items: CONTEXT_MENUS.Texture };
    },
    keyDown(e) {
      if (e.altKey) return false;
      const ctrl = e.ctrlKey || e.metaKey;
      switch (e.code) {
        case "Space": if (!ctrl) { applySelected(); return true; } return false;
        case "KeyR": registry.exec(ctrl ? "ID_TEXTURE_ROTATE90" : "ID_TEXTURE_AREAROT90"); return true;
        case "KeyM": registry.exec(ctrl ? "ID_TEXTURE_MIRROR" : "ID_TEXTURE_AREAMIRROR"); return true;
      }
      return false;
    },
    copy: () => registry.exec("ID_TEXTURE_AREACOPY"),
    paste,
    canCopy: () => area !== null,
    canPaste: () => area !== null && Boolean(editor.clipboard.texture),
    drawOverlay(g, project) {
      const doc = editor.doc;
      const a = area ?? (cell ? { x0: cell[0], y0: cell[1], x1: cell[0], y1: cell[1] } : null);
      if (!doc || !a) return;
      outlineCells(g, project, doc.track.heights, a);
    },
    selectionText: () => (area ? (area.x0 === area.x1 && area.y0 === area.y1 ? `Cell ${area.x0}, ${area.y0}` : `Cells ${area.x0},${area.y0} - ${area.x1},${area.y1}`) : ""),
  };
}

/*
  OverlayTerrainRect: cells x0..x1, y0..y1 outlined on the ground in 3 pixels of yellow, the
  four corners at the heights of their vertices.
*/
export function outlineCells(g: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => { x: number; y: number } | null, heights: Uint8Array, a: Area): void {
  const xb = Math.min(255, a.x1 + 1), yb = Math.min(255, a.y1 + 1);
  const corners = [
    project(a.x0 * 64, a.y0 * 64, ALTITUDE_SCALE * heights[a.x0 + (a.y0 << 8)]),
    project((a.x1 + 1) * 64, a.y0 * 64, ALTITUDE_SCALE * heights[xb + (a.y0 << 8)]),
    project((a.x1 + 1) * 64, (a.y1 + 1) * 64, ALTITUDE_SCALE * heights[xb + (yb << 8)]),
    project(a.x0 * 64, (a.y1 + 1) * 64, ALTITUDE_SCALE * heights[a.x0 + (yb << 8)]),
  ];
  g.strokeStyle = "#ffff00";
  g.lineWidth = devicePx(g, 3);
  for (let k = 0; k < 4; k++) {
    const p = corners[k], q = corners[(k + 1) % 4];
    if (!p || !q) continue;
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
  }
}
