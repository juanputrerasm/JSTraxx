/*
  The 8-bit tile behind an HD-only texture (TraxxView.cpp, Phase 19.4/19.6): a texture that
  arrived as PNG or TGA alone gets the legacy indices and .ACT that import would have written,
  built in memory with HDTexBuildLegacyIndicesMem. Terrain art uses the terrain class (border
  ring), model and backdrop art the model class. The HD bytes stay as they are.

  Also the texture a Textures window Load adds (LoadTextureFile's HD branch).
*/
import { buildLegacyTile, hdDimensionRefusal, type HdTexClass } from "../image/hd-texture.ts";
import { rgbaToRgb } from "../image/image-format.ts";
import type { RgbaImage } from "../view/tiles.ts";
import type { TextureAsset, TrackDocument } from "./document.ts";

export type ImageDecoder = (bytes: Uint8Array, ext: "PNG" | "TGA", name: string) => Promise<RgbaImage>;

/** The legacy tile of one HD source, or a refusal. */
export async function legacyFromHd(hd: { ext: "PNG" | "TGA"; data: Uint8Array }, name: string, texClass: HdTexClass, decode: ImageDecoder): Promise<{ side: number; indices: Uint8Array; act: Uint8Array } | string> {
  let img: RgbaImage;
  try { img = await decode(hd.data, hd.ext, name); } catch (e) { return e instanceof Error ? e.message : String(e); }
  const title = name.slice(name.lastIndexOf("\\") + 1);
  const refusal = hdDimensionRefusal(title, img.width, img.height);
  if (refusal) return refusal;
  return buildLegacyTile(rgbaToRgb(img), img.width, img.height, texClass);
}

async function fill(tex: TextureAsset | null, texClass: HdTexClass, decode: ImageDecoder, warnings: string[]): Promise<void> {
  if (!tex || tex.indices || !tex.hd) return;
  const out = await legacyFromHd(tex.hd, tex.name, texClass, decode);
  if (typeof out === "string") { warnings.push(`${tex.name}: ${out.split("\n")[0]}`); return; }
  tex.side = out.side;
  tex.indices = out.indices;
  tex.act = out.act;
  tex.legacyBuilt = true;
}

/** Every HD-only texture of the document, terrain and model. */
export async function fillHdLegacy(doc: TrackDocument, decode: ImageDecoder): Promise<void> {
  for (const tex of doc.textures) await fill(tex, "terrain", decode, doc.warnings);
  for (const tex of doc.modelTextures) await fill(tex, "model", decode, doc.warnings);
}
