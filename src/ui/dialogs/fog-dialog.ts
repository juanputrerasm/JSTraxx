/*
  Fog Properties (IDD_FOG_PROPERTIES, Traxx/FogPropertiesDlg.cpp), reached from Object
  Properties' "Fog..." button. The logic is in core/edit/fog-properties.ts; this is the frame:
  the Volume, Thickness and Softness groups on the left, Colour and opacity, Wisps and Appears in
  on the right, Defaults under them.

  The size is read-only, the box's own. `preview` gets the working copy as the fields the
  viewport volume draws change (OnChangePreviewField, OnHScroll, OnFogColourSel); the caller puts
  its own copy back whichever way the dialog closes. Resolves with the fog on OK, or null.
*/
import { el } from "../../shared/dom.ts";
import { alertDialog, openDialog } from "../shell/dialog.ts";
import type { TraxxFog } from "../../core/traxx/sit.ts";
import {
  FOG_FIELDS, FOG_WEATHERS, fogDialogDefaults, fogDialogResult, fogDialogStart, fogHeightsText, fogPreview,
  roundPercentText, validateFogFields, weatherChecked, weatherMask, type FogBox, type FogField,
} from "../../core/edit/fog-properties.ts";

const stop = (i: HTMLElement) => { i.addEventListener("keydown", (e) => e.stopPropagation()); return i; };
const row = (label: string, ...nodes: (Node | string)[]) => el("label", { class: "opt-row" }, el("span", { class: "fld", style: "min-width: 13em" }, label), ...nodes);
const hex = (rgb: readonly number[]) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const unhex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

export async function fogPropertiesDialog(fogIn: TraxxFog, box: FogBox | null, preview: (fog: TraxxFog) => void): Promise<TraxxFog | null> {
  const fog = { ...fogIn };
  const start = fogDialogStart(fog, box);
  const inputs = {} as Record<FogField, HTMLInputElement>;
  for (const f of FOG_FIELDS) {
    const readOnly = f === "w" || f === "l" || f === "h";
    inputs[f] = stop(el("input", { type: "text", value: start.texts[f], class: "spin", inputmode: "decimal", readonly: readOnly ? true : null, tabindex: readOnly ? -1 : null })) as HTMLInputElement;
  }
  let rgb = start.rgb;
  let suspend = true;
  const round = stop(el("input", { type: "range", min: 0, max: 100, step: 1, value: start.round, style: "width: 9em" })) as HTMLInputElement;
  const roundVal = el("span", {}, roundPercentText(start.round));
  const heights = el("p", { class: "hint" }, "");
  const swatch = el("span", { style: `display: inline-block; width: 4em; height: 1.4em; border: 1px inset var(--line-strong); background: ${hex(rgb)}` });
  const picker = el("input", { type: "color", value: hex(rgb), style: "position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none" }) as HTMLInputElement;
  const weathers = FOG_WEATHERS.map((_, i) => el("input", { type: "checkbox", checked: weatherChecked(start.wmask, i) }) as HTMLInputElement);

  const roundPercent = () => Math.min(100, Math.max(0, Math.trunc(Number(round.value)) || 0));
  const updateHeights = () => { if (box) heights.textContent = fogHeightsText(box, inputs.base.value, fog.base); };
  const previewNow = () => {
    if (suspend) return;
    preview(fogPreview(fog, { base: inputs.base.value, maxop: inputs.maxop.value, wisp: inputs.wisp.value, wspeed: inputs.wspeed.value }, roundPercent(), rgb));
  };
  const setColour = (c: [number, number, number]) => { rgb = c; swatch.style.background = hex(c); picker.value = hex(c); };

  // What the viewport volume draws: the floor, the opacity, and whether the drift arrow shows.
  for (const f of ["base", "maxop", "wisp", "wspeed"] as const) inputs[f].addEventListener("input", () => { updateHeights(); previewNow(); });
  round.addEventListener("input", () => { roundVal.textContent = roundPercentText(roundPercent()); previewNow(); });
  picker.addEventListener("input", () => { setColour(unhex(picker.value)); previewNow(); });
  const choose = el("button", { type: "button", onclick: () => picker.click() }, "Choose...");

  /* OnFogDefaults: the new-object set; the size is the box's and is not touched. */
  const defaults = el("button", { type: "button", onclick: () => {
    const d = fogDialogDefaults();
    suspend = true;
    for (const [k, v] of Object.entries(d.texts)) inputs[k as FogField].value = v;
    suspend = false;
    round.value = String(d.round);
    roundVal.textContent = roundPercentText(d.round);
    weathers.forEach((w, i) => { w.checked = weatherChecked(d.wmask, i); });
    setColour(d.rgb);
    updateHeights();
    previewNow();
  } }, "Defaults");

  const left = el("div", { style: "display: flex; flex-direction: column; gap: 6px" },
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Volume"),
      row("Width, across (ft)", inputs.w),
      row("Length, along (ft)", inputs.l),
      row("Height (ft)", inputs.h),
      row("Floor offset from object (ft)", inputs.base, "< 0 = lower"),
      heights,
      el("p", { class: "hint" }, "Size is set by the object's Size fields.")),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Thickness"),
      row("Visibility into it (ft)", inputs.vis),
      el("p", { class: "hint" }, "Smaller = thicker.  30 wall, 1000 haze."),
      row("Thins by half every (ft)", inputs.half, "0 = uniform")),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Softness"),
      row("Soft sides (ft)", inputs.edge),
      row("Soft top (ft)", inputs.top),
      row("Soft bottom (ft)", inputs.bot),
      el("p", { class: "hint" }, "0 = sits on water/ground"),
      row("Roundness", round, roundVal)));
  const right = el("div", { style: "display: flex; flex-direction: column; gap: 6px" },
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Colour and opacity"),
      el("div", { class: "opt-row" }, el("span", { class: "fld", style: "min-width: 5em" }, "Colour"), swatch, choose, picker),
      row("Opacity cap (%)", inputs.maxop)),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Wisps"),
      row("Wisps (%)", inputs.wisp),
      row("Wisp size (ft)", inputs.wsize),
      row("Drift (ft/s)", inputs.wspeed),
      el("p", { class: "hint" }, "Drifts along the object's heading.")),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Appears in"),
      el("div", { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px" },
        // Two columns, Clear..Rain then Snow..Pitch black, as the frame has them.
        ...[0, 5, 1, 6, 2, 7, 3, 8, 4].map((i) => el("label", { class: "opt-check" }, weathers[i]!, FOG_WEATHERS[i]!)))));

  updateHeights();
  suspend = false;

  let out: TraxxFog | null = null;
  const r = await openDialog({
    title: "Fog Properties",
    className: "live",
    body: [el("div", { class: "obj-two" }, left, right), defaults],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (v) => {
      if (v !== "ok") return true;
      const texts = Object.fromEntries(FOG_FIELDS.map((f) => [f, inputs[f].value])) as Record<FogField, string>;
      const checked = validateFogFields(texts);
      if ("message" in checked) {
        await alertDialog("Fog Properties", checked.message);
        inputs[checked.field].focus();
        inputs[checked.field].select();
        return false;
      }
      out = fogDialogResult(fog, checked.values, roundPercent(), rgb, weatherMask(weathers.map((w) => w.checked)), box);
      return true;
    },
  });
  return r === "ok" ? out : null;
}
