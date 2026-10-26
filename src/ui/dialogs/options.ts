/*
  Options (CTraxxFrame::OnViewOptions): a property sheet with General, Library, Auto-Save,
  Colors and Advanced. Changes apply on OK, as Traxx's sheet does; library files are copied or
  removed at once, since they are files rather than settings.

  Left out because a browser has no use for them: Software Render Quality, Display
  Resolution, Use OpenGL Renderer, V-Sync, and "Let the Textures window go behind Traxx".
  The Folders tab becomes Library: Traxx's ART and MODELS folders are the game PODs here.
*/
import { el, clear } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { Library, LibraryEntry } from "../../app/library.ts";
import { DEFAULT_COLORS, type TraxxSettings } from "../../core/settings.ts";
import { openDialog, confirmDialog } from "../shell/dialog.ts";

export type OptionsTab = "general" | "library" | "autosave" | "colors" | "advanced";

function checkbox(label: string, get: () => boolean, set: (v: boolean) => void, hint?: string): HTMLElement {
  const input = el("input", { type: "checkbox", checked: get() });
  input.addEventListener("change", () => set(input.checked));
  return el("label", { class: "opt-check" }, input, el("span", {}, label, hint ? el("kbd", {}, hint) : null));
}

function generalTab(w: TraxxSettings): HTMLElement {
  return el("div", { class: "opt-page" },
    checkbox("Always Show Course", () => w.always_course, (v) => { w.always_course = v; }, "F5"),
    checkbox("Always Show Objects", () => w.always_objects, (v) => { w.always_objects = v; }, "F6"),
    checkbox("Always Show Ground Boxes", () => w.always_buildings, (v) => { w.always_buildings = v; }, "F7"),
    checkbox("Show Water", () => w.show_water, (v) => { w.show_water = v; }, "F8"),
    checkbox("Show Backdrop", () => w.show_backdrop, (v) => { w.show_backdrop = v; }, "F9"));
}

function autosaveTab(w: TraxxSettings): HTMLElement {
  // Traxx's Options holds the interval to 1..30 minutes.
  const minutes = el("input", { type: "number", min: 1, max: 30, value: w.autosave.minutes, class: "spin" });
  minutes.addEventListener("change", () => { w.autosave.minutes = Math.max(1, Math.min(30, Math.round(Number(minutes.value)) || 15)); minutes.value = String(w.autosave.minutes); });
  const method = (label: string, special: boolean) => {
    const r = el("input", { type: "radio", name: "autosave-method", checked: w.autosave.specialFile === special });
    r.addEventListener("change", () => { if (r.checked) w.autosave.specialFile = special; });
    return el("label", { class: "opt-check" }, r, label);
  };
  return el("div", { class: "opt-page" },
    el("div", { class: "opt-row" }, checkbox("Save every", () => w.autosave.enabled, (v) => { w.autosave.enabled = v; }), minutes, "minutes."),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Method"),
      method("Overwrite original file", false),
      method("Use special file (TraxxAuto.txx)", true)));
}

function colorsTab(w: TraxxSettings): HTMLElement {
  // The six colours the Colors page shows (IDD_OPTIONS_COLORS); 6 and 7 are hidden there too.
  const names = ["Background", "Wireframe", "Wire Overlay", "Object Outline", "Altitude Value", "Altitude Grid"];
  const inputs = names.map((_, i) => {
    const input = el("input", { type: "color", value: w.colors[i] });
    input.addEventListener("input", () => { w.colors[i] = input.value; });
    return input;
  });
  return el("div", { class: "opt-page" },
    el("div", { class: "opt-colors" }, ...names.map((n, i) => el("label", { class: "opt-color" }, el("span", {}, n), inputs[i]))),
    el("button", { type: "button", onclick: () => { w.colors = [...DEFAULT_COLORS]; inputs.forEach((input, i) => { input.value = w.colors[i]; }); } }, "Restore Defaults"));
}

function advancedTab(w: TraxxSettings): HTMLElement {
  const opacity = el("input", { type: "number", min: 0, max: 100, value: w.water_opacity, class: "spin" });
  opacity.addEventListener("change", () => { w.water_opacity = Math.max(0, Math.min(100, Math.round(Number(opacity.value)) || 0)); opacity.value = String(w.water_opacity); });
  const wireWidth = el("input", { type: "number", min: 1, max: 4, value: w.wire_width, class: "spin" });
  wireWidth.addEventListener("change", () => { w.wire_width = Math.max(1, Math.min(4, Math.round(Number(wireWidth.value)) || 1)); wireWidth.value = String(w.wire_width); });
  return el("div", { class: "opt-page" },
    checkbox("Display FPS", () => w.display_fps, (v) => { w.display_fps = v; }),
    checkbox("Model Transparency", () => w.model_transparency, (v) => { w.model_transparency = v; }),
    checkbox("Hide Collider Boxes", () => w.hide_colliders, (v) => { w.hide_colliders = v; }),
    checkbox("Object X/Y in .SIT units (half of Traxx's own)", () => w.show_sit_units, (v) => { w.show_sit_units = v; }),
    // Stored inverted, as Traxx stores it: "do not explain".
    checkbox("Explain the legacy .RAW fallback when writing a pod", () => !w.pod_fallback_noask, (v) => { w.pod_fallback_noask = !v; }),
    checkbox("Show the painted terrain mask over the ground", () => w.show_mask_overlay, (v) => { w.show_mask_overlay = v; }),
    // Traxx's "Keep HD art only" is how JSTraxx always works, so it is not offered.
    el("p", { class: "opt-hint" }, "HD art (PNG, TGA) is kept as it is: JSTraxx builds its 8-bit tile in memory and writes no .RAW or .ACT files when importing it. Write POD still packs the legacy fallback unless you omit it there."),
    el("div", { class: "opt-row" }, "Water opacity (0 = grid only):", opacity, "%"),
    checkbox("Wire Frame: show each cell's diagonal", () => w.wire_diagonals, (v) => { w.wire_diagonals = v; }),
    el("div", { class: "opt-row" }, "Wire Frame line width:", wireWidth, "pixels"));
}

function formatSize(n: number): string {
  return n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

/*
  The library: mount order (first match wins, as the game reads POD.INI), which PODs are
  mounted, and adding or removing them. Order and mounting are part of the sheet and apply on
  OK; adding and removing copy or delete files, so they happen at once.
*/
function libraryTab(library: Library, w: TraxxSettings): HTMLElement {
  let rows: { name: string; size: number; enabled: boolean; summary: LibraryEntry["summary"] }[] =
    library.entries.map((e) => ({ name: e.name, size: e.size, enabled: e.enabled, summary: e.summary }));
  const list = el("ol", { class: "lib-list", "aria-label": "Game PODs in mount order" });
  const progress = el("p", { class: "opt-hint", "aria-live": "polite" });
  const sync = () => {
    w.library_order = rows.map((r) => r.name);
    w.library_disabled = rows.filter((r) => !r.enabled).map((r) => r.name);
  };
  const draw = () => {
    clear(list);
    if (rows.length === 0) list.append(el("li", { class: "lib-empty" }, "No game PODs yet. Add the .POD files from your Monster Truck Madness 2 folder."));
    rows.forEach((r, i) => {
      const on = el("input", { type: "checkbox", checked: r.enabled, title: "Mounted" });
      on.addEventListener("change", () => { r.enabled = on.checked; sync(); });
      const info = r.summary?.error ? `unreadable: ${r.summary.error}`
        : r.summary ? `${r.summary.entries} files${r.summary.tracks.length ? `, ${r.summary.tracks.length} track${r.summary.tracks.length === 1 ? "" : "s"}` : ""}`
        : r.enabled ? "" : "not mounted";
      const move = (d: number) => {
        const j = i + d;
        if (j < 0 || j >= rows.length) return;
        [rows[i], rows[j]] = [rows[j], rows[i]];
        sync();
        draw();
      };
      list.append(el("li", { class: "lib-row" },
        on,
        el("span", { class: "lib-name" }, r.name),
        el("span", { class: "lib-info" }, `${formatSize(r.size)}${info ? ` · ${info}` : ""}`),
        el("button", { type: "button", title: "Move up", "aria-label": `Move ${r.name} up`, disabled: i === 0, onclick: () => move(-1) }, "▲"),
        el("button", { type: "button", title: "Move down", "aria-label": `Move ${r.name} down`, disabled: i === rows.length - 1, onclick: () => move(1) }, "▼"),
        el("button", { type: "button", title: "Remove from the library", "aria-label": `Remove ${r.name}`, onclick: async () => {
          if (!(await confirmDialog("Remove POD", `Remove ${r.name} from the library? The copy JSTraxx keeps is deleted; your game folder is not touched.`, "Remove"))) return;
          await library.remove(r.name);
          rows = rows.filter((x) => x.name !== r.name);
          sync();
          draw();
        } }, "✕")));
    });
  };
  const add = async (files: File[]) => {
    const pods = files.filter((f) => /\.pod$/i.test(f.name));
    if (pods.length === 0) { progress.textContent = "No .POD files there."; return; }
    const off = library.on("progress", (p) => { progress.textContent = p ? `${p.label} (${p.done + 1} of ${p.total})` : ""; });
    try {
      await library.import(pods);
    } finally { off(); }
    const known = new Set(rows.map((r) => r.name));
    for (const e of library.entries) if (!known.has(e.name)) rows.push({ name: e.name, size: e.size, enabled: e.enabled, summary: e.summary });
    for (const r of rows) r.summary = library.entries.find((e) => e.name === r.name)?.summary ?? r.summary;
    sync();
    draw();
    progress.textContent = `Added ${pods.length} POD${pods.length === 1 ? "" : "s"}.`;
  };
  const filePick = el("input", { type: "file", accept: ".pod,.POD", multiple: true, hidden: true });
  filePick.addEventListener("change", () => { add([...(filePick.files ?? [])]); filePick.value = ""; });
  const folderPick = el("input", { type: "file", multiple: true, hidden: true, webkitdirectory: true });
  folderPick.addEventListener("change", () => { add([...(folderPick.files ?? [])]); folderPick.value = ""; });
  const page = el("div", { class: "opt-page lib-page" },
    el("p", { class: "opt-hint" }, "JSTraxx reads art and models from these PODs, top first, as the game does. Drop .POD files here to add them."),
    list,
    el("div", { class: "opt-row" },
      el("button", { type: "button", onclick: () => filePick.click() }, "Add PODs..."),
      el("button", { type: "button", onclick: () => folderPick.click() }, "Add Game Folder..."),
      filePick, folderPick),
    progress);
  page.addEventListener("dragover", (e) => { e.preventDefault(); page.classList.add("drop"); });
  page.addEventListener("dragleave", () => page.classList.remove("drop"));
  page.addEventListener("drop", (e) => { e.preventDefault(); page.classList.remove("drop"); add([...(e.dataTransfer?.files ?? [])]); });
  draw();
  return page;
}

export async function showOptions(app: AppState, library: Library, start: OptionsTab = "general"): Promise<void> {
  // The sheet edits a copy; OK writes it back.
  const work: TraxxSettings = structuredClone(app.settings);
  const pages: [OptionsTab, string, () => HTMLElement][] = [
    ["general", "General", () => generalTab(work)],
    ["library", "Library", () => libraryTab(library, work)],
    ["autosave", "Auto-Save", () => autosaveTab(work)],
    ["colors", "Colors", () => colorsTab(work)],
    ["advanced", "Advanced", () => advancedTab(work)],
  ];
  const body = el("div", { class: "opt-body" });
  const tabs = el("div", { class: "tabs", role: "tablist" });
  const built = new Map<OptionsTab, HTMLElement>();
  const select = (id: OptionsTab) => {
    for (const t of tabs.children) t.setAttribute("aria-selected", String((t as HTMLElement).dataset.id === id));
    let page = built.get(id);
    if (!page) built.set(id, (page = pages.find((p) => p[0] === id)![2]()));
    clear(body);
    body.append(page);
  };
  for (const [id, label] of pages) tabs.append(el("button", { type: "button", role: "tab", "data-id": id, onclick: () => select(id) }, label));
  select(start);
  const result = await openDialog({
    title: "Options",
    className: "options-dialog",
    body: [tabs, body],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  if (result !== "ok") return;
  const orderChanged = JSON.stringify([work.library_order, work.library_disabled]) !== JSON.stringify([app.settings.library_order, app.settings.library_disabled]);
  app.updateSettings((s) => {
    const keep = { panels: s.panels, dialog_sizes: s.dialog_sizes, recent: s.recent, mode: s.mode, edit: s.edit };
    Object.assign(s, work, keep);
  });
  if (orderChanged) await library.arrange(work.library_order, work.library_disabled);
}
