/* Speed Limit (IDD_COURSE_SPEED) and Truck Properties (IDD_TRUCK_PROPERTIES). */
import { el } from "../../shared/dom.ts";
import { alertDialog, openDialog } from "../shell/dialog.ts";
import { formatFeet } from "../../core/traxx/height-units.ts";
import { truckZFromFeet, truckZStep, TRUCK_Z_FEET_MESSAGE } from "../../core/edit/feet-fields.ts";

const number = (value: number, min: number, max: number) => {
  const input = el("input", { type: "number", min, max, step: 1, value, class: "spin" });
  input.addEventListener("keydown", (e) => e.stopPropagation());
  return input;
};
const int = (input: HTMLInputElement, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(Number(input.value)) || 0));

export async function speedLimitDialog(speed: number): Promise<{ speed: number; all: boolean } | null> {
  const value = number(speed, 0, 65535);
  const all = el("input", { type: "checkbox" });
  const r = await openDialog({
    title: "Speed Limit",
    body: [el("div", { class: "opt-row" }, value, "(0 means no limit)"), el("label", { class: "opt-check" }, all, "Apply to All (segments with same index)")],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  return r === "ok" ? { speed: int(value, 0, 65535), all: all.checked } : null;
}

export interface TruckFields { name: string; x: number; y: number; z: number; angle: number; course: number }

/* The angle in whole degrees, 0..359; X, Y and the height as stored (ipos and steps). */
/*
  Traxx origin/main (TruckPropertiesDlg.cpp m_feet): on a v6 track Z is feet with 2 decimals, up to the
  terrain's height limit (`feetLimit`, v), 1 ft an arrow from the number as it reads (OnZSpin); OK takes it
  to the nearest whole 2 ft step the truck stands on, or refuses text that is not feet.
*/
export async function truckPropertiesDialog(t: TruckFields, feetLimit = 0): Promise<TruckFields | null> {
  const feet = feetLimit > 0;
  const x = number(t.x, 0, 16383), y = number(t.y, 0, 16383), angle = number(t.angle, 0, 359);
  const z = feet ? el("input", { type: "text", inputmode: "decimal", value: formatFeet(t.z * 256), class: "spin" }) as HTMLInputElement : number(t.z, 0, 255);
  // The truck's z is a whole 2 ft step: 256 v (m_lastv).
  let last = t.z * 256;
  if (feet) z.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const r = truckZStep(z.value, e.key === "ArrowUp" ? 1 : -1, last, feetLimit);
    last = r.last;
    z.value = formatFeet(r.shown);
  });
  const courses = [0, 1, 2, 3, 4].map((c) => el("input", { type: "radio", name: "truck-course", checked: c === t.course }));
  const r = await openDialog({
    title: "Truck Properties",
    body: [
      el("p", { class: "modal-text" }, t.name),
      el("div", { class: "truck-grid" },
        el("div", { class: "opt-page" },
          el("label", { class: "opt-row" }, el("span", { class: "fld" }, "X"), x),
          el("label", { class: "opt-row" }, el("span", { class: "fld" }, "Y"), y),
          el("label", { class: "opt-row" }, el("span", { class: "fld" }, "Above ground"), z),
          el("label", { class: "opt-row" }, el("span", { class: "fld" }, "Angle"), angle)),
        el("fieldset", { class: "opt-group" }, el("legend", {}, "Course"), ...courses.map((c, i) => el("label", { class: "opt-check" }, c, String(i))))),
    ],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (v) => {
      if (v !== "ok" || !feet || truckZFromFeet(z.value, feetLimit) !== null) return true;
      await alertDialog("Truck Properties", TRUCK_Z_FEET_MESSAGE);
      z.focus();
      return false;
    },
  });
  if (r !== "ok") return null;
  return { name: t.name, x: int(x, 0, 16383), y: int(y, 0, 16383), z: feet ? truckZFromFeet(z.value, feetLimit)! : int(z, 0, 255), angle: int(angle, -100000, 100000), course: Math.max(0, courses.findIndex((c) => c.checked)) };
}
