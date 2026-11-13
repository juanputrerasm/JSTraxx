/*
  The waterfall tool (Traxx 1.7.1, Traxx/TraxxViewFalls.cpp and the items TraxxViewInteract.cpp
  appends to the Terrain right-click menu after the lake items):

    Draw Waterfall              always; starts a capture
    Edit Waterfall...           \
    Redraw Waterfall Crest       > near a crest (within 1, 3, 6 or 12 ft of the picked point)
    Delete Waterfall            /

  THE CAPTURE: each left click adds a crest point at the exact picked terrain point (feet, sub-
  tile, stored x 16 mod 131072); a click within 2 ft of the last point is ignored and the 8th
  point finishes. Backspace removes the last point, Enter or right-click finishes (2 points or
  more), Esc cancels; Space does nothing (it would apply the brush). A mode change or an undo
  aborts it. The status line says how many points and how to finish.

  AFTER A NEW CREST: the source is picked (the highest lake within 48 ft), picked again with the
  crest's own notch derived, the crest fitted (FallFit: orient, snap onto the lake's lip, orient
  again) and the Waterfall window opened. The undo record is written only when its OK commits,
  from the copy of the falls taken before the command (recordFields falls and lakes).
*/
import type { ModeContext } from "./context.ts";
import type { MenuItem } from "../../ui/shell/commands.ts";
import type { ViewPoint } from "../editor.ts";
import { recordFields } from "../../core/edit/record.ts";
import { alertDialog } from "../../ui/shell/dialog.ts";
import { pickFiles } from "../../ui/dialogs/file-dialogs.ts";
import { waterfallDialog } from "../../ui/dialogs/waterfall-dialog.ts";
import { fallReadouts, fallSoundStemProblem, fallTextureStem } from "../../core/edit/fall-properties.ts";
import { soundBudget } from "../../core/edit/object-properties.ts";
import { buildLakeGround } from "../../core/traxx/surface.ts";
import { trackLakes } from "../../core/traxx/lakes.ts";
import {
  cloneFall, fallAdd, fallDefaults, fallEffectiveHeight, fallGroundFor, fallLoopingObjects, fallNameInPod, fallNearestToMenu, fallOrient,
  fallPickSource, fallSpringHeight, snapToLip, FALL_COORD_MAX, FALL_MAX_FALLS, FALL_MAX_POINTS, type FallLakes, type TraxxFall,
} from "../../core/traxx/falls.ts";
import type { TxxTrack } from "../../core/traxx/txx.ts";

/** FALL_CAPTURE_MIN_FT: a new point closer than this to the last one is ignored. */
const FALL_CAPTURE_MIN_FT = 2.0;
const FULL = "This track already has the most waterfalls there can be.";

export function fallCommands(ctx: ModeContext) {
  const { editor, registry, app, view } = ctx;
  const track = () => editor.doc!.track;
  const editable = () => editor.canEdit;
  /** The crest being captured: its points (1/16 ft) and the fall it redraws (-1 for a new one). */
  let capture: { pts: [number, number][]; redraw: number } | null = null;
  /** The fall the right-click was near (fallmenufall) and the point it was made at. */
  let menuFall = -1;

  const lakesOf = (t: TxxTrack): FallLakes => ({ lakes: t.lakes, tmap: t.lakes.length ? trackLakes(t).tmap : null });
  const preview = (state: { highlight?: number; capture?: [number, number][] | null }, shape = false) => view.fallChanged(shape, state);

  /*
    FallPickFeet: the terrain point under the pointer in world feet (0..8192, wrapped), exact to
    the pick: whole ipos and the 1/256 fraction, an ipos half a foot.
  */
  const pickFeet = (p: ViewPoint): [number, number] | null => {
    const hit = view.pick(p.clientX, p.clientY);
    if (!hit) return null;
    let x = (hit.ipos[0] * 256 + hit.fraction[0]) / 512, z = (hit.ipos[1] * 256 + hit.fraction[1]) / 512;
    x -= 8192.0 * Math.floor(x / 8192.0);
    z -= 8192.0 * Math.floor(z / 8192.0);
    return [x, z];
  };

  const status = () => {
    if (!capture) return;
    const n = capture.pts.length;
    app.status(`Waterfall: ${n} point${n === 1 ? "" : "s"} - click along the edge the water pours over; Enter or right-click finishes, Backspace undoes a point, Esc cancels`);
  };

  const start = (redraw: number) => {
    if (!editable()) return;
    capture = { pts: [], redraw };
    status();
    preview({ capture: [] });
  };

  /** FallCaptureAbort: leave capture without a word (a load, an undo, a mode change). */
  const abort = () => {
    if (!capture) return;
    capture = null;
    app.status("");
    preview({ capture: null });
  };

  const click = (p: ViewPoint): void => {
    if (!capture) return;
    const at = pickFeet(p);
    if (!at || capture.pts.length >= FALL_MAX_POINTS) return;
    const px = Math.floor(at[0] * 16.0 + 0.5) & FALL_COORD_MAX, pz = Math.floor(at[1] * 16.0 + 0.5) & FALL_COORD_MAX;
    // Not on top of the last point (the library refuses a crest with two points closer than 2 ft).
    const last = capture.pts[capture.pts.length - 1];
    if (last) {
      let dx = (px - last[0]) / 16.0, dz = (pz - last[1]) / 16.0;
      dx -= 8192.0 * Math.floor((dx + 4096.0) / 8192.0);
      dz -= 8192.0 * Math.floor((dz + 4096.0) / 8192.0);
      if (Math.sqrt(dx * dx + dz * dz) < FALL_CAPTURE_MIN_FT) return;
    }
    capture.pts.push([px, pz]);
    // The eighth point finishes by itself.
    if (capture.pts.length >= FALL_MAX_POINTS) { void finish(); return; }
    status();
    preview({ capture: capture.pts.slice() });
  };

  const key = (e: KeyboardEvent): boolean => {
    if (!capture) return false;
    switch (e.code) {
      case "Backspace": capture.pts.pop(); status(); preview({ capture: capture.pts.slice() }); return true;
      case "Enter": case "NumpadEnter": void finish(); return true;
      case "Escape": abort(); return true;
      case "Space": return true; // would apply the terrain brush
    }
    return false;
  };

  /*
    FallFit: the lakes are derived first and after every step that moves the crest (the fall's
    notch is part of its lake), so the orientation and the snap read the lakes as this crest makes
    them. Says so on the status line when points moved.
  */
  const fit = (t: TxxTrack, idx: number): number => {
    const ground = () => fallGroundFor(t, null);
    fallOrient(t.falls, idx, lakesOf(t), ground());
    let moved = 0;
    const w = t.falls[idx];
    if (w && w.source !== 0) {
      moved = snapToLip(t.falls, idx, lakesOf(t), 48.0, buildLakeGround(t));
      if (moved > 0) {
        fallOrient(t.falls, idx, lakesOf(t), ground());
        app.status(`Moved crest point(s) onto Lake ${w.source}'s lip (the water leaves the lake over its edge)`);
      }
    }
    return moved;
  };

  /* SaveFallUndo + OK: one undo step from the falls as they were before the command. */
  const commit = (t: TxxTrack, before: TraxxFall[], label: string) => {
    const after = t.falls;
    const lakesNow = t.lakes;
    t.falls = before;
    const rec = recordFields(t, ["falls", "lakes"], label, { falls: true, water: true });
    t.falls = after;
    t.lakes = lakesNow;
    editor.commit(rec);
  };

  /* The Waterfall window on fall idx; `backup` is what Cancel puts back (for a new fall it is deleted). */
  const dialog = async (idx: number, creating: boolean, before: TraxxFall[], backup: TraxxFall, label: string): Promise<boolean> => {
    const doc = editor.doc!;
    const t = doc.track;
    let cleanup: (() => void) | null = null;
    preview({ highlight: idx }, true);
    const ok = await waterfallDialog(idx, {
      fall: () => t.falls[idx]!,
      effectiveHeight: () => fallEffectiveHeight(t.falls, idx, t.lakes),
      lakes: () => t.lakes,
      changed: (shape) => preview({}, shape),
      fit: () => { fit(t, idx); },
      readouts: () => {
        view.rebuildFalls(); // FallShapesEnsure
        const cache = view.fallShapes;
        const shape = cache.shapes[idx];
        return fallReadouts({
          falls: t.falls, index: idx, lakes: lakesOf(t), names: fallNameInPod(t.sounds, doc.textures),
          lip: buildLakeGround(t), ground: fallGroundFor(t, null),
          vertices: shape?.vertices ?? 0, shapeWarn: shape?.warn ?? 0, trackVerts: cache.trackVerts, loopingObjects: fallLoopingObjects(t.boxes),
        });
      },
      browseSound: async () => {
        const [file] = await pickFiles({ accept: ".wav,.WAV" });
        if (!file) return null;
        const stem = file.name.replace(/\.[^.]*$/, "").toUpperCase();
        if (!stem) return null;
        const problem = fallSoundStemProblem(stem, soundBudget());
        if (problem) { await alertDialog("Waterfall", problem); return null; }
        // No stock-sound shortcut: a fall's sound must be IN THE POD, so the WAV is always loaded.
        const dest = `SOUND\\${stem}.WAV`;
        if (!t.sounds.some((s) => s.name.toUpperCase() === dest)) {
          const data = new Uint8Array(await file.arrayBuffer());
          if (!data.length) { await alertDialog("Waterfall", "The WAV file could not be read."); return null; }
          t.sounds.push({ name: dest, flags: 1, data });
        }
        return stem;
      },
      browseTexture: () => new Promise((resolve) => {
        // Through the Textures window's Load: the texture it adds is selected there.
        const off = editor.on("changed", (touch) => {
          if (!touch.textures) return;
          off();
          cleanup = null;
          resolve(useTexture(editor.selectedTexture));
        });
        cleanup = () => { off(); resolve(null); };
        void registry.exec("ID_TEXTURE_OPEN");
      }),
      textureFromWindow: async () => {
        if (editor.selectedTexture < 0) { await alertDialog("Waterfall", "Select a texture in the Textures window first."); return null; }
        return useTexture(editor.selectedTexture);
      },
    });
    (cleanup as (() => void) | null)?.();
    if (!ok) {
      // OnCancel: put the fall back, or no fall at all if new.
      if (creating) t.falls.splice(idx, 1);
      else t.falls[idx] = backup;
    }
    preview({ highlight: -1 }, true);
    if (ok) commit(t, before, label);
    return ok;
  };

  /* UseTexture: the fall's texture stem from texture `index` (null with the message when it cannot be). */
  const useTexture = (index: number): string | null => {
    const tex = editor.doc?.textures[index];
    if (!tex) { void alertDialog("Waterfall", "That texture is not in this track."); return null; }
    const r = fallTextureStem(tex.name);
    if ("error" in r) { void alertDialog("Waterfall", r.error); return null; }
    return r.stem;
  };

  /*
    FallCaptureFinish: 2 points or more make (or redraw) a fall and open its window; fewer cancel.
    A new fall: defaults, the source picked (else a spring sitting on the ground at the first point).
  */
  const finish = async () => {
    if (!capture) return;
    const { pts, redraw } = capture;
    capture = null;
    app.status("");
    preview({ capture: null });
    if (pts.length < 2 || !editor.doc) return;
    const t = track();
    const before = t.falls.map(cloneFall);
    if (redraw >= 0 && redraw < t.falls.length) {
      const backup = cloneFall(t.falls[redraw]!);
      const w = t.falls[redraw]!;
      w.npoints = pts.length;
      w.pt = Array.from({ length: FALL_MAX_POINTS }, (_, k) => (pts[k] ? [pts[k]![0], pts[k]![1]] : [0, 0]) as [number, number]);
      fit(t, redraw);
      await dialog(redraw, false, before, backup, "Redraw Waterfall Crest");
      return;
    }
    const w = fallDefaults();
    w.npoints = pts.length;
    pts.forEach((p, k) => { w.pt[k] = [p[0], p[1]]; });
    let { source, height } = fallPickSource(lakesOf(t), pts, pts.length);
    // No lake: a spring, sitting on the ground at the first point.
    if (source === 0) height = fallSpringHeight(fallGroundFor(t, null), pts[0]![0] / 16.0, pts[0]![1] / 16.0);
    w.source = source;
    w.height = height;
    const idx = fallAdd(t.falls, w);
    if (idx < 0) { await alertDialog("Traxx", FULL); return; }
    // The pick saw the lakes before this crest existed: pick again with its own notch derived, and keep the new pick.
    if (source !== 0) {
      const again = fallPickSource(lakesOf(t), pts, pts.length);
      if (again.source !== 0 && again.source !== source) { w.source = again.source; w.height = again.height; }
    }
    fit(t, idx);
    await dialog(idx, true, before, cloneFall(w), "Draw Waterfall");
  };

  const draw = async () => {
    if (!editable()) return;
    if (track().falls.length >= FALL_MAX_FALLS) { await alertDialog("Traxx", FULL); return; }
    start(-1);
  };
  const edit = async () => {
    const t = track();
    const idx = menuFall;
    if (!editable() || idx < 0 || idx >= t.falls.length) return;
    await dialog(idx, false, t.falls.map(cloneFall), cloneFall(t.falls[idx]!), "Edit Waterfall");
  };
  const redrawCrest = () => {
    if (editable() && menuFall >= 0 && menuFall < track().falls.length) start(menuFall);
  };
  /* No confirmation: Undo covers it. */
  const remove = () => {
    const t = track();
    const idx = menuFall;
    if (!editable() || idx < 0 || idx >= t.falls.length) return;
    const rec = recordFields(t, ["falls", "lakes"], "Delete Waterfall", { falls: true, water: true });
    t.falls.splice(idx, 1);
    editor.commit(rec);
  };

  registry.register({ id: "ID_TERRAIN_DRAWFALL", label: "Draw Waterfall", prompt: "Click the crest the water pours over, point by point" });
  registry.register({ id: "ID_TERRAIN_EDITFALL", label: "Edit Waterfall...", prompt: "Edit the waterfall whose crest is under the pointer" });
  registry.register({ id: "ID_TERRAIN_REDRAWFALL", label: "Redraw Waterfall Crest", prompt: "Click a new crest for the waterfall under the pointer" });
  registry.register({ id: "ID_TERRAIN_DELETEFALL", label: "Delete Waterfall", prompt: "Delete the waterfall whose crest is under the pointer" });
  registry.bind("ID_TERRAIN_DRAWFALL", draw, { enabled: editable });
  registry.bind("ID_TERRAIN_EDITFALL", edit, { enabled: editable });
  registry.bind("ID_TERRAIN_REDRAWFALL", redrawCrest, { enabled: editable });
  registry.bind("ID_TERRAIN_DELETEFALL", remove, { enabled: editable });

  // An undo (or any other change) and a newly opened track end a capture (FallCaptureAbort).
  editor.on("changed", () => abort());
  ctx.docs.on("opened", () => { capture = null; menuFall = -1; });

  /** The waterfall items for the right-clicked point, appended after the lake items. */
  const menuItems = (p: ViewPoint): MenuItem[] => {
    const doc = editor.doc;
    const at = doc ? pickFeet(p) : null;
    if (!doc || !at) return [];
    const items: MenuItem[] = ["-", "ID_TERRAIN_DRAWFALL"];
    menuFall = fallNearestToMenu(doc.track.falls, at[0], at[1]);
    if (menuFall >= 0) items.push("ID_TERRAIN_EDITFALL", "ID_TERRAIN_REDRAWFALL", "ID_TERRAIN_DELETEFALL");
    return items;
  };

  return { menuItems, capturing: () => capture !== null, click, key, finish: () => void finish(), abort };
}
