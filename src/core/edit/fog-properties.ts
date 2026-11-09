/*
  Fog Properties (IDD_FOG_PROPERTIES; Traxx/FogPropertiesDlg.cpp), the logic without the DOM:

    fogDialogStart     OnInitDialog: the field texts, the Round percent, the colour and weathers
    fogDialogDefaults  OnFogDefaults: the new-object set (FOGDEF_*, round and wisp FOGNEW_*)
    fogHeightsText     UpdateHeights: "Floor 96 ft, top 136 ft"
    fogPreview         PreviewFog: the working copy with what the preview draws read off the fields
    validateFogFields  DoDataExchange: DDX_Text float parsing and the DDV_MinMaxFloat ranges
    fogDialogResult    OnOK: the clamps, the Round rule and ClampFog, the size from the box

  The volume's size is not edited here: a Fog is always a model-less box and its own Size is the
  volume (FogPropertiesDlg.h). The three sizes are shown read-only, taken from the box.
*/
import { cAtof, f32 } from "../traxx/cformat.ts";
import { clampTraxxFog, traxxFogDefaults, type TraxxBox, type TraxxFog } from "../traxx/sit.ts";

/** The nine weathers, in bit order: wmask bit (1 << i) is entry i (kFogWeatherIDs). */
export const FOG_WEATHERS = ["Clear", "Cloudy", "Foggy", "Dense fog", "Rain", "Snow", "Dusk", "Night", "Pitch black"] as const;

/** The edit fields, in DoDataExchange's order (IDC_FOGW .. IDC_FOGWSPEED). */
export const FOG_FIELDS = ["w", "l", "h", "base", "vis", "half", "edge", "top", "bot", "maxop", "wisp", "wsize", "wspeed"] as const;
export type FogField = (typeof FOG_FIELDS)[number];
export type FogFieldTexts = Record<FogField, string>;

/**
  DDV_MinMaxFloat's ranges (DoDataExchange). The sizes have none: they are display only.
  maxop and wisp are percents here (the file holds 0..1).
*/
export const FOG_RANGES: Partial<Record<FogField, [number, number]>> = {
  base: [-10000, 10000],
  vis: [1, 100000],
  half: [0, 100000],
  edge: [0, 100000],
  top: [0, 100000],
  bot: [0, 100000],
  maxop: [0, 100],
  wisp: [0, 100],
  wsize: [1, 100000],
  wspeed: [0, 100000],
};

/** The box the dialog reads its size and height from (CFogPropertiesDlg::box). */
export type FogBox = Pick<TraxxBox, "width" | "length" | "height" | "ipos" | "fraction">;

export interface FogDialogState {
  texts: FogFieldTexts;
  /** The Round trackbar, 0..100. */
  round: number;
  /** m_colour, 0..255 per channel. */
  rgb: [number, number, number];
  wmask: number;
}

/** DDX_Text of a float: "%.*g" with FLT_DIG (6) digits. */
export function ddxFloatText(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  return String(Number(f32(v).toPrecision(6)));
}

/**
  _AfxSimpleFloatParse: leading blanks, a number, trailing blanks and nothing else. A value of 0
  whose text does not start with '0' is refused, as MFC refuses it (so "" and ".0" are not numbers).
*/
export function ddxParseFloat(text: string): number | null {
  const s = text.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
  const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s);
  if (!m || m[0].length !== s.length) return null;
  const d = Number(m[0]);
  if (d === 0 && s[0] !== "0") return null;
  return f32(d);
}

/**
  ReadDlgFloat: the raw text, not UpdateData, so a half-typed number does not put up a message.
  An empty field keeps `fallback`; otherwise atof, clamped to lo..hi.
*/
export function readDlgFloat(text: string, fallback: number, lo: number, hi: number): number {
  const t = text.trim();
  if (!t) return fallback;
  let v = f32(cAtof(t));
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  return v;
}

/** FogToColorref: 0..1 floats to bytes, rounded to nearest and clamped. */
export function fogToRgb(fog: Pick<TraxxFog, "r" | "g" | "b">): [number, number, number] {
  const byte = (v: number) => Math.min(255, Math.max(0, Math.trunc(f32(v * 255) + 0.5)));
  return [byte(fog.r), byte(fog.g), byte(fog.b)];
}

/** ColorrefToFog: bytes back to 0..1. */
export function rgbToFog(rgb: readonly [number, number, number], fog: TraxxFog): void {
  fog.r = f32(rgb[0] / 255);
  fog.g = f32(rgb[1] / 255);
  fog.b = f32(rgb[2] / 255);
}

/** FormatFeet: whole feet shown whole ("96"), anything else to one decimal ("96.5"). */
export function formatFeet(v: number): string {
  return Math.abs(v - Math.floor(v + 0.5)) < 0.05 ? v.toFixed(0) : v.toFixed(1);
}

/** The Round trackbar's readout beside it (SetRoundPercent). */
export function roundPercentText(percent: number): string {
  return `${Math.min(100, Math.max(0, Math.trunc(percent)))} %`;
}

/** The fog's round as the trackbar's whole percent ((int)(round*100 + 0.5)). */
export function roundToPercent(round: number): number {
  return Math.min(100, Math.max(0, Math.trunc(f32(round * 100) + 0.5)));
}

/**
  UpdateHeights: the object's height in feet is the .SIT's own z, 2*ipos[2] + zfraction/128
  (ipos[2] counts 2-foot steps), the floor that plus the base field, the top the floor plus the
  box's height.
*/
export function fogHeightsText(box: FogBox, baseText: string, base: number): string {
  const objft = f32(2 * box.ipos[2] + box.fraction[2] / 128);
  const basev = readDlgFloat(baseText, base, -100000, 100000);
  const floorft = f32(objft + basev);
  const topft = f32(floorft + box.height);
  return `Floor ${formatFeet(floorft)} ft, top ${formatFeet(topft)} ft`;
}

/** OnInitDialog: the box's size, the fog clamped into what the fields accept, as texts. */
export function fogDialogStart(fogIn: TraxxFog, box: FogBox | null): FogDialogState {
  const fog = { ...fogIn };
  clampTraxxFog(fog);
  let maxop = f32(fog.maxop * 100);
  if (maxop < 0) maxop = 0;
  if (maxop > 100) maxop = 100;
  let wisp = f32(fog.wisp * 100);
  if (wisp < 0) wisp = 0;
  if (wisp > 100) wisp = 100;
  let wsize = fog.wsize;
  if (!(wsize >= 1)) wsize = 1;
  let wspeed = fog.wspeed;
  if (!(wspeed >= 0)) wspeed = 0;
  const t = ddxFloatText;
  return {
    texts: {
      w: t(box ? box.width : 0), l: t(box ? box.length : 0), h: t(box ? box.height : 0),
      base: t(fog.base), vis: t(fog.vis), half: t(fog.half), edge: t(fog.edge), top: t(fog.top), bot: t(fog.bot),
      maxop: t(maxop), wisp: t(wisp), wsize: t(wsize), wspeed: t(wspeed),
    },
    round: roundToPercent(fog.round),
    rgb: fogToRgb(fog),
    wmask: fog.wmask,
  };
}

/**
  OnFogDefaults: the new-object set (round 100 %, wisps 50 %), what a fresh Fog starts with.
  The size is the box's and is not touched, so the size texts are not part of it.
*/
export function fogDialogDefaults(): Omit<FogDialogState, "texts"> & { texts: Omit<FogFieldTexts, "w" | "l" | "h"> } {
  const d = traxxFogDefaults();
  const t = ddxFloatText;
  return {
    texts: {
      base: t(d.base), vis: t(d.vis), half: t(d.half), edge: t(d.edge), top: t(d.top), bot: t(d.bot),
      maxop: t(f32(d.maxop * 100)), wisp: t(f32(d.wisp * 100)), wsize: t(d.wsize), wspeed: t(d.wspeed),
    },
    round: roundToPercent(d.round),
    rgb: fogToRgb(d),
    wmask: d.wmask,
  };
}

/**
  PreviewFog: the working copy with the fields the viewport volume draws read off the dialog:
  the floor (base), the opacity cap, the roundness, the wisps and drift (for the drift arrow)
  and the colour.
*/
export function fogPreview(fog: TraxxFog, texts: Pick<FogFieldTexts, "base" | "maxop" | "wisp" | "wspeed">, round: number, rgb: readonly [number, number, number]): TraxxFog {
  const p = { ...fog };
  p.base = readDlgFloat(texts.base, fog.base, -100000, 100000);
  p.maxop = f32(readDlgFloat(texts.maxop, f32(fog.maxop * 100), 0, 100) / 100);
  p.round = f32(Math.min(100, Math.max(0, round)) / 100);
  p.wisp = f32(readDlgFloat(texts.wisp, f32(fog.wisp * 100), 0, 100) / 100);
  p.wspeed = readDlgFloat(texts.wspeed, fog.wspeed, 0, 100000);
  rgbToFog(rgb, p);
  return p;
}

/** DDV_MinMaxFloat's message (AFX_IDP_PARSE_REAL_RANGE), the bounds as "%.*g". */
export function ddvRangeMessage(lo: number, hi: number): string {
  return `Please enter a number between ${ddxFloatText(lo)} and ${ddxFloatText(hi)}.`;
}

/**
  UpdateData(TRUE): each field in turn, as DoDataExchange has them. The first that is not a
  number (AFX_IDP_PARSE_REAL) or is out of its range stops it: the field and the message.
*/
export function validateFogFields(texts: FogFieldTexts): { field: FogField; message: string } | { values: Record<FogField, number> } {
  const values = {} as Record<FogField, number>;
  for (const field of FOG_FIELDS) {
    const v = ddxParseFloat(texts[field]);
    if (v === null) return { field, message: "Please enter a number." };
    const range = FOG_RANGES[field];
    if (range && (v < range[0] || v > range[1])) return { field, message: ddvRangeMessage(range[0], range[1]) };
    values[field] = v;
  }
  return { values };
}

/**
  OnOK after DDV passed: the fields onto the fog, the Round rule (keep a file's finer value
  unless the trackbar was moved), ClampFog, and w/l/h following the box's Size.
*/
export function fogDialogResult(fogIn: TraxxFog, values: Record<FogField, number>, round: number, rgb: readonly [number, number, number], wmask: number, box: FogBox | null): TraxxFog {
  const fog = { ...fogIn };
  const pos = (v: number) => (v < 0 ? 0 : v);
  fog.base = values.base;
  fog.vis = values.vis;
  fog.half = pos(values.half);
  fog.edge = pos(values.edge);
  fog.top = pos(values.top);
  fog.bot = pos(values.bot);
  fog.maxop = f32(values.maxop / 100);
  fog.wmask = wmask;
  const percent = Math.min(100, Math.max(0, Math.trunc(round)));
  if (percent !== Math.trunc(f32(fog.round * 100) + 0.5)) fog.round = f32(percent / 100);
  else if (!(fog.round >= 0)) fog.round = 0;
  else if (fog.round > 1) fog.round = 1;
  fog.wisp = f32(values.wisp / 100);
  fog.wsize = values.wsize;
  fog.wspeed = values.wspeed;
  rgbToFog(rgb, fog);
  clampTraxxFog(fog);
  if (box) {
    fog.w = box.width;
    fog.l = box.length;
    fog.h = box.height;
  }
  return fog;
}

/** FillWeathers / ReadWeathers. */
export const weatherChecked = (mask: number, i: number) => (mask & (1 << i)) !== 0;
export function weatherMask(checked: readonly boolean[]): number {
  let mask = 0;
  checked.forEach((c, i) => { if (c && i < 9) mask |= 1 << i; });
  return mask;
}
