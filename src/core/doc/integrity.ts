/*
  CTrackPOD::CheckIntegrity (TrackPOD/TrackPODIntegrity.cpp): what Write POD warns about before
  it writes. At most 32 lines, then "(more...)". Every line is a reason the pod may not work
  in the game; the author may write it anyway.
*/
import type { TrackDocument } from "./document.ts";
import { findModelTexture } from "./load-pod.ts";
import { findAsset } from "./names.ts";
import { pod1StemBudget } from "../traxx/pod-items.ts";
import { POD1_TRACK_STEM_MAX } from "../traxx/terrain.ts";

const MAX_LINES = 32;
const MAX_GROUND_BOXES = 2048;
const MAX_BOXES = 4096;

export function checkIntegrity(doc: TrackDocument): string[] {
  const t = doc.track;
  const lines: string[] = [];
  let more = false;
  const add = (line: string) => {
    if (lines.length < MAX_LINES) lines.push(line);
    else more = true;
  };

  if (t.trackName === "new track") add("Track name not specified.");

  // The stem names ~21 files: it must fit the tightest folder, and be letters and digits.
  const p = t.prefix;
  const budget = Math.min(...[["LEVELS\\", ".LVL"], ["WORLD\\", ".SIT"], ["DATA\\", ".TXV"], ["FOG\\", ".MAP"], ["UI\\", "S.BMP"], ["SOUND\\", ".WAV"], ["MUSIC\\", ".MOD"]].map(([d, e]) => pod1StemBudget(d!, e!)));
  if (p.length < 1) add("Track name contains no letters or digits, so the track's files have no name.");
  else if (p.length > budget) add(`Track file name "${p}" is ${p.length} characters; the longest that fits every folder it is used in is ${budget}.`);
  {
    let usable = 0, derived = "";
    for (const ch of t.trackName) {
      if (!/[A-Za-z0-9]/.test(ch)) continue;
      usable++;
      if (derived.length < POD1_TRACK_STEM_MAX) derived += ch.toUpperCase();
    }
    if (usable > p.length && derived === p) {
      add(`Track name is longer than a file name can be, so the track's files are called "${p}".  Any other track whose name starts the same way would overwrite it.`);
    }
  }
  if (p.includes(".")) add(`Track file name "${p}" contains a dot.  Names derived from it (DATA\\...TTY, ART\\...ACT, FOG\\...MAP) are cut at the first dot and will not be found.`);
  else {
    const bad = [...p].find((ch) => !/[A-Za-z0-9]/.test(ch));
    if (bad) add(`Track file name "${p}" contains '${bad}'.  Use letters and digits only.`);
  }

  if (doc.groundBoxOverflow > 0) add(`${doc.groundBoxOverflow} ground boxes were dropped when this track was opened - it contains more than the ${MAX_GROUND_BOXES} this version supports.`);
  if (doc.objectsShort > 0) add(`The situation file this track came from promised ${doc.objectsShort} more object${doc.objectsShort === 1 ? "" : "s"} than it held. Traxx kept the ones that were there; writing the track corrects the count.`);
  if (doc.objectsDropped > 0) add(`${doc.objectsDropped} object${doc.objectsDropped === 1 ? " was" : "s were"} dropped when this track was opened - it holds more than the ${MAX_BOXES} this version supports.`);

  if (!t.music) add("Music MOD/WAV not specified.");
  if (!t.logoBmp && !t.uiHd[0]) add("Thumbnail/browse bitmap not specified.");
  if (!t.mapBmp && !t.uiHd[1]) add("Zoom (MTM1) or Icon (MTM2) bitmap not specified.");
  if (!t.backdropName || !doc.models.some((m) => m.bytes && m.name.toUpperCase().endsWith(t.backdropName.toUpperCase()))) add("Backdrop model not specified.");
  if (t.course.length < 1) add("Main course segments not specified.");
  if (!t.extendedCourses[0] || !t.extendedCourses[1]) add("Extended courses not specified.");
  if (!t.boxes.some((b) => b.type === 6)) add("Checkpoints not specified.");

  doc.textures.forEach((tex, i) => { if (tex && (!tex.indices || !tex.name || tex.bad)) add(`Bad texture ${tex.name || `#${i}`}`); });
  doc.modelTextures.forEach((tex, i) => { if (!tex.indices || !tex.name || tex.bad) add(`Bad model texture ${tex.name || `#${i}`}`); });

  for (const name of t.models) {
    const m = doc.models.find((x) => x.name.toUpperCase() === name.toUpperCase());
    if (!m) continue;
    for (const frame of m.frameNames) if (findAsset(t.models.map((n) => ({ name: n })), frame) < 0) add(`Missing BIN animation ${frame}`);
    for (const tex of m.textureNames) {
      const up = tex.toUpperCase();
      if (up && findModelTexture(doc.modelTextures, up) < 0) add(`Missing model texture ${up} (${m.name})`);
    }
  }
  if (more) lines.push("(more...)");
  return lines;
}
