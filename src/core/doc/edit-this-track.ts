/*
  Edit This Track (Traxx origin/main, spec 2026-11-22: TraxxDoc.cpp CTraxxDoc::OnFileEditTrack,
  TrackPOD/TrackPODFile.cpp CTrackPOD::MakeEditableFromView): the viewed pod's track becomes the
  track a clone of it would be. Its art and models are copied out first (core/doc/extract-art.ts),
  then this turns the document editable: a new free stem (core/traxx/free-stem.ts), the stem's
  number on the track name, no UI bitmap names (fresh ones come from the new stem), the
  *_from_pod flags (the .TXX vegetation keeps no such flag) and the .TXV text dropped, MTM2_ONLY set. Nothing else changes: the
  textures, lakes, falls, vegetation, race rules, objects and heights stay as read.
*/
import { MTM2_ONLY, type TrackDocument } from "./document.ts";
import { editableName } from "../traxx/free-stem.ts";
import { inferPrefixAuto } from "../traxx/terrain.ts";

/** OnFileEditTrack's question. */
export function editThisTrackQuestion(trackName: string): string {
  return `Make an editable copy of "${trackName}"?\n\nJSTraxx copies this pod's textures and models into your Art and Models folders (it never replaces a file there) and gives the track a new name. The pod itself is not changed. Save the track as a .TXX to keep it.`;
}

/** The extract failed (ExtractArtAndModels returned -1). */
export const EDIT_THIS_TRACK_COPY_FAILED = "JSTraxx could not copy all of the pod's textures and models: the pod could not be read, or storage ran out. Some of them may already have been copied to your folders (no file there was replaced). The track is still only being viewed.";

/** MakeEditableFromView refused. */
export function editThisTrackRefusal(why: string): string {
  return `The textures and models were copied to your folders (no file there was replaced), but the track could not be made editable: ${why}\n\nThe track is still only being viewed.`;
}

/** The closing message, with the conflict list (ExtractConflictMessage) when there is one. */
export function editThisTrackDone(prefix: string, conflicts: string): string {
  let text = `This is now an editable track, saved under the new name ${prefix} when you Write POD.`;
  if (conflicts) text += `\n\nThese files were already in your folders with different contents. Write POD and the reopened .TXX will use your copies, not the pod's:\n${conflicts}`;
  return text;
}

/**
  CTrackPOD::MakeEditableFromView on a document. Returns null when done, or the reason it could
  not be (no free stem, no stem at all), the document then untouched.
*/
export function makeEditableFromView(doc: TrackDocument, podEntryNames: readonly string[]): string | null {
  const t = doc.track;
  const named = editableName(t.prefix, t.trackName, podEntryNames);
  if ("error" in named) return named.error;
  // InferPrefixMode, with the new stem and the old name: the stem stays fixed through a rename.
  doc.prefixAuto = inferPrefixAuto(t.trackName, named.prefix);
  t.prefix = named.prefix;
  t.trackName = named.trackName;
  t.logoBmpName = "";
  t.mapBmpName = "";
  t.versionFlags |= MTM2_ONLY;
  doc.carry.txvText = null;
  doc.carry.situationIsSi2 = false;
  doc.carry.detailFromPod = doc.carry.maskFromPod = false;
  doc.carry.waterDetailFromPod = doc.carry.waterMaskFromPod = false;
  doc.viewOnly = false;
  return null;
}
