/*
  The Lake window (Traxx/LakeDlg.cpp, IDD_LAKE). Heights are shown in terrain steps, in quarters,
  as the main water level is: the box holds h / 4, the lake keeps h (a water unit, 0.5 ft). What
  is typed is rounded to the nearest unit and snapped to MinHeight .. spill. The lake is edited
  live (the view follows); OK is refused while the lake has errors, Cancel puts it back.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import { cG } from "../../core/traxx/veg.ts";
import type { TxxLake } from "../../core/traxx/txx.ts";
import type { LakeState } from "../../core/traxx/lakes.ts";
import { lakeErrorText, LAKE_MAX_HEIGHT, LAKE_MAX_SEEDS, LAKE_NO_BASIN, LAKEERR_TOO_MANY, LAKEFLAG_REFLECTIVE } from "../../core/traxx/lakes.ts";

export interface LakeDialogHooks {
  /** Re-derive the lakes and redraw; returns the lake's derived state. */
  changed(): LakeState;
  /** MinHeight for the lake as it now is. */
  minHeight(): number;
  /** DistinctHeights (body 0 counted). */
  distinctHeights(): number;
}

/** Resolves true on OK; on Cancel the lake has been put back to `backup` by the caller. */
export async function lakeDialog(index: number, lake: TxxLake, hooks: LakeDialogHooks): Promise<boolean> {
  let state = hooks.changed();
  const height = el("input", { type: "number", step: "0.25", min: "0", max: String(LAKE_MAX_HEIGHT / 4), class: "spin" }) as HTMLInputElement;
  const feet = el("span", {});
  const max = el("div", {}), tiles = el("div", {}), seeds = el("div", {}), heights = el("div", {});
  const reflective = el("input", { type: "checkbox" }) as HTMLInputElement;
  const problems = el("textarea", { readonly: true, rows: 4, class: "lake-problems" }) as HTMLTextAreaElement;

  const snap = (q: number) => {
    if (state.spill !== LAKE_NO_BASIN && q > state.spill) q = state.spill;
    const lo = hooks.minHeight();
    if (q < lo) q = lo;
    return Math.max(0, Math.min(LAKE_MAX_HEIGHT, q));
  };
  const refresh = (writeHeight: boolean) => {
    if (writeHeight) height.value = cG(lake.height / 4);
    feet.textContent = `= ${cG(lake.height / 2)} ft`;
    max.textContent = state.spill === LAKE_NO_BASIN ? "No basin here" : `Holds up to ${cG(state.spill / 4)} = ${cG(state.spill / 2)} ft`;
    tiles.textContent = `${state.tilecount} tiles of water`;
    seeds.textContent = `${lake.seeds.length} of ${LAKE_MAX_SEEDS} seeds`;
    reflective.checked = (lake.flags & LAKEFLAG_REFLECTIVE) !== 0;
    let text = "";
    for (let bit = 1; bit <= LAKEERR_TOO_MANY; bit <<= 1) if (state.errors & bit) text += `${lakeErrorText(bit)}\r\n`;
    problems.value = text;
    const n = hooks.distinctHeights();
    heights.textContent = `This track has ${n} water heights${n > 2 ? " - the engine reflects 2; the rest borrow the closest" : ""}`;
  };
  const applyHeight = (q: number) => {
    lake.height = snap(q);
    state = hooks.changed();
    refresh(true);
  };
  const typed = () => Math.floor((Number.parseFloat(height.value) || 0) * 4 + 0.5);
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
      el("label", {}, "Water height (terrain steps) ", height, " ", feet),
      max, tiles, seeds,
      el("label", { class: "opt-check" }, reflective, "Reflective"),
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
