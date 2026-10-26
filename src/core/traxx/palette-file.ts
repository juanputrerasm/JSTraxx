/*
  The palette files the Track Palette dialog opens and saves (Traxx 1.6.7,
  Traxx/TrackPaletteDlg.cpp OnPaletteOpen and OnPaletteSave): a Microsoft RIFF palette (.PAL)
  or a bare .ACT.

  The .PAL Traxx writes is a fixed 24-byte header (RIFF, size 0x414, "PAL ", "data", size
  0x408, version 0x300, 256 entries), the 256 entries as red, green, blue and flags, and four
  zero bytes. Traxx reads one by skipping 24 bytes and taking the 1024 after them. An .ACT is
  the 256 red, green and blue triples.
*/

const PAL_HEADER = Uint8Array.of(
  0x52, 0x49, 0x46, 0x46, 0x14, 0x04, 0x00, 0x00,
  0x50, 0x41, 0x4c, 0x20, 0x64, 0x61, 0x74, 0x61,
  0x08, 0x04, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01,
);

/** A .PAL as Traxx reads it: 768 RGB bytes, or null when the file is too short. */
export function readPalFile(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 24 + 1024) return null;
  const rgb = new Uint8Array(768);
  for (let i = 0; i < 256; i++) rgb.set(bytes.subarray(24 + 4 * i, 24 + 4 * i + 3), 3 * i);
  return rgb;
}

/** A .PAL as Traxx writes it, the flags 0. */
export function writePalFile(rgb: Uint8Array): Uint8Array {
  const out = new Uint8Array(24 + 1024 + 4);
  out.set(PAL_HEADER);
  for (let i = 0; i < 256; i++) out.set(rgb.subarray(3 * i, 3 * i + 3), 24 + 4 * i);
  return out;
}

/** An .ACT as Traxx reads it: the first 768 bytes, or null when the file is too short. */
export function readActFile(bytes: Uint8Array): Uint8Array | null {
  return bytes.length >= 768 ? bytes.slice(0, 768) : null;
}

export function writeActFile(rgb: Uint8Array): Uint8Array {
  return rgb.slice(0, 768);
}
