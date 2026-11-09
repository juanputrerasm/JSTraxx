/*
  The terrain edit bar's Altitude box and brush size, Traxx 1.7 (Traxx/TraxxFrame.cpp:
  AmplitudeFractional, AmplitudeFromBox, SetAmplitudeBox, StepAmplitude, FollowAmplitudeKind,
  EditSizeMax, OnUpdateEditSizeRange).

  Amounts travel in v (1/256 step). A track with 16-bit heights (anything but Classic 8-bit)
  takes a decimal number of steps, shows it with up to 2 decimals and moves 0.1 a click; a
  classic 8-bit track keeps whole steps and rounds anything typed to the nearest whole step,
  half away from zero (TerrainWholeSteps). The brush is 1-25 cells, or 1-100 8 ft points on a
  Full Map.
*/
import { AMPLITUDE_MAXV, EDITSIZE_MAX_COARSE, EDITSIZE_MAX_FINE, formatV, terrainWholeSteps } from "./terrain.ts";
import { TERRAINMODE_CLASSIC8, TERRAINMODE_FINE } from "../traxx/terrain16.ts";

/** AmplitudeFractional: the open track has 16-bit heights. No track: whole steps. */
export function amplitudeFractional(terrainMode: number | null): boolean {
  return terrainMode !== null && terrainMode !== TERRAINMODE_CLASSIC8;
}

/** EditSizeMax: 100 8 ft points on a Full Map, 25 cells otherwise (and with no track). */
export function editSizeMax(terrainMode: number | null): number {
  return terrainMode === TERRAINMODE_FINE ? EDITSIZE_MAX_FINE : EDITSIZE_MAX_COARSE;
}

/** strtod on the box text, a decimal comma read as a point; nothing readable is 0. */
function readBox(text: string): number {
  const x = parseFloat(text.trim().replace(/,/g, "."));
  return Number.isNaN(x) ? 0 : x;
}

/**
  AmplitudeFromBox: v from the box text. Not clamped to +-255 (the caller does that), only kept
  far from overflow; on a classic track the nearest whole step, half away from zero.
*/
export function amplitudeFromText(text: string, fractional: boolean): number {
  let x = readBox(text);
  if (x > 100000) x = 100000;
  else if (x < -100000) x = -100000;
  if (!fractional) x = x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5);
  return Math.floor(x * 256 + 0.5);
}

/**
  SetAmplitudeBox's text for v: on a 16-bit track up to 2 decimals ("%.2f", exact ties to even
  as the C runtime prints them), trailing zeros and point trimmed, "-0" as "0", clamped to
  +-255 steps; on a classic track the whole step, which the spin holds to +-255.
*/
export function amplitudeText(v: number, fractional: boolean): string {
  if (!fractional) return String(Math.max(-255, Math.min(255, terrainWholeSteps(v))));
  v = Math.max(-AMPLITUDE_MAXV, Math.min(AMPLITUDE_MAXV, v));
  const text = formatV(v, 2).replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" ? "0" : text;
}

/** StepAmplitude: 0.1 a unit from the text as it reads (so clicks never drift), held to +-255; v. */
export function stepAmplitude(text: string, tenths: number): number {
  let x = readBox(text) + 0.1 * tenths;
  if (x > 255) x = 255;
  else if (x < -255) x = -255;
  return Math.floor(x * 256 + 0.5);
}

/** FollowAmplitudeKind: a value kept in v brought to whole steps when the track becomes classic. */
export function wholeAmplitude(v: number): number {
  return terrainWholeSteps(v) * 256;
}
