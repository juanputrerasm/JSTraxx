/*
  Track Components (CTraxxView::OnViewComponents): what the dialog shows of a track, and what
  OK writes back.

  The track type list is Circuit, Rally, Rumble, Drag; the palette list is the sixteen stock
  palettes and, only when the track already has one, Custom (16). A new stock palette brings its
  fog map (the default one for palette 0), as CTraxxDoc::SelectMTM2Palette does.
*/
import type { TrackDocument, ModelAsset, TextureAsset } from "./document.ts";
import type { TxxHdArt } from "../traxx/txx.ts";
import type { TraxxArena } from "../traxx/sit.ts";
import { MTM2_ONLY } from "./document.ts";
import { defaultFogMap, paletteIndexFromFogMap, stockPalette, traxxFogMap, withSysColors } from "../traxx/palette.ts";
import { stemFromText } from "../traxx/terrain.ts";
import { TRACKTYPE_CIRCUIT, TRACKTYPE_DRAG, TRACKTYPE_RALLY, TRACKTYPE_RUMBLE } from "./new-track.ts";
import type { Touch } from "../edit/history.ts";
import { musicKind } from "../traxx/pod-writer.ts";

/** The Type radio buttons, in order. */
export const TRACK_TYPES = [TRACKTYPE_CIRCUIT, TRACKTYPE_RALLY, TRACKTYPE_RUMBLE, TRACKTYPE_DRAG];
/** IDC_AMBIENTSOUND's list. */
export const SOUND_THEMES = ["Default", "Voodoo", "Excavation", "Farm Road", "Scrapyard", "Heights", "Sidewinder Canyon", "Tinhorn Junction", "Tumbleweed", "Breakneck Ridge", "Arena Rumble", "Pyramid Rumble", "Hypercube Rumble", "Graveyard", "Tweety birds (C98)", "15"];
/** IDC_COLORPALETTE's list. */
export const PALETTE_NAMES = ["Farm Road", "Voodoo", "Excavation", "Scrapyard", "Heights", "Sidewinder Canyon", "Tinhorn Junction", "Tumbleweed", "Breakneck Ridge", "Arena Rumble", "Pyramid Rumble", "Hypercube Rumble", "Graveyard", "Crazy98", "Torture Pit", "Metalcr3", "Custom"];
/** StockMusicDlg: the game's music, name and where it plays. */
export const STOCK_MUSIC: readonly (readonly [string, string])[] = [
  ["AZTEC", "Excavation"], ["BREAK", "B'neck, C98, Torture, Arena, H'cube"], ["FARM", "Farm Road"], ["GRAVEX", "Graveyard"],
  ["ROCKX", "Heights, Outback, Pyramid"], ["SCRAP", "Scrapyard"], ["SPLASH", "Pre-race"], ["SURF", "Tumbleweed, Sidewinder"], ["VOODOO", "Voodoo Island"],
];
/** INFO_TEXT_MAX: the engine reads this much of the description. */
export const INFO_TEXT_MAX = 4095;

/** The art slots, BMP_SMALL / BMP_LARGE / BMP_INFO, which are the pod's UIART_ ones. */
/** The most backdrops a track is given (the most seen in a shipped .SIT). */
export const MAX_BACKDROPS = 4;

export const SLOT_BROWSE = 0, SLOT_ICON = 1, SLOT_INFO = 2;

export interface Components {
  trackName: string;
  stem: string;
  stemAuto: boolean;
  comment: string;
  typeIndex: number;
  water4: number;
  ambient: number;
  paletteIndex: number;
  mtm2Only: boolean;
  /** small_bmp, large_bmp and info_bmp, in slot order; each a whole .BMP or a stock icon record. */
  bitmaps: [Uint8Array | null, Uint8Array | null, Uint8Array | null];
  hd: (TxxHdArt | null)[];
  infoText: string;
  detail: { ext: string; map: Uint8Array | null };
  mask: { ext: string; map: Uint8Array | null };
  music: Uint8Array | null;
  /**
    The backdrop models in drawing order: the track's backdrop, then the extra ones
    (TxxTrack.extraBackdrops). With an arena, the one stadium model.
  */
  backdrops: string[];
  /** The first backdrop is a stadium (arena), placed by `arena`. */
  isArena: boolean;
  arena: TraxxArena | null;
  /** Backdrops loaded in the dialog, with the textures they brought. */
  loadedBackdrops: { model: ModelAsset; textures: TextureAsset[] }[];
}

const latin1 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length && b[i]; i++) s += String.fromCharCode(b[i]!); return s; };

export function componentsOf(doc: TrackDocument): Components {
  const t = doc.track;
  return {
    trackName: t.trackName,
    stem: t.prefix,
    stemAuto: doc.prefixAuto,
    comment: t.comment,
    typeIndex: Math.max(0, TRACK_TYPES.indexOf(t.trackType)),
    water4: t.waterLevel4,
    ambient: t.ambientSound,
    paletteIndex: paletteIndexFromFogMap(t.fogMap),
    mtm2Only: (t.versionFlags & MTM2_ONLY) !== 0,
    bitmaps: [t.logoBmp, t.mapBmp, t.infoBmp],
    hd: [0, 1, 2].map((i) => t.uiHd[i] ?? null),
    infoText: t.infoText ? latin1(t.infoText) : "",
    detail: { ext: t.detailExt, map: t.detailMap },
    mask: { ext: t.maskExt, map: t.maskMap },
    music: t.music,
    backdrops: [t.backdropName, ...t.extraBackdrops].filter(Boolean),
    isArena: Boolean(t.arena),
    arena: t.arena ? { ...t.arena } : null,
    loadedBackdrops: [],
  };
}

/** Pod1StemFromText applied for OK: "" when nothing usable is left. */
export function cleanStem(text: string): string {
  return stemFromText(text);
}

/** OK: everything onto the document. Returns what the view has to redraw. */
export function applyComponents(doc: TrackDocument, c: Components): Touch {
  const t = doc.track;
  const touch: Touch = { track: true };
  t.comment = c.comment;
  // SetTrackName re-derives a stem that follows the name; then the dialog's own choice.
  t.trackName = c.trackName;
  if (c.stemAuto) {
    doc.prefixAuto = true;
    const derived = stemFromText(c.trackName);
    if (derived) t.prefix = derived;
  } else {
    doc.prefixAuto = false;
    t.prefix = c.stem;
  }
  t.trackType = TRACK_TYPES[c.typeIndex] ?? TRACKTYPE_CIRCUIT;
  if (t.waterLevel4 !== c.water4) { t.waterLevel4 = c.water4; touch.water = true; }
  t.ambientSound = c.ambient;
  [t.logoBmp, t.mapBmp, t.infoBmp] = c.bitmaps;
  t.uiHd = [...c.hd];
  t.detailExt = c.detail.ext;
  t.detailMap = c.detail.map;
  t.maskExt = c.mask.ext;
  t.maskMap = c.mask.map;
  t.music = c.music;
  // An empty box is no text at all; otherwise the bytes and a terminator, as Traxx allocates.
  if (!/[^\x00-\x20]/.test(c.infoText)) t.infoText = null;
  else {
    const bytes = new Uint8Array(c.infoText.length + 1);
    for (let i = 0; i < c.infoText.length; i++) bytes[i] = c.infoText.charCodeAt(i) & 0xff;
    t.infoText = bytes;
  }
  {
    // The backdrops: models no longer listed (and used by no object) leave the track, the ones
    // loaded in the dialog join it. An arena is its one stadium model.
    const title = (n: string) => n.replace(/^.*\\/, "").toUpperCase();
    const same = (a: string, b: string) => title(a) === title(b);
    const list = (c.isArena ? c.backdrops.slice(0, 1) : c.backdrops.slice(0, MAX_BACKDROPS)).filter(Boolean);
    const before = [t.backdropName, ...t.extraBackdrops].filter(Boolean);
    const dropped = before.filter((n) => !list.some((k) => same(k, n)) && !t.models.some((m) => same(m, n)));
    if (dropped.length) doc.models = doc.models.filter((m) => !dropped.some((n) => same(m.name, n)));
    for (const x of c.loadedBackdrops) {
      if (!list.some((k) => same(k, x.model.name)) || doc.models.some((m) => same(m.name, x.model.name))) continue;
      doc.models.push(x.model);
      doc.modelTextures.push(...x.textures);
    }
    const arena = c.isArena && list.length ? clampArena(c.arena ?? { x: 128, y: 128, sx: 1, sy: 1 }) : null;
    if (before.join("|") !== list.join("|") || JSON.stringify(arena) !== JSON.stringify(t.arena)) touch.models = true;
    t.backdropName = list[0] ?? "";
    t.extraBackdrops = list.slice(1);
    t.arena = arena;
  }
  if (c.mtm2Only && c.paletteIndex !== paletteIndexFromFogMap(t.fogMap) && c.paletteIndex < 16) {
    t.palette = withSysColors(stockPalette(c.paletteIndex));
    t.fogMap = c.paletteIndex === 0 ? defaultFogMap() : traxxFogMap(t.palette, c.paletteIndex);
    touch.palette = true;
  }
  return touch;
}

/*
  Music (TraxxComponentsDlg.cpp, Traxx 1.7 e4b4cd5): an MTM2 track plays WAV, MP3 and OGG
  Vorbis, an MTM1 track MOD only. What a file IS comes from its bytes (MusicKindOf), never its
  name, as the pod writer decides the extension the same way.
*/

/** OnMusicLoad's filter: "Music (*.wav;*.mp3;*.ogg)" for MTM2, "Music MOD files (*.mod)" otherwise. */
export function musicAccept(mtm2Only: boolean): string {
  return mtm2Only ? ".wav,.mp3,.ogg" : ".mod";
}

/** OnMusicLoad's title. */
export function musicLoadTitle(mtm2Only: boolean): string {
  return mtm2Only ? "Load music (WAV, MP3 or OGG)" : "Load music MOD file";
}

/**
  OnMusicLoad: why the picked file is refused, or null to keep it. An empty file is refused
  first; then MTM2 takes WAV, MP3 and OGG (the Ogg must hold Vorbis: the identification header
  "\x01vorbis" within the first 96 bytes), MTM1 takes MOD only.
*/
export function musicLoadRefusal(bytes: Uint8Array, mtm2Only: boolean): string | null {
  if (bytes.length === 0) return "The music file is empty.";
  const kind = musicKind(bytes);
  if (mtm2Only) {
    if (kind !== "wav" && kind !== "mp3" && kind !== "ogg") return "That file is not a WAV, MP3 or OGG Vorbis file.";
    if (kind === "ogg") {
      let vorbis = false;
      for (let k = 0; k + 7 <= bytes.length && k < 96; k++) {
        if (bytes[k] === 1 && bytes[k + 1] === 0x76 && bytes[k + 2] === 0x6f && bytes[k + 3] === 0x72 && bytes[k + 4] === 0x62 && bytes[k + 5] === 0x69 && bytes[k + 6] === 0x73) { vorbis = true; break; }
      }
      if (!vorbis) return "That Ogg file does not hold Vorbis audio (Opus and FLAC are not supported).  Convert it to OGG Vorbis.";
    }
    return null;
  }
  return kind !== "mod" ? "The original game only plays MOD music.  Tick the MTM2-only box to use WAV, MP3 or OGG." : null;
}

/**
  OnMusicSaveAs: the extension the saved file takes (the filter and default extension follow
  the kind), or Traxx's message for a stock pick, which has no file to save.
*/
export function musicSaveAs(bytes: Uint8Array): { ext: "wav" | "mp3" | "ogg" | "mod" } | { message: string } {
  const kind = musicKind(bytes);
  if (kind === "stock") return { message: "This is one of the game's own music tracks, so there is no file to save." };
  return { ext: kind === "wav" || kind === "mp3" || kind === "ogg" ? kind : "mod" };
}

/** The MIME type a browser plays the music as (Play is a JSTraxx addition); null for a MOD or stock pick. */
export function musicMime(bytes: Uint8Array | null): string | null {
  const kind = musicKind(bytes);
  return kind === "wav" ? "audio/wav" : kind === "mp3" ? "audio/mpeg" : kind === "ogg" ? "audio/ogg" : null;
}

/** OnMusicSel: the stock name the Stock Music list starts on ("BREAK" unless a stock pick is set). */
export function stockMusicSelName(music: Uint8Array | null): string {
  if (!music || musicKind(music) !== "stock") return "BREAK";
  let s = "";
  for (let i = 6; i < music.length && music[i]; i++) s += String.fromCharCode(music[i]!);
  const at = s.indexOf(".WAV");
  return at >= 0 ? s.slice(0, at) : s;
}

/** OnMusicSel's OK: "MUSIC\<NAME>.WAV" in a 20-byte block (GlobalAlloc(GHND, 20), zero filled). */
export function stockMusicPick(name: string): Uint8Array {
  const s = `MUSIC\\${name}.WAV`;
  const out = new Uint8Array(Math.max(20, s.length + 1));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** OnArenaSettings: x and y kept to the grid, sizes to 1..128. */
export function clampArena(a: TraxxArena): TraxxArena {
  const c = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.trunc(v) || 0));
  return { x: c(a.x, 0, 255), y: c(a.y, 0, 255), sx: c(a.sx, 1, 128), sy: c(a.sy, 1, 128) };
}

/** TakeHDArt's rule for HD track art: the old shape and size, and the icon's 128 cap. Returns a refusal or null. */
export function hdArtRefusal(slot: number, mtm2Only: boolean, w: number, h: number): string | null {
  const { lw, lh, hdmax } = slotSpec(slot, mtm2Only);
  const what = slotWhat(slot, mtm2Only);
  const expect = Math.trunc((w * lh * 2 + lw) / (2 * lw));
  if (hdmax && (w > hdmax || h > hdmax)) {
    return `An HD icon can be at most ${hdmax} pixels on a side - the game takes anything larger for a track picture and shows the race-type icon instead.\n\nThat picture is ${w}x${h}.  At the icon's shape the largest is ${hdmax}x${Math.trunc((hdmax * lh * 2 + lw) / (2 * lw))}.`;
  }
  if (w < lw || h < lh) return `An HD ${what} must be at least the size of the old one, ${lw}x${lh}.\n\nThat picture is ${w}x${h}.`;
  if (h < expect - 1 || h > expect + 1) {
    return `An HD ${what} has to keep the old shape, ${lw}x${lh}.  The game fits it into the same box either way, so any other shape would not fill it the same.\n\nThat picture is ${w}x${h}; at ${w} wide it should be ${expect} high.`;
  }
  return null;
}

/** An 8-bit bitmap's limits (OnBitmapLoad / OnBitmapPaste). Returns a refusal or null. */
export function bitmapRefusal(slot: number, mtm2Only: boolean, w: number, h: number): string | null {
  if (slot === SLOT_INFO && (w !== 640 || h !== 480)) return `The info photo must be 640x480.\n\nThat bitmap is ${w}x${h}.`;
  if (slot === SLOT_ICON && mtm2Only && (w > 48 || h > 48)) {
    return `An icon bitmap can be at most 48 pixels on a side - the game takes anything larger for a track picture and shows the race-type icon instead.\n\nThat bitmap is ${w}x${h}.`;
  }
  return null;
}

/** SlotSpec: the old size (and so the shape), the HD cap and the BMP cap. */
export function slotSpec(slot: number, mtm2Only: boolean): { lw: number; lh: number; hdmax: number; bmpmax: number } {
  if (slot === SLOT_ICON && mtm2Only) return { lw: 32, lh: 24, hdmax: 128, bmpmax: 48 };
  if (slot === SLOT_BROWSE) return { lw: 257, lh: 210, hdmax: 0, bmpmax: 0 };
  return { lw: 640, lh: 480, hdmax: 0, bmpmax: 0 };
}

export function slotWhat(slot: number, mtm2Only: boolean): string {
  if (slot === SLOT_ICON) return mtm2Only ? "icon" : "zoom picture";
  if (slot === SLOT_INFO) return "info photo";
  return "browse picture";
}
