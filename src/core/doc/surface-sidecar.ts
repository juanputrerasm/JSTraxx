/*
  Surface meshes (Traxx 1.7, commit 53b432c): a model FOO.BIN may have FOO.SRF beside it. The
  engine reads that file to give the mesh's materials their surface types, and only when it
  sits in the same pod as the .BIN, so Write POD packs it right after its model.

  Traxx finds the .SRF NEXT TO THE MODEL'S SOURCE FILE (CTrackPODModel::FindSurfaceSidecar,
  TrackPOD/TrackPODModel.cpp), never under the model's name somewhere else, and a model read out
  of a pod has no source and no sidecar. JSTraxx reads its sources through layers (the project's
  MODELS folder in browser storage, a TrackEd folder, the game library), so the rule here is the
  same one: a .SRF is answered only by the place that gave the model its bytes, and inside the
  library only by the very pod that holds the .BIN.

  Also here: the "(surface)" tag of the Models window (IsSurfaceMesh, NotePodSurface) and the
  check Write POD makes before overwriting a pod that carried a .SRF the new pod would not
  (CTrackPOD::FindLostSurfaceSidecars, TrackPOD/TrackPODFile.cpp).
*/
import type { Mount, Vfs } from "../vfs.ts";
import { normalizePodPath } from "../../vendor/openphotex/pod/paths.js";

export type Reader = (path: string) => Promise<Uint8Array | null>;

/** True for a path naming a .SRF. */
export function isSrfPath(path: string): boolean {
  return /\.srf$/i.test(path);
}

/**
  FindSurfaceSidecar's name: the source path with the extension swapped for .SRF. The dot must
  be in the file name, not in a folder; a name with no extension gets .SRF added.
*/
export function sidecarPath(source: string): string {
  const dot = source.lastIndexOf(".");
  const cut = dot > source.lastIndexOf("\\") && dot > source.lastIndexOf("/") ? dot : source.length;
  return `${source.slice(0, cut)}.SRF`;
}

/** PodModelStem: "MODELS\Foo.BIN" / "Foo.bin" / "MODELS\Foo" -> "FOO". Same stem, however the name is dressed. */
export function podModelStem(name: string): string {
  let n = name;
  if (n.slice(0, 7).toUpperCase() === "MODELS\\") n = n.slice(7);
  const dot = n.lastIndexOf(".");
  return (dot >= 0 ? n.slice(0, dot) : n).toUpperCase();
}

/** A path's key for matching a model to its sidecar: the whole path, extension off, upper case, one kind of slash. */
function stemKey(path: string): string {
  const p = path.replace(/\//g, "\\").toUpperCase();
  const dot = p.lastIndexOf(".");
  return dot > p.lastIndexOf("\\") ? p.slice(0, dot) : p;
}

/**
  Model readers tried in order, first hit wins; a .SRF is read only from the layer whose model
  of the same path (extension aside) was served, and not at all before that model was.
*/
export function layeredModels(layers: readonly Reader[]): Reader {
  const origin = new Map<string, number>();
  return async (path) => {
    if (isSrfPath(path)) {
      const at = origin.get(stemKey(path));
      return at === undefined ? null : layers[at]!(path);
    }
    for (let i = 0; i < layers.length; i++) {
      const bytes = await layers[i]!(path);
      if (bytes) { origin.set(stemKey(path), i); return bytes; }
    }
    return null;
  };
}

/** The .SRF beside the model at `modelPath` in the same pod (FindSurfaceSidecar for a library model). */
export async function sidecarInMount(mount: Mount, modelPath: string): Promise<Uint8Array | null> {
  const key = normalizePodPath(sidecarPath(modelPath));
  const e = mount.archive.entries.find((x) => x.normalizedName === key);
  return e ? mount.readEntry(e) : null;
}

/**
  The game library as a model reader (`<folder>\<path>`, then by title, as Traxx's MODELS folder
  is searched), whose .SRF comes only from the pod that served the model.
*/
export function libraryModels(vfs: () => Vfs, folder = "MODELS"): Reader {
  const origin = new Map<string, { mount: Mount; path: string }>();
  return async (path) => {
    if (isSrfPath(path)) {
      const from = origin.get(stemKey(path));
      return from ? sidecarInMount(from.mount, from.path) : null;
    }
    const v = vfs();
    const hit = v.find(`${folder}\\${path}`) ?? v.findByTitle(path);
    if (!hit) return null;
    origin.set(stemKey(path), { mount: hit.mount, path: hit.entry.name });
    return hit.mount.readEntry(hit.entry);
  };
}

/**
  The Models window's Load from disk: the browser has no folder to look beside a picked file
  in, so a .SRF picked with its .BIN (same file stem, any case) stands for the one beside it.
  Returns, for each picked name, the index of its sidecar among them, or -1.
*/
export function pairSidecars(names: readonly string[]): number[] {
  const srf = new Map<string, number>();
  names.forEach((n, i) => { if (isSrfPath(n)) srf.set(stemKey(n), i); });
  return names.map((n) => (isSrfPath(n) ? -1 : srf.get(stemKey(n)) ?? -1));
}

export interface SidecarModel { name: string; srf?: Uint8Array | null; podSurface?: boolean }

/** IsSurfaceMesh: a .SRF was found beside the model, or the pod it was read from carries one. */
export function isSurfaceMesh(m: SidecarModel | null | undefined): boolean {
  return Boolean(m && ((m.srf && m.srf.length > 0) || m.podSurface));
}

/** The Models window's label: the name, tagged "  (surface)" for a surface mesh (SetTrackPOD). */
export function modelLabel(m: SidecarModel | null | undefined, name: string): string {
  return isSurfaceMesh(m) ? `${name}  (surface)` : name;
}

/**
  CTrackPOD::Load's NotePodSurface: a model read out of a pod is a surface mesh when the pod
  also carries MODELS\<stem>.SRF. Display only; such a model still has no .SRF to pack.
*/
export function notePodSurfaces(models: SidecarModel[], entryNames: readonly string[]): void {
  const have = new Set(entryNames.map((n) => n.toUpperCase()));
  for (const m of models) m.podSurface = have.has(`MODELS\\${podModelStem(m.name)}.SRF`);
}

/**
  FindLostSurfaceSidecars: the MODELS\X.SRF entries of the pod about to be overwritten whose
  model X this track still packs but has no .SRF for, as Traxx lists them ("    <name>\n" each,
  in directory order). A model no longer packed takes its .SRF with it on purpose, and one
  whose sidecar is still there is carried again: only the gap in between is a loss.
*/
export function findLostSurfaceSidecars(oldEntryNames: readonly string[], packed: readonly SidecarModel[]): string[] {
  const lost: string[] = [];
  for (const item of oldEntryNames) {
    if (item.length < 5 || item.slice(0, 7).toUpperCase() !== "MODELS\\" || item.slice(-4).toUpperCase() !== ".SRF") continue;
    const stem = podModelStem(item);
    const same = packed.filter((m) => podModelStem(m.name) === stem);
    if (!same.length || same.some((m) => m.srf && m.srf.length > 0)) continue;
    lost.push(item);
  }
  return lost;
}

/** OnFileWritePOD's question when FindLostSurfaceSidecars finds any (MB_YESNO, No the default). */
export function lostSurfaceMessage(lost: readonly string[]): string {
  return "The pod being overwritten contains surface-mesh files (.SRF) that the new pod\n"
    + "will no longer carry - no .SRF was found beside these models:\n\n"
    + lost.map((n) => `    ${n}\n`).join("")
    + "\nTheir surface types (grip, skids, sound) would be lost.\n\nWrite the pod anyway?";
}

export const LOST_SURFACE_TITLE = "Surface meshes would be lost";
