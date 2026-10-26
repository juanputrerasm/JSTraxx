/*
  How TrackPOD compares the names of loaded things (IsTextureLoaded, IsModelLoaded,
  IsSoundLoaded, FindModelTexture): upper case, and only the part after the FIRST backslash.
*/
export function afterFirstSlash(name: string): string {
  const upper = name.toUpperCase();
  const i = upper.indexOf("\\");
  return i >= 0 ? upper.slice(i + 1) : upper;
}

export function sameAsset(a: string, b: string): boolean {
  return afterFirstSlash(a) === afterFirstSlash(b);
}

export function findAsset<T extends { name: string } | null>(list: readonly T[], name: string): number {
  const key = afterFirstSlash(name);
  return list.findIndex((x) => x !== null && afterFirstSlash(x.name) === key);
}
