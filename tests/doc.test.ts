import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writePod1 } from "../src/vendor/openphotex/pod/write.js";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import type { PodEntry } from "../src/vendor/openphotex/pod/types.js";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { countTracks, loadPodTrack, situationKind } from "../src/core/doc/load-pod.ts";
import { openTxx } from "../src/core/doc/load-txx.ts";
import { writeTxx } from "../src/core/traxx/txx.ts";
import { seekToItem, swapExt, rawSide, resolveItemName } from "../src/core/traxx/pod-items.ts";
import { interpolateRawAtPoint, stemFromText, inferPrefixAuto, uiInfoName } from "../src/core/traxx/terrain.ts";
import { remapIndices, stockPalette, withSysColors, defaultFogMap, paletteIndexFromFogMap, applyMtm2Palette } from "../src/core/traxx/palette.ts";
import { traxxLines, atoi } from "../src/core/traxx/lines.ts";

const text = (s: string) => new TextEncoder().encode(s);
const entry = (name: string, length = 1) => ({ name, length }) as PodEntry;

test("a new track is Traxx's: TRAXX stem, stock palette 0, the default fog map and pictures", () => {
  const doc = newTrackDocument();
  const t = doc.track;
  assert.equal(t.prefix, "TRAXX");
  assert.equal(t.trackName, "new track");
  assert.equal(t.localeName, "Traxxville USA");
  assert.equal(t.versionFlags, 1);
  assert.equal(t.ambientSound, 14);
  assert.equal(t.weatherMask, 65535);
  assert.deepEqual(t.palette, withSysColors(stockPalette(0)));
  assert.equal(t.fogMap?.length, 32768);
  assert.equal(t.fogMap?.[0], 0);
  assert.ok(t.logoBmp && t.logoBmp[0] === 0x42 && t.logoBmp[1] === 0x4d, "a BMP");
  assert.ok(t.mapBmp && t.mapBmp[0] === 0x42);
  assert.ok(t.heights.every((h) => h === 100));
  assert.equal(t.lte?.[0], 0xed);
  assert.equal(t.lte?.[1], 0);
  assert.deepEqual(t.trucks.map((x) => x.name), ["powerbig.trk", "bigfoot.trk", "grave.trk", "boogey.trk", "wildfoot.trk", "bearfoot.trk", "snakebit.trk", "rampage.trk", "overkill.trk"]);
  assert.equal(doc.prefixAuto, true);
  assert.equal(doc.viewOnly, false);
});

test("the fog map's first byte picks the stock palette; 16 keeps the track's own", () => {
  assert.equal(paletteIndexFromFogMap(null), 0);
  assert.equal(paletteIndexFromFogMap(Uint8Array.of(17)), 0);
  const own = new Uint8Array(768).fill(7);
  const keep = applyMtm2Palette({ palette: own, fogMap: Uint8Array.of(16), logoBmp: Uint8Array.of(1), mapBmp: Uint8Array.of(2), logoHd: false, mapHd: false });
  assert.equal(keep.palette, own);
  const five = new Uint8Array(32768); five[0] = 5;
  const p = applyMtm2Palette({ palette: own, fogMap: five, logoBmp: null, mapBmp: null, logoHd: true, mapHd: false });
  assert.deepEqual(p.palette, withSysColors(stockPalette(5)));
  assert.equal(p.fogMap, five, "only index 0 brings in the default fog map");
  assert.equal(p.logoBmp, null, "no default picture over HD art");
  assert.ok(p.mapBmp);
  assert.deepEqual(applyMtm2Palette({ palette: own, fogMap: null, logoBmp: null, mapBmp: null, logoHd: false, mapHd: false }).fogMap, defaultFogMap());
});

test("SeekToItem: a full name matches whole names, a bare one matches past the first backslash", () => {
  const entries = [entry("ART\\GRASS.RAW"), entry("ROOT.RAW"), entry("ART\\SUB\\DIRT.RAW"), entry("ART\\EMPTY.RAW", 0)];
  assert.equal(seekToItem(entries, "art\\grass.raw")?.name, "ART\\GRASS.RAW");
  assert.equal(seekToItem(entries, "GRASS.RAW")?.name, "ART\\GRASS.RAW");
  assert.equal(seekToItem(entries, "ROOT.RAW"), null, "an entry in no folder is never found by a bare name");
  assert.equal(seekToItem(entries, "DIRT.RAW"), null);
  assert.equal(seekToItem(entries, "SUB\\DIRT.RAW"), null, "a name with a backslash is a full name");
  assert.equal(seekToItem(entries, "EMPTY.RAW"), null, "an empty entry is a miss");
  assert.equal(swapExt("ART\\A.B\\FOO", "RAW"), "ART\\A.B\\FOO.RAW");
  assert.equal(swapExt("FOO.PNG", "RAW"), "FOO.RAW");
  assert.deepEqual([rawSide(4096), rawSide(65536), rawSide(1024), rawSide(1000)], [64, 256, 32, 0]);
  assert.equal(resolveItemName([entry("ART\\SKIN.PNG")], "SKIN.RAW"), "SKIN.PNG");
  assert.equal(resolveItemName([entry("ART\\SKIN.RAW"), entry("ART\\SKIN.PNG")], "SKIN"), "SKIN.RAW");
});

test("READSTRING keeps blank lines and ends a line at its carriage return", () => {
  assert.deepEqual(traxxLines(text("3\r\nA.RAW\r\n\r\nB.RAW\rjunk\n")), ["3", "A.RAW", "", "B.RAW"]);
  assert.deepEqual([atoi(" 42x"), atoi("-7"), atoi("x"), atoi(undefined)], [42, -7, 0, 0]);
});

test("stems, prefix mode and the info picture name follow TrackPOD", () => {
  assert.equal(stemFromText("Arena 12 Deluxe!"), "ARENA12DELUXE");
  assert.equal(stemFromText("abcdefghijklmnopqrstuvwxyz"), "ABCDEFGHIJKLMNOPQR");
  assert.equal(inferPrefixAuto("Arena 12", "ARENA12"), true);
  assert.equal(inferPrefixAuto("Arena 12", "ARENA"), false);
  assert.equal(inferPrefixAuto("!!!", "ANY"), true);
  assert.equal(uiInfoName("ROANOKES.BMP"), "ROANOKEM.BMP");
  assert.equal(uiInfoName("HILLT.BMP"), "HILLM.BMP");
  assert.equal(uiInfoName("ODDL.BMP"), "");
});

test("InterpolateRawAtPoint splits cells along a checkerboard diagonal", () => {
  const raw = new Uint8Array(65536);
  raw[1] = 64; // corner (1,0) of cell (0,0)
  assert.equal(interpolateRawAtPoint(raw, 0, 0), 0);
  assert.equal(interpolateRawAtPoint(raw, 64, 0), 64);
  assert.equal(interpolateRawAtPoint(raw, 32, 0), 32);
  assert.equal(interpolateRawAtPoint(raw, 32, 16), 16, "cell (0,0) splits on x = y: its lower triangle is the plane through (0,0), (64,0) and (64,64)");
  assert.equal(interpolateRawAtPoint(raw, 16, 32), 0, "its upper triangle, through (64,64), (0,64) and (0,0), does not touch the raised corner");
  const ramp = new Uint8Array(65536).map((_, i) => i & 255);
  assert.equal(interpolateRawAtPoint(ramp, 10 * 64 + 32, 5 * 64 + 20), 10, "truncated");
  assert.equal(interpolateRawAtPoint(ramp, 255 * 64 + 10, 0), 255, "the last column reads its corner");
});

test("RemapTexture picks the nearest of the first 246 colours, first on ties", () => {
  const track = new Uint8Array(768);
  track.set([10, 10, 10], 0); track.set([200, 0, 0], 3); track.set([200, 0, 0], 6);
  track.set([0, 255, 0], 246 * 3); // past 245: never chosen
  const source = new Uint8Array(768);
  source.set([190, 5, 5], 3); source.set([0, 250, 0], 6);
  // Source 0 is black, and the track's first black is entry 3.
  assert.deepEqual([...remapIndices(Uint8Array.of(0, 1, 2), source, track)], [3, 1, 0]);
});

test("a POD's tracks are listed by name, with a warning for stems sharing 7 characters", async () => {
  const sit = (name: string) => text(`X.LVL\r\n!Race Track Name\r\n${name}\r\n`);
  const bytes = writePod1("pack", [
    { name: "WORLD\\LONGNAME1.SIT", data: sit("One") }, { name: "WORLD\\LONGNAME2.SI2", data: sit("Two") }, { name: "WORLD\\X.TXT", data: text("x") },
  ]);
  const archive = parsePod(bytes);
  const list = await countTracks({ archive, read: async (e) => readPodEntry(bytes, e) });
  assert.deepEqual(list.names, ["One", "Two"]);
  assert.deepEqual(list.stems, ["LONGNAME1", "LONGNAME2"]);
  assert.match(list.warning, /LONGNAME1.*LONGNAME2/);
  assert.equal(situationKind("WORLD\\A.B.SIT"), null, "the first dot decides");
  await assert.rejects(loadPodTrack({ archive, read: async (e) => readPodEntry(bytes, e) }, 5, "pack.pod"), /no track 6/);
});

const GAMES = process.env.JSTRAXX_GAMES ?? join(process.env.HOME ?? "", "games");
const mtm2 = join(GAMES, "mtm2");
const skip = existsSync(mtm2) ? false : `no ${mtm2}`;

/*
  Every MTM2 track opens out of its POD, saves as a .TXX, and reopens from that .TXX with its
  art and models found by name in the same POD, as Traxx finds them in its ART and MODELS
  folders after Extract Models and Art.
*/
test("every MTM2 track opens from its POD and reopens from a .TXX with the same content", { skip }, async () => {
  let checked = 0;
  for (const file of readdirSync(mtm2).filter((n) => /\.pod$/i.test(n))) {
    const bytes = new Uint8Array(readFileSync(join(mtm2, file)));
    let archive;
    try { archive = parsePod(bytes); } catch { continue; }
    const source = { archive, read: async (e: PodEntry) => readPodEntry(bytes, e) };
    const { names } = await countTracks(source);
    const byTitle = (folder: string) => async (path: string) => {
      const e = seekToItem(archive.entries, `${folder}\\${path}`) ?? seekToItem(archive.entries, path);
      return e ? readPodEntry(bytes, e) : null;
    };
    for (let i = 0; i < names.length; i++) {
      const pod = await loadPodTrack(source, i, file);
      assert.equal(pod.viewOnly, true);
      assert.equal(pod.missingTextures.length, 0, `${file}#${i}: ${pod.missingTextures.join(", ")}`);
      const txx = await openTxx(writeTxx(pod.track), "t.txx", { art: byTitle("ART"), model: byTitle("MODELS") });
      const a = pod.track, b = txx.track;
      assert.deepEqual(b.heights, a.heights, `${file}#${i} heights`);
      assert.deepEqual(b.clr, a.clr, `${file}#${i} clr`);
      assert.deepEqual(b.textures.map((t) => t.name), a.textures.map((t) => t.name || "ERROR"), `${file}#${i} textures`);
      assert.equal(b.boxes.length, a.boxes.length);
      assert.deepEqual(b.groundBoxes, a.groundBoxes);
      assert.deepEqual(b.course, a.course);
      assert.deepEqual(b.animations, a.animations);
      const tile = (t: typeof pod.textures[number]) => `${t?.side ?? 64}:${t?.hd?.ext ?? ""}`;
      assert.deepEqual(txx.textures.map(tile), pod.textures.map(tile), `${file}#${i} tiles`);
      assert.deepEqual(txx.textures.map((t) => t?.bad ?? true), pod.textures.map((t) => !t), `${file}#${i} bad tiles`);
      assert.deepEqual(txx.missingModels, [], `${file}#${i} models`);
      checked++;
    }
  }
  assert.ok(checked >= 1);
});

test("a clone's stem takes its number out of the stem's own 20 characters", async () => {
  const { pickCloneStem } = await import("../src/core/doc/clone.ts");
  assert.equal(pickCloneStem("ALASKA", () => false), "ALASKA2");
  assert.equal(pickCloneStem("ALASKA", (s) => s === "ALASKA2" || s === "ALASKA3"), "ALASKA4");
  assert.equal(pickCloneStem("ALPINEVALLEYNORTHXY2", (s) => s === "ALPINEVALLEYNORTHXY2"), "ALPINEVALLEYNORTHXY3", "a source ending in 2 does not clone onto itself");
  assert.equal(pickCloneStem("X", () => true), null);
});

/* Each stock POD laid out as a TrackEd folder (its entries by path), then every track cloned from it. */
test("every MTM2 track clones from a TrackEd folder as Traxx clones it", { skip }, async () => {
  const { cloneFromSit } = await import("../src/core/doc/clone.ts");
  let checked = 0;
  for (const file of readdirSync(mtm2).filter((n) => /\.pod$/i.test(n))) {
    const bytes = new Uint8Array(readFileSync(join(mtm2, file)));
    let archive;
    try { archive = parsePod(bytes); } catch { continue; }
    const files = new Map(archive.entries.map((e) => [e.normalizedName.replace(/\//g, "\\"), e]));
    const folder = {
      read: async (p: string) => { const e = files.get(p.toUpperCase()); return e ? readPodEntry(bytes, e) : null; },
      has: (p: string) => files.has(p.toUpperCase()),
    };
    const assets = { art: (p: string) => folder.read(`ART\\${p}`), model: (p: string) => folder.read(`MODELS\\${p}`) };
    const source = { archive, read: async (e: PodEntry) => readPodEntry(bytes, e) };
    for (const sit of archive.entries.filter((e) => situationKind(e.name) === "sit")) {
      const index = archive.entries.filter((e) => situationKind(e.name)).indexOf(sit);
      const pod = await loadPodTrack(source, index, file);
      const clone = await cloneFromSit(folder, sit.normalizedName.replace(/\//g, "\\"), assets);
      const a = pod.track, b = clone.track;
      assert.match(b.prefix, /\d+$/);
      assert.ok(b.prefix.startsWith(a.prefix.slice(0, b.prefix.replace(/\d+$/, "").length)), b.prefix);
      assert.ok(!folder.has(`WORLD\\${b.prefix}.SIT`) && !folder.has(`LEVELS\\${b.prefix}.LVL`), `${b.prefix} is free`);
      assert.equal(b.trackName, a.trackName.length < 31 ? `${a.trackName}2` : `${a.trackName.slice(0, 30)}2`);
      assert.equal(b.versionFlags & 1, 1);
      assert.equal(b.logoBmpName, "");
      assert.equal(b.backdropName, "");
      assert.equal(b.arena, null);
      assert.deepEqual(b.heights, a.heights);
      assert.deepEqual(b.clr, a.clr);
      assert.deepEqual(b.groundBoxes, a.groundBoxes);
      assert.equal(b.boxes.length, a.boxes.length);
      assert.deepEqual(b.course, a.course);
      assert.ok(b.textures.length >= a.textures.length - a.animations.length * 8);
      assert.equal(clone.missingTextures.length, 0, `${file}: ${clone.missingTextures.slice(0, 3)}`);
      checked++;
    }
  }
  assert.ok(checked >= 1);
});

test("an imported track keeps its own palette when its .TXX reopens", async () => {
  const { markCustomPalette, traxxFogMap } = await import("../src/core/traxx/palette.ts");
  const own = withSysColors(new Uint8Array(768).map((_, i) => (i * 7) & 255));
  const track = { palette: own, fogMap: new Uint8Array(32768) as Uint8Array | null };
  markCustomPalette(track);
  assert.equal(track.fogMap![0], 16);
  assert.equal(applyMtm2Palette({ palette: own, fogMap: track.fogMap, logoBmp: null, mapBmp: null, logoHd: false, mapHd: false }).palette, own);
  const built = traxxFogMap(own, 16);
  assert.equal(built.length, 32768);
  assert.equal(built[0], 16);
  assert.ok(built.slice(1).every((v) => v >= 10 && v < 230));
});
