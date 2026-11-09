/*
  The project's ART and MODELS folders in browser storage, as a whole (core/storage.ts): how
  much they hold, and clearing them, all of it or the files a filter picks, so a .TXX reads its
  art and models from the game library again.
*/
import { listDirectory, removePath } from "../shared/opfs.ts";
import { pickStored, summarizeStore, type StoreFolder, type StoredFile, type StoreSummary } from "../core/storage.ts";
import { ART_DIR, MODELS_DIR } from "./doc-handlers.ts";

const DIRS: Record<StoreFolder, string> = { art: ART_DIR, models: MODELS_DIR };

/** Every file below a folder, with paths below it, sub-folders included. */
async function walk(folder: StoreFolder, dir: string, below = ""): Promise<StoredFile[]> {
  const out: StoredFile[] = [];
  for (const e of await listDirectory(below ? `${dir}/${below}` : dir, true)) {
    const path = below ? `${below}/${e.name}` : e.name;
    if (e.kind === "directory") out.push(...(await walk(folder, dir, path)));
    else out.push({ folder, path, size: e.size ?? 0 });
  }
  return out;
}

const everything = async () => [...(await walk("art", ART_DIR)), ...(await walk("models", MODELS_DIR))];

export function storeHandlers() {
  return {
    async "store.summary"(): Promise<StoreSummary> {
      return summarizeStore(await everything());
    },

    /* The files a clear would delete, by folder and title, without deleting them. */
    async "store.match"(payload: { folders: StoreFolder[]; filter: string }): Promise<StoredFile[]> {
      return pickStored(await everything(), payload.folders, payload.filter);
    },

    async "store.clear"(payload: { folders: StoreFolder[]; filter: string }): Promise<number> {
      const picked = pickStored(await everything(), payload.folders, payload.filter);
      for (const f of picked) await removePath(`${DIRS[f.folder]}/${f.path}`);
      return picked.length;
    },

    /* One model file of the MODELS folder (the Load BIN list's Delete). */
    async "models.delete"(payload: { file: string }): Promise<void> {
      await removePath(`${MODELS_DIR}/${payload.file.toUpperCase()}`);
    },
  };
}
