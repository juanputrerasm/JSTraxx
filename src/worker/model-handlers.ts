/*
  Models for the Models window (Traxx/TraxxObjectsDlg.cpp OnFileOpen):

    models.list    the MODELS folder (jstraxx/models), then the game library's MODELS\ .BINs
                   whose name the folder does not hold
    models.load    picks from that list, as models with their textures
    models.import  .BIN files picked from disk, copied into the MODELS folder first (an
                   existing file is kept) so the track finds them again when reopened

  Traxx 1.7 surface meshes: a model loaded here keeps the .SRF beside its source
  (FindSurfaceSidecar): the MODELS folder's <stem>.SRF, the one in the same library pod, or a
  .SRF picked from disk together with its .BIN (copied into the MODELS folder with it).

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
import { isSrfPath, pairSidecars, sidecarInMount, sidecarPath } from "../core/doc/surface-sidecar.ts";

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
  /* FindSurfaceSidecar (Traxx 1.7): the .SRF beside the model's source, the same folder or the same pod. */
  const sidecar = async (item: ModelItem) => {
    if (item.source === "models") return opfs(`${MODELS_DIR}/${sidecarPath(item.file).toUpperCase()}`);
    const hit = vfs().find(`MODELS\\${item.file}`);
    return hit ? sidecarInMount(hit.mount, hit.entry.name) : null;
  };

  /* One model, by its file title. */
  const load = async (title: string, bytes: Uint8Array | null, have: readonly { name: string }[], srf: Uint8Array | null = null): Promise<ModelLoad> => {
    if (stemOf(title).length > pod1StemBudget("MODELS\\", ".BIN")) return pod1StemRefusal("MODELS\\", ".BIN", title);
    if (title.includes(" ")) return `"${title}" has a space in its name, which a model name cannot hold.`;
    if (!bytes || bytes.length === 0) return "Error loading BIN file";
    const name = `MODELS\\${title}`.toUpperCase().slice(0, 31);
    let out: Awaited<ReturnType<typeof modelWithTextures>>;
    try { out = await modelWithTextures(name, bytes, art, have); } catch { return "Error loading BIN file"; }
    if (srf && srf.length > 0) out.model.srf = srf;
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
        const r = await load(item.file, await read(item), have, await sidecar(item));
        if (typeof r !== "string") have.push(...r.textures);
        out.push(r);
      }
      return out;
    },

    async "models.import"(payload: { files: File[]; have: string[] }): Promise<ModelLoad[]> {
      const have = payload.have.map((name) => ({ name }));
      const out: ModelLoad[] = [];
      // A .SRF picked with its .BIN is the one beside it; it is copied with it, so a reopened track finds it.
      const pairs = pairSidecars(payload.files.map((f) => f.name));
      for (let i = 0; i < payload.files.length; i++) {
        const f = payload.files[i]!;
        if (isSrfPath(f.name)) continue;
        const path = `${MODELS_DIR}/${f.name.toUpperCase()}`;
        if (!f.name.includes(" ") && !(await exists(path))) await writeBytesToFile(path, f);
        const side = pairs[i]! >= 0 ? payload.files[pairs[i]!]! : null;
        const srf = side ? new Uint8Array(await side.arrayBuffer()) : null;
        if (side && !f.name.includes(" ")) {
          const srfPath = `${MODELS_DIR}/${sidecarPath(f.name).toUpperCase()}`;
          if (!(await exists(srfPath))) await writeBytesToFile(srfPath, side);
        }
        const r = await load(f.name, new Uint8Array(await f.arrayBuffer()), have, srf);
        if (typeof r !== "string") have.push(...r.textures);
        out.push(r);
      }
      return out;
    },
  };
}
