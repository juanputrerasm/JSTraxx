/*
  How Traxx finds things in a POD (TrackPOD/TrackPODFile.cpp). The rules differ from the
  game's and from OpenPhotex's neutral lookups, so they live here:

    SeekToItem   a name with a backslash matches an entry's full name; a bare name matches
                 everything after an entry's FIRST backslash (so it never finds an entry that
                 sits in no folder). Upper case, first match, and an empty entry is a miss.
    PodSwapExt   the same name with another extension.
    Pod1RawSide  a legacy tile's side from its byte count: 32, 64 ... 1024 squared, else 0.
*/
import type { PodEntry } from "../../vendor/openphotex/pod/types.js";

export const POD1_RAW_MIN_SIDE = 32;
export const POD1_RAW_MAX_SIDE = 1024;

export function seekToItem(entries: readonly PodEntry[], name: string): PodEntry | null {
  const key = name.toUpperCase();
  const full = key.includes("\\");
  for (const e of entries) {
    let candidate: string;
    if (full) candidate = e.name.slice(0, 60).toUpperCase();
    else {
      const sep = e.name.indexOf("\\");
      if (sep < 0) continue;
      candidate = e.name.slice(sep + 1, sep + 61).toUpperCase();
    }
    if (candidate === key) return e.length < 1 ? null : e;
  }
  return null;
}

/** PodSwapExt: the stem (up to the last dot of the last path part) plus "." + ext. */
export function swapExt(name: string, ext: string): string {
  const slash = Math.max(name.lastIndexOf("\\"), name.lastIndexOf("/"));
  const dot = name.lastIndexOf(".");
  const stem = dot > slash ? dot : name.length;
  return `${name.slice(0, stem)}.${ext}`;
}

export function rawSide(bytes: number): number {
  for (let side = POD1_RAW_MIN_SIDE; side <= POD1_RAW_MAX_SIDE; side <<= 1) if (bytes === side * side) return side;
  return 0;
}

/** PodIsHDItemName: a .PNG or .TGA entry. */
export function isHdName(name: string): boolean {
  return /\.(png|tga)$/i.test(name);
}

/*
  PodResolveItemName: the entry a name recorded in a model or a .TEX means. Verbatim first,
  then the .RAW of the same stem, then its .PNG and .TGA. The name back unchanged when
  nothing answers.
*/
export function resolveItemName(entries: readonly PodEntry[], name: string): string {
  if (!name || seekToItem(entries, name)) return name;
  for (const ext of ["RAW", "PNG", "TGA"]) {
    const cand = swapExt(name, ext);
    if (cand.toUpperCase() !== name.toUpperCase() && seekToItem(entries, cand)) return cand;
  }
  return name;
}

/** POD1_NAME_MAX and the cap the tools keep to (POD1_TOOL_STEM_MAX). */
export const POD1_NAME_MAX = 31;
const POD1_TOOL_STEM_MAX = 18;

/** Pod1StemBudget: the longest stem "<dir><stem><ext>" can hold, capped at the tools' 18. */
export function pod1StemBudget(dirPrefix: string, ext: string): number {
  return Math.max(0, Math.min(POD1_NAME_MAX - dirPrefix.length - ext.length, POD1_TOOL_STEM_MAX));
}

/** The map siblings a texture stem must carry (g_podMapSuffix), and the terrain-only ones. */
export const MAP_SUFFIXES = ["_N", "_AO"];
const TERRAIN_SUFFIXES = ["_DTL", "_MASK"];

/** Pod1ArtStemBudget: the stem fits ART\ with .RAW, .ACT, .PNG, .TGA and every map sibling. */
export function pod1ArtStemBudget(): number {
  const exts = [".RAW", ".ACT", ".PNG", ".TGA", ...MAP_SUFFIXES.flatMap((s) => [`${s}.PNG`, `${s}.TGA`])];
  return Math.min(...exts.map((e) => pod1StemBudget("ART\\", e)));
}

/** Pod1StemRefusal: why a name is too long, with the limit that bit. */
export function pod1StemRefusal(dirPrefix: string, ext: string, name: string): string {
  const budget = pod1StemBudget(dirPrefix, ext);
  if (budget >= POD1_TOOL_STEM_MAX) {
    return `"${name}" is too long.\n\nNames are limited to ${budget} characters plus the ${ext} extension.\n\n`
      + `A pod entry could hold a little more, but Traxx, binedit and c-pod all keep to ${POD1_TOOL_STEM_MAX} so that a track written by one of them opens correctly in the others.`;
  }
  return `"${name}" is too long for a track pod.\n\nNames in ${dirPrefix} are limited to ${budget} characters plus the ${ext} extension - a pod directory entry is ${POD1_NAME_MAX} characters in total, including the folder and the extension.\n\n`
    + "Longer names would need the extended pod format, which no version of the game reads yet.";
}

/** The stem of a path: after the last slash, before the last dot. */
export function stemOf(path: string): string {
  const title = path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);
  const dot = title.lastIndexOf(".");
  return dot >= 0 ? title.slice(0, dot) : title;
}

const stemEndsIn = (path: string, suffixes: string[]) => {
  const stem = stemOf(path).toUpperCase();
  return suffixes.some((s) => stem.length >= s.length && stem.endsWith(s));
};

/** Pod1StemIsMapName: a _N or _AO sibling. */
export function isMapName(path: string): boolean {
  return stemEndsIn(path, MAP_SUFFIXES);
}

/** Pod1StemIsAnyMapName: a map sibling, or a terrain _DTL / _MASK. */
export function isAnyMapName(path: string): boolean {
  return stemEndsIn(path, [...MAP_SUFFIXES, ...TERRAIN_SUFFIXES]);
}
