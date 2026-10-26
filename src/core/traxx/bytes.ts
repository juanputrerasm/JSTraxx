/* Small byte helpers shared by the Traxx modules. */

export function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bytes up to the first NUL, as windows-1252 text. */
export function cText(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder("windows-1252").decode(end >= 0 ? bytes.subarray(0, end) : bytes);
}
