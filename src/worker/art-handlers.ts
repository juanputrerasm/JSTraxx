/*
  The art folder, for the Textures window (Traxx/TraxxTexturesDlg.cpp):

    art.list    the "Load >>" pane: the ART folder (jstraxx/art), then the game library's ART\
                entries whose stem the folder does not hold
    art.thumbs  the 8-bit tiles for a page of the pane (HD art quantized as import would)
    art.load    picks from the pane, as textures (LoadTextureFile)
    art.import  files picked from disk: copied into the ART folder (an existing file is kept),
                then loaded, so the track finds them again when it is reopened
    art.write   new files into the ART folder, refused when one exists (CREATE_NEW)
    art.exists  which of some names the ART folder holds
    art.delete / art.rename   the pane's context menu, for files in the ART folder only

  Library art is read-only, as files inside a POD are.
*/
import { exists, getDirectory, listDirectory, readBytes, removePath, writeBytesToFile } from "../shared/opfs.ts";
import { listArtFolder, type ArtListing } from "../core/edit/art-folder.ts";
import { textureFromFile } from "../core/edit/texture-list.ts";
import { legacyFromHd } from "../core/doc/hd-legacy.ts";
import { MAP_SUFFIXES, swapExt } from "../core/traxx/pod-items.ts";
import type { TextureExtras } from "../core/traxx/pod-writer.ts";
import { decodeImage } from "../shared/image-decode.ts";
import type { TextureAsset } from "../core/doc/document.ts";
import type { Vfs } from "../core/vfs.ts";
import { ART_DIR } from "./doc-handlers.ts";

export type ArtSource = "art" | "library";
export interface ArtItem extends ArtListing { source: ArtSource }
export interface ArtTile { side: number; indices: Uint8Array; act: Uint8Array | null }

const artPath = (file: string) => `${ART_DIR}/${file.toUpperCase()}`;

export function artHandlers(vfs: () => Vfs) {
  /** A file of the ART folder or the library's ART\, or null. */
  const read = async (source: ArtSource, file: string): Promise<Uint8Array | null> => {
    if (source === "art") { try { return await readBytes(artPath(file)); } catch { return null; } }
    const hit = vfs().find(`ART\\${file}`);
    return hit ? hit.mount.readEntry(hit.entry) : null;
  };

  const thumbCache = new Map<string, ArtTile | null>();

  const tileOf = async (item: { source: ArtSource; file: string; ext: string }): Promise<ArtTile | null> => {
    const key = `${item.source}:${item.file.toUpperCase()}`;
    if (thumbCache.has(key)) return thumbCache.get(key)!;
    let tile: ArtTile | null = null;
    const bytes = await read(item.source, item.file);
    if (bytes && item.ext === "RAW") {
      const side = Math.round(Math.sqrt(bytes.length));
      if (side * side === bytes.length) {
        const act = await read(item.source, swapExt(item.file, "ACT"));
        tile = { side, indices: bytes, act: act ? act.slice(0, 768) : null };
      }
    } else if (bytes) {
      const out = await legacyFromHd({ ext: item.ext as "PNG" | "TGA", data: bytes }, item.file, "terrain", decodeImage);
      if (typeof out !== "string") tile = out;
    }
    thumbCache.set(key, tile);
    return tile;
  };

  const load = (title: string, bytes: Uint8Array, act: Uint8Array | null) => textureFromFile({ title, bytes, act }, decodeImage);

  return {
    async "art.list"(payload: { filter: string }): Promise<ArtItem[]> {
      const own = (await listDirectory(ART_DIR, true)).filter((e) => e.kind === "file").map((e) => ({ name: e.name, size: e.size ?? 0 }));
      const mine = listArtFolder(own, payload.filter).map((l) => ({ ...l, source: "art" as const }));
      const stems = new Set(mine.map((l) => l.stem));
      const library = ["PNG", "TGA", "RAW"].flatMap((ext) => vfs().list(`.${ext}`))
        .filter((h) => /^ART\/[^/]+$/.test(h.path))
        .map((h) => ({ name: h.path.slice(4), size: h.entry.length }));
      const theirs = listArtFolder(library, payload.filter).filter((l) => !stems.has(l.stem)).map((l) => ({ ...l, source: "library" as const }));
      return [...mine, ...theirs];
    },

    async "art.thumbs"(payload: { items: ArtItem[] }): Promise<(ArtTile | null)[]> {
      return Promise.all(payload.items.map(tileOf));
    },

    async "art.load"(payload: { items: ArtItem[] }): Promise<(TextureAsset | string)[]> {
      const results: (TextureAsset | string)[] = [];
      for (const item of payload.items) {
        const bytes = await read(item.source, item.file);
        if (!bytes) { results.push(`Error loading "${item.file}"!`); continue; }
        const act = item.ext === "RAW" ? await read(item.source, swapExt(item.file, "ACT")) : null;
        results.push(await load(item.file, bytes, act));
      }
      return results;
    },

    /*
      Textures by name ("ART\\GRASS.RAW"), as a pattern's are loaded (Extract): the ART folder,
      then the library; a .RAW not found falls back to an HD file of the same stem.
    */
    async "art.loadNamed"(payload: { names: string[] }): Promise<(TextureAsset | string)[]> {
      const results: (TextureAsset | string)[] = [];
      for (const full of payload.names) {
        const file = full.replace(/^ART\\/i, "").toUpperCase();
        let done = false;
        for (const source of ["art", "library"] as const) {
          for (const probe of [file, ...(/\.RAW$/.test(file) ? [swapExt(file, "PNG"), swapExt(file, "TGA")] : [])]) {
            const bytes = await read(source, probe);
            if (!bytes) continue;
            const act = /\.RAW$/.test(probe) ? await read(source, swapExt(probe, "ACT")) : null;
            results.push(await load(probe, bytes, act));
            done = true;
            break;
          }
          if (done) break;
        }
        if (!done) results.push(`Can't load texture: "${file}"!`);
      }
      return results;
    },

    /*
      Write POD's look beside each texture (PodFindHDSource, PodFindMapSibling): an HD source of
      the same stem, and the _N and _AO maps, PNG before TGA, in the ART folder then the library.
    */
    async "art.extras"(payload: { names: string[]; needHd: boolean[] }): Promise<Record<string, TextureExtras>> {
      const out: Record<string, TextureExtras> = {};
      const find = async (stem: string): Promise<{ ext: "PNG" | "TGA"; data: Uint8Array } | null> => {
        for (const source of ["art", "library"] as const) {
          for (const ext of ["PNG", "TGA"] as const) {
            const data = await read(source, `${stem}.${ext}`);
            if (data) return { ext, data };
          }
        }
        return null;
      };
      for (let i = 0; i < payload.names.length; i++) {
        const name = payload.names[i]!.toUpperCase();
        const file = name.replace(/^ART\\/, "");
        const dot = file.lastIndexOf(".");
        const stem = dot > 0 ? file.slice(0, dot) : file;
        const hd = payload.needHd[i] ? await find(stem) : null;
        const maps: TextureExtras["maps"] = [];
        for (const suffix of MAP_SUFFIXES) {
          const m = await find(`${stem}${suffix}`);
          if (m) maps.push({ suffix, ...m });
        }
        if (hd || maps.length) out[name] = { hd, maps };
      }
      return out;
    },

    async "art.import"(payload: { files: File[] }): Promise<(TextureAsset | string)[]> {
      const byName = new Map(payload.files.map((f) => [f.name.toUpperCase(), f]));
      for (const [name, f] of byName) {
        if (!/\.(RAW|ACT|PNG|TGA)$/.test(name)) continue;
        if (!(await exists(artPath(name)))) await writeBytesToFile(artPath(name), f);
      }
      const results: (TextureAsset | string)[] = [];
      for (const [name, f] of byName) {
        if (!/\.(RAW|PNG|TGA)$/.test(name)) continue;
        const actFile = byName.get(swapExt(name, "ACT"));
        const act = name.endsWith(".RAW") ? (actFile ? new Uint8Array(await actFile.arrayBuffer()) : await read("art", swapExt(name, "ACT"))) : null;
        results.push(await load(f.name, new Uint8Array(await f.arrayBuffer()), act));
      }
      thumbCache.clear();
      return results;
    },

    async "art.write"(payload: { files: { name: string; bytes: Uint8Array }[] }): Promise<string | null> {
      for (const f of payload.files) if (await exists(artPath(f.name))) return `"${f.name}" is not unique.\nPlease try a different name.`;
      for (const f of payload.files) await writeBytesToFile(artPath(f.name), f.bytes);
      thumbCache.clear();
      return null;
    },

    async "art.exists"(payload: { names: string[] }): Promise<boolean[]> {
      return Promise.all(payload.names.map((n) => exists(artPath(n))));
    },

    /* OnTFolderDelete: the file and, for a .RAW, its .ACT. */
    async "art.delete"(payload: { file: string }): Promise<void> {
      const names = [payload.file, ...(/\.RAW$/i.test(payload.file) ? [swapExt(payload.file, "ACT")] : [])];
      for (const n of names) { try { await removePath(artPath(n)); } catch { /* not there */ } }
      thumbCache.clear();
    },

    /* OnTFolderRename: to a stem no .RAW or .ACT in the folder has; a .RAW takes its .ACT along. */
    async "art.rename"(payload: { file: string; stem: string }): Promise<string | null> {
      const ext = payload.file.slice(payload.file.lastIndexOf(".") + 1).toUpperCase();
      const stem = payload.stem.toUpperCase();
      for (const e of ["RAW", "ACT", ext]) if (await exists(artPath(`${stem}.${e}`))) return "Name is not unique.\nPlease try a different name.";
      const moves = [[payload.file, `${stem}.${ext}`], ...(ext === "RAW" ? [[swapExt(payload.file, "ACT"), `${stem}.ACT`]] : [])];
      await getDirectory(ART_DIR, true);
      for (const [from, to] of moves) {
        let bytes: Uint8Array;
        try { bytes = await readBytes(artPath(from)); } catch { continue; }
        await writeBytesToFile(artPath(to), bytes);
        await removePath(artPath(from));
      }
      thumbCache.clear();
      return null;
    },
  };
}
