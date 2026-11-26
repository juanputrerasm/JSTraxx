/*
  The Waterfall window (IDD_WATERFALL, Traxx 1.7.1 Traxx/WaterfallDlg.cpp). The logic is in
  core/edit/fall-properties.ts; this is the frame: Source, Crest height (feet, with the raw unit
  beside it; read-only with a lake), Flow speed, Opacity, Mist and its depth and height, Freeze
  in snow, Splash, Rough water and Rough from (Traxx 1.7.3), Sound and its volume and file,
  Texture, then the read-outs (crest, vertices, looping sounds), Snap to lip, Flip direction and
  the Problems list.

  Every change goes straight into the fall and the view redraws (shape changes rebuild the
  sheet). The speed and a spring's height apply while typing when they parse and are in range;
  leaving a box clamps and tidies it; Enter in the height or speed box commits it and stays
  open. OK is not refused over errors (they only refuse the pod build). Cancel is the caller's:
  it puts the fall back, or deletes a new one.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import type { TraxxFall } from "../../core/traxx/falls.ts";
import { fallReverse, FALLFLAG_FREEZE, FALLFLAG_SOUND, FALLFLAG_SPLASH, FALL_NAMELEN } from "../../core/traxx/falls.ts";
import {
  applyFallHeight, applyFallNames, applyFallPercent, applyFallRoughText, applyFallSpeedText, fallBoxTexts, fallHeightRaw, fallHeightText, fallRoughText,
  fallSourceOptions, liveFallHeight, liveFallSpeed, stepFallMist, stepFallRough, stepFallSpeed, toggleFallRough, FALL_ROUGH_NOTE, FALL_ROUGH_OFF,
  FALL_SOUND_NOTE, FALL_TEXTURE_NOTE, type FallPercent,
} from "../../core/edit/fall-properties.ts";

export interface WaterfallDialogHooks {
  /** The fall being edited (live; the caller's object). */
  fall(): TraxxFall;
  /** Its EffectiveHeight. */
  effectiveHeight(): number;
  lakes(): readonly { height: number }[];
  /** The raw heights a spring may take: Traxx's 1..4096, or a version 6 track's (falls.ts fallHeightBounds). */
  heightBounds?(): { min: number; max: number };
  /** Traxx origin/main: a v6 track shows the heights with 2 decimals (FeetText). */
  feet?(): boolean;
  /** The fall changed: redraw, rebuilding the shapes when `shape`. */
  changed(shape: boolean): void;
  /** FallFit: orient, snap onto the lake's lip, orient again. */
  fit(): void;
  /** The read-outs (the shape cache brought up to date first). */
  readouts(): { points: string; verts: string; loops: string; problems: string[] };
  /** Sound Browse: pick a WAV and load it into the track as a continuous sound; the stem, or null. */
  browseSound(): Promise<string | null>;
  /** Texture Browse (through the Textures window) and From Textures window: the texture's stem, or null. */
  browseTexture(): Promise<string | null>;
  textureFromWindow(): Promise<string | null>;
}

const stop = <T extends HTMLElement>(i: T) => { i.addEventListener("keydown", (e) => e.stopPropagation()); return i; };

/** Resolves true on OK. */
export async function waterfallDialog(index: number, h: WaterfallDialogHooks): Promise<boolean> {
  const text = (cls = "spin") => stop(el("input", { type: "text", class: cls }) as HTMLInputElement);
  const source = stop(el("select", {}) as HTMLSelectElement);
  const height = text(), speed = text(), opacity = text(), mist = text(), mistdepth = text(), mistheight = text(), volume = text();
  const heightFt = el("span", {});
  const spin = (onStep: (up: number) => void) => el("span", { class: "fall-spin" },
    el("button", { type: "button", class: "mini", tabindex: -1, onclick: () => onStep(1) }, "▲"),
    el("button", { type: "button", class: "mini", tabindex: -1, onclick: () => onStep(-1) }, "▼"));
  const freeze = el("input", { type: "checkbox" }) as HTMLInputElement;
  const splash = el("input", { type: "checkbox" }) as HTMLInputElement;
  const rough = el("input", { type: "checkbox" }) as HTMLInputElement;
  const roughFrom = stop(el("input", { type: "text", class: "spin", inputmode: "numeric" }) as HTMLInputElement);
  // Rough from before Rough water was unchecked (0 = none), for re-checking (m_roughprev).
  let roughPrev = 0;
  const sound = el("input", { type: "checkbox" }) as HTMLInputElement;
  const soundFile = stop(el("input", { type: "text", readonly: true, maxlength: FALL_NAMELEN - 1, class: "fall-stem" }) as HTMLInputElement);
  const texture = stop(el("input", { type: "text", readonly: true, maxlength: FALL_NAMELEN - 1, class: "fall-stem" }) as HTMLInputElement);
  const points = el("span", {}), verts = el("div", {}), loops = el("div", {});
  const problems = el("div", { class: "fall-problems" });
  const snapBtn = el("button", { type: "button" }, "Snap to lip");
  const flipBtn = el("button", { type: "button" }, "Flip direction");
  let loading = false;
  // OK or Cancel is ending the box: a box losing the focus must not re-apply its text (m_closing).
  let closing = false;

  for (const o of fallSourceOptions(h.lakes(), h.fall(), h.feet?.() ?? false)) source.append(el("option", { value: o.value }, o.label));

  /* RefreshReadouts. */
  const readouts = () => {
    const r = h.readouts();
    points.textContent = r.points;
    verts.textContent = r.verts;
    loops.textContent = r.loops;
    problems.replaceChildren(...r.problems.map((p) => el("div", {}, p)));
  };
  /* Refresh: the boxes (writeBoxes) and the read-outs from the fall. */
  const refresh = (writeBoxes: boolean) => {
    const w = h.fall(), eff = h.effectiveHeight();
    loading = true;
    if (writeBoxes) {
      const t = fallBoxTexts(w, eff, h.feet?.() ?? false);
      height.value = t.height; speed.value = t.speed; opacity.value = t.opacity; mist.value = t.mist;
      mistdepth.value = t.mistdepth; mistheight.value = t.mistheight; volume.value = t.volume;
      soundFile.value = t.sound; texture.value = t.texture;
      freeze.checked = (w.flags & FALLFLAG_FREEZE) !== 0;
      splash.checked = (w.flags & FALLFLAG_SPLASH) !== 0;
      sound.checked = (w.flags & FALLFLAG_SOUND) !== 0;
      source.value = String(w.source);
      // Rough from: 0 shows the engine default, 25; off (255) keeps the last value in the greyed box.
      roughFrom.value = fallRoughText(w, roughPrev);
      rough.checked = w.roughfrom !== FALL_ROUGH_OFF;
    }
    roughFrom.disabled = w.roughfrom === FALL_ROUGH_OFF;
    for (const b of roughSpin.querySelectorAll("button")) (b as HTMLButtonElement).disabled = w.roughfrom === FALL_ROUGH_OFF;
    // A sourced fall's height is the lake's: not typed here.
    height.disabled = w.source !== 0;
    for (const b of heightSpin.querySelectorAll("button")) (b as HTMLButtonElement).disabled = w.source !== 0;
    snapBtn.disabled = w.source === 0;
    heightFt.textContent = fallHeightText(w, eff, h.feet?.() ?? false);
    loading = false;
    readouts();
  };

  const applyHeight = (raw: number) => { if (applyFallHeight(h.fall(), raw, h.heightBounds?.())) h.changed(true); refresh(true); };
  const applyHeightText = () => { const raw = fallHeightRaw(height.value); if (raw !== null) applyHeight(raw); else refresh(true); };
  const applySpeedText = () => { if (applyFallSpeedText(h.fall(), speed.value)) h.changed(true); refresh(true); };
  const small: [HTMLInputElement, FallPercent][] = [[opacity, "opacity"], [mist, "mist"], [mistdepth, "mistdepth"], [mistheight, "mistheight"], [volume, "volume"]];
  const applySmall = (input: HTMLInputElement, field: FallPercent) => { if (applyFallPercent(h.fall(), field, input.value)) { h.changed(false); readouts(); } };
  const applyNames = () => { applyFallNames(h.fall(), soundFile.value, texture.value); h.changed(false); readouts(); };

  const heightSpin = spin((up) => applyHeight((fallHeightRaw(height.value) ?? 0) + up));
  height.addEventListener("input", () => { if (!loading && liveFallHeight(h.fall(), height.value, h.heightBounds?.())) { h.changed(true); readouts(); } });
  height.addEventListener("blur", () => { if (!loading && !closing && !height.disabled) applyHeightText(); });
  height.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyHeightText(); } });
  speed.addEventListener("input", () => { if (!loading && liveFallSpeed(h.fall(), speed.value)) { h.changed(true); readouts(); } });
  speed.addEventListener("blur", () => { if (!loading && !closing) applySpeedText(); });
  speed.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applySpeedText(); } });
  for (const [input, field] of small) {
    input.addEventListener("input", () => { if (!loading) applySmall(input, field); });
    input.addEventListener("blur", () => { if (!loading && !closing) { applySmall(input, field); refresh(true); } });
  }
  const speedSpin = spin((up) => { stepFallSpeed(h.fall(), up); h.changed(true); refresh(true); });
  /* Rough from: typing applies live (a value past 250 waits for the box to be left), the spin a ft/s a click. */
  const applyRoughText = (final: boolean) => { if (applyFallRoughText(h.fall(), roughFrom.value, final)) { h.changed(false); readouts(); } };
  roughFrom.addEventListener("input", () => { if (!loading && !closing) applyRoughText(false); });
  roughFrom.addEventListener("blur", () => { if (!loading && !closing) { applyRoughText(true); refresh(true); } });
  const roughSpin = spin((up) => { if (stepFallRough(h.fall(), up)) { h.changed(false); refresh(true); } });
  /* OnRough: off writes 255 (the box greys); on restores the last value, or 0 (25) if there was none. */
  rough.addEventListener("change", () => {
    if (closing) return;
    roughPrev = toggleFallRough(h.fall(), rough.checked, roughPrev);
    h.changed(false);
    refresh(true);
  });
  const mistSpin = (field: "mistdepth" | "mistheight") => spin((up) => { stepFallMist(h.fall(), field, up); h.changed(false); refresh(true); });

  /* OnSelchangeSource: leaving a lake keeps the height the fall had (the lake's); another side is picked (FallFit). */
  source.addEventListener("change", () => {
    const w = h.fall();
    const src = Number(source.value);
    if (src !== w.source) {
      if (w.source !== 0 && src === 0) { const eff = h.effectiveHeight(); if (eff >= 1) w.height = eff; }
      w.source = src;
      h.fit();
      h.changed(true);
    }
    refresh(true);
  });
  const flags = () => {
    const w = h.fall();
    w.flags = (freeze.checked ? FALLFLAG_FREEZE : 0) | (splash.checked ? FALLFLAG_SPLASH : 0) | (sound.checked ? FALLFLAG_SOUND : 0);
    h.changed(false);
    readouts();
  };
  for (const c of [freeze, splash, sound]) c.addEventListener("change", flags);
  // Flip direction: the water leaves the crest on the other side, until the source changes or the crest is redrawn.
  flipBtn.addEventListener("click", () => {
    fallReverse(h.fall());
    h.changed(true);
    refresh(false);
  });
  snapBtn.addEventListener("click", () => { h.fit(); h.changed(true); refresh(false); });
  const setStem = (box: HTMLInputElement, stem: string) => { box.value = stem; applyNames(); };
  const soundBrowse = el("button", { type: "button", class: "mini", onclick: async () => { const s = await h.browseSound(); if (s !== null) setStem(soundFile, s); } }, "Browse...");
  const soundClear = el("button", { type: "button", class: "mini", onclick: () => setStem(soundFile, "") }, "Clear");
  const texBrowse = el("button", { type: "button", class: "mini", onclick: async () => { const s = await h.browseTexture(); if (s !== null) setStem(texture, s); } }, "Browse...");
  const texWindow = el("button", { type: "button", class: "mini", onclick: async () => { const s = await h.textureFromWindow(); if (s !== null) setStem(texture, s); } }, "From Textures window");
  const texClear = el("button", { type: "button", class: "mini", onclick: () => setStem(texture, "") }, "Clear");

  const row = (label: string, ...nodes: (Node | string)[]) => el("div", { class: "opt-row" }, el("span", { class: "fld" }, label), ...nodes);
  const pair = (a: string, ai: Node[], b: string, bi: Node[]) => el("div", { class: "opt-row" }, el("span", { class: "fld" }, a), ...ai, el("span", { class: "fld", style: "margin-left: 1em" }, b), ...bi);
  refresh(true);
  const r = await openDialog({
    title: `Waterfall ${index + 1}`,
    className: "fall-dialog",
    body: el("div", { class: "fall-body" },
      row("Source", source),
      row("Crest height (ft)", height, heightSpin, heightFt),
      row("Flow speed (ft/s)", speed, speedSpin),
      pair("Opacity (%)", [opacity], "Mist (%)", [mist]),
      pair("Mist depth (%)", [mistdepth, mistSpin("mistdepth")], "Mist height (%)", [mistheight, mistSpin("mistheight")]),
      el("div", { class: "opt-row" }, el("label", { class: "opt-check" }, freeze, "Freeze in snow"), el("label", { class: "opt-check" }, splash, "Splash (foam and droplets)")),
      el("div", { class: "opt-row" }, el("label", { class: "opt-check" }, rough, "Rough water"), el("span", { class: "fld", style: "margin-left: 1em" }, "Rough from (ft/s)"), roughFrom, roughSpin),
      el("p", { class: "hint" }, FALL_ROUGH_NOTE),
      el("div", { class: "opt-row" }, el("label", { class: "opt-check" }, sound, "Sound"), el("span", { class: "fld", style: "margin-left: 1em" }, "Sound volume (%)"), volume),
      row("Sound file", soundFile, soundBrowse, soundClear),
      el("p", { class: "hint" }, FALL_SOUND_NOTE),
      row("Texture", texture),
      el("div", { class: "opt-row" }, el("span", { class: "fld" }, ""), texBrowse, texWindow, texClear),
      el("p", { class: "hint" }, FALL_TEXTURE_NOTE),
      el("div", { class: "opt-row" }, points, snapBtn, flipBtn),
      verts, loops,
      el("div", {}, "Problems and warnings"), problems),
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: (v) => {
      if (v !== "ok") { closing = true; return true; }
      // Enter in the height or speed box commits it and stays open.
      const focus = document.activeElement;
      if (focus === height) { applyHeightText(); return false; }
      if (focus === speed) { applySpeedText(); return false; }
      // Everything typed but not yet applied (ApplyAllText).
      if (!height.disabled) applyHeightText();
      applySpeedText();
      for (const [input, field] of small) applySmall(input, field);
      applyRoughText(true);
      applyNames();
      closing = true;
      return true;
    },
  });
  return r === "ok";
}
