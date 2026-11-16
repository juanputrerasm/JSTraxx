/*
  Traxx 1.7's terrain and vegetation commands:

    Special > Terrain Grid      OnTerrainGrid: the confirmed conversion (TerrainConvertMessage)
                                Smooth Full Map from 32 ft grid (OnTerrainSmoothFine)
                                Store heights as PNG (OnTerrainHeightsPng)
    Edit > Import / Export Heightmap (OnTerrainImportRaw, OnTerrainExportRaw)
    Special > Vegetation...     the Vegetation window, its Re-plant and Make Far Cards
                                (VegetationDlg.cpp, VegetationFarCard.cpp)

  Traxx clears the terrain undo on a grid conversion; JSTraxx keeps it as one undo step instead
  (the whole terrain record before and after), which covers what Traxx's does.
*/
import type { AppState } from "./state.ts";
import { cellsOf } from "../core/traxx/world.ts";
import type { Editor } from "./editor.ts";
import type { CommandRegistry } from "../ui/shell/commands.ts";
import type { TrackView } from "../render/track-view.ts";
import type { TxxTrack } from "../core/traxx/txx.ts";
import { recordFields } from "../core/edit/record.ts";
import { alertDialog, confirmDialog, openDialog } from "../ui/shell/dialog.ts";
import { pickFiles } from "../ui/dialogs/file-dialogs.ts";
import { el } from "../shared/dom.ts";
import { importHeights, setMode, smoothFineFromCoarse, surfaceHeightV, terrainConvertMessage } from "../core/traxx/surface.ts";
import { TERRAINMODE_CLASSIC8, TERRAINMODE_FINE } from "../core/traxx/terrain16.ts";
import {
  heightmapExportBytes, heightmapExportDefaults, heightmapExportName, heightmapImportPrecheck, planHeightmapImport,
  HEIGHTMAP_COARSE_FULL, HEIGHTMAP_EXPORT_FAILED, HEIGHTMAP_EXPORT_FILTERS, HEIGHTMAP_IMPORT_NO_MEMORY, HEIGHTMAP_LAKES_WARNING,
  type HeightmapMessage, type HeightmapQuestion, v6ApplyImport, v6ExportBytes, v6ImportHeights, v6ImportSummary,
  HEIGHTMAP_V6_EXPORT_CAPTION, HEIGHTMAP_V6_IMPORT_CAPTION, HEIGHTMAP_V6_STEPS,
} from "../core/edit/heightmap-io.ts";
import { lakeErrors, lakeRefusal, lakesNow } from "./modes/lake-commands.ts";
import { vegetationFromTxx, vegetationToTxx } from "../core/traxx/veg.ts";
import { vegReplant } from "../core/edit/veg-planter.ts";
import { vegetationDialog } from "../ui/dialogs/vegetation-dialog.ts";
import type { Vegetation } from "../core/traxx/veg.ts";
import { vegMakeFarCards, type VegFarCardHost } from "../core/traxx/veg-far-card.ts";
import { instPodTextureOk, vegModelsThatWillNotInstance } from "../core/traxx/instancing.ts";
import { findAsset } from "../core/doc/names.ts";
import { findModelTexture } from "../core/doc/load-pod.ts";
import type { ModelAsset, TextureAsset } from "../core/doc/document.ts";
import type { ModelLoad } from "../worker/model-handlers.ts";
import { assetWorker } from "./workers.ts";

/** MAXNPODMODELS. */
const MAX_MODELS = 4096;

/** The whole terrain, for a step that replaces it. */
const TERRAIN_FIELDS = ["terrainMode", "heights", "h16", "fine", "rawShadow"] as const;
/** Every cell of a track, N x N (track format version 6, spec section 8.1). */
const allOf = (t: { worldCells?: number }) => ({ minX: 0, minY: 0, maxX: cellsOf(t) - 1, maxY: cellsOf(t) - 1 });

export function bindTerrainCommands(app: AppState, registry: CommandRegistry, editor: Editor, view: TrackView): void {
  const can = () => editor.canEdit;
  const track = (): TxxTrack | null => editor.doc?.track ?? null;

  /** The lakes that gained an error since `before`, as Traxx warns after a change it cannot refuse. */
  const newLakeErrors = (t: TxxTrack, before: number[]) => lakeErrors(t).some((e, l) => (e & ~(before[l] ?? 0)) !== 0);

  ([0, 1, 2, 3] as const).forEach((to) => {
    const id = ["ID_TERRAIN_GRID_CLASSIC8", "ID_TERRAIN_GRID_CLASSIC16", "ID_TERRAIN_GRID_SPLINE", "ID_TERRAIN_GRID_FINE"][to]!;
    registry.bind(id, async () => {
      const t = track();
      if (!t || !can() || t.terrainMode === to) return;
      if (!(await confirmDialog("Terrain Grid", terrainConvertMessage(t.terrainMode, to), "Yes"))) return;
      if (track() !== t) return;
      const before = lakeErrors(t);
      const rec = recordFields(t, TERRAIN_FIELDS, "Terrain Grid", { heights: allOf(t), water: true });
      if (!setMode(t, to)) { await alertDialog("Terrain Grid", "Sorry, there is not enough memory to convert the terrain. The track is unchanged."); return; }
      editor.commit(rec);
      if (newLakeErrors(t, before)) await alertDialog("Terrain Grid", "The new terrain leaves one or more lakes in error; check them in the lake list.");
    }, { enabled: can, checked: () => track()?.terrainMode === to });
  });

  registry.bind("ID_TERRAIN_SMOOTHFINE", async () => {
    const t = track();
    if (!t || !can() || t.terrainMode !== TERRAINMODE_FINE) return;
    if (!(await confirmDialog("Terrain Grid", "Rebuild every 8 ft point from the 32 ft points with the game's spline? Detail between the 32 ft points (crisp lips, ruts) is replaced.", "Yes"))) return;
    const before = lakeErrors(t);
    const rec = recordFields(t, TERRAIN_FIELDS, "Smooth Full Map", { heights: allOf(t), water: true });
    smoothFineFromCoarse(t);
    const refusal = lakeRefusal(t, before, "Smooth Full Map");
    const change = editor.commit(rec);
    if (refusal && change) { editor.undo(); await alertDialog("Smooth Full Map", refusal); }
  }, { enabled: () => can() && track()?.terrainMode === TERRAINMODE_FINE });

  registry.bind("ID_TERRAIN_HEIGHTSPNG", () => {
    const t = track();
    if (!t || !can()) return;
    const rec = recordFields(t, ["pngHeights"], "Store heights as PNG", { track: true });
    t.pngHeights = !t.pngHeights;
    editor.commit(rec);
  }, { enabled: can, checked: () => Boolean(track()?.pngHeights) });

  /* A MessageBox and a question, in the page's dialogs. */
  const ui = {
    message: async (m: HeightmapMessage) => { await alertDialog(m.caption ?? "JSTraxx", m.text); },
    ask: async (q: HeightmapQuestion) => {
      const buttons = [{ label: "Yes", value: "yes", primary: true }, { label: "No", value: "no" }];
      if (q.buttons === "yesnocancel") buttons.push({ label: "Cancel", value: "cancel" });
      const r = await openDialog({ title: q.caption, body: el("p", { class: "modal-text" }, q.text), buttons });
      return (r ?? (q.buttons === "yesnocancel" ? "cancel" : "no")) as "yes" | "no" | "cancel";
    },
  };

  registry.bind("ID_TERRAIN_IMPORTRAW", async () => {
    const t = track();
    if (!t || !can()) return;
    if (cellsOf(t) !== 256) { await alertDialog("Import Heightmap", "This track has a 512-cell world. Use Edit > Import Heightmap (Version 6), which reads 512 x 512 and 2048 x 2048 heightmaps."); return; }
    const [file] = await pickFiles({ accept: ".raw,.png,.tga,.RAW,.PNG,.TGA" });
    if (!file || track() !== t) return;
    const head = new Uint8Array(await file.slice(0, 33).arrayBuffer());
    const pre = heightmapImportPrecheck(file.size, head);
    if (pre) { await ui.message(pre); return; }
    const plan = await planHeightmapImport(new Uint8Array(await file.arrayBuffer()), t.terrainMode, ui);
    if (!plan || track() !== t) return;
    const before = lakeErrors(t);
    const rec = recordFields(t, TERRAIN_FIELDS, "Import Heightmap", { heights: allOf(t), water: true });
    if (!importHeights(t, plan.raw, plan.target)) { await alertDialog("JSTraxx", HEIGHTMAP_IMPORT_NO_MEMORY); return; }
    const change = editor.commit(rec);
    // JSTraxx can always keep the snapshot, so every import is undoable and a lake it breaks is refused.
    const refusal = lakeRefusal(t, before, "Import Heightmap");
    if (refusal && change) { editor.undo(); await alertDialog("Import Heightmap", refusal); return; }
    if (!plan.undoable && newLakeErrors(t, before)) await alertDialog("Import Heightmap", HEIGHTMAP_LAKES_WARNING);
    if (plan.coarseFull) await alertDialog("Import Heightmap", HEIGHTMAP_COARSE_FULL);
  }, { enabled: can });

  registry.bind("ID_TERRAIN_EXPORTRAW", async () => {
    const doc = editor.doc;
    if (!doc) return;
    const t = doc.track;
    if (cellsOf(t) !== 256) { await alertDialog("Export Heightmap", "This track has a 512-cell world. Use Edit > Export Heightmap (Version 6)."); return; }
    const d = heightmapExportDefaults(t.terrainMode, `${doc.source.kind === "txx" ? doc.source.fileName : t.trackName}`);
    const name = el("input", { type: "text", value: d.fileName, size: 32 }) as HTMLInputElement;
    const kind = el("select", {}, ...HEIGHTMAP_EXPORT_FILTERS.map((f, i) => el("option", { value: i + 1, selected: i + 1 === d.filterIndex }, f.label))) as HTMLSelectElement;
    name.addEventListener("keydown", (e) => e.stopPropagation());
    const r = await openDialog({
      title: d.title,
      body: el("div", { class: "opt-page" }, el("label", {}, "File name: ", name), el("label", {}, "Save as type: ", kind)),
      buttons: [{ label: "Save", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    if (r !== "ok") return;
    const out = heightmapExportName(name.value, Number(kind.value), t.terrainMode);
    const bytes = heightmapExportBytes(t, out.format);
    if (!bytes) { await alertDialog("Export Heightmap", HEIGHTMAP_EXPORT_FAILED); return; }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = out.fileName.split(/[\\/]/).pop() ?? out.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, { enabled: () => Boolean(editor.doc) });

  /*
    Edit > Import / Export Heightmap (Version 6), JSTraxx (track format version 6, spec 7 and 11).
    Import asks for the file's step and base (128 and 0 read a CP4 file as Import Heightmap does),
    then the track's step and base are picked from the imported range. Export writes the samples
    Write POD would store and says which step and base read them back.
  */
  const stepSelect = (value: number) => el("select", {}, ...HEIGHTMAP_V6_STEPS.map((s) => el("option", { value: s, selected: s === value }, `${s} (${(304.8 / s).toLocaleString("en-US", { maximumFractionDigits: 2 })} mm, up to ${(65536 / s).toLocaleString("en-US")} ft)`))) as HTMLSelectElement;
  registry.bind("ID_TERRAIN_IMPORTV6", async () => {
    const t = track();
    if (!t || !can()) return;
    const n = cellsOf(t);
    const step = stepSelect(t.heightStep ?? 128);
    const base = el("input", { type: "number", value: t.heightBase ?? 0, min: -32768, max: 32767, step: 1 }) as HTMLInputElement;
    base.addEventListener("keydown", (e) => e.stopPropagation());
    const r = await openDialog({
      title: HEIGHTMAP_V6_IMPORT_CAPTION,
      body: el("div", { class: "opt-page" },
        el("p", { class: "modal-text" }, `A greyscale PNG (8 or 16-bit) or a 16-bit little-endian .RAW, ${n} x ${n} (32 ft) or ${4 * n} x ${4 * n} (8 ft). Each sample is read as base + sample / step feet. Step 128 and base 0 read a Community Patch 4 heightmap as it is.`),
        el("label", {}, "Steps per foot (terrainHeightStep): ", step),
        el("label", {}, "Feet at sample 0 (terrainHeightBase): ", base)),
      buttons: [{ label: "Choose File...", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    if (r !== "ok") return;
    const fileStep = Number(step.value), fileBase = Math.trunc(Number(base.value));
    if (!Number.isFinite(fileBase) || fileBase < -32768 || fileBase > 32767) { await alertDialog(HEIGHTMAP_V6_IMPORT_CAPTION, "terrainHeightBase must be a whole number from -32768 to 32767."); return; }
    const [file] = await pickFiles({ accept: ".raw,.png,.RAW,.PNG" });
    if (!file || track() !== t) return;
    const res = v6ImportHeights(new Uint8Array(await file.arrayBuffer()), file.name, t, fileStep, fileBase);
    if (!res.ok) { await ui.message(res.message); return; }
    if (track() !== t) return;
    const before = lakeErrors(t);
    const rec = recordFields(t, [...TERRAIN_FIELDS, "heightStep", "heightBase"], HEIGHTMAP_V6_IMPORT_CAPTION, { heights: allOf(t), water: true });
    v6ApplyImport(t, res.v);
    const change = editor.commit(rec);
    const refusal = lakeRefusal(t, before, HEIGHTMAP_V6_IMPORT_CAPTION);
    if (refusal && change) { editor.undo(); await alertDialog(HEIGHTMAP_V6_IMPORT_CAPTION, refusal); return; }
    await alertDialog(HEIGHTMAP_V6_IMPORT_CAPTION, v6ImportSummary(res.v));
  }, { enabled: can });

  registry.bind("ID_TERRAIN_EXPORTV6", async () => {
    const doc = editor.doc;
    if (!doc) return;
    const t = doc.track;
    const kind = el("select", {}, el("option", { value: "png", selected: true }, "16-bit grayscale PNG (*.png)"), el("option", { value: "raw" }, "16-bit .RAW, little-endian (*.raw)")) as HTMLSelectElement;
    const r = await openDialog({
      title: HEIGHTMAP_V6_EXPORT_CAPTION,
      body: el("div", { class: "opt-page" }, el("label", {}, "Save as type: ", kind)),
      buttons: [{ label: "Save", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    if (r !== "ok") return;
    let out;
    try { out = v6ExportBytes(t, kind.value === "raw" ? "raw" : "png"); } catch (err) { await alertDialog(HEIGHTMAP_V6_EXPORT_CAPTION, (err as Error).message); return; }
    const name = `${t.prefix || "HEIGHTS"}_S${out.step}_B${out.base}.${kind.value}`;
    const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    await alertDialog(HEIGHTMAP_V6_EXPORT_CAPTION, `${name}: ${out.side} x ${out.side} samples, terrainHeightStep=${out.step}, terrainHeightBase=${out.base}. Import it with the same step and base.`);
  }, { enabled: () => Boolean(editor.doc) });

  /*
    Special > Vegetation...: the window edits a copy; Re-plant plants it on the track as it is
    (the drive surface, the lakes' tiles, the objects and courses); OK keeps it as the track's
    .VEG image and masks, one undo step. Make Far Cards (VegMakeFarCards) adds its cards to the
    REAL track as models, as Traxx does; they are part of the same undo step, and on Cancel they
    stay in the track as a "Make Far Cards" step of their own (Traxx keeps them, with no undo).
  */
  registry.bind("ID_EDIT_VEGETATION", async () => {
    const doc = editor.doc;
    if (!doc || !can()) return;
    const t = doc.track;
    const models = new Map<string, ArrayLike<number>>();
    for (const m of doc.models) {
      const raw = view.modelGeometry(m.name)?.raw;
      if (raw) models.set(m.name, raw);
    }
    const recs = [
      recordFields(doc, ["models", "modelTextures"], "Vegetation", { models: true }),
      recordFields(t, ["models", "vegetation"], "Vegetation", { track: true, models: true }),
    ];
    const modelBytes = (name: string) => { const at = findAsset(doc.models, name); return at >= 0 ? doc.models[at]!.bytes : null; };
    const modelTexture = (face: string) => doc.modelTextures[findModelTexture(doc.modelTextures, face)] ?? null;
    // VegModelsThatWillNotInstance with InstPodTextureOK, for the planter's warning lines.
    const notInstanced = (v: Vegetation) => vegModelsThatWillNotInstance(v, modelBytes, instPodTextureOk(modelTexture));
    let cards = 0;
    const worker = assetWorker();
    const host: VegFarCardHost<ModelAsset, TextureAsset> = {
      trackPalette: t.palette,
      modelBytes,
      modelLoaded: (bare) => findAsset(doc.models, bare) >= 0,
      modelTexture,
      artFile: (name) => worker.call<Uint8Array | null>("farcard.artRead", { name }),
      artExists: (name) => worker.call<boolean>("farcard.exists", { art: name }),
      binExists: (bare) => worker.call<boolean>("farcard.exists", { bin: bare }),
      writeArt: (stem, f) => worker.call<string | null>("farcard.writeArt", { stem, ...f }),
      writeBin: (bare, bytes) => worker.call<boolean>("farcard.writeBin", { bare, bytes }),
      deleteArt: (stem) => worker.call<void>("farcard.deleteArt", { stem }),
      // VcLoadCard: a free model slot, then LoadModelTextures from the ART folder. A bad
      // placeholder already there for the card's texture is dropped first, so it is loaded again.
      loadCard: async (bare) => {
        if (t.models.length >= MAX_MODELS) return "the track already holds the maximum number of models";
        const face = `ART\\${bare.replace(/\.[^.]*$/, "")}.RAW`;
        const have = doc.modelTextures.filter((x) => !(x.bad && findModelTexture([x], face) >= 0)).map((x) => x.name);
        const [r] = await worker.call<ModelLoad[]>("models.load", { items: [{ file: bare, source: "models" }], have });
        if (!r || typeof r === "string") return `cannot read ${bare}${r ? ` (${r})` : ""}`;
        return { model: r.model, textures: r.textures, bytes: r.model.bytes ?? new Uint8Array(0), missing: r.missing };
      },
      addCard: (c) => {
        for (const tex of c.textures) {
          const old = findModelTexture(doc.modelTextures, tex.name);
          if (old >= 0 && doc.modelTextures[old]!.bad) doc.modelTextures.splice(old, 1);
        }
        t.models.push(c.model.name);
        doc.models.push(c.model);
        doc.modelTextures.push(...c.textures);
        cards++;
      },
      loadedTexture: (c, face) => c.textures[findModelTexture(c.textures, `ART\\${face}`)] ?? null,
      modelsFolderLabel: "the MODELS folder (browser storage)",
      artFolderLabel: "the ART folder (browser storage)",
    };
    const result = await vegetationDialog({
      vegetation: vegetationFromTxx(t.vegetation, cellsOf(t)),
      prefix: t.prefix,
      modelNames: doc.models.map((m) => m.name),
      replant: (work) => vegReplant(t, work, models, t.lakes.length ? lakesNow(t).tmap : null,
        t.terrainMode === TERRAINMODE_CLASSIC8 ? undefined : (px, py) => surfaceHeightV(t, px, py), notInstanced),
      makeFarCards: async (work) => {
        if (editor.doc !== doc) return { changed: 0, report: "Far cards were not made: the track is no longer open." };
        app.status("Making far cards...");
        try {
          return await vegMakeFarCards(host, work);
        } finally {
          app.status("");
        }
      },
    });
    if (editor.doc !== doc) return;
    if (result) {
      const block = vegetationToTxx(result, t.prefix, undefined, cellsOf(t));
      t.vegetation = block.image || block.masks.some(Boolean) ? { masks: block.masks.map((m) => (m ? { ext: m.ext, data: m.data } : null)), image: block.image } : null;
      editor.commitAll("Vegetation", recs);
    } else if (cards > 0) editor.commitAll("Make Far Cards", recs);
  }, { enabled: can });

  void app;
}
