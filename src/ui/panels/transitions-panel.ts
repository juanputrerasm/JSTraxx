/*
  Auto Texture Transitions (IDD_TRANSITIONS, Traxx/TraxxTransitionsDlg.cpp).

  A 3 x 3 grid of edge textures and a base texture, each set by clicking it with a texture
  picked in the Textures window; Invert, "Fill up to" and "Fill down to" with their altitudes,
  and the threshold altitude. Apply paints the selected cells, or the whole map, through the
  Textures mode (TX_APPLYTRANS).

  The picks are kept by texture name, so a texture deleted since simply stops being set (Traxx
  shifts its indices instead, to the same effect). A new track clears them.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { Editor } from "../../app/editor.ts";
import type { DocumentService } from "../../app/document-service.ts";
import type { CommandRegistry } from "../shell/commands.ts";
import type { FloatingPanel } from "../shell/panel.ts";
import { alertDialog } from "../shell/dialog.ts";
import { AGRD_COL } from "../../core/settings.ts";
import { findTexture } from "../../core/edit/texture-list.ts";
import { gammaMap, legacyTileRgba } from "../../core/view/tiles.ts";
import type { TransitionSettings } from "../../core/edit/textures.ts";

/* The underlay where no texture is set: a blob, inner and outer in palette entries 3 and 2. */
const OC = 2, IC = 3;
const GRID_PLAN = [
  "OOOOOIOOOOIOOOOO", "OOOOIIIOOIIIOOOO", "OOOIIIIIIIIIIOOO", "OOIIIIIIIIIIIIOO",
  "OIIIIIIIIIIIIIIO", "IIIIIIIIIIIIIIII", "OIIIIIIIIIIIIIIO", "OOIIIIIIIIIIIIOO",
  "OOIIIIIIIIIIIIOO", "OIIIIIIIIIIIIIIO", "IIIIIIIIIIIIIIII", "OIIIIIIIIIIIIIIO",
  "OOIIIIIIIIIIIIOO", "OOOIIIIIIIIIIOOO", "OOOOIIIOOIIIOOOO", "OOOOOIOOOOIOOOOO",
].map((r) => [...r].map((c) => (c === "I" ? IC : OC)));

export interface TransitionsPanelContext {
  app: AppState;
  editor: Editor;
  docs: DocumentService;
  registry: CommandRegistry;
  panel: FloatingPanel;
}

export function transitionsPanel(ctx: TransitionsPanelContext): void {
  const { app, editor, docs, registry, panel } = ctx;
  // tgrid[row][col] and tbase, by texture name; "" for none.
  let grid: string[][] = [["", "", ""], ["", "", ""], ["", "", ""]];
  let base = "";
  let threshold = 127;

  const gridCanvas = el("canvas", { width: 192, height: 192, class: "trans-grid", "aria-label": "Edge textures: click a square to set it to the selected texture" });
  const baseCanvas = el("canvas", { width: 64, height: 64, class: "trans-base", "aria-label": "Base texture: click to set it to the selected texture" });
  const invert = el("input", { type: "checkbox" });
  const fillMax = el("input", { type: "checkbox", checked: true });
  const fillMin = el("input", { type: "checkbox", checked: true });
  const spin = (value: number) => {
    const i = el("input", { type: "number", min: 0, max: 255, step: 1, value, class: "spin" });
    i.addEventListener("keydown", (e) => e.stopPropagation());
    return i;
  };
  const maxAlt = spin(255), minAlt = spin(0);
  const slider = el("input", { type: "range", min: 0, max: 255, value: threshold, "aria-label": "Threshold Altitude" });
  const thresholdText = el("span", { class: "trans-num" }, String(threshold));
  slider.addEventListener("input", () => { threshold = Number(slider.value); thresholdText.textContent = String(threshold); });

  panel.body.replaceChildren(el("div", { class: "trans-window" },
    el("div", { class: "trans-top" },
      gridCanvas,
      el("div", { class: "trans-side" },
        el("label", { class: "opt-check" }, invert, "Invert (inner goes below Threshold)"),
        el("label", { class: "opt-check" }, fillMax, "Fill up to:", maxAlt),
        el("label", { class: "opt-check" }, fillMin, "Fill down to:", minAlt),
        el("div", { class: "trans-base-row" }, baseCanvas,
          el("div", { class: "trans-buttons" },
            el("button", { type: "button", class: "primary", onclick: () => void apply() }, "Apply"),
            el("button", { type: "button", onclick: () => panel.hide() }, "Close"))))),
    el("div", { class: "trans-threshold" }, el("span", {}, "Threshold Altitude:"), thresholdText, slider)));

  const tileOf = (name: string): Uint8Array | null => {
    const d = editor.doc;
    if (!d || !name) return null;
    const at = findTexture(d, name);
    const tex = at >= 0 ? d.textures[at] : null;
    const img = tex ? legacyTileRgba(tex, d.track.palette, gammaMap(app.settings.gamma)) : null;
    if (!img) return null;
    // Every texel of a 64 tile, every fourth of a 256 one (psize).
    const step = Math.max(1, img.width >> 6);
    const out = new Uint8Array(64 * 64 * 4);
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const s = (Math.min(img.height - 1, j * step) * img.width + Math.min(img.width - 1, i * step)) * 4;
      out.set(img.rgba.subarray(s, s + 4), (j * 64 + i) * 4);
    }
    return out;
  };

  function draw(): void {
    const pal = editor.doc?.track.palette;
    const colour = (k: number) => (pal ? [pal[k * 3]!, pal[k * 3 + 1]!, pal[k * 3 + 2]!, 255] : k === IC ? [128, 128, 0, 255] : [0, 128, 0, 255]);
    const g = gridCanvas.getContext("2d")!;
    const img = new ImageData(192, 192);
    for (let j = 0; j < 192; j++) for (let i = 0; i < 192; i++) img.data.set(colour(GRID_PLAN[Math.trunc(j / 12)]![Math.trunc(i / 12)]!), (j * 192 + i) * 4);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const t = tileOf(grid[y]![x]!);
      if (!t) continue;
      for (let j = 0; j < 64; j++) img.data.set(t.subarray(j * 256, j * 256 + 256), ((64 * y + j) * 192 + 64 * x) * 4);
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = app.settings.colors[AGRD_COL] ?? "#ffff00";
    g.beginPath();
    for (const k of [64, 128]) { g.moveTo(k + 0.5, 0); g.lineTo(k + 0.5, 192); g.moveTo(0, k + 0.5); g.lineTo(192, k + 0.5); }
    g.stroke();
    const b = baseCanvas.getContext("2d")!;
    const bimg = new ImageData(64, 64);
    const t = tileOf(base);
    if (t) bimg.data.set(t);
    else for (let p = 0; p < 64 * 64; p++) bimg.data.set(colour(OC), p * 4);
    b.putImageData(bimg, 0, 0);
  }

  const picked = () => {
    const d = editor.doc, i = editor.selectedTexture;
    return d && editor.canEdit && i >= 0 ? d.textures[i]?.name ?? "" : "";
  };
  gridCanvas.addEventListener("click", (e) => {
    const name = picked();
    if (!name) return;
    const r = gridCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(2, Math.trunc((3 * (e.clientX - r.left)) / r.width)));
    const y = Math.max(0, Math.min(2, Math.trunc((3 * (e.clientY - r.top)) / r.height)));
    grid[y]![x] = name;
    draw();
  });
  baseCanvas.addEventListener("click", () => {
    const name = picked();
    if (!name) return;
    base = name;
    draw();
  });

  /* OnApplytrans: every texture set, then the Textures mode does the business. */
  async function apply(): Promise<void> {
    const d = editor.doc;
    if (!d || !editor.canEdit) return;
    const index = (n: string) => (n ? findTexture(d, n) : -1);
    const g = grid.map((row) => row.map(index));
    const b = index(base);
    if (b < 0 || g.some((row) => row.some((v) => v < 0))) { await alertDialog("Auto Texture Transitions", "One or more textures not specified!"); return; }
    const alt = (i: HTMLInputElement) => Math.max(0, Math.min(255, Math.trunc(Number(i.value)) || 0));
    const t: TransitionSettings = { threshold, grid: g, base: b, invert: invert.checked, fillToMin: fillMin.checked, minAlt: alt(minAlt), fillToMax: fillMax.checked, maxAlt: alt(maxAlt) };
    const run = editor.actions.applyTransition as ((t: TransitionSettings) => void) | undefined;
    run?.(t);
  }

  docs.on("opened", () => { grid = [["", "", ""], ["", "", ""], ["", "", ""]]; base = ""; draw(); });
  editor.on("changed", (touch) => { if (touch.textures || touch.palette) draw(); });
  registry.bind("ID_EDIT_TRANSITIONS", () => { panel.show(); draw(); }, { enabled: () => editor.canEdit && !panel.visible });
  draw();
}
