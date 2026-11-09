/*
  The project's own ART and MODELS folders in browser storage (jstraxx/art, jstraxx/models): what
  Traxx's ART and MODELS folders on disk are. Opening a .TXX reads a file there before the game
  library (worker/doc-handlers.ts assetSource), so a stale copy, from Extract Models and Art or an
  import, hides the one in a POD. A JSTraxx addition: listing and clearing them.
*/
import { wildcardMatch } from "./edit/art-folder.ts";

export type StoreFolder = "art" | "models";

/** A file in one of the folders: its path below the folder ("SUB/GRASS.RAW") and size. */
export interface StoredFile { folder: StoreFolder; path: string; size: number }

export interface StoreSummary { art: { files: number; bytes: number }; models: { files: number; bytes: number } }

export function summarizeStore(files: readonly StoredFile[]): StoreSummary {
  const out: StoreSummary = { art: { files: 0, bytes: 0 }, models: { files: 0, bytes: 0 } };
  for (const f of files) { out[f.folder].files++; out[f.folder].bytes += f.size; }
  return out;
}

/**
  The files a filter picks, as the Load lists read a filter: empty is every file, text with a
  * or ? is a Windows wildcard, other text is matched anywhere in the name ("VP" is *VP*). It is
  matched against the file's title, case ignored.
*/
export function pickStored(files: readonly StoredFile[], folders: readonly StoreFolder[], filter: string): StoredFile[] {
  const f = filter.trim();
  const pattern = !f ? "*" : /[*?]/.test(f) ? f : `*${f}*`;
  return files.filter((file) => folders.includes(file.folder) && wildcardMatch(pattern, file.path.slice(file.path.lastIndexOf("/") + 1)));
}
