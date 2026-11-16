/*
  The read-only lookup into the game's art (Traxx 1.8.0, b6d56f2: Traxx/GamePods.h / GamePods.cpp,
  themselves a port of cursh2 core\podmain.cpp CTruckPod::mountDefaultPodFiles, engine\pod.cpp
  CPod::validatePodFile / mountPodVolume / podFindEntry / podOpen, engine\DOSIO.cpp dosFileLength
  and core\Global.cpp).

  THE RULE, as the engine has it: the pods are mounted in <game>\pod.ini order (a count, then that
  many whitespace-separated names read with %79s), or with no pod.ini system\startup.pod,
  system\truck.pod, system\game.pod, system\ui.pod; a lookup of <dir>\<name> upper-cases the key
  and walks the pods in mount order, the lowest entry index inside a pod winning; entry names are
  cut at 31 characters at mount time, so a key of 32 or more never matches; only when no pod has
  it does the engine try the loose file.

  What applies in JSTraxx: there is no game folder. The game library is a list of PODs mounted
  in the order the author set (Options > Folders), read through the VFS (core/vfs.ts: first mount
  wins, the lowest entry index inside a mount wins, case and slash direction ignored), from the
  page through the asset worker's "vfs.read" { path }. So this file keeps the parts that are
  rules rather than file-system plumbing:

    - the key the engine searches for (GamePodsKey, both the dosFileLength and the dopen rule,
      and GamePodsFind's 32-character refusal);
    - the pod.ini mount list (GamePodsReadList), for a library built from an install's pod.ini;
    - a per-generation cache over an injected `read(path)` (GamePodsLength / GamePodsRead /
      GamePodsInvalidate / GamePodsGeneration), so a frame never asks the worker twice.

  Not ported (no counterpart in a browser library): the folder itself and its existence check,
  loose files, the two-second change stamp and the watch list (a library change is an explicit
  event: call invalidate()), the shared read-only Win32 open, the per-pod validation and the
  skipped-pod count (the library mounts or refuses a POD when it is added), and "the winning copy
  is unreadable, do not fall through" (a mounted POD's entry is in memory or OPFS).
*/

/** The engine's MAX_POD_FILE_LIST is 500 and mountPodVolume refuses the 500th, so 499 can mount. */
export const GAMEPODS_MAX_MOUNTED = 499;

/** core\Global.cpp, the WIN build: the pods mounted when there is no pod.ini. */
export const GAMEPODS_DEFAULT_PODS: readonly string[] = ["system\\startup.pod", "system\\truck.pod", "system\\game.pod", "system\\ui.pod"];

/** An entry name is a char[32], the 32nd forced to 0 at mount: a key this long never matches. */
const GAMEPODS_KEY_MAX = 32;

/** Reads one path through the game library: its bytes, or null when no mounted POD has it. */
export type PodRead = (path: string) => Promise<Uint8Array | null>;

/**
  GamePodsKey: the upper-cased key the engine searches for. `dosRule` true is dosFileLength's
  rule (a name holding a backslash is taken whole), false is CPod::dopen's (a non-empty directory
  is always prefixed). null for an empty name, or (GamePodsFind) a key of 32 characters or more,
  which no mounted entry can equal.
*/
export function gamePodKey(dir: string | null | undefined, name: string | null | undefined, dosRule: boolean): string | null {
  if (!name) return null;
  const key = dir && (!dosRule || !name.includes("\\")) ? `${dir}\\${name}` : name;
  if (key.length >= GAMEPODS_KEY_MAX) return null;
  return key.toUpperCase();
}

/**
  GamePodsReadList: the pods the engine mounts, in order, from the text of <game>\pod.ini, or the
  four defaults when there is none (podIni null). `overLimit` counts the names past
  GAMEPODS_MAX_MOUNTED (the engine refuses to start; Traxx skips them). A count that does not read
  gives an empty list; a list shorter than its count stops where the names run out; names past
  the count are ignored. Each name is cut to 79 characters (%79s).
*/
export function gamePodsMountList(podIni: string | null): { names: string[]; haveIni: boolean; overLimit: number } {
  if (podIni === null) return { names: [...GAMEPODS_DEFAULT_PODS], haveIni: false, overLimit: 0 };
  const tokens = podIni.split(/[ \t\r\n\f\v]+/).filter((t) => t.length > 0);
  const names: string[] = [];
  let overLimit = 0;
  // fscanf("%d"): an optional sign and digits at the start of the first token.
  const m = /^[+-]?\d+/.exec(tokens[0] ?? "");
  if (!m) return { names, haveIni: true, overLimit };
  // %d stops at the first non-digit; anything after it in the same token is the next %79s read.
  const rest = tokens[0]!.slice(m[0].length);
  const list = rest ? [rest, ...tokens.slice(1)] : tokens.slice(1);
  const n = Number.parseInt(m[0], 10);
  for (let i = 0; i < n && i < list.length; i++) {
    if (names.length >= GAMEPODS_MAX_MOUNTED) {
      overLimit++;
      continue;
    }
    names.push(list[i]!.slice(0, 79));
  }
  return { names, haveIni: true, overLimit };
}

/** The game library as the sky and the light glows ask it (GamePodsLength / GamePodsRead). */
export interface GamePods {
  /** dosFileLength: the length of <dir>\<name> (dir may be "" or null), -1 when nowhere; a zero-length entry answers 0. */
  length(dir: string | null, name: string): Promise<number>;
  /** dopen + read: the bytes of <dir>\<name> from the first POD that has it, else null. */
  read(dir: string | null, name: string): Promise<Uint8Array | null>;
  /** Bumped by every invalidate(), so callers can key their own caches on it (GamePodsGeneration). */
  readonly generation: number;
  /** Forget the cache (GamePodsInvalidate): call when the library's PODs or their order change. */
  invalidate(): void;
  /** False when no POD is mounted at all (GamePodsCount() == 0). */
  readonly mounted: boolean;
}

/**
  The cache over `read`: each key is asked of the library once per generation, and its bytes kept
  (sky art is a few hundred KB at most). `mounted` is the library's own answer, given by the
  caller (the VFS's mount count > 0); it defaults to true.
*/
export function createGamePods(read: PodRead, mounted: () => boolean = () => true): GamePods {
  let generation = 1;
  let cache = new Map<string, Promise<Uint8Array | null>>();

  const fetch = (key: string): Promise<Uint8Array | null> => {
    let p = cache.get(key);
    if (!p) {
      p = read(key).catch(() => null);
      cache.set(key, p);
    }
    return p;
  };

  return {
    async length(dir, name) {
      const key = gamePodKey(dir, name, true);
      if (key === null) return -1;
      const bytes = await fetch(key);
      return bytes ? bytes.length : -1;
    },
    async read(dir, name) {
      const key = gamePodKey(dir, name, false);
      if (key === null) return null;
      return fetch(key);
    },
    get generation() {
      return generation;
    },
    invalidate() {
      cache = new Map();
      generation++;
    },
    get mounted() {
      return mounted();
    },
  };
}
