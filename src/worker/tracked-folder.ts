/*
  A TrackEd folder the user picked, as the files the browser handed over: paths relative to
  the picked folder, upper case, with backslashes, as Traxx names them.
*/
import type { TrackedFolder } from "../core/doc/clone.ts";

/* A folder seen from one of its subfolders (prefix "A\\B\\", or "" for itself). */
export function rebased(folder: TrackedFolder & { paths(): IterableIterator<string> }, prefix: string): TrackedFolder & { paths(): IterableIterator<string> } {
  if (!prefix) return folder;
  const up = prefix.toUpperCase();
  return {
    has: (p) => folder.has(up + p),
    read: (p) => folder.read(up + p),
    paths: function* () { for (const p of folder.paths()) if (p.startsWith(up)) yield p.slice(up.length); },
  };
}

export function trackedFolder(files: readonly File[]): TrackedFolder & { paths(): IterableIterator<string> } {
  const map = new Map<string, File>();
  for (const f of files) {
    const rel = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split("/");
    // Drop the picked folder's own name.
    const path = (rel.length > 1 ? rel.slice(1) : rel).join("\\").toUpperCase();
    map.set(path, f);
  }
  return {
    has: (p) => map.has(p.toUpperCase()),
    read: async (p) => { const f = map.get(p.toUpperCase()); return f ? new Uint8Array(await f.arrayBuffer()) : null; },
    paths: () => map.keys(),
  };
}
