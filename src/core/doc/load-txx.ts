/*
  Opening a .TXX: CTrackPOD::LoadBinary, then what CTraxxDoc::OnOpenDocument does after it:
  LoadMTM2Palette, LoadTextures and LoadModels (TrackPOD/TrackPODBinary.cpp).

  A .TXX names its art and models; Traxx reloads them from its ART and MODELS folders, then
  from beside the .TXX. JSTraxx's ART and MODELS folders are the open project's, then the game
  library, through an AssetSource. Probe order and name rules follow Traxx:

    texture  the title, then the ART-relative path, each verbatim then as <stem>.RAW; then an
             HD source (PNG or TGA) of the same stem; else a blank 64x64 "bad" tile
    model    the title, then the MODELS-relative path; a model's animation frames are added
             as models of their own and loaded in turn
*/
import { readTxx } from "../traxx/txx.ts";
import { applyMtm2Palette, withSysColors } from "../traxx/palette.ts";
import { flatLte, inferPrefixAuto } from "../traxx/terrain.ts";
import { rawSide, swapExt } from "../traxx/pod-items.ts";
import { emptyCarry, MTM2_ONLY, type ModelAsset, type TextureAsset, type TrackDocument } from "./document.ts";
import { deriveBoxHeights, findModelTexture, modelAsset } from "./load-pod.ts";
import { findAsset } from "./names.ts";

/** Where a .TXX's art and models come from. Each returns the file's bytes, or null. */
export interface AssetSource {
  /** A file in the ART folder, by its path below that folder ("GRASS.RAW", "SUB\\GRASS.RAW"). */
  art(path: string): Promise<Uint8Array | null>;
  /** A file in the MODELS folder. */
  model(path: string): Promise<Uint8Array | null>;
}

export interface OpenTxxOptions {
  progress?: (fraction: number, label: string) => void;
  project?: string | null;
}

/** PathTitle: the part after the last backslash or slash. */
export function pathTitle(name: string): string {
  return name.slice(Math.max(name.lastIndexOf("\\"), name.lastIndexOf("/")) + 1);
}

/** StripAssetFolder: the name without a leading "<folder>\", or the name itself. */
function stripFolder(name: string, folder: string): string {
  const prefix = `${folder}\\`;
  return name.toUpperCase().startsWith(prefix) ? name.slice(prefix.length) : name;
}

export async function openTxx(bytes: Uint8Array, fileName: string, assets: AssetSource, options: OpenTxxOptions = {}): Promise<TrackDocument> {
  const progress = options.progress ?? (() => {});
  const track = readTxx(bytes);
  // CTrackPODPalette::Create writes the system colours over 246..255.
  track.palette = withSysColors(track.palette);
  // Reset leaves the flat light plane when the file carries none.
  track.lte ??= flatLte();
  const doc: TrackDocument = {
    track, textures: [], modelTextures: [], models: [], carry: emptyCarry(), prefixAuto: true, viewOnly: false,
    source: { kind: "txx", fileName, project: options.project ?? null },
    objectsShort: 0, objectsDropped: 0, groundBoxOverflow: 0, missingTextures: [], missingModels: [], warnings: [],
  };
  deriveBoxHeights(track);
  doc.prefixAuto = inferPrefixAuto(track.trackName, track.prefix);

  if (track.versionFlags & MTM2_ONLY) {
    const p = applyMtm2Palette({ palette: track.palette, fogMap: track.fogMap, logoBmp: track.logoBmp, mapBmp: track.mapBmp, logoHd: Boolean(track.uiHd[0]), mapHd: Boolean(track.uiHd[1]) });
    track.palette = p.palette;
    track.fogMap = p.fogMap;
    track.logoBmp = p.logoBmp;
    track.mapBmp = p.mapBmp;
  } else {
    doc.warnings.push("This track was made for Monster Truck Madness 1. JSTraxx edits MTM2 tracks; it is shown with the palette it was saved with.");
  }

  await loadTrackAssets(doc, assets, progress);
  progress(1, "Done");
  return doc;
}

/*
  LoadTextures then LoadModels: every texture slot and model the track names, found through
  `assets`; a model's animation frames are queued as models of their own; then the backdrop.
*/
export async function loadTrackAssets(doc: TrackDocument, assets: AssetSource, progress: (fraction: number, label: string) => void = () => {}): Promise<void> {
  const track = doc.track;
  progress(0.1, "Loading textures");
  for (let i = 0; i < track.textures.length; i++) {
    const entry = track.textures[i];
    if (!entry.name) { doc.textures[i] = null; continue; }
    const tex = await loadArt(entry.name, assets.art);
    if (tex.bad) doc.missingTextures.push(entry.name);
    entry.name = tex.name;
    doc.textures[i] = tex;
    if ((i & 15) === 0) progress(0.1 + 0.5 * (i / track.textures.length), "Loading textures");
  }

  progress(0.6, "Loading models");
  const queue = [...track.models];
  for (let i = 0; i < queue.length; i++) {
    const model = await loadModel(queue[i], assets, doc);
    doc.models.push(model);
    for (const frame of model.frameNames) {
      if (queue.some((q) => findAsset([{ name: q }], frame) >= 0)) continue;
      queue.push(`MODELS\\${frame}`.slice(0, 31));
    }
  }
  track.models = queue;
  for (const name of [track.backdropName, ...track.extraBackdrops]) if (name) doc.models.push(await loadModel(name, assets, doc));
}

/** One model and its textures (LoadModels, LoadModelTextures). */
async function loadModel(name: string, assets: AssetSource, doc: TrackDocument): Promise<ModelAsset> {
  const title = pathTitle(name);
  const rel = stripFolder(name, "MODELS");
  let bytes = await assets.model(title);
  if (!bytes && rel !== name) bytes = await assets.model(rel);
  if (!bytes || bytes.length === 0) {
    doc.missingModels.push(name);
    return { name, bytes: null, textureNames: [], frameNames: [], bad: true };
  }
  const model = modelAsset(name, bytes);
  for (const recorded of model.textureNames) {
    const tstr = recorded.toUpperCase();
    const existing = findModelTexture(doc.modelTextures, tstr);
    if (existing >= 0) continue;
    const tex = await loadArt(`ART\\${tstr}`, assets.art, tstr);
    if (tex.bad) doc.missingTextures.push(tex.name);
    doc.modelTextures.push(tex);
  }
  return model;
}

/**
  The Models window's Load (CTraxxObjectsDlg::OnFileOpen): one model from its bytes, and the
  textures it names that `have` lacks (LoadModelTextures), read from the ART folder. Missing
  textures come back as blank "bad" tiles, named in `missing`.
*/
export async function modelWithTextures(name: string, bytes: Uint8Array, art: AssetSource["art"], have: readonly { name: string }[]): Promise<{ model: ModelAsset; textures: TextureAsset[]; missing: string[] }> {
  const model = modelAsset(name, bytes);
  const textures: TextureAsset[] = [];
  const missing: string[] = [];
  for (const recorded of model.textureNames) {
    const tstr = recorded.toUpperCase();
    if (findModelTexture([...have, ...textures], tstr) >= 0) continue;
    const tex = await loadArt(`ART\\${tstr}`, art, tstr);
    if (tex.bad) missing.push(tex.name);
    textures.push(tex);
  }
  return { model, textures, missing };
}

/*
  LoadAndMapTexture over the probe list: the file must be a legacy tile by size; its .ACT is
  the same path with .ACT for .RAW (metalcr2 when absent). A hit on the .RAW swap renames the
  texture to it, as Traxx does, since every later lookup keys off the .RAW name.
*/
async function loadArt(name: string, read: (path: string) => Promise<Uint8Array | null>, firstPath?: string): Promise<TextureAsset> {
  const candidates = firstPath ? [firstPath] : [pathTitle(name), ...(stripFolder(name, "ART") !== name ? [stripFolder(name, "ART")] : [])];
  for (const path of candidates) {
    for (const [probe, rename] of [[path, name], [swapExt(path, "RAW"), swapExt(name, "RAW")]] as const) {
      if (probe !== path && probe.toUpperCase() === path.toUpperCase()) continue;
      const bytes = await read(probe);
      const side = bytes ? rawSide(bytes.length) : 0;
      if (!bytes || side === 0) continue;
      let act: Uint8Array | null = null;
      if (probe.toUpperCase().includes(".RAW")) {
        const pal = await read(probe.replace(/\.RAW/i, ".ACT"));
        if (pal) { act = new Uint8Array(768); act.set(pal.subarray(0, 768)); }
      }
      return { name: rename, side, indices: bytes.slice(0, side * side), act, hd: null, bad: false };
    }
  }
  // No legacy tile: an HD source of the same stem stands in (Phase 19.6), decoded later.
  for (const path of candidates) {
    for (const ext of ["PNG", "TGA"] as const) {
      const bytes = await read(swapExt(path, ext));
      if (bytes) return { name: swapExt(name, "RAW"), side: 0, indices: null, act: null, hd: { ext, data: bytes }, bad: false };
    }
  }
  return { name, side: 64, indices: new Uint8Array(64 * 64), act: null, hd: null, bad: true };
}
