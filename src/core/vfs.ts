/*
  The file system Traxx sees: archives mounted in order, first match wins.

  Ported from OpenMTM2 src/worker/vfs.js, MTM2 only, so the per-game families are gone.
  Traxx itself looks for art and models in its ART and MODELS folders; JSTraxx looks in the
  open project first, then in the mounted game archives, in the order the author set
  (Options > Folders). `preferMount` puts one archive ahead of the rest, as when a POD is
  being viewed.

  Pure: a mount is `{ name, archive, readEntry }`, where `archive` is an OpenPhotex
  PodArchive and `readEntry` resolves to an entry's bytes. The asset worker builds mounts
  from OPFS; tests build them from synthetic PODs.
*/
import { normalizePodPath } from "../vendor/openphotex/pod/paths.js";
import type { PodArchive, PodEntry } from "../vendor/openphotex/pod/types.js";

export interface Mount {
  name: string;
  archive: PodArchive;
  readEntry(entry: PodEntry): Promise<Uint8Array>;
}

export interface VfsHit { mount: Mount; entry: PodEntry; path: string }

export interface Vfs {
  mounts: readonly Mount[];
  find(path: string): VfsHit | null;
  /** The first entry whose file name matches, in any folder: Traxx resolves art by bare name. */
  findByTitle(title: string): VfsHit | null;
  read(path: string): Promise<Uint8Array | null>;
  /** Every visible path ending in `extension` (".SIT"), once each, resolved to the mount that wins it. */
  list(extension: string): VfsHit[];
  preferMount(name: string): Vfs;
}

export function createVfs(mounts: readonly Mount[], first: string | null = null): Vfs {
  const ordered = first
    ? [...mounts.filter((m) => m.name === first), ...mounts.filter((m) => m.name !== first)]
    : [...mounts];
  // One map per mount, built once: lookups are hot (every texture and model).
  const tables = ordered.map((mount) => {
    const byPath = new Map<string, PodEntry>();
    const byTitle = new Map<string, PodEntry>();
    for (const entry of mount.archive.entries) {
      if (!byPath.has(entry.normalizedName)) byPath.set(entry.normalizedName, entry);
      if (!byTitle.has(entry.title)) byTitle.set(entry.title, entry);
    }
    return { mount, byPath, byTitle };
  });

  function find(path: string): VfsHit | null {
    const key = normalizePodPath(path);
    for (const { mount, byPath } of tables) {
      const entry = byPath.get(key);
      if (entry) return { mount, entry, path: key };
    }
    return null;
  }

  function findByTitle(title: string): VfsHit | null {
    const key = normalizePodPath(title);
    const last = key.slice(key.lastIndexOf("/") + 1);
    for (const { mount, byTitle } of tables) {
      const entry = byTitle.get(last);
      if (entry) return { mount, entry, path: entry.normalizedName };
    }
    return null;
  }

  return {
    mounts: ordered,
    find,
    findByTitle,
    async read(path) {
      const hit = find(path);
      return hit ? hit.mount.readEntry(hit.entry) : null;
    },
    list(extension) {
      const ext = extension.toUpperCase();
      const seen = new Set<string>();
      const out: VfsHit[] = [];
      for (const { mount, byPath } of tables) {
        for (const [path, entry] of byPath) {
          if (!path.endsWith(ext) || seen.has(path)) continue;
          seen.add(path);
          out.push({ path, mount, entry });
        }
      }
      return out;
    },
    preferMount: (name) => createVfs(mounts, name),
  };
}
