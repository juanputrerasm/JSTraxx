/*
  Clone TrackEd Track from a picked folder: the TrackEd folder itself or any folder above it.
  The fixture is a TrackEd folder on this machine (skipped when absent).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { rebased, trackedFolder } from "../src/worker/tracked-folder.ts";
import { cloneFromSit } from "../src/core/doc/clone.ts";

const ROOT = `${process.env.HOME}/Desktop/mtm64`;

/*
  What a folder picker hands over: every file, its path starting with the picked folder's
  name. `above` adds the folders a pick higher up would put first.
*/
function pick(folder: string, above: string[] = []): File[] {
  const out: File[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      const f = new File([readFileSync(full)], name);
      Object.defineProperty(f, "webkitRelativePath", { value: [...above, "mtm64", relative(folder, full)].join("/") });
      out.push(f);
    }
  };
  walk(folder);
  return out;
}

/* As the worker does: the .SIT under a WORLD folder at any depth, the folder above WORLD as the root. */
async function cloneFirst(files: File[]) {
  const folder = trackedFolder(files);
  const sit = [...folder.paths()].find((p) => /(^|\\)WORLD\\[^\\]+\.SIT$/.test(p));
  assert.ok(sit, "a WORLD\\*.SIT is found");
  const at = sit.lastIndexOf("WORLD\\");
  return cloneFromSit(rebased(folder, sit.slice(0, at)), sit.slice(at), { art: async () => null, model: async () => null });
}

test("a TrackEd folder clones whether it or a folder above it was picked", { skip: existsSync(join(ROOT, "WORLD")) ? false : "no TrackEd folder" }, async () => {
  for (const above of [[], ["Desktop"], ["Desktop", "Tracks"]]) {
    const doc = await cloneFirst(pick(ROOT, above));
    assert.ok(doc.track.trackName.length > 0);
    assert.ok(doc.track.heights.some((h) => h > 0), `terrain read with ${above.length} folder(s) above`);
  }
});
