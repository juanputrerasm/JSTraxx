/*
  Terrain mode (CTraxxView with editmode EDIT_TERRAIN; Traxx/TraxxViewEdit.cpp,
  TraxxViewInteract.cpp, TraxxFrame.cpp OnChar):

    - the brush follows the vertex under the pointer, drawn as a grid of the heights it would
      make, with the ground and new heights labelled (OverlayTerrainGrid);
    - a click or Space applies it (Direct Edit applies with S / ] and X / [ instead);
    - Tab turns it an eighth, - and + change the curvature, [ ] X S the altitude;
    - right-click: Copy Area, Paste Area, Adjust Heights, Copy / Paste Terrain as Bitmap.

  Traxx 1.7: on a Full Map the brush point is the 8 ft vertex under the pointer (editfine,
  TerrainPickFine: FineVertexAtPoint of the picked point) and `vertex` its 32 ft tile, which the
  lakes keep using; the brush, Copy and Paste Area work on the 1024 grid with wrap. CLASSIC16 and
  Spline work on h16. Every terrain edit passes the lake guard.

  Traxx 1.7.1: the waterfall items follow the lake items on the right-click menu, and while a
  crest is being captured the clicks, Backspace, Enter, Esc, Space and the right-click are the
  capture's (fall-commands.ts); leaving Terrain mode ends it.
*/
import type { ModeHandler, ViewPoint } from "../editor.ts";
import type { ModeContext } from "./context.ts";
import { ATXT_COL, AGRD_COL, EDIT_TERRAIN } from "../../core/settings.ts";
import {
  adjustHeights, altitudeV, applyBrush, brushPreview, brushRect, copyArea as copyBlock, heightsToRgba, makeEditGrid, pasteArea as pasteBlock,
  pasteBitmapHeights, pasteBitmapRefusal, pasteFits, previewLabel, rgbaToHeights, stampWindow, type BrushParams, type EditGrid, type TerrainBlock, type Placed,
} from "../../core/edit/terrain.ts";
import { amplitudeFractional, amplitudeText, stepAmplitude } from "../../core/edit/amplitude.ts";
import { recordFields, recordGrid, recordWindow } from "../../core/edit/record.ts";
import { deriveBoxHeights } from "../../core/doc/load-pod.ts";
import { CONTEXT_MENUS } from "../../ui/shell/commands.ts";
import { adjustHeightsDialog } from "../../ui/dialogs/adjust-heights.ts";
import type { AdjustFeet } from "../../core/edit/terrain.ts";
import { alertDialog } from "../../ui/shell/dialog.ts";
import { copyImage, pasteImage } from "../../shared/system-clipboard.ts";
import { ALTITUDE_SCALE } from "../../core/view/camera.ts";
import { devicePx } from "../../render/overlay.ts";
import { lakeCommands, lakeErrors, lakeRefusal } from "./lake-commands.ts";
import { adjustHeights16, fineVertexAtPoint } from "../../core/traxx/surface.ts";
import { cellsOf } from "../../core/traxx/world.ts";
import { trackWaterRange } from "../../core/traxx/v6.ts";
import { syncFromRaw, TERRAINMODE_FINE, type Terrain16 } from "../../core/traxx/terrain16.ts";
import { buildLakeGround } from "../../core/traxx/surface.ts";
import { lakeHoldsUpTo, lakeMinHeight, lakeNearestLegalHeight, recomputeLakes, lakeMaxHeightFor, lakeMinHeightFor, LAKE_NO_BASIN } from "../../core/traxx/lakes.ts";
import { trackNotches } from "../../core/traxx/falls.ts";
import { fallCommands } from "./fall-commands.ts";
import type { Recording } from "../../core/edit/record.ts";
import { publishFeetLimit, publishTerrainMode, trackFeetLimit } from "../terrain-kind.ts";
import { amplitudeFeetRange, amplitudeFeetText, stepAmplitudeFeet } from "../../core/edit/feet-fields.ts";
import { heightsInFeet } from "../../core/traxx/height-units.ts";
import { heightLimit } from "../../core/traxx/track-kind.ts";

export function terrainMode(ctx: ModeContext): ModeHandler {
  const { app, editor, view, registry } = ctx;
  /** editlocation: the 32 ft vertex (on a Full Map, the tile of the 8 ft point). */
  let vertex: [number, number] | null = null;
  /** editfine: a Full Map's 8 ft point under the pointer, 0..1023 each way. */
  let fineVertex: [number, number] | null = null;
  let brush: EditGrid | null = null;
  let brushKey = "";

  const onFine = () => editor.doc?.track.terrainMode === TERRAINMODE_FINE;
  const params = (): BrushParams => {
    const e = app.settings.edit;
    return { tool: e.tool, width: e.terrainw, height: e.terrainh, orientation: e.orientation, curvature: e.curvature, altitude: e.altitude, fine: onFine() };
  };
  /*
    MakeEditGrid runs when a setting changes (TX_TERRAINMODE and friends) or the track's limits
    do (EditGridFollowMode), so Bumps keeps its pattern until then.
  */
  const grid = (): EditGrid => {
    const p = params();
    const key = JSON.stringify(p);
    if (!brush || key !== brushKey) { brush = makeEditGrid(p); brushKey = key; }
    return brush;
  };
  app.on("settings", () => { if (app.mode === EDIT_TERRAIN) editor.selectionChanged(); });

  /*
    The edit bar follows the track's mode (OnUpdateEditSizeRange, FollowAmplitudeKind); a mode
    change also drops the brush point (OnTerrainGrid: editfine = -1).
  */
  let lastMode: number | null = null;
  const follow = () => {
    const mode = editor.doc?.track.terrainMode ?? null;
    if (mode !== lastMode) { lastMode = mode; vertex = fineVertex = null; }
    // The kind's unit is published first: the Altitude box reads it when the mode arrives.
    const t = editor.doc?.track;
    publishFeetLimit(app, t && heightsInFeet(t) ? heightLimit(t) : 0);
    publishTerrainMode(app, mode);
  };
  app.on("commands", follow);
  follow();

  const heights = () => editor.doc!.track.heights;
  /** N, the track's cells a side (track format version 6, spec section 8.1: 256 or 512). */
  const cells = () => cellsOf(editor.doc?.track);
  const all = () => ({ minX: 0, minY: 0, maxX: cells() - 1, maxY: cells() - 1 });

  /*
    The vertex under the pointer: the nearest grid point to the terrain hit. On a Full Map the
    nearest 8 ft point to the hit (TerrainPickFine), and its tile.
  */
  const locate = (p: ViewPoint): { vertex: [number, number]; fine: [number, number] | null } | null => {
    const hit = view.pick(p.clientX, p.clientY);
    if (!hit) return null;
    if (!onFine()) return { vertex: hit.vertex, fine: null };
    // TerrainPickFine: whole ipos plus the 1/256 fraction, all FineVertexAtPoint needs.
    const fv = fineVertexAtPoint(hit.ipos[0] * 256 + hit.fraction[0], hit.ipos[1] * 256 + hit.fraction[1], cells());
    const fx = fv & 0xffff, fy = (fv >> 16) & 0xffff;
    return { vertex: [fx >> 2, fy >> 2], fine: [fx, fy] };
  };
  const moveTo = (l: ReturnType<typeof locate>) => { vertex = l?.vertex ?? null; fineVertex = l?.fine ?? null; };
  /** The brush's centre on the grid it edits: the 8 ft point on a Full Map (none yet: nothing to edit). */
  const centre = (): [number, number] | null => (onFine() ? fineVertex : vertex);

  /*
    Every grid a terrain edit can touch, recorded over `rect`: raw, and on a 16-bit track h16 and
    the mirror's shadow too, so an undo puts the fractions back and leaves nothing to fold.
  */
  const recordTerrain = (rect: { minX: number; minY: number; maxX: number; maxY: number }, label: string): Recording[] => {
    const t = editor.doc!.track;
    const recs = [recordGrid(t.heights, rect, label, (r) => ({ heights: r }))];
    if (t.h16) recs.push(recordGrid(t.h16, rect, label, (r) => ({ heights: r })));
    if (t.rawShadow) recs.push(recordGrid(t.rawShadow, rect, label, (r) => ({ heights: r })));
    return recs;
  };

  /*
    A w x h stamp at the centre: on a Full Map the window of 8 ft points it writes (wrapping) and
    the 32 ft mirror under it (TraxxUndo's gridfine, but only the window); else the cells.
  */
  const recordStamp = (t: Terrain16, w: number, h: number, c: [number, number], label: string): Recording[] => {
    const n = cellsOf(t);
    if (!t.fine) return recordTerrain(brushRect(w, h, c[0], c[1], n), label);
    const win = stampWindow(t, w, h, c[0], c[1]);
    const touch = { heights: win.touch };
    const k = win.coarse;
    const recs = [recordWindow(t.fine, 4 * n, win.x0, win.y0, win.w, win.h, label, touch), recordWindow(t.heights, n, k.x0, k.y0, k.w, k.h, label, touch)];
    if (t.rawShadow) recs.push(recordWindow(t.rawShadow, n, k.x0, k.y0, k.w, k.h, label, touch));
    return recs;
  };

  /*
    The lake guard (LakesRefuseTerrainEdit): commit the edit, or put it back with Traxx's message
    when it gave a lake an error it did not have.
  */
  const commitGuarded = (label: string, what: string, recs: Recording[], before: number[]) => {
    const refusal = lakeRefusal(editor.doc!.track, before, what);
    const change = editor.commitAll(label, recs);
    if (refusal && change) {
      editor.undo();
      void alertDialog(what, refusal);
    }
  };

  /*
    ApplyEditGrid at the brush's centre, as one undo step. Any pending 8-bit edit is folded in
    first (SaveTerrainUndo's SyncFromRaw), then the brush goes on raw (classic 8-bit), h16
    (CLASSIC16, Spline: clipped) or the 1024 grid (Full Map: wrapping), terraingridv in v.
  */
  const apply = (label = "Terrain Edit", altitudeSign = 0) => {
    if (!vertex || !editor.doc) return;
    const t = editor.doc.track;
    const c = centre();
    if (!c) return;
    // Direct Edit: TX_TERRAINAMPLITUDE carries +-direct_alt as terrainzv.
    const p = altitudeSign ? { ...params(), altitude: altitudeSign * app.settings.edit.altitude } : params();
    const eg = grid();
    const w = p.tool === 7 ? 1 : eg.width, h = p.tool === 7 ? 1 : eg.height;
    syncFromRaw(t);
    const before = lakeErrors(t);
    const recs = recordStamp(t, w, h, c, label);
    applyBrush(t, eg, p, c[0], c[1]);
    commitGuarded(label, "The terrain edit", recs, before);
  };

  /* Direct Edit: S / ] adds the altitude to the point, X / [ takes it off (TX_TERRAINAMPLITUDE). */
  const direct = (sign: number) => apply("Direct Edit", sign);

  /* OnTerrainCopy: the rotated brush's size around the centre, in the units of the track's grid. */
  const copyArea = () => {
    const c = centre();
    if (!vertex || !c || !editor.doc) return;
    const eg = grid();
    syncFromRaw(editor.doc.track);
    editor.clipboard.terrain = copyBlock(editor.doc.track, eg.width, eg.height, c[0], c[1]);
    app.emit("commands", undefined);
  };
  const canPasteArea = () => {
    const block = editor.clipboard.terrain as TerrainBlock | undefined;
    const t = editor.doc?.track;
    return Boolean(vertex && centre() && block && t && pasteFits(block, t));
  };
  const pasteArea = () => {
    const block = editor.clipboard.terrain as TerrainBlock | undefined;
    const c = centre();
    const t = editor.doc?.track;
    if (!vertex || !c || !block || !t || !pasteFits(block, t)) return;
    syncFromRaw(t);
    const before = lakeErrors(t);
    const recs = recordStamp(t, block.width, block.height, c, "Paste Area");
    pasteBlock(t, block, c[0], c[1]);
    commitGuarded("Paste Area", "Paste Area", recs, before);
  };

  /* Adjust Terrain Heights, with objects, truck starts, course ends and water as chosen. */
  const adjust = async () => {
    const doc = editor.doc;
    if (!doc || !editor.canEdit) return;
    // A pending 8-bit edit is folded in first (SaveTerrainUndo's SyncFromRaw).
    syncFromRaw(doc.track);
    const h = doc.track.heights;
    let min = 255, max = 0;
    for (const v of h) { if (v < min) min = v; if (v > max) max = v; }
    // Traxx origin/main OnTerrainRaiseLower: a v6 track's dialog works in feet (v inside), against the
    // terrain's own height limit, from the exact lowest and highest of its grid.
    const g16 = doc.track.fine ?? doc.track.h16;
    let feet: AdjustFeet | null = null;
    if (g16 && heightsInFeet(doc.track)) {
      let lo = heightLimit(doc.track), hi = 0;
      for (let i = 0; i < g16.length; i++) { const v = g16[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
      feet = { minv: lo, maxv: hi, hmax: heightLimit(doc.track), liftv: 0 };
    }
    const r = await adjustHeightsDialog(min, max, feet);
    if (!r) return;
    if (feet) feet.liftv = r.liftv;
    const t = doc.track;
    const before = lakeErrors(t);
    const recs: Recording[] = [
      ...recordTerrain(all(), "Adjust Heights"),
      recordFields(t, ["boxes", "trucks", "course", "extendedCourses", "waterLevel4", "lakes", "fine"], "Adjust Heights", { objects: true, course: true, trucks: true, water: true }),
    ];
    const placed: Placed[] = [];
    if (r.movePlaced) {
      // Objects carry their fractions; truck starts and course ends have none (AddPlacedPoint).
      placed.push(...t.boxes, ...t.trucks.map((tr) => ({ ipos: tr.ipos })));
      for (const course of [t.course, ...t.extendedCourses]) for (const seg of course ?? []) placed.push({ ipos: seg.cstart }, { ipos: seg.cend });
    }
    // 16-bit tracks: the same factor and lift (taken from the 8-bit mirror) on h16 or the Full Map
    // grid, inc * 256 (AdjustHeights16 / AdjustHeightsFine), so fractions survive.
    // The water keeps to its kind's 0..WaterLevelMax4 (Traxx's 0..510 ft on a classic track).
    const waterRange = trackWaterRange(t);
    const res = adjustHeights(h, r, placed, r.moveWater ? t.waterLevel4 : null,
      t.fine || t.h16 ? (scale, liftv, f) => adjustHeights16(t, scale, liftv, f) : undefined, t, waterRange, feet ?? undefined);
    if (res.water4 !== null) t.waterLevel4 = res.water4;
    // The lakes are refitted whatever "move water" says: lifted 4N or scaled floor(H * f), then
    // moved to the nearest height the basin legally holds.
    if (t.lakes.length) {
      // Format version 6: on a 32-bit ground the lake may sit anywhere in the terrain's range (spec 9.1).
      const range = buildLakeGround(t);
      const lo = lakeMinHeightFor(range), hi = lakeMaxHeightFor(range);
      for (const lake of t.lakes) {
        const lh = r.scale ? Math.floor(lake.height * res.factor + 1e-9) : lake.height + res.dq;
        lake.height = Math.max(lo, Math.min(hi, lh));
      }
      // With the falls' notches (Traxx 1.7.1); the ceiling is what the lake holds (HoldsUpTo).
      const g = buildLakeGround(t);
      const notches = trackNotches(t);
      const st = recomputeLakes(g, t.lakes, t.waterLevel4, notches);
      t.lakes.forEach((lake, li) => {
        const spill = st.lakes[li]!.spill;
        if (spill === LAKE_NO_BASIN) return;
        const n = lakeNearestLegalHeight(g, lake, lake.height, lakeMinHeight(g, t.waterLevel4, lake, notches, li), lakeHoldsUpTo(g, t.lakes, st, t.waterLevel4, li), notches, li);
        if (n >= 0) lake.height = n;
      });
    }
    // Moved or not, every object's height above ground describes where it now is.
    deriveBoxHeights(t);
    commitGuarded("Adjust Heights", "Adjust Terrain Heights", recs, before);
  };

  const copyBitmap = async () => {
    if (!editor.doc) return;
    const n = cells();
    try { await copyImage(heightsToRgba(heights()), n, n); app.status(`The terrain is on the clipboard as a ${n} x ${n} greyscale picture.`); }
    catch (err) { await alertDialog("Copy Terrain as Bitmap", `The browser would not put the picture on the clipboard: ${err instanceof Error ? err.message : err}`); }
  };
  const pasteBitmap = async () => {
    if (!editor.canEdit) return;
    // TerrainIsFine: a 256 x 256 8-bit picture is Import Heightmap's job on a Full Map.
    if (onFine()) { app.status("On a 16-bit Full Map track, use Import Heightmap instead"); return; }
    let img;
    try { img = await pasteImage(); } catch { img = null; }
    const n = cells();
    const data = img ? rgbaToHeights(img.rgba, img.width, img.height, n) : null;
    // TraxxViewEdit.cpp OnTerrainPasteBitmap (Traxx 1.8.2): N x N, or 256 x 256 into a 512 world's corner.
    if (!data) { await alertDialog("Paste Terrain Bitmap", pasteBitmapRefusal(img?.width ?? 0, img?.height ?? 0, n) ?? ""); return; }
    const t = editor.doc!.track;
    if (t.terrainMode === TERRAINMODE_FINE) return;
    syncFromRaw(t);
    const before = lakeErrors(t);
    const recs = recordTerrain(all(), "Paste Terrain Bitmap");
    // 16-bit tracks: each byte b is the height b << 8 in h16, then the mirror follows.
    pasteBitmapHeights(t, data);
    commitGuarded("Paste Terrain Bitmap", "Paste Terrain Bitmap", recs, before);
  };

  const editable = () => editor.canEdit;
  registry.bind("ID_TERRAIN_COPY", copyArea, { enabled: () => editable() && vertex !== null && centre() !== null });
  // A block pastes only on the kind of grid it was copied from (TerrainPasteFits).
  registry.bind("ID_TERRAIN_PASTE", pasteArea, { enabled: () => editable() && canPasteArea() });
  registry.bind("ID_TERRAIN_RAISELOWER", adjust, { enabled: editable });
  registry.bind("ID_TERRAIN_COPYBITMAP", copyBitmap, { enabled: () => Boolean(editor.doc) });
  registry.bind("ID_TERRAIN_PASTEBITMAP", pasteBitmap, { enabled: () => editable() && editor.doc?.track.terrainMode !== TERRAINMODE_FINE });
  const lakes = lakeCommands(ctx, () => vertex && [vertex[0] & (cells() - 1), vertex[1] & (cells() - 1)]);
  const falls = fallCommands(ctx);

  const setEdit = (change: (e: typeof app.settings.edit) => void) => app.updateSettings((s) => change(s.edit));

  return {
    deactivate() { falls.abort(); },
    hover(p) {
      const l = locate(p);
      const same = l?.vertex[0] === vertex?.[0] && l?.vertex[1] === vertex?.[1] && l?.fine?.[0] === fineVertex?.[0] && l?.fine?.[1] === fineVertex?.[1];
      if (!same) { moveTo(l); editor.selectionChanged(); }
    },
    down(p) {
      // Waterfall capture: the click is a crest point, never a terrain edit.
      if (falls.capturing()) { falls.click(p); return; }
      moveTo(locate(p));
      if (vertex && app.settings.edit.tool !== 7) apply();
    },
    contextMenu(p) {
      // Waterfall capture: a right-click finishes the crest (it opens no menu).
      if (falls.capturing()) { falls.finish(); return null; }
      const l = locate(p);
      if (l) moveTo(l);
      return { items: [...CONTEXT_MENUS.Terrain, ...lakes.menuItems(), ...falls.menuItems(p)] };
    },
    keyDown(e) {
      // Waterfall capture owns Backspace, Enter, Esc and Space.
      if (falls.key(e)) return true;
      const tool = app.settings.edit.tool;
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      /*
        [ ] X S: Direct Edit applies; otherwise the Altitude moves a whole step on a classic track
        and 0.1 on a 16-bit one (StepAmplitude, from the box as it reads).
      */
      const nudge = (sign: number) => {
        if (tool === 7) { direct(sign); return; }
        const mode = editor.doc?.track.terrainMode ?? null;
        const limit = trackFeetLimit(app);
        if (limit > 0) {
          // Traxx origin/main: a v6 track's StepAmplitude is 1 ft, from the box's feet, in the tool's range.
          const range = amplitudeFeetRange(tool, limit);
          const v = stepAmplitudeFeet(amplitudeFeetText(altitudeV(app.settings.edit.altitude), range), sign, range);
          setEdit((s) => { s.altitude = v / 256; });
        } else if (amplitudeFractional(mode)) {
          const v = stepAmplitude(amplitudeText(altitudeV(app.settings.edit.altitude), true), sign);
          setEdit((s) => { s.altitude = v / 256; });
        } else setEdit((s) => { s.altitude = Math.max(-255, Math.min(255, Math.round(s.altitude) + sign)); });
      };
      switch (e.code) {
        case "Space": if (vertex && tool !== 7) apply(); return true;
        case "Tab": setEdit((s) => { s.orientation = (s.orientation + 1) & 7; }); return true;
        case "Minus": case "NumpadSubtract": setEdit((s) => { s.curvature = Math.max(0, s.curvature - 1); }); return true;
        case "Equal": case "NumpadAdd": setEdit((s) => { s.curvature = Math.min(6, s.curvature + 1); }); return true;
        case "BracketRight": case "KeyS": nudge(1); return true;
        case "BracketLeft": case "KeyX": nudge(-1); return true;
      }
      return false;
    },
    copy: copyArea,
    paste: pasteArea,
    canCopy: () => vertex !== null && centre() !== null,
    canPaste: canPasteArea,
    /*
      OverlayTerrainGrid: the stamp's new heights (8 ft points on a Full Map, thinned above 40 a
      side; h16 on 16-bit tracks), a line from the centre down to the ground, and both heights
      labelled (to a tenth of a step on 16-bit tracks).
    */
    drawOverlay(g, project) {
      const doc = editor.doc;
      const c = centre();
      if (!doc || !vertex || !c) return;
      const p = params(), eg = grid();
      const w = p.tool === 7 ? 1 : eg.width, h = p.tool === 7 ? 1 : eg.height;
      const hw = (w - 1) >> 1, hh = (h - 1) >> 1;
      const pv = brushPreview(doc.track, eg, p, c[0], c[1]);
      const ni = pv.cols.length, nj = pv.rows.length;
      const z = (v: number) => (ALTITUDE_SCALE * v) / 256;
      const pts = Array.from({ length: ni * nj }, (_, k) => {
        const i = pv.cols[k % ni]!, j = pv.rows[Math.trunc(k / ni)]!;
        return project((c[0] - hw + i) * pv.spacing, (c[1] - hh + j) * pv.spacing, z(pv.v[k]!));
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
      for (let j = 0; j < nj; j++) line(pts.slice(j * ni, (j + 1) * ni));
      for (let i = 0; i < ni; i++) line(Array.from({ length: nj }, (_, j) => pts[j * ni + i]!));
      // The centre: a line down to the ground, the ground height under it and the new height above.
      const top = pts[pv.cj * ni + pv.ci];
      const basePt = project(c[0] * pv.spacing, c[1] * pv.spacing, z(pv.baseV));
      if (!top || !basePt) return;
      g.beginPath(); g.moveTo(top.x, top.y); g.lineTo(basePt.x, basePt.y); g.stroke();
      g.font = "12px system-ui, sans-serif";
      g.textAlign = "center";
      const text = colours[ATXT_COL];
      g.fillStyle = p.tool === 7 ? text : dim(text);
      g.fillText(previewLabel(pv.baseV, pv.precise), basePt.x, basePt.y);
      if (p.tool !== 4 && p.tool !== 5 && p.tool !== 7) {
        g.fillStyle = text;
        g.fillText(previewLabel(pv.editV, pv.precise), top.x, top.y - 10);
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
