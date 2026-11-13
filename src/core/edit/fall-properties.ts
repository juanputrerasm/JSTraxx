/*
  The Waterfall window (IDD_WATERFALL; Traxx 1.7.1 Traxx/WaterfallDlg.cpp), the logic without the
  DOM. The frame is ui/dialogs/waterfall-dialog.ts.

  HEIGHTS are shown in feet with the raw water unit beside it (1 raw = 0.5 ft); a fall with a
  source lake shows the lake's height, read-only. SPEED is typed in ft/s (decimals allowed) and
  kept in 1/16 ft/s; opacity, mist and volume are whole percents; the two names are stems of at
  most 15 characters, upper case.
*/
import { cAtof, cAtoi } from "../traxx/cformat.ts";
import { cG } from "../traxx/veg.ts";
import {
  crestLength, fallBadPoints, fallEffectiveHeight, fallErrorText, fallErrors, fallNotchWarnings, fallNotchWarnText,
  FALLERR_LIP_LOW, FALLFLAG_SOUND, FALLWARN_NOTCH_FLAT, FALLWARN_SILENT, FALL_LOOPING_SOUNDS, FALL_MAX_POINTS, FALL_NAMELEN,
  FALL_VERTS_PER_FALL, FALL_VERTS_PER_TRACK, type FallGround, type FallLakes, type FallNameCheck, type TraxxFall,
} from "../traxx/falls.ts";
import type { LakeGround } from "../traxx/surface.ts";

/** Spaced: 3120 -> "3 120" (a plain space: the box is read by eye). */
export function spaced(v: number): string {
  const digits = String(Math.abs(Math.trunc(v)));
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += " ";
    out += digits[i];
  }
  return v < 0 ? `-${out}` : out;
}

/** The Source combo: None, every lake, and a missing source on its own line (OnInitDialog). */
export function fallSourceOptions(lakes: readonly { height: number }[], w: TraxxFall): { label: string; value: number }[] {
  const out = [{ label: "None (a spring)", value: 0 }];
  lakes.forEach((l, i) => out.push({ label: `Lake ${i + 1} (${cG(l.height / 2.0)} ft)`, value: i + 1 }));
  if (w.source > lakes.length) out.push({ label: `Lake ${w.source} (missing)`, value: w.source });
  return out;
}

/** The boxes as Refresh(TRUE) writes them. */
export function fallBoxTexts(w: TraxxFall, eff: number): {
  height: string; speed: string; opacity: string; mist: string; mistdepth: string; mistheight: string; volume: string; sound: string; texture: string;
} {
  return {
    height: cG(eff / 2.0), speed: cG(w.speed / 16.0),
    opacity: String(w.opacity), mist: String(w.mist), mistdepth: String(w.mistdepth || 100), mistheight: String(w.mistheight || 100),
    volume: String(w.volume), sound: w.sound, texture: w.texture,
  };
}

/** The read-out beside the height box. */
export function fallHeightText(w: TraxxFall, eff: number): string {
  return w.source === 0 ? `${cG(eff / 2.0)} ft (${eff} raw)` : `${cG(eff / 2.0)} ft (${eff} raw) - the lake's height`;
}

/** ApplyHeight: a spring's height, 1..4096 raw; a sourced fall has none of its own. True when it changed. */
export function applyFallHeight(w: TraxxFall, raw: number): boolean {
  if (w.source !== 0) return false;
  if (raw < 1) raw = 1;
  if (raw > 4096) raw = 4096;
  const changed = w.height !== raw;
  w.height = raw;
  return changed;
}

/** ApplyHeightText's rounding: feet to the raw unit, half up; null for an empty box. */
export function fallHeightRaw(text: string): number | null {
  return text !== "" ? Math.floor(cAtof(text) * 2.0 + 0.5) : null;
}

/** ApplySpeedText: ft/s, 1..100, kept in 1/16 ft/s. True when it changed. */
export function applyFallSpeedText(w: TraxxFall, text: string): boolean {
  if (text === "") return false;
  let v = cAtof(text);
  if (v < 1.0) v = 1.0;
  if (v > 100.0) v = 100.0;
  const s = Math.floor(v * 16.0 + 0.5);
  if (s === w.speed) return false;
  w.speed = s;
  return true;
}

/*
  strtod with the whole box consumed: the live parse of OnChangeSpeed / OnChangeHeight (an empty
  box, a lone "." or trailing text waits for the box to be left).
*/
function strictNumber(text: string): number | null {
  if (!/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null;
  return Number(text);
}

/** OnChangeSpeed: live while typing; a value that parses and is in 1..100 goes in. True when it changed. */
export function liveFallSpeed(w: TraxxFall, text: string): boolean {
  const v = strictNumber(text);
  if (v === null || v < 1.0 || v > 100.0) return false;
  const s = Math.floor(v * 16.0 + 0.5);
  if (s === w.speed) return false;
  w.speed = s;
  return true;
}

/** OnChangeHeight: live while typing, a spring only, 1..4096 raw. True when it changed. */
export function liveFallHeight(w: TraxxFall, text: string): boolean {
  if (w.source !== 0) return false;
  const v = strictNumber(text);
  if (v === null) return false;
  const raw = Math.floor(v * 2.0 + 0.5);
  if (raw < 1 || raw > 4096 || raw === w.height) return false;
  w.height = raw;
  return true;
}

/** OnDeltaposSpeed: one ft/s a click from the rounded speed, 1..100 (up = +1). */
export function stepFallSpeed(w: TraxxFall, up: number): void {
  let v = Math.floor(w.speed / 16.0 + 0.5) + up;
  if (v < 1.0) v = 1.0;
  if (v > 100.0) v = 100.0;
  w.speed = Math.trunc(v * 16.0);
}

export type FallPercent = "opacity" | "mist" | "mistdepth" | "mistheight" | "volume";

/** ApplySmall: opacity 0..100, mist and volume 0..200, mist depth and height 1..250; an empty box changes nothing. */
export function applyFallPercent(w: TraxxFall, field: FallPercent, text: string): boolean {
  if (text === "") return false;
  let v = cAtoi(text);
  let lo = 0, hi = field === "opacity" ? 100 : 200;
  if (field === "mistdepth" || field === "mistheight") { lo = 1; hi = 250; }
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  w[field] = v;
  return true;
}

/** StepPercent: the mist size, 5 % a click (up = +1), 1..250. */
export function stepFallMist(w: TraxxFall, field: "mistdepth" | "mistheight", up: number): void {
  let v = w[field] + 5 * up;
  if (v < 1) v = 1;
  if (v > 250) v = 250;
  w[field] = v;
}

/** ApplyNames: both stems upper case, at most 15 characters. */
export function applyFallNames(w: TraxxFall, sound: string, texture: string): void {
  w.sound = sound.slice(0, FALL_NAMELEN - 1).toUpperCase();
  w.texture = texture.slice(0, FALL_NAMELEN - 1).toUpperCase();
}

/** UseTexture's stem: the name without folder and extension, upper case; or the message refusing it. */
export function fallTextureStem(name: string): { stem: string } | { error: string } {
  const slash = name.lastIndexOf("\\");
  let stem = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = stem.lastIndexOf(".");
  if (dot >= 0) stem = stem.slice(0, dot);
  stem = stem.toUpperCase();
  if (!stem) return { error: "That texture has no name." };
  if (stem.length > FALL_NAMELEN - 1) {
    return { error: `The waterfall's texture name holds 15 characters (the .WFL file's field), and "${stem}" is longer.\nRename the texture (in the Textures window) or pick another.` };
  }
  return { stem };
}

/** OnSoundBrowse's checks on a picked WAV's stem (null when it fits); `budget` is Pod1SoundStemBudget. */
export function fallSoundStemProblem(stem: string, budget: number): string | null {
  if (stem.length > FALL_NAMELEN - 1) return "The waterfall's sound name holds 15 characters (the .WFL file's field), and this one is longer.\nRename the WAV file to 15 characters or fewer and pick it again.";
  if (stem.length > budget) return `This sound name is too long for the pod (at most ${budget} characters).\nRename the WAV file and pick it again.`;
  return null;
}

/** The fixed notes under the sound and texture rows (OnInitDialog). */
export const FALL_SOUND_NOTE = "Empty sound = the engine's own roar (not available yet: silent)";
export const FALL_TEXTURE_NOTE = "Used by the Original look's sheet and by the landing foam in every look. Use a texture with no painted border: a ground tile's rock edge shows as a frame. If the stem is an animation's base name in the .ANI, the fall plays its frames.";

/** The window's inputs for the read-outs. */
export interface FallReadoutInput {
  falls: readonly TraxxFall[];
  index: number;
  lakes: FallLakes;
  names: FallNameCheck;
  /** The lakes' ground (FALL_LIP_LOW, LIP_HIGH) and the fall ground (NOTCH_FLAT), when there is one. */
  lip: LakeGround | null;
  ground: FallGround | null;
  /** The shape cache's vertices and warnings for this fall, and the track total. */
  vertices: number;
  shapeWarn: number;
  trackVerts: number;
  /** Objects with a continuous sound (FallLoopingObjects). */
  loopingObjects: number;
}

/**
  RefreshReadouts: the crest, the vertices, the looping sounds and the Problems list (errors, the
  points off the lake, then the warnings; "None" when empty).
*/
export function fallReadouts(r: FallReadoutInput): { points: string; verts: string; loops: string; problems: string[] } {
  const w = r.falls[r.index]!;
  const points = `Crest: ${w.npoints} points, ${cG(Math.floor(crestLength(w) * 10.0 + 0.5) / 10.0)} ft wide`;
  const verts = `Vertices: ${spaced(r.vertices)} of ${spaced(FALL_VERTS_PER_FALL)} (track ${spaced(r.trackVerts)} of ${spaced(FALL_VERTS_PER_TRACK)})`;
  // The engine holds 30 looping sounds: the objects' first, then each fall with sound on, in order.
  let soundfalls = 0, rank = 0;
  r.falls.forEach((f, i) => { if (f.flags & FALLFLAG_SOUND) { soundfalls++; if (i <= r.index) rank = soundfalls; } });
  const o = r.loopingObjects;
  const loops = `Looping sounds: ${o + soundfalls} of ${FALL_LOOPING_SOUNDS} (${o} object${o === 1 ? "" : "s"} + ${soundfalls} waterfall${soundfalls === 1 ? "" : "s"})`;
  const problems: string[] = [];
  const errors = fallErrors(r.falls, r.index, r.lakes, r.names, r.lip);
  for (let bit = 1; bit <= FALLERR_LIP_LOW; bit <<= 1) if (errors & bit) problems.push(`Error: ${fallErrorText(bit)}`);
  const bad = fallBadPoints(r.falls, r.index, r.lakes);
  for (let k = 0; k < w.npoints && k < FALL_MAX_POINTS; k++) if (bad & (1 << k)) problems.push(`Error: Point ${k + 1} is not on Lake ${w.source}'s water`);
  const nw = fallNotchWarnings(r.falls, r.index, r.lakes, r.lip, r.ground, r.names);
  let warn = nw.warn | r.shapeWarn;
  if ((w.flags & FALLFLAG_SOUND) && rank > 0 && o + rank > FALL_LOOPING_SOUNDS) warn |= FALLWARN_SILENT;
  for (let bit = 1; bit <= FALLWARN_NOTCH_FLAT; bit <<= 1) if (warn & bit) problems.push(`Warning: ${fallNotchWarnText(bit, nw.info)}`);
  if (!problems.length) problems.push("None");
  return { points, verts, loops, problems };
}

/** The height the window shows for fall i (EffectiveHeight). */
export function fallShownHeight(falls: readonly TraxxFall[], i: number, lakes: readonly { height: number }[]): number {
  return fallEffectiveHeight(falls, i, lakes);
}
