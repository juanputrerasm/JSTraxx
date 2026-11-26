/*
  Edit This Track's new name (Traxx origin/main, spec 2026-11-22: TrackPOD/TrackPODFile.cpp
  Pod1PickFreeStem, Pod1StemTakenInPod, CTrackPOD::MakeEditableFromView).

  The editable copy takes stem2, stem3 ... stem999, the digits coming out of the stem's own
  20-character budget (LEVELS\<stem>.LVL at a 20-character stem is exactly the 31 a POD1 entry
  holds), "free" meaning not used by any track in the viewed pod (WORLD\<stem>.SIT / .SI2 / .SI3
  or LEVELS\<stem>.LVL, any case). The stem's number goes on the track name too (a full name
  gives up its last characters for it).
*/
import { POD1_TRACK_STEM_MAX } from "./terrain.ts";
import { POD1_NAME_MAX } from "./pod-items.ts";

/** TRACKNAMELEN: the track name's buffer, so at most 31 characters. */
export const TRACK_NAME_LEN = 32;

/** Pod1PickFreeStem: the first base+n (n = 2..999) `taken` says is free, or null. */
export function pickFreeStem(base: string, taken: (stem: string) => boolean): string | null {
  if (!base) return null;
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    // THE SUFFIX COMES OUT OF THE STEM, not off the end of it.
    const keep = Math.min(POD1_TRACK_STEM_MAX - suffix.length, base.length);
    if (keep < 1) return null;
    const cand = base.slice(0, keep) + suffix;
    if (!taken(cand)) return cand;
  }
  return null;
}

/** Pod1StemTakenInPod: the pod holds WORLD\<stem>.SIT, .SI2 or .SI3, or LEVELS\<stem>.LVL (any case). */
export function stemTakenInPod(entryNames: readonly string[]): (stem: string) => boolean {
  const names = new Set(entryNames.map((n) => n.toUpperCase()));
  return (stem) => ["WORLD\\%.SIT", "WORLD\\%.SI2", "WORLD\\%.SI3", "LEVELS\\%.LVL"].some((shape) => names.has(shape.replace("%", stem.toUpperCase())));
}

/** MakeEditableFromView: the n Pod1PickFreeStem put on (a prefix of) the old stem: TRACK1 becomes TRACK12, its number 2. */
export function stemNumber(prefix: string, stem: string): string {
  for (let n = 2; n < 1000; n++) {
    const digits = String(n);
    const keep = Math.min(prefix.length, POD1_TRACK_STEM_MAX - digits.length);
    if (stem.length === keep + digits.length && stem.startsWith(prefix.slice(0, keep)) && stem.slice(keep) === digits) return digits;
  }
  return "";
}

/** The track name with the stem's number, the last characters of a full name making way for it. */
export function numberedTrackName(name: string, number: string): string {
  if (!number) return name;
  return name.slice(0, Math.min(name.length, TRACK_NAME_LEN - 1 - number.length)) + number;
}

/** MakeEditableFromView's refusal when no stem is free. */
export function noFreeStemMessage(prefix: string): string {
  return `Can't find an unused name for the editable copy - everything from "${prefix}2" to "${prefix}999" is already used by a track in this pod.  A track file name can be at most ${POD1_TRACK_STEM_MAX} characters, because LEVELS\\<name>.LVL has to fit the ${POD1_NAME_MAX} a pod directory entry holds, so the number has to come out of the name itself.`;
}

/** The new stem and name for a viewed track, or the refusal (MakeEditableFromView's naming half). */
export function editableName(prefix: string, trackName: string, podEntryNames: readonly string[]): { prefix: string; trackName: string } | { error: string } {
  if (!prefix) return { error: "This track has no file name to build an editable copy's name from." };
  const stem = pickFreeStem(prefix, stemTakenInPod(podEntryNames));
  if (!stem) return { error: noFreeStemMessage(prefix) };
  return { prefix: stem, trackName: numberedTrackName(trackName, stemNumber(prefix, stem)) };
}
