/*
  The open track: TrackDocument mirrors Traxx's CTrackPOD (Include/TrackPOD.h).

  `track` is the file-native record, exactly what a .TXX holds (core/traxx/txx.ts), in Traxx's
  units, so saving writes back what was read. Beside it sit what Traxx keeps in memory but not
  in a .TXX: the loaded art and models (a .TXX holds their names only, and Traxx reloads them
  from its ART and MODELS folders), and a few things carried over from an opened POD
  (cylinders, the .TXV record, the fog table) that a .TXX drops.

  Plain data only, so a document can move between the page and workers.
*/
import type { TxxTrack } from "../traxx/txx.ts";

export const MTM2_ONLY = 0x1;

/** A texture as loaded: Traxx's CTrackPODTexture, keeping the source rather than the remapped tile. */
export interface TextureAsset {
  /** The name Traxx keys it by: the .RAW name, as the .TEX or model records it. */
  name: string;
  /** Tile side, 32..1024; 0 for an HD-only texture not yet decoded. */
  side: number;
  /** The tile's pixels as stored, indices into `act`. Null when only HD art was found. */
  indices: Uint8Array | null;
  /** The tile's own palette, 768 RGB bytes, or null when it has none (metalcr2_act3 applies). */
  act: Uint8Array | null;
  /** The PNG or TGA source, byte for byte, when there is one. */
  hd: { ext: "PNG" | "TGA"; data: Uint8Array } | null;
  /** The tile is not named .RAW, so Traxx took its pixels as track palette indices and remapped nothing. */
  trackIndexed?: boolean;
  /** The indices and .ACT were built in memory from `hd` (no .RAW was found or written). */
  legacyBuilt?: boolean;
  /** Not found anywhere: Traxx shows a blank 64x64 tile and lists the name as missing. */
  bad: boolean;
}

/** A model as loaded: the .BIN bytes and the names a loader needs from them. */
export interface ModelAsset {
  /** The name as boxes record it, upper case. */
  name: string;
  bytes: Uint8Array | null;
  /** Every texture the faces name, in first-use order, as recorded. */
  textureNames: string[];
  /** An animated model's frame models. */
  frameNames: string[];
  bad: boolean;
}

/** What an opened POD carried that a .TXX does not keep. */
export interface PodCarryOver {
  /** The *** Cylinders *** section, verbatim (CTrackPOD::cylinder_raw). */
  cylinderCount: number;
  cylinderRaw: string;
  /** DATA\<stem>.TXV as read, so unknown keys survive (CTrackPOD::txv_text). */
  txvText: string | null;
  /** The track came with a .SI2 situation file. Informational: export decides again. */
  situationIsSi2: boolean;
  /** FOG\<stem>.FOG, 4096 bytes (fogfog). */
  fogFog: Uint8Array | null;
  /** The LVL's line 21 (lvlval). */
  levelValue: number;
  /** The detail and mask maps were read out of the pod. */
  detailFromPod: boolean;
  maskFromPod: boolean;
}

export type DocumentSource =
  | { kind: "new" }
  | { kind: "txx"; fileName: string; project: string | null }
  | { kind: "pod"; fileName: string; trackIndex: number }
  | { kind: "clone"; fileName: string };

export interface TrackDocument {
  track: TxxTrack;
  /** Terrain textures by .TEX index, aligned with track.textures; null for an empty slot. */
  textures: (TextureAsset | null)[];
  /** Textures the models and the backdrop use, by name. */
  modelTextures: TextureAsset[];
  /** Every model loaded: those the boxes name, crush frames, then the backdrop. */
  models: ModelAsset[];
  carry: PodCarryOver;
  /** The stem follows the track name (CTrackPOD::prefix_auto). */
  prefixAuto: boolean;
  /** View POD opens a track read-only: it cannot be saved or written (CTraxxDoc::viewonly). */
  viewOnly: boolean;
  source: DocumentSource;
  /** Records the situation file promised and did not hold, and records past 4096 (sit_objects_short, _dropped). */
  objectsShort: number;
  objectsDropped: number;
  /** Ground boxes past Traxx's 2048 (groundbox_overflow). */
  groundBoxOverflow: number;
  /** Names that could not be loaded. */
  missingTextures: string[];
  missingModels: string[];
  /** Anything else worth telling the author on open. */
  warnings: string[];
}

export function emptyCarry(): PodCarryOver {
  return {
    cylinderCount: 0, cylinderRaw: "", txvText: null, situationIsSi2: false, fogFog: null, levelValue: 255,
    detailFromPod: false, maskFromPod: false,
  };
}

/** Every transferable buffer in a document, for postMessage. Shared buffers are listed once. */
export function documentBuffers(doc: TrackDocument): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>();
  const add = (a: Uint8Array | Uint16Array | null | undefined) => { if (a && a.buffer instanceof ArrayBuffer) seen.add(a.buffer); };
  const t = doc.track;
  [t.logoBmp, t.mapBmp, t.music, t.text, t.infoBmp, t.infoText, t.detailMap, t.maskMap, t.palette, t.heights, t.clr, t.lte, t.fogMap].forEach(add);
  t.uiHd.forEach((h) => add(h?.data));
  t.sounds.forEach((s) => add(s.data));
  for (const tex of [...doc.textures, ...doc.modelTextures]) { add(tex?.indices); add(tex?.act); add(tex?.hd?.data); }
  doc.models.forEach((m) => add(m.bytes));
  add(doc.carry.fogFog);
  return [...seen];
}
