import { JSTRAXX_VERSION } from "../src/core/version.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { writePod1 } from "../src/vendor/openphotex/pod/write.js";
import { seekToItem } from "../src/core/traxx/pod-items.ts";
import { openTxx } from "../src/core/doc/load-txx.ts";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { buildTrackPod } from "../src/core/traxx/pod-writer.ts";
import { checkIntegrity } from "../src/core/doc/integrity.ts";

/*
  The user's tracks, each written by Traxx from the .TXX beside it: opening the .TXX with its
  art and models from that POD and writing it again gives Traxx's POD back. The known
  differences are not ours: Traxx's model texture list still held the textures of backdrops
  tried earlier in that session (a .TXX does not keep them), and the Wastelands situation
  file was edited by hand to name a second backdrop, which Traxx cannot hold.
*/
const DESKTOP = process.env.JSTRAXX_TXX ?? join(process.env.HOME ?? "", "Desktop");
const CASES = [
  ["Alpine Challenge.txx", "ALPINECH.POD", /^ART\\(CC4DROP|CS4DROP1|EE4DROP|DD4DROP)\.(ACT|RAW)$/, []],
  ["Aztec Valley.txx", "AZVALLEY.POD", /^$/, []],
  ["Wastelands.txx", "WASTELND.POD", /^ART\\(CC4DROP|CS4DROP2)\.(ACT|RAW)$/, ["WORLD\\WASTELND2.SIT"]],
] as const;

for (const [txxName, podName, SESSION_LEFTOVERS, edited] of CASES) {
  test(`${txxName} writes the POD Traxx wrote`, { skip: !existsSync(join(DESKTOP, txxName)) && `no ${txxName}` }, async () => {
    const bytes = new Uint8Array(readFileSync(join(DESKTOP, podName)));
    const archive = parsePod(bytes);
    const byTitle = (folder: string) => async (path: string) => {
      const e = seekToItem(archive.entries, `${folder}\\${path}`) ?? seekToItem(archive.entries, path);
      return e ? readPodEntry(bytes, e) : null;
    };
    const doc = await openTxx(new Uint8Array(readFileSync(join(DESKTOP, txxName))), txxName, { art: byTitle("ART"), model: byTitle("MODELS") });
    const txv = new TextDecoder("latin1").decode(readPodEntry(bytes, archive.entries.find((e) => e.name.endsWith(".TXV"))!));
    const [, y, m, d] = /built=(\d+)-(\d+)-(\d+)/.exec(txv)!;
    const out = buildTrackPod(doc, { date: new Date(Number(y), Number(m) - 1, Number(d)) });
    const theirs = archive.entries.filter((e) => !SESSION_LEFTOVERS.test(e.name)).map((e) => e.name);
    assert.deepEqual(out.entries.map((e) => e.name), theirs);
    for (const e of archive.entries) {
      if (SESSION_LEFTOVERS.test(e.name) || (edited as readonly string[]).includes(e.name)) continue;
      const mine = out.entries.find((x) => x.name === e.name)!.data;
      // The version record names JSTraxx where Traxx named itself; everything else matches.
      const expected = e.name.endsWith(".TXV") ? new TextEncoder().encode(jstraxxStamp(txv)) : readPodEntry(bytes, e);
      assert.ok(Buffer.from(mine).equals(Buffer.from(expected)), `${e.name} differs`);
    }
    assert.equal(out.comment, archive.comment);
    assert.equal(out.omittedAny, false);
    const theirTxv = new Uint8Array(readPodEntry(bytes, archive.entries.find((e) => e.name.endsWith(".TXV"))!));
    const pod = writePod1(out.comment, out.entries.map((e) => (e.name.endsWith(".TXV") ? { ...e, data: theirTxv } : e)));
    // With nothing left over from Traxx's session, the whole file is Traxx's, directory and all.
    if (theirs.length === archive.entries.length && edited.length === 0) assert.ok(Buffer.from(pod).equals(Buffer.from(bytes)), "the POD file differs");
  });
}

/** Traxx's version record as JSTraxx writes it: the same, but stamped with JSTraxx. */
function jstraxxStamp(txv: string): string {
  return txv.replace("written by Traxx\r\n", "written by JSTraxx\r\n").replace(/tool=Traxx\r\ntoolVersion=[^\r]*\r\n/, `tool=JSTraxx\r\ntoolVersion=${JSTRAXX_VERSION}\r\n`);
}

test("a new track writes a POD, and the integrity check lists what it lacks", () => {
  const doc = newTrackDocument();
  const problems = checkIntegrity(doc);
  assert.ok(problems.includes("Track name not specified."));
  assert.ok(problems.includes("Checkpoints not specified."));
  const out = buildTrackPod(doc, { date: new Date(2026, 9, 26) });
  const names = out.entries.map((e) => e.name);
  assert.equal(names[0], `ART\\${doc.track.prefix}.ACT`);
  assert.ok(names.includes(`WORLD\\${doc.track.prefix}.SIT`));
  assert.ok(names.includes(`LEVELS\\${doc.track.prefix}.LVL`));
  const txv = new TextDecoder().decode(out.entries.find((e) => e.name.endsWith(".TXV"))!.data);
  assert.match(txv, /built=2026-10-26\r\nlegacyFallback=1\r\nhdTextures=0\r\n/);
  assert.ok(writePod1(out.comment, out.entries).length > 2_000_000);
});
