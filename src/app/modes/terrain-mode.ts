/*
  Terrain mode (CTraxxView with editmode EDIT_TERRAIN; Traxx/TraxxViewEdit.cpp,
  TraxxViewInteract.cpp, TraxxFrame.cpp OnChar):

    - the brush follows the vertex under the pointer, drawn as a grid of the heights it would
      make, with the ground and new heights labelled (OverlayTerrainGrid);
    - a click or Space applies it (Direct Edit applies with S / ] and X / [ instead);
    - Tab turns it an eighth, - and + change the curvature, [ ] X S the altitude;
    - right-click: Copy Area, Paste Area, Adjust Heights, Copy / Paste Terrain as Bitmap.
*/
import type { ModeHandler, ViewPoint } from "../editor.ts";
import type { ModeContext } from "./context.ts";
import { ATXT_COL, AGRD_COL, EDIT_TERRAIN } from "../../core/settings.ts";
import { adjustHeights, applyEditGrid, brushRect, copyTerrain, heightsToRgba, makeEditGrid, pasteTerrain, previewHeights, rgbaToHeights, type BrushParams, type EditGrid, type TerrainBlock, type Placed } from "../../core/edit/terrain.ts";
import { recordFields, recordGrid } from "../../core/edit/record.ts";
import { deriveBoxHeights } from "../../core/doc/load-pod.ts";
import { CONTEXT_MENUS } from "../../ui/shell/commands.ts";
import { adjustHeightsDialog } from "../../ui/dialogs/adjust-heights.ts";
import { alertDialog } from "../../ui/shell/dialog.ts";
import { copyImage, pasteImage } from "../../shared/system-clipboard.ts";
import { ALTITUDE_SCALE } from "../../core/view/camera.ts";
import { devicePx } from "../../render/overlay.ts";

export function terrainMode(ctx: ModeContext): ModeHandler {
  const { app, editor, view, registry } = ctx;
  let vertex: [number, number] | null = null;
  let brush: EditGrid | null = null;
  let brushKey = "";

  const params = (): BrushParams => {
    const e = app.settings.edit;
    return { tool: e.tool, width: e.terrainw, height: e.terrainh, orientation: e.orientation, curvature: e.curvature, altitude: e.altitude };
  };
  /* MakeEditGrid runs when a setting changes (TX_TERRAINMODE and friends), so Bumps keeps its pattern until then. */
  const grid = (): EditGrid => {
    const p = params();
    const key = JSON.stringify(p);
    if (!brush || key !== brushKey) { brush = makeEditGrid(p); brushKey = key; }
    return brush;
  };
  app.on("settings", () => { if (app.mode === EDIT_TERRAIN) editor.selectionChanged(); });

  const heights = () => editor.doc!.track.heights;

  /* The vertex under the pointer: the nearest grid point to the terrain hit, inside the window. */
  const locate = (p: ViewPoint): [number, number] | null => {
    const hit = view.pick(p.clientX, p.clientY);
    return hit ? hit.vertex : null;
  };

  /* ApplyEditGrid at the brush's vertex, as one undo step. */
  const apply = (label = "Terrain Edit") => {
    if (!vertex || !editor.doc) return;
    const p = params();
    const eg = grid();
    const rect = p.tool === 7 ? brushRect(1, 1, vertex[0], vertex[1]) : brushRect(eg.width, eg.height, vertex[0], vertex[1]);
    const rec = recordGrid(heights(), rect, label, (r) => ({ heights: r }));
    applyEditGrid(heights(), eg, p, vertex[0], vertex[1]);
    editor.commit(rec);
  };

  /* Direct Edit: S / ] adds the altitude to the point, X / [ takes it off (TX_TERRAINAMPLITUDE). */
  const direct = (sign: number) => {
    if (!vertex) return;
    const p = { ...params(), altitude: sign * app.settings.edit.altitude };
    const rec = recordGrid(heights(), brushRect(1, 1, vertex[0], vertex[1]), "Direct Edit", (r) => ({ heights: r }));
    applyEditGrid(heights(), grid(), p, vertex[0], vertex[1]);
    editor.commit(rec);
  };

  const copyArea = () => {
    if (!vertex) return;
    const eg = grid();
    editor.clipboard.terrain = copyTerrain(heights(), eg.width, eg.height, vertex[0], vertex[1]);
    app.emit("commands", undefined);
  };
  const pasteArea = () => {
    const block = editor.clipboard.terrain as TerrainBlock | undefined;
    if (!vertex || !block) return;
    const rec = recordGrid(heights(), brushRect(block.width, block.height, vertex[0], vertex[1]), "Paste Area", (r) => ({ heights: r }));
    pasteTerrain(heights(), block, vertex[0], vertex[1]);
    editor.commit(rec);
  };

  /* Adjust Terrain Heights, with objects, truck starts, course ends and water as chosen. */
  const adjust = async () => {
    const doc = editor.doc;
    if (!doc || !editor.canEdit) return;
    const h = doc.track.heights;
    let min = 255, max = 0;
    for (const v of h) { if (v < min) min = v; if (v > max) max = v; }
    const r = await adjustHeightsDialog(min, max);
    if (!r) return;
    const t = doc.track;
    const recs = [
      recordGrid(h, { minX: 0, minY: 0, maxX: 255, maxY: 255 }, "Adjust Heights", (rect) => ({ heights: rect })),
      recordFields(t, ["boxes", "trucks", "course", "extendedCourses", "waterLevel4"], "Adjust Heights", { objects: true, course: true, trucks: true, water: true }),
    ];
    const placed: Placed[] = [];
    if (r.movePlaced) {
      placed.push(...t.boxes, ...t.trucks);
      for (const course of [t.course, ...t.extendedCourses]) for (const seg of course ?? []) placed.push({ ipos: seg.cstart }, { ipos: seg.cend });
    }
    const res = adjustHeights(h, r, placed, r.moveWater ? t.waterLevel4 : null);
    if (res.water4 !== null) t.waterLevel4 = res.water4;
    // Moved or not, every object's height above ground describes where it now is.
    deriveBoxHeights(t);
    editor.commitAll("Adjust Heights", recs);
  };

  const copyBitmap = async () => {
    if (!editor.doc) return;
    try { await copyImage(heightsToRgba(heights()), 256, 256); app.status("The terrain is on the clipboard as a 256 x 256 greyscale picture."); }
    catch (err) { await alertDialog("Copy Terrain as Bitmap", `The browser would not put the picture on the clipboard: ${err instanceof Error ? err.message : err}`); }
  };
  const pasteBitmap = async () => {
    if (!editor.canEdit) return;
    let img;
    try { img = await pasteImage(); } catch { img = null; }
    const data = img ? rgbaToHeights(img.rgba, img.width, img.height) : null;
    if (!data) { await alertDialog("Paste Terrain Bitmap", "Sorry, the bitmap must be 256 x 256 pixels. Copy a greyscale picture of that size first."); return; }
    const rec = recordGrid(heights(), { minX: 0, minY: 0, maxX: 255, maxY: 255 }, "Paste Terrain Bitmap", (r) => ({ heights: r }));
    heights().set(data);
    editor.commit(rec);
  };

  const editable = () => editor.canEdit;
  registry.bind("ID_TERRAIN_COPY", copyArea, { enabled: () => editable() && vertex !== null });
  registry.bind("ID_TERRAIN_PASTE", pasteArea, { enabled: () => editable() && vertex !== null && Boolean(editor.clipboard.terrain) });
  registry.bind("ID_TERRAIN_RAISELOWER", adjust, { enabled: editable });
  registry.bind("ID_TERRAIN_COPYBITMAP", copyBitmap, { enabled: () => Boolean(editor.doc) });
  registry.bind("ID_TERRAIN_PASTEBITMAP", pasteBitmap, { enabled: editable });

  const setEdit = (change: (e: typeof app.settings.edit) => void) => app.updateSettings((s) => change(s.edit));

  return {
    hover(p) {
      const v = locate(p);
      if (v?.[0] !== vertex?.[0] || v?.[1] !== vertex?.[1]) { vertex = v; editor.selectionChanged(); }
    },
    down(p) {
      vertex = locate(p);
      if (vertex && app.settings.edit.tool !== 7) apply();
    },
    contextMenu(p) {
      vertex = locate(p) ?? vertex;
      return { items: CONTEXT_MENUS.Terrain };
    },
    keyDown(e) {
      const tool = app.settings.edit.tool;
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      switch (e.code) {
        case "Space": if (vertex && tool !== 7) apply(); return true;
        case "Tab": setEdit((s) => { s.orientation = (s.orientation + 1) & 7; }); return true;
        case "Minus": case "NumpadSubtract": setEdit((s) => { s.curvature = Math.max(0, s.curvature - 1); }); return true;
        case "Equal": case "NumpadAdd": setEdit((s) => { s.curvature = Math.min(6, s.curvature + 1); }); return true;
        case "BracketRight": case "KeyS":
          if (tool === 7) direct(1); else setEdit((s) => { s.altitude = Math.min(255, s.altitude + 1); });
          return true;
        case "BracketLeft": case "KeyX":
          if (tool === 7) direct(-1); else setEdit((s) => { s.altitude = Math.max(-255, s.altitude - 1); });
          return true;
      }
      return false;
    },
    copy: copyArea,
    paste: pasteArea,
    canCopy: () => vertex !== null,
    canPaste: () => vertex !== null && Boolean(editor.clipboard.terrain),
    drawOverlay(g, project) {
      const doc = editor.doc;
      if (!doc || !vertex) return;
      const p = params(), eg = grid();
      const w = p.tool === 7 ? 1 : eg.width, h = p.tool === 7 ? 1 : eg.height;
      const hw = (w - 1) >> 1, hh = (h - 1) >> 1;
      const ph = previewHeights(doc.track.heights, eg, p, vertex[0], vertex[1]);
      const pts = Array.from({ length: w * h }, (_, k) => {
        const i = k % w, j = Math.trunc(k / w);
        return project((vertex![0] - hw + i) * 64, (vertex![1] - hh + j) * 64, ALTITUDE_SCALE * ph[k]);
      });
      const colours = app.settings.colors;
      g.strokeStyle = colours[AGRD_COL];
      g.lineWidth = devicePx(g, 1);
      const line = (list: ({ x: number; y: number } | null)[]) => {
        g.beginPath();
        let started = false;
        for (const q of list) {
          if (!q) continue;
          if (!started) { g.moveTo(q.x, q.y); started = true; } else g.lineTo(q.x, q.y);
        }
        g.stroke();
      };
      for (let j = 0; j < h; j++) line(pts.slice(j * w, (j + 1) * w));
      for (let i = 0; i < w; i++) line(Array.from({ length: h }, (_, j) => pts[j * w + i]));
      // The centre: a line down to the ground, the ground height under it and the new height above.
      const centre = pts[hh * w + hw];
      const gx = vertex[0], gy = vertex[1];
      const base = doc.track.heights[Math.min(255, gx) + (Math.min(255, gy) << 8)];
      const basePt = project(gx * 64, gy * 64, ALTITUDE_SCALE * base);
      if (!centre || !basePt) return;
      g.beginPath(); g.moveTo(centre.x, centre.y); g.lineTo(basePt.x, basePt.y); g.stroke();
      g.font = "12px system-ui, sans-serif";
      g.textAlign = "center";
      const text = colours[ATXT_COL];
      g.fillStyle = p.tool === 7 ? text : dim(text);
      g.fillText(String(base), basePt.x, basePt.y);
      if (p.tool !== 4 && p.tool !== 5 && p.tool !== 7) {
        g.fillStyle = text;
        g.fillText(String(ph[hh * w + hw]), centre.x, centre.y - 10);
      }
    },
    selectionText: () => (vertex ? `Vertex ${vertex[0]}, ${vertex[1]}` : ""),
  };
}

/** Three quarters of a colour (the ground label, unless editing a single point). */
function dim(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => ((3 * v) >> 2).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}
