/*
  POD archives on disk. Ported from OpenMTM2 src/worker/pod-index.js.

  Parsing is OpenPhotex's: this file only moves bytes between OPFS (or a picked File) and it.
  Indexing reads just the directory, since a game folder can hold hundreds of megabytes.
*/
import { parsePod, podDirectoryEnd } from "../vendor/openphotex/pod/parse.js";
import type { PodArchive, PodEntry } from "../vendor/openphotex/pod/types.js";
import { readFile } from "../shared/opfs.ts";
import type { Mount } from "../core/vfs.ts";

/** An archive's source: a path in OPFS, or a Blob the page handed over. */
export type PodSource = string | Blob;

export async function podFile(source: PodSource): Promise<Blob> {
  return typeof source === "string" ? readFile(source) : source;
}

export async function indexPodFile(source: PodSource): Promise<PodArchive> {
  const file = await podFile(source);
  let prefix = new Uint8Array(0);
  for (;;) {
    const need = podDirectoryEnd(prefix, file.size);
    if (need <= prefix.length) break;
    prefix = new Uint8Array(await file.slice(0, need).arrayBuffer());
  }
  return parsePod(prefix, { byteLength: file.size });
}

export async function readPodEntryBytes(source: PodSource, entry: Pick<PodEntry, "offset" | "length">): Promise<Uint8Array> {
  const file = await podFile(source);
  return new Uint8Array(await file.slice(entry.offset, entry.offset + entry.length).arrayBuffer());
}

/** A VFS mount over an archive, reading entries on demand. */
export async function mountPod(name: string, source: PodSource): Promise<Mount> {
  const archive = await indexPodFile(source);
  const file = await podFile(source);
  return {
    name,
    archive,
    readEntry: async (entry) => new Uint8Array(await file.slice(entry.offset, entry.offset + entry.length).arrayBuffer()),
  };
}

/* Track scripts, including the Community Patch 3 .SI2 spelling (same content as .SIT). */
export function findSitEntries(archive: PodArchive): PodEntry[] {
  return archive.entries.filter((e) => e.title.endsWith(".SIT") || e.title.endsWith(".SI2"));
}
