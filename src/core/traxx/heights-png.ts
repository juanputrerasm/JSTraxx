/*
  "Store heights as PNG" on Write POD (Traxx 1.7, contract 2a: TrackPOD/TrackPODFile.cpp
  EncodeHeightsPng and the THE HEIGHTS block of the pod writer; the .TXV's terrainHeights= in
  WriteTXVFile).

  Classic 8-bit packs DATA\<stem>.RAW whatever the setting, so a build that predates
  terrainHeights= (retail included) reads what it always did; with the setting it ALSO packs the
  PNG (the same values at 8 bits). Every other mode with the setting packs the PNG ONLY, in the
  .RAW's place, and the .TXV names it. The .LVL still names the .RAW.
*/

import { heightPngEncode } from "./height-image.ts";
import { syncFromRaw, TERRAINMODE_CLASSIC8, type Terrain16 } from "./terrain16.ts";

/** A POD directory entry name is char[32]: 31 characters and the terminator. */
const POD_NAME_SIZE = 32;

/**
  EncodeHeightsPng: the heights PNG Write POD packs, after SyncFromRaw folds 8-bit tool edits in:
  8-bit 256 x 256 on Classic 8-bit (raw << 8, which the 8-bit encoder gives back exactly), 16-bit
  1024 x 1024 on a Full Map, otherwise the 16-bit 256 grid (Spline writes its source points, as its
  .RAW does). null when the track has no grid to write.
*/
export function encodeHeightsPng(t: Terrain16): Uint8Array | null {
  syncFromRaw(t);
  if (t.terrainMode === TERRAINMODE_CLASSIC8) {
    const v = new Uint16Array(256 * 256);
    for (let i = 0; i < 256 * 256; i++) v[i] = t.heights[i]! << 8;
    return heightPngEncode(v, 256, 8);
  }
  if (t.fine) return heightPngEncode(t.fine, 1024, 16);
  if (t.h16) return heightPngEncode(t.h16, 256, 16);
  return null;
}

/** The pod entry the heights PNG is packed as: DATA\<stem>_H.PNG. */
export function heightsPngEntryName(prefix: string): string {
  return `DATA\\${prefix}_H.PNG`;
}

/**
  The Write POD heights items, in pod order, in place of the plain DATA\<stem>.RAW item:
    raw      DATA\<stem>.RAW is packed (saveRaw's bytes): setting off, or Classic 8-bit
    png      DATA\<stem>_H.PNG and its bytes, right after the .RAW when there is one; null without the setting
    txvKey   the terrainHeights= value for WriteTXVFile, "" for no key
  error is Traxx's "Cannot build the pod" message when the PNG cannot go in; then nothing is written.
*/
export interface HeightsPodPlan {
  raw: boolean;
  png: { name: string; bytes: Uint8Array } | null;
  txvKey: string;
  error: string | null;
}

export const HEIGHTS_PNG_WRITE_FAILED = "The terrain heights PNG could not be written into the pod (the disk may be full, or there is not enough memory).\n\nNothing was written. The existing pod, if any, is untouched.";
export const HEIGHTS_PNG_NAME_TOO_LONG = "The terrain heights PNG's name (DATA\\<track file name>_H.PNG) does not fit a pod entry. Shorten the track file name.\n\nNothing was written. The existing pod, if any, is untouched.";

/**
  The THE HEIGHTS block of Write POD. pngHeights is the track's "Store heights as PNG"
  (CTrackPOD::GetHeightsAsPng). The name must fit a POD entry (5 + stem + 6 < 32, a stem of at most
  20 characters, which Pod1StemBudget already holds every track to).
*/
export function heightsPodPlan(t: Terrain16, prefix: string, pngHeights: boolean): HeightsPodPlan {
  const raw = !pngHeights || t.terrainMode === TERRAINMODE_CLASSIC8;
  if (!pngHeights) return { raw, png: null, txvKey: "", error: null };
  const fits = "DATA\\".length + prefix.length + "_H.PNG".length < POD_NAME_SIZE;
  if (!fits) return { raw, png: null, txvKey: "", error: HEIGHTS_PNG_NAME_TOO_LONG };
  const bytes = encodeHeightsPng(t);
  if (!bytes) return { raw, png: null, txvKey: "", error: HEIGHTS_PNG_WRITE_FAILED };
  const name = heightsPngEntryName(prefix);
  return { raw, png: { name, bytes }, txvKey: name, error: null };
}
