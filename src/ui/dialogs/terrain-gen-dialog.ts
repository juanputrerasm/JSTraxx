/*
  Generate Terrain (IDD_TERRAINGEN): Classic or Fractal, four sliders, the seed with Apply and
  Rand, and a greyscale preview that is rebuilt on every change. Resolves with the heights and
  the settings to remember, or null. Traxx 1.7: a 16-bit target (terrainGenTarget) generates in v
  with TerrainGenV on its own grid (1024 on a Full Map), returned as `v`, and the dialog says
  which grid it is for. Traxx 1.7.1 (c53ef3a): the window is resizable, keeps the preview square
  in the area that grows with it, and remembers its size ("TerrainGen Size").

  Traxx origin/main (TerrainGenDlg.cpp m_feet): on a v6 track the heights are feet. Ground level, Max hill
  height and Min valley depth get a feet box beside the slider (IDC_GROUNDFEET, IDC_HILLFEET, IDC_VALLEYFEET),
  the sliders' 0..255 span 0..the track's height limit, and a box takes the exact value when it is left or
  Enter is pressed; Fractal hides the boxes (its range is an exponent and its roughness no height). The values
  are remembered apart from the classic ones (genFeetStart), which stay as they were.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import type { AppState } from "../../app/state.ts";
import { makeResizable } from "./dialog-size.ts";
import { generateTerrain, type TerrainGenSettings } from "../../core/edit/terrain-gen.ts";
import {
  genFeetParams, genFeetRemember, genFeetStart, genPosFromV, genVFromPos, terrainGenPreview, terrainGenV, TERRAINGEN_CLASSIC, type TerrainGenTarget,
} from "../../core/edit/terrain-gen16.ts";
import { formatFeet, parseFeet } from "../../core/traxx/height-units.ts";

/** The template's layout is the smallest size, and the first one. */
const TERRAIN_GEN_MIN = { w: 480, h: 400 };

export async function terrainGenDialog(start: TerrainGenSettings, target: TerrainGenTarget | null = null, app: AppState | null = null,
  hmax = 0): Promise<{ heights: Uint8Array; v: Uint16Array | Int32Array | null; settings: TerrainGenSettings } | null> {
  const s = { ...start };
  const side = target?.precise ? target.gridSize : 256;
  // A v6 track's dialog (m_feet): only on a precise target, with the terrain's height limit.
  const feet = Boolean(target?.precise) && hmax > 0;
  const fv = feet ? genFeetStart(hmax) : null;
  const preview = el("canvas", { width: side, height: side, class: "gen-preview" }) as HTMLCanvasElement;
  let v: Uint16Array | Int32Array | null = null;
  const slider = (min: number, max: number, value: number) => el("input", { type: "range", min, max, value }) as HTMLInputElement;
  const ground = slider(0, 255, s.ground), hill = slider(0, 255, s.hillHeight), valley = slider(0, 255, s.valleyDepth), smooth = slider(0, 100, s.smoothness);
  if (fv) smooth.value = String(fv.smooth);
  const groundLabel = el("span", {}), hillLabel = el("span", {}), valleyLabel = el("span", {}), smoothLabel = el("span", {});
  const modes = ["Classic", "Fractal"].map((_, i) => el("input", { type: "radio", name: "gen-mode", value: i, checked: s.mode === i }) as HTMLInputElement);
  const seed = el("input", { type: "number", min: 0, max: 255, step: 1, value: s.seed, class: "spin" }) as HTMLInputElement;
  seed.addEventListener("keydown", (e) => e.stopPropagation());
  const feetBox = () => el("input", { type: "text", inputmode: "decimal", class: "spin gen-feet", hidden: !feet }) as HTMLInputElement;
  const groundFeet = feetBox(), hillFeet = feetBox(), valleyFeet = feetBox();
  for (const b of [groundFeet, hillFeet, valleyFeet]) b.addEventListener("keydown", (e) => e.stopPropagation());
  const groundRow = el("label", { class: "gen-row" }, groundLabel, ground, groundFeet);
  let heights: Uint8Array = new Uint8Array(65536);

  /* FeetRefresh: sliders, labels, boxes and visibility from the values and the mode. */
  const feetRefresh = () => {
    if (!fv) return;
    const classic = s.mode === TERRAINGEN_CLASSIC;
    ground.value = String(genPosFromV(fv.ground, hmax));
    hill.value = String(classic ? genPosFromV(fv.hill, hmax) : fv.range);
    valley.value = String(classic ? genPosFromV(fv.valley, hmax) : fv.rough);
    groundRow.hidden = !classic;
    hillFeet.hidden = valleyFeet.hidden = !classic;
    groundLabel.textContent = "Ground level (ft)";
    hillLabel.textContent = classic ? "Max hill height (ft)" : `Max range: ${hill.value}`;
    valleyLabel.textContent = classic ? "Min valley depth (ft)" : `Roughness: ${fv.rough}`;
    smoothLabel.textContent = `Smoothness: ${smooth.value}%`;
    groundFeet.value = formatFeet(fv.ground);
    hillFeet.value = formatFeet(fv.hill);
    valleyFeet.value = formatFeet(fv.valley);
  };
  /* FeetFromSliders: a slider that moved off its value's position sets the value; the boxes follow. */
  const feetFromSliders = () => {
    if (!fv) return;
    const classic = s.mode === TERRAINGEN_CLASSIC;
    let pos = Number(ground.value);
    if (pos !== genPosFromV(fv.ground, hmax)) fv.ground = genVFromPos(pos, hmax);
    pos = Number(hill.value);
    if (classic) { if (pos !== genPosFromV(fv.hill, hmax)) fv.hill = genVFromPos(pos, hmax); }
    else { fv.range = pos; hillLabel.textContent = `Max range: ${pos}`; }
    pos = Number(valley.value);
    if (classic) { if (pos !== genPosFromV(fv.valley, hmax)) fv.valley = genVFromPos(pos, hmax); }
    else { fv.rough = pos; valleyLabel.textContent = `Roughness: ${fv.rough}`; }
    fv.smooth = Number(smooth.value);
    smoothLabel.textContent = `Smoothness: ${smooth.value}%`;
    groundFeet.value = formatFeet(fv.ground);
    hillFeet.value = formatFeet(fv.hill);
    valleyFeet.value = formatFeet(fv.valley);
  };
  /* FeetCommitEdits: what was typed becomes the values (0..hmax); a box that does not read goes back. True if one changed. */
  const feetCommit = (): boolean => {
    if (!fv) return false;
    let changed = false;
    for (const [box, key] of [[groundFeet, "ground"], [hillFeet, "hill"], [valleyFeet, "valley"]] as const) {
      const x = parseFeet(box.value, 0, hmax);
      if (x !== null && x !== fv[key]) { fv[key] = x; changed = true; }
      const text = formatFeet(fv[key]);
      if (box.value !== text) box.value = text;
    }
    if (changed) {
      ground.value = String(genPosFromV(fv.ground, hmax));
      hill.value = String(s.mode === TERRAINGEN_CLASSIC ? genPosFromV(fv.hill, hmax) : fv.range);
      if (s.mode === TERRAINGEN_CLASSIC) valley.value = String(genPosFromV(fv.valley, hmax));
    }
    return changed;
  };
  for (const b of [groundFeet, hillFeet, valleyFeet]) {
    b.addEventListener("blur", () => { if (feetCommit()) rebuild(); });
    b.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (feetCommit()) rebuild(); } });
  }

  const labels = () => {
    if (fv) { feetRefresh(); return; }
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
    if (fv) {
      // v6: the exact values (typed feet included), one v per unit; Fractal's valley is roughness.
      feetCommit();
      v = terrainGenV({ mode: s.mode, seed: s.seed, ...genFeetParams(s.mode, fv, hmax) }, side, 1, hmax);
      grey = v ? terrainGenPreview(v, hmax) : new Uint8Array(side * side);
    } else if (target?.precise) {
      v = terrainGenV(s, side);
      grey = v ? terrainGenPreview(v) : new Uint8Array(side * side);
    } else grey = heights = generateTerrain(s);
    const img = new ImageData(side, side);
    for (let i = 0; i < side * side; i++) img.data.set([grey[i]!, grey[i]!, grey[i]!, 255], i * 4);
    preview.getContext("2d")!.putImageData(img, 0, 0);
  };
  for (const c of [ground, hill, valley, smooth]) c.addEventListener("input", () => { feetFromSliders(); rebuild(); });
  modes.forEach((m) => m.addEventListener("change", () => { s.mode = modes.findIndex((x) => x.checked); feetRefresh(); rebuild(); }));
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
  if (fv) {
    // OnOK on a v6 track: its own values are remembered; the classic settings stay as they were.
    genFeetRemember(hmax, fv);
    return { heights, v, settings: { ...start, mode: s.mode, seed: s.seed } };
  }
  return { heights, v, settings: { ...s } };
}
