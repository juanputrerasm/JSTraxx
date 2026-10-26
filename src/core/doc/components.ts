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
