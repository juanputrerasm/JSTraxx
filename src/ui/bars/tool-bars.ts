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
import { onFeetLimit, onTerrainMode, trackTerrainMode } from "../../app/terrain-kind.ts";
import { amplitudeFeetFromText, amplitudeFeetRange, amplitudeFeetText, boxBottomOnLeave, boxBottomWhileTyping, boxTopOnLeave, boxTopWhileTyping,
  followAmplitude, followBoxBar, stepAmplitudeFeet } from "../../core/edit/feet-fields.ts";
import { clampBoxBottom, clampBoxTop, formatFeet } from "../../core/traxx/height-units.ts";
import { bar, check, radioGroup, slider, spin } from "./controls.ts";
import { onCourseBar, pickLeadInFromBar, type CourseBarState } from "../../app/course-bar.ts";
import { courseBarTexts } from "../../core/edit/race-edit.ts";
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
  /*
    Traxx origin/main FollowAmplitudeKind: a v6 track's box is feet, to its height limit. The amounts kept for
    each tool family come inside the new limit (the plane height not negative); leaving v6 they come inside
    255 steps (and to whole steps on a classic 8-bit track, which the terrain mode above does).
  */
  let feetLimit = -1;
  onFeetLimit(app, (limit) => {
    if (limit === feetLimit) return;
    const wasFeet = feetLimit > 0;
    feetLimit = limit;
    altitude.feet(limit);
    if (limit <= 0 && !wasFeet) return;
    const fractional = amplitudeFractional(trackTerrainMode(app));
    for (const [k, steps] of remembered) remembered.set(k, followAmplitude(altitudeV(steps), k, limit, fractional) / 256);
    const v = followAmplitude(altitudeV(app.settings.edit.altitude), app.settings.edit.tool, limit, fractional) / 256;
    if (v !== app.settings.edit.altitude) app.updateSettings((st) => { st.edit.altitude = v; });
    else altitude.set(v);
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
  Traxx origin/main: on a v6 track the box is feet with 2 decimals (ParseFeet, FormatFeet), 1 ft a
  click, held to the tool's range: Plane 0..the height limit, every other tool (Direct Edit too)
  +-the limit (AmplitudeRange); the box is wider (34,68,30,12).
*/
function altitudeBox(app: AppState): { element: HTMLElement; set(steps: number): void; kind(fractional: boolean): void; feet(limit: number): void } {
  let fractional = false;
  let limit = 0;
  const input = el("input", { type: "number", min: -255, max: 255, step: 1, class: "spin", "aria-label": "Altitude" }) as HTMLInputElement;
  const range = () => amplitudeFeetRange(app.settings.edit.tool, limit);
  const show = (steps: number) => { input.value = limit > 0 ? amplitudeFeetText(altitudeV(steps), range()) : amplitudeText(altitudeV(steps), fractional); };
  const store = (v: number) => {
    if (limit > 0) {
      const [lo, hi] = range();
      v = Math.max(lo, Math.min(hi, v));
    } else if (app.settings.edit.tool !== 7) v = Math.max(-AMPLITUDE_MAXV, Math.min(AMPLITUDE_MAXV, v));
    const cap = limit > 0 ? limit / 256 : 255;
    const steps = Math.max(-cap, Math.min(cap, v / 256));
    show(steps);
    if (steps !== app.settings.edit.altitude) app.updateSettings((s) => { s.edit.altitude = steps; });
  };
  const commit = () => store(limit > 0 ? amplitudeFeetFromText(input.value) : amplitudeFromText(input.value, fractional));
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => {
    // Keys typed in the box belong to it, not to the 3D view.
    e.stopPropagation();
    if (e.key === "Enter") { commit(); input.blur(); }
    else if (e.key === "Escape") input.blur();
    else if ((fractional || limit > 0) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      // OnAmplitudeSpin: StepAmplitude from the text as it reads (1 ft a click on a v6 track).
      e.preventDefault();
      const units = e.key === "ArrowUp" ? 1 : -1;
      store(limit > 0 ? stepAmplitudeFeet(input.value, units, range()) : stepAmplitude(input.value, units));
    }
  });
  show(app.settings.edit.altitude);
  const label = el("span", { class: "bar-label" }, "Altitude");
  return {
    element: el("label", { class: "bar-row" }, label, input),
    set: show,
    kind: (on) => { fractional = on; if (limit <= 0) input.step = on ? "0.1" : "1"; show(app.settings.edit.altitude); },
    feet: (l) => {
      limit = l;
      // Feet are typed as text: a number box would refuse a decimal comma (ParseFeet reads one).
      input.type = l > 0 ? "text" : "number";
      input.inputMode = l > 0 ? "decimal" : "";
      input.classList.toggle("spin-feet", l > 0);
      input.step = l > 0 ? "" : fractional ? "0.1" : "1";
      show(app.settings.edit.altitude);
    },
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

/*
  Course Tools (IDD_COURSE_CONTROL). Traxx 1.8.2 (RefreshCourseBar, OnLeadIn): on a lane track (a drag,
  or Parallel rules) the radios read "Lane 1", "Lane 2", "2", "3", "4" and the tickbox "Always show
  lanes"; otherwise "Main (0)", "1".."4" and "Always show main". "Lead-in, then:" (None, Lane 1, Lane
  2: the selected course's lead-in) is enabled for courses 2..4, even with the rules off so a stale
  lead-in can be cleared; a pick goes to Course mode (app/course-bar.ts), which may refuse it.
*/
export function courseToolsBar(app: AppState): HTMLElement {
  const courses = radioGroup("course", ["Main (0)", "1", "2", "3", "4"], app.tools.course, (v) => app.setTools({ course: v }));
  const always = check("Always show main", app.tools.alwaysMain, (v) => app.setTools({ alwaysMain: v }));
  const radioTexts = [...courses.element.querySelectorAll("label")].map((l) => l.lastChild as Text);
  const alwaysText = always.element.lastChild as Text;
  const leadIn = el("select", { "aria-label": "Lead-in, then" }, ...["None", "Lane 1", "Lane 2"].map((n, i) => el("option", { value: i }, n))) as HTMLSelectElement;
  const leadLabel = el("span", { class: "bar-label" }, "Lead-in, then:");
  const leadRow = el("div", { class: "bar-leadin" }, leadLabel, leadIn);
  let bar0: CourseBarState = { open: false, lanes: false, leadIn: -1 };
  const refresh = () => {
    const t = courseBarTexts(bar0.lanes);
    radioTexts.forEach((n, i) => { n.textContent = t.radios[i]!; });
    alwaysText.textContent = t.always;
    const sel = app.tools.course;
    leadIn.value = String((sel >= 2 ? bar0.leadIn : -1) + 1);
    const on = bar0.open && sel >= 2;
    leadIn.disabled = !on;
    leadRow.classList.toggle("disabled", !on);
  };
  leadIn.addEventListener("change", () => {
    pickLeadInFromBar(app, app.tools.course, Number(leadIn.value));
    // After a pick the keys go back to the view.
    leadIn.blur();
  });
  leadIn.addEventListener("keydown", (e) => e.stopPropagation());
  onCourseBar(app, (st) => { bar0 = st; refresh(); });
  app.on("tools", (t) => { courses.set(t.course); always.set(t.alwaysMain); refresh(); });
  refresh();
  return bar("Course Tools", el("fieldset", { class: "bar-group" }, el("legend", {}, "Course"), courses.element), always.element, leadRow);
}

export function groundBoxToolsBar(app: AppState): HTMLElement {
  // Four checkboxes that behave as one choice, or none (CTraxxFrame::OnBuildingPaint*).
  const labels = ["Paint Face", "Paint Sides", "Paint Top/Bottom", "Paint All Faces"];
  const boxes = labels.map((label, i) => check(label, app.tools.gbPaint === i + 1, (on) => app.setTools({ gbPaint: on ? ((i + 1) as 1 | 2 | 3 | 4) : 0 })));
  // Top stays above Bottom (CTraxxFrame::OnBuildingTop, OnBuildingBottom). The tools hold v (1/128 ft); the spins
  // show whole 2 ft steps (v >> 8), as a classic track's boxes are.
  const top = spin("Top", app.tools.gbTop >> 8, 1, 255, (v) => app.setTools({ gbTop: clampTop(v << 8, app.tools.gbBottom) }));
  const bottom = spin("Bottom", app.tools.gbBottom >> 8, 0, 254, (v) => app.setTools({ gbBottom: clampBottom(v << 8, app.tools.gbTop) }));
  /*
    Traxx origin/main: on a v6 track the two boxes are feet with 2 decimals (BuildingFeet). While typing, only
    a value already in range is taken (a top in (bottom, ceiling], a bottom in [0, top)), so "1000" can be
    typed past a "1"; leaving the box takes it in full, held in range, a blank or unreadable box going back
    to the last good value (OnBuildingTopKill); the arrows step 1 ft (StepBuildingFeet).
  */
  let ceiling = 0;
  const feetBox = (label: string, isTop: boolean) => {
    const input = el("input", { type: "text", inputmode: "decimal", class: "spin spin-feet", "aria-label": label }) as HTMLInputElement;
    const show = () => { input.value = formatFeet(isTop ? app.tools.gbTop : app.tools.gbBottom); };
    const leave = () => {
      const t = app.tools;
      const v = isTop ? boxTopOnLeave(input.value, t.gbTop, t.gbBottom, ceiling) : boxBottomOnLeave(input.value, t.gbBottom, t.gbTop);
      app.setTools(isTop ? { gbTop: v } : { gbBottom: v });
      show();
    };
    input.addEventListener("input", () => {
      const t = app.tools;
      const v = isTop ? boxTopWhileTyping(input.value, t.gbBottom, ceiling) : boxBottomWhileTyping(input.value, t.gbTop);
      if (v !== null) app.setTools(isTop ? { gbTop: v } : { gbBottom: v });
    });
    input.addEventListener("blur", leave);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { leave(); input.blur(); }
      else if (e.key === "Escape") input.blur();
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const t = app.tools, step = 128 * (e.key === "ArrowUp" ? 1 : -1);
        app.setTools(isTop ? { gbTop: clampBoxTop(t.gbTop + step, t.gbBottom, ceiling) } : { gbBottom: clampBoxBottom(t.gbBottom + step, t.gbTop) });
        show();
      }
    });
    const element = el("label", { class: "bar-row" }, el("span", { class: "bar-label" }, label), input);
    return { element, input, show };
  };
  const topFeet = feetBox("Top", true), bottomFeet = feetBox("Bottom", false);
  const showKind = () => {
    top.element.hidden = bottom.element.hidden = ceiling > 0;
    topFeet.element.hidden = bottomFeet.element.hidden = ceiling <= 0;
  };
  showKind();
  // FollowBuildingKind: the two values carried into the new unit; the view is told them for its next box only.
  onFeetLimit(app, (limit) => {
    if (limit === ceiling) return;
    ceiling = limit;
    showKind();
    const f = followBoxBar(app.tools.gbTop, app.tools.gbBottom, limit);
    if (f.top !== app.tools.gbTop || f.bottom !== app.tools.gbBottom) {
      // TX_GBUPPERSET / TX_GBLOWERSET: a selected box is not changed by the track's kind changing.
      app.setTools({ gbTop: f.top, gbBottom: f.bottom, gbBarOnly: true });
      app.tools.gbBarOnly = false;
    }
    topFeet.show();
    bottomFeet.show();
  });
  app.on("tools", (t) => {
    boxes.forEach((b, i) => b.set(t.gbPaint === i + 1));
    top.set(t.gbTop >> 8);
    bottom.set(t.gbBottom >> 8);
    // The box being typed in keeps its text.
    if (document.activeElement !== topFeet.input) topFeet.show();
    if (document.activeElement !== bottomFeet.input) bottomFeet.show();
  });
  return bar("Groundbox Tools", ...boxes.map((b) => b.element), top.element, bottom.element, topFeet.element, bottomFeet.element);
}
