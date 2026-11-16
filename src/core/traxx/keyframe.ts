/*
  An animated ("keyframe") model's frame-name table, as Traxx 1.8.0 reads it (eaaace7,
  Include/TrackPODKeyframe.h, CTrackPODModel::GetAniName / CountAniFrames).

  Engine layout (engine\3D.H keyFrameStruct / keyFrame64Struct):
    MRGL_KEYFRAME   (32)  six ints (type, scale, n, timePerFrame, counter, rtSlot), then
                          char modelFile[16][16], then 16 ints of padding: 344 bytes.
    MRGL_KEYFRAME64 (65)  the same six ints, then char modelFile[64][64], then 64 ints: 4376 bytes.
  n is the int at byte 8 and the names start at byte 24 for both. A name with no NUL uses its
  whole field (a 16-character KEYFRAME name is 16 characters, not 15). n is clamped to the
  table capacity (keyFrameCheck) and to the names wholly inside the record.

  OpenPhotex's parseBin reads type 32 records only (its "animated" kind, trimming each name), so
  Traxx's rule is kept here and the model loaders use it for both widths.
*/

export const KEYFRAME_TYPE = 32;
export const KEYFRAME64_TYPE = 65;
/** ANIFRAMENAMELEN: a buffer that holds any frame name plus its terminator (64 + 1). */
export const ANIFRAMENAMELEN = 65;
/** ANIFRAMEPODNAMEMAX: MODELNAMELEN - 1 - 7, the longest frame name that can be a MODELS\ pod entry. */
export const ANIFRAMEPODNAMEMAX = 32 - 1 - 7;

const rdInt = (p: Uint8Array, at: number) => (p[at]! | (p[at + 1]! << 8) | (p[at + 2]! << 16) | (p[at + 3]! << 24));

/** KeyframeWidth: 16 for KEYFRAME, 64 for KEYFRAME64, 0 otherwise or when shorter than its header. */
export function keyframeWidth(rec: Uint8Array): number {
  if (rec.length < 24) return 0;
  switch (rdInt(rec, 0)) {
    case KEYFRAME_TYPE: return 16;
    case KEYFRAME64_TYPE: return 64;
  }
  return 0;
}

/** KeyframeCount: n clamped to the capacity and to the names wholly inside the record; 0 when not a keyframe record. */
export function keyframeCount(rec: Uint8Array): number {
  const w = keyframeWidth(rec);
  if (w === 0) return 0;
  let n = rdInt(rec, 8);
  if (n > w) n = w;
  if (n < 0) n = 0;
  const fits = Math.trunc((rec.length - 24) / w);
  if (n > fits) n = fits;
  return n;
}

/** KeyframeName: frame `which` exactly as stored (latin-1, no case change), or null outside 0..count-1. */
export function keyframeName(rec: Uint8Array, which: number, outmax = ANIFRAMENAMELEN): string | null {
  const w = keyframeWidth(rec);
  if (w === 0 || which < 0 || which >= keyframeCount(rec) || outmax < 1) return null;
  const at = 24 + which * w;
  let s = "";
  for (let i = 0; i < w && i < outmax - 1 && rec[at + i] !== 0; i++) s += String.fromCharCode(rec[at + i]!);
  return s;
}

/** _strupr in the C locale: ASCII letters only. */
const upper = (s: string) => s.replace(/[a-z]+/g, (m) => m.toUpperCase());

/** CTrackPODModel::GetAniName for every frame: the names upper-cased, whole (ANIFRAMENAMELEN). */
export function modelFrameNames(bytes: Uint8Array): string[] {
  const n = keyframeCount(bytes);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(upper(keyframeName(bytes, i)!));
  return out;
}

/** True when a frame name cannot be a MODELS\ pod entry (longer than ANIFRAMEPODNAMEMAX); the loaders skip it. */
export function frameNameTooLongForPod(name: string): boolean {
  return name.length > ANIFRAMEPODNAMEMAX;
}

/** VegTrunkFirstFrame (VegetationTrunk.cpp, through KeyframeName): frame 0's name as stored, or null when empty or not keyframed. */
export function keyframeFirstFrame(bytes: Uint8Array): string | null {
  const name = keyframeName(bytes, 0);
  return name ? name : null;
}
