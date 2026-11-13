/*
  Vegetation (Special > Vegetation..., IDD_VEGETATION; Traxx/VegetationDlg.cpp) and its
  model entry (IDD_VEGETATION_ENTRY; Traxx/VegetationEntryDlg.cpp): the seed and global
  margins, the two painted masks (_V trees and bushes, _G grass and scrub), the rules of each
  painted colour, and Re-plant, which turns masks + rules + seed into the placements.

  The dialog edits a COPY of the track's vegetation and resolves with it on OK (null on
  Cancel), as Traxx copies `work` back on IDOK. Planting goes through the caller's `replant`
  (vegReplant in src/core/edit/veg-planter.ts, with the track's models, lakes and ground).
  Make Far Cards (OnMakeCards, VegetationFarCard.cpp) goes through the caller's
  `makeFarCards`: the cards become models of the REAL track, the entries' far models are set
  in the copy and follow OK / Cancel as the rest of it does.
*/
import { el, clear } from "../../shared/dom.ts";
import { alertDialog, confirmDialog, openDialog } from "../shell/dialog.ts";
import { pickFiles } from "./file-dialogs.ts";
import { cAtof, cAtoi, f32 } from "../../core/traxx/cformat.ts";
import {
  cG, emptyVegetation, vegCopy, vegDefaultEntry, VEG_COLLIDE_MODEL, VEG_COLLIDE_NONE, VEG_COLLIDE_TRUNK, VEG_COLOURNAME,
  VEG_LAYER_GRASS, VEG_LAYER_TREES, VEG_MAX_CLUMPS_PER_TILE, VEG_MAX_ENTRIES, VEG_MODELNAME,
} from "../../core/traxx/veg.ts";
import type { VegColour, VegEntry, Vegetation } from "../../core/traxx/veg.ts";
import { vegDecodeMask, vegSyncPalette, VEG_UNMATCHED_WARN } from "../../core/edit/veg-planter.ts";
import type { VegPlantResult } from "../../core/edit/veg-planter.ts";

const VEGDLG_SPACING_MIN = 2;
const VEGDLG_SPACING_MAX = 500;

export interface VegetationDialogOptions {
  /** The track's vegetation; the dialog works on a copy. */
  vegetation: Vegetation;
  /** CTrackPOD::prefix, for the mask names. */
  prefix: string;
  /** The track's model names (model[]), for the entry dialog's list. */
  modelNames: string[];
  /** VegPlant on the copy; null when the track cannot be planted (the reason is shown). */
  replant: (work: Vegetation) => VegPlantResult | null;
  /** VegMakeFarCards on the copy: how many entries were given a far model, and the report. */
  makeFarCards: (work: Vegetation) => Promise<{ changed: number; report: string }>;
}

/** The bare name after the last slash (VegBareName). */
function bareName(name: string): string {
  const i = Math.max(name.lastIndexOf("\\"), name.lastIndexOf("/"));
  return i >= 0 ? name.slice(i + 1) : name;
}

/** VegReadFloat / VegReadInt: an empty field keeps the last good value; anything else is clamped. */
function readFloat(input: HTMLInputElement, fallback: number, lo: number, hi: number): number {
  const t = input.value.trim();
  if (!t) return fallback;
  let v = f32(cAtof(t));
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  return v;
}
function readInt(input: HTMLInputElement, fallback: number, lo: number, hi: number): number {
  const t = input.value.trim();
  if (!t) return fallback;
  let v = cAtoi(t);
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  return v;
}

const stopKeys = (n: HTMLElement) => n.addEventListener("keydown", (e) => e.stopPropagation());
const button = (label: string, onclick: () => void) => el("button", { type: "button", onclick }, label);

export async function vegetationDialog(opts: VegetationDialogOptions): Promise<Vegetation | null> {
  let work = vegCopy(opts.vegetation);
  let layer = VEG_LAYER_TREES;
  let curcol = work.colours[layer]!.length > 0 ? 0 : -1;
  let cursel = -1;
  let dirty = false;

  const seed = el("input", { type: "text", class: "spin", value: String(work.seed >>> 0) });
  const corridor = el("input", { type: "text", class: "spin", value: cG(work.corridorft) });
  const margin = el("input", { type: "text", class: "spin", value: cG(work.objectmarginft) });
  const trees = el("input", { type: "radio", name: "veg-layer", checked: true });
  const grass = el("input", { type: "radio", name: "veg-layer" });
  const maskName = el("output");
  const colours = el("ul", { class: "pick-list", role: "listbox", style: { minHeight: "7em", maxHeight: "10em", overflowY: "auto" } });
  const colName = el("input", { type: "text", maxlength: VEG_COLOURNAME - 1 });
  const spacing = el("input", { type: "text", class: "spin" });
  const density = el("input", { type: "text", class: "spin" });
  const pertile = el("input", { type: "text", class: "spin" });
  const spacingRow = el("label", {}, "Spacing (ft) ", spacing);
  const densityRow = el("label", {}, "Density (%) ", density);
  const pertileRow = el("label", {}, "Clumps per tile ", pertile);
  const entries = el("tbody");
  const status = el("p", { class: "opt-hint", style: { whiteSpace: "pre-line" } });
  const newSeed = button("New Seed", () => {
    // xorshift32 of the tick count: any non-zero value will do.
    let t = (Date.now() >>> 0) || 1;
    t = (t ^ (t << 13)) >>> 0; t = (t ^ (t >>> 17)) >>> 0; t = (t ^ (t << 5)) >>> 0;
    seed.value = String(t || 1);
    dirty = true;
  });
  const load = button("Load...", () => void loadMask());
  const clearMask = button("Clear", () => void onClearMask());
  const add = button("Add...", () => void onAdd());
  const edit = button("Edit...", () => void onEdit());
  const remove = button("Remove", () => onRemove());
  const replantBtn = button("Re-plant", () => { if (!work.readonly) void replant(false); });
  const makeCards = button("Make Far Cards", () => void onMakeCards());
  const clearAll = button("Clear All", () => void onClearAll());
  for (const n of [seed, corridor, margin, colName, spacing, density, pertile]) stopKeys(n);
  for (const n of [seed, corridor, margin]) n.addEventListener("input", () => { dirty = true; });
  for (const n of [colName, spacing, density, pertile]) n.addEventListener("change", () => saveColourFields());

  const cur = (): VegColour | null => work.colours[layer]![curcol] ?? null;

  function updateMaskText(): void {
    const m = work.masks[layer];
    if (!m) maskName.value = "(none)";
    else if (work.maskFromPod[layer]) maskName.value = `ART\\${opts.prefix}${layer === VEG_LAYER_TREES ? "_V" : "_G"}${m.ext}`;
    else maskName.value = `${m.ext.replace(/^\./, "")}, ${Math.ceil(m.data.length / 1024)} KB, not yet saved`;
  }

  function fillColours(): void {
    clear(colours);
    const list = work.colours[layer]!;
    if (curcol >= list.length) curcol = list.length - 1;
    list.forEach((c, i) => {
      const n = c.entries.length;
      colours.append(el("li", {
        role: "option", class: "pick-row", "aria-selected": String(i === curcol),
        onclick: () => { saveColourFields(); curcol = i; cursel = -1; refreshAll(); },
      }, el("span", { style: { display: "inline-block", width: "14px", height: "12px", marginRight: "6px", border: "1px solid #000", background: `rgb(${c.r},${c.g},${c.b})` } }),
      `${c.name || "(unnamed)"}  (${c.r},${c.g},${c.b})  - ${n} ${n === 1 ? "model" : "models"}`));
    });
  }

  function loadColourFields(): void {
    const c = cur();
    colName.value = c ? c.name : "";
    spacing.value = c ? cG(c.spacing) : "";
    density.value = c ? String(c.density) : "";
    pertile.value = c ? String(c.pertile) : "";
  }

  function fillEntries(): void {
    clear(entries);
    const c = cur();
    if (!c) return;
    if (cursel >= c.entries.length) cursel = c.entries.length - 1;
    c.entries.forEach((e, i) => {
      entries.append(el("tr", {
        class: i === cursel ? "selected" : null, style: i === cursel ? { background: "Highlight", color: "HighlightText" } : null,
        onclick: () => { cursel = i; fillEntries(); updateEnables(); },
        ondblclick: () => { cursel = i; void onEdit(); },
      }, el("td", {}, e.model), el("td", {}, String(e.weight)), el("td", {}, `${cG(e.scalemin)} - ${cG(e.scalemax)}`),
      el("td", {}, e.collide === VEG_COLLIDE_TRUNK ? "Trunk" : e.collide === VEG_COLLIDE_MODEL ? "Model" : "None"),
      // Scenery detail level the plant first appears at (same scale as a .SIT priority; ddf6a1f).
      el("td", {}, e.tier <= 0 ? "Sparse" : e.tier === 1 ? "Normal" : "Complex"), el("td", {}, e.shadow ? "Yes" : "No"), el("td", {}, e.facing ? "Yes" : "No"),
      el("td", {}, e.crossfade ? "Yes" : "No")));
    });
  }

  function updateStatus(): void {
    let text = `${work.trees.length} trees, ${work.clumps.length} grass clumps, ${work.species.length} species`;
    if (work.readonly) text += "\nThis vegetation came from another tool and is read-only. Clear All to author your own.";
    else if (work.stale) text += "\nThe masks have changed since planting - Re-plant to update.";
    else if (haveRules() && work.trees.length === 0 && work.clumps.length === 0) text += "\nNot planted yet - press Re-plant.";
    else if (dirty) text += "\nThe rules have changed since planting - Re-plant to apply them.";
    status.textContent = text;
  }

  function updateEnables(): void {
    const ro = work.readonly, isTrees = layer === VEG_LAYER_TREES;
    const c = cur(), have = !!c && !ro;
    for (const n of [seed, newSeed, corridor, margin, load]) n.disabled = ro;
    clearMask.disabled = ro || !work.masks[layer];
    spacingRow.hidden = !isTrees; densityRow.hidden = !isTrees; pertileRow.hidden = isTrees;
    colName.disabled = !have;
    spacing.disabled = !(have && isTrees);
    density.disabled = !(have && isTrees);
    pertile.disabled = !(have && !isTrees);
    add.disabled = !(have && c!.entries.length < VEG_MAX_ENTRIES);
    edit.disabled = !(have && cursel >= 0);
    remove.disabled = !(have && cursel >= 0);
    replantBtn.disabled = ro;
    makeCards.disabled = ro;
  }

  function refreshAll(): void {
    updateMaskText(); fillColours(); loadColourFields(); fillEntries(); updateStatus(); updateEnables();
  }

  function haveRules(): boolean {
    return work.colours.some((l) => l.some((c) => c.entries.length > 0));
  }

  function saveColourFields(): void {
    const c = cur();
    if (!c || work.readonly) return;
    const name = colName.value.slice(0, VEG_COLOURNAME - 1);
    if (name !== c.name) { c.name = name; fillColours(); }
    if (layer === VEG_LAYER_TREES) {
      const sp = readFloat(spacing, c.spacing, VEGDLG_SPACING_MIN, VEGDLG_SPACING_MAX);
      const de = readInt(density, c.density, 0, 100);
      if (sp !== c.spacing || de !== c.density) dirty = true;
      c.spacing = sp; c.density = de;
      spacing.value = cG(sp); density.value = String(de);
    } else {
      const pt = readInt(pertile, c.pertile, 0, VEG_MAX_CLUMPS_PER_TILE);
      if (pt !== c.pertile) dirty = true;
      c.pertile = pt;
      pertile.value = String(pt);
    }
    updateStatus();
  }

  /** ReadTop: DDV_MinMaxFloat on the corridor (0..500) and the margin (0..200). */
  async function readTop(): Promise<boolean> {
    if (work.readonly) return true;
    const s = seed.value.trim();
    if (!/^\d+$/.test(s) || Number(s) > 0xffffffff) { await alertDialog("Vegetation", "Please enter an unsigned integer."); seed.focus(); return false; }
    const co = f32(cAtof(corridor.value));
    if (!(co >= 0 && co <= 500)) { await alertDialog("Vegetation", "Please enter a number between 0 and 500."); corridor.focus(); return false; }
    const ma = f32(cAtof(margin.value));
    if (!(ma >= 0 && ma <= 200)) { await alertDialog("Vegetation", "Please enter a number between 0 and 200."); margin.focus(); return false; }
    work.seed = Number(s) >>> 0; work.corridorft = co; work.objectmarginft = ma;
    return true;
  }

  async function loadMask(): Promise<void> {
    if (work.readonly) return;
    const [file] = await pickFiles({ accept: ".png,.tga" });
    if (!file) return;
    saveColourFields();
    const dot = file.name.lastIndexOf(".");
    const ext = dot < 0 ? "" : file.name.slice(dot).toUpperCase();
    if (ext !== ".PNG" && ext !== ".TGA") { await alertDialog("Vegetation", "A vegetation mask must be a PNG or TGA image."); return; }
    const data = new Uint8Array(await file.arrayBuffer());
    if (data.length === 0) { await alertDialog("Vegetation", "The file could not be read (or is empty, or there was not enough memory)."); return; }
    // Decode first: only a mask that reads may replace the one held.
    const probe = vegDecodeMask({ ext, data });
    if (!probe.img) { await alertDialog("Vegetation", `The mask could not be used and was not loaded. The mask you had is unchanged.\n\n${probe.err}`); return; }
    work.masks[layer] = { ext, data };
    work.maskFromPod[layer] = false;
    const sync = vegSyncPalette(work, layer);
    dirty = true;
    curcol = work.colours[layer]!.length > 0 ? 0 : -1;
    cursel = -1;
    refreshAll();
    if (sync.unmatched < 0) { await alertDialog("Vegetation", `The mask was loaded but its colours could not be listed.\n\n${sync.err}`); return; }
    if (sync.unmatched > VEG_UNMATCHED_WARN) {
      await alertDialog("Vegetation", `Paint vegetation masks with a hard-edged brush (no anti-aliasing).\n\n${(sync.unmatched * 100).toFixed(1)}% of the painted pixels match none of the colours found.`);
    }
  }

  async function onClearMask(): Promise<void> {
    if (work.readonly || !work.masks[layer]) return;
    if (!(await confirmDialog("Vegetation", "Remove this mask and the colours listed for it?", "Yes"))) return;
    work.masks[layer] = null;
    work.maskFromPod[layer] = false;
    work.colours[layer] = [];
    curcol = -1; cursel = -1; dirty = true;
    refreshAll();
  }

  async function onAdd(): Promise<void> {
    const c = cur();
    if (!c || work.readonly || c.entries.length >= VEG_MAX_ENTRIES) return;
    if (opts.modelNames.length === 0) { await alertDialog("Vegetation", "This track has no models yet. Add the tree models in the Models window first."); return; }
    saveColourFields();
    const e = await vegetationEntryDialog(vegDefaultEntry(layer), layer, opts.modelNames);
    if (!e) return;
    c.entries.push(e);
    cursel = c.entries.length - 1; dirty = true;
    fillColours(); fillEntries(); updateStatus(); updateEnables();
  }

  async function onEdit(): Promise<void> {
    const c = cur();
    if (!c || work.readonly || cursel < 0 || cursel >= c.entries.length) return;
    saveColourFields();
    const e = await vegetationEntryDialog(c.entries[cursel]!, layer, opts.modelNames);
    if (!e) return;
    c.entries[cursel] = e;
    dirty = true;
    fillEntries(); updateStatus(); updateEnables();
  }

  function onRemove(): void {
    const c = cur();
    if (!c || work.readonly || cursel < 0 || cursel >= c.entries.length) return;
    c.entries.splice(cursel, 1);
    dirty = true;
    if (cursel >= c.entries.length) cursel = c.entries.length - 1;
    fillColours(); fillEntries(); updateStatus(); updateEnables();
  }

  async function replant(quiet: boolean): Promise<boolean> {
    saveColourFields();
    if (!(await readTop())) return false;
    const result = opts.replant(work);
    if (!result) { await alertDialog("Vegetation", "This track's terrain cannot be planted on yet."); return false; }
    if (result.ok) dirty = false;
    updateStatus(); updateEnables();
    if (result.report.length) await alertDialog("Vegetation", result.report.join("\n"));
    else if (!result.ok && !quiet) await alertDialog("Vegetation", "Nothing could be planted.");
    return result.ok;
  }

  /*
    OnMakeCards: one card per distinct tree / bush model, loaded into the track; each entry that
    had no far model of its own is given its card's name. The rules then differ from what was
    planted (the species carry farModel), so the dirty flag goes up.
  */
  let making = false;
  async function onMakeCards(): Promise<void> {
    if (work.readonly || making) return;
    saveColourFields();
    making = true;
    makeCards.disabled = true;
    let result: { changed: number; report: string };
    try {
      result = await opts.makeFarCards(work);
    } catch (err) {
      result = { changed: 0, report: `Far cards were not made: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      making = false;
    }
    if (result.changed > 0) dirty = true;
    fillEntries(); updateStatus(); updateEnables();
    await alertDialog("Vegetation", result.report);
  }

  async function onClearAll(): Promise<void> {
    if (!(await confirmDialog("Vegetation", "Clear all vegetation - both masks, every rule and everything planted?", "Yes"))) return;
    work = emptyVegetation();
    curcol = -1; cursel = -1; dirty = false;
    seed.value = String(work.seed); corridor.value = cG(work.corridorft); margin.value = cG(work.objectmarginft);
    refreshAll();
  }

  const onLayer = () => {
    const l = grass.checked ? VEG_LAYER_GRASS : VEG_LAYER_TREES;
    if (l === layer) return;
    saveColourFields();
    layer = l;
    curcol = work.colours[layer]!.length > 0 ? 0 : -1;
    cursel = -1;
    refreshAll();
  };
  trees.addEventListener("change", onLayer);
  grass.addEventListener("change", onLayer);
  refreshAll();

  const row = (...n: (Node | string)[]) => el("div", { class: "opt-row" }, ...n);
  const result = await openDialog({
    title: "Vegetation",
    className: "vegetation-dialog",
    body: [
      row(el("label", {}, "Seed ", seed), newSeed, el("label", {}, "AI corridor (ft) ", corridor), el("label", {}, "Object margin (ft) ", margin)),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Mask"),
        row(el("label", { class: "opt-check" }, trees, "Trees and bushes (_V)"), el("label", { class: "opt-check" }, grass, "Grass and scrub (_G)")),
        row(maskName, load, clearMask)),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Colours"),
        colours,
        row(el("label", {}, "Name ", colName), spacingRow, densityRow, pertileRow)),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Models of this colour"),
        el("table", { class: "veg-entries" },
          el("thead", {}, el("tr", {}, ...["Model", "Weight", "Scale", "Collide", "Detail", "Shadow", "Facing", "Fade"].map((h) => el("th", {}, h)))),
          entries),
        row(add, edit, remove)),
      row(replantBtn, makeCards, clearAll),
      status,
    ],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (v) => {
      if (v !== "ok" || work.readonly) return true;
      saveColourFields();
      if (!(await readTop())) return false;
      if (dirty && haveRules()) {
        const r = await openDialog({
          title: "Vegetation", body: el("p", { class: "modal-text" }, "Re-plant before closing?"),
          buttons: [{ label: "Yes", value: "yes", primary: true }, { label: "No", value: "no" }, { label: "Cancel", value: "cancel" }],
        });
        if (r === "cancel" || r === null) return false;
        if (r === "yes" && !(await replant(true))) return false;
      }
      return true;
    },
  });
  return result === "ok" ? work : null;
}

/*
  The model entry (CVegetationEntryDlg): resolves with the edited entry, or null.
*/
export async function vegetationEntryDialog(entry: VegEntry, layer: number, modelNames: readonly string[]): Promise<VegEntry | null> {
  const isTrees = layer !== VEG_LAYER_GRASS;
  const clampF = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  const model = el("select", {}, el("option", { value: "" }, ""));
  const names = modelNames.map(bareName).filter(Boolean);
  if (entry.model && !names.includes(entry.model)) names.push(entry.model);
  for (const n of names) model.append(el("option", { value: n, selected: n === entry.model }, n));
  const text = (v: string | number) => el("input", { type: "text", class: "spin", value: String(v) });
  const farmodel = el("input", { type: "text", maxlength: VEG_MODELNAME - 1, value: entry.farmodel });
  const weight = text(clampF(entry.weight, 1, 1000));
  const smin = text(cG(Math.max(entry.scalemin, 0.0625)));
  const smax = text(cG(Math.max(Math.min(entry.scalemax, 16), Math.max(entry.scalemin, 0.0625))));
  const rotate = el("input", { type: "checkbox", checked: entry.rotate });
  const collide = el("select", {}, ...["None", "Trunk", "Model"].map((n, i) => el("option", { value: i }, n)));
  collide.value = String(!isTrees || entry.collide < VEG_COLLIDE_NONE || entry.collide > VEG_COLLIDE_MODEL ? VEG_COLLIDE_NONE : entry.collide);
  const trunkdiam = text(cG(clampF(entry.trunkdiam, 0, 1000)));
  const trunkheight = text(cG(clampF(entry.trunkheight, 0, 4000)));
  const sink = text(cG(clampF(entry.sink, 0, 50)));
  // Scenery detail (ddf6a1f): drawn when the tier is <= the player's scenery detail level, the same
  // Sparse / Normal / Complex scale as a scenery object's priority. Index = tier; an old track's 3-5 shows Complex.
  const tier = el("select", {}, ...["Sparse (always shown)", "Normal", "Complex"].map((n, i) => el("option", { value: i }, n)));
  tier.value = String(clampF(entry.tier, 0, 2));
  const tierLabel = el("label", {}, "Scenery detail ", tier);
  const shadow = el("input", { type: "checkbox", checked: entry.shadow });
  const facing = el("input", { type: "checkbox", checked: entry.facing });
  const crossfade = el("input", { type: "checkbox", checked: entry.crossfade });
  const slope = text(cG(clampF(entry.slopemax, 0, 90)));
  for (const n of [farmodel, weight, smin, smax, trunkdiam, trunkheight, sink, slope]) stopKeys(n);
  const updateEnables = () => {
    const trunk = isTrees && Number(collide.value) === VEG_COLLIDE_TRUNK;
    collide.disabled = !isTrees;
    trunkdiam.disabled = !trunk; trunkheight.disabled = !trunk;
    farmodel.disabled = facing.checked;
    crossfade.disabled = !(isTrees && !facing.checked);
    slope.disabled = !isTrees;
    // The detail tier is written into TREE records only; grass never uses it. Disabled, the combo keeps the value.
    tier.disabled = !isTrees;
    tierLabel.style.opacity = isTrees ? "" : "0.5"; // its caption greys with it
  };
  collide.addEventListener("change", updateEnables);
  facing.addEventListener("change", updateEnables);
  updateEnables();

  let out: VegEntry | null = null;
  // DDV: each field in its range, or a message and the field focused.
  const field = async (input: HTMLInputElement, lo: number, hi: number, integer: boolean): Promise<number | null> => {
    const t = input.value.trim();
    const v = integer ? (/^[+-]?\d+$/.test(t) ? Number(t) : NaN) : (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? f32(Number(t)) : NaN);
    if (!(v >= lo && v <= hi)) {
      await alertDialog("Vegetation", integer ? `Please enter an integer between ${lo} and ${hi}.` : `Please enter a number between ${lo} and ${hi}.`);
      input.focus();
      return null;
    }
    return v;
  };
  const row = (...n: (Node | string)[]) => el("div", { class: "opt-row" }, ...n);
  const result = await openDialog({
    title: "Vegetation Model",
    body: [
      row(el("label", {}, "Model ", model)),
      row(el("label", {}, "Far card model ", farmodel)),
      row(el("label", {}, "Weight ", weight), el("label", {}, "Scale from ", smin), el("label", {}, "to ", smax)),
      row(el("label", { class: "opt-check" }, rotate, "Random heading"), el("label", { class: "opt-check" }, facing, "Facing (always turn to the camera)")),
      row(el("label", {}, "Collide ", collide), el("label", {}, "Trunk diameter (ft) ", trunkdiam), el("label", {}, "Trunk height (ft) ", trunkheight)),
      row(el("label", {}, "Sink (ft) ", sink), tierLabel, el("label", {}, "Max slope (deg) ", slope)),
      row(el("label", { class: "opt-check" }, shadow, "Cast shadow"), el("label", { class: "opt-check" }, crossfade, "Cross-fade into the far card")),
    ],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (v) => {
      if (v !== "ok") return true;
      if (farmodel.value.length > VEG_MODELNAME - 1) { await alertDialog("Vegetation", `Please enter no more than ${VEG_MODELNAME - 1} characters.`); return false; }
      const w = await field(weight, 1, 1000, true); if (w === null) return false;
      const a = await field(smin, 0.0625, 16, false); if (a === null) return false;
      const b = await field(smax, 0.0625, 16, false); if (b === null) return false;
      const td = await field(trunkdiam, 0, 1000, false); if (td === null) return false;
      const th = await field(trunkheight, 0, 4000, false); if (th === null) return false;
      const sk = await field(sink, 0, 50, false); if (sk === null) return false;
      // Clamp again on save: 0..2 is the whole range of the scenery detail level.
      const ti = clampF(Number(tier.value), 0, 2);
      const sl = await field(slope, 0, 90, false); if (sl === null) return false;
      if (!model.value) { await alertDialog("Vegetation", "Choose a model."); model.focus(); return false; }
      if (a > b) { await alertDialog("Vegetation", "The smallest scale cannot be larger than the largest scale."); smin.focus(); return false; }
      const col = isTrees ? Number(collide.value) : VEG_COLLIDE_NONE;
      out = {
        model: bareName(model.value).slice(0, VEG_MODELNAME - 1), farmodel: bareName(farmodel.value.trim()).slice(0, VEG_MODELNAME - 1),
        weight: w, scalemin: a, scalemax: b, rotate: rotate.checked, collide: col,
        trunkdiam: col === VEG_COLLIDE_TRUNK ? td : 0, trunkheight: col === VEG_COLLIDE_TRUNK ? th : 0,
        sink: sk, tier: ti, shadow: shadow.checked, slopemax: isTrees ? sl : 0, facing: facing.checked, crossfade: crossfade.checked,
      };
      return true;
    },
  });
  return result === "ok" ? out : null;
}
