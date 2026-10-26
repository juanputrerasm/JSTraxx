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
import { lightingDialog, statsDialog, trackPaletteDialog, weatherMaskDialog } from "../ui/dialogs/special-dialogs.ts";
import { buildLighting, sunPosition } from "../core/edit/lighting.ts";
import { optimalPalette } from "../core/edit/optimal-palette.ts";
import { traxxFogMap, withSysColors } from "../core/traxx/palette.ts";
import { MTM2_ONLY } from "../core/doc/document.ts";
import { TRAXX_BOX_LIGHT, TRAXX_BOX_RAMP } from "../core/traxx/sit.ts";

export function bindSpecial(app: AppState, registry: CommandRegistry, editor: Editor, view: TrackView): void {
  const can = () => editor.canEdit;

  registry.bind("ID_EDIT_GENTERRAIN", async () => {
    const doc = editor.doc;
    if (!doc) return;
    const seed = app.settings.randseed;
    const a = app.settings.autoterrain;
    const out = await terrainGenDialog({ mode: ((seed >> 8) & 255) > 1 ? 0 : (seed >> 8) & 255, seed: seed & 255, ground: a.left, hillHeight: a.right, valleyDepth: a.top, smoothness: a.bottom });
    if (!out || editor.doc !== doc || !editor.canEdit) return;
    const s = out.settings;
    app.updateSettings((st) => { st.randseed = (s.seed & 255) | (s.mode << 8); st.autoterrain = { left: s.ground, right: s.hillHeight, top: s.valleyDepth, bottom: s.smoothness }; });
    const rec = recordGrid(doc.track.heights, { minX: 0, minY: 0, maxX: 255, maxY: 255 }, "Random Terrain", (r) => ({ heights: r }));
    doc.track.heights.set(out.heights);
    editor.commit(rec);
  }, { enabled: can });

  registry.bind("ID_EDIT_LIGHTING", async () => {
    const doc = editor.doc;
    if (!doc) return;
    const l = app.settings.lighting;
    const out = await lightingDialog({
      minLight: l.bottom, maxLight: l.top, altBias: l.left & 0xffff, shadow: (l.left >>> 16) & 0xffff,
      sun: doc.track.sun ? sunPosition(doc.track.sun.vector) : l.right & 0xff,
    });
    if (!out || editor.doc !== doc || !editor.canEdit) return;
    app.updateSettings((st) => { st.lighting = { bottom: out.minLight, top: out.maxLight, left: out.altBias | (out.shadow << 16), right: out.sun }; });
    const rec = recordFields(doc.track, ["lte", "sun"], "Lighting", {});
    buildLighting(doc.track, out, (name) => view.modelGeometry(name)?.raw ?? null);
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
      ramps: t.boxes.filter((b) => b.type === TRAXX_BOX_RAMP).length,
      moving: t.boxes.filter((b) => b.type === 10 || b.type === 13).length,
      lights: t.boxes.filter((b) => b.type === TRAXX_BOX_LIGHT).length,
      sounds: t.sounds.length,
    });
  }, { enabled: () => Boolean(editor.doc) });
}
