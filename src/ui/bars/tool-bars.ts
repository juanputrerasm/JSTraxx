/*
  The per-mode tool bars docked under View Controls. Traxx shows one at a time
  (CTraxxFrame::OnEditmode*): Terrain Tools, Texture Tools, Course Tools, none for objects,
  Groundbox Tools.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import { defaultAltitudeForTool } from "../../core/settings.ts";
import { altitudeV, AMPLITUDE_MAXV, EDITSIZE_MAX_COARSE } from "../../core/edit/terrain.ts";
import { amplitudeFractional, amplitudeFromText, amplitudeText, editSizeMax, stepAmplitude, wholeAmplitude } from "../../core/edit/amplitude.ts";
import { onTerrainMode } from "../../app/terrain-kind.ts";
import { bar, check, radioGroup, slider, spin } from "./controls.ts";
import { clampBottom, clampTop } from "../../core/edit/ground-boxes.ts";

/*
  The eight terrain tools, IDC_EDITMODE0..7, with their tooltip and status text from the
  string table. Icons are edit0..7.ico.
*/
export const TERRAIN_TOOLS: { tip: string; prompt: string }[] = [
  { tip: "Raise (add)", prompt: "Add constant value to terrain" },
  { tip: "Hill (add)", prompt: "Add hill to terrain" },
  { tip: "Slope (add)", prompt: "Add Slope to terrain" },
  { tip: "Mound (add)", prompt: "Add Mound to terrain" },
  { tip: "Bumps (add)", prompt: "Add Bumps to terrain" },
  { tip: "Smooth", prompt: "Smooth area of terrain" },
  { tip: "Plane", prompt: "Set flat Plane area in terrain" },
  { tip: "Single-point direct edit", prompt: "Direct Edit of single terrain points" },
];

export function terrainToolsBar(app: AppState): HTMLElement {
  const e = app.settings.edit;
  const buttons = TERRAIN_TOOLS.map((t, i) => el("button", {
    class: "tool-button", title: t.tip, "aria-label": t.tip, "aria-pressed": String(i === e.tool),
    onclick: () => pick(i),
    onmouseenter: () => app.status(t.prompt), onmouseleave: () => app.status(""),
  }, el("img", { src: `${import.meta.env.BASE_URL}ui/edit${i}.png`, alt: "", width: 32, height: 32 })));
  // 1-25 here; a Full Map widens them to 1-100 (OnUpdateEditSizeRange, below).
  // 0, not the coarse max: the first mode heard always clamps (a Full Map size saved from an earlier run).
  let sizeMax = 0;
  const width = spin("Width", Math.min(e.terrainw, EDITSIZE_MAX_COARSE), 1, EDITSIZE_MAX_COARSE, (v) => app.updateSettings((s) => { s.edit.terrainw = v; }));
  const height = spin("Height", Math.min(e.terrainh, EDITSIZE_MAX_COARSE), 1, EDITSIZE_MAX_COARSE, (v) => app.updateSettings((s) => { s.edit.terrainh = v; }));
  const altitude = altitudeBox(app);
  const orientation = slider(() => "Orientation", e.orientation, 0, 7, (v) => app.updateSettings((s) => { s.edit.orientation = v; }));
  const curvature = slider(() => "Curvature", e.curvature, 0, 6, (v) => app.updateSettings((s) => { s.edit.curvature = v; }));
  /*
    Picking Plane sets Altitude to 100, Direct Edit to 1 and the rest to 32, and each tool
    family remembers its own value while the editor runs (CTraxxFrame::SetTerrainToolMode:
    standard_alt, plane_alt, direct_alt, kept in v since Traxx 1.7).
  */
  const remembered = new Map<number, number>();
  // Direct Edit works on one point, so Width and Height are greyed out (SetTerrainToolMode).
  const sizeable = (tool: number) => { width.enable(tool !== 7); height.enable(tool !== 7); };
  sizeable(e.tool);
  const family = (tool: number) => (tool === 6 ? 6 : tool === 7 ? 7 : 0);
  function pick(tool: number) {
    const s = app.settings.edit;
    remembered.set(family(s.tool), s.altitude);
    const alt = remembered.get(family(tool)) ?? defaultAltitudeForTool(tool);
    app.updateSettings((st) => { st.edit.tool = tool; st.edit.altitude = alt; });
  }
  /*
    The bar follows the open track (Traxx 1.7, OnUpdateEditSizeRange and FollowAmplitudeKind):
    a Full Map counts the brush in 8 ft points, 1-100, everything else (and no track) 1-25, and a
    width or height over the limit comes down to it; the Altitude box takes decimal steps on a
    16-bit track, and when the track becomes classic the stored per-tool values and the box come
    down to whole steps.
  */
  onTerrainMode(app, (mode) => {
    const want = editSizeMax(mode);
    if (want !== sizeMax) {
      sizeMax = want;
      width.range(1, want);
      height.range(1, want);
      const s = app.settings.edit;
      if (s.terrainw > want || s.terrainh > want) app.updateSettings((st) => { st.edit.terrainw = Math.min(st.edit.terrainw, want); st.edit.terrainh = Math.min(st.edit.terrainh, want); });
    }
    if (mode === null) return;
    const fractional = amplitudeFractional(mode);
    if (!fractional) {
      for (const [k, steps] of remembered) remembered.set(k, wholeAmplitude(altitudeV(steps)) / 256);
      const whole = wholeAmplitude(altitudeV(app.settings.edit.altitude)) / 256;
      if (whole !== app.settings.edit.altitude) app.updateSettings((st) => { st.edit.altitude = whole; });
    }
    altitude.kind(fractional);
  });
  app.on("settings", (s) => {
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === s.edit.tool)));
    width.set(s.edit.terrainw);
    height.set(s.edit.terrainh);
    altitude.set(s.edit.altitude);
    orientation.set(s.edit.orientation);
    curvature.set(s.edit.curvature);
    sizeable(s.edit.tool);
  });
  return bar("Terrain Tools", el("div", { class: "tool-grid" }, ...buttons), width.element, height.element, altitude.element, orientation.element, curvature.element);
}

/*
  The Altitude box (IDC_EDITAMPLITUDE with IDC_AMPLITUDESPIN, Traxx 1.7): decimal steps on a
  16-bit track (up to 2 decimals shown, 0.1 a click or arrow key, a decimal comma read as a
  point), whole steps on a classic track (rounded half away from zero). The value is kept in the
  settings in steps, a multiple of 1/256 (v / 256). Held to +-255 except for Direct Edit, whose
  amount Traxx takes as typed (OnEditAmplitude); JSTraxx's settings hold every tool to +-255.
*/
function altitudeBox(app: AppState): { element: HTMLElement; set(steps: number): void; kind(fractional: boolean): void } {
  let fractional = false;
  const input = el("input", { type: "number", min: -255, max: 255, step: 1, class: "spin", "aria-label": "Altitude" }) as HTMLInputElement;
  const show = (steps: number) => { input.value = amplitudeText(altitudeV(steps), fractional); };
  const store = (v: number) => {
    if (app.settings.edit.tool !== 7) v = Math.max(-AMPLITUDE_MAXV, Math.min(AMPLITUDE_MAXV, v));
    const steps = Math.max(-255, Math.min(255, v / 256));
    show(steps);
    if (steps !== app.settings.edit.altitude) app.updateSettings((s) => { s.edit.altitude = steps; });
  };
  const commit = () => store(amplitudeFromText(input.value, fractional));
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => {
    // Keys typed in the box belong to it, not to the 3D view.
    e.stopPropagation();
    if (e.key === "Enter") { commit(); input.blur(); }
    else if (e.key === "Escape") input.blur();
    else if (fractional && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      // OnAmplitudeSpin: StepAmplitude from the text as it reads.
      e.preventDefault();
      store(stepAmplitude(input.value, e.key === "ArrowUp" ? 1 : -1));
    }
  });
  show(app.settings.edit.altitude);
  return {
    element: el("label", { class: "bar-row" }, el("span", { class: "bar-label" }, "Altitude"), input),
    set: show,
    kind: (on) => { fractional = on; input.step = on ? "0.1" : "1"; show(app.settings.edit.altitude); },
  };
}

export function textureToolsBar(app: AppState): HTMLElement {
  const e = app.settings.edit;
  const width = spin("Width", e.texturew, 1, 16, (v) => app.updateSettings((s) => { s.edit.texturew = v; }));
  const height = spin("Height", e.textureh, 1, 16, (v) => app.updateSettings((s) => { s.edit.textureh = v; }));
  const paint = check("Paint Mode", e.paint, (v) => app.updateSettings((s) => { s.edit.paint = v; }));
  const sync = (on: boolean) => { width.enable(on); height.enable(on); };
  sync(e.paint);
  app.on("settings", (s) => { paint.set(s.edit.paint); sync(s.edit.paint); width.set(s.edit.texturew); height.set(s.edit.textureh); });
  return bar("Texture Tools", paint.element, width.element, height.element);
}

export function courseToolsBar(app: AppState): HTMLElement {
  const courses = radioGroup("course", ["Main (0)", "1", "2", "3", "4"], app.tools.course, (v) => app.setTools({ course: v }));
  const always = check("Always show main", app.tools.alwaysMain, (v) => app.setTools({ alwaysMain: v }));
  app.on("tools", (t) => { courses.set(t.course); always.set(t.alwaysMain); });
  return bar("Course Tools", el("fieldset", { class: "bar-group" }, el("legend", {}, "Course"), courses.element), always.element);
}

export function groundBoxToolsBar(app: AppState): HTMLElement {
  // Four checkboxes that behave as one choice, or none (CTraxxFrame::OnBuildingPaint*).
  const labels = ["Paint Face", "Paint Sides", "Paint Top/Bottom", "Paint All Faces"];
  const boxes = labels.map((label, i) => check(label, app.tools.gbPaint === i + 1, (on) => app.setTools({ gbPaint: on ? ((i + 1) as 1 | 2 | 3 | 4) : 0 })));
  // Top stays above Bottom (CTraxxFrame::OnBuildingTop, OnBuildingBottom).
  const top = spin("Top", app.tools.gbTop, 1, 255, (v) => app.setTools({ gbTop: clampTop(v, app.tools.gbBottom) }));
  const bottom = spin("Bottom", app.tools.gbBottom, 0, 254, (v) => app.setTools({ gbBottom: clampBottom(v, app.tools.gbTop) }));
  app.on("tools", (t) => {
    boxes.forEach((b, i) => b.set(t.gbPaint === i + 1));
    top.set(t.gbTop);
    bottom.set(t.gbBottom);
  });
  return bar("Groundbox Tools", ...boxes.map((b) => b.element), top.element, bottom.element);
}
