/*
  Track documents in the asset worker: new, open (.TXX), View POD, clone, save and extract.

  Storage, as Traxx keeps it on disk:
    jstraxx/art/       Traxx's ART folder: art for every track (Extract fills it)
    jstraxx/models/    Traxx's MODELS folder
    jstraxx/tracks/    saved .TXX files
  A .TXX's art and models are looked for in art/ and models/, then in the mounted game PODs.
*/
import { rebased, trackedFolder } from "./tracked-folder.ts";
import { transfer, emit } from "../shared/worker-host.ts";
import { ROOT, exists, listDirectory, readBytes, writeBytesToFile } from "../shared/opfs.ts";
import { newTrackDocument } from "../core/doc/new-track.ts";
import { countTracks, loadPodTrack, type PodSource as PodReader } from "../core/doc/load-pod.ts";
import { openTxx, type AssetSource } from "../core/doc/load-txx.ts";
import { cloneFromSit, type TrackedFolder } from "../core/doc/clone.ts";
import { documentBuffers, type TrackDocument } from "../core/doc/document.ts";
import { writeTxx } from "../core/traxx/txx.ts";
import { fillHdLegacy } from "../core/doc/hd-legacy.ts";
import { decodeImage } from "../shared/image-decode.ts";
import { situationKind } from "../core/doc/load-pod.ts";
import { indexPodFile, podFile, type PodSource } from "./pod-index.ts";
import type { Vfs } from "../core/vfs.ts";

export const ART_DIR = `${ROOT}/art`;
export const MODELS_DIR = `${ROOT}/models`;
export const TRACKS_DIR = `${ROOT}/tracks`;

const progress = (fraction: number, label: string) => emit("progress", { label, done: Math.round(fraction * 100), total: 100 });

/** A folder path below ART or MODELS, as a file path in OPFS. */
const opfsPath = (dir: string, path: string) => `${dir}/${path.replace(/\\/g, "/").toUpperCase()}`;

async function readOpfs(path: string): Promise<Uint8Array | null> {
  try { return await readBytes(path); } catch { return null; }
}

/** Traxx's ART and MODELS folders, then the game library. */
function assetSource(vfs: () => Vfs): AssetSource {
  const lookup = (folder: string, dir: string) => async (path: string) => {
    const own = await readOpfs(opfsPath(dir, path));
    if (own) return own;
    const v = vfs();
    const hit = v.find(`${folder}\\${path}`) ?? v.findByTitle(path);
    return hit ? hit.mount.readEntry(hit.entry) : null;
  };
  return { art: lookup("ART", ART_DIR), model: lookup("MODELS", MODELS_DIR) };
}

async function podReader(source: PodSource): Promise<PodReader> {
  const archive = await indexPodFile(source);
  const file = await podFile(source);
  return { archive, read: async (e) => new Uint8Array(await file.slice(e.offset, e.offset + e.length).arrayBuffer()) };
}

/** Send a loaded document, with the 8-bit tiles of HD-only art built first. */
async function sendLoaded(doc: TrackDocument) {
  await fillHdLegacy(doc, decodeImage);
  emit("progress", null);
  return sendDocument(doc);
}

/** A load that clears the progress strip if it fails, so the strip never stays up. */
async function loading<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (err) { emit("progress", null); throw err; }
}

function sendDocument(doc: TrackDocument) {
  return transfer(doc, documentBuffers(doc));
}

/** A track file name: letters, digits, spaces and a few marks, ending .TXX. */
export function trackFileName(name: string): string {
  const clean = name.replace(/\.txx$/i, "").replace(/[^A-Za-z0-9 _()-]/g, "").trim().slice(0, 64);
  return `${clean || "Untitled"}.txx`;
}

export function docHandlers(vfs: () => Vfs) {
  return {
    async "doc.new"() {
      return sendDocument(newTrackDocument());
    },

    async "pod.tracks"(payload: { source: PodSource }) {
      return countTracks(await podReader(payload.source));
    },

    /* View POD: read-only, with anything the POD lacks looked up in the library. */
    async "doc.viewPod"(payload: { source: PodSource; which: number; fileName: string }) {
      const reader = await podReader(payload.source);
      const v = vfs();
      const fallback = async (name: string) => {
        const hit = name.includes("\\") ? v.find(name) : v.findByTitle(name);
        return hit ? hit.mount.readEntry(hit.entry) : null;
      };
      return loading(async () => sendLoaded(await loadPodTrack(reader, payload.which, payload.fileName, { fallback, progress })));
    },

    /* Open a .TXX from storage (a path in tracks/) or a file the page picked. */
    async "doc.openTxx"(payload: { source: string | Blob; fileName: string }) {
      const bytes = typeof payload.source === "string" ? await readBytes(payload.source) : new Uint8Array(await payload.source.arrayBuffer());
      const project = typeof payload.source === "string" ? payload.source : null;
      return loading(async () => sendLoaded(await openTxx(bytes, payload.fileName, assetSource(vfs), { progress, project })));
    },

    /* The situation files in a picked TrackEd folder, by path below it. */
    /*
      The situation files of a TrackEd folder: WORLD\<name>.SIT or .SI2, with WORLD found at any
      depth, so the TrackEd folder itself or any folder holding it can be picked. When only
      loose situation files turn up (the WORLD folder was picked), they come back flagged.
    */
    async "clone.list"(payload: { files: File[] }) {
      const all = [...trackedFolder(payload.files).paths()];
      const sits = all.filter((p) => /(^|\\)WORLD\\[^\\]+$/.test(p) && situationKind(p.slice(p.lastIndexOf("\\") + 1))).sort();
      const loose = sits.length ? [] : all.filter((p) => situationKind(p.slice(p.lastIndexOf("\\") + 1)));
      return { sits, loose };
    },

    async "doc.clone"(payload: { files: File[]; sitPath: string }) {
      // The TrackEd folder is the one holding this WORLD folder.
      const at = payload.sitPath.toUpperCase().lastIndexOf("WORLD\\");
      const root = at > 0 ? payload.sitPath.slice(0, at) : "";
      const folder = rebased(trackedFolder(payload.files), root);
      payload = { ...payload, sitPath: payload.sitPath.slice(root.length) };
      const library = assetSource(vfs);
      const assets: AssetSource = {
        art: async (p) => (await folder.read(`ART\\${p}`)) ?? library.art(p),
        model: async (p) => (await folder.read(`MODELS\\${p}`)) ?? library.model(p),
      };
      return loading(async () => sendLoaded(await cloneFromSit(folder, payload.sitPath, assets, progress)));
    },

    /* Save a track as .TXX in tracks/. Returns its path and size. */
    async "doc.saveTxx"(payload: { track: TrackDocument["track"]; fileName: string }) {
      const bytes = writeTxx(payload.track);
      const path = `${TRACKS_DIR}/${trackFileName(payload.fileName)}`;
      await writeBytesToFile(path, bytes);
      return { path, size: bytes.length };
    },

    /* The .TXX bytes, for a download. */
    async "doc.txxBytes"(payload: { track: TrackDocument["track"] }) {
      const bytes = writeTxx(payload.track);
      return transfer(bytes, [bytes.buffer]);
    },

    async "tracks.list"() {
      const entries = await listDirectory(TRACKS_DIR, true);
      return entries.filter((e) => e.kind === "file" && /\.txx$/i.test(e.name)).map((e) => ({ name: e.name, path: `${TRACKS_DIR}/${e.name}`, size: e.size ?? 0, modified: e.lastModified ?? 0 }));
    },

    /*
      Extract Models and Art (CTraxxView::OnEditExtract): every ART\ and MODELS\ entry of the
      viewed POD into the ART and MODELS folders. An existing file is left alone, as
      CreateFile(CREATE_NEW) leaves it.
    */
    async "art.extract"(payload: { source: PodSource }) {
      const reader = await podReader(payload.source);
      let written = 0, skipped = 0;
      const items = reader.archive.entries.filter((e) => e.name.startsWith("ART\\") || e.name.startsWith("MODELS\\"));
      for (const [i, e] of items.entries()) {
        const art = e.name.startsWith("ART\\");
        const path = opfsPath(art ? ART_DIR : MODELS_DIR, e.name.slice(art ? 4 : 7));
        if (i % 20 === 0) emit("progress", { label: `Extracting ${e.name}`, done: i, total: items.length });
        if (await exists(path)) { skipped++; continue; }
        await writeBytesToFile(path, await reader.read(e));
        written++;
      }
      emit("progress", null);
      return { written, skipped };
    },
  };
}

/* A picked folder (webkitdirectory) as a TrackEd folder: paths below the picked folder, upper case. */
