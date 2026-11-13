/*
  Generate Terrain (IDD_TERRAINGEN): Classic or Fractal, four sliders, the seed with Apply and
  Rand, and a greyscale preview that is rebuilt on every change. Resolves with the heights and
  the settings to remember, or null. Traxx 1.7: a 16-bit target (terrainGenTarget) generates in v
  with TerrainGenV on its own grid (1024 on a Full Map), returned as `v`, and the dialog says
  which grid it is for. Traxx 1.7.1 (c53ef3a): the window is resizable, keeps the preview square
  in the area that grows with it, and remembers its size ("TerrainGen Size").
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import type { AppState } from "../../app/state.ts";
import { makeResizable } from "./dialog-size.ts";
import { generateTerrain, type TerrainGenSettings } from "../../core/edit/terrain-gen.ts";
import { terrainGenPreview, terrainGenV, type TerrainGenTarget } from "../../core/edit/terrain-gen16.ts";

/** The template's layout is the smallest size, and the first one. */
const TERRAIN_GEN_MIN = { w: 480, h: 400 };

export async function terrainGenDialog(start: TerrainGenSettings, target: TerrainGenTarget | null = null, app: AppState | null = null): Promise<{ heights: Uint8Array; v: Uint16Array | null; settings: TerrainGenSettings } | null> {
  const s = { ...start };
  const side = target?.precise ? target.gridSize : 256;
  const preview = el("canvas", { width: side, height: side, class: "gen-preview" }) as HTMLCanvasElement;
  let v: Uint16Array | null = null;
  const slider = (min: number, max: number, value: number) => el("input", { type: "range", min, max, value }) as HTMLInputElement;
  const ground = slider(0, 255, s.ground), hill = slider(0, 255, s.hillHeight), valley = slider(0, 255, s.valleyDepth), smooth = slider(0, 100, s.smoothness);
  const groundLabel = el("span", {}), hillLabel = el("span", {}), valleyLabel = el("span", {}), smoothLabel = el("span", {});
  const modes = ["Classic", "Fractal"].map((_, i) => el("input", { type: "radio", name: "gen-mode", value: i, checked: s.mode === i }) as HTMLInputElement);
  const seed = el("input", { type: "number", min: 0, max: 255, step: 1, value: s.seed, class: "spin" }) as HTMLInputElement;
  seed.addEventListener("keydown", (e) => e.stopPropagation());
  const groundRow = el("label", { class: "gen-row" }, groundLabel, ground);
  let heights: Uint8Array = new Uint8Array(65536);

  const labels = () => {
    groundLabel.textContent = `Ground level: ${ground.value}`;
    hillLabel.textContent = s.mode === 0 ? `Max hill height: ${hill.value}` : `Max range: ${hill.value}`;
    valleyLabel.textContent = s.mode === 0 ? `Min valley depth: ${valley.value}` : `Roughness: ${valley.value}`;
    smoothLabel.textContent = `Smoothness: ${smooth.value}%`;
    groundRow.hidden = s.mode !== 0;
  };

  /* OnGenRebuild. */
  const rebuild = () => {
    s.mode = modes.findIndex((m) => m.checked);
    s.seed = Math.max(0, Math.min(255, Math.trunc(Number(seed.value)) || 0));
    s.ground = Number(ground.value);
    s.hillHeight = Number(hill.value);
    s.valleyDepth = Number(valley.value);
    s.smoothness = Number(smooth.value);
    labels();
    let grey: Uint8Array;
    if (target?.precise) {
      v = terrainGenV(s, side);
      grey = v ? terrainGenPreview(v) : new Uint8Array(side * side);
    } else grey = heights = generateTerrain(s);
    const img = new ImageData(side, side);
    for (let i = 0; i < side * side; i++) img.data.set([grey[i]!, grey[i]!, grey[i]!, 255], i * 4);
    preview.getContext("2d")!.putImageData(img, 0, 0);
  };
  for (const c of [ground, hill, valley, smooth]) c.addEventListener("input", rebuild);
  modes.forEach((m) => m.addEventListener("change", rebuild));
  const apply = el("button", { type: "button", class: "mini", onclick: rebuild }, "Apply");
  const random = el("button", { type: "button", class: "mini", onclick: () => { seed.value = String(Math.floor(Math.random() * 256)); rebuild(); } }, "Rand");
  rebuild();

  // PreviewSquare: the area the preview may use grows with the window; the picture is the square centred in it.
  const area = el("div", { class: "gen-area" }, preview);
  const square = new ResizeObserver(() => {
    const s2 = Math.max(0, Math.min(area.clientWidth, area.clientHeight));
    preview.style.width = preview.style.height = `${s2}px`;
  });
  const body = el("div", { class: "gen" },
      el("div", { class: "gen-controls" },
        el("div", { class: "opt-row" }, ...modes.map((m, i) => el("label", { class: "opt-check" }, m, ["Classic", "Fractal"][i]!))),
        groundRow,
        el("label", { class: "gen-row" }, hillLabel, hill),
        el("label", { class: "gen-row" }, valleyLabel, valley),
        el("label", { class: "gen-row" }, smoothLabel, smooth),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Seed"), el("div", { class: "opt-row" }, seed, apply, random)),
        target ? el("div", {}, target.forText) : null),
      area);
  const shown = openDialog({
    title: "Generate Terrain",
    body,
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  const dialog = body.closest("dialog");
  if (dialog && app) {
    makeResizable(dialog, app, "TerrainGen Size", TERRAIN_GEN_MIN, TERRAIN_GEN_MIN, body);
    square.observe(area);
  }
  const r = await shown;
  square.disconnect();
  if (r !== "ok") return null;
  rebuild();
  return { heights, v, settings: { ...s } };
}
