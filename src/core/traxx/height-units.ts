/*
  Feet for the heights of a v6 track (Traxx origin/main, Traxx/HeightUnits.cpp and HeightUnits.h). A height is
  v, in 1/128 ft, everywhere it is stored; feet exist only in what is shown and what is typed. A classic track
  never uses any of this (HeightsInFeet).
*/
import { isV6, type HasTrackKind } from "./track-kind.ts";

/** HeightsInFeet: this track's heights are shown and taken in feet (a v6 track). */
export function heightsInFeet(t: HasTrackKind): boolean {
  return isV6(t);
}

/**
  FormatFeet: v / 128 with two decimals, as sprintf("%.2f") prints the exact value (a tie, which only a multiple
  of 1/128 ft ending in 5 thousandths can be, goes to the even hundredth as the CRT rounds it).
*/
export function formatFeet(v: number): string {
  const neg = v < 0;
  const a = Math.abs(Math.trunc(v));
  // a / 128 ft in hundredths is a * 25 / 32.
  const num = a * 25;
  let q = Math.floor(num / 32);
  const r = num - q * 32;
  if (r > 16 || (r === 16 && (q & 1) === 1)) q++;
  const whole = Math.floor(q / 100), cents = q % 100;
  return `${neg ? "-" : ""}${whole}.${cents < 10 ? "0" : ""}${cents}`;
}

/** FeetToV: round(ft * 128), kept far from int overflow; 0 for NaN. */
export function feetToV(ft: number): number {
  if (Number.isNaN(ft)) return 0;
  let v = Math.floor(ft * 128 + 0.5);
  if (v > 1e9) v = 1e9;
  else if (v < -1e9) v = -1e9;
  return v;
}

/** VToFeet: v / 128. */
export function vToFeet(v: number): number {
  return v / 128;
}

/* What strtod reads at the start of the text: a decimal number with an optional exponent, a hexadecimal one, or inf / infinity. */
const STRTOD = /^[+-]?(?:0[xX](?:[0-9a-fA-F]+\.?[0-9a-fA-F]*|\.[0-9a-fA-F]+)(?:[pP][+-]?\d+)?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan)/i;

function strtod(text: string): { value: number; length: number } | null {
  const m = STRTOD.exec(text);
  if (!m) return null;
  const s = m[0];
  const sign = s[0] === "-" ? -1 : 1;
  const body = s.replace(/^[+-]/, "");
  let value: number;
  if (/^inf/i.test(body)) value = Infinity;
  else if (/^nan/i.test(body)) value = NaN;
  else if (/^0x/i.test(body)) {
    const [mant, exp] = body.slice(2).split(/[pP]/);
    const [ip, fp = ""] = mant!.split(".");
    value = parseInt(ip || "0", 16);
    for (let i = 0; i < fp.length; i++) value += parseInt(fp[i]!, 16) / 16 ** (i + 1);
    if (exp !== undefined) value *= 2 ** Number(exp);
  } else value = Number(body);
  return { value: sign * value, length: s.length };
}

/**
  ParseFeet: a typed number of feet (a decimal comma is a point) to v, rounded to the nearest 1/128 ft, then
  clamped to [lo, hi]. Null for blank, non-numeric text, trailing junk or NaN.
*/
export function parseFeet(text: string | null | undefined, lo: number, hi: number): number | null {
  if (text === null || text === undefined) return null;
  let buf = text.slice(0, 63).replace(/,/g, ".");
  buf = buf.replace(/^[ \t]+/, "");
  if (buf === "") return null;
  const n = strtod(buf);
  if (!n) return null;
  const rest = buf.slice(n.length).replace(/^[ \t]+/, "");
  if (rest !== "" || Number.isNaN(n.value)) return null;
  let r = feetToV(n.value);
  if (r < lo) r = lo;
  if (r > hi) r = hi;
  return r;
}

/** ClampBoxTop: a v6 ground box's top in (bottom, ceiling]; at or below the bottom it is bottom + 1. */
export function clampBoxTop(top: number, bottom: number, ceiling: number): number {
  const lo = bottom + 1;
  if (top > ceiling) top = ceiling;
  if (top < lo) top = lo;
  return top;
}

/** ClampBoxBottom: a v6 ground box's bottom in [0, top); at or above the top it is top - 1. */
export function clampBoxBottom(bottom: number, top: number): number {
  if (bottom > top - 1) bottom = top - 1;
  if (bottom < 0) bottom = 0;
  return bottom;
}

/** BoxByte: the classic .RA0 / .RA1 byte of a box height v, v >> 8 held to 0..255. */
export function boxByte(v: number): number {
  const b = v >> 8;
  return b < 0 ? 0 : b > 255 ? 255 : b;
}
