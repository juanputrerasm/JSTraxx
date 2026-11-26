/*
  The .TXX, Traxx's working file (Traxx origin/main, TrackPOD/TrackPODBinary.cpp: CTrackPOD::LoadBinary,
  SaveBinary and CanSaveBinary, with each component's own Load/Save).

  A little-endian record of the whole track, in Traxx's units: header strings, the track's
  blobs (UI bitmaps, music, text, info pop-up, detail and mask maps, HD art), the palette, the
  texture, model and box tables, the courses, the run-length-coded terrain, the trucks, the
  backdrop, fog map, ground boxes, sounds, animations and the sun. Art and models are kept by
  name only; Traxx reloads them from its ART and MODELS folders.

  The header names the generation, TRAXXV1 to TRAXXV24 (V12 to V17 are Traxx 1.7's: fog,
  vegetation, lakes and the terrain modes; V18 is Traxx 1.7.1's waterfalls; V19 is Traxx 1.7.2's
  water detail normal and water mask; V20 is Traxx 1.8.0's light all-weather flag; V21 to V23 are
  Traxx 1.8.2's race rules, walls and lead-ins; V24 is the version 6 track). Each one appends fields,
  and Traxx writes the LOWEST generation the track's contents need (txxVersionFor), so a track that
  uses nothing new stays readable by an older Traxx. Every block is guarded by "version >=", so a
  higher generation writes every lower block too. Every rule below says which generation adds it.

  Strings are one length byte then the bytes, the length counting the terminating NUL. A reader
  keeps what fits the destination and consumes the rest, as LOADSTRINGN does.

  TRAXXV19 (Traxx 1.7.2): V18, then after the waterfalls the water detail record and the water
  mask record, each in the V9 detail / mask layout (string ext, i32 length, bytes).

  TRAXXV20 (Traxx 1.8.0, TrackPODBox.cpp BOXBIN_VERSION_ALLWX): one more i32 (light.allwx) at the
  very end of EVERY box record. Stamped only when some light has allwx set. The reader normalises a
  value other than 0 / 1 to (value != 0).

  TRAXXV21 (race rules, TrackPODBox.cpp BOXBIN_VERSION_RACE): two more i32, cp_split and cp_lane, at
  the very end of every box record, after allwx (a negative value reads as 0); and after the V19
  pair the race-rules block: i32 1 (block version), i32 race_rules, i32 race_laps. Read: an unknown
  mode is NONE, RACE on a track that is not a Circuit or Rally is NONE, PARALLEL and RACE force the
  laps to 0, other laps than 0 / 1 become 1. Stamped when the race rules are on.
  TRAXXV22: the walls block after it (CTrackPODWalls::SaveTXX, version 1). Stamped when there are walls.
  TRAXXV23: the lead-ins block after that: i32 1, i32 leadin_then[5]. Read: [0] and [1] are -1, and a
  course 2..4 keeps a target 0 or 1 that no earlier course holds. Stamped when a lead-in is set.

  TRAXXV24 (a version 6 track: Standard V6 or Tall Heights V6, IsV6; nothing else stamps it):
    - box records keep 16,384 (4,096 below V24; the surplus is read and dropped, counted);
    - i32 worldCells (256 or 512) right before the terrain, whose planes are then N x N;
    - a ground box holds lower and upper as two i32 in 1/128 ft (one byte each of 2 ft steps below
      V24), clamped to 0..TERRAIN_H_TALL_MAX on read;
    - the V17 heights: i32 mode (never Classic 8-bit), i32 32, then N x N (16-bit, Spline) or
      4N x 4N (Full Map) unsigned i32 samples in 1/128 ft, 0..TERRAIN_H_TALL_MAX (more is a damaged file);
    - last, the v6 block: i32 block version (2, or 3 with a stored lake map; 1..3 are read), i32
      flags (bit 0 = Tall Heights; any other bit refuses the file), i32 water4 (from version 2: the
      whole water level in quarter steps, replacing the header's), and from version 3 the stored
      lake map (CTrackPODLakes::SaveStoredTXX): i32 shown, i32 N x N, N x N bytes.
    A file marked not tall whose heights or boxes go above 65535 is refused.

  TRAXXV99 was JSTraxx's own temporary generation for a version 6 track. It is read forever and
  never written: the V20 layout (allwx on every box, no V21..V23 blocks) with worldCells before the
  terrain, f64 ground box heights in 2 ft units, V17 heights as i32 store bits (16 or 32) and u16 or
  signed i32 samples (Classic 8-bit allowed), both V19 records always, and a last block of i32 1,
  flags (0x1 opened from a .SI3, 0x2 step and base set), step, base. It migrates as it is read
  (readV99Migrate): the kind from its content by EndV6Read's rule, boxes to 1/128 ft, Classic 8-bit
  to Classic 16-bit, the header water as water4, step, base and the .SI3 flag dropped. What it holds
  outside the new ranges (below 0, above the kind's ceiling) opens as it is and refuses to save
  (canSaveTxx) until the author fixes it.

  The fog map (32 KB), the art, the vegetation image (the .VEG bytes) and the waterfalls are as
  V18 has them. The JSTraxx trailer, when there is one, comes after everything Traxx reads.
*/
import { f32 } from "./cformat.ts";
import { TERRAIN_H_TALL_MAX, type HeightGrid } from "./world.ts";
import {
  clampTraxxFog, traxxBoxDefaults, traxxFogEngineDefaults, traxxLightDefaults, traxxTruckDefaults, traxxUiBitmapName,
  TRAXX_BOX_CRUSH, TRAXX_BOX_FOG, TRAXX_BOX_LIGHT, TRAXX_MAX_BOXES, V6_MAX_BOXES,
} from "./sit.ts";
import type { TraxxArena, TraxxBox, TraxxCourseSegment, TraxxTruck } from "./sit.ts";
import { fallDefaults, FALL_MAX_FALLS, FALL_MAX_POINTS, FALL_NAMELEN, type TraxxFall } from "./falls.ts";
import {
  isV6, notTallValuesFit, setTrackKind, storeForKind, tallHeights, v6KindByContent, waterLevelMax4, WATER_MAX4_CLASSIC,
  type TrackKind,
} from "./track-kind.ts";
import { boxByte } from "./height-units.ts";
import { decodeWallsBlock, encodeWallsBlock } from "./walls.ts";
import {
  raceRulesDefaults, RACERULES_DRAG, RACERULES_NONE, RACERULES_PARALLEL, RACERULES_RACE,
  type RaceRules, type RaceRulesMode, type Wall,
} from "./race-types.ts";
import {
  refreshRaw, syncFromRaw, wordsOf, RAWLEN_16BIT, RAWLEN_FINE, TERRAIN_FINE, TERRAINMODE_CLASSIC8, TERRAINMODE_CLASSIC16, TERRAINMODE_FINE,
} from "./terrain16.ts";
import { heightsChanged } from "./surface.ts";

/** The highest generation Traxx 1.8.0 knew: V20, the light all-weather flag. */
export const TXX_TRAXX_VERSION = 20;
/** Traxx 1.7.2's water maps generation. */
export const TXX_WATER_MAPS_VERSION = 19;
/** Traxx 1.8.0's light all-weather generation (BOXBIN_VERSION_ALLWX). */
export const TXX_ALLWX_VERSION = 20;
/** The race rules (BOXBIN_VERSION_RACE), walls and lead-ins generations. */
export const TXX_RACE_VERSION = 21;
export const TXX_WALLS_VERSION = 22;
export const TXX_LEADINS_VERSION = 23;
/** The version 6 track generation. */
export const TXX_V6_VERSION = 24;
/** The newest generation this port reads and writes. */
export const TXX_LATEST_VERSION = TXX_V6_VERSION;
/** JSTraxx's retired version 6 generation: read (and migrated), never written. */
export const TXX_LEGACY_V99_VERSION = 99;

/** LoadBinary's load_refusal sentences (TrackPODBinary.cpp). */
export const TXX_REFUSE_WORLD_SIZE = "This track's world size is not one this Traxx understands (256 or 512 cells).";
export const TXX_REFUSE_NOT_TALL = "This track is marked not tall, but its heights go above 512 ft: the file is damaged.";
/** CanSaveBinary's sentences (TrackPODBinary.cpp). */
export const TXX_CANNOT_SAVE_CLASSIC8 = "This track is a version 6 track, which cannot use the Classic 8-bit terrain grid, so it cannot be saved.";
export const TXX_CANNOT_SAVE_TERRAIN = "The terrain holds a height this track kind cannot store (more than 511.99 ft, or below 0), so it cannot be saved.";
export const TXX_CANNOT_SAVE_TERRAIN_TALL = "The terrain holds a height above the tall limit, so it cannot be saved.";
export const TXX_CANNOT_SAVE_BOX = "A ground box holds a height this track kind cannot store (more than 511.99 ft, or below 0), so it cannot be saved.";
export const TXX_CANNOT_SAVE_BOX_TALL = "A ground box holds a height this track kind cannot store (above the tall limit, or below 0), so it cannot be saved.";

/** The version 6 block's versions: 2 without, 3 with the stored lake map (1 is read). */
const V6_BLOCK_VERSION = 2;
const V6_BLOCK_VERSION_STORED = 3;
/** V99's version 6 block version. */
const V99_BLOCK_VERSION = 1;
/** MAXNPODGROUNDBOXES: LoadBinary refuses a count outside 0..2048 as a damaged file. */
const MAX_GROUND_BOXES = 2048;
/** MAXNPODEXTCOURSES. */
const MAX_EXT_COURSES = 4;
/** TRACKTYPE_CIRCUIT, TRACKTYPE_RALLY (Include/TrackPOD.h). */
const TRACKTYPE_CIRCUIT = 2;
const TRACKTYPE_RALLY = 3;

const MISCFLAG_FOGMAP = 0x1;
const MISCFLAG_SUNPOS = 0x2;
const MISCFLAG_NORAWFALLBACK = 0x4;
/** MISCFLAG_PNGHEIGHTS (1.7): Write POD packs the heights as DATA\<stem>_H.PNG (Special > Terrain Grid). */
const MISCFLAG_PNGHEIGHTS = 0x8;
/** CTrackPODBox::Load / Save: the fog generations (TrackPODBox.cpp). */
const BOXBIN_VERSION_FOG = 12;
const BOXBIN_VERSION_FOGLOOK = 13;
const BOXBIN_VERSION_FOGBOT = 14;
/** VEG_NLAYERS: trees (_V) then grass (_G). */
export const VEG_LAYERS = 2;
/** LoadBinary refuses a .VEG image longer than this as a corrupt file. */
const VEG_IMAGE_MAX = 64 * 1024 * 1024;
/** LAKE_MAX_LAKES, LAKE_MAX_SEEDS (Include/TrackPODLakes.h). */
export const LAKE_MAX_LAKES = 255;
export const LAKE_MAX_SEEDS = 8;
const TERFILE_RAW = 0x1;
const TERFILE_CLR = 0x2;
const TERFILE_LTE = 0x4;
const TERFILE_COMPRESS = 0x8000;
const BOXFLAG_CONT = 0x1;
const BOXFLAG_IMPACT = 0x2;
/** The pre-V4 fixed sound-name field. */
const SOUND_FIELD_V3 = 12;
const ANI_FRAMES = 8;
/** UIART_LOGO, UIART_MAP, UIART_INFO. */
export const TXX_UI_ART_SLOTS = 3;

/** The destination sizes LOADSTRINGN bounds each string by. */
/* What opens the JSTraxx trailer after the last record Traxx reads. */
const TRAILER_MAGIC = "JSTRAXX1";

const CAP = {
  comment: 80, prefix: 21, trackName: 32, localeName: 32, uiBmp: 29, ext: 8, podItem: 32, boxName: 32,
  boxSound: 64, truckName: 20,
} as const;

export interface TxxCourseSegment extends TraxxCourseSegment {
  /** TrackCourseSegment::spare, written back as read. */
  spare: [number, number];
}

export interface TxxGroundBox {
  x: number;
  y: number;
  /** Always 1 in practice: one box per cell. */
  w: number;
  h: number;
  /**
    The bottom and the top in v, 1/128 ft, as Traxx holds them (CTrackPODGroundbox lower / upper, TerrainHeight):
    a classic box is a whole 2 ft step (byte << 8), a v6 one any value 0..the kind's ceiling. upper 0 is no box.
  */
  lower: number;
  upper: number;
  /** Six .CLR-style face words, in file order. */
  faces: number[];
}

export interface TxxSound {
  /** The archive path, "SOUND\NAME.WAV". */
  name: string;
  /** SOUND_CONTINUOUS and friends. */
  flags: number;
  data: Uint8Array;
}

export interface TxxAnimation {
  /** Milliseconds per frame. */
  period: number;
  nframes: number;
  /** Eight texture indices; those past nframes are kept as read. */
  frames: number[];
}

export interface TxxSun {
  vector: [number, number, number];
  shadowIntensity: number;
  position: [number, number, number];
  intensity: number;
}

export interface TxxHdArt {
  /** The source's extension as Traxx records it, with its dot: ".PNG" or ".TGA". */
  ext: string;
  data: Uint8Array;
}

/**
  V15: the vegetation, kept as Traxx stores it and not interpreted: the two painted masks (trees
  _V, grass _G), each with its extension, then the whole .VEG image BuildVEG made.
*/
export interface TxxVegetation {
  masks: (TxxHdArt | null)[];
  /** The .VEG bytes; null when the block held none (masks only). */
  image: Uint8Array | null;
}

/**
  The stored lake map (CTrackPODLakes stored, storedlakes, storedshown): a pod's own .WTR tile map that
  Traxx's fill does not give, kept beside the fill. N x N bytes, lake index + 1 (an id with no lake is
  cleared when it is set, as SetStored does). Saved in a V24 .TXX's v6 block (version 3) while it is for
  the lakes the track has now (StoredSavable: `lakes` is the lake count it was stored for).
*/
export interface StoredLakeMap {
  tmap: Uint8Array;
  lakes: number;
  /** storedshown: the map is what the view shows (tmap holds it), not Traxx's fill. */
  shown: boolean;
  /**
    JSTraxx, never saved: lakes.ts lakesSignature of the track when the map was shown (ShowStored). Traxx's Recompute
    un-shows the map; JSTraxx's derived lakes show it only while the lakes, their rule and the falls are what they
    were then. Absent: shown as long as `shown` says.
  */
  sig?: string;
}

/** V16: one lake's authored part (the filled tiles are rebuilt from the terrain). */
export interface TxxLake {
  /** Water units (quarter steps, like waterLevel4). */
  height: number;
  /** LAKEFLAG_*: 0x1 reflective. */
  flags: number;
  /** Up to eight seed cells, [x, z]. */
  seeds: [number, number][];
}

export interface TxxTrack {
  /** The generation read; writeTxx stamps txxVersionFor instead. */
  version: number;
  comment: string;
  prefix: string;
  trackName: string;
  localeName: string;
  /** V7: UI bitmap names the stem would not derive. */
  logoBmpName: string;
  mapBmpName: string;
  trackType: number;
  /** The water level in quarter steps (whole steps * 4 + the V11 quarters). */
  waterLevel4: number;
  versionFlags: number;
  ambientSound: number;
  weatherMask: number;
  /** small_bmp, large_bmp, music_mod and text: stored bytes, or null. */
  logoBmp: Uint8Array | null;
  mapBmp: Uint8Array | null;
  music: Uint8Array | null;
  text: Uint8Array | null;
  /** V8: the info pop-up's photo and description. */
  infoBmp: Uint8Array | null;
  infoText: Uint8Array | null;
  /** V9: the terrain detail normal and its painted mask, each with the extension it came in as. */
  detailExt: string;
  detailMap: Uint8Array | null;
  maskExt: string;
  maskMap: Uint8Array | null;
  /**
    V19 (Traxx 1.7.2): the water detail normal (<stem>_WDTL) and the world-space water mask
    (<stem>_WMSK), a twin of the terrain pair, each with the extension it came in as.
  */
  waterDetailExt: string;
  waterDetailMap: Uint8Array | null;
  waterMaskExt: string;
  waterMaskMap: Uint8Array | null;
  /** V10: HD track art, one slot each for the logo, map and info photo. */
  uiHd: (TxxHdArt | null)[];
  paletteName: string;
  /** 256 RGB triples, as stored. */
  palette: Uint8Array;
  textures: { name: string; type: number; depth: number }[];
  models: string[];
  boxes: TraxxBox[];
  course: TxxCourseSegment[];
  /** The extended courses Traxx holds, in slot order. The file keeps only the non-empty ones, compacted. */
  extendedCourses: (TxxCourseSegment[] | null)[];
  heights: Uint8Array;
  clr: Uint16Array;
  /** Seven bytes per cell; null when the file carried no light plane. */
  lte: Uint8Array | null;
  trucks: TraxxTruck[];
  backdropName: string;
  /**
    More backdrop models drawn with the first, in order (a .SIT's backdropCount above 1, as
    Wastelands has). Traxx keeps one; JSTraxx keeps the rest in a trailer after the sun record,
    which Traxx stops reading before, so the file still opens there with the first backdrop.
  */
  extraBackdrops: string[];
  arena: TraxxArena | null;
  omitRawFallback: boolean;
  /** The track's own 32 KB fog map, or null for the standard one. */
  fogMap: Uint8Array | null;
  groundBoxes: TxxGroundBox[];
  sounds: TxxSound[];
  animations: TxxAnimation[];
  /** Null in a file written before Traxx recorded the sun. */
  sun: TxxSun | null;
  /** V17: TERRAINMODE_* (terrain16.ts); `heights` is then the 8-bit mirror of h16 or fine. */
  terrainMode: number;
  h16: HeightGrid | null;
  fine: HeightGrid | null;
  /**
    The track kind (Include/TrackPOD.h v6kind and tallheights; track-kind.ts): Classic, Standard V6 or Tall
    Heights V6. Never guessed from the content. A V24 .TXX holds it (V24 is v6, the v6 block's bit 0 tall).
  */
  trackKind: TrackKind;
  /** worldcells: cells a side, 256 or 512 (512 only on a v6 track). A V24 .TXX holds it, 256 before. */
  worldCells: number;
  /**
    The terrainHeightStep and terrainHeightBase the track was opened or imported with (version 6),
    null when none. Kept in memory only (no .TXX holds them): Write POD's own pick decides.
  */
  heightStep: number | null;
  heightBase: number | null;
  /** V21..V23 (Traxx 1.8.2): the race rules, the walls and the lead-ins (race-types.ts). */
  raceRules: RaceRules;
  /** What the mirror last wrote into `heights` (rawshadow), for syncFromRaw. */
  rawShadow: Uint8Array | null;
  /** MISCFLAG_PNGHEIGHTS: Store heights as PNG. */
  pngHeights: boolean;
  /** V15, or null for none. */
  vegetation: TxxVegetation | null;
  /** V16. */
  lakes: TxxLake[];
  /**
    The lakes' containment rule (Traxx 1.7.3, LAKE_RULE_*), derived and never saved: set from a
    pod's .WTR header (a tile-rule file built before 1.7.3), absent (EDGE, the default) otherwise.
  */
  lakeRule?: number;
  /** Traxx's stored lake map (StoredLakeMap), or null: carried by the document and a V24 .TXX. */
  storedLakeMap: StoredLakeMap | null;
  /** V18 (Traxx 1.7.1): the waterfalls, the authored part only. */
  falls: TraxxFall[];
  /**
    As read only: the placed objects past the generation's limit (4,096, or 16,384 from V24), read and
    dropped (sit_objects_dropped). openTxx moves it into the document; nothing else reads it.
  */
  objectsDroppedOnRead?: number;
}

export class TxxError extends Error {
  override name = "TxxError";
}

/*
  The reading half.
*/
class Reader {
  pos = 0;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private need(n: number, what: string): void {
    if (this.pos + n > this.bytes.length) throw new TxxError(`the file ends inside ${what}`);
  }
  u8(what: string): number { this.need(1, what); return this.bytes[this.pos++]; }
  i16(what: string): number { this.need(2, what); const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u16(what: string): number { this.need(2, what); const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i32(what: string): number { this.need(4, what); const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  f32(what: string): number { this.need(4, what); const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  f64(what: string): number { this.need(8, what); const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  take(n: number, what: string): Uint8Array { this.need(n, what); const out = this.bytes.slice(this.pos, this.pos + n); this.pos += n; return out; }
  /** LOADSTRINGN: a length byte, then the bytes; keeps up to cap - 1 of them and drops the rest. */
  string(cap: number, what: string): string {
    const len = this.u8(what);
    const keep = Math.min(len, cap - 1);
    const kept = this.take(keep, what);
    this.take(len - keep, what);
    return cString(kept);
  }
  /** An item buffer: an int length, then that many bytes; null when the length is 0 or less. */
  blob(what: string): Uint8Array | null {
    const length = this.i32(what);
    return length > 0 ? this.take(length, what) : null;
  }
}

/**
  Read a .TXX (LoadBinary). Throws a TxxError for a file that is not one, that ends early or that Traxx
  refuses (TXX_REFUSE_WORLD_SIZE, TXX_REFUSE_NOT_TALL and the damaged-file checks). A TRAXXV99 file is
  migrated as it is read (see the header comment).
*/
export function readTxx(bytes: Uint8Array): TxxTrack {
  const r = new Reader(bytes);
  const header = cString(r.take(10, "the header"));
  const match = /^TRAXXV(\d+)$/.exec(header);
  const version = match ? Number(match[1]) : 0;
  // Traxx's generations 1..24, and JSTraxx's retired V99; nothing between.
  const legacy = version === TXX_LEGACY_V99_VERSION;
  if (version < 1 || (version > TXX_LATEST_VERSION && !legacy)) throw new TxxError(`not a Traxx working file (header "${header}")`);
  /* The Traxx generation whose rules apply: V99 is the V20 layout with its own additions. */
  const gen = legacy ? TXX_ALLWX_VERSION : version;
  const v24 = gen >= TXX_V6_VERSION;

  const comment = r.string(CAP.comment, "the comment");
  const prefix = r.string(CAP.prefix, "the stem");
  const trackName = r.string(CAP.trackName, "the track name");
  const localeName = r.string(CAP.localeName, "the locale");
  let logoBmpName = "", mapBmpName = "";
  if (gen >= 7) {
    logoBmpName = r.string(CAP.uiBmp, "the logo name");
    mapBmpName = r.string(CAP.uiBmp, "the map name");
  }
  const trackType = r.i32("the track type");
  const waterLevel = r.i32("the water level");
  const versionFlags = r.i32("the version flags");
  const ambientSound = r.i32("the ambient sound");
  let weatherMask = r.i32("the weather mask");
  // LoadBinary: a mask of 0 means every weather.
  if (weatherMask === 0) weatherMask = 65535;

  const logoBmp = r.blob("the logo bitmap");
  const mapBmp = r.blob("the map bitmap");
  const music = r.blob("the music");
  const text = r.blob("the text");
  let infoBmp: Uint8Array | null = null, infoText: Uint8Array | null = null;
  if (gen >= 8) {
    infoBmp = r.blob("the info photo");
    infoText = r.blob("the info text");
  }
  let detailExt = "", detailMap: Uint8Array | null = null, maskExt = "", maskMap: Uint8Array | null = null;
  if (gen >= 9) {
    detailExt = r.string(CAP.ext, "the detail extension");
    detailMap = r.blob("the detail map");
    maskExt = r.string(CAP.ext, "the mask extension");
    maskMap = r.blob("the mask map");
  }
  const uiHd: (TxxHdArt | null)[] = [null, null, null];
  if (gen >= 10) {
    for (let i = 0; i < TXX_UI_ART_SLOTS; i++) {
      const ext = r.string(CAP.ext, "an HD art extension");
      const data = r.blob("HD art");
      uiHd[i] = data ? { ext, data } : null;
    }
  }
  let waterLevel4 = 4 * waterLevel;
  if (gen >= 11) waterLevel4 += r.i32("the water quarters");
  // Read before the kind is set: Traxx keeps 0..1020 here; a V24 block of version 2 replaces it. A V99 file's
  // water is taken as it is and clamped once its kind is known (readV99Migrate).
  if (!legacy) waterLevel4 = Math.min(WATER_MAX4_CLASSIC, Math.max(0, waterLevel4));

  const paletteName = r.string(CAP.podItem, "the palette name");
  const palette = r.take(768, "the palette");

  const textures: TxxTrack["textures"] = [];
  const textureCount = r.i32("the texture count");
  for (let i = 0; i < textureCount; i++) {
    const name = r.string(CAP.podItem, "a texture name") || "ERROR";
    let type = 0, depth = 0;
    if (gen > 1) {
      type = r.i32("a texture type");
      depth = r.i32("a texture depth");
      r.i32("a texture spare");
    }
    textures.push({ name, type, depth });
  }

  const models: string[] = [];
  const modelCount = r.i32("the model count");
  for (let i = 0; i < modelCount; i++) models.push(r.string(CAP.podItem, "a model name"));

  // The placed objects: 16,384 from V24 (and in a V99 file, a version 6 track's), 4,096 before; the surplus is
  // read the same way and dropped, so the stream stays in step (sit_objects_dropped).
  const boxes: TraxxBox[] = [];
  const boxLimit = v24 || legacy ? V6_MAX_BOXES : TRAXX_MAX_BOXES;
  let objectsDropped = 0;
  const boxCount = r.i32("the box count");
  for (let i = 0; i < boxCount; i++) {
    const box = readBox(r, gen);
    if (i >= boxLimit) objectsDropped++;
    else boxes.push(box);
  }

  const course = readCourse(r);
  const extendedCourses: (TxxCourseSegment[] | null)[] = [null, null, null, null];
  const extCount = r.i32("the extended course count");
  for (let i = 0; i < extCount; i++) {
    const segments = readCourse(r);
    if (i < MAX_EXT_COURSES) extendedCourses[i] = segments;
  }

  // V24 (and V99): the world's size, then a terrain of N x N cells.
  let worldCells = 256;
  if (v24 || legacy) {
    worldCells = r.i32("the world size");
    if (worldCells !== 256 && worldCells !== 512) throw new TxxError(TXX_REFUSE_WORLD_SIZE);
  }
  const N = worldCells, NN = N * N;
  const terrain = readTerrain(r, NN);

  const trucks: TraxxTruck[] = [];
  for (let i = 0; i < 9; i++) trucks.push(readTruck(r));

  // The backdrop: a 32-byte record is the name with the arena's four shorts in its tail.
  let backdropName = "", arena: TraxxArena | null = null;
  {
    const len = r.u8("the backdrop");
    const record = r.take(len, "the backdrop");
    if (len > 1) {
      backdropName = cString(record);
      if (len === 32) {
        const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
        arena = { x: view.getInt16(30, true), y: view.getInt16(28, true), sx: view.getInt16(26, true), sy: view.getInt16(24, true) };
      }
    }
  }

  const miscflags = r.i32("the misc flags");
  const fogMap = miscflags & MISCFLAG_FOGMAP ? r.take(32768, "the fog map") : null;

  // The ground boxes: a count outside 0..2048 is a damaged file; a box outside the world is read and dropped
  // (CTrackPODGroundbox::Load). Heights in v: below V24 one byte each (<< 8), V24 an i32 clamped to
  // 0..TERRAIN_H_TALL_MAX, V99 an f64 in 2 ft units (* 256, kept as it is).
  const groundBoxes: TxxGroundBox[] = [];
  const groundBoxCount = r.i32("the ground box count");
  if (groundBoxCount < 0 || groundBoxCount > MAX_GROUND_BOXES) throw new TxxError("the ground box count is out of range");
  for (let i = 0; i < groundBoxCount; i++) {
    const x = r.i32("a ground box"), y = r.i32("a ground box"), w = r.i32("a ground box"), h = r.i32("a ground box");
    let lower: number, upper: number;
    if (v24) {
      const clamp = (v: number) => (v < 0 ? 0 : v > TERRAIN_H_TALL_MAX ? TERRAIN_H_TALL_MAX : v);
      lower = clamp(r.i32("a ground box"));
      upper = clamp(r.i32("a ground box"));
    } else if (legacy) {
      lower = Math.round(r.f64("a ground box") * 256);
      upper = Math.round(r.f64("a ground box") * 256);
    } else {
      lower = r.u8("a ground box") << 8;
      upper = r.u8("a ground box") << 8;
    }
    const faces: number[] = [];
    for (let face = 0; face < 6; face++) faces.push(r.u16("a ground box"));
    if (x >>> 0 < N && y >>> 0 < N) groundBoxes.push({ x, y, w, h, lower, upper, faces });
  }

  const sounds: TxxSound[] = [];
  const soundCount = r.i32("the sound count");
  for (let i = 0; i < soundCount; i++) {
    const name = r.string(CAP.podItem, "a sound name");
    const size = r.i32("a sound size");
    const flags = r.i32("a sound's flags");
    sounds.push({ name, flags, data: r.take(Math.max(0, size), "a sound") });
  }

  const animations: TxxAnimation[] = [];
  const animationCount = r.i32("the animation count");
  for (let i = 0; i < animationCount; i++) {
    const period = r.i32("an animation"), nframes = r.i32("an animation");
    const frames: number[] = [];
    for (let k = 0; k < ANI_FRAMES; k++) frames.push(r.i32("an animation"));
    animations.push({ period, nframes, frames });
  }

  let sun: TxxSun | null = null;
  if (miscflags & MISCFLAG_SUNPOS) {
    const vector: [number, number, number] = [r.i32("the sun"), r.i32("the sun"), r.i32("the sun")];
    const shadowIntensity = r.i32("the sun");
    const position: [number, number, number] = [r.i32("the sun"), r.i32("the sun"), r.i32("the sun")];
    sun = { vector, shadowIntensity, position, intensity: r.i32("the sun") };
  }

  // V15: the vegetation, masks first, then the image.
  let vegetation: TxxVegetation | null = null;
  if (gen >= 15) {
    const masks: (TxxHdArt | null)[] = [];
    for (let layer = 0; layer < VEG_LAYERS; layer++) {
      const ext = r.string(CAP.ext, "a vegetation mask extension");
      const data = r.blob("a vegetation mask");
      masks.push(data ? { ext, data } : null);
    }
    const length = r.i32("the vegetation image");
    if (length < 0 || length > VEG_IMAGE_MAX) throw new TxxError("the vegetation image has an impossible length");
    const image = length > 0 ? r.take(length, "the vegetation image") : null;
    if (masks.some(Boolean) || image) vegetation = { masks, image };
  }

  // V16: the lakes (CTrackPODLakes::LoadTXX).
  const lakes: TxxLake[] = [];
  if (gen >= 16) {
    const n = r.i32("the lake count");
    if (n < 0 || n > LAKE_MAX_LAKES) throw new TxxError("the lake count is out of range");
    for (let i = 0; i < n; i++) {
      const height = r.i32("a lake");
      const flags = r.i32("a lake") & 0xffff;
      const ns = r.i32("a lake");
      if (ns < 0 || ns > LAKE_MAX_SEEDS) throw new TxxError("a lake has too many seeds");
      const seeds: [number, number][] = [];
      for (let s = 0; s < ns; s++) {
        const x = r.i32("a lake seed"), z = r.i32("a lake seed");
        if (x < 0 || x > N - 1 || z < 0 || z > N - 1) throw new TxxError("a lake seed is off the map");
        seeds.push([x, z]);
      }
      lakes.push({ height, flags, seeds });
    }
  }

  // V17: the terrain mode and its real heights (CTrackPODTerrain::LoadTXXHeights). The mid-file block held
  // only the 8-bit mirror, which is rebuilt from them.
  const t16 = { terrainMode: TERRAINMODE_CLASSIC8, h16: null as HeightGrid | null, fine: null as HeightGrid | null, rawShadow: null as Uint8Array | null, heights: terrain.heights, worldCells };
  if (gen >= 17) {
    const mode = r.i32("the terrain mode");
    if (mode < TERRAINMODE_CLASSIC8 || mode > TERRAINMODE_FINE) throw new TxxError("the terrain mode is unknown");
    // V24: a v6 track is never Classic 8-bit, and the only sample width is 32.
    if (v24) {
      if (mode === TERRAINMODE_CLASSIC8) throw new TxxError("the terrain of a version 6 track cannot be Classic 8-bit");
      if (r.i32("the terrain store") !== 32) throw new TxxError("the terrain store is not 32-bit");
    }
    if (mode !== TERRAINMODE_CLASSIC8) {
      const fine = mode === TERRAINMODE_FINE;
      const count = fine ? 16 * NN : NN;
      let words: HeightGrid;
      if (v24) {
        // Unsigned, 0..TERRAIN_H_TALL_MAX: anything above is a damaged file.
        const b = r.take(count * 4, "the terrain heights");
        const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        words = new Int32Array(count);
        for (let i = 0; i < count; i++) {
          const v = dv.getUint32(4 * i, true);
          if (v > TERRAIN_H_TALL_MAX) throw new TxxError("a terrain height is above the tallest a track may be: the file is damaged");
          words[i] = v;
        }
      } else if (legacy) {
        // V99: the store's bits, then N x N or 4N x 4N samples, u16 or signed i32.
        const bits = r.i32("the terrain store");
        if (bits !== 16 && bits !== 32) throw new TxxError("the terrain store is not 16 or 32-bit");
        const b = r.take(count * (bits / 8), "the terrain heights");
        if (bits === 16) words = wordsOf(b, count);
        else { const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); words = new Int32Array(count); for (let i = 0; i < count; i++) words[i] = dv.getInt32(4 * i, true); }
      } else words = wordsOf(r.take(fine ? RAWLEN_FINE : RAWLEN_16BIT, "the terrain heights"), fine ? TERRAIN_FINE * TERRAIN_FINE : 256 * 256);
      t16.terrainMode = mode;
      if (fine) t16.fine = words; else t16.h16 = words;
      t16.rawShadow = new Uint8Array(NN);
      refreshRaw(t16);
    }
  }

  // V18: the waterfalls (CTrackPODFalls::LoadTXX, block version 3 since Traxx 1.7.3: + roughfrom after the
  // mist height; 1 is read with the mist size 100, 1 and 2 with roughfrom 0).
  const falls: TraxxFall[] = [];
  if (gen >= 18) {
    const v = r.i32("the waterfalls");
    if (v !== 1 && v !== 2 && v !== 3) throw new TxxError("the waterfalls block has an unknown version");
    const n = r.i32("the waterfall count");
    if (n < 0 || n > FALL_MAX_FALLS) throw new TxxError("the waterfall count is out of range");
    for (let i = 0; i < n; i++) {
      const w = fallDefaults();
      const src = r.i32("a waterfall"), np = r.i32("a waterfall"), fl = r.i32("a waterfall");
      if (src < 0 || src > 255 || np < 0 || np > FALL_MAX_POINTS || fl < 0 || fl > 65535) throw new TxxError("a waterfall is corrupt");
      w.speed = r.i32("a waterfall");
      w.height = r.i32("a waterfall");
      for (let k = 0; k < FALL_MAX_POINTS; k++) w.pt[k] = [r.i32("a waterfall"), r.i32("a waterfall")];
      const op = r.i32("a waterfall"), mi = r.i32("a waterfall"), vo = r.i32("a waterfall");
      if (op < 0 || op > 255 || mi < 0 || mi > 255 || vo < 0 || vo > 255) throw new TxxError("a waterfall is corrupt");
      let md = 100, mh = 100;
      if (v >= 2) {
        md = r.i32("a waterfall"); mh = r.i32("a waterfall");
        if (md < 0 || md > 255 || mh < 0 || mh > 255) throw new TxxError("a waterfall is corrupt");
        if (md === 0) md = 100;
        if (mh === 0) mh = 100;
        if (md > 250) md = 250;
        if (mh > 250) mh = 250;
      }
      let rf = 0;
      if (v >= 3) {
        rf = r.i32("a waterfall");
        if (rf < 0 || rf > 255) throw new TxxError("a waterfall is corrupt");
      }
      // char[16] each: no NUL in the 16 bytes leaves a 16-character stem, which Errors refuses (FALL_NAME).
      w.sound = cString(r.take(FALL_NAMELEN, "a waterfall's sound"));
      w.texture = cString(r.take(FALL_NAMELEN, "a waterfall's texture"));
      Object.assign(w, { source: src, npoints: np, flags: fl, opacity: op, mist: mi, volume: vo, mistdepth: md, mistheight: mh, roughfrom: rf });
      falls.push(w);
    }
  }

  // V19 (Traxx 1.7.2): the water detail normal, then the water mask, in the V9 pair's layout.
  let waterDetailExt = "", waterDetailMap: Uint8Array | null = null, waterMaskExt = "", waterMaskMap: Uint8Array | null = null;
  if (gen >= TXX_WATER_MAPS_VERSION) {
    waterDetailExt = r.string(CAP.ext, "the water detail extension");
    waterDetailMap = r.blob("the water detail map");
    waterMaskExt = r.string(CAP.ext, "the water mask extension");
    waterMaskMap = r.blob("the water mask map");
  }

  // V21: the race-rules block, normalised as LoadBinary does (the file's own track type stands).
  const raceRules = raceRulesDefaults();
  if (gen >= TXX_RACE_VERSION) {
    if (r.i32("the race rules") !== 1) throw new TxxError("the race rules block has an unknown version");
    let rr = r.i32("the race rules"), rl = r.i32("the race rules");
    if (rr !== RACERULES_NONE && rr !== RACERULES_DRAG && rr !== RACERULES_PARALLEL && rr !== RACERULES_RACE) rr = RACERULES_NONE;
    // Split checkpoints (3) only make sense on a Circuit or Rally; anything else is rules off.
    if (rr === RACERULES_RACE && trackType !== TRACKTYPE_CIRCUIT && trackType !== TRACKTYPE_RALLY) rr = RACERULES_NONE;
    // Same normalisation as SetRaceRules: 0 = looped, 1 = one run; Parallel and Race are always 0.
    if (rr === RACERULES_PARALLEL || rr === RACERULES_RACE) rl = 0;
    else if (rl !== 0 && rl !== 1) rl = 1;
    raceRules.mode = rr as RaceRulesMode;
    raceRules.laps = rl;
  }

  // V22: the walls block (CTrackPODWalls::LoadTXX).
  if (gen >= TXX_WALLS_VERSION) {
    let block: { walls: Wall[]; length: number };
    try { block = decodeWallsBlock(bytes, r.pos); } catch (err) { throw new TxxError((err as Error).message); }
    r.pos += block.length;
    raceRules.walls = block.walls;
  }

  // V23: the lead-ins block. [0] and [1] stay -1; a course 2..4 keeps a target 0 / 1 no earlier course holds.
  if (gen >= TXX_LEADINS_VERSION) {
    if (r.i32("the lead-ins") !== 1) throw new TxxError("the lead-ins block has an unknown version");
    const lt = [r.i32("the lead-ins"), r.i32("the lead-ins"), r.i32("the lead-ins"), r.i32("the lead-ins"), r.i32("the lead-ins")];
    const out = raceRules.leadinThen;
    for (let c = 2; c <= 4; c++) {
      const v = lt[c]!;
      if ((v === 0 || v === 1) && out[2] !== v && out[3] !== v && out[4] !== v) out[c] = v;
    }
  }

  // V24: the v6 block (read below, once the track record exists, as LoadBinary narrows the kind there).
  let v6Block: { tall: boolean; water4: number | null; stored: { shown: boolean; tmap: Uint8Array } | null } | null = null;
  if (v24) {
    const bv = r.i32("the version 6 block");
    if (bv < 1 || bv > 3) throw new TxxError("the version 6 block has an unknown version");
    const flags = r.i32("the version 6 block");
    if (flags & ~1) throw new TxxError("the version 6 block holds a flag this Traxx does not know");
    const water4 = bv >= 2 ? r.i32("the version 6 block") : null;
    let stored: { shown: boolean; tmap: Uint8Array } | null = null;
    if (bv >= 3) {
      // CTrackPODLakes::LoadStoredTXX: int shown, int n (= N x N), n bytes; it needs the lakes in.
      const shown = r.i32("the stored lake map");
      const n = r.i32("the stored lake map");
      if (lakes.length <= 0 || n !== NN) throw new TxxError("the stored lake map is corrupt");
      stored = { shown: shown !== 0, tmap: r.take(NN, "the stored lake map") };
    }
    v6Block = { tall: (flags & 1) !== 0, water4, stored };
  }

  // V99: its own version 6 block, read and dropped (step, base and the .SI3 flag have no place in Traxx's track).
  if (legacy) {
    if (r.i32("the version 6 block") !== V99_BLOCK_VERSION) throw new TxxError("the version 6 block has an unknown version");
    r.i32("the version 6 block"); r.i32("the version 6 block"); r.i32("the version 6 block");
  }

  // The JSTraxx trailer, when there is one (see extraBackdrops): after the last block Traxx reads.
  const extraBackdrops: string[] = [];
  if (r.pos + TRAILER_MAGIC.length <= bytes.length && cString(bytes.subarray(r.pos, r.pos + TRAILER_MAGIC.length)) === TRAILER_MAGIC) {
    r.take(TRAILER_MAGIC.length, "the JSTraxx trailer");
    const count = r.i32("the extra backdrops");
    for (let i = 0; i < count; i++) extraBackdrops.push(r.string(CAP.podItem, "an extra backdrop"));
  }

  const track: TxxTrack = {
    version, comment, prefix, trackName, localeName, logoBmpName, mapBmpName, trackType, waterLevel4,
    versionFlags, ambientSound, weatherMask, logoBmp, mapBmp, music, text, infoBmp, infoText,
    detailExt, detailMap, maskExt, maskMap, waterDetailExt, waterDetailMap, waterMaskExt, waterMaskMap,
    uiHd, paletteName, palette, textures, models, boxes, course, extendedCourses, heights: terrain.heights, clr: terrain.clr, lte: terrain.lte, trucks, backdropName, extraBackdrops, arena,
    omitRawFallback: (miscflags & MISCFLAG_NORAWFALLBACK) !== 0, fogMap, groundBoxes, sounds, animations, sun,
    terrainMode: t16.terrainMode, h16: t16.h16, fine: t16.fine, rawShadow: t16.rawShadow,
    trackKind: "classic", worldCells, heightStep: null, heightBase: null, raceRules,
    pngHeights: (miscflags & MISCFLAG_PNGHEIGHTS) !== 0, vegetation, lakes, falls, storedLakeMap: null,
    ...(objectsDropped ? { objectsDroppedOnRead: objectsDropped } : {}),
  };

  if (v6Block) {
    // A not-tall track is capped at 65535 (512 ft); Traxx never writes a not-tall file holding more.
    if (!v6Block.tall && !notTallValuesFit(track)) throw new TxxError(TXX_REFUSE_NOT_TALL);
    // The kind, at the file's own N (a same-N SetTrackKind only sets the kind and its ceilings).
    setTrackKind(track, v6Block.tall ? "tall" : "standard", worldCells);
    if (v6Block.water4 !== null) track.waterLevel4 = Math.min(waterLevelMax4(track), Math.max(0, v6Block.water4));
    if (v6Block.stored) {
      // SetStored: an id with no lake is cleared, as the engine does on load.
      const nl = lakes.length, tmap = v6Block.stored.tmap;
      for (let i = 0; i < tmap.length; i++) if (tmap[i]! > nl) tmap[i] = 0;
      track.storedLakeMap = { tmap, lakes: nl, shown: v6Block.stored.shown };
    }
  } else if (legacy) readV99Migrate(track);
  return track;
}

/*
  A TRAXXV99 file as a version 6 track (the header comment): Classic 8-bit becomes Classic 16-bit (h16 = raw
  << 8), the kind comes from the content by EndV6Read's rule (track-kind.ts v6KindByContent), the store follows
  the kind, and the water is held to the kind's 0..WaterLevelMax4. Heights and ground boxes are kept as they are,
  so a value outside the kind's range shows and the save refuses it (canSaveTxx).
*/
function readV99Migrate(t: TxxTrack): void {
  const n = t.worldCells, nn = n * n;
  if (t.terrainMode === TERRAINMODE_CLASSIC8) {
    const h16 = new Uint16Array(nn);
    for (let i = 0; i < nn; i++) h16[i] = t.heights[i]! << 8;
    t.terrainMode = TERRAINMODE_CLASSIC16;
    t.h16 = h16;
    t.fine = null;
    t.rawShadow = t.heights.slice(0, nn);
    refreshRaw(t);
  }
  t.trackKind = v6KindByContent(t);
  storeForKind(t);
  t.waterLevel4 = Math.min(waterLevelMax4(t), Math.max(0, t.waterLevel4));
  heightsChanged(t);
}

/** CTrackPODBox::Load. */
function readBox(r: Reader, version: number): TraxxBox {
  const box = traxxBoxDefaults();
  box.ipos = [r.i32("a box"), r.i32("a box"), r.i32("a box")];
  box.theta = r.f32("a box"); box.phi = r.f32("a box"); box.psi = r.f32("a box");
  box.length = r.i32("a box"); box.width = r.i32("a box"); box.height = r.i32("a box");
  box.mass = r.f32("a box");
  box.bvel = [r.f32("a box"), r.f32("a box"), r.f32("a box")];
  box.p = r.f32("a box"); box.q = r.f32("a box"); box.r = r.f32("a box");
  box.type = r.i32("a box"); box.flags = r.i32("a box"); box.priority = r.i32("a box");
  box.checkpointSeq = r.i32("a box");
  box.heightAboveGround = r.i32("a box");
  const sounds = r.i32("a box's sounds");
  const sound = (flag: number) => {
    if (!(sounds & flag)) return "NULL.WAV";
    return version >= 4 ? r.string(CAP.boxSound, "a box sound") : cString(r.take(SOUND_FIELD_V3, "a box sound"));
  };
  box.soundCont = sound(BOXFLAG_CONT);
  box.soundImpact = sound(BOXFLAG_IMPACT);
  const zfraction = r.i16("a box");
  const spare = r.i16("a box");
  box.fraction = [spare & 0xff, (spare >> 8) & 0xff, zfraction];
  box.modelName = r.string(CAP.boxName, "a box model");
  if (box.type === TRAXX_BOX_CRUSH) {
    box.crushName = r.string(CAP.boxName, "a top-crush cab");
    box.crush = [r.f32("a top crush"), r.f32("a top crush"), r.f32("a top crush")];
  }
  if (version >= 3) {
    const l = box.light;
    l.radius = r.f32("a light"); l.heightOffset = r.f32("a light");
    l.r = r.f32("a light"); l.g = r.f32("a light"); l.b = r.f32("a light");
    l.glowMode = r.i32("a light"); l.glowRadius = r.f32("a light");
    l.coneLength = r.f32("a light"); l.coneRimRadius = r.f32("a light"); l.coneBaseRadius = r.f32("a light");
  }
  if (version >= 5) box.light.bright = r.f32("a light");
  if (version >= 6) box.light.aimOffset = r.f32("a light");
  if (version >= BOXBIN_VERSION_FOG) {
    // Every box of a V12+ file carries the values; a box that is not a Fog keeps them as read.
    const f = box.fog;
    f.w = r.f32("a fog"); f.l = r.f32("a fog"); f.h = r.f32("a fog"); f.base = r.f32("a fog"); f.vis = r.f32("a fog");
    f.r = r.f32("a fog"); f.g = r.f32("a fog"); f.b = r.f32("a fog");
    f.half = r.f32("a fog"); f.edge = r.f32("a fog"); f.top = r.f32("a fog"); f.maxop = r.f32("a fog");
    f.wmask = r.i32("a fog");
    if (version >= BOXBIN_VERSION_FOGLOOK) {
      f.round = r.f32("a fog"); f.wisp = r.f32("a fog"); f.wsize = r.f32("a fog"); f.wspeed = r.f32("a fog");
    } else if (box.type === TRAXX_BOX_FOG) {
      // A V12 Fog predates the look fields: the engine's defaults for them.
      const e = traxxFogEngineDefaults();
      f.round = e.round; f.wisp = e.wisp; f.wsize = e.wsize; f.wspeed = e.wspeed;
    }
    if (version >= BOXBIN_VERSION_FOGBOT) f.bot = r.f32("a fog");
    else if (box.type === TRAXX_BOX_FOG) f.bot = 0;
    clampTraxxFog(f);
  } else if (box.type === TRAXX_BOX_FOG) box.fog = traxxFogEngineDefaults();
  // V20 (and V99) only: the light's all-weather flag, last in the record, for every box. Below that
  // allWx keeps LIGHTDEF_ALLWX (0), which every older file meant.
  if (version >= TXX_ALLWX_VERSION) {
    const allWx = r.i32("a light");
    box.light.allWx = allWx !== 0 ? 1 : 0;
  }
  // V21 (BOXBIN_VERSION_RACE) only: the checkpoint's split and lane, last in the record; a negative value is 0.
  if (version >= TXX_RACE_VERSION) {
    box.cpSplit = Math.max(0, r.i32("a box's split"));
    box.cpLane = Math.max(0, r.i32("a box's lane"));
  }
  return box;
}

function readCourse(r: Reader): TxxCourseSegment[] {
  const count = r.i32("a course");
  const segments: TxxCourseSegment[] = [];
  for (let i = 0; i < count; i++) {
    const v = Array.from({ length: 10 }, () => r.i32("a course segment"));
    segments.push({
      cstart: [v[0], v[1], v[2]], cend: [v[3], v[4], v[5]], speedLimit: v[6], trackWidth: v[7], spare: [v[8], v[9]],
    });
  }
  return segments;
}

/** CTrackPODTerrain::Load: the flags word, then each plane raw or run-length coded (CELLS cells; N x N from V24, and in V99). */
function readTerrain(r: Reader, CELLS = 256 * 256): { heights: Uint8Array; clr: Uint16Array; lte: Uint8Array | null } {
  const flags = r.u16("the terrain");
  const heights = new Uint8Array(CELLS).fill(100);
  const clrBytes = new Uint8Array(CELLS * 2);
  let lte: Uint8Array | null = null;
  // One plane: `count` cells at `stride` from `start` in `out`.
  const plane = (out: Uint8Array, start: number, stride: number) => {
    if (flags & TERFILE_COMPRESS) {
      let cell = 0;
      while (true) {
        const run = r.u8("the terrain");
        if (run === 0) break;
        const value = r.u8("the terrain");
        if (cell + run > CELLS) throw new TxxError("a terrain run passes the end of the grid");
        for (let i = 0; i < run; i++) out[start + stride * cell++] = value;
      }
    } else {
      const raw = r.take(CELLS, "the terrain");
      for (let cell = 0; cell < CELLS; cell++) out[start + stride * cell] = raw[cell];
    }
  };
  if (flags & TERFILE_RAW) plane(heights, 0, 1);
  if (flags & TERFILE_CLR) {
    if (flags & TERFILE_COMPRESS) { plane(clrBytes, 0, 2); plane(clrBytes, 1, 2); }
    else clrBytes.set(r.take(CELLS * 2, "the terrain"));
  }
  if (flags & TERFILE_LTE) {
    lte = new Uint8Array(CELLS * 7);
    if (flags & TERFILE_COMPRESS) for (let p = 0; p < 7; p++) plane(lte, p, 7);
    else lte.set(r.take(CELLS * 7, "the terrain"));
  }
  const clr = new Uint16Array(CELLS);
  for (let i = 0; i < CELLS; i++) clr[i] = clrBytes[2 * i] | (clrBytes[2 * i + 1] << 8);
  return { heights, clr, lte };
}

/** CTrackPODTruck::Load: no bound on the name but the length byte. */
function readTruck(r: Reader): TraxxTruck {
  const truck = traxxTruckDefaults();
  truck.ipos = [r.i32("a truck"), r.i32("a truck"), r.i32("a truck")];
  truck.theta = r.f32("a truck"); truck.phi = r.f32("a truck"); truck.psi = r.f32("a truck");
  truck.course = r.i32("a truck");
  for (let i = 0; i < 4; i++) r.i32("a truck");
  truck.name = cString(r.take(r.u8("a truck name"), "a truck name")).slice(0, CAP.truckName - 1);
  return truck;
}

/*
  The writing half.
*/

/** HasLeadIns: course 2..4 hands over to a lane course. */
export function hasLeadIns(rules: RaceRules | null | undefined): boolean {
  const lt = rules?.leadinThen;
  return Boolean(lt && (lt[2]! >= 0 || lt[3]! >= 0 || lt[4]! >= 0));
}

/**
  SaveBinary's rule: the lowest generation that holds everything this track uses, each rule simply setting the
  version (the later ones win): race rules on 21, walls 22, a lead-in 23, a version 6 track 24. A classic track
  never stamps 24.
*/
export function txxVersionFor(track: TxxTrack): number {
  let version = 2;
  const lights = track.boxes.filter((b) => b.type === TRAXX_BOX_LIGHT);
  if (lights.length) version = 3;
  if (track.boxes.some((b) => b.soundCont.length > SOUND_FIELD_V3 || b.soundImpact.length > SOUND_FIELD_V3)) version = 4;
  if (lights.some((b) => f32(b.light.bright) !== traxxLightDefaults().bright)) version = 5;
  if (lights.some((b) => f32(b.light.aimOffset) !== traxxLightDefaults().aimOffset)) version = 6;
  const differs = (name: string, suffix: "S" | "L") => name !== "" && name.toUpperCase() !== traxxUiBitmapName("", track.prefix, suffix).toUpperCase();
  if (differs(track.logoBmpName, "S") || differs(track.mapBmpName, "L")) version = 7;
  if (track.infoBmp || track.infoText) version = 8;
  if (track.detailMap || track.maskMap) version = 9;
  if (track.uiHd.some(Boolean)) version = 10;
  if (track.waterLevel4 % 4 !== 0) version = 11;
  // Traxx 1.7: each simply set, never lowering what the rules above chose (V12 and V13 are read, not written).
  if (track.boxes.some((b) => b.type === TRAXX_BOX_FOG)) version = 14;
  if (track.vegetation && (track.vegetation.image || track.vegetation.masks.some(Boolean))) version = 15;
  if (track.lakes.length) version = 16;
  if (track.terrainMode !== TERRAINMODE_CLASSIC8) version = 17;
  // V18 only with waterfalls: a superset of V17 (a classic track writes the V17 block as the mode alone).
  if (track.falls?.length) version = 18;
  // V19 (Traxx 1.7.2) only with a water detail normal or a water mask, either alone being enough.
  if (track.waterDetailMap || track.waterMaskMap) version = TXX_WATER_MAPS_VERSION;
  // V20 (Traxx 1.8.0) only when some light has the all-weather flag set (BoxLightNeedsAllWxField).
  if (lights.some((b) => b.light.allWx !== 0)) version = TXX_ALLWX_VERSION;
  // V21 only when the race rules are on; a box's split fields alone do not stamp it.
  const rules = track.raceRules;
  if (rules && rules.mode !== RACERULES_NONE) version = TXX_RACE_VERSION;
  if (rules && rules.walls.length > 0) version = TXX_WALLS_VERSION;
  if (hasLeadIns(rules)) version = TXX_LEADINS_VERSION;
  if (isV6(track)) version = TXX_V6_VERSION;
  return version;
}

/**
  CanSaveBinary (TrackPODBinary.cpp): null when the track can be saved, else Traxx's sentence saying why not: a
  v6 track on Classic 8-bit, a terrain height or a ground box outside the kind's 0..ceiling.
*/
export function canSaveTxx(track: TxxTrack): string | null {
  if (isV6(track) && track.terrainMode === TERRAINMODE_CLASSIC8) return TXX_CANNOT_SAVE_CLASSIC8;
  const tall = isV6(track) && tallHeights(track);
  const top = tall ? TERRAIN_H_TALL_MAX : 65535;
  const g = track.terrainMode === TERRAINMODE_CLASSIC8 ? null : track.fine ?? track.h16;
  if (g) for (let i = 0; i < g.length; i++) { const v = g[i]!; if (v > top || v < 0) return tall ? TXX_CANNOT_SAVE_TERRAIN_TALL : TXX_CANNOT_SAVE_TERRAIN; }
  for (const b of track.groundBoxes) {
    if (b.lower < 0 || b.upper < 0 || b.lower > top || b.upper > top) return tall ? TXX_CANNOT_SAVE_BOX_TALL : TXX_CANNOT_SAVE_BOX;
  }
  return null;
}

/** StoredSavable: a stored lake map for the lakes the track has now, on a v6 track (StoredLakesFitTXX). */
function storedSavable(track: TxxTrack): boolean {
  const s = track.storedLakeMap;
  const nn = track.worldCells * track.worldCells;
  return Boolean(s && isV6(track) && track.lakes.length > 0 && s.lakes === track.lakes.length && s.tmap.length === nn);
}

class Writer {
  private chunks: Uint8Array[] = [];
  private scratch = new DataView(new ArrayBuffer(4));
  bytes(data: Uint8Array): void { this.chunks.push(data); }
  u8(v: number): void { this.chunks.push(Uint8Array.of(v & 0xff)); }
  i16(v: number): void { this.scratch.setInt16(0, v, true); this.chunks.push(new Uint8Array(this.scratch.buffer.slice(0, 2))); }
  u16(v: number): void { this.scratch.setUint16(0, v, true); this.chunks.push(new Uint8Array(this.scratch.buffer.slice(0, 2))); }
  i32(v: number): void { this.scratch.setInt32(0, v | 0, true); this.chunks.push(new Uint8Array(this.scratch.buffer.slice(0, 4))); }
  f32(v: number): void { this.scratch.setFloat32(0, v, true); this.chunks.push(new Uint8Array(this.scratch.buffer.slice(0, 4))); }
  /** SAVESTRING: strlen + 1, clamped to 255, then that many bytes. */
  string(text: string): void {
    const encoded = latin1(text);
    const len = Math.min(255, encoded.length + 1);
    this.u8(len);
    const out = new Uint8Array(len);
    out.set(encoded.subarray(0, len));
    this.bytes(out);
  }
  /** An item buffer: its length, then the bytes; 0 for none. */
  blob(data: Uint8Array | null): void {
    this.i32(data ? data.length : 0);
    if (data && data.length) this.bytes(data);
  }
  result(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of this.chunks) { out.set(c, at); at += c.length; }
    return out;
  }
}

/**
  Write a .TXX as Traxx's SaveBinary does, stamped with txxVersionFor. Like SaveBinary it first folds any 8-bit
  height edits into a 16-bit terrain (syncFromRaw). A track CanSaveBinary refuses throws a TxxError with its
  sentence (canSaveTxx), and nothing is written.
*/
export function writeTxx(track: TxxTrack): Uint8Array {
  syncFromRaw(track);
  const why = canSaveTxx(track);
  if (why) throw new TxxError(why);
  const version = txxVersionFor(track);
  const v24 = version >= TXX_V6_VERSION;
  const N = track.worldCells === 512 ? 512 : 256;
  if (!v24 && N !== 256) throw new TxxError("a 512-cell world is a version 6 track");
  const w = new Writer();
  const header = new Uint8Array(10);
  header.set(latin1(`TRAXXV${version}`));
  w.bytes(header);

  w.string(track.comment);
  w.string(track.prefix);
  w.string(track.trackName);
  w.string(track.localeName);
  if (version >= 7) { w.string(track.logoBmpName); w.string(track.mapBmpName); }
  w.i32(track.trackType);
  w.i32(Math.trunc(track.waterLevel4 / 4));
  w.i32(track.versionFlags);
  w.i32(track.ambientSound);
  w.i32(track.weatherMask);
  w.blob(track.logoBmp);
  w.blob(track.mapBmp);
  w.blob(track.music);
  w.blob(track.text);
  if (version >= 8) { w.blob(track.infoBmp); w.blob(track.infoText); }
  if (version >= 9) {
    w.string(track.detailExt); w.blob(track.detailMap);
    w.string(track.maskExt); w.blob(track.maskMap);
  }
  if (version >= 10) {
    for (let i = 0; i < TXX_UI_ART_SLOTS; i++) {
      const art = track.uiHd[i] ?? null;
      w.string(art ? art.ext : "");
      w.blob(art ? art.data : null);
    }
  }
  if (version >= 11) w.i32(track.waterLevel4 % 4);

  w.string(track.paletteName);
  const palette = new Uint8Array(768);
  palette.set(track.palette.subarray(0, 768));
  w.bytes(palette);

  w.i32(track.textures.length);
  for (const texture of track.textures) {
    w.string(texture.name);
    w.i32(texture.type);
    w.i32(texture.depth);
    w.i32(0);
  }
  w.i32(track.models.length);
  for (const model of track.models) w.string(model);
  w.i32(track.boxes.length);
  for (const box of track.boxes) writeBox(w, box, version);

  writeCourse(w, track.course);
  const extended = track.extendedCourses.filter((c): c is TxxCourseSegment[] => c !== null);
  w.i32(extended.length);
  for (const course of extended) writeCourse(w, course);

  // V24: the world's size in cells, right before the terrain.
  if (v24) w.i32(N);
  writeTerrain(w, track, N * N);
  for (let i = 0; i < 9; i++) writeTruck(w, track.trucks[i] ?? traxxTruckDefaults());

  if (!track.backdropName) w.string("");
  else if (track.arena) {
    const record = new Uint8Array(32);
    record.set(latin1(track.backdropName).subarray(0, 31));
    const view = new DataView(record.buffer);
    view.setInt16(30, track.arena.x, true);
    view.setInt16(28, track.arena.y, true);
    view.setInt16(26, track.arena.sx, true);
    view.setInt16(24, track.arena.sy, true);
    w.u8(32);
    w.bytes(record);
  } else w.string(track.backdropName);

  // Traxx always records the sun.
  let miscflags = MISCFLAG_SUNPOS;
  if (track.fogMap) miscflags |= MISCFLAG_FOGMAP;
  if (track.omitRawFallback) miscflags |= MISCFLAG_NORAWFALLBACK;
  if (track.pngHeights) miscflags |= MISCFLAG_PNGHEIGHTS;
  w.i32(miscflags);
  if (track.fogMap) {
    const fog = new Uint8Array(32768);
    fog.set(track.fogMap.subarray(0, 32768));
    w.bytes(fog);
  }

  // CTrackPODGroundbox::Save: V24 the heights as i32 v, below it one byte each (BoxByte: v >> 8, 0..255).
  w.i32(track.groundBoxes.length);
  for (const g of track.groundBoxes) {
    w.i32(g.x); w.i32(g.y); w.i32(g.w); w.i32(g.h);
    if (v24) { w.i32(g.lower); w.i32(g.upper); } else { w.u8(boxByte(g.lower)); w.u8(boxByte(g.upper)); }
    for (let face = 0; face < 6; face++) w.u16(g.faces[face] ?? 0);
  }

  // SaveBinary drops a sound no box names any more. Changed on purpose: a WAV a waterfall names is
  // kept too (Traxx 1.7.1 drops it, and the fall loses its sound on the next load).
  const used = new Set(track.boxes.flatMap((b) => [`SOUND\\${b.soundImpact}`, `SOUND\\${b.soundCont}`]));
  const fallWavs = new Set((track.falls ?? []).filter((f) => f.sound).map((f) => `SOUND\\${f.sound}.WAV`.toUpperCase()));
  const sounds = track.sounds.filter((s) => used.has(s.name) || fallWavs.has(s.name.toUpperCase()));
  w.i32(sounds.length);
  for (const sound of sounds) {
    w.string(sound.name);
    w.i32(sound.data.length);
    w.i32(sound.flags);
    w.bytes(sound.data);
  }

  w.i32(track.animations.length);
  for (const animation of track.animations) {
    w.i32(animation.period);
    w.i32(animation.nframes);
    for (let k = 0; k < ANI_FRAMES; k++) w.i32(animation.frames[k] ?? 0);
  }

  const sun = track.sun ?? { vector: [0, 0, 0], shadowIntensity: 0, position: [0, 0, 0], intensity: 0 };
  for (const v of sun.vector) w.i32(v);
  w.i32(sun.shadowIntensity);
  for (const v of sun.position) w.i32(v);
  w.i32(sun.intensity);

  // V15: vegetation (a lake-only or 16-bit track writes it empty: two empty masks and a 0).
  if (version >= 15) {
    const veg = track.vegetation;
    for (let layer = 0; layer < VEG_LAYERS; layer++) {
      const mask = veg?.masks[layer] ?? null;
      w.string(mask ? mask.ext : "");
      w.blob(mask ? mask.data : null);
    }
    w.blob(veg?.image ?? null);
  }

  // V16: lakes (CTrackPODLakes::SaveTXX), the seed count clamped to 0..8.
  if (version >= 16) {
    w.i32(track.lakes.length);
    for (const lake of track.lakes) {
      w.i32(lake.height);
      w.i32(lake.flags);
      const seeds = lake.seeds.slice(0, LAKE_MAX_SEEDS);
      w.i32(seeds.length);
      for (const [x, z] of seeds) { w.i32(x); w.i32(z); }
    }
  }

  // V17: the terrain mode, then its heights (SaveTXXHeights: none for classic 8-bit; V24: i32 32, then i32 samples).
  if (version >= 17) {
    w.i32(track.terrainMode);
    if (track.terrainMode !== TERRAINMODE_CLASSIC8) {
      const src = track.fine ?? track.h16;
      if (!src) throw new TxxError("a 16-bit terrain has no 16-bit heights");
      if (v24) {
        w.i32(32);
        const out = new Uint8Array(src.length * 4);
        const dv = new DataView(out.buffer);
        for (let i = 0; i < src.length; i++) dv.setUint32(4 * i, src[i]! >>> 0, true);
        w.bytes(out);
      } else {
        const out = new Uint8Array(src.length * 2);
        for (let i = 0; i < src.length; i++) { out[2 * i] = src[i]! & 255; out[2 * i + 1] = (src[i]! >> 8) & 255; }
        w.bytes(out);
      }
    }
  }

  // V18: the waterfalls (CTrackPODFalls::SaveTXX): block version 3, the count, every field as an
  // int (all 8 points; mist depth and height after the volume, roughfrom after them), then the two char[16].
  if (version >= 18) {
    w.i32(3);
    w.i32(track.falls.length);
    for (const f of track.falls.slice(0, FALL_MAX_FALLS)) {
      w.i32(f.source); w.i32(f.npoints); w.i32(f.flags); w.i32(f.speed); w.i32(f.height);
      for (let k = 0; k < FALL_MAX_POINTS; k++) { w.i32(f.pt[k]?.[0] ?? 0); w.i32(f.pt[k]?.[1] ?? 0); }
      w.i32(f.opacity); w.i32(f.mist); w.i32(f.volume); w.i32(f.mistdepth); w.i32(f.mistheight); w.i32(f.roughfrom ?? 0);
      for (const name of [f.sound, f.texture]) { const b = new Uint8Array(FALL_NAMELEN); b.set(latin1(name).subarray(0, FALL_NAMELEN)); w.bytes(b); }
    }
  }

  // V19 (Traxx 1.7.2): the water detail normal and the water mask, the V9 pair's layout (an empty ext and length 0 when unset).
  if (version >= TXX_WATER_MAPS_VERSION) {
    w.string(track.waterDetailMap ? track.waterDetailExt : ""); w.blob(track.waterDetailMap);
    w.string(track.waterMaskMap ? track.waterMaskExt : ""); w.blob(track.waterMaskMap);
  }

  const rules = track.raceRules ?? raceRulesDefaults();
  // V21: the race-rules block, block version 1, the mode and the laps as held.
  if (version >= TXX_RACE_VERSION) { w.i32(1); w.i32(rules.mode); w.i32(rules.laps); }
  // V22: the walls block (CTrackPODWalls::SaveTXX).
  if (version >= TXX_WALLS_VERSION) w.bytes(encodeWallsBlock(rules.walls));
  // V23: the lead-ins block, written raw.
  if (version >= TXX_LEADINS_VERSION) { w.i32(1); for (let c = 0; c < 5; c++) w.i32(rules.leadinThen[c] ?? -1); }

  // V24: the v6 block: version 2 (3 with the stored lake map), flags (bit 0 tall), water4, [the stored map].
  if (v24) {
    const stored = storedSavable(track) ? track.storedLakeMap! : null;
    w.i32(stored ? V6_BLOCK_VERSION_STORED : V6_BLOCK_VERSION);
    w.i32(tallHeights(track) ? 1 : 0);
    w.i32(track.waterLevel4);
    if (stored) { w.i32(stored.shown ? 1 : 0); w.i32(N * N); w.bytes(stored.tmap); }
  }

  // The JSTraxx trailer goes after everything Traxx reads, so Traxx stops before it.
  const extras = track.arena ? [] : track.extraBackdrops.filter(Boolean);
  if (extras.length) {
    w.bytes(latin1(TRAILER_MAGIC));
    w.i32(extras.length);
    for (const name of extras) w.string(name);
  }
  return w.result();
}

/** CTrackPODBox::Save. */
function writeBox(w: Writer, box: TraxxBox, version: number): void {
  for (const v of box.ipos) w.i32(v);
  w.f32(box.theta); w.f32(box.phi); w.f32(box.psi);
  w.i32(box.length); w.i32(box.width); w.i32(box.height);
  w.f32(box.mass);
  for (const v of box.bvel) w.f32(v);
  w.f32(box.p); w.f32(box.q); w.f32(box.r);
  w.i32(box.type); w.i32(box.flags); w.i32(box.priority); w.i32(box.checkpointSeq); w.i32(box.heightAboveGround);
  let sounds = 0;
  if (box.soundCont) sounds |= BOXFLAG_CONT;
  if (box.soundImpact) sounds |= BOXFLAG_IMPACT;
  w.i32(sounds);
  for (const [flag, name] of [[BOXFLAG_CONT, box.soundCont], [BOXFLAG_IMPACT, box.soundImpact]] as const) {
    if (!(sounds & flag)) continue;
    if (version >= 4) w.string(name);
    else {
      // The old fixed field: exactly 12 bytes, the name and its terminator (zero-filled past it).
      const field = new Uint8Array(SOUND_FIELD_V3);
      field.set(latin1(name).subarray(0, SOUND_FIELD_V3));
      w.bytes(field);
    }
  }
  w.i16(box.fraction[2]);
  w.i16((box.fraction[0] & 0xff) | ((box.fraction[1] & 0xff) << 8));
  w.string(box.modelName);
  if (box.type === TRAXX_BOX_CRUSH) {
    w.string(box.crushName);
    for (const v of box.crush) w.f32(v);
  }
  if (version >= 3) {
    const l = box.light;
    w.f32(l.radius); w.f32(l.heightOffset); w.f32(l.r); w.f32(l.g); w.f32(l.b);
    w.i32(l.glowMode); w.f32(l.glowRadius); w.f32(l.coneLength); w.f32(l.coneRimRadius); w.f32(l.coneBaseRadius);
  }
  if (version >= 5) w.f32(box.light.bright);
  if (version >= 6) w.f32(box.light.aimOffset);
  if (version >= BOXBIN_VERSION_FOG) {
    const f = box.fog;
    for (const v of [f.w, f.l, f.h, f.base, f.vis, f.r, f.g, f.b, f.half, f.edge, f.top, f.maxop]) w.f32(v);
    w.i32(f.wmask);
    if (version >= BOXBIN_VERSION_FOGLOOK) { w.f32(f.round); w.f32(f.wisp); w.f32(f.wsize); w.f32(f.wspeed); }
    if (version >= BOXBIN_VERSION_FOGBOT) w.f32(f.bot);
  }
  // V20: the all-weather flag, for every box of the file (CTrackPODBox::Save writes the int as held).
  if (version >= TXX_ALLWX_VERSION) w.i32(box.light.allWx);
  // V21: the checkpoint's split and lane, for every box of the file.
  if (version >= TXX_RACE_VERSION) { w.i32(box.cpSplit ?? 0); w.i32(box.cpLane ?? 0); }
}

function writeCourse(w: Writer, segments: readonly TxxCourseSegment[]): void {
  w.i32(segments.length);
  for (const s of segments) {
    for (const v of [...s.cstart, ...s.cend, s.speedLimit, s.trackWidth, ...(s.spare ?? [0, 0])]) w.i32(v);
  }
}

/** CTrackPODTerrain::Save: always compressed, runs of at most 255, each plane ending with a 0 (CELLS cells; N x N from V24). */
function writeTerrain(w: Writer, track: TxxTrack, CELLS = 256 * 256): void {
  const lte = track.lte ?? new Uint8Array(CELLS * 7);
  w.u16(TERFILE_RAW | TERFILE_CLR | TERFILE_LTE | TERFILE_COMPRESS);
  const plane = (get: (cell: number) => number) => {
    let cell = 0;
    while (true) {
      const value = get(cell);
      let run = 0;
      while (get(cell) === value) {
        cell++;
        run++;
        if (cell >= CELLS || run > 254) break;
      }
      w.u8(run);
      w.u8(value);
      if (cell >= CELLS) break;
    }
    w.u8(0);
  };
  plane((c) => track.heights[c]);
  plane((c) => track.clr[c] & 0xff);
  plane((c) => track.clr[c] >> 8);
  for (let p = 0; p < 7; p++) plane((c) => lte[c * 7 + p]);
}

function writeTruck(w: Writer, truck: TraxxTruck): void {
  for (const v of truck.ipos) w.i32(v);
  w.f32(truck.theta); w.f32(truck.phi); w.f32(truck.psi);
  w.i32(truck.course);
  for (let i = 0; i < 4; i++) w.i32(0);
  const name = latin1(truck.name);
  w.u8(name.length + 1);
  const out = new Uint8Array(name.length + 1);
  out.set(name);
  w.bytes(out);
}

/** The bytes up to the first NUL, one character per byte. */
function cString(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  let out = "";
  for (let i = 0; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** One byte per character: Traxx's strings are 8-bit, written as they were read. */
function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
}
