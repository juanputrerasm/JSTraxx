/*
  Models for the Models window (Traxx/TraxxObjectsDlg.cpp OnFileOpen):

    models.list    the MODELS folder (jstraxx/models), then the game library's MODELS\ .BINs
                   whose name the folder does not hold
    models.load    picks from that list, as models with their textures
    models.import  .BIN files picked from disk, copied into the MODELS folder first (an
                   existing file is kept) so the track finds them again when reopened

  A model is named MODELS\<TITLE> in upper case; the stem must fit the MODELS\ budget and,
  as there is no 8.3 alias to fall back on, may not hold a space. Its textures come from the
  ART folder and the library; HD-only ones get their 8-bit tile built as on load.
*/
import { exists, listDirectory, readBytes, writeBytesToFile } from "../shared/opfs.ts";
import { modelWithTextures, type AssetSource } from "../core/doc/load-txx.ts";
import { legacyFromHd } from "../core/doc/hd-legacy.ts";
import { pod1StemBudget, pod1StemRefusal, stemOf } from "../core/traxx/pod-items.ts";
import { decodeImage } from "../shared/image-decode.ts";
import type { ModelAsset, TextureAsset } from "../core/doc/document.ts";
import type { Vfs } from "../core/vfs.ts";
import { ART_DIR, MODELS_DIR } from "./doc-handlers.ts";
import { wildcardMatch } from "../core/edit/art-folder.ts";

export interface ModelItem { file: string; source: "models" | "library" }
export type ModelLoad = { model: ModelAsset; textures: TextureAsset[]; missing: string[] } | string;

export function modelHandlers(vfs: () => Vfs) {
  const opfs = async (path: string) => { try { return await readBytes(path); } catch { return null; } };
  const art: AssetSource["art"] = async (path) => {
    const own = await opfs(`${ART_DIR}/${path.replace(/\\/g, "/").toUpperCase()}`);
    if (own) return own;
    const v = vfs();
    const hit = v.find(`ART\\${path}`) ?? v.findByTitle(path);
    return hit ? hit.mount.readEntry(hit.entry) : null;
  };
  const read = async (item: ModelItem) => {
    if (item.source === "models") return opfs(`${MODELS_DIR}/${item.file.toUpperCase()}`);
    const hit = vfs().find(`MODELS\\${item.file}`);
    return hit ? hit.mount.readEntry(hit.entry) : null;
  };

  /* One model, by its file title. */
  const load = async (title: string, bytes: Uint8Array | null, have: readonly { name: string }[]): Promise<ModelLoad> => {
    if (stemOf(title).length > pod1StemBudget("MODELS\\", ".BIN")) return pod1StemRefusal("MODELS\\", ".BIN", title);
    if (title.includes(" ")) return `"${title}" has a space in its name, which a model name cannot hold.`;
    if (!bytes || bytes.length === 0) return "Error loading BIN file";
    const name = `MODELS\\${title}`.toUpperCase().slice(0, 31);
    let out: Awaited<ReturnType<typeof modelWithTextures>>;
    try { out = await modelWithTextures(name, bytes, art, have); } catch { return "Error loading BIN file"; }
    for (const tex of out.textures) {
      if (tex.indices || !tex.hd) continue;
      const tile = await legacyFromHd(tex.hd, tex.name, "model", decodeImage);
      if (typeof tile !== "string") Object.assign(tex, { side: tile.side, indices: tile.indices, act: tile.act, legacyBuilt: true });
    }
    return out;
  };

  return {
    async "models.list"(payload: { filter: string }): Promise<ModelItem[]> {
      const f = payload.filter.trim();
      const pattern = `${!f ? "*" : f.includes("*") ? f : `*${f}*`}.BIN`;
      const own = (await listDirectory(MODELS_DIR)).filter((e) => e.kind === "file" && wildcardMatch(pattern, e.name)).map((e) => e.name.toUpperCase());
      const names = new Set(own);
      const library = vfs().list(".BIN").filter((h) => /^MODELS\/[^/]+$/.test(h.path)).map((h) => h.path.slice(7))
        .filter((n) => wildcardMatch(pattern, n) && !names.has(n)).sort();
      return [...own.map((file) => ({ file, source: "models" as const })), ...library.map((file) => ({ file, source: "library" as const }))];
    },

    async "models.load"(payload: { items: ModelItem[]; have: string[] }): Promise<ModelLoad[]> {
      const have = payload.have.map((name) => ({ name }));
      const out: ModelLoad[] = [];
      for (const item of payload.items) {
        const r = await load(item.file, await read(item), have);
        if (typeof r !== "string") have.push(...r.textures);
        out.push(r);
      }
      return out;
    },

    async "models.import"(payload: { files: File[]; have: string[] }): Promise<ModelLoad[]> {
      const have = payload.have.map((name) => ({ name }));
      const out: ModelLoad[] = [];
      for (const f of payload.files) {
        const path = `${MODELS_DIR}/${f.name.toUpperCase()}`;
        if (!f.name.includes(" ") && !(await exists(path))) await writeBytesToFile(path, f);
        const r = await load(f.name, new Uint8Array(await f.arrayBuffer()), have);
        if (typeof r !== "string") have.push(...r.textures);
        out.push(r);
      }
      return out;
    },
  };
}
