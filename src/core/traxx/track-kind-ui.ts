/*
  The words and numbers of the track kind's UI (Traxx origin/main): File > New's version 6 items (resource.h
  ID_FILE_NEW_V6_FIRST..LAST, Traxx.cpp CTraxxApp::OnFileNewV6, TraxxDoc.cpp OnNewDocument), the window title's
  kind (TraxxFrame.cpp CTraxxFrame::OnUpdateFrameTitle), the Track Type dialog's note (TrackTypeDlg.cpp
  CTrackTypeDlg::ShowNote) and Special > Enlarge World's question and report (TraxxViewEdit.cpp
  CTraxxView::OnSpecialEnlargeWorld, EnlargeIdList). Plain data in and out; the dialogs live in src/ui.
*/
import { adjustBoxHeightsForKind, countSpringFallsAbove, isV6, lakeMaxHeightForKind, tallHeights, trackTypeNote, type HasTrackKind, type TrackKind } from "./track-kind.ts";
import { TERRAIN_H_CLASSIC_MAX } from "./world.ts";
import { TERRAINMODE_CLASSIC16 } from "./terrain16.ts";
import type { TraxxFall } from "./falls.ts";
import type { EnlargeReport } from "../edit/enlarge-world.ts";

/*
  The twelve File > New > World Size items, in resource.h order (ID_FILE_NEW_V6_256_STD_C16 is
  ID_FILE_NEW_V6_FIRST): size, then Standard / Tall, then the grid.
*/
export const FILE_NEW_V6_IDS: readonly string[] = ["256", "512"].flatMap((size) => ["STD", "TALL"].flatMap((kind) =>
  ["C16", "SPL", "FINE"].map((grid) => `ID_FILE_NEW_V6_${size}_${kind}_${grid}`)));

/** The grid items' captions in every World Size popup (Traxx.rc IDR_MAINFRAME). */
export const V6_GRID_LABELS: readonly string[] = ["&Finer Heights 16-bit", "Finer Heights 16-bit &Spline", "&Precision 8 ft grid and 16-bit Heights Full Map"];
/** The grids as the string table's prompts name them. */
export const V6_GRID_NAMES: readonly string[] = ["Finer Heights 16-bit", "Finer Heights 16-bit Spline", "Precision 8 ft grid and 16-bit Heights Full Map"];

/** What a File > New > World Size item makes. */
export interface FileNewV6 {
  cells: 256 | 512;
  kind: "standard" | "tall";
  /** 0 Finer Heights 16-bit, 1 Spline, 2 Full Map. */
  grid: number;
  /** The terrain mode: TERRAINMODE_CLASSIC16 + grid. */
  mode: number;
}

/*
  OnFileNewV6: the offset from ID_FILE_NEW_V6_FIRST decodes as size = off / 6, tall = (off / 3) % 2,
  grid = off % 3. Standard V6 is kind 2 and Tall Heights V6 kind 1 in Traxx. Null for any other id.
*/
export function decodeFileNewV6(id: string): FileNewV6 | null {
  const off = FILE_NEW_V6_IDS.indexOf(id);
  if (off < 0) return null;
  const size = Math.trunc(off / 6), tall = Math.trunc(off / 3) % 2, grid = off % 3;
  return { cells: size === 0 ? 256 : 512, kind: tall ? "tall" : "standard", grid, mode: TERRAINMODE_CLASSIC16 + grid };
}

/** TraxxDoc.cpp OnNewDocument: a 512 world that could not be had; the track is then the 256 one. */
export const NEW_512_NO_MEMORY = "There isn't enough memory for a 512 x 512 world; this new track is 256 x 256.";

/** OnUpdateFrameTitle: what the window title gains after the usual title; "" on a classic track. */
export function trackTitleTag(t: HasTrackKind | null | undefined): string {
  if (!isV6(t)) return "";
  return tallHeights(t) ? " [v6 tall]" : " [v6 precise boxes]";
}

/** The Track Type radios, top to bottom (IDD_TRACK_TYPE). */
export const TRACK_TYPE_CHOICES: readonly { kind: TrackKind; label: string }[] = [
  { kind: "classic", label: "Classic (retail, CP3 and CP4)" },
  { kind: "standard", label: "Standard V6: precise ground boxes (CP4)" },
  { kind: "tall", label: "Tall Heights V6: up to 8,192 ft, precise ground boxes (CP4)" },
];

/** CTrackTypeDlg::ShowNote: NoteFor the checked kind, after the size sentence on a 512 world ("\r\n" between). */
export function trackTypeDialogNote(kind: TrackKind, cells: number): string {
  const note = trackTypeNote(kind);
  return cells > 256 ? `Classic tracks are 256 x 256; this track is ${cells}.\r\n${note}` : note;
}

/** OnInitDialog: Classic is greyed on a world bigger than 256 (a Classic track is 256 x 256). */
export function trackTypeClassicEnabled(cells: number): boolean {
  return cells <= 256;
}

/** The part of a track Enlarge World's question reads. */
export interface EnlargeQuestionTrack extends HasTrackKind {
  groundBoxes: readonly { lower: number; upper: number }[];
  falls: readonly TraxxFall[];
}

/*
  OnSpecialEnlargeWorld's question (Yes / No, default No). A classic track becomes Standard V6 as Track
  Type does it: the same note, the ground boxes CountBoxesAdjusted(pod, TRUE, FALSE) counts and the spring
  falls above the v6 lake cap.
*/
export function enlargeWorldQuestion(t: EnlargeQuestionTrack): string {
  let message = "Enlarge this track's world to 512 x 512 (16,384 ft)?\n\n"
    + "The track stays where it is, in the corner from 0 to 8,192 ft. The new space is flat ground with the first texture.\n\n";
  if (!isV6(t)) {
    const rounded = t.groundBoxes.filter((b) => adjustBoxHeightsForKind(b.lower, b.upper, true, false) !== null).length;
    message += "The track becomes a version 6 track (Standard V6). Retail Monster Truck Madness 2 and Community Patch 3 won't list it.";
    if (rounded > 0) message += `\n${rounded} ground boxes will be adjusted (heights rounded to 2 ft steps or kept in range).`;
    const newfall = lakeMaxHeightForKind(true, TERRAIN_H_CLASSIC_MAX);
    const lowfalls = countSpringFallsAbove(t.falls, newfall);
    if (lowfalls > 0) message += `\n${lowfalls} waterfall${lowfalls === 1 ? "" : "s"} will be lowered to ${(newfall / 2).toFixed(1)} ft.`;
    message += "\n\n";
  }
  return message + "Along the old world's east and south edges the ground used to join the far side of the world; "
    + "it now meets the new flat ground, so check those edges.\n\n"
    + "Undo is cleared, and this can't be undone. Save first if you want to keep the 256 x 256 version.";
}

/** The failure message when the library gives no reason of its own. */
export const ENLARGE_NO_MEMORY = "There is not enough memory to enlarge the world. The track is unchanged.";

/** EnlargeIdList: "#2, #5". */
export function enlargeIdList(ids: readonly number[]): string {
  return ids.map((id) => `#${id}`).join(", ");
}

/*
  The report after a successful enlarge: "" when nothing needs saying, otherwise the whole message
  ("The world is now 512 x 512.\n" and the lines), shown with a warning icon.
*/
export function enlargeWorldReport(rep: EnlargeReport): string {
  let message = "";
  if (rep.lakes.length > 0) message += `\nThese lakes hold their water differently now: ${enlargeIdList(rep.lakes)}.`;
  if (rep.falls.length > 0) message += `\nThese waterfalls need attention: ${enlargeIdList(rep.falls)}.`;
  if (rep.lakes.length > 0 || rep.falls.length > 0) {
    message += "\n\nThey were next to the old world's edge, which now meets the new flat ground. Nothing was moved; fix them by hand.";
  }
  if (rep.reason) message += `\n\n${rep.reason}`;
  return message ? `The world is now 512 x 512.\n${message}` : "";
}
