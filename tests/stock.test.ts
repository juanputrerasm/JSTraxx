/*
  Checks against a local MTM2 install, when one is present: point JSTRAXX_GAMES at a folder
  holding mtm2/*.POD (default ~/games). Each test skips itself when the folder is missing.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { readTraxxSit, writeTraxxSit } from "../src/core/traxx/sit.ts";

const GAMES = process.env.JSTRAXX_GAMES ?? join(process.env.HOME ?? "", "games");
const mtm2 = join(GAMES, "mtm2");
const skip = existsSync(mtm2) ? false : `no ${mtm2}`;

/*
  Traxx sets a SIT's fixed lines and number format on its first save, so the check is the
  second: a SIT written the Traxx way reads back to the same bytes. Every SIT in the folder
  counts, stock and added tracks alike.
*/
test("every MTM2 SIT, written the Traxx way, reads and writes back to the same bytes", { skip }, () => {
  let checked = 0;
  for (const name of readdirSync(mtm2).filter((n) => /\.pod$/i.test(n))) {
    const bytes = new Uint8Array(readFileSync(join(mtm2, name)));
    let pod;
    try { pod = parsePod(bytes); } catch { continue; }
    const names = new Set(pod.entries.map((e) => e.name.toUpperCase()));
    const titles = new Set(pod.entries.map((e) => e.title));
    const hasEntry = (n: string) => (n.includes("\\") ? names.has(n) : titles.has(n));
    for (const entry of pod.entries.filter((e) => /\.SI[T2]$/.test(e.title))) {
      const once = writeTraxxSit(readTraxxSit(readPodEntry(bytes, entry), entry.title, { hasEntry }));
      const twice = writeTraxxSit(readTraxxSit(once, entry.title, { hasEntry }));
      assert.deepEqual(twice, once, `${name}: ${entry.name}`);
      checked++;
    }
  }
  assert.ok(checked >= 15, `${checked} SITs`);
});
