/*
  A track in a POD to a .TXX, without the DOM: View POD's read (loadPodTrack), then what File >
  Import does to it (markCustomPalette, the save as a .TXX). For node scripts and tests:

    import { podToTxx } from "./src/core/doc/pod-to-txx.ts";
    const { txx } = await podToTxx(readFileSync("CRAZY4X.POD"), "CRAZY4X");
    writeFileSync("CRAZY4X.txx", txx);

  A track format version 6 track (a .SI3, a 512-cell world, ...) is written as JSTraxx's TRAXXV99
  (txx.ts); any other as Traxx 1.7.1 writes it. Like Traxx's .TXX it names its art and models
  only: to open it in JSTraxx with its art, their ART\ and MODELS\ entries must be in the
  project's ART and MODELS folders (Import extracts them; `assets` lists them for a script).
*/
import { parsePod } from "../../vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../../vendor/openphotex/pod/lookup.js";
import { markCustomPalette } from "../traxx/palette.ts";
import { writeTxx } from "../traxx/txx.ts";
import { countTracks, loadPodTrack } from "./load-pod.ts";
import type { TrackDocument } from "./document.ts";

export interface PodToTxxResult {
  /** The .TXX bytes. */
  txx: Uint8Array;
  /** The document as View POD read it (palette marked as Import marks it). */
  doc: TrackDocument;
  /** The pod's ART\ and MODELS\ entries, by name, for extracting beside the .TXX. */
  assets: { name: string; data: Uint8Array }[];
}

/**
  The track `track` of a POD as .TXX bytes: a stem (the situation file's, any case; when a .SIT or
  .SI2 and a .SI3 share it, the first listed) or the index in the pod's track list (default 0).
*/
export async function podToTxx(podBytes: Uint8Array, track: string | number = 0, fileName = "track.pod"): Promise<PodToTxxResult> {
  const archive = parsePod(podBytes);
  const source = { archive, read: async (e: { offset: number; length: number }) => readPodEntry(podBytes, e) };
  let which = typeof track === "number" ? track : -1;
  if (typeof track === "string") {
    const list = await countTracks(source);
    which = list.stems.findIndex((s) => s.toUpperCase() === track.toUpperCase());
    if (which < 0) throw new Error(`No track "${track}" in this pod (it has ${list.stems.join(", ") || "none"}).`);
  }
  const doc = await loadPodTrack(source, which, fileName);
  markCustomPalette(doc.track);
  doc.viewOnly = false;
  const txx = writeTxx(doc.track, { fromSi3: doc.carry.situationIsSi3 });
  const assets = archive.entries
    .filter((e) => /^(ART|MODELS)\\/i.test(e.name))
    .map((e) => ({ name: e.name, data: readPodEntry(podBytes, e) }));
  return { txx, doc, assets };
}
