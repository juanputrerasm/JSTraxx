/*
  Object Properties (IDD_OBJECT_PROPERTIES), Light Properties (IDD_LIGHT_PROPERTIES) and the
  stock sound list (StockSoundsDlg), from Traxx/ObjectPropertiesDlg.cpp, LightPropertiesDlg.cpp
  and StockSoundsDlg.cpp. Fog Properties is in fog-dialog.ts.

  Object Properties shows its changes on the object as they are made (ApplySettings), through
  `preview`. Traxx 1.8.2: it is a modeless window with Apply (objectPropertiesWindow); its owner
  applies, restores on Cancel and keeps the view's other objects inert while it is up.
*/
import { el } from "../../shared/dom.ts";
import { alertDialog, openDialog, openModeless } from "../shell/dialog.ts";
import { OBJECT_TYPE_NAMES, TYPEIDX_CRUSH, TYPEIDX_RAMP, TYPE_MOVING, TYPE_TRAIN, CHECKPOINT } from "../../core/edit/objects.ts";
import type { ObjectFields } from "../../core/edit/object-properties.ts";
import { checkpointRolePreview, dlgItemInt, type ObjectRaceContext } from "../../core/edit/race-edit.ts";
import { CPX_SPLIT_ANY, CPX_SPLIT_LANE, CPX_SPLIT_NONE, RACERULES_NONE, RACERULES_RACE } from "../../core/traxx/race-types.ts";
import { STOCK_CONT_SOUNDS, STOCK_SOUNDS } from "../../core/traxx/stock-data.ts";
import { traxxLightDefaults, type TraxxFog, type TraxxLight } from "../../core/traxx/sit.ts";
import type { FogBox } from "../../core/edit/fog-properties.ts";
import { fogPropertiesDialog } from "./fog-dialog.ts";
import { LIGHT_RADIUS_MAX } from "../../core/view/light-pool.ts";
import { ENGINELIGHT_RADIUS_MIN, lightPropertiesWarning, lightRadiusNeedsRaise, type LightGuideContext } from "../../core/traxx/light-props.ts";
import { asOneOrig, GP_ASONE_LABELS, GP_HEIGHT, GP_MASS, GP_NAMES, GP_SIZEH, GP_SIZEL, GP_SIZEW, parses, type GroupFields, type GroupResult } from "../../core/edit/group-properties.ts";

const TYPEIDX_LIGHT = 12;
/** TYPEIDX_FOG (ObjectPropertiesDlg.h). */
const TYPEIDX_FOG = 14;
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

/**
  IDD_LIGHT_PROPERTIES; `preview` shows the pool, glow and cone as the fields change (Traxx 1.8.0:
  every field the view draws, the glow radius, cone radii, colour and allWx included). `ctx` is
  GetLightGuideContext's, for the warning line. Resolves with the light, or null.
*/
export async function lightPropertiesDialog(light: TraxxLight, preview: (l: TraxxLight) => void, ctx: LightGuideContext): Promise<TraxxLight | null> {
  const clampBright = (v: number) => Math.min(LIGHT_BRIGHT_MAX, Math.max(LIGHT_BRIGHT_MIN, v));
  // OnInitDialog (Traxx 1.8.0): a file radius under 1 (which the engine cannot draw) becomes 1, and the warning line says so.
  const radiusFixed = lightRadiusNeedsRaise(light);
  const radius = num(radiusFixed ? ENGINELIGHT_RADIUS_MIN : light.radius), bright = num(clampBright(light.bright)), height = num(light.heightOffset), aim = num(light.aimOffset);
  const glowRadius = num(light.glowRadius), coneLen = num(light.coneLength), coneRim = num(light.coneRimRadius), coneBase = num(light.coneBaseRadius);
  const toHex = (v: number) => Math.max(0, Math.min(255, Math.trunc(v * 255 + 0.5))).toString(16).padStart(2, "0");
  const colour = el("input", { type: "color", value: `#${toHex(light.r)}${toHex(light.g)}${toHex(light.b)}` }) as HTMLInputElement;
  const mode = stop(el("select", {}, ...["0 - none (still lights)", "1 - glow sprite", "2 - glow sprite + cone"].map((t, i) => el("option", { value: i }, t)))) as HTMLSelectElement;
  mode.value = String(light.glowMode >= 0 && light.glowMode <= 2 ? light.glowMode : 0);
  // IDC_LIGHTALLWX (Traxx 1.8.0, a114974): enabled only while there is a glow; the value is kept and saved while greyed.
  const allWx = el("input", { type: "checkbox", checked: light.allWx !== 0 }) as HTMLInputElement;
  const allWxRow = el("label", { class: "opt-row" }, allWx, "Glow and cone in all weathers (stadium lights)");
  // IDC_LIGHTWARN: the one warning line.
  const warn = el("p", { class: "hint" }, "Radius = wide.  Height = free.");
  const coneBox = el("fieldset", { class: "opt-group" }, el("legend", {}, "Cone"),
    row("Length (ft)", coneLen), row("Radius at far end (ft)", coneRim), row("Width at source (ft)", coneBase));
  const enable = () => {
    const m = Number(mode.value);
    coneBox.disabled = m !== 2;
    glowRadius.disabled = m === 0;
    allWx.disabled = m === 0;
  };
  // ReadDlgFloat: an empty or half-typed field keeps the last value; clamped for the preview.
  const read = (i: HTMLInputElement, fallback: number, lo: number, hi: number) => {
    const t = i.value.trim();
    if (!t || !Number.isFinite(Number(t))) return fallback;
    return Math.min(hi, Math.max(lo, Number(t)));
  };
  /* UpdateWarning (Traxx 1.8.0). */
  const updateWarning = () => {
    const t = radius.value.trim();
    const rad = t === "" ? (radiusFixed ? ENGINELIGHT_RADIUS_MIN : light.radius) : Number.parseFloat(t) || 0;
    const m = Number(mode.value);
    warn.textContent = lightPropertiesWarning(rad, {
      glowMode: m,
      coneLength: read(coneLen, light.coneLength, 0, LIGHT_RADIUS_MAX),
      coneRimRadius: read(coneRim, light.coneRimRadius, 0, LIGHT_RADIUS_MAX),
      coneBaseRadius: read(coneBase, light.coneBaseRadius, 0, LIGHT_RADIUS_MAX),
    }, ctx, radiusFixed);
  };
  const fromHex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255];
  const previewNow = () => { updateWarning(); const [cr, cg, cb] = fromHex(colour.value); preview({
    ...light,
    r: cr, g: cg, b: cb,
    allWx: allWx.checked ? 1 : 0,
    glowRadius: read(glowRadius, light.glowRadius, 0, LIGHT_RADIUS_MAX),
    coneRimRadius: read(coneRim, light.coneRimRadius, 0, LIGHT_RADIUS_MAX),
    coneBaseRadius: read(coneBase, light.coneBaseRadius, 0, LIGHT_RADIUS_MAX),
    radius: read(radius, light.radius, 0, LIGHT_RADIUS_MAX),
    bright: read(bright, light.bright, LIGHT_BRIGHT_MIN, LIGHT_BRIGHT_MAX),
    heightOffset: read(height, light.heightOffset, -LIGHT_RADIUS_MAX, LIGHT_RADIUS_MAX),
    coneLength: read(coneLen, light.coneLength, 0, LIGHT_RADIUS_MAX),
    aimOffset: read(aim, light.aimOffset, -LIGHT_RADIUS_MAX, LIGHT_RADIUS_MAX),
    glowMode: Number(mode.value),
  }); };
  for (const i of [radius, bright, height, coneLen, aim, glowRadius, coneRim, coneBase]) i.addEventListener("input", previewNow);
  colour.addEventListener("input", previewNow);
  allWx.addEventListener("change", previewNow);
  mode.addEventListener("change", () => { enable(); previewNow(); });
  const defaults = el("button", { type: "button", onclick: () => {
    const d = traxxLightDefaults();
    radius.value = String(d.radius); height.value = String(d.heightOffset); glowRadius.value = String(d.glowRadius);
    coneLen.value = String(d.coneLength); coneRim.value = String(d.coneRimRadius); coneBase.value = String(d.coneBaseRadius);
    bright.value = String(d.bright); aim.value = String(d.aimOffset); mode.value = String(d.glowMode); colour.value = "#ffffff";
    allWx.checked = d.allWx !== 0;
    enable();
    previewNow();
  } }, "Defaults");
  enable();
  updateWarning();
  // ...and a radius just raised from under 1 is shown at once (the view still holds the file's).
  if (radiusFixed) previewNow();
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
        warn),
      coneBox,
      allWxRow,
      defaults,
    ],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (v) => {
      if (v !== "ok") return true;
      const n = (i: HTMLInputElement) => Number(i.value);
      // DDV 1..4095 (Traxx 1.8.0): a radius under 1 gets no pool in the game (older games divide by zero).
      if (!Number.isFinite(n(radius)) || n(radius) < ENGINELIGHT_RADIUS_MIN || n(radius) > LIGHT_RADIUS_MAX) { await alertDialog("Light Properties", `Please enter a number between ${ENGINELIGHT_RADIUS_MIN} and ${LIGHT_RADIUS_MAX}.`); return false; }
      if (!Number.isFinite(n(bright)) || n(bright) < LIGHT_BRIGHT_MIN || n(bright) > LIGHT_BRIGHT_MAX) { await alertDialog("Light Properties", `Please enter a number between ${LIGHT_BRIGHT_MIN} and ${LIGHT_BRIGHT_MAX}.`); return false; }
      const pos = (i: HTMLInputElement) => Math.max(0, Number(i.value) || 0);
      const c = colour.value;
      out = {
        // The engine's thirteenth 'L' field: 0 / 1, saved even while greyed out at glow mode 0.
        allWx: allWx.checked ? 1 : 0,
        radius: n(radius), heightOffset: Number(height.value) || 0, glowMode: Number(mode.value), glowRadius: pos(glowRadius),
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
  /** GetLightGuideContext (Traxx 1.8.0): what Light Properties' warning line reads. */
  lightContext: LightGuideContext;
  /** The fog volume's preview (RefreshFogPreview): the working copy, and whether the Type is Fog. */
  previewFog: (fog: TraxxFog, isFog: boolean) => void;
  /** The box as the fields have it now (its Size and height are applied live), for Fog Properties. */
  fogBox: () => FogBox;
  /** Pick a WAV file for a sound. */
  pickWav: () => Promise<File | null>;
  /** The cab "..." button: choose a keyframed model; resolves with its title, or null. */
  chooseCab: () => Promise<string | null>;
  /**
    ObjectDialogContext (Traxx 1.8.2): the track's race rules, the other checkpoints' numbers and the
    Main route tick, read at open and again after each Apply (LoadFromBox).
  */
  raceContext: () => ObjectRaceContext;
}

export interface ObjectDialogResult { fields: ObjectFields; wavs: { cont: Uint8Array | null; impact: Uint8Array | null }; crushName: string }

/* ObjectNudge.h steps (thousandths of an ipos, hundredths of a step, hundredths of a degree). */
const nudgeMove = (shift: boolean, ctrl: boolean, sit: boolean) => (shift && ctrl ? (sit ? 200 : 100) : shift ? 100000 : 10000);
const nudgeRaise = (shift: boolean, ctrl: boolean) => (shift && ctrl ? 10 : shift ? 500 : 100);
const nudgeTurn = (shift: boolean, ctrl: boolean) => (shift && ctrl ? 1 : shift ? 1000 : ctrl ? 10 : 100);
const nudgeTilt = (shift: boolean, ctrl: boolean) => (shift && ctrl ? 1 : shift ? 10 : 100);

/** What the modeless Object Properties window asks of its owner (CTraxxView's ObjectDialog* half). */
export interface ObjectWindowHooks {
  /**
    ObjectDialogApply / ApplyObjectProperties: the fields onto the object. Resolves with the fields
    loaded again from the object as it now is (a checkpoint renumber or a cap may have changed
    them; LoadFromBox), or null when its object is gone (the window then goes without a word).
  */
  apply(result: ObjectDialogResult): Promise<ObjectFields | null> | ObjectFields | null;
  /** Cancel's RestoreOriginal: the live fields (place, angles, size) back as the last load had them. */
  restore(): void;
  /** The window is gone (OK, Cancel or abandoned). */
  closed(): void;
}

/** The open window (CTraxxView::objdlg). */
export interface ObjectPropertiesWindow {
  /** OnObjectProperties with the window up: it comes forward. */
  raise(): void;
  /**
    RefreshFromBox: the view moved the object (a drag, a turn, a nudge key, the Models window): the
    place, height, angle and size fields are written again, all but the box being typed in. Those
    values are also what Cancel puts back now.
  */
  refreshFromBox(fields: ObjectFields, modelName: string, crushName: string, restingHeight: number): void;
  /**
    ObjectDialogClose: OK (Apply first; resolves false, the window staying, when Apply is refused;
    modeSwitch adds "The edit to this object is being cancelled.") or Cancel.
  */
  close(ok: boolean, modeSwitch?: boolean): Promise<boolean>;
  /** ObjectDialogAbandon: the window goes without a word (the document is closing, or its object is gone). */
  abandon(): void;
}

/** The Fog-with-model refusal (ReadFields). */
export const OBJECT_FOG_MODEL_REFUSAL = "Fog objects are model-less boxes. To take the model off, set this object to Ramp first (that clears it), then to Fog - or place a new box and set that to Fog.";

/*
  IDD_OBJECT_PROPERTIES, modeless (Traxx 1.8.2, 75cf23a, 90a876c: ObjectPropertiesDlg.cpp,
  TraxxViewEdit.cpp OnObjectProperties .. ObjectDialogRefresh). Live preview as you type (an empty
  box keeps the last value); Apply writes the fields onto the object and loads them again; OK is
  Apply and close (a refused Apply keeps the window); Cancel, Escape and the close box put the
  live place, angles and size back to the last load (what Apply committed stays). Only edits
  (typing, a list choice, a level, Reset, a picked sound, Light..., Fog..., the cab) give Apply
  something to write; nothing edited marks nothing. Light..., Fog..., the sound pickers and the
  cab picker are modal over it. The race rows (Split, Lane, Role, Main route; IDC_CPSPLIT ..
  IDC_CPMAIN under Reset) show only with race rules on (UpdateRaceRows).
*/
export function objectPropertiesWindow(o: ObjectDialogOptions, hooks: ObjectWindowHooks): ObjectPropertiesWindow {
  let f: ObjectFields = structuredClone(o.fields);
  const show = (v: number) => (o.sitUnits ? v / 2 : v);
  const unshow = (v: number) => (o.sitUnits ? v * 2 : v);
  let wavs: ObjectDialogResult["wavs"] = { cont: null, impact: null };
  let crushName = o.crushName;
  let modelName = o.modelName;
  let restingHeight = o.restingHeight;
  let filling = true;
  /* m_dirty: something for Apply to write; m_livedirty: a live field (place, angles, size) was edited. */
  let dirty = false, liveDirty = false, closing = false;

  const type = stop(el("select", {}, ...OBJECT_TYPE_NAMES.map((n, i) => el("option", { value: i }, n)))) as HTMLSelectElement;
  const checkpoint = num(f.checkpoint, 1, { min: 0 });
  const vx = num(f.vx, 1), vy = num(f.vy, 1);
  const x = num(0, 0.1, { min: 0 }), y = num(0, 0.1, { min: 0 });
  const sizeW = num(f.sizeW, 1, { min: 0 }), sizeH = num(f.sizeH, 1, { min: 0 }), sizeD = num(f.sizeD, 1, { min: 0 });
  const mass = num(f.mass, 10);
  const z = num(f.fz, 0.1), angle = num(f.angle, 0.01), elev = num(f.elev, 0.01), tilt = num(f.tilt, 0.01);
  const levels = ["Sparse", "Normal", "Complex"].map((_, i) => el("input", { type: "radio", name: "obj-level", value: i }) as HTMLInputElement);
  const soundCont = el("input", { type: "text", readonly: true, class: "obj-sound" }) as HTMLInputElement;
  const soundImpact = el("input", { type: "text", readonly: true, class: "obj-sound" }) as HTMLInputElement;
  const crushOff = f.crush.map((v) => num(v, "any"));
  const crushText = el("input", { type: "text", readonly: true }) as HTMLInputElement;
  const edited = () => { if (!filling) dirty = true; };

  const soundButtons = (continuous: boolean, box: HTMLInputElement) => [
    el("button", { type: "button", class: "mini", title: "Stock sounds", onclick: async () => {
      const name = await stockSoundsDialog(continuous, box.value);
      if (name) { box.value = name; if (continuous) wavs.cont = null; else wavs.impact = null; edited(); }
    } }, "#"),
    el("button", { type: "button", class: "mini", title: "Load a WAV file", onclick: async () => {
      const file = await o.pickWav();
      if (!file) return;
      box.value = file.name.replace(/\.[^.]*$/, "").toUpperCase();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (continuous) wavs.cont = bytes; else wavs.impact = bytes;
      edited();
    } }, "..."),
  ];
  const soundSel = [...soundButtons(true, soundCont), ...soundButtons(false, soundImpact)];
  const lightButton = el("button", { type: "button", onclick: async () => {
    const l = await lightPropertiesDialog(f.light, (p) => o.previewLight(p, true), o.lightContext);
    if (l) { f.light = l; edited(); }
    o.previewLight(f.light, Number(type.value) === TYPEIDX_LIGHT);
  } }, "Light...");
  /* OnFogProps: the dialog reads the size and height off the box and drives the preview. */
  const fogButton = el("button", { type: "button", onclick: async () => {
    const fog = await fogPropertiesDialog(f.fog, o.fogBox(), (p) => o.previewFog(p, true));
    if (fog) { f.fog = fog; edited(); }
    // Back onto this dialog's working copy either way: the new values after OK, the old after Cancel.
    o.previewFog(f.fog, Number(type.value) === TYPEIDX_FOG);
  } }, "Fog...");
  const cabButton = el("button", { type: "button", class: "mini", onclick: async () => {
    const t = await o.chooseCab();
    if (t) { crushName = t; crushText.value = t; edited(); }
  } }, "...");

  const sizeRow = row("Size", sizeW, "x", sizeH, "x", sizeD);
  const modelInput = el("input", { type: "text", readonly: true }) as HTMLInputElement;
  const modelRow = row("", modelInput);
  const modelLabel = modelRow.querySelector(".fld")!;
  /* ShowModelOrSize: the model row for a model box, the size for a plain one. */
  const showModelOrSize = () => {
    modelInput.value = modelName;
    sizeRow.hidden = Boolean(modelName);
    modelRow.hidden = !modelName;
    crushText.value = crushName || "no ani model!";
  };

  /* OnSelChangeType. */
  const typeChanged = () => {
    const t = Number(type.value);
    checkpoint.disabled = t !== CHECKPOINT;
    vx.disabled = vy.disabled = !(t === TYPE_TRAIN || t === TYPE_MOVING);
    lightButton.disabled = t !== TYPEIDX_LIGHT;
    fogButton.disabled = t !== TYPEIDX_FOG;
    const fixed = t === TYPEIDX_RAMP || t === TYPEIDX_CRUSH;
    if (fixed) levels[0]!.checked = true;
    levels.forEach((r) => { r.disabled = fixed; });
    soundSel.forEach((b) => { b.disabled = fixed; });
    const crush = t === TYPEIDX_CRUSH;
    crushOff.forEach((i) => { i.disabled = !crush; });
    cabButton.disabled = !crush;
    crushText.disabled = !crush;
    modelLabel.textContent = modelName ? (crush ? "Base" : "Model") : "";
    o.previewLight(f.light, t === TYPEIDX_LIGHT);
    o.previewFog(f.fog, t === TYPEIDX_FOG);
  };
  type.addEventListener("change", typeChanged);

  /* LoadFromBox: every field from the working copy. */
  const fillAll = () => {
    filling = true;
    type.value = String(f.typeIndex);
    checkpoint.value = String(f.checkpoint);
    vx.value = String(f.vx); vy.value = String(f.vy);
    x.value = String(Number(show(f.fx).toFixed(3))); y.value = String(Number(show(f.fy).toFixed(3)));
    sizeW.value = String(f.sizeW); sizeH.value = String(f.sizeH); sizeD.value = String(f.sizeD);
    mass.value = String(f.mass);
    z.value = String(f.fz); angle.value = String(f.angle); elev.value = String(f.elev); tilt.value = String(f.tilt);
    levels.forEach((r, i) => { r.checked = f.level === i; });
    soundCont.value = f.soundCont; soundImpact.value = f.soundImpact;
    crushOff.forEach((i, k) => { i.value = String(f.crush[k]); });
    // LoadFromBox's race fields, after ObjectDialogContext.
    race = o.raceContext();
    split.value = String(Math.min(f.cpSplit, split.options.length - 1));
    lane.value = String(f.cpLane);
    main.checked = race.main;
    mainEdit = false;
    showModelOrSize();
    typeChanged();
    updateRaceRows();
    filling = false;
  };

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
  const liveFields = [x, y, z, angle, elev, tilt, sizeW, sizeH, sizeD];
  const live = () => { if (!filling) { liveDirty = true; read(); o.preview(f); } };
  for (const i of liveFields) i.addEventListener("input", live);

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
    dirty = true;
    live();
  };

  /* OnBnClickedReset: mass and the angles to 0, the height to the model's resting height. */
  const reset = el("button", { type: "button", onclick: () => {
    mass.value = "0"; angle.value = "0"; elev.value = "0"; tilt.value = "0";
    z.value = String(restingHeight);
    dirty = true;
    live();
  } }, "Reset");
  /*
    The race rows (Traxx 1.8.2, IDC_CPSPLIT, IDC_CPLANE, IDC_CPROLE, IDC_CPMAIN at 246..293 DU): hidden
    unless the track has race rules. Split lists None, Any copy and (not in RACE: a circuit has no
    lanes) Per lane; Lane 1 / 2; the Role, read-only, says what Apply would make of the Sequence typed.
  */
  let race = o.raceContext();
  /* m_cpmainedit: the Main route tick was clicked since the last load. */
  let mainEdit = false;
  const split = stop(el("select", {}, ...["None", "Any copy", ...(race.mode !== RACERULES_RACE ? ["Per lane"] : [])].map((n, i) => el("option", { value: i }, n)))) as HTMLSelectElement;
  const lane = stop(el("select", {}, el("option", { value: 0 }, "1"), el("option", { value: 1 }, "2"))) as HTMLSelectElement;
  const role = el("span", { class: "tex-sunken obj-role" });
  const main = el("input", { type: "checkbox" }) as HTMLInputElement;
  const splitRow = row("Split", split), laneRow = row("Lane", lane), roleRow = el("div", { class: "opt-row" }, el("span", { class: "fld" }, "Role"), role);
  const mainRow = el("label", { class: "opt-check" }, main, "Main route (AI follows this one)");
  const raceRows = el("div", { class: "obj-race-rows" }, splitRow, laneRow, roleRow, mainRow);
  const disable = (r: HTMLElement, off: boolean) => r.classList.toggle("disabled", off);
  /* UpdateRaceRows: shown with the rules on (no Lane row in RACE); live for a checkpoint, the Lane for a per-lane split. */
  const updateRaceRows = () => {
    const on = race.mode !== RACERULES_NONE;
    raceRows.hidden = !on;
    laneRow.hidden = race.mode === RACERULES_RACE;
    if (!on) return;
    const cp = Number(type.value) === CHECKPOINT;
    let sp = Number(split.value);
    if (!(sp >= CPX_SPLIT_NONE && sp <= CPX_SPLIT_LANE)) sp = CPX_SPLIT_NONE;
    // Main route: only for a box in an any-copy slot of 2+ copies; never per lane or unsplit.
    mainRow.hidden = !(cp && race.mainAvail && sp === CPX_SPLIT_ANY);
    split.disabled = !cp; disable(splitRow, !cp);
    lane.disabled = !(cp && sp === CPX_SPLIT_LANE); disable(laneRow, lane.disabled);
    disable(roleRow, !cp);
    role.textContent = cp ? checkpointRolePreview(race.mode, race.othersSeq, dlgItemInt(checkpoint.value), sp) : "";
  };
  checkpoint.addEventListener("input", updateRaceRows);
  split.addEventListener("change", updateRaceRows);
  type.addEventListener("change", updateRaceRows);
  // Ticking it moves this box first among its slot's copies on Apply; unticking alone does nothing.
  main.addEventListener("click", () => { mainEdit = true; edited(); });

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
    row("Sequence", checkpoint, lightButton, fogButton),
    row("Cab offset", ...crushOff),
    row("Cab", crushText, cabButton),
    reset, raceRows);
  body.addEventListener("keydown", nudge, true);
  // OnCommand: a typed change or a list choice is an edit; so is a level button.
  body.addEventListener("input", (e) => { if (e.isTrusted) edited(); });
  body.addEventListener("change", (e) => { if (e.isTrusted) edited(); });
  // Enter in a box presses OK: the form's implicit submission, OK being its first button (openModeless).
  fillAll();

  /* ReadFields and the result OK has always handed back; empty Mass, Above ground and the angles become 0. */
  const collect = (): ObjectDialogResult => {
    for (const i of [mass, z, angle, elev, tilt]) if (!i.value.trim()) i.value = "0";
    read();
    const int = (i: HTMLInputElement, fallback = 0) => (i.value.trim() ? Math.trunc(Number(i.value)) || 0 : fallback);
    const out: ObjectFields = structuredClone(f);
    out.typeIndex = Number(type.value);
    out.checkpoint = int(checkpoint);
    out.vx = int(vx);
    out.vy = int(vy);
    out.mass = int(mass);
    out.level = Math.max(0, levels.findIndex((l) => l.checked));
    out.crush = crushOff.map((i) => Math.fround(Number(i.value) || 0)) as [number, number, number];
    out.soundCont = soundCont.value;
    out.soundImpact = soundImpact.value;
    out.cpSplit = Number(split.value);
    out.cpLane = Number(lane.value);
    out.cpMain = main.checked;
    out.cpMainEdit = mainEdit;
    return { fields: out, wavs, crushName };
  };

  /* ObjectDialogApply: nothing edited, nothing to apply (and nothing marked); a Fog with a model is refused. */
  const apply = async (modeSwitch = false): Promise<boolean> => {
    if (closing) return true;
    if (!dirty) return true;
    if (Number(type.value) === TYPEIDX_FOG && modelName) {
      await alertDialog("Object Properties", OBJECT_FOG_MODEL_REFUSAL + (modeSwitch ? "\n\nThe edit to this object is being cancelled." : ""));
      return false;
    }
    const next = await hooks.apply(collect());
    if (!next) { abandon(); return true; }
    f = structuredClone(next);
    wavs = { cont: null, impact: null };
    dirty = liveDirty = false;
    fillAll();
    return true;
  };

  const win = openModeless({
    title: "Object Properties",
    className: "live obj-window",
    body,
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Apply", value: "apply" }, { label: "Cancel", value: "cancel" }],
    onButton: (v) => { if (v === "apply") void apply(); else void close(v === "ok"); },
    onCancel: () => void close(false),
  });

  const takeDown = () => {
    closing = true;
    win.close();
    hooks.closed();
  };
  const abandon = () => { if (!closing) takeDown(); };
  const close = async (ok: boolean, modeSwitch = false): Promise<boolean> => {
    if (closing) return true;
    if (ok) {
      if (!(await apply(modeSwitch))) return false;
      if (closing) return true;   // its object was gone: the window already closed
    } else if (liveDirty) hooks.restore();
    takeDown();
    return true;
  };

  return {
    raise: () => win.raise(),
    refreshFromBox: (fields, model, crush, resting) => {
      if (closing) return;
      const focus = document.activeElement;
      filling = true;
      modelName = model;
      crushName = crush;
      restingHeight = resting;
      showModelOrSize();
      modelLabel.textContent = modelName ? (Number(type.value) === TYPEIDX_CRUSH ? "Base" : "Model") : "";
      const put = (i: HTMLInputElement, v: string) => { if (focus !== i) i.value = v; };
      // The fields being typed in keep what the author has there; the rest follow the box.
      if (focus !== x) f.fx = fields.fx;
      if (focus !== y) f.fy = fields.fy;
      if (focus !== z) f.fz = fields.fz;
      if (focus !== angle) f.angle = fields.angle;
      if (focus !== elev) f.elev = fields.elev;
      if (focus !== tilt) f.tilt = fields.tilt;
      if (focus !== sizeW) f.sizeW = fields.sizeW;
      if (focus !== sizeH) f.sizeH = fields.sizeH;
      if (focus !== sizeD) f.sizeD = fields.sizeD;
      put(x, show(fields.fx).toFixed(3)); put(y, show(fields.fy).toFixed(3)); put(z, String(fields.fz));
      put(angle, String(fields.angle)); put(elev, String(fields.elev)); put(tilt, String(fields.tilt));
      put(sizeW, String(fields.sizeW)); put(sizeH, String(fields.sizeH)); put(sizeD, String(fields.sizeD));
      filling = false;
    },
    close,
    abandon,
  };
}

/**
  IDD_GROUP_PROPERTIES. Blank fields are where the objects differ; `preview` gets the look
  fields as they read on every edit, and whether "Move as one object" is ticked. Resolves with
  what the author left, or null.

  Traxx 1.8.2 (a68413d, GroupPropertiesDlg.cpp OnAsOne): "Move as one object" ticked, the Above
  ground / Orientation / Pitch / Tilt fields show "0" (and "0" counts as unchanged) and their
  labels read "Raise by", "Turn by (deg)", "Pitch by (deg)", "Tilt by (deg)"; unticked, the saved
  texts and labels come back. It re-previews either way and starts off on every open.
*/
export async function groupPropertiesDialog(n: number, start: GroupFields, pickWav: () => Promise<File | null>, preview: (text: string[], asOne: boolean) => void): Promise<GroupResult | null> {
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
  let asOne = false, ready = true;
  // The orig each field compares against: "0" for the four amounts while Move as one object is ticked.
  let orig = [...start.text];
  const look = () => { if (ready) preview(fields.map((f) => f.value.trim()), asOne); };
  for (let f = GP_HEIGHT; f <= GP_SIZEH; f++) fields[f]!.addEventListener("input", look);
  const labelText = ["Above ground", "Orientation (deg)", "Pitch (deg)", "Tilt (deg)"];
  const lookRows = labelText.map((t, i) => row(t, fields[GP_HEIGHT + i]!));
  const saved: string[] = [];
  const asOneBox = el("input", { type: "checkbox" }) as HTMLInputElement;
  asOneBox.addEventListener("change", () => {
    const on = asOneBox.checked;
    if (on === asOne) return;
    // orig is swapped before the fields are set, and the preview is held off while they are.
    ready = false;
    asOne = on;
    orig = on ? asOneOrig(start.text) : [...start.text];
    for (let i = 0; i < 4; i++) {
      const input = fields[GP_HEIGHT + i]!, label = lookRows[i]!.querySelector(".fld")!;
      if (on) { saved[i] = input.value; input.value = "0"; label.textContent = GP_ASONE_LABELS[i]!; }
      else { input.value = saved[i] ?? ""; label.textContent = labelText[i]!; }
    }
    ready = true;
    look();
  });
  const body = el("div", { class: "obj-props" },
    row("Type", type),
    el("fieldset", { class: "opt-group" }, el("legend", {}, "Settings"),
      el("label", { class: "opt-check" }, asOneBox, "Move as one object"),
      row("Mass (Lbs)", fields[GP_MASS]!), ...lookRows),
    size,
    el("div", { class: "obj-two" },
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Sounds"), row("Cont.", ...cont.nodes), row("Impact", ...impact.nodes)),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Level"), ...levels.map((r, i) => el("label", { class: "opt-check" }, r, ["Sparse", "Normal", "Complex"][i]!)))),
    el("p", { class: "hint" }, "A blank field is one where the objects differ. It is left as it is unless you fill it in.  Move as one object: the four fields are amounts, around the group's centre."));
  const r = await openDialog({
    title: `Group Properties (${n} objects)`,
    className: "live",
    body,
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (v) => {
      if (v !== "ok") return true;
      for (let f = 0; f < fields.length; f++) {
        const t = fields[f]!.value.trim();
        if (!t || t === orig[f] || parses(f, t)) continue;
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
    asOne,
  };
}
