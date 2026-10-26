/*
  What the Textures window's "Load >>" pane lists from an art folder (PreviewThread in
  Traxx/TraxxTexturesDlg.cpp). Three passes, .PNG then .TGA then .RAW:

    - an HD file is listed only when no <stem>.RAW is beside it, and never a map sibling
      (_N, _AO) or a terrain _DTL / _MASK (TexPreviewHDStandsAlone);
    - a .RAW only when it is 32, 64 or 256 square by its length (TexPreviewRawSide).

  The filter is the search pattern Traxx builds: empty is "*", text with a "*" is used as it
  is, anything else becomes "*text*"; then the extension.
*/
import { isAnyMapName, stemOf, swapExt } from "../traxx/pod-items.ts";

export interface ArtFile { name: string; size: number }
export interface ArtListing { stem: string; file: string; ext: "PNG" | "TGA" | "RAW" }

/** TexPreviewRawSide: the sizes the pane lists, narrower than what a load accepts. */
export function previewRawSide(size: number): number {
  return size === 1024 ? 32 : size === 4096 ? 64 : size === 65536 ? 256 : 0;
}

/** The pattern of BuildTexturePreviewSearchPath, without the folder. */
export function previewPattern(filter: string, ext: string): string {
  const f = filter.slice(0, 11);
  return `${!f ? "*" : f.includes("*") ? f : `*${f}*`}.${ext}`;
}

/** A Windows wildcard match: * any run, ? one character, case ignored. */
export function wildcardMatch(pattern: string, name: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
  return re.test(name);
}

export function listArtFolder(files: readonly ArtFile[], filter: string): ArtListing[] {
  const byName = new Map(files.map((f) => [f.name.toUpperCase(), f]));
  const out: ArtListing[] = [];
  const sorted = [...files].sort((a, b) => a.name.toUpperCase().localeCompare(b.name.toUpperCase()));
  for (const ext of ["PNG", "TGA", "RAW"] as const) {
    const pattern = previewPattern(filter, ext);
    for (const f of sorted) {
      if (!wildcardMatch(pattern, f.name)) continue;
      if (ext === "RAW") {
        if (!previewRawSide(f.size)) continue;
      } else {
        if (isAnyMapName(f.name)) continue;
        if (byName.has(swapExt(f.name, "RAW").toUpperCase())) continue;
      }
      out.push({ stem: stemOf(f.name).toUpperCase(), file: f.name, ext });
    }
  }
  return out;
}
