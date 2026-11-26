/*
  The Lake window (Traxx/LakeDlg.cpp, IDD_LAKE). Heights are shown in terrain steps, in quarters,
  as the main water level is: the box holds h / 4, the lake keeps h (a water unit, 0.5 ft). What
  is typed is rounded to the nearest unit and snapped to MinHeight .. spill. The lake is edited
  live (the view follows); OK is refused while the lake has errors, Cancel puts it back.

  Traxx 1.7.1 (LakeDlg Capacity): "Holds up to" and the clamp read HoldsUpTo, which for a lake
  with spillway notches is the highest height that does not leak, each candidate in its own view.

  Traxx 1.7.3 (a28fe7d, 71a93b8): the Problems box says where a leaking lake's water gets out (the
  tile, also a yellow post in the view) and where the ground sits exactly at the water's height
  (up to 6 points in tile coordinates, quarters on the Spline / Full Map ground; orange posts).

  Traxx origin/main (LakeDlg.cpp HeightsInFeet): on a v6 track the box is "Water height (ft)", feet with 2
  decimals rounded to the nearest half foot, the readout beside it "ft" and "Holds up to %.2f ft".
*/
import { waterUnitsStep } from "../../core/edit/feet-fields.ts";
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import { cG } from "../../core/traxx/veg.ts";
import type { TxxLake } from "../../core/traxx/txx.ts";
import type { LakeState } from "../../core/traxx/lakes.ts";
import {
  lakeErrorText, LAKE_MAX_HEIGHT, LAKE_MAX_SEEDS, LAKE_NO_BASIN, LAKEERR_CORNER_AT_H, LAKEERR_LAST, LAKEERR_LEAK, LAKEFLAG_REFLECTIVE,
} from "../../core/traxx/lakes.ts";

export interface LakeDialogHooks {
  /** Re-derive the lakes and redraw; returns the lake's derived state. */
  changed(): LakeState;
  /** MinHeight for the lake as it now is. */
  minHeight(): number;
  /** DistinctHeights (body 0 counted). */
  distinctHeights(): number;
  /** Capacity: what the lake holds up to (HoldsUpTo), LAKE_NO_BASIN for no basin. */
  capacity(): number;
  /**
    The heights the ground allows, water units: [0, LAKE_MAX_HEIGHT] when absent (Traxx). A
    tall track's ground above 512 ft widens it (to LAKE_MAX_HEIGHT_V6).
  */
  heightRange?(): [number, number];
  /** N, the cells a side of the track's world (a tile index is x + z * N); absent: 256. */
  cells?(): number;
  /** Traxx origin/main: the track's heights are in feet (a v6 track); the box is then feet with 2 decimals. */
  feet?(): boolean;
}

/**
  The Problems box (CLakeDlg::Refresh): one line per error bit; under LEAK the escape tile, under
  CORNER_AT_H the first 6 points at H (tile coordinates, %g of lattice / atstep) and how many more.
*/
export function lakeProblemsText(state: LakeState, cells = 256): string {
  let text = "";
  for (let bit = 1; bit <= LAKEERR_LAST; bit <<= 1) {
    if (!(state.errors & bit)) continue;
    text += `${lakeErrorText(bit)}\r\n`;
    if (bit === LAKEERR_LEAK && state.escape >= 0) {
      text += `  The water gets out at tile (${state.escape % cells}, ${Math.floor(state.escape / cells)}).\r\n`;
    }
    if (bit === LAKEERR_CORNER_AT_H && state.atcount > 0) {
      const shown = Math.min(state.atcount, 6, state.atx.length), step = state.atstep > 0 ? state.atstep : 1;
      let e = "  Ground exactly at the water's height at ";
      for (let i = 0; i < shown; i++) e += `${i > 0 ? ", " : ""}(${cG(state.atx[i]! / step)},${cG(state.atz[i]! / step)})`;
      if (state.atcount > shown) e += `, +${state.atcount - shown} more`;
      text += `${e} - raise or lower them a quarter step.\r\n`;
    }
  }
  return text;
}

/** Resolves true on OK; on Cancel the lake has been put back to `backup` by the caller. */
export async function lakeDialog(index: number, lake: TxxLake, hooks: LakeDialogHooks): Promise<boolean> {
  let state = hooks.changed();
  const [hmin, hmax] = hooks.heightRange?.() ?? [0, LAKE_MAX_HEIGHT];
  const inFeet = hooks.feet?.() ?? false;
  const height = (inFeet
    ? el("input", { type: "text", inputmode: "decimal", class: "spin" })
    : el("input", { type: "number", step: "0.25", min: String(hmin / 4), max: String(hmax / 4), class: "spin" })) as HTMLInputElement;
  const feet = el("span", {});
  const max = el("div", {}), tiles = el("div", {}), seeds = el("div", {}), heights = el("div", {});
  const reflective = el("input", { type: "checkbox" }) as HTMLInputElement;
  const problems = el("textarea", { readonly: true, rows: 4, class: "lake-problems" }) as HTMLTextAreaElement;

  const snap = (q: number) => {
    const cap = hooks.capacity();
    if (cap !== LAKE_NO_BASIN && q > cap) q = cap;
    const lo = hooks.minHeight();
    if (q < lo) q = lo;
    return Math.max(hmin, Math.min(hmax, q));
  };
  const refresh = (writeHeight: boolean) => {
    // Refresh (LakeDlg.cpp): on a v6 track the box itself is feet, so the readout beside it just names the unit.
    if (writeHeight) height.value = inFeet ? (lake.height / 2).toFixed(2) : cG(lake.height / 4);
    feet.textContent = inFeet ? "ft" : `= ${cG(lake.height / 2)} ft`;
    const cap = hooks.capacity();
    max.textContent = cap === LAKE_NO_BASIN ? "No basin here" : inFeet ? `Holds up to ${(cap / 2).toFixed(2)} ft` : `Holds up to ${cG(cap / 4)} = ${cG(cap / 2)} ft`;
    tiles.textContent = `${state.tilecount} tiles of water`;
    seeds.textContent = `${lake.seeds.length} of ${LAKE_MAX_SEEDS} seeds`;
    reflective.checked = (lake.flags & LAKEFLAG_REFLECTIVE) !== 0;
    problems.value = lakeProblemsText(state, hooks.cells?.() ?? 256);
    const n = hooks.distinctHeights();
    // LakeDlg.cpp LoadControls: the engine's hybrid reflections, every lake reflects; a height
    // over 10 ft above the lowest water may get a mirror of its own (the nearest 2 per frame).
    heights.textContent = `This track has ${n} water heights.` + (n > 1
      ? " Every lake reflects. By default the 2 nearest heights over 10 ft above the lowest water get a mirror of their own; the rest share the lowest one's, corrected for height."
      : "");
  };
  const applyHeight = (q: number) => {
    lake.height = snap(q);
    state = hooks.changed();
    refresh(true);
  };
  // HeightFromText: quarters of a step, or on a v6 track feet rounded to the nearest half foot (blank is 0).
  const typed = () => (inFeet ? waterUnitsStep(height.value, 0, hmax) : Math.floor((Number.parseFloat(height.value) || 0) * 4 + 0.5));
  height.addEventListener("change", () => applyHeight(typed()));
  height.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); applyHeight(typed()); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); applyHeight(typed() + (e.key === "ArrowUp" ? 1 : -1)); }
  });
  reflective.addEventListener("change", () => {
    lake.flags = reflective.checked ? lake.flags | LAKEFLAG_REFLECTIVE : lake.flags & ~LAKEFLAG_REFLECTIVE;
    state = hooks.changed();
    refresh(false);
  });
  refresh(true);
  const r = await openDialog({
    title: `Lake ${index + 1}`,
    body: el("div", { class: "lake-dialog" },
      el("label", {}, inFeet ? "Water height (ft) " : "Water height (terrain steps) ", height, " ", feet),
      max, tiles, seeds,
      el("label", { class: "opt-check" }, reflective, "Reflective (the game currently reflects every lake)"),
      el("div", {}, "Problems"), problems, heights),
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: (v) => {
      if (v !== "ok") return true;
      applyHeight(typed());
      return state.errors === 0;
    },
  });
  return r === "ok";
}
