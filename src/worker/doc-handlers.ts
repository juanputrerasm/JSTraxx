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
import type { TrackKind } from "../core/traxx/track-kind.ts";
import { countTracks, loadPodTrack, type PodSource as PodReader } from "../core/doc/load-pod.ts";
import { modelWithTextures, openTxx, type AssetSource } from "../core/doc/load-txx.ts";
import { extractArtAndModels, EXTRACT_UNREADABLE_TAIL } from "../core/doc/extract-art.ts";
import { cloneAssetSource, cloneFromSit, type TrackedFolder } from "../core/doc/clone.ts";
import { layeredModels, libraryModels } from "../core/doc/surface-sidecar.ts";
import { documentBuffers, type ModelAsset, type TextureAsset, type TrackDocument } from "../core/doc/document.ts";
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

/**
  Traxx's ART and MODELS folders, then the game library. A model's .SRF comes only from where
  the model did (FindSurfaceSidecar: beside its source), see core/doc/surface-sidecar.ts.
*/
function assetSource(vfs: () => Vfs): AssetSource {
  const lookup = (folder: string, dir: string) => async (path: string) => {
    const own = await readOpfs(opfsPath(dir, path));
    if (own) return own;
    const v = vfs();
    const hit = v.find(`${folder}\\${path}`) ?? v.findByTitle(path);
    return hit ? hit.mount.readEntry(hit.entry) : null;
  };
  return { art: lookup("ART", ART_DIR), model: layeredModels([(path) => readOpfs(opfsPath(MODELS_DIR, path)), libraryModels(vfs)]) };
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
    /* File > New; `cells` is the world size (256, or 512: version 6 only) and `kind` the track kind (track-kind.ts). */
    async "doc.new"(payload?: { cells?: number; kind?: TrackKind }) {
      return sendDocument(newTrackDocument(payload?.cells, payload?.kind));
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
      The situation files of a TrackEd folder: WORLD\<name>.SIT, .SI2 or .SI3, with WORLD found at any
      depth, so the TrackEd folder itself or any folder holding it can be picked. When only
      loose situation files turn up (the WORLD folder was picked), they come back flagged.
    */
    async "clone.list"(payload: { files: File[] }) {
      const all = [...trackedFolder(payload.files).paths()];
      // Traxx origin/main (CloneTrackDlg.cpp sitfilter): .SIT, .SI2 and a version 6 track's .SI3.
      const cloneable = (p: string) => situationKind(p.slice(p.lastIndexOf("\\") + 1)) !== null;
      const sits = all.filter((p) => /(^|\\)WORLD\\[^\\]+$/.test(p) && cloneable(p)).sort();
      const loose = sits.length ? [] : all.filter(cloneable);
      return { sits, loose };
    },

    async "doc.clone"(payload: { files: File[]; sitPath: string }) {
      // The TrackEd folder is the one holding this WORLD folder.
      const at = payload.sitPath.toUpperCase().lastIndexOf("WORLD\\");
      const root = at > 0 ? payload.sitPath.slice(0, at) : "";
      const folder = rebased(trackedFolder(payload.files), root);
      payload = { ...payload, sitPath: payload.sitPath.slice(root.length) };
      const assets = cloneAssetSource(folder, assetSource(vfs));
      return loading(async () => sendLoaded(await cloneFromSit(folder, payload.sitPath, assets, progress)));
    },

    /* Save a track as .TXX in tracks/. Returns its path and size. A track CanSaveBinary refuses throws its sentence. */
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
    /*
      Extract Models and Art / Edit This Track's copy (Traxx origin/main CTrackPOD::ExtractArtAndModels,
      core/doc/extract-art.ts): never overwrites; same bytes silent, other bytes listed, the HD source
      not put beside a differing .RAW / .ACT. With `readConflicts` (Edit This Track) a .BIN one of the
      track's `models` was read from, whose folder copy differs, is read from the folder
      (ReloadModelFromSource: its textures from ART, its .SRF beside it) and listed; one the reader
      refuses stays the pod's and its line says so. `sources`: each model whose .BIN is now in the
      folder with the pod's bytes, with the .SRF beside it there (NoteModelSource). `entries`: the
      pod's names, for the free stem.
    */
    async "art.extract"(payload: { source: PodSource; readConflicts?: boolean; models?: string[]; modelTextures?: string[] }) {
      const reader = await podReader(payload.source);
      const items = reader.archive.entries.filter((e) => /^(ART|MODELS)\\/i.test(e.name));
      const key = (n: string) => n.toUpperCase().replace(/^MODELS\\/, "");
      const trackModels = new Map((payload.models ?? []).map((m) => [key(m), m]));
      let done = 0;
      const result = await extractArtAndModels(items.map((e) => ({
        name: e.name,
        read: async () => {
          if (done++ % 20 === 0) emit("progress", { label: `Extracting ${e.name}`, done, total: items.length * 2 });
          return reader.read(e);
        },
      })), {
        read: async (folder, path) => {
          const at = opfsPath(folder === "ART" ? ART_DIR : MODELS_DIR, path);
          if (!(await exists(at))) return null;
          return (await readOpfs(at)) ?? "dir";
        },
        write: async (folder, path, bytes) => {
          try { await writeBytesToFile(opfsPath(folder === "ART" ? ART_DIR : MODELS_DIR, path), bytes); return true; } catch { return false; }
        },
      }, Boolean(payload.readConflicts), (item) => trackModels.has(key(item)));
      const art = (path: string) => readOpfs(opfsPath(ART_DIR, path));
      const srfBeside = async (item: string) => {
        const rest = item.slice(7), dot = rest.lastIndexOf(".");
        const stem = dot > rest.lastIndexOf("\\") ? rest.slice(0, dot) : rest;
        const srf = await readOpfs(opfsPath(MODELS_DIR, `${stem}.SRF`));
        return srf && srf.length > 0 ? srf : null;
      };
      // Every model whose .BIN in the folder differs is read from it now, the art it names being in place.
      const reloaded: { model: ModelAsset; textures: TextureAsset[] }[] = [];
      const have = (payload.modelTextures ?? []).map((name) => ({ name }));
      for (const item of result.modelConflicts) {
        const name = trackModels.get(key(item))!;
        const bytes = await readOpfs(opfsPath(MODELS_DIR, item.slice(7)));
        let ok = false;
        if (bytes && bytes.length) {
          try {
            const r = await modelWithTextures(name, bytes, art, [...have, ...reloaded.flatMap((x) => x.textures)]);
            r.model.srf = await srfBeside(item);
            reloaded.push({ model: r.model, textures: r.textures.filter((t) => !t.bad) });
            ok = true;
          } catch { ok = false; }
        }
        result.report.push(ok ? item : item + EXTRACT_UNREADABLE_TAIL);
      }
      const sources: { name: string; srf: Uint8Array | null }[] = [];
      for (const item of result.modelSources) {
        const name = trackModels.get(key(item));
        if (name) sources.push({ name, srf: await srfBeside(item) });
      }
      emit("progress", null);
      const out = { written: result.written, report: result.report, entries: reader.archive.entries.map((e) => e.name), reloaded, sources };
      const buffers = new Set<ArrayBuffer>();
      for (const r of reloaded) {
        for (const b of [r.model.bytes, r.model.srf, ...r.textures.flatMap((t) => [t.indices, t.act, t.hd?.data])]) if (b && b.buffer instanceof ArrayBuffer) buffers.add(b.buffer);
      }
      for (const x of sources) if (x.srf && x.srf.buffer instanceof ArrayBuffer) buffers.add(x.srf.buffer);
      return transfer(out, [...buffers]);
    },
  };
}

/* A picked folder (webkitdirectory) as a TrackEd folder: paths below the picked folder, upper case. */
