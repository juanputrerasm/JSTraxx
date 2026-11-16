/*
  The Waterfall window (IDD_WATERFALL; Traxx 1.7.1 Traxx/WaterfallDlg.cpp), the logic without the
  DOM. The frame is ui/dialogs/waterfall-dialog.ts.

  HEIGHTS are shown in feet with the raw water unit beside it (1 raw = 0.5 ft); a fall with a
  source lake shows the lake's height, read-only. SPEED is typed in ft/s (decimals allowed) and
  kept in 1/16 ft/s; opacity, mist and volume are whole percents; the two names are stems of at
  most 15 characters, upper case.

  Traxx 1.7.2 / 1.7.3: Rough water / Rough from (ft/s, 0 = the engine's 25, 1..250, 255 = off; a
  typed 25 is stored as 0); a fall with errors is "not counted" in the vertices; the looping sounds
  count only falls with sound on, a stem and no errors, and the over-30 line names no fall; the
  shape warnings show only for a fall without errors; the notch codes are worded for the lakes' rule.
*/
import { engineFogSlotOverflow, ENGINEFOG_SLOTS } from "../traxx/preflight.ts";
import { cAtof, cAtoi } from "../traxx/cformat.ts";
import { cG } from "../traxx/veg.ts";
import {
  crestLength, fallBadPoints, fallEffectiveHeight, fallErrorText, fallErrors, fallLakesCells, fallNotchWarnings, fallNotchWarnText,
  FALLERR_ROUGH, FALLFLAG_SOUND, FALLWARN_NOTCH_FLAT, FALL_LOOPING_SOUNDS, FALL_MAX_FALLS, FALL_MAX_POINTS, FALL_NAMELEN,
  FALL_VERTS_PER_FALL, FALL_VERTS_PER_TRACK, type FallGround, type FallLakes, type FallNameCheck, type TraxxFall,
} from "../traxx/falls.ts";
import { lakeDefaultRule, LAKE_RULE_EDGE } from "../traxx/lake-ground.ts";
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

/** The spring heights Traxx allows, raw; a version 6 track passes its own (falls.ts fallHeightBounds). */
const TRAXX_HEIGHTS = { min: 1, max: 4096 };

/** ApplyHeight: a spring's height, 1..4096 raw; a sourced fall has none of its own. True when it changed. */
export function applyFallHeight(w: TraxxFall, raw: number, bounds: { min: number; max: number } = TRAXX_HEIGHTS): boolean {
  if (w.source !== 0) return false;
  if (raw < bounds.min) raw = bounds.min;
  if (raw > bounds.max) raw = bounds.max;
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
export function liveFallHeight(w: TraxxFall, text: string, bounds: { min: number; max: number } = TRAXX_HEIGHTS): boolean {
  if (w.source !== 0) return false;
  const v = strictNumber(text);
  if (v === null) return false;
  const raw = Math.floor(v * 2.0 + 0.5);
  if (raw < bounds.min || raw > bounds.max || raw === w.height) return false;
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

/*
  ROUGH FROM (ft/s): the .WFL v1.1 byte 130. 0 = the engine default (25), 1..250, 255 = off. A
  typed 25 is stored as 0 (the same look, and it keeps the file in 128-byte records).
*/
export const FALL_ROUGH_OFF = 255;
export const FALL_ROUGH_DEFAULT_FT = 25;

/** The Rough from box (Refresh): 0 shows 25; off keeps the last value (`prev`, 0 = none: 25) in the greyed box. */
export function fallRoughText(w: TraxxFall, prev: number): string {
  if (w.roughfrom === FALL_ROUGH_OFF) return String(prev ? prev : FALL_ROUGH_DEFAULT_FT);
  return String(w.roughfrom ? w.roughfrom : FALL_ROUGH_DEFAULT_FT);
}

/**
  ApplyRoughText: typing applies live; a value past 250 waits for the box to be left (final: blank
  or out of range settled, blank = the default). Nothing while Rough water is off. True when it applied.
*/
export function applyFallRoughText(w: TraxxFall, text: string, final: boolean): boolean {
  if (w.roughfrom === FALL_ROUGH_OFF) return false;
  const t = text.trim();
  let v = t === "" ? 0 : cAtoi(t);
  if (v < 0 || v > 250) {
    if (!final) return false;
    v = v < 0 ? 1 : 250;
  }
  if (v === FALL_ROUGH_DEFAULT_FT) v = 0;
  w.roughfrom = v;
  return true;
}

/**
  OnRough: the checkbox. Off writes 255 (the box greys), keeping the value it had; on restores the
  last value (0, the default, if there was none). Returns the value to remember (m_roughprev).
*/
export function toggleFallRough(w: TraxxFall, on: boolean, prev: number): number {
  if (on) { w.roughfrom = prev; return prev; }
  if (w.roughfrom !== FALL_ROUGH_OFF) prev = w.roughfrom;
  w.roughfrom = FALL_ROUGH_OFF;
  return prev;
}

/** OnDeltaposRough: one ft/s a click from the shown value (up = faster), 1..250, 25 stored as 0. Nothing while off. */
export function stepFallRough(w: TraxxFall, up: number): boolean {
  if (w.roughfrom === FALL_ROUGH_OFF) return false;
  let v = (w.roughfrom ? w.roughfrom : FALL_ROUGH_DEFAULT_FT) + up;
  if (v < 1) v = 1;
  if (v > 250) v = 250;
  if (v === FALL_ROUGH_DEFAULT_FT) v = 0;
  w.roughfrom = v;
  return true;
}

/** The note under the Rough water row (IDC_FALL_ROUGHNOTE). */
export const FALL_ROUGH_NOTE = "Rough water: the white streaks on fast water (Enhanced / Realistic looks). Off keeps only the foam at the foot.";

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
  /** The shape cache's nobudget for this fall (it has errors: its vertices are not counted). */
  uncounted?: boolean;
  /** The shape cache's errors of every fall (a fall in error takes no looping sound); absent: judged here. */
  fallErrors?: readonly number[];
  /** Objects with a continuous sound (FallLoopingObjects). */
  loopingObjects: number;
  /**
    Traxx 1.8.0: the fog boxes and each fall's registered mist volumes (fallMistLandings; all 0
    without ground), for the 64 shared fog slots. Absent: no fog slot line.
  */
  fogBoxes?: number;
  mistLandings?: readonly number[];
}

/**
  RefreshReadouts: the crest, the vertices, the looping sounds and the Problems list (errors, the
  points off the lake, then the warnings; "None" when empty).
*/
export function fallReadouts(r: FallReadoutInput): { points: string; verts: string; loops: string; problems: string[] } {
  const w = r.falls[r.index]!;
  const edge = (r.lakes.rule ?? lakeDefaultRule()) === LAKE_RULE_EDGE;
  const points = `Crest: ${w.npoints} points, ${cG(Math.floor(crestLength(w, fallLakesCells(r.lakes)) * 10.0 + 0.5) / 10.0)} ft wide`;
  const verts = r.uncounted
    ? `Vertices: ${spaced(r.vertices)} (not counted: the fall has errors) (track ${spaced(r.trackVerts)} of ${spaced(FALL_VERTS_PER_TRACK)})`
    : `Vertices: ${spaced(r.vertices)} of ${spaced(FALL_VERTS_PER_FALL)} (track ${spaced(r.trackVerts)} of ${spaced(FALL_VERTS_PER_TRACK)})`;
  /*
    The engine holds 30 looping sounds: the objects' first, then the falls with sound on AND a sound
    stem (an empty stem takes no slot; a fall with errors is refused, so it takes none either).
    Which falls lose out depends on the player's start and the weather, so no fall is named.
  */
  const errOf = (i: number) => (r.fallErrors ? r.fallErrors[i] ?? 0 : fallErrors(r.falls, i, r.lakes, r.names, r.lip));
  let soundfalls = 0;
  r.falls.forEach((f, i) => { if ((f.flags & FALLFLAG_SOUND) && f.sound !== "" && errOf(i) === 0) soundfalls++; });
  const o = r.loopingObjects;
  const loops = `Looping sounds: ${o + soundfalls} of ${FALL_LOOPING_SOUNDS} (${o} object${o === 1 ? "" : "s"} + ${soundfalls} waterfall${soundfalls === 1 ? "" : "s"})`;
  const problems: string[] = [];
  const errors = fallErrors(r.falls, r.index, r.lakes, r.names, r.lip);
  for (let bit = 1; bit <= FALLERR_ROUGH; bit <<= 1) if (errors & bit) problems.push(`Error: ${fallErrorText(bit, r.lakes.world ?? null, edge)}`);
  const bad = fallBadPoints(r.falls, r.index, r.lakes);
  for (let k = 0; k < w.npoints && k < FALL_MAX_POINTS; k++) if (bad & (1 << k)) problems.push(`Error: Point ${k + 1} is not on Lake ${w.source}'s water`);
  const nw = fallNotchWarnings(r.falls, r.index, r.lakes, r.lip, r.ground, r.names);
  // the shape warnings (DRY, COARSE, SHORTENED, DROPPED) are judged only for a fall without errors
  const warn = nw.warn | (errors === 0 ? r.shapeWarn : 0);
  for (let bit = 1; bit <= FALLWARN_NOTCH_FLAT; bit <<= 1) if (warn & bit) problems.push(`Warning: ${fallNotchWarnText(bit, nw.info)}`);
  if (o + soundfalls > FALL_LOOPING_SOUNDS) {
    problems.push(`Warning: ${o + soundfalls} looping sounds of ${FALL_LOOPING_SOUNDS}: some falls will be silent (the engine keeps the ones nearest the start)`);
  }
  /*
    Traxx 1.8.0 (ce4aa17, 13507dc): the engine's 64 fog slots are shared by the fog volumes
    (registered first) and one mist volume per waterfall landing (stream 0 of every fall before any
    fall's stream 1); whatever does not fit is dropped. The player's INI mist scale is taken as 100 %.
  */
  if (r.mistLandings) {
    const nfogs = r.fogBoxes ?? 0;
    const landings = [...r.mistLandings];
    while (landings.length < FALL_MAX_FALLS) landings.push(0);
    const o2 = engineFogSlotOverflow(nfogs, landings, 6);
    if (o2.dropped > 0) {
      let names = o2.list.map((d, k) => `${k > 0 ? ", " : ""}Waterfall ${d.fall + 1} stream ${d.stream + 1}`).join("");
      if (o2.dropped > o2.list.length) names += ` and ${o2.dropped - o2.list.length} more`;
      const tm = o2.totalMist;
      problems.push(`Warning: ${nfogs} fog volume${nfogs === 1 ? "" : "s"} + ${tm} waterfall mist volume${tm === 1 ? "" : "s"} = ${nfogs + tm}, but the engine has ${ENGINEFOG_SLOTS} fog slots: `
        + `the game drops the mist of ${names} (mist registers after the fog volumes)`);
    }
  }
  if (!problems.length) problems.push("None");
  return { points, verts, loops, problems };
}

/** The height the window shows for fall i (EffectiveHeight). */
export function fallShownHeight(falls: readonly TraxxFall[], i: number, lakes: readonly { height: number }[]): number {
  return fallEffectiveHeight(falls, i, lakes);
}
