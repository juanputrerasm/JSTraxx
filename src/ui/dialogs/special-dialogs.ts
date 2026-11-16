/*
  The Special menu's smaller dialogs and Statistics (Lighting is lighting-dialog.ts):

    Weather Mask  IDD_WEATHERMASK (WeatherMaskDlg.cpp): the nine weathers a race may get
    Track Palette IDD_TRACKPALETTE (TrackPaletteDlg.cpp): the 16 x 16 palette, a click shows an
                  entry; New builds the optimised palette, Open and Save take .PAL or .ACT
    Statistics    IDD_STATS: counts against the limits
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import { CommandRegistry } from "../shell/commands.ts";
import { Toolbar } from "../shell/toolbar.ts";
import { alertDialog, openDialog } from "../shell/dialog.ts";
import { readActFile, readPalFile, writeActFile, writePalFile } from "../../core/traxx/palette-file.ts";

const WEATHERS = ["Clear", "Cloudy", "Foggy", "Dense Fog", "Rain", "Snow", "Dusk", "Night", "Pitch Black"];

/** CWeatherMaskDlg: at least one weather stays allowed; the mask changes only once a box is clicked. */
export async function weatherMaskDialog(mask: number): Promise<number | null> {
  let m = mask & 0xffff;
  const boxes = WEATHERS.map((_, i) => el("input", { type: "checkbox", checked: (m & (1 << i)) !== 0 }) as HTMLInputElement);
  const show = () => boxes.forEach((b, i) => { b.checked = (m & (1 << i)) !== 0; });
  boxes.forEach((b) => b.addEventListener("change", () => {
    m = boxes.reduce((acc, x, i) => acc | (x.checked ? 1 << i : 0), 0);
    if ((m & 0x01ff) === 0) { m |= 1; show(); }
  }));
  const r = await openDialog({
    title: "Weather Mask",
    body: el("div", { class: "obj-two" },
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Allowed Options"), ...boxes.map((b, i) => el("label", { class: "opt-check" }, b, WEATHERS[i]!))),
      el("div", { class: "opt-page" },
        el("button", { type: "button", onclick: () => { m = 1; show(); } }, "Only Clear"),
        el("button", { type: "button", onclick: () => { m = 0xffff; show(); } }, "Allow All"))),
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  return r === "ok" ? m : null;
}

/** CTrackPaletteDlg. `optimal` builds the New palette; resolves with the palette to use, or null. */
export async function trackPaletteDialog(app: AppState, registry: CommandRegistry, palette: Uint8Array, optimal: () => Uint8Array | null): Promise<Uint8Array | null> {
  let pe: Uint8Array = new Uint8Array(palette);
  let index = 0;
  const canvas = el("canvas", { width: 256, height: 256, class: "pal-grid" }) as HTMLCanvasElement;
  const fields = ["Index", "Red", "Green", "Blue"].map(() => el("input", { type: "number", readonly: true, class: "spin" }) as HTMLInputElement);
  const draw = () => {
    const g = canvas.getContext("2d")!;
    for (let c = 0; c < 256; c++) {
      g.fillStyle = `rgb(${pe[c * 3]}, ${pe[c * 3 + 1]}, ${pe[c * 3 + 2]})`;
      g.fillRect((c & 15) * 16, (c >> 4) * 16, 16, 16);
    }
    g.strokeStyle = "#ffffff";
    g.strokeRect((index & 15) * 16 + 0.5, (index >> 4) * 16 + 0.5, 15, 15);
    [index, pe[index * 3]!, pe[index * 3 + 1]!, pe[index * 3 + 2]!].forEach((v, i) => { fields[i]!.value = String(v); });
  };
  canvas.addEventListener("click", (e) => {
    const r = canvas.getBoundingClientRect();
    index = ((Math.trunc((16 * (e.clientY - r.top)) / r.height) * 16) + Math.trunc((16 * (e.clientX - r.left)) / r.width)) & 255;
    draw();
  });
  const picker = el("input", { type: "file", accept: ".pal,.act", hidden: true }) as HTMLInputElement;
  picker.addEventListener("change", async () => {
    const f = picker.files?.[0];
    picker.value = "";
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const read = /\.act$/i.test(f.name) ? readActFile(bytes) : readPalFile(bytes);
    if (!read) { await alertDialog("Palette", "That is not a palette file."); return; }
    pe = new Uint8Array(read);
    draw();
  });
  const save = async (act: boolean) => {
    const bytes = act ? writeActFile(pe) : writePalFile(pe);
    const a = el("a", { href: URL.createObjectURL(new Blob([bytes as BlobPart])), download: act ? "palette.act" : "palette.pal" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  // The dialog's own toolbar (IDR_PALETTE_TOOLBAR), on a registry of its own.
  const local = new CommandRegistry(app);
  for (const id of ["ID_PALETTE_NEW", "ID_PALETTE_OPEN", "ID_PALETTE_SAVE"]) {
    const base = registry.get(id);
    if (base) local.register({ ...base, run: undefined, enabled: undefined, checked: undefined });
  }
  local.bind("ID_PALETTE_NEW", () => { const p = optimal(); if (!p) { void alertDialog("Palette", "Error calculating palette!"); return; } pe = p; draw(); });
  local.bind("ID_PALETTE_OPEN", () => picker.click());
  local.bind("ID_PALETTE_SAVE", async () => {
    const choice = await openDialog({ title: "Write Palette file", body: el("p", { class: "modal-text" }, "Save as an MS palette (.PAL) or an MTM .ACT?"), buttons: [{ label: ".PAL", value: "pal", primary: true }, { label: ".ACT", value: "act" }, { label: "Cancel", value: "cancel" }] });
    if (choice === "pal" || choice === "act") await save(choice === "act");
  });
  const tb = new Toolbar(local, app, "toolbar-palette.png", ["ID_PALETTE_NEW", "ID_PALETTE_OPEN", "ID_PALETTE_SAVE"], "Palette");
  draw();
  const r = await openDialog({
    title: "Track Palette",
    body: el("div", { class: "pal" }, tb.element, el("div", { class: "obj-two" }, canvas,
      el("div", { class: "opt-page" }, ...fields.map((f, i) => el("label", { class: "opt-row" }, el("span", { class: "fld" }, ["Index", "Red", "Green", "Blue"][i]!), f)))), picker),
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  return r === "ok" ? pe : null;
}

export interface TrackStats {
  textures: number; models: number; modelTextures: number; segments: number; groundBoxes: number; objects: number; ramps: number; moving: number; lights: number; sounds: number;
  /** IDC_NFOGS (Traxx 1.7): the Fog objects. */ fogs?: number;
  /** The document's object limit (v6.ts objectLimit): 4096, or 16,384 on a version 6 track. */ objectsMax?: number;
  /**
    Traxx 1.8.0 (35b087b) "Fog slots (game max 64, shared)": the waterfall mist volumes (one per
    landing), the total, and how many the game drops (EngineFogSlotOverflow).
  */
  mist?: number; fogSlots?: number; fogDropped?: number;
}

/** IDD_STATS. */
export async function statsDialog(s: TrackStats): Promise<void> {
  // Traxx 1.8.0: "max 249" by Course segments; the fog rows in their own group.
  const rows: [string, number, string][] = [
    ["Textures", s.textures, "max 1024"], ["Models", s.models, "max 4096"], ["Model Textures", s.modelTextures, "max 4096"],
    ["Course segments", s.segments, "max 249"], ["Ground Boxes", s.groundBoxes, "max 2048"], ["Scenery Objects", s.objects, `max ${s.objectsMax ?? 4096}`],
    ["Ramps", s.ramps, "(100)"], ["Moving", s.moving, "(100)"], ["Lights", s.lights, "(100)"],
  ];
  const table = (r: [string, number, string][]) => el("table", { class: "stats" }, ...r.map(([n, v, max]) => el("tr", {}, el("th", {}, n), el("td", {}, String(v)), el("td", { class: "hint" }, max))));
  const fogs = s.fogs ?? 0, mist = s.mist ?? 0, dropped = s.fogDropped ?? 0;
  const fogGroup = el("fieldset", { class: "stats-group" }, el("legend", {}, "Fog slots (game max 64, shared)"),
    table([["Fog boxes", fogs, "(max 64)"], ["Waterfall mist", mist, "(1 per landing)"], ["Total", s.fogSlots ?? fogs + mist, dropped > 0 ? `/ 64 - ${dropped} dropped` : "/ 64"]]));
  await openDialog({
    title: "Track Statistics",
    body: el("div", {}, table(rows), fogGroup, table([["Sounds", s.sounds, "(512)"]])),
  });
}
