/*
  Object Properties (IDD_OBJECT_PROPERTIES), Light Properties (IDD_LIGHT_PROPERTIES) and the
  stock sound list (StockSoundsDlg), from Traxx/ObjectPropertiesDlg.cpp, LightPropertiesDlg.cpp
  and StockSoundsDlg.cpp.

  Object Properties shows its changes on the object as they are made (ApplySettings), through
  `preview`; the caller puts the object back on Cancel.
*/
import { el } from "../../shared/dom.ts";
import { alertDialog, openDialog } from "../shell/dialog.ts";
import { OBJECT_TYPE_NAMES, TYPEIDX_CRUSH, TYPEIDX_RAMP, TYPE_MOVING, TYPE_TRAIN, CHECKPOINT } from "../../core/edit/objects.ts";
import type { ObjectFields } from "../../core/edit/object-properties.ts";
import { STOCK_CONT_SOUNDS, STOCK_SOUNDS } from "../../core/traxx/stock-data.ts";
import { traxxLightDefaults, type TraxxLight } from "../../core/traxx/sit.ts";
import { LIGHT_RADIUS_MAX } from "../../core/view/light-pool.ts";
import { GP_HEIGHT, GP_MASS, GP_NAMES, GP_ANGLE, GP_PITCH, GP_TILT, GP_SIZEH, GP_SIZEL, GP_SIZEW, parses, type GroupFields, type GroupResult } from "../../core/edit/group-properties.ts";

const TYPEIDX_LIGHT = 12;
const LIGHT_BRIGHT_MIN = 0.25, LIGHT_BRIGHT_MAX = 3.75;

const stop = (i: HTMLElement) => { i.addEventListener("keydown", (e) => e.stopPropagation()); return i; };
const num = (value: number, step: number | "any" = "any", extra: Record<string, unknown> = {}) =>
  stop(el("input", { type: "number", step, value, class: "spin", ...extra })) as HTMLInputElement;
const row = (label: string, ...nodes: (Node | string)[]) => el("label", { class: "opt-row" }, el("span", { class: "fld" }, label), ...nodes);

/** StockSoundsDlg: the game's impact or continuous sounds; resolves with the name upper case, or null. */
export async function stockSoundsDialog(continuous: boolean, current: string): Promise<string | null> {
  const list = continuous ? STOCK_CONT_SOUNDS : STOCK_SOUNDS;
  const select = stop(el("select", { size: 14, class: "stock-list" },
    ...list.map(([name, text]) => el("option", { value: name, selected: name.toLowerCase() === current.toLowerCase() }, `${name}  -  ${text}`)))) as HTMLSelectElement;
  if (select.selectedIndex < 0) select.selectedIndex = 0;
  const shown = openDialog({ title: continuous ? "Stock Continuous Sounds" : "Stock Sounds", body: select, buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
  // A double-click is OK (OnDblclkList).
  select.addEventListener("dblclick", () => (select.closest("form") as HTMLFormElement | null)?.requestSubmit());
  const r = await shown;
  return r === "ok" && select.value ? select.value.toUpperCase() : null;
}

/** IDD_LIGHT_PROPERTIES; `preview` shows the pool as the fields change. Resolves with the light, or null. */
export async function lightPropertiesDialog(light: TraxxLight, preview: (l: TraxxLight) => void): Promise<TraxxLight | null> {
  const clampBright = (v: number) => Math.min(LIGHT_BRIGHT_MAX, Math.max(LIGHT_BRIGHT_MIN, v));
  const radius = num(light.radius), bright = num(clampBright(light.bright)), height = num(light.heightOffset), aim = num(light.aimOffset);
  const glowRadius = num(light.glowRadius), coneLen = num(light.coneLength), coneRim = num(light.coneRimRadius), coneBase = num(light.coneBaseRadius);
  const toHex = (v: number) => Math.max(0, Math.min(255, Math.trunc(v * 255 + 0.5))).toString(16).padStart(2, "0");
  const colour = el("input", { type: "color", value: `#${toHex(light.r)}${toHex(light.g)}${toHex(light.b)}` }) as HTMLInputElement;
  const mode = stop(el("select", {}, ...["0 - none (still lights)", "1 - glow sprite", "2 - glow sprite + cone"].map((t, i) => el("option", { value: i }, t)))) as HTMLSelectElement;
  mode.value = String(light.glowMode >= 0 && light.glowMode <= 2 ? light.glowMode : 0);
  const coneBox = el("fieldset", { class: "opt-group" }, el("legend", {}, "Cone"),
    row("Length (ft)", coneLen), row("Radius at far end (ft)", coneRim), row("Radius at source (ft)", coneBase));
  const enable = () => {
    const m = Number(mode.value);
    coneBox.disabled = m !== 2;
    glowRadius.disabled = m === 0;
  };
  // ReadDlgFloat: an empty or half-typed field keeps the last value; clamped for the preview.
  const read = (i: HTMLInputElement, fallback: number, lo: number, hi: number) => {
    const t = i.value.trim();
    if (!t || !Number.isFinite(Number(t))) return fallback;
    return Math.min(hi, Math.max(lo, Number(t)));
  };
  const previewNow = () => preview({
    ...light,
    radius: read(radius, light.radius, 0, LIGHT_RADIUS_MAX),
    bright: read(bright, light.bright, LIGHT_BRIGHT_MIN, LIGHT_BRIGHT_MAX),
    heightOffset: read(height, light.heightOffset, -LIGHT_RADIUS_MAX, LIGHT_RADIUS_MAX),
    coneLength: read(coneLen, light.coneLength, 0, LIGHT_RADIUS_MAX),
    aimOffset: read(aim, light.aimOffset, -LIGHT_RADIUS_MAX, LIGHT_RADIUS_MAX),
    glowMode: Number(mode.value),
  });
  for (const i of [radius, bright, height, coneLen, aim]) i.addEventListener("input", previewNow);
  mode.addEventListener("change", () => { enable(); previewNow(); });
  const defaults = el("button", { type: "button", onclick: () => {
    const d = traxxLightDefaults();
    radius.value = String(d.radius); height.value = String(d.heightOffset); glowRadius.value = String(d.glowRadius);
    coneLen.value = String(d.coneLength); coneRim.value = String(d.coneRimRadius); coneBase.value = String(d.coneBaseRadius);
    bright.value = String(d.bright); aim.value = String(d.aimOffset); mode.value = String(d.glowMode); colour.value = "#ffffff";
    enable();
    previewNow();
  } }, "Defaults");
  enable();
  let out: TraxxLight | null = null;
  const r = await openDialog({
    title: "Light Properties",
    className: "live",
    body: [
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Light"),
        row("Pool radius on ground (ft)", radius, "= cyan ring"),
        row("Brightness (x)", bright, "1 = headlight"),
        el("p", { class: "hint" }, "Fills the pool's middle.  0.25 to 3.75 - soft below 1."),
        row("Height above object (ft)", height, "costs nothing"),
        row("Aim offset (ft)", aim),
        el("p", { class: "hint" }, "Throws the pool the way the box faces.  0 = below it."),
        row("Colour", colour),
        row("Visible source", mode),
        row("Glow radius (ft)", glowRadius),
        el("p", { class: "hint" }, "Mode 0 is not off - it hides the bulb, not the pool."),
        el("p", { class: "hint" }, "Radius = wide.  Height = free.")),
      coneBox,
      defaults,
    ],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (v) => {
      if (v !== "ok") return true;
      const n = (i: HTMLInputElement) => Number(i.value);
      if (!Number.isFinite(n(radius)) || n(radius) < 0 || n(radius) > LIGHT_RADIUS_MAX) { await alertDialog("Light Properties", `Please enter a number between 0 and ${LIGHT_RADIUS_MAX}.`); return false; }
      if (!Number.isFinite(n(bright)) || n(bright) < LIGHT_BRIGHT_MIN || n(bright) > LIGHT_BRIGHT_MAX) { await alertDialog("Light Properties", `Please enter a number between ${LIGHT_BRIGHT_MIN} and ${LIGHT_BRIGHT_MAX}.`); return false; }
      const pos = (i: HTMLInputElement) => Math.max(0, Number(i.value) || 0);
      const c = colour.value;
      out = {
        radius: pos(radius), heightOffset: Number(height.value) || 0, glowMode: Number(mode.value), glowRadius: pos(glowRadius),
        coneLength: pos(coneLen), coneRimRadius: pos(coneRim), coneBaseRadius: pos(coneBase), bright: n(bright), aimOffset: Number(aim.value) || 0,
        r: parseInt(c.slice(1, 3), 16) / 255, g: parseInt(c.slice(3, 5), 16) / 255, b: parseInt(c.slice(5, 7), 16) / 255,
      };
      return true;
    },
  });
  return r === "ok" ? out : null;
}

export interface ObjectDialogOptions {
  fields: ObjectFields;
  /** The model the object shows ("" for a plain box) and its top-crush cab ("" for none). */
  modelName: string;
  crushName: string;
  /** Positions shown in SIT units (half an ipos). */
  sitUnits: boolean;
  /** Reset's resting height: the model's basez as a height above ground. */
  restingHeight: number;
  /** ApplySettings: show the fields on the object. */
  preview: (f: ObjectFields) => void;
  /** The light pool's preview while Light Properties is open or after it closed. */
  previewLight: (l: TraxxLight, isLight: boolean) => void;
  /** Pick a WAV file for a sound. */
  pickWav: () => Promise<File | null>;
  /** The cab "..." button: choose a keyframed model; resolves with its title, or null. */
  chooseCab: () => Promise<string | null>;
}

export interface ObjectDialogResult { fields: ObjectFields; wavs: { cont: Uint8Array | null; impact: Uint8Array | null }; crushName: string }

/* ObjectNudge.h steps (thousandths of an ipos, hundredths of a step, hundredths of a degree). */
const nudgeMove = (shift: boolean, ctrl: boolean, sit: boolean) => (shift && ctrl ? (sit ? 200 : 100) : shift ? 100000 : 10000);
const nudgeRaise = (shift: boolean, ctrl: boolean) => (shift && ctrl ? 10 : shift ? 500 : 100);
const nudgeTurn = (shift: boolean, ctrl: boolean) => (shift && ctrl ? 1 : shift ? 1000 : ctrl ? 10 : 100);
const nudgeTilt = (shift: boolean, ctrl: boolean) => (shift && ctrl ? 1 : shift ? 10 : 100);

export async function objectPropertiesDialog(o: ObjectDialogOptions): Promise<ObjectDialogResult | null> {
  const f: ObjectFields = structuredClone(o.fields);
  const show = (v: number) => (o.sitUnits ? v / 2 : v);
  const unshow = (v: number) => (o.sitUnits ? v * 2 : v);
  const wavs: ObjectDialogResult["wavs"] = { cont: null, impact: null };
  let crushName = o.crushName;
  let filling = true;

  const type = stop(el("select", {}, ...OBJECT_TYPE_NAMES.map((n, i) => el("option", { value: i }, n)))) as HTMLSelectElement;
  type.value = String(f.typeIndex);
  const checkpoint = num(f.checkpoint, 1, { min: 0 });
  const vx = num(f.vx, 1), vy = num(f.vy, 1);
  const x = num(Number(show(f.fx).toFixed(3)), 0.1, { min: 0 }), y = num(Number(show(f.fy).toFixed(3)), 0.1, { min: 0 });
  const sizeW = num(f.sizeW, 1, { min: 0 }), sizeH = num(f.sizeH, 1, { min: 0 }), sizeD = num(f.sizeD, 1, { min: 0 });
  const mass = num(f.mass, 10);
  const z = num(f.fz, 0.1), angle = num(f.angle, 0.01), elev = num(f.elev, 0.01), tilt = num(f.tilt, 0.01);
  const levels = ["Sparse", "Normal", "Complex"].map((_, i) => el("input", { type: "radio", name: "obj-level", value: i, checked: f.level === i }) as HTMLInputElement);
  const soundCont = el("input", { type: "text", readonly: true, value: f.soundCont, class: "obj-sound" }) as HTMLInputElement;
  const soundImpact = el("input", { type: "text", readonly: true, value: f.soundImpact, class: "obj-sound" }) as HTMLInputElement;
  const crushOff = f.crush.map((v) => num(v, "any"));
  const crushText = el("input", { type: "text", readonly: true, value: crushName || "no ani model!" }) as HTMLInputElement;

  const soundButtons = (continuous: boolean, box: HTMLInputElement) => [
    el("button", { type: "button", class: "mini", title: "Stock sounds", onclick: async () => {
      const name = await stockSoundsDialog(continuous, box.value);
      if (name) { box.value = name; if (continuous) wavs.cont = null; else wavs.impact = null; }
    } }, "#"),
    el("button", { type: "button", class: "mini", title: "Load a WAV file", onclick: async () => {
      const file = await o.pickWav();
      if (!file) return;
      box.value = file.name.replace(/\.[^.]*$/, "").toUpperCase();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (continuous) wavs.cont = bytes; else wavs.impact = bytes;
    } }, "..."),
  ];
  const soundSel = [...soundButtons(true, soundCont), ...soundButtons(false, soundImpact)];
  const lightButton = el("button", { type: "button", onclick: async () => {
    const l = await lightPropertiesDialog(f.light, (p) => o.previewLight(p, true));
    if (l) f.light = l;
    o.previewLight(f.light, Number(type.value) === TYPEIDX_LIGHT);
  } }, "Light...");
  const cabButton = el("button", { type: "button", class: "mini", onclick: async () => {
    const t = await o.chooseCab();
    if (t) { crushName = t; crushText.value = t; }
  } }, "...");

  const sizeRow = row("Size", sizeW, "x", sizeH, "x", sizeD);
  const modelRow = row(o.modelName ? "Model" : "", el("input", { type: "text", readonly: true, value: o.modelName }));
  const modelLabel = modelRow.querySelector(".fld")!;
  if (o.modelName) sizeRow.hidden = true; else modelRow.hidden = true;

  /* OnSelChangeType. */
  const typeChanged = () => {
    const t = Number(type.value);
    checkpoint.disabled = t !== CHECKPOINT;
    vx.disabled = vy.disabled = !(t === TYPE_TRAIN || t === TYPE_MOVING);
    lightButton.disabled = t !== TYPEIDX_LIGHT;
    const fixed = t === TYPEIDX_RAMP || t === TYPEIDX_CRUSH;
    if (fixed) levels[0]!.checked = true;
    levels.forEach((r) => { r.disabled = fixed; });
    soundSel.forEach((b) => { b.disabled = fixed; });
    const crush = t === TYPEIDX_CRUSH;
    crushOff.forEach((i) => { i.disabled = !crush; });
    cabButton.disabled = !crush;
    crushText.disabled = !crush;
    modelLabel.textContent = o.modelName ? (crush ? "Base" : "Model") : "";
    o.previewLight(f.light, t === TYPEIDX_LIGHT);
  };
  type.addEventListener("change", typeChanged);

  /* ApplySettings on every change of a field it reads; an empty box keeps the last value. */
  const read = () => {
    const n = (i: HTMLInputElement, fallback: number) => (i.value.trim() && Number.isFinite(Number(i.value)) ? Number(i.value) : fallback);
    f.fx = Math.fround(Math.max(0, unshow(n(x, show(f.fx)))));
    f.fy = Math.fround(Math.max(0, unshow(n(y, show(f.fy)))));
    f.fz = Math.fround(n(z, f.fz));
    f.angle = Math.fround(n(angle, f.angle));
    f.elev = Math.fround(n(elev, f.elev));
    f.tilt = Math.fround(n(tilt, f.tilt));
    f.sizeW = Math.max(0, Math.trunc(n(sizeW, f.sizeW)));
    f.sizeH = Math.max(0, Math.trunc(n(sizeH, f.sizeH)));
    f.sizeD = Math.max(0, Math.trunc(n(sizeD, f.sizeD)));
  };
  const live = () => { if (!filling) { read(); o.preview(f); } };
  for (const i of [x, y, z, angle, elev, tilt, sizeW, sizeH, sizeD]) i.addEventListener("input", live);

  /* NudgeKey: D/C, F/V, S/X, R/T, G/B, H/N with Traxx's steps. */
  const nudge = (e: KeyboardEvent) => {
    if (e.altKey || ((e.ctrlKey || e.metaKey) && !e.shiftKey)) return;
    if ((e.target as HTMLElement).matches("input[type=text], select")) return;
    const key = e.key.toUpperCase();
    const map: Record<string, [HTMLInputElement, number]> = { D: [x, 1], C: [x, -1], F: [y, 1], V: [y, -1], S: [z, 1], X: [z, -1], R: [angle, 1], T: [angle, -1], G: [elev, 1], B: [elev, -1], H: [tilt, 1], N: [tilt, -1] };
    const hit = map[key];
    if (!hit || hit[0].disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const [field, sign] = hit;
    const shift = e.shiftKey, ctrl = e.ctrlKey || e.metaKey;
    read();
    if (field === x || field === y) {
      const k = field === x ? "fx" : "fy";
      f[k] = Math.fround(Math.max(0, f[k] + (sign * nudgeMove(shift, ctrl, o.sitUnits)) / 1000));
      field.value = show(f[k]).toFixed(3);
    } else if (field === z) {
      f.fz = Math.fround(f.fz + (sign * nudgeRaise(shift, ctrl)) / 100);
      z.value = String(f.fz);
    } else {
      const k = field === angle ? "angle" : field === elev ? "elev" : "tilt";
      let a = f[k] + (sign * (k === "angle" ? nudgeTurn(shift, ctrl) : nudgeTilt(shift, ctrl))) / 100;
      while (a < 0) a += 360;
      while (a >= 360) a -= 360;
      f[k] = Math.fround(a);
      field.value = String(f[k]);
    }
    live();
  };

  /* OnBnClickedReset: mass and the angles to 0, the height to the model's resting height. */
  const reset = el("button", { type: "button", onclick: () => {
    mass.value = "0"; angle.value = "0"; elev.value = "0"; tilt.value = "0";
    z.value = String(o.restingHeight);
    live();
  } }, "Reset");

  const body = el("div", { class: "obj-props" },
    el("div", { class: "opt-row" }, el("span", { class: "fld" }, "Type"), type, el("span", {}, "vx"), vx, el("span", {}, "vy"), vy),
    modelRow, sizeRow,
    row(o.sitUnits ? "X (SIT)" : "X", x), row(o.sitUnits ? "Y (SIT)" : "Y", y),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Settings"),
      row("Mass (Lbs)", mass),
      row("Above ground", z),
      row("Orientation°", angle),
      row("Pitch / Heading°", elev, tilt)),
    el("div", { class: "obj-two" },
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Sounds"),
        row("Cont.", soundCont, soundSel[0]!, soundSel[1]!),
        row("Impact", soundImpact, soundSel[2]!, soundSel[3]!)),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Level"),
        ...levels.map((r, i) => el("label", { class: "opt-check" }, r, ["Sparse", "Normal", "Complex"][i]!)))),
    row("Sequence", checkpoint, lightButton),
    row("Cab offset", ...crushOff),
    row("Cab", crushText, cabButton),
    reset);
  body.addEventListener("keydown", nudge, true);
  typeChanged();
  filling = false;

  const r = await openDialog({
    title: "Object Properties",
    className: "live",
    body,
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  if (r !== "ok") return null;
  read();
  const int = (i: HTMLInputElement, fallback = 0) => (i.value.trim() ? Math.trunc(Number(i.value)) || 0 : fallback);
  f.typeIndex = Number(type.value);
  f.checkpoint = int(checkpoint);
  f.vx = int(vx);
  f.vy = int(vy);
  f.mass = int(mass);
  f.level = Math.max(0, levels.findIndex((l) => l.checked));
  f.crush = crushOff.map((i) => Math.fround(Number(i.value) || 0)) as [number, number, number];
  f.soundCont = soundCont.value;
  f.soundImpact = soundImpact.value;
  return { fields: f, wavs, crushName };
}

/**
  IDD_GROUP_PROPERTIES. Blank fields are where the objects differ; `preview` gets the look
  fields as they read on every edit. Resolves with what the author left, or null.
*/
export async function groupPropertiesDialog(n: number, start: GroupFields, pickWav: () => Promise<File | null>, preview: (text: string[]) => void): Promise<GroupResult | null> {
  const type = stop(el("select", {}, el("option", { value: -1 }, ""), ...OBJECT_TYPE_NAMES.map((t, i) => el("option", { value: i }, t)))) as HTMLSelectElement;
  type.value = String(start.typeIndex);
  const fields = start.text.map((t) => stop(el("input", { type: "text", value: t, class: "spin", inputmode: "decimal" })) as HTMLInputElement);
  const size = el("fieldset", { class: "opt-group" }, el("legend", {}, "Size  W x L x H  (plain boxes only)"), el("div", { class: "opt-row" }, fields[GP_SIZEW]!, "x", fields[GP_SIZEL]!, "x", fields[GP_SIZEH]!));
  size.disabled = !start.anyPlain;
  const wavs: GroupResult["wavs"] = { cont: null, impact: null };
  const sound = (continuous: boolean, value: string) => {
    const box = el("input", { type: "text", readonly: true, value, class: "obj-sound" }) as HTMLInputElement;
    const sel = el("button", { type: "button", class: "mini", onclick: async () => {
      const name = await stockSoundsDialog(continuous, box.value);
      if (name) { box.value = name; if (continuous) wavs.cont = null; else wavs.impact = null; }
    } }, "#");
    const load = el("button", { type: "button", class: "mini", onclick: async () => {
      const file = await pickWav();
      if (!file) return;
      box.value = file.name.replace(/\.[^.]*$/, "").toUpperCase();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (continuous) wavs.cont = bytes; else wavs.impact = bytes;
    } }, "...");
    return { box, nodes: [box, sel, load] };
  };
  const cont = sound(true, start.soundCont), impact = sound(false, start.soundImpact);
  const levels = ["Sparse", "Normal", "Complex"].map((_, i) => el("input", { type: "radio", name: "grp-level", value: i, checked: start.level === i }) as HTMLInputElement);
  const look = () => preview(fields.map((f) => f.value.trim()));
  for (let f = GP_HEIGHT; f <= GP_SIZEH; f++) fields[f]!.addEventListener("input", look);
  const body = el("div", { class: "obj-props" },
    row("Type", type),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Settings"),
      row("Mass (Lbs)", fields[GP_MASS]!), row("Above ground", fields[GP_HEIGHT]!), row("Orientation (deg)", fields[GP_ANGLE]!),
      row("Pitch (deg)", fields[GP_PITCH]!), row("Tilt (deg)", fields[GP_TILT]!)),
    size,
    el("div", { class: "obj-two" },
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Sounds"), row("Cont.", ...cont.nodes), row("Impact", ...impact.nodes)),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Level"), ...levels.map((r, i) => el("label", { class: "opt-check" }, r, ["Sparse", "Normal", "Complex"][i]!)))),
    el("p", { class: "hint" }, "A blank field is one where the objects differ. It is left as it is unless you fill it in."));
  const r = await openDialog({
    title: `Group Properties (${n} objects)`,
    className: "live",
    body,
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (v) => {
      if (v !== "ok") return true;
      for (let f = 0; f < fields.length; f++) {
        const t = fields[f]!.value.trim();
        if (!t || t === start.text[f] || parses(f, t)) continue;
        await alertDialog("Group Properties", `${GP_NAMES[f]}: "${t}" is not a ${f === GP_MASS || f >= GP_SIZEW ? "whole " : ""}number.`);
        fields[f]!.focus();
        fields[f]!.select();
        return false;
      }
      return true;
    },
  });
  if (r !== "ok") return null;
  return {
    start,
    typeIndex: Number(type.value),
    level: levels.findIndex((l) => l.checked),
    soundCont: cont.box.value,
    soundImpact: impact.box.value,
    text: fields.map((f) => f.value.trim()),
    wavs,
  };
}
