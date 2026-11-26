/*
  Extract Models and Art and Edit This Track's copy (Traxx origin/main, spec 2026-11-22:
  TrackPOD/TrackPODFile.cpp CTrackPOD::ExtractArtAndModels, Pod1ReportLine). Every ART\ item of
  the pod goes to the ART folder and every MODELS\ item to the MODELS folder, and NOTHING is ever
  overwritten:

    - a file already there with the same bytes is left alone and not mentioned;
    - one with other bytes is left alone and its name listed ("<name>"), because a reopened .TXX
      and Write POD use the folder's copy; with `readConflicts` (Edit This Track) a .BIN one of
      this track's models was read from is not listed here but handed back in `modelConflicts`,
      to be read from the folder by the caller (ReloadModelFromSource) and listed then;
    - an HD source (.PNG / .TGA) is not written beside a .RAW or .ACT of its stem that is in the
      folder with other bytes than the pod's: "<name> (not copied: your <raw> differs)";
    - a name that could leave its folder, or a file that cannot be written: "<name> (could not write)".

  What a browser cannot do: Traxx gives every written file the pod's own write time
  (Pod1ExtractTime); OPFS keeps no settable file times, so the files carry the time of the copy.
*/

/** A pod entry to copy: its full name ("ART\\GRASS.RAW") and its bytes. */
export interface ExtractItem { name: string; read(): Promise<Uint8Array> }

/** The ART and MODELS folders, by folder ("ART" or "MODELS") and the path below it. */
export interface ExtractFolders {
  /** The file's bytes, or null when there is none; "dir" when a folder is in the way. */
  read(folder: "ART" | "MODELS", path: string): Promise<Uint8Array | null | "dir">;
  /** Write a new file; false when it could not be written. */
  write(folder: "ART" | "MODELS", path: string, bytes: Uint8Array): Promise<boolean>;
}

export interface ExtractResult {
  written: number;
  /** Pod1ReportLine's lines, in pod order (the model conflicts are the caller's to add). */
  report: string[];
  /** readConflicts: the MODELS\ items whose folder .BIN differs and one of the track's models was read from. */
  modelConflicts: string[];
  /** The MODELS\ items now in the folder with the pod's bytes (written, or already the same): NoteModelSource. */
  modelSources: string[];
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** PodSwapExt: the name with its extension swapped. */
function swapExt(name: string, ext: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > name.lastIndexOf("\\") ? `${name.slice(0, dot)}.${ext}` : null;
}

/** A name that could leave its folder (a ".." or a drive, a leading slash) is never made into a path. */
function unsafe(rest: string): boolean {
  return rest.includes("..") || rest.includes(":") || rest.startsWith("\\") || rest.startsWith("/");
}

/**
  CTrackPOD::ExtractArtAndModels. `isTrackModel(item)`: one of the track's models (or its
  backdrop) was read from this MODELS\ item (Pod1ModelIsItem).
*/
export async function extractArtAndModels(items: readonly ExtractItem[], folders: ExtractFolders, readConflicts: boolean, isTrackModel: (item: string) => boolean = () => false): Promise<ExtractResult> {
  const out: ExtractResult = { written: 0, report: [], modelConflicts: [], modelSources: [] };
  const split = (nm: string): ["ART" | "MODELS", string] | null => {
    const u = nm.toUpperCase();
    if (u.startsWith("ART\\")) return ["ART", nm.slice(4)];
    if (u.startsWith("MODELS\\")) return ["MODELS", nm.slice(7)];
    return null;
  };
  // HDPartnerConflicts: the folder holds a .RAW or .ACT of this HD source's stem with other bytes than the pod's.
  const hdPartnerConflict = async (hdItem: string): Promise<string | null> => {
    for (const ext of ["RAW", "ACT"]) {
      const want = swapExt(hdItem, ext);
      if (!want) continue;
      for (const j of items) {
        if (j.name.toUpperCase() !== want.toUpperCase() || !j.name.toUpperCase().startsWith("ART\\")) continue;
        const rest = j.name.slice(4);
        if (!rest || unsafe(rest)) continue;
        const theirs = await folders.read("ART", rest);
        if (!theirs || theirs === "dir") continue;
        if (!same(theirs, await j.read())) return rest;
      }
    }
    return null;
  };
  for (const item of items) {
    const where = split(item.name);
    if (!where) continue;
    const [folder, rest] = where;
    if (!rest) continue;   // the folder's own name
    let unwritable = unsafe(rest);
    let bytes: Uint8Array | null = null;
    if (!unwritable) {
      try { bytes = await item.read(); } catch { unwritable = true; }
    }
    if (!unwritable && bytes) {
      const there = await folders.read(folder, rest);
      if (there === "dir") unwritable = true;
      else if (there) {
        // Already there: the same bytes are fine and silent; other bytes are listed and left alone.
        if (!same(there, bytes)) {
          if (folder === "MODELS" && readConflicts && isTrackModel(item.name)) out.modelConflicts.push(item.name);
          else out.report.push(item.name);
        } else if (folder === "MODELS") out.modelSources.push(item.name);
        continue;
      } else {
        const ext = rest.slice(rest.lastIndexOf(".") + 1).toUpperCase();
        if (folder === "ART" && rest.includes(".") && (ext === "PNG" || ext === "TGA")) {
          const partner = await hdPartnerConflict(item.name);
          if (partner) { out.report.push(`${item.name} (not copied: your ${partner} differs)`); continue; }
        }
        if (await folders.write(folder, rest, bytes)) {
          out.written++;
          if (folder === "MODELS") out.modelSources.push(item.name);
        } else unwritable = true;
      }
    }
    if (unwritable) out.report.push(`${item.name} (could not write)`);
  }
  return out;
}

/** ReloadModelFromSource refused the folder's .BIN: its line. */
export const EXTRACT_UNREADABLE_TAIL = " (yours could not be read, so the pod's is kept, without its .SRF)";

/** ExtractConflictMessage (TraxxDoc.cpp): the first 20 lines, then "and N more". */
export function extractConflictMessage(lines: readonly string[]): string {
  const shown = lines.slice(0, 20);
  let text = shown.map((l) => `${l}\n`).join("");
  if (lines.length > shown.length) text += `and ${lines.length - shown.length} more`;
  return text;
}

/** OnEditExtract's report after the copy (Extract Components), or null with nothing listed. */
export function extractReportText(lines: readonly string[]): string | null {
  if (!lines.length) return null;
  return "These files were already in your folders with different contents. Write POD and a reopened .TXX will use your copies, not the pod's:\n" + extractConflictMessage(lines);
}
