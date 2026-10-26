/*
  The C library's number conversions as Traxx (MSVC, UCRT) performs them, for writers that have
  to reproduce Traxx's text byte for byte and readers that have to read it as Traxx does.

  printf("%.6f") rounds the value's exact binary expansion to the nearest, ties to even (the
  UCRT has been correctly rounded since Visual Studio 2019 16.2). JavaScript's toFixed breaks
  ties upward instead, and ties are common in Traxx's output: a position is a whole number of
  1/512 SIT units, so a fraction of 4/256 of an ipos step prints as x.0078125, exactly halfway.

  Traxx keeps most quantities as 32-bit floats, so callers round with f32 (Math.fround) where
  Traxx's own code holds or casts to a float.
*/

/** A 32-bit float, as a C `float` holds the value. */
export const f32 = Math.fround;

const DOUBLE_VIEW = new DataView(new ArrayBuffer(8));

/** printf("%.<digits>f", value): the exact binary value, rounded to nearest, ties to even. */
export function cFixed(value: number, digits = 6): string {
  if (Number.isNaN(value)) return "nan";
  const negative = value < 0 || Object.is(value, -0);
  const magnitude = Math.abs(value);
  if (magnitude === Infinity) return negative ? "-inf" : "inf";

  DOUBLE_VIEW.setFloat64(0, magnitude);
  const hi = DOUBLE_VIEW.getUint32(0), lo = DOUBLE_VIEW.getUint32(4);
  const biased = hi >>> 20;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exponent: number;
  if (biased === 0) exponent = -1074;
  else { mantissa |= 1n << 52n; exponent = biased - 1075; }

  const scale = 10n ** BigInt(digits);
  let scaled: bigint;
  if (exponent >= 0) scaled = (mantissa << BigInt(exponent)) * scale;
  else {
    const denominator = 1n << BigInt(-exponent);
    const numerator = mantissa * scale;
    scaled = numerator / denominator;
    const twice = 2n * (numerator % denominator);
    if (twice > denominator || (twice === denominator && (scaled & 1n) === 1n)) scaled += 1n;
  }

  let text = scaled.toString().padStart(digits + 1, "0");
  if (digits > 0) text = `${text.slice(0, -digits)}.${text.slice(-digits)}`;
  return negative ? `-${text}` : text;
}

/** printf("%d"): a C int. */
export function cInt(value: number): string {
  return String(Math.trunc(value) | 0);
}

const FLOAT_PREFIX = /^[ \t\n\v\f\r]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/;
const INT_PREFIX = /^[ \t\n\v\f\r]*([+-]?\d+)/;

/** atof(): the longest number at the start of the text, 0 when there is none. */
export function cAtof(text: string | null | undefined): number {
  const match = FLOAT_PREFIX.exec(text ?? "");
  return match ? Number(match[1]) : 0;
}

/** atoi(): the leading integer, 0 when there is none. */
export function cAtoi(text: string | null | undefined): number {
  const match = INT_PREFIX.exec(text ?? "");
  return match ? Number.parseInt(match[1], 10) | 0 : 0;
}

/** (int)x for a double: truncation toward zero. */
export function cTrunc(value: number): number {
  return Math.trunc(value) | 0;
}
