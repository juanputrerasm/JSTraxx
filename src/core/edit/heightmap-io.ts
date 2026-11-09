/*
  Import / Export Heightmap (Traxx 1.7: Traxx/TraxxViewEdit.cpp OnTerrainImportRaw and
  OnTerrainExportRaw), the decisions without the DOM.

  A .RAW is the same little-endian, no-header height file the pod carries (8-bit 256 x 256, 16-bit
  256 x 256 or 16-bit 1024 x 1024, rows = Z). A grayscale PNG (8/16-bit) or TGA (8-bit) is the same
  heights in an image: it is decoded and turned into the bytes its .RAW twin would have
  (HeightImageToRaw), and those go through the .RAW path unchanged, so every question, mode switch,
  undo and lake check is the .RAW import's. The file is told apart by its content, not its name.

  Import, in Traxx's order:
    1. heightmapImportPrecheck(length, head): a wrong-size image is refused naming its size before
       it is read; anything not a .RAW size and shorter than 18 or longer than 32 MB is refused.
    2. planHeightmapImport(file, mode, ui): the image decode, the .RAW length check, then the
       questions (16-bit into Classic 8-bit: Yes / No / Cancel; 1024 into another mode: Yes / No;
       1024 into a Full Map: replace?). It resolves with the bytes and the target mode, or null.
    3. The caller: undo snapshot when the mode stays (and it could be made), the lake snapshot,
       importHeights(t, raw, raw.length, target), the edit grid reset on a mode change, the lake
       refusal (undoable) or HEIGHTMAP_LAKES_WARNING (not undoable, only for a lake newly in
       error), then HEIGHTMAP_COARSE_FULL when the plan says coarseFull.
  Export: heightmapExportDefaults for the dialog, heightmapExportName for the name typed and the
  filter chosen, heightmapExportBytes for the file.
*/

import {
  heightExportFormat, heightImageDecode, heightImageLooksLikeImage, heightImageSizeRefusal, heightImageToRaw,
  heightPngEncode, HEIGHTMAP_EXPORT_PNG16, HEIGHTMAP_EXPORT_PNG8, HEIGHTMAP_EXPORT_RAW,
} from "../traxx/height-image.ts";
import {
  RAWLEN_16BIT, RAWLEN_8BIT, RAWLEN_FINE, saveRaw, syncFromRaw,
  TERRAINMODE_CLASSIC16, TERRAINMODE_CLASSIC8, TERRAINMODE_FINE, type Terrain16,
} from "../traxx/terrain16.ts";

export { HEIGHTMAP_EXPORT_PNG16, HEIGHTMAP_EXPORT_PNG8, HEIGHTMAP_EXPORT_RAW };

export const HEIGHTMAP_BYTEORDER = "16-bit .RAW files are little-endian (IBM PC byte order in Photoshop's Raw dialog), rows top to bottom = Z.";
/** The file dialogs' titles: the dialog has no room for a note, so the byte order shows there. */
export const HEIGHTMAP_IMPORT_TITLE = `Import heightmap - ${HEIGHTMAP_BYTEORDER}`;
export const HEIGHTMAP_EXPORT_TITLE = `Export heightmap - ${HEIGHTMAP_BYTEORDER}`;
/** HEIGHTMAP_IMPORT_FILTER, as label + extensions (the default extension is raw). */
export const HEIGHTMAP_IMPORT_FILTERS: readonly { label: string; exts: readonly string[] }[] = [
  { label: "Height map (*.raw;*.png;*.tga)", exts: ["raw", "png", "tga"] },
  { label: "Height map, 16-bit little-endian (IBM PC) (*.raw)", exts: ["raw"] },
  { label: "Grayscale PNG (*.png)", exts: ["png"] },
  { label: "Grayscale TGA (*.tga)", exts: ["tga"] },
  { label: "All files (*.*)", exts: [] },
];
/** HEIGHTMAP_EXPORT_FILTER: filter index 1, 2, 3 is HEIGHTMAP_EXPORT_PNG16, PNG8, RAW. */
export const HEIGHTMAP_EXPORT_FILTERS: readonly { label: string; ext: string }[] = [
  { label: "16-bit grayscale PNG (recommended) (*.png)", ext: "png" },
  { label: "8-bit grayscale PNG (*.png)", ext: "png" },
  { label: ".RAW (little-endian) (*.raw)", ext: "raw" },
];
/** HEIGHTMAP_IMAGE_MAX: the biggest 1024 image is a few MB; anything longer is no heightmap. */
export const HEIGHTMAP_IMAGE_MAX = 32 * 1024 * 1024;

export const HEIGHTMAP_IMPORT_CAPTION = "Import Heightmap";
export const HEIGHTMAP_EXPORT_CAPTION = "Export Heightmap";
export const HEIGHTMAP_BAD_LENGTH = "Heightmap must be 65,536 (8-bit 256×256), 131,072 (16-bit 256×256) or 2,097,152 (16-bit 1024×1024) bytes, or a grayscale PNG or TGA image.";
export const HEIGHTMAP_CANNOT_OPEN = "Sorry, that file could not be opened.";
export const HEIGHTMAP_CANNOT_READ = "Sorry, that file could not be read.";
export const HEIGHTMAP_IMAGE_NO_MEMORY = "Sorry, there is not enough memory to import that image.";
export const HEIGHTMAP_IMAGE_UNREADABLE = "This image could not be read.";
/** ImportHeights failed (no memory). */
export const HEIGHTMAP_IMPORT_NO_MEMORY = "Sorry, there is not enough memory to import that heightmap.";
/** TerrainChanged's warning after an import that cannot be undone, for a lake newly in error. */
export const HEIGHTMAP_LAKES_WARNING = "The imported heights leave one or more lakes in error; check them in the lake list. This import cannot be undone.";
/** After an 8-bit 1024 image: MB_OK | MB_ICONINFORMATION, caption Import Heightmap. */
export const HEIGHTMAP_COARSE_FULL = "This 1024 x 1024 height map is 8-bit, so the Full Map has 2 ft height steps. Export it as 16-bit for smooth terrain.";
/** The lake refusal's command name (LakesRefuseTerrainEdit) for an undoable import. */
export const HEIGHTMAP_IMPORT_COMMAND = "Import Heightmap";
export const HEIGHTMAP_EXPORT_FAILED = "Sorry, the heightmap could not be written.";

/** A MessageBox: caption null is the plain MessageBox(text) (the frame's own caption). */
export interface HeightmapMessage {
  text: string;
  caption: string | null;
  icon: "warning" | "question" | "information" | null;
}
export interface HeightmapQuestion {
  text: string;
  caption: string;
  buttons: "yesno" | "yesnocancel";
  icon: "warning" | "question";
}
export type HeightmapAnswer = "yes" | "no" | "cancel";

/** What the import needs from the UI: show a message, ask a question. */
export interface HeightmapImportUi {
  message(m: HeightmapMessage): Promise<void>;
  ask(q: HeightmapQuestion): Promise<HeightmapAnswer>;
}

const RAWLENGTHS = [RAWLEN_8BIT, RAWLEN_16BIT, RAWLEN_FINE];

/**
  The refusal before the file is read (OnTerrainImportRaw): `head` is its first 33 bytes (or all of
  it, when shorter). A wrong-size PNG or TGA names its size; any other length that is not a .RAW
  size and is shorter than 18 or longer than HEIGHTMAP_IMAGE_MAX bytes gets the length message.
*/
export function heightmapImportPrecheck(length: number, head: Uint8Array): HeightmapMessage | null {
  const rawlength = RAWLENGTHS.includes(length);
  if (!rawlength && length >= 18) {
    const why = heightImageSizeRefusal(head.subarray(0, 33), length);
    if (why !== null) return { text: why, caption: HEIGHTMAP_IMPORT_CAPTION, icon: "warning" };
  }
  if (!rawlength && (length < 18 || length > HEIGHTMAP_IMAGE_MAX)) return { text: HEIGHTMAP_BAD_LENGTH, caption: null, icon: null };
  return null;
}

/** What the import does once the author has answered. */
export interface HeightmapImportPlan {
  /** The .RAW bytes (an image's .RAW twin): 65,536, 131,072 or 2,097,152 of them. */
  raw: Uint8Array;
  /** The mode importHeights is to leave the track in. */
  target: number;
  /** The mode stays, so the import is undoable (when the snapshot can be made). */
  undoable: boolean;
  /** An 8-bit 1024 image: show HEIGHTMAP_COARSE_FULL at the end. */
  coarseFull: boolean;
}

/**
  The file as an image or a .RAW: an image becomes its .RAW twin; an image refusal is shown as the
  decoder words it. Exported for callers that need the bytes without the questions.
*/
export function heightmapImportBytes(file: Uint8Array): { ok: true; raw: Uint8Array; coarseFull: boolean } | { ok: false; message: HeightmapMessage } {
  if (heightImageLooksLikeImage(file)) {
    const img = heightImageDecode(file);
    if (!img.ok) return { ok: false, message: { text: img.why || HEIGHTMAP_IMAGE_UNREADABLE, caption: HEIGHTMAP_IMPORT_CAPTION, icon: "warning" } };
    const raw = heightImageToRaw(img.v, img.srcBits, img.size);
    if (!raw) return { ok: false, message: { text: HEIGHTMAP_IMAGE_NO_MEMORY, caption: null, icon: null } };
    return { ok: true, raw, coarseFull: img.srcBits === 8 && img.size === 1024 };
  }
  if (!RAWLENGTHS.includes(file.length)) return { ok: false, message: { text: HEIGHTMAP_BAD_LENGTH, caption: null, icon: null } };
  return { ok: true, raw: file, coarseFull: false };
}

/**
  The size x mode table: which question a .RAW length asks on a track in `oldMode`, and which mode
  each answer gives (null = the import stops).
    131,072 on Classic 8-bit      Yes = CLASSIC16, No = CLASSIC8 (rounded), Cancel = stop
    2,097,152 not on a Full Map   Yes = FINE, No = stop
    any length on a Full Map      "Replace ...?"  Yes = FINE, No = stop
    anything else                 no question: the mode stays (importHeights converts the size)
*/
export function heightmapImportQuestions(rawLength: number, oldMode: number): { question: HeightmapQuestion; yes: number | null; no: number | null; cancel: number | null }[] {
  const out: { question: HeightmapQuestion; yes: number | null; no: number | null; cancel: number | null }[] = [];
  if (rawLength === RAWLEN_16BIT && oldMode === TERRAINMODE_CLASSIC8) {
    out.push({
      question: { text: "Switch this track to 16-bit heights?\n\nNo = round to 8-bit (loses detail).\nSwitching cannot be undone.", caption: HEIGHTMAP_IMPORT_CAPTION, buttons: "yesnocancel", icon: "question" },
      yes: TERRAINMODE_CLASSIC16, no: TERRAINMODE_CLASSIC8, cancel: null,
    });
  } else if (rawLength === RAWLEN_FINE && oldMode !== TERRAINMODE_FINE) {
    out.push({
      question: { text: "Switch this track to the 16-bit Full Map?\n\nSwitching cannot be undone.", caption: HEIGHTMAP_IMPORT_CAPTION, buttons: "yesno", icon: "question" },
      yes: TERRAINMODE_FINE, no: null, cancel: null,
    });
  }
  // Already a Full Map, which no answer above changes: any import replaces its 1024 x 1024 heights,
  // so the author is asked first, whatever the file's size (Undo takes it back).
  if (oldMode === TERRAINMODE_FINE) {
    out.push({
      question: { text: "Replace this track's 16-bit Full Map heights?", caption: HEIGHTMAP_IMPORT_CAPTION, buttons: "yesno", icon: "warning" },
      yes: TERRAINMODE_FINE, no: null, cancel: null,
    });
  }
  return out;
}

/**
  OnTerrainImportRaw up to ImportHeights: precheck, image decode or .RAW length, the questions.
  null when a message ended it or the author said no / cancel.
*/
export async function planHeightmapImport(file: Uint8Array, oldMode: number, ui: HeightmapImportUi): Promise<HeightmapImportPlan | null> {
  const pre = heightmapImportPrecheck(file.length, file.subarray(0, 33));
  if (pre) { await ui.message(pre); return null; }
  const bytes = heightmapImportBytes(file);
  if (!bytes.ok) { await ui.message(bytes.message); return null; }
  let target = oldMode;
  for (const q of heightmapImportQuestions(bytes.raw.length, oldMode)) {
    const a = await ui.ask(q.question);
    const mode = a === "yes" ? q.yes : a === "no" ? q.no : q.cancel;
    if (mode === null) return null;
    target = mode;
  }
  return { raw: bytes.raw, target, undoable: target === oldMode, coarseFull: bytes.coarseFull };
}

// ---- Export -----------------------------------------------------------------------------------

/**
  OnTerrainExportRaw's dialog set-up: the filter is the 8-bit PNG on Classic 8-bit, else the
  16-bit PNG; the name is the document title without its extension plus ".png" ("Mytrack.txx"
  offers "Mytrack.png").
*/
export function heightmapExportDefaults(terrainMode: number, docTitle: string): { filterIndex: number; fileName: string; title: string } {
  const filterIndex = terrainMode === TERRAINMODE_CLASSIC8 ? HEIGHTMAP_EXPORT_PNG8 : HEIGHTMAP_EXPORT_PNG16;
  let name = docTitle;
  const dot = name.lastIndexOf(".");
  if (dot > 0) name = name.slice(0, dot);
  return { filterIndex, fileName: `${name}.png`, title: HEIGHTMAP_EXPORT_TITLE };
}

/**
  The name typed and the filter chosen: the typed extension decides the format (HeightExportFormat);
  with neither .raw nor .png, trailing dots go and the format's extension is added, and then
  `replaceQuestion` is what to ask when a file of that name already exists (the dialog's own
  overwrite prompt saw the name as typed).
*/
export function heightmapExportName(typedName: string, filterIndex: number, terrainMode: number): { format: number; fileName: string; appended: boolean; replaceQuestion: HeightmapQuestion | null } {
  const dot = typedName.lastIndexOf(".");
  const ext = dot >= 0 ? typedName.slice(dot + 1) : "";
  const format = heightExportFormat(ext, filterIndex, terrainMode === TERRAINMODE_CLASSIC8);
  const lower = ext.toLowerCase();
  if (lower === "raw" || lower === "png") return { format, fileName: typedName, appended: false, replaceQuestion: null };
  const fileName = typedName.replace(/\.+$/, "") + (format === HEIGHTMAP_EXPORT_RAW ? ".raw" : ".png");
  return {
    format, fileName, appended: true,
    replaceQuestion: { text: `${fileName} already exists.\n\nReplace it?`, caption: HEIGHTMAP_EXPORT_CAPTION, buttons: "yesno", icon: "warning" },
  };
}

/**
  The exported file's bytes. RAW: SaveRaw (8-bit on Classic 8-bit, 16-bit little-endian
  otherwise, edits folded in). PNG: after SyncFromRaw, a Full Map writes its 1024 grid, every other
  mode its 256 one (Spline the h16 it is made from), Classic 8-bit raw << 8. null: the write failed
  (HEIGHTMAP_EXPORT_FAILED).
*/
export function heightmapExportBytes(t: Terrain16, format: number): Uint8Array | null {
  if (format === HEIGHTMAP_EXPORT_RAW) return saveRaw(t);
  syncFromRaw(t);
  const size = t.terrainMode === TERRAINMODE_FINE ? 1024 : 256;
  let v = t.terrainMode === TERRAINMODE_FINE ? t.fine : t.h16;
  if (!v) {
    v = new Uint16Array(256 * 256);
    for (let i = 0; i < 256 * 256; i++) v[i] = t.heights[i]! << 8;
  }
  return heightPngEncode(v, size, format === HEIGHTMAP_EXPORT_PNG8 ? 8 : 16);
}
