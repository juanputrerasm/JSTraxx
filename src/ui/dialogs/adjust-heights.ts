/*
  Adjust Terrain Heights (IDD_RAISELOWER): raise or lower every height by a number of steps, or
  scale every height by a factor (rounded down), with the before and after range, "avoid
  clipping", and whether placements and the water move with the terrain.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import { effectiveIncrement, effectiveScale, liftHeight, scaleHeight } from "../../core/edit/terrain.ts";

export interface AdjustHeightsResult { scale: boolean; increment: number; factor: number; avoidClip: boolean; movePlaced: boolean; moveWater: boolean }

export async function adjustHeightsDialog(min: number, max: number): Promise<AdjustHeightsResult | null> {
  const lift = el("input", { type: "radio", name: "adj", checked: true });
  const scale = el("input", { type: "radio", name: "adj" });
  const inc = el("input", { type: "number", min: -255, max: 255, value: 0, class: "spin" });
  const factor = el("input", { type: "number", min: 0, max: 100, step: 0.01, value: 1, class: "spin" });
  // OnTerrainRaiseLower ticks "avoid clipping" before opening the dialog.
  const avoid = el("input", { type: "checkbox", checked: true });
  const placed = el("input", { type: "checkbox", checked: true });
  const water = el("input", { type: "checkbox", checked: true });
  const afterMin = el("output"), afterMax = el("output");
  const update = () => {
    inc.disabled = !lift.checked;
    factor.disabled = !scale.checked;
    let lo = -1, hi = -1;
    if (scale.checked) {
      const fv = Number(factor.value);
      if (Number.isFinite(fv) && fv >= 0 && fv <= 100) { const f = effectiveScale(fv, max, avoid.checked); lo = scaleHeight(min, f); hi = scaleHeight(max, f); }
    } else {
      const iv = Math.trunc(Number(inc.value));
      if (Number.isFinite(iv) && iv >= -255 && iv <= 255) { const i = effectiveIncrement(iv, min, max, avoid.checked); lo = liftHeight(min, i); hi = liftHeight(max, i); }
    }
    afterMin.value = lo < 0 ? "-" : String(lo);
    afterMax.value = hi < 0 ? "-" : String(hi);
  };
  for (const c of [lift, scale, inc, factor, avoid]) { c.addEventListener("input", update); c.addEventListener("keydown", (e) => e.stopPropagation()); }
  update();
  const row = (...n: (Node | string)[]) => el("div", { class: "opt-row" }, ...n);
  const ok = await openDialog({
    title: "Adjust Terrain Heights",
    body: [
      row(el("label", { class: "opt-check" }, lift, "Raise / lower by"), inc, "steps, added to every height"),
      row(el("label", { class: "opt-check" }, scale, "Scale heights by"), factor, "times every height, rounded down"),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Terrain heights"),
        el("div", { class: "range-grid" }, el("span"), el("b", {}, "Now"), el("b", {}, "After"),
          el("span", {}, "Lowest"), el("output", {}, String(min)), afterMin,
          el("span", {}, "Highest"), el("output", {}, String(max)), afterMax),
        el("p", { class: "opt-hint" }, "Heights run from 0 to 255; anything past either end is clipped to it.")),
      el("label", { class: "opt-check" }, avoid, "Avoid clipping - shrink the change so no height hits 0 or 255"),
      el("label", { class: "opt-check" }, placed, "Move objects, truck starts and checkpoints with the terrain"),
      el("label", { class: "opt-check" }, water, "Move the water level with the terrain"),
    ],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: (v) => v !== "ok" || afterMin.value !== "-",
  });
  if (ok !== "ok") return null;
  return {
    scale: scale.checked, increment: Math.trunc(Number(inc.value)) || 0, factor: Number(factor.value),
    avoidClip: avoid.checked, movePlaced: placed.checked, moveWater: water.checked,
  };
}
