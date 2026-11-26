/*
  Adjust Terrain Heights (IDD_RAISELOWER): raise or lower every height by a number of steps, or
  scale every height by a factor (rounded down), with the before and after range, "avoid
  clipping", and whether placements and the water move with the terrain.

  Traxx origin/main (RaiseLowerDlg.cpp m_feet): on a v6 track the dialog is in feet, against the terrain's own
  height limit: the lift is feet with 2 decimals (1 ft an arrow), the scale rounds to the nearest 1/128 ft,
  the Now and After boxes are feet ("-" while the input does not read), and OK asks for "a number of feet".
*/
import { el } from "../../shared/dom.ts";
import { alertDialog, openDialog } from "../shell/dialog.ts";
import { effectiveIncrement, effectiveIncrementV, effectiveScale, effectiveScaleV, liftHeight, liftHeightV, scaleHeight, scaleHeightV } from "../../core/edit/terrain.ts";
import { formatFeet, parseFeet } from "../../core/traxx/height-units.ts";

export interface AdjustHeightsResult { scale: boolean; increment: number; factor: number; avoidClip: boolean; movePlaced: boolean; moveWater: boolean; liftv: number }

/** A v6 track: the exact lowest and highest height in v, and the terrain's height limit. */
export interface AdjustHeightsFeet { minv: number; maxv: number; hmax: number }

/* strtod's reading of the scale box: a number at the start, else null. */
const readScale = (text: string): number | null => { const f = Number.parseFloat(text); return Number.isNaN(f) ? null : f; };

export async function adjustHeightsDialog(min: number, max: number, feet: AdjustHeightsFeet | null = null): Promise<AdjustHeightsResult | null> {
  const lift = el("input", { type: "radio", name: "adj", checked: true });
  const scale = el("input", { type: "radio", name: "adj" });
  const inc = (feet
    ? el("input", { type: "text", inputmode: "decimal", value: formatFeet(0), class: "spin" })
    : el("input", { type: "number", min: -255, max: 255, value: 0, class: "spin" })) as HTMLInputElement;
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
    if (feet) {
      // UpdateResult on a v6 track: the same, in v, shown in feet.
      let got = false;
      if (scale.checked) {
        const f0 = readScale(factor.value);
        if (f0 !== null && f0 >= 0 && f0 <= 100) {
          const f = effectiveScaleV(f0, feet.maxv, feet.hmax, avoid.checked);
          lo = scaleHeightV(feet.minv, f, feet.hmax); hi = scaleHeightV(feet.maxv, f, feet.hmax); got = true;
        }
      } else {
        const l = parseFeet(inc.value, -feet.hmax, feet.hmax);
        if (l !== null) {
          const i = effectiveIncrementV(l, feet.minv, feet.maxv, feet.hmax, avoid.checked);
          lo = liftHeightV(feet.minv, i, feet.hmax); hi = liftHeightV(feet.maxv, i, feet.hmax); got = true;
        }
      }
      afterMin.value = got ? formatFeet(lo) : "-";
      afterMax.value = got ? formatFeet(hi) : "-";
      return;
    }
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
  // OnLiftSpin: a v6 track's lift steps 1 ft an arrow, written in feet.
  if (feet) inc.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const n = (parseFeet(inc.value, -feet.hmax, feet.hmax) ?? 0) + 128 * (e.key === "ArrowUp" ? 1 : -1);
    inc.value = formatFeet(Math.max(-feet.hmax, Math.min(feet.hmax, n)));
    update();
  });
  update();
  const nowMin = feet ? formatFeet(feet.minv) : String(min), nowMax = feet ? formatFeet(feet.maxv) : String(max);
  const row = (...n: (Node | string)[]) => el("div", { class: "opt-row" }, ...n);
  const ok = await openDialog({
    title: "Adjust Terrain Heights",
    body: [
      row(el("label", { class: "opt-check" }, lift, "Raise / lower by"), inc, feet ? "feet, added to every height" : "steps, added to every height"),
      row(el("label", { class: "opt-check" }, scale, "Scale heights by"), factor, feet ? "times every height, rounded to the nearest 1/128 ft" : "times every height, rounded down"),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Terrain heights"),
        el("div", { class: "range-grid" }, el("span"), el("b", {}, "Now"), el("b", {}, "After"),
          el("span", {}, "Lowest"), el("output", {}, nowMin), afterMin,
          el("span", {}, "Highest"), el("output", {}, nowMax), afterMax),
        el("p", { class: "opt-hint" }, feet ? `Heights run from 0 to ${formatFeet(feet.hmax)} ft; anything past either end is clipped to it.` : "Heights run from 0 to 255; anything past either end is clipped to it.")),
      el("label", { class: "opt-check" }, avoid, feet ? "Avoid clipping - shrink the change so no height hits 0 or the top" : "Avoid clipping - shrink the change so no height hits 0 or 255"),
      el("label", { class: "opt-check" }, placed, "Move objects, truck starts and checkpoints with the terrain"),
      el("label", { class: "opt-check" }, water, "Move the water level with the terrain"),
    ],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (v) => {
      if (v !== "ok") return true;
      // DoDataExchange: on a v6 track a lift that is not feet is refused with Traxx's message.
      if (feet && lift.checked && parseFeet(inc.value, -feet.hmax, feet.hmax) === null) {
        await alertDialog("JSTraxx", "Please enter a number of feet.");
        inc.focus();
        return false;
      }
      return afterMin.value !== "-";
    },
  });
  if (ok !== "ok") return null;
  return {
    scale: scale.checked, increment: feet ? 0 : Math.trunc(Number(inc.value)) || 0, factor: Number(factor.value),
    avoidClip: avoid.checked, movePlaced: placed.checked, moveWater: water.checked,
    liftv: feet ? parseFeet(inc.value, -feet.hmax, feet.hmax) ?? 0 : 0,
  };
}
