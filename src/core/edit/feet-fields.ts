/*
  The boxes that take heights in feet on a version 6 track (Traxx origin/main, HeightsInFeet): what each reads,
  shows and steps, in v (1/128 ft) inside, with HeightUnits.cpp's FormatFeet and ParseFeet. A classic track's
  boxes keep their steps and never come here.

    Edit bar Altitude       TraxxFrame.cpp AmplitudeLimit, AmplitudeRange, AmplitudeFromText(AMPKIND_FEET),
                            SetAmplitudeBox, StepAmplitude, OnEditAmplitude, FollowAmplitudeKind
    Groundbox bar           OnBuildingTop / OnBuildingBottom (while typing), OnBuildingTopKill / BottomKill,
                            StepBuildingFeet, FollowBuildingKind
    Status bar Z            TraxxView.cpp ZIndicatorCode, TraxxFrame.cpp OnNotify IDC_TERRAINMAPZ
    Track Components water  TraxxComponentsDlg.cpp DoDataExchange (m_v6water), OnDeltaposWaterLevel
    Lake window             LakeDlg.cpp HeightFromText, Refresh; TraxxViewInteract.cpp's lake submenu
    Waterfall window        WaterfallDlg.cpp FeetText
    Truck Properties Z      TruckPropertiesDlg.cpp OnZSpin, OnOK
    Transitions             TraxxTransitionsDlg.cpp FollowTrack, ReadFeetBoxes, StepFeetBox, OnHScroll
*/
import { clampBoxBottom, clampBoxTop, formatFeet, parseFeet } from "../traxx/height-units.ts";
import { ALTITUDE_SCALE } from "../view/camera.ts";
import { AMPLITUDE_MAXV, terrainWholeSteps } from "./terrain.ts";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ---- The edit bar's Altitude box.

/** AmplitudeFromText's bounds for feet: kept far from int overflow, not the limit (OnEditAmplitude clamps). */
const AMP_PARSE = 100000 * 128;

/** AmplitudeLimit: the terrain's height limit on a v6 track (`limit`), else 255 steps (AMPLITUDE_MAXV). */
export function amplitudeLimit(feet: boolean, limit: number): number {
  return feet ? limit : AMPLITUDE_MAXV;
}

/** AmplitudeRange on a v6 track: Plane (tool 6) is a height, 0..limit; every other tool +-limit. */
export function amplitudeFeetRange(tool: number, limit: number): [number, number] {
  return [tool === 6 ? 0 : -limit, limit];
}

/** AmplitudeFromText(AMPKIND_FEET): v from the box's feet; text that does not read as feet is 0. */
export function amplitudeFeetFromText(text: string): number {
  return parseFeet(text, -AMP_PARSE, AMP_PARSE) ?? 0;
}

/** SetAmplitudeBox on a v6 track: the amount held to the tool's range, in feet with 2 decimals. */
export function amplitudeFeetText(v: number, range: readonly [number, number]): string {
  return formatFeet(clamp(v, range[0], range[1]));
}

/** StepAmplitude on a v6 track: 1 ft a unit from the text as it reads, held to the range; v. */
export function stepAmplitudeFeet(text: string, units: number, range: readonly [number, number]): number {
  return clamp(amplitudeFeetFromText(text) + 128 * units, range[0], range[1]);
}

/*
  FollowAmplitudeKind: a stored amount (v) when the track's kind changes. To feet (limit > 0): held inside
  the new limit, the plane height not negative. From feet to another kind: inside 255 steps, whole steps on a
  classic 8-bit track (fractional false).
*/
export function followAmplitude(v: number, tool: number, limit: number, fractional: boolean): number {
  if (limit > 0) return clamp(v, tool === 6 ? 0 : -limit, limit);
  v = clamp(v, -AMPLITUDE_MAXV, AMPLITUDE_MAXV);
  return fractional ? v : terrainWholeSteps(v) * 256;
}

// ---- The Groundbox bar.

/** OnBuildingTop / OnBuildingBottom's parse bounds. */
const BOX_PARSE = 2000000000;

/** OnBuildingTop while typing: the top is taken only when it reads and is already inside (bottom, ceiling]; else null. */
export function boxTopWhileTyping(text: string, bottom: number, ceiling: number): number | null {
  const v = parseFeet(text, -BOX_PARSE, BOX_PARSE);
  return v !== null && v === clampBoxTop(v, bottom, ceiling) ? v : null;
}

/** OnBuildingBottom while typing: the bottom only when it reads and is already inside [0, top). */
export function boxBottomWhileTyping(text: string, top: number): number | null {
  const v = parseFeet(text, -BOX_PARSE, BOX_PARSE);
  return v !== null && v === clampBoxBottom(v, top) ? v : null;
}

/** OnBuildingTopKill: the box left; a blank or unreadable box goes back to `last`, the rest is held in range. */
export function boxTopOnLeave(text: string, last: number, bottom: number, ceiling: number): number {
  return clampBoxTop(parseFeet(text, -BOX_PARSE, BOX_PARSE) ?? last, bottom, ceiling);
}

export function boxBottomOnLeave(text: string, last: number, top: number): number {
  return clampBoxBottom(parseFeet(text, -BOX_PARSE, BOX_PARSE) ?? last, top);
}

/*
  FollowBuildingKind: the bar's two values (v) when the track's kind changes. To feet: the top inside (0,
  ceiling], the bottom under it. To classic: the nearest whole step, the top 1..255, the bottom 0..top - 1.
*/
export function followBoxBar(top: number, bottom: number, ceiling: number): { top: number; bottom: number } {
  if (ceiling > 0) {
    const t = clampBoxTop(top, 0, ceiling);
    return { top: t, bottom: clampBoxBottom(bottom, t) };
  }
  let t = (top + 128) >> 8, b = (bottom + 128) >> 8;
  t = clamp(t, 1, 255);
  if (b > t - 1) b = t - 1;
  if (b < 0) b = 0;
  return { top: t << 8, bottom: b << 8 };
}

// ---- The status bar.

/** ZIndicatorCode and the Z pane: whole steps on a classic track, feet with 2 decimals on a v6 one. */
export function zIndicatorText(z: number, feet: boolean): string {
  const zi = Math.trunc(z);
  if (feet) return `Z: ${formatFeet(Math.trunc((zi * 256) / ALTITUDE_SCALE))} ft`;
  return `Z: ${Math.trunc(zi / ALTITUDE_SCALE)}`;
}

// ---- Water levels: the main water (quarter steps) and the lakes are water units, half feet; a unit is 64 v.

/** The water level in feet (FormatFeet of units * 64). */
export function waterFeetText(units: number): string {
  return formatFeet(units * 64);
}

/** The Components water box on OK: units (rounded to the nearest), or null for text that is not feet. */
export function waterFromFeet(text: string, maxUnits: number): number | null {
  const v = parseFeet(text, 0, maxUnits * 64);
  return v === null ? null : (v + 32) >> 6;
}

/** OnDeltaposWaterLevel / LakeDlg HeightFromText: the box's units plus `delta`; unreadable text is 0. */
export function waterUnitsStep(text: string, delta: number, maxUnits: number): number {
  return (((parseFeet(text, 0, maxUnits * 64) ?? 0) + 32) >> 6) + delta;
}

/** WaterfallDlg FeetText and the lake readouts: half feet as feet, 2 decimals on a v6 track, %g otherwise. */
export function unitsFeetText(units: number, feet: boolean, g: (x: number) => string): string {
  return feet ? (units / 2).toFixed(2) : g(units / 2);
}

// ---- Truck Properties Z.

/** OnZSpin: 1 ft a unit from the text as it reads (or `last` when it does not read), not below 0; the shown v. */
export function truckZStep(text: string, units: number, last: number, limit: number): { last: number; shown: number } {
  let v = parseFeet(text, 0, limit) ?? last;
  v = Math.trunc(v + 128 * units);
  if (v < 0) v = 0;
  return { last: v, shown: v > limit ? limit : v };
}

/** OnOK: the feet to the nearest whole 2 ft step, held under the limit; null for text that is not feet. */
export function truckZFromFeet(text: string, limit: number): number | null {
  const v = parseFeet(text, 0, limit);
  if (v === null) return null;
  return Math.min((v + 128) >> 8, Math.trunc(limit / 256));
}

export const TRUCK_Z_FEET_MESSAGE = "Enter the height in feet, for example 24.5.";

// ---- Transitions.

/** FollowTrack: the threshold and the two altitudes (bytes on a classic track, v on a v6 one) carried over. */
export function followTransitions(values: { threshold: number; min: number; max: number }, wasFeet: boolean, limit: number):
  { threshold: number; min: number; max: number } {
  if (limit > 0) {
    const f = wasFeet ? values : { threshold: values.threshold * 256, min: values.min * 256, max: values.max * 256 };
    return { threshold: Math.min(f.threshold, limit), min: Math.min(f.min, limit), max: Math.min(f.max, limit) };
  }
  if (!wasFeet) return values;
  const byte = (v: number) => Math.min(255, (v + 128) >> 8);
  return { threshold: byte(values.threshold), min: byte(values.min), max: byte(values.max) };
}

/** ReadFeetBoxes: a box's text to v (0..limit), the last good value when it does not read. */
export function transitionFeet(text: string, last: number, limit: number): number {
  return parseFeet(text, 0, limit) ?? last;
}

/** StepFeetBox: 1 ft a unit from the text as it reads, held to 0..limit. */
export function transitionFeetStep(text: string, last: number, units: number, limit: number): number {
  return clamp(transitionFeet(text, last, limit) + 128 * units, 0, limit);
}
