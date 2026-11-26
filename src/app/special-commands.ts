/*
  The Special menu (Random Terrain, Lighting, Weather Mask, Palette) and View > Statistics
  (CTraxxView::OnEditGenTerrain, OnEditLighting, OnEditWeathermask, OnEditPalette, OnViewStats).
  Each change is one undo step; Traxx undoes none of them but Random Terrain.
*/
import type { AppState } from "./state.ts";
import type { Editor } from "./editor.ts";
import type { CommandRegistry } from "../ui/shell/commands.ts";
import type { TrackView } from "../render/track-view.ts";
import { recordFields, recordGrid } from "../core/edit/record.ts";
import { terrainGenDialog } from "../ui/dialogs/terrain-gen-dialog.ts";
import { statsDialog, trackPaletteDialog, weatherMaskDialog } from "../ui/dialogs/special-dialogs.ts";
import { lightingDialog } from "../ui/dialogs/lighting-dialog.ts";
import { buildLighting, engineY0, trackLighting } from "../core/edit/lighting.ts";
import { engineBakeGround } from "../core/edit/engine-light.ts";
import { optimalPalette } from "../core/edit/optimal-palette.ts";
import { traxxFogMap, withSysColors } from "../core/traxx/palette.ts";
import { MTM2_ONLY } from "../core/doc/document.ts";
import { TRAXX_BOX_FOG, TRAXX_BOX_LIGHT, TRAXX_BOX_RAMP } from "../core/traxx/sit.ts";
import { terrainGenTarget } from "../core/edit/terrain-gen16.ts";
import { refreshRaw, TERRAINMODE_CLASSIC8 } from "../core/traxx/terrain16.ts";
import { heightsChanged } from "../core/traxx/surface.ts";
import { cellsOf } from "../core/traxx/world.ts";
import { lakeErrors, lakeRefusal } from "./modes/lake-commands.ts";
import { alertDialog } from "../ui/shell/dialog.ts";
import { engineFogSlotOverflow } from "../core/traxx/preflight.ts";
import { trackMistLandings } from "../core/doc/preflight-gather.ts";
import { objectLimit } from "../core/traxx/v6.ts";
import { heightsInFeet } from "../core/traxx/height-units.ts";
import { heightLimit, setTrackKind, trackKindOf, trackTypeQuestion, TRACK_TYPE_NO_MEMORY, TRACK_TYPE_QUESTION } from "../core/traxx/track-kind.ts";
import { enlargeWorldQuestion, enlargeWorldReport, ENLARGE_NO_MEMORY } from "../core/traxx/track-kind-ui.ts";
import { enlargeWorld512 } from "../core/edit/enlarge-world.ts";
import { fallNameInPod } from "../core/traxx/falls.ts";
import { messageDialog, trackTypeDialog, yesNoDialog } from "../ui/dialogs/track-type-dialog.ts";
import { isAllocationFailure, type DocumentService } from "./document-service.ts";

/*
  View > Statistics' fog slots (Traxx 1.8.0, 35b087b OnViewStats): the fog boxes first, then one mist
  volume per waterfall landing, counted as Write POD counts them (trackMistLandings,
  engineFogSlotOverflow).
*/
function fogSlotStats(doc: NonNullable<Editor["doc"]>, nfogs: number): { mist: number; fogSlots: number; fogDropped: number } {
  const r = engineFogSlotOverflow(nfogs, trackMistLandings(doc) ?? [], 0);
  return { mist: r.totalMist, fogSlots: nfogs + r.totalMist, fogDropped: r.dropped };
}

export function bindSpecial(app: AppState, registry: CommandRegistry, editor: Editor, view: TrackView, docs: DocumentService): void {
  const can = () => editor.canEdit;

  /*
    Special > Track Type... (TraxxViewEdit.cpp CTraxxView::OnSpecialTrackType): the dialog, then the refusal
    (more objects than a classic track holds) or the question (trackTypeQuestion's lines and "Change the
    track type?"; Classic to v6 asks with the kind's note), SetTrackKind, the terrain undo cleared, the lakes
    judged again (TerrainChanged) and the title's kind refreshed.
  */
  registry.bind("ID_SPECIAL_TRACKTYPE", async () => {
    const doc = editor.doc;
    if (!doc || !editor.canEdit) return;
    const t = doc.track;
    const from = trackKindOf(t);
    const to = await trackTypeDialog(from, cellsOf(t));
    if (to === null || to === from || editor.doc !== doc || !editor.canEdit) return;
    const q = trackTypeQuestion(t, to);
    if (q.refusal) { await messageDialog("Track Type", q.refusal); return; }
    if (q.message && !(await yesNoDialog("Track Type", q.message + TRACK_TYPE_QUESTION))) return;
    if (editor.doc !== doc) return;
    const before = lakeErrors(t);
    let ok: boolean;
    try { ok = setTrackKind(t, to, cellsOf(t)); } catch (err) { if (!isAllocationFailure(err)) throw err; ok = false; }
    if (!ok) { await messageDialog("Track Type", TRACK_TYPE_NO_MEMORY); return; }
    editor.changedWithoutUndo({ heights: { minX: 0, minY: 0, maxX: cellsOf(t) - 1, maxY: cellsOf(t) - 1 }, groundBoxes: true, objects: true, water: true, falls: true, track: true });
    docs.refreshTitle();
    if (lakeErrors(t).some((e, l) => (e & ~(before[l] ?? 0)) !== 0)) {
      await messageDialog("Track Type", "The new heights leave one or more lakes in error; check them in the lake list.");
    }
  }, { enabled: can });

  /*
    Special > Enlarge World to 512 x 512... (TraxxViewEdit.cpp CTraxxView::OnSpecialEnlargeWorld): the
    Object Properties window has closed as OK first (its guard, objects-mode.ts), then the question
    (default No), EnlargeWorld512 all or nothing, undo cleared, the camera kept where it was, and the report
    of the lakes and waterfalls that changed. Enabled on a 256 world that is not only being viewed.
  */
  registry.bind("ID_SPECIAL_ENLARGEWORLD", async () => {
    const doc = editor.doc;
    if (!doc || !editor.canEdit || cellsOf(doc.track) !== 256) return;
    if (!(await yesNoDialog("Enlarge World", enlargeWorldQuestion(doc.track), true))) return;
    if (editor.doc !== doc) return;
    let r: ReturnType<typeof enlargeWorld512>;
    try { r = enlargeWorld512(doc.track, fallNameInPod(doc.track.sounds, doc.textures, doc.modelTextures)); }
    catch (err) { if (!isAllocationFailure(err)) throw err; r = { ok: false, report: { lakes: [], falls: [], reason: "" } }; }
    if (!r.ok) { await messageDialog("Enlarge World", r.report.reason || ENLARGE_NO_MEMORY); return; }
    // The camera stays where it is: it is in the old quarter, which is where the track is.
    const keep = view.camera.place;
    docs.reopen();
    view.camera.setPlace(keep);
    view.changed();
    const text = enlargeWorldReport(r.report);
    if (text) await messageDialog("Enlarge World", text);
  }, { enabled: () => can() && cellsOf(editor.doc?.track) === 256 });

  /*
    Random Terrain (OnEditGenTerrain). Traxx origin/main: every grid of a 256 or 512 world (512, and the Full
    Map's 2048), and on a v6 track the dialog in feet against the terrain's height limit.
  */
  registry.bind("ID_EDIT_GENTERRAIN", async () => {
    const doc = editor.doc;
    if (!doc) return;
    const seed = app.settings.randseed;
    const a = app.settings.autoterrain;
    const t = doc.track;
    const target = terrainGenTarget(t.terrainMode, cellsOf(t));
    const hmax = heightsInFeet(t) ? heightLimit(t) : 0;
    const out = await terrainGenDialog({ mode: ((seed >> 8) & 255) > 1 ? 0 : (seed >> 8) & 255, seed: seed & 255, ground: a.left, hillHeight: a.right, valleyDepth: a.top, smoothness: a.bottom }, target, app, hmax);
    if (!out || editor.doc !== doc || !editor.canEdit) return;
    const s = out.settings;
    app.updateSettings((st) => { st.randseed = (s.seed & 255) | (s.mode << 8); st.autoterrain = { left: s.ground, right: s.hillHeight, top: s.valleyDepth, bottom: s.smoothness }; });
    // A 16-bit result goes into the real grid (h16, or the Full Map's 1024), then the mirror follows.
    // Only the grid the dialog made is written, settled before the undo record (OnEditGenTerrain's
    // GEN_FINE / GEN_H16 / GEN_RAW, review fix 78d7b93): a mismatch leaves the track and undo alone.
    const gen = t.fine && target.gridSize === 4 * cellsOf(t) && out.v?.length === t.fine.length ? "fine"
      : t.h16 && target.gridSize === cellsOf(t) && out.v?.length === t.h16.length ? "h16"
      : t.terrainMode === TERRAINMODE_CLASSIC8 && !target.precise ? "raw" : null;
    if (!gen) return;
    const before = lakeErrors(t);
    const rec = recordFields(t, ["heights", "h16", "fine", "rawShadow"], "Random Terrain", { heights: { minX: 0, minY: 0, maxX: cellsOf(t) - 1, maxY: cellsOf(t) - 1 } });
    if (gen === "fine") t.fine!.set(out.v!);
    else if (gen === "h16") t.h16!.set(out.v!);
    else t.heights.set(out.heights);
    if (target.precise) { refreshRaw(t); heightsChanged(t); }
    const refusal = lakeRefusal(t, before, "Generate Terrain");
    const change = editor.commit(rec);
    if (refusal && change) { editor.undo(); await alertDialog("Generate Terrain", refusal); }
  }, { enabled: can });

  /*
    OnEditLighting (Traxx 1.7.2): the track's LVL sun and ambient in, exactly; on OK they are
    written verbatim and the .LTE rebaked from the engine's heights (BuildLighting). The dialog's
    terrain preview bakes from the same heights, read once here (they cannot change while it is
    open).
  */
  registry.bind("ID_EDIT_LIGHTING", async () => {
    const doc = editor.doc;
    if (!doc) return;
    const t = doc.track;
    const y0 = engineY0(t);
    const cells = cellsOf(t);
    const out = await lightingDialog(trackLighting(t), {
      app, cells,
      bake: (sun, ambient, ground) => { engineBakeGround(y0, sun, ambient, ground, cells); },
    });
    if (!out || editor.doc !== doc || !editor.canEdit) return;
    const rec = recordFields(t, ["lte", "sun"], "Lighting", {});
    buildLighting(t, out.sun, out.ambient);
    editor.commit(rec);
  }, { enabled: can });

  registry.bind("ID_EDIT_WEATHERMASK", async () => {
    const doc = editor.doc;
    if (!doc) return;
    const out = await weatherMaskDialog(doc.track.weatherMask);
    if (out === null || editor.doc !== doc || !editor.canEdit) return;
    const rec = recordFields(doc.track, ["weatherMask"], "Weather Mask", {});
    doc.track.weatherMask = out;
    editor.commit(rec);
  }, { enabled: () => can() && ((editor.doc?.track.versionFlags ?? 0) & MTM2_ONLY) !== 0 });

  /* The chosen palette becomes the custom one (SelectMTM2Palette(pe) is palette 16). */
  registry.bind("ID_EDIT_PALETTE", async () => {
    const doc = editor.doc;
    if (!doc) return;
    const out = await trackPaletteDialog(app, registry, doc.track.palette, () => optimalPalette(doc));
    if (!out || editor.doc !== doc || !editor.canEdit) return;
    const rec = recordFields(doc.track, ["palette", "fogMap"], "Palette", { palette: true });
    doc.track.palette = withSysColors(out);
    doc.track.fogMap = traxxFogMap(doc.track.palette, 16);
    editor.commit(rec);
  }, { enabled: can });

  registry.bind("ID_VIEW_STATS", async () => {
    const doc = editor.doc;
    if (!doc) return;
    const t = doc.track;
    await statsDialog({
      textures: doc.textures.filter(Boolean).length,
      models: t.models.length,
      modelTextures: doc.modelTextures.length,
      segments: t.course.length,
      groundBoxes: t.groundBoxes.length,
      objects: t.boxes.length,
      objectsMax: objectLimit(t),
      ramps: t.boxes.filter((b) => b.type === TRAXX_BOX_RAMP).length,
      moving: t.boxes.filter((b) => b.type === 10 || b.type === 13).length,
      lights: t.boxes.filter((b) => b.type === TRAXX_BOX_LIGHT).length,
      fogs: t.boxes.filter((b) => b.type === TRAXX_BOX_FOG).length,
      sounds: t.sounds.length,
      ...fogSlotStats(doc, t.boxes.filter((b) => b.type === TRAXX_BOX_FOG).length),
    });
  }, { enabled: () => Boolean(editor.doc) });
}
