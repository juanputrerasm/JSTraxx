/*
  The asset worker: the POD library in OPFS, the mounted VFS, and reads from it.

  Traxx reads its art and models from folders on disk; JSTraxx reads them from the game
  archives the author added to the library (jstraxx/library), mounted in the order Options >
  Folders sets, and from the open project. Heavy reads stay here, off the page.
*/
import { serve, transfer, emit } from "../shared/worker-host.ts";
import { ROOT, listDirectory, removePath, writeBytesToFile, writeStreamToFile } from "../shared/opfs.ts";
import { createVfs, type Mount, type Vfs } from "../core/vfs.ts";
import { mountPod, indexPodFile, readPodEntryBytes, findSitEntries, type PodSource } from "./pod-index.ts";
import type { PodEntry } from "../vendor/openphotex/pod/types.js";
import { docHandlers } from "./doc-handlers.ts";
import { artHandlers } from "./art-handlers.ts";
import { patternHandlers } from "./pattern-handlers.ts";
import { modelHandlers } from "./model-handlers.ts";

const LIBRARY = `${ROOT}/library`;

let mounts: Mount[] = [];
let vfs: Vfs = createVfs([]);

export interface LibraryItem { name: string; size: number }
export interface MountSummary { name: string; comment: string; entries: number; tracks: string[]; error?: string }
export interface VfsListItem { path: string; mount: string; length: number }

function isPodName(name: string): boolean {
  return /\.(pod)$/i.test(name);
}

serve({
  ...docHandlers(() => vfs),
  ...artHandlers(() => vfs),
  ...patternHandlers(),
  ...modelHandlers(() => vfs),
  /** The archives in the library folder. */
  async "library.list"(): Promise<LibraryItem[]> {
    const entries = await listDirectory(LIBRARY, true);
    return entries.filter((e) => e.kind === "file" && isPodName(e.name)).map((e) => ({ name: e.name, size: e.size ?? 0 }));
  },

  /*
    Copies archives into the library. A File streams straight to OPFS, so a 100 MB POD never
    sits in memory whole. Names are kept as given; an archive of the same name is replaced.
  */
  async "library.import"(payload: { files: File[] }): Promise<string[]> {
    const added: string[] = [];
    for (const [i, file] of payload.files.entries()) {
      if (!isPodName(file.name)) continue;
      emit("progress", { label: `Copying ${file.name}`, done: i, total: payload.files.length });
      const path = `${LIBRARY}/${file.name}`;
      if (typeof file.stream === "function") await writeStreamToFile(path, file.stream());
      else await writeBytesToFile(path, file);
      added.push(file.name);
    }
    emit("progress", null);
    return added;
  },

  async "library.remove"(payload: { name: string }): Promise<void> {
    mounts = mounts.filter((m) => m.name !== payload.name);
    vfs = createVfs(mounts);
    await removePath(`${LIBRARY}/${payload.name}`);
  },

  /*
    Mounts the named library archives in the given order, replacing what was mounted. An
    archive that fails to index is reported and skipped, never fatal: one damaged POD in a
    game folder must not stop the editor.
  */
  async "vfs.mount"(payload: { order: string[] }): Promise<MountSummary[]> {
    const next: Mount[] = [];
    const summary: MountSummary[] = [];
    for (const [i, name] of payload.order.entries()) {
      emit("progress", { label: `Reading ${name}`, done: i, total: payload.order.length });
      try {
        const mount = await mountPod(name, `${LIBRARY}/${name}`);
        next.push(mount);
        summary.push({
          name,
          comment: mount.archive.comment,
          entries: mount.archive.entries.length,
          tracks: findSitEntries(mount.archive).map((e) => e.normalizedName),
        });
      } catch (err) {
        summary.push({ name, comment: "", entries: 0, tracks: [], error: err instanceof Error ? err.message : String(err) });
      }
    }
    emit("progress", null);
    mounts = next;
    vfs = createVfs(mounts);
    return summary;
  },

  /** A file through the VFS, by full path or, with `byTitle`, by bare file name. */
  async "vfs.read"(payload: { path: string; byTitle?: boolean }) {
    const hit = payload.byTitle ? vfs.findByTitle(payload.path) : vfs.find(payload.path);
    if (!hit) return null;
    const bytes = await hit.mount.readEntry(hit.entry);
    return transfer({ path: hit.path, mount: hit.mount.name, bytes }, [bytes.buffer]);
  },

  async "vfs.list"(payload: { extension: string }): Promise<VfsListItem[]> {
    return vfs.list(payload.extension).map((h) => ({ path: h.path, mount: h.mount.name, length: h.entry.length }));
  },

  /** The directory of any archive, for the POD browser (View POD). */
  async "pod.index"(payload: { source: PodSource }) {
    return indexPodFile(payload.source);
  },

  async "pod.read"(payload: { source: PodSource; entry: Pick<PodEntry, "offset" | "length"> }) {
    const bytes = await readPodEntryBytes(payload.source, payload.entry);
    return transfer(bytes, [bytes.buffer]);
  },
});
