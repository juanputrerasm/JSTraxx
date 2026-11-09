/*
  Storage for Make Far Cards (Traxx/VegetationFarCard.cpp, core/traxx/veg-far-card.ts):

    farcard.artRead    a file of the ART folder, then the library's ART\ (what VcLoadTexture reads
                       from reg.ART_folder: a texture's own .RAW, .ACT and HD source)
    farcard.exists     VcFileExists on the ART folder (.PNG / .RAW / .ACT) or the MODELS folder
    farcard.writeArt   VcWriteArt: <stem>.PNG, .RAW and .ACT into the ART folder, all or none
    farcard.writeBin   VcWriteBytes of the .BIN into the MODELS folder
    farcard.deleteArt  the art a run wrote, taken back when its .BIN could not be written

  The card is then loaded like any model of the MODELS folder (models.load). Nothing is ever
  written into the library, which is the game's own archives.
*/
import { exists, readBytes, removePath, writeBytesToFile } from "../shared/opfs.ts";
import type { Vfs } from "../core/vfs.ts";
import { ART_DIR, MODELS_DIR } from "./doc-handlers.ts";

const artPath = (file: string) => `${ART_DIR}/${file.toUpperCase()}`;
const modelPath = (file: string) => `${MODELS_DIR}/${file.toUpperCase()}`;

export function farCardHandlers(vfs: () => Vfs) {
  const remove = async (path: string) => { try { await removePath(path); } catch { /* not there */ } };
  return {
    async "farcard.artRead"(payload: { name: string }): Promise<Uint8Array | null> {
      try { return await readBytes(artPath(payload.name)); } catch { /* not in the ART folder */ }
      const hit = vfs().find(`ART\\${payload.name}`);
      return hit ? hit.mount.readEntry(hit.entry) : null;
    },

    async "farcard.exists"(payload: { art?: string; bin?: string }): Promise<boolean> {
      if (payload.art) return exists(artPath(payload.art));
      if (payload.bin) return exists(modelPath(payload.bin));
      return false;
    },

    async "farcard.writeArt"(payload: { stem: string; png: Uint8Array; raw: Uint8Array; act: Uint8Array }): Promise<string | null> {
      const names = ["PNG", "RAW", "ACT"].map((e) => `${payload.stem}.${e}`);
      try {
        await writeBytesToFile(artPath(names[0]!), payload.png);
      } catch {
        await remove(artPath(names[0]!));
        return "the PNG could not be written";
      }
      try {
        await writeBytesToFile(artPath(names[1]!), payload.raw);
        await writeBytesToFile(artPath(names[2]!), payload.act);
      } catch {
        for (const n of names) await remove(artPath(n));
        return "the legacy .RAW / .ACT could not be written";
      }
      return null;
    },

    async "farcard.writeBin"(payload: { bare: string; bytes: Uint8Array }): Promise<boolean> {
      try {
        await writeBytesToFile(modelPath(payload.bare), payload.bytes);
        return true;
      } catch {
        await remove(modelPath(payload.bare));
        return false;
      }
    },

    async "farcard.deleteArt"(payload: { stem: string }): Promise<void> {
      for (const e of ["PNG", "RAW", "ACT"]) await remove(artPath(`${payload.stem}.${e}`));
    },
  };
}
