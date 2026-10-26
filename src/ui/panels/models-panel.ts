/*
  The Models window (IDD_OBJECTS, Traxx/TraxxObjectsDlg.cpp): the track's models in a list,
  the picked one in a 3D preview (yaw slider under it, pitch slider beside it, zoom slider and
  spin from 40 to 600), its vertex and polygon counts, and Apply, which puts it on the selected
  objects (a double-click does the same).

  Toolbar: Load (from the MODELS folder, the game library or disk), Cut (the model goes; the
  objects showing it lose it), Cut + Objects (they go too) and Purge.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { Editor } from "../../app/editor.ts";
import type { DocumentService } from "../../app/document-service.ts";
import type { WorkerClient } from "../../shared/worker-client.ts";
import type { CommandRegistry } from "../shell/commands.ts";
import type { FloatingPanel } from "../shell/panel.ts";
import { alertDialog, openDialog } from "../shell/dialog.ts";
import type { TrackView } from "../../render/track-view.ts";
import { ModelPreview } from "../../render/model-preview.ts";
import { recordFields, type Recording } from "../../core/edit/record.ts";
import { removeModel } from "../../core/edit/objects.ts";
import { BG_COL } from "../../core/settings.ts";
import { findAsset } from "../../core/doc/names.ts";
import type { ModelItem, ModelLoad } from "../../worker/model-handlers.ts";

/* The preview controls (TraxxObjectsDlg.cpp). */
const ZOOM_NEAR = 40, ZOOM_FAR = 600, ZOOM_STEP = 10, ZOOM_START = 200;
const HMID = 18, VMID = 9, YAW_STEP = 10, PITCH_STEP = 5;
/** MAXNPODMODELS. */
const MAX_MODELS = 256;

export interface ModelsPanelContext {
  app: AppState;
  editor: Editor;
  docs: DocumentService;
  registry: CommandRegistry;
  panel: FloatingPanel;
  worker: WorkerClient;
  view: TrackView;
}

export function modelsPanel(ctx: ModelsPanelContext): void {
  const { app, editor, docs, registry, panel, worker, view } = ctx;
  let selected = "";
  let zdistance = ZOOM_START;

  const list = el("select", { size: 10, class: "mod-list", "aria-label": "Models" });
  const canvas = el("canvas", { class: "mod-preview", "aria-label": "Model preview" });
  const preview = new ModelPreview(canvas);
  const hslider = el("input", { type: "range", min: 0, max: 2 * HMID, value: HMID, "aria-label": "Turn" });
  const vslider = el("input", { type: "range", min: 0, max: 2 * VMID, value: VMID, class: "mod-vslider", "aria-label": "Tilt" });
  const zoomSlider = el("input", { type: "range", min: 0, max: (ZOOM_FAR - ZOOM_NEAR) / ZOOM_STEP, value: (ZOOM_FAR - ZOOM_START) / ZOOM_STEP, "aria-label": "Zoom" });
  const zoomSpin = el("input", { type: "number", min: ZOOM_NEAR, max: ZOOM_FAR, step: ZOOM_STEP, value: ZOOM_START, class: "spin", "aria-label": "Distance" });
  zoomSpin.addEventListener("keydown", (e) => e.stopPropagation());
  const vertices = el("output", { class: "tex-sunken mod-count" });
  const polygons = el("output", { class: "tex-sunken mod-count" });
  const applyButton = el("button", { type: "button", class: "primary", onclick: () => apply() }, "Apply");

  panel.body.replaceChildren(el("div", { class: "mod-window" },
    list,
    el("div", { class: "mod-right" },
      el("div", { class: "mod-view" }, canvas, vslider),
      hslider,
      el("label", { class: "tex-field" }, "Zoom", zoomSlider, zoomSpin),
      el("div", { class: "mod-counts" },
        el("label", { class: "tex-field" }, "Vertices", vertices),
        el("label", { class: "tex-field" }, "Polygons", polygons)),
      applyButton)));

  if (!preview.available) canvas.replaceWith(el("p", { class: "panel-empty" }, "No 3D preview: WebGL is not available."));

  /* bgcol: the background colour's nearest in the track palette. */
  const background = () => {
    const want = app.settings.colors[BG_COL] ?? "#000000";
    const pal = editor.doc?.track.palette;
    if (!pal) return want;
    const r = parseInt(want.slice(1, 3), 16), g = parseInt(want.slice(3, 5), 16), b = parseInt(want.slice(5, 7), 16);
    let best = 0, bestd = Infinity;
    for (let c = 0; c < 256; c++) {
      const d = (pal[c * 3]! - r) ** 2 + (pal[c * 3 + 1]! - g) ** 2 + (pal[c * 3 + 2]! - b) ** 2;
      if (d < bestd) { bestd = d; best = c; }
    }
    return `rgb(${pal[best * 3]}, ${pal[best * 3 + 1]}, ${pal[best * 3 + 2]})`;
  };

  function draw(): void {
    if (!panel.visible || !preview.available) return;
    const meshes = selected ? view.modelMeshes(selected) : null;
    preview.draw(meshes, YAW_STEP * (Number(hslider.value) - HMID), PITCH_STEP * (Number(vslider.value) - VMID), zdistance / ZOOM_START, background());
  }

  /* SetTrackPOD: the list again, keeping the pick. */
  function fill(): void {
    const names = editor.doc?.track.models ?? [];
    list.replaceChildren(...names.map((n) => el("option", { value: n, selected: n === selected }, n)));
    if (!names.includes(selected)) selected = "";
    counts();
    draw();
  }

  function counts(): void {
    const geo = selected ? view.modelGeometry(selected) : null;
    vertices.value = String(geo ? geo.raw.length / 3 : 0);
    polygons.value = String(geo?.polygons ?? 0);
    applyButton.disabled = !editor.canEdit || !selected;
  }

  list.addEventListener("change", () => { selected = list.value; counts(); draw(); app.emit("commands", undefined); });
  list.addEventListener("dblclick", () => apply());
  list.addEventListener("keydown", (e) => e.stopPropagation());
  hslider.addEventListener("input", draw);
  vslider.addEventListener("input", draw);
  zoomSlider.addEventListener("input", () => { zdistance = ZOOM_FAR - ZOOM_STEP * Number(zoomSlider.value); zoomSpin.value = String(zdistance); draw(); });
  zoomSpin.addEventListener("input", () => {
    zdistance = Math.max(ZOOM_NEAR, Math.min(ZOOM_FAR, Math.trunc(Number(zoomSpin.value)) || ZOOM_START));
    zoomSlider.value = String((ZOOM_FAR - zdistance) / ZOOM_STEP);
    draw();
  });
  new ResizeObserver(() => draw()).observe(canvas);

  /* OnApplyObject (TX_APPLYOBJECT). */
  function apply(): void {
    if (!editor.canEdit || !selected) return;
    (editor.actions.applyModel as ((name: string) => void) | undefined)?.(selected);
  }

  // ---- Load.
  async function addModels(results: ModelLoad[]): Promise<void> {
    const d = editor.doc;
    if (!d) return;
    const recs: Recording[] = [recordFields(d, ["models", "modelTextures"], "Load Model", { models: true }), recordFields(d.track, ["models"], "Load Model", { models: true })];
    const messages: string[] = [];
    for (const r of results) {
      if (typeof r === "string") { messages.push(r); break; }
      if (findAsset(d.track.models.map((name) => ({ name })), r.model.name) >= 0) { messages.push(`Model "${r.model.name.replace(/^MODELS\\/i, "")}" already loaded.`); continue; }
      if (d.track.models.length >= MAX_MODELS) { messages.push("Max. number of models loaded."); break; }
      d.track.models.push(r.model.name);
      d.models.push(r.model);
      d.modelTextures.push(...r.textures);
      if (r.missing.length) messages.push(`Missing textures for ${r.model.name}:\n${r.missing.join("\n")}`);
      selected = r.model.name;
    }
    editor.commitAll("Load Model", recs);
    fill();
    if (messages.length) await alertDialog("Load Model", messages.join("\n\n"));
  }

  const fileInput = el("input", { type: "file", multiple: true, accept: ".bin", hidden: true });
  document.body.append(fileInput);
  fileInput.addEventListener("change", async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    const d = editor.doc;
    if (!files.length || !d) return;
    await addModels(await worker.call<ModelLoad[]>("models.import", { files, have: d.modelTextures.map((t) => t.name) }));
  });

  /* OnFileOpen: a list of the MODELS folder and the library, or files from disk. */
  async function load(): Promise<void> {
    const d = editor.doc;
    if (!d || !editor.canEdit) return;
    const filter = el("input", { type: "text", placeholder: "Filter", class: "tex-filter" });
    filter.addEventListener("keydown", (e) => e.stopPropagation());
    const choices = el("select", { size: 14, multiple: true, class: "mod-files" });
    let items: ModelItem[] = [];
    const refresh = async () => {
      items = await worker.call<ModelItem[]>("models.list", { filter: filter.value });
      choices.replaceChildren(...items.map((it, i) => el("option", { value: i, class: it.source === "library" ? "from-library" : null }, it.source === "library" ? `${it.file}  (library)` : it.file)));
    };
    filter.addEventListener("input", () => void refresh());
    await refresh();
    const r = await openDialog({
      title: "Load BIN file",
      body: [el("div", { class: "opt-row" }, filter,
        el("button", { type: "button", onclick: () => { fileInput.click(); } }, "From disk...")), choices],
      buttons: [{ label: "Load", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    if (r !== "ok") return;
    const picked = [...choices.selectedOptions].map((o) => items[Number(o.value)]!).filter(Boolean);
    if (!picked.length) return;
    await addModels(await worker.call<ModelLoad[]>("models.load", { items: picked, have: d.modelTextures.map((t) => t.name) }));
  }

  /* OnEditCut / OnEditCutEx (TX_DELMODEL). */
  function cut(withObjects: boolean): void {
    const d = editor.doc;
    if (!d || !editor.canEdit || !selected) return;
    const label = withObjects ? "Cut Model + Objects" : "Cut Model";
    const recs = [recordFields(d, ["models"], label, { models: true }), recordFields(d.track, ["models", "boxes"], label, { models: true, objects: true })];
    const remap = removeModel(d, selected, withObjects);
    if (remap) editor.objects.remap(remap);
    selected = "";
    editor.commitAll(label, recs);
    editor.selectionChanged();
    fill();
  }

  const can = () => editor.canEdit;
  registry.bind("ID_OBJECT_OPEN", () => load(), { enabled: can });
  registry.bind("ID_OBJECT_CUT", () => cut(false), { enabled: () => can() && Boolean(selected) });
  registry.bind("ID_OBJECT_CUTEX", () => cut(true), { enabled: () => can() && Boolean(selected) });

  docs.on("opened", () => { selected = ""; fill(); });
  editor.on("changed", (touch) => { if (touch.models || touch.palette || touch.track) fill(); });
  new MutationObserver(() => draw()).observe(panel.element, { attributes: true, attributeFilter: ["hidden"] });
  app.on("settings", () => draw());
  fill();
}
