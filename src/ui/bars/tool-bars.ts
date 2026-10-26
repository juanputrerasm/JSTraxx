/*
  The per-mode tool bars docked under View Controls. Traxx shows one at a time
  (CTraxxFrame::OnEditmode*): Terrain Tools, Texture Tools, Course Tools, none for objects,
  Groundbox Tools.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import { defaultAltitudeForTool } from "../../core/settings.ts";
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
  const width = spin("Width", e.terrainw, 1, 25, (v) => app.updateSettings((s) => { s.edit.terrainw = v; }));
  const height = spin("Height", e.terrainh, 1, 25, (v) => app.updateSettings((s) => { s.edit.terrainh = v; }));
  const altitude = spin("Altitude", e.altitude, -255, 255, (v) => app.updateSettings((s) => { s.edit.altitude = v; }));
  const orientation = slider(() => "Orientation", e.orientation, 0, 7, (v) => app.updateSettings((s) => { s.edit.orientation = v; }));
  const curvature = slider(() => "Curvature", e.curvature, 0, 6, (v) => app.updateSettings((s) => { s.edit.curvature = v; }));
  /*
    Picking Plane sets Altitude to 100, Direct Edit to 1 and the rest to 32, and each tool
    family remembers its own value while the editor runs (CTraxxFrame::SetTerrainToolMode:
    standard_alt, plane_alt, direct_alt).
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
