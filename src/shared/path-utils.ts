import { normalizePodPath, podPathTitle } from "../vendor/openphotex/pod/paths.js";

/*
  Archive path keys come from OpenPhotex, which builds every entry's normalizedName and title
  with the same rules, so a lookup key is never spelled differently from what it is compared to.
*/
export const normalizeArchiveName = normalizePodPath;
export const archiveTitle = podPathTitle;

export function joinPath(...parts: (string | null | undefined | false)[]): string {
  return parts
    .filter((p): p is string => Boolean(p))
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

export function splitPath(value: string): string[] {
  return String(value ?? "").split("/").map((p) => p.trim()).filter(Boolean);
}

export function replaceExtension(name: string, extensionWithDot: string): string {
  const value = normalizeArchiveName(name);
  const dot = value.lastIndexOf(".");
  return (dot >= 0 ? value.slice(0, dot) : value) + extensionWithDot.toUpperCase();
}

export function basenameWithoutExtension(name: string): string {
  const title = archiveTitle(name);
  const dot = title.lastIndexOf(".");
  return dot >= 0 ? title.slice(0, dot) : title;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toUpperCase() : "";
}
