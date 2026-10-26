/*
  The track's texture list, as the Textures window changes it (Traxx/TraxxTexturesDlg.cpp):

    textureFromFile   LoadTextureFile: a .RAW (with the .ACT beside it, metalcr2 when there is
                      none) or an HD .PNG / .TGA turned into its 8-bit tile in memory. Normal
                      maps are refused; the stem must fit the ART budget.
    addTexture        the first empty slot, else a new one, up to 1024
    setTypeDepth      OnSelchangeTextureType / OnChangeTextureDepth over a selection
    addAnimationFrame Ctrl+click: AddAnitexture, then a frame (8 at most, names of 15 at most)

  An HD import always builds its tile in memory, which is Traxx's "no legacy siblings" path:
  JSTraxx writes nothing into the ART folder on Load.
*/
import type { TextureAsset, TrackDocument } from "../doc/document.ts";
import { MAX_ANIMATION_FRAMES, MAX_ANIMATIONS, MAX_TEXTURES } from "../doc/load-pod.ts";
import { findAsset } from "../doc/names.ts";
import { legacyFromHd, type ImageDecoder } from "../doc/hd-legacy.ts";
import { isHdName, pod1ArtStemBudget, pod1StemRefusal, rawSide, stemOf, swapExt } from "../traxx/pod-items.ts";
import type { TxxTrack } from "../traxx/txx.ts";

/** TEXTURENAMELEN - 1: the longest name a texture keeps. */
const TEXTURE_NAME_MAX = 31;
/** ANIFRAMENAMEMAX: an animation frame name, extension included, without ART\. */
export const ANI_FRAME_NAME_MAX = 15;

/** The type list of the Textures window (IDC_TEXTURETYPE). */
export const TEXTURE_TYPE_NAMES = ["Default", "Cement", "Dirt", "Water", "Mud", "Sand", "Grass", "Gravel", "Ice", "Snow", "Metal", "Wood", "Rocks"];

/** HDTextureTitleToRaw: the .RAW title a picked file is known by. */
export function rawTitle(title: string): string {
  return isHdName(title) ? swapExt(title, "RAW") : title;
}

/** IsTextureLoaded: the slot holding this name (with or without ART\), or -1. */
export function findTexture(doc: TrackDocument, name: string): number {
  return findAsset(doc.textures, name);
}

/** The refusal for a normal map picked as a texture, or null. */
export function normalMapRefusal(title: string): string | null {
  const stem = stemOf(title);
  if (stem.length < 2 || !/_n$/i.test(stem)) return null;
  const base = stem.slice(0, -2);
  return `"${title}" is a NORMAL MAP, not a texture.\n\nIt does not need to be added: it is carried into the pod automatically beside "${base}", and it is never listed or offered for removal on its own.\n\nAdd "${base}" instead - the map comes with it.`;
}

export interface TextureFile {
  /** The file's title as picked: "GRASS.RAW", "ROCK.PNG". */
  title: string;
  bytes: Uint8Array;
  /** The .ACT beside a .RAW, when there is one. */
  act?: Uint8Array | null;
}

/** LoadTextureFile, short of adding: the texture, or why not. */
export async function textureFromFile(file: TextureFile, decode: ImageDecoder): Promise<TextureAsset | string> {
  const refusal = normalMapRefusal(file.title);
  if (refusal) return refusal;
  const title = rawTitle(file.title).toUpperCase();
  const stem = stemOf(title);
  if (stem.length > pod1ArtStemBudget()) return pod1StemRefusal("ART\\", ".RAW", title);
  const name = `ART\\${title}`.slice(0, TEXTURE_NAME_MAX).toUpperCase();
  if (isHdName(file.title)) {
    const ext = /\.tga$/i.test(file.title) ? "TGA" : "PNG";
    const hd = { ext, data: file.bytes } as const;
    const tile = await legacyFromHd(hd, file.title, "terrain", decode);
    if (typeof tile === "string") return tile;
    return { name, side: tile.side, indices: tile.indices, act: tile.act, hd, bad: false, legacyBuilt: true };
  }
  const side = rawSide(file.bytes.length);
  if (side === 0) return `"${file.title}" is not a texture: a .RAW is a square tile of 32 to 1024 pixels a side.`;
  let act: Uint8Array | null = null;
  if (file.act) { act = new Uint8Array(768); act.set(file.act.subarray(0, 768)); }
  return { name, side, indices: file.bytes.slice(0, side * side), act, hd: null, bad: false };
}

/** Add a loaded texture in the first free slot. Returns its index, or -1 when the list is full. */
export function addTexture(doc: TrackDocument, tex: TextureAsset): number {
  let at = doc.textures.indexOf(null);
  if (at < 0) {
    if (doc.textures.length >= MAX_TEXTURES) return -1;
    at = doc.textures.length;
  }
  doc.textures[at] = tex;
  doc.track.textures[at] = { name: tex.name, type: 0, depth: 1 };
  return at;
}

/** Type and grip depth for every texture given. */
export function setTypeDepth(track: TxxTrack, indices: readonly number[], change: { type?: number; depth?: number }): void {
  for (const i of indices) {
    const t = track.textures[i];
    if (!t) continue;
    if (change.type !== undefined) t.type = change.type;
    if (change.depth !== undefined) t.depth = Math.max(0, Math.min(99, Math.trunc(change.depth)));
  }
}

/** FindAnitexture: the animation based on this texture, or -1. */
export function findAnimation(track: TxxTrack, index: number): number {
  return track.animations.findIndex((a) => a.frames[0] === index);
}

/**
  Ctrl+click: texture `frame` becomes the next frame of the animation based on `base`, which is
  made (period 250) when there is none. Returns the animation's index, or a message.
*/
export function addAnimationFrame(doc: TrackDocument, base: number, frame: number): number | string {
  const track = doc.track;
  let at = findAnimation(track, base);
  if (at < 0) {
    if (track.animations.length >= MAX_ANIMATIONS) return "Max. number of animations reached.";
    track.animations.push({ period: 250, nframes: 1, frames: [base, 0, 0, 0, 0, 0, 0, 0] });
    at = track.animations.length - 1;
  }
  const ani = track.animations[at];
  let fname = doc.textures[frame]?.name ?? "";
  if (fname.startsWith("ART\\")) fname = fname.slice(4);
  if (fname.length > ANI_FRAME_NAME_MAX) {
    return `"${fname}" is ${fname.length} characters.\n\nAn animation frame name may be at most ${ANI_FRAME_NAME_MAX} characters INCLUDING the extension (an 11-character stem with .RAW).\n\n`
      + "The engine stores each frame's name next to that frame's sound name, so a longer name overwrites the sound instead of truncating.\n\nRename the texture file and add it again.";
  }
  if (ani.nframes >= MAX_ANIMATION_FRAMES) return "Max. 8 frames per animation.";
  ani.frames[ani.nframes] = frame;
  ani.nframes++;
  return at;
}

/** The frame numbers (1 and up) a texture is in the given animation, as the grid labels them. */
export function frameLabels(track: TxxTrack, animation: number, index: number): string {
  const ani = track.animations[animation];
  if (!ani) return "";
  const out: number[] = [];
  for (let j = 1; j < ani.nframes; j++) if (ani.frames[j] === index) out.push(j);
  return out.join(",");
}
