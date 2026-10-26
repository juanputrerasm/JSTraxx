/*
  Generate Terrain (IDD_TERRAINGEN): Classic or Fractal, four sliders, the seed with Apply and
  Rand, and a greyscale preview that is rebuilt on every change. Resolves with the heights and
  the settings to remember, or null.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import { generateTerrain, type TerrainGenSettings } from "../../core/edit/terrain-gen.ts";

export async function terrainGenDialog(start: TerrainGenSettings): Promise<{ heights: Uint8Array; settings: TerrainGenSettings } | null> {
  const s = { ...start };
  const preview = el("canvas", { width: 256, height: 256, class: "gen-preview" }) as HTMLCanvasElement;
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
    heights = generateTerrain(s);
    const img = new ImageData(256, 256);
    for (let i = 0; i < 65536; i++) img.data.set([heights[i]!, heights[i]!, heights[i]!, 255], i * 4);
    preview.getContext("2d")!.putImageData(img, 0, 0);
  };
  for (const c of [ground, hill, valley, smooth]) c.addEventListener("input", rebuild);
  modes.forEach((m) => m.addEventListener("change", rebuild));
  const apply = el("button", { type: "button", class: "mini", onclick: rebuild }, "Apply");
  const random = el("button", { type: "button", class: "mini", onclick: () => { seed.value = String(Math.floor(Math.random() * 256)); rebuild(); } }, "Rand");
  rebuild();

  const r = await openDialog({
    title: "Generate Terrain",
    body: el("div", { class: "gen" },
      el("div", { class: "gen-controls" },
        el("div", { class: "opt-row" }, ...modes.map((m, i) => el("label", { class: "opt-check" }, m, ["Classic", "Fractal"][i]!))),
        groundRow,
        el("label", { class: "gen-row" }, hillLabel, hill),
        el("label", { class: "gen-row" }, valleyLabel, valley),
        el("label", { class: "gen-row" }, smoothLabel, smooth),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Seed"), el("div", { class: "opt-row" }, seed, apply, random))),
      preview),
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  if (r !== "ok") return null;
  rebuild();
  return { heights, settings: { ...s } };
}
