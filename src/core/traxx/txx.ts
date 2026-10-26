/*
  The .TXX, Traxx's working file (Traxx 1.6.7, TrackPOD/TrackPODBinary.cpp: CTrackPOD::LoadBinary
  and SaveBinary, with each component's own Load/Save).

  A little-endian record of the whole track, in Traxx's units: header strings, the track's
  blobs (UI bitmaps, music, text, info pop-up, detail and mask maps, HD art), the palette, the
  texture, model and box tables, the courses, the run-length-coded terrain, the trucks, the
  backdrop, fog map, ground boxes, sounds, animations and the sun. Art and models are kept by
  name only; Traxx reloads them from its ART and MODELS folders.

  The header names the generation, TRAXXV1 to TRAXXV11. Each one appends fields, and Traxx
  writes the LOWEST generation the track's contents need (txxVersionFor), so a track that uses
  nothing new stays readable by an older Traxx. Every rule below says which generation adds it.

  Strings are one length byte then the bytes, the length counting the terminating NUL. A reader
  keeps what fits the destination and consumes the rest, as LOADSTRINGN does.
*/
import { f32 } from "./cformat.ts";
import { traxxBoxDefaults, traxxLightDefaults, traxxTruckDefaults, traxxUiBitmapName, TRAXX_BOX_CRUSH, TRAXX_BOX_LIGHT } from "./sit.ts";
import type { TraxxArena, TraxxBox, TraxxCourseSegment, TraxxTruck } from "./sit.ts";

/** The newest generation this port reads and writes. */
export const TXX_LATEST_VERSION = 11;

const MISCFLAG_FOGMAP = 0x1;
const MISCFLAG_SUNPOS = 0x2;
const MISCFLAG_NORAWFALLBACK = 0x4;
const TERFILE_RAW = 0x1;
const TERFILE_CLR = 0x2;
const TERFILE_LTE = 0x4;
const TERFILE_COMPRESS = 0x8000;
const BOXFLAG_CONT = 0x1;
const BOXFLAG_IMPACT = 0x2;
/** The pre-V4 fixed sound-name field. */
const SOUND_FIELD_V3 = 12;
const CELLS = 256 * 256;
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

/** Read a .TXX. Throws a TxxError for a file that is not one, or that ends early. */
export function readTxx(bytes: Uint8Array): TxxTrack {
  const r = new Reader(bytes);
  const header = cString(r.take(10, "the header"));
  const match = /^TRAXXV(\d+)$/.exec(header);
  const version = match ? Number(match[1]) : 0;
  if (version < 1 || version > TXX_LATEST_VERSION) throw new TxxError(`not a Traxx working file (header "${header}")`);

  const comment = r.string(CAP.comment, "the comment");
  const prefix = r.string(CAP.prefix, "the stem");
  const trackName = r.string(CAP.trackName, "the track name");
  const localeName = r.string(CAP.localeName, "the locale");
  let logoBmpName = "", mapBmpName = "";
  if (version >= 7) {
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
  if (version >= 8) {
    infoBmp = r.blob("the info photo");
    infoText = r.blob("the info text");
  }
  let detailExt = "", detailMap: Uint8Array | null = null, maskExt = "", maskMap: Uint8Array | null = null;
  if (version >= 9) {
    detailExt = r.string(CAP.ext, "the detail extension");
    detailMap = r.blob("the detail map");
    maskExt = r.string(CAP.ext, "the mask extension");
    maskMap = r.blob("the mask map");
  }
  const uiHd: (TxxHdArt | null)[] = [null, null, null];
  if (version >= 10) {
    for (let i = 0; i < TXX_UI_ART_SLOTS; i++) {
      const ext = r.string(CAP.ext, "an HD art extension");
      const data = r.blob("HD art");
      uiHd[i] = data ? { ext, data } : null;
    }
  }
  let waterLevel4 = 4 * waterLevel;
  if (version >= 11) waterLevel4 += r.i32("the water quarters");
  waterLevel4 = Math.min(4 * 255, Math.max(0, waterLevel4));

  const paletteName = r.string(CAP.podItem, "the palette name");
  const palette = r.take(768, "the palette");

  const textures: TxxTrack["textures"] = [];
  const textureCount = r.i32("the texture count");
  for (let i = 0; i < textureCount; i++) {
    const name = r.string(CAP.podItem, "a texture name") || "ERROR";
    let type = 0, depth = 0;
    if (version > 1) {
      type = r.i32("a texture type");
      depth = r.i32("a texture depth");
      r.i32("a texture spare");
    }
    textures.push({ name, type, depth });
  }

  const models: string[] = [];
  const modelCount = r.i32("the model count");
  for (let i = 0; i < modelCount; i++) models.push(r.string(CAP.podItem, "a model name"));

  const boxes: TraxxBox[] = [];
  const boxCount = r.i32("the box count");
  for (let i = 0; i < boxCount; i++) boxes.push(readBox(r, version));

  const course = readCourse(r);
  const extendedCourses: (TxxCourseSegment[] | null)[] = [null, null, null, null];
  const extCount = r.i32("the extended course count");
  for (let i = 0; i < extCount; i++) {
    const segments = readCourse(r);
    if (i < extendedCourses.length) extendedCourses[i] = segments;
  }

  const terrain = readTerrain(r);

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

  const groundBoxes: TxxGroundBox[] = [];
  const groundBoxCount = r.i32("the ground box count");
  for (let i = 0; i < groundBoxCount; i++) {
    const x = r.i32("a ground box"), y = r.i32("a ground box"), w = r.i32("a ground box"), h = r.i32("a ground box");
    const lower = r.u8("a ground box"), upper = r.u8("a ground box");
    const faces: number[] = [];
    for (let face = 0; face < 6; face++) faces.push(r.u16("a ground box"));
    groundBoxes.push({ x, y, w, h, lower, upper, faces });
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

  // The JSTraxx trailer, when there is one (see extraBackdrops).
  const extraBackdrops: string[] = [];
  if (r.pos + TRAILER_MAGIC.length <= bytes.length && cString(bytes.subarray(r.pos, r.pos + TRAILER_MAGIC.length)) === TRAILER_MAGIC) {
    r.take(TRAILER_MAGIC.length, "the JSTraxx trailer");
    const count = r.i32("the extra backdrops");
    for (let i = 0; i < count; i++) extraBackdrops.push(r.string(CAP.podItem, "an extra backdrop"));
  }

  return {
    version, comment, prefix, trackName, localeName, logoBmpName, mapBmpName, trackType, waterLevel4,
    versionFlags, ambientSound, weatherMask, logoBmp, mapBmp, music, text, infoBmp, infoText,
    detailExt, detailMap, maskExt, maskMap, uiHd, paletteName, palette, textures, models, boxes, course,
    extendedCourses, heights: terrain.heights, clr: terrain.clr, lte: terrain.lte, trucks, backdropName, extraBackdrops, arena,
    omitRawFallback: (miscflags & MISCFLAG_NORAWFALLBACK) !== 0, fogMap, groundBoxes, sounds, animations, sun,
  };
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

/** CTrackPODTerrain::Load: the flags word, then each plane raw or run-length coded. */
function readTerrain(r: Reader): { heights: Uint8Array; clr: Uint16Array; lte: Uint8Array | null } {
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

/** SaveBinary's rule: the lowest generation that holds everything this track uses. */
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
  return version;
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

/** Write a .TXX as Traxx's SaveBinary does, stamped with txxVersionFor. */
export function writeTxx(track: TxxTrack): Uint8Array {
  const version = txxVersionFor(track);
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

  writeTerrain(w, track);
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
  w.i32(miscflags);
  if (track.fogMap) {
    const fog = new Uint8Array(32768);
    fog.set(track.fogMap.subarray(0, 32768));
    w.bytes(fog);
  }

  w.i32(track.groundBoxes.length);
  for (const g of track.groundBoxes) {
    w.i32(g.x); w.i32(g.y); w.i32(g.w); w.i32(g.h); w.u8(g.lower); w.u8(g.upper);
    for (let face = 0; face < 6; face++) w.u16(g.faces[face] ?? 0);
  }

  // SaveBinary drops a sound no box names any more.
  const used = new Set(track.boxes.flatMap((b) => [`SOUND\\${b.soundImpact}`, `SOUND\\${b.soundCont}`]));
  const sounds = track.sounds.filter((s) => used.has(s.name));
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
}

function writeCourse(w: Writer, segments: readonly TxxCourseSegment[]): void {
  w.i32(segments.length);
  for (const s of segments) {
    for (const v of [...s.cstart, ...s.cend, s.speedLimit, s.trackWidth, ...(s.spare ?? [0, 0])]) w.i32(v);
  }
}

/** CTrackPODTerrain::Save: always compressed, runs of at most 255, each plane ending with a 0. */
function writeTerrain(w: Writer, track: TxxTrack): void {
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
