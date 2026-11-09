/*
  Traxx 1.7's dialog changes (commit e4b4cd5: MP3 and OGG Vorbis music in Track Components,
  resizable Stock Music, Transitions and Patterns) and the .SRF surface-mesh sidecars (commit
  53b432c: FindSurfaceSidecar, NotePodSurface, FindLostSurfaceSidecars) for models loaded by the
  Clone path and the Models window.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { writePod1 } from "../src/vendor/openphotex/pod/write.js";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { createVfs, type Mount } from "../src/core/vfs.ts";
import {
  musicAccept, musicLoadRefusal, musicLoadTitle, musicMime, musicSaveAs, stockMusicPick, stockMusicSelName,
} from "../src/core/doc/components.ts";
import { fitThumbnail, openingSize, sample64, squareSide } from "../src/core/ui-layout.ts";
import {
  findLostSurfaceSidecars, isSurfaceMesh, layeredModels, libraryModels, lostSurfaceMessage, modelLabel,
  notePodSurfaces, pairSidecars, podModelStem, sidecarInMount, sidecarPath,
} from "../src/core/doc/surface-sidecar.ts";
import { cloneAssetSource, type TrackedFolder } from "../src/core/doc/clone.ts";
import type { AssetSource } from "../src/core/doc/load-txx.ts";

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const b = (...v: number[]) => Uint8Array.from(v);
const text = (u: Uint8Array | null) => (u ? new TextDecoder().decode(u) : null);

// ---- Music.

test("OnMusicLoad: MTM2 takes WAV, MP3 and OGG Vorbis by their bytes; MTM1 takes MOD only", () => {
  assert.equal(musicAccept(true), ".wav,.mp3,.ogg");
  assert.equal(musicAccept(false), ".mod");
  assert.equal(musicLoadTitle(true), "Load music (WAV, MP3 or OGG)");
  assert.equal(musicLoadTitle(false), "Load music MOD file");
  assert.equal(musicLoadRefusal(new Uint8Array(0), true), "The music file is empty.");
  assert.equal(musicLoadRefusal(ascii("RIFF....WAVE"), true), null);
  assert.equal(musicLoadRefusal(ascii("ID3\x04...."), true), null);
  assert.equal(musicLoadRefusal(b(0xff, 0xfb, 0x90, 0), true), null);
  // A MOD renamed .mp3 is still a MOD: refused for MTM2.
  assert.equal(musicLoadRefusal(ascii("song title here....."), true), "That file is not a WAV, MP3 or OGG Vorbis file.");
  // A stock pick's text is not a file to load either.
  assert.equal(musicLoadRefusal(ascii("MUSIC\\BREAK.WAV"), true), "That file is not a WAV, MP3 or OGG Vorbis file.");
  assert.equal(musicLoadRefusal(ascii("song title here....."), false), null);
  assert.match(musicLoadRefusal(ascii("RIFF...."), false)!, /^The original game only plays MOD music\.  Tick the MTM2-only box/);
});

test("OnMusicLoad: an Ogg must hold Vorbis, its identification header within the first 96 bytes", () => {
  const page = (codec: string, at: number) => { const o = new Uint8Array(120); o.set(ascii("OggS")); o.set(ascii(codec), at); return o; };
  assert.equal(musicLoadRefusal(page("\x01vorbis", 28), true), null);
  assert.equal(musicLoadRefusal(page("\x01vorbis", 89), true), null, "found anywhere it starts before byte 96");
  assert.match(musicLoadRefusal(page("OpusHead", 28), true)!, /does not hold Vorbis audio \(Opus and FLAC are not supported\)/);
  assert.match(musicLoadRefusal(page("\x01vorbis", 100), true)!, /does not hold Vorbis/);
});

test("OnMusicSaveAs follows the kind; a stock pick has no file to save", () => {
  assert.deepEqual(musicSaveAs(ascii("RIFF....")), { ext: "wav" });
  assert.deepEqual(musicSaveAs(ascii("ID3....")), { ext: "mp3" });
  assert.deepEqual(musicSaveAs(ascii("OggS....")), { ext: "ogg" });
  assert.deepEqual(musicSaveAs(ascii("a mod title")), { ext: "mod" });
  assert.deepEqual(musicSaveAs(ascii("MUSIC\\SURF.WAV")), { message: "This is one of the game's own music tracks, so there is no file to save." });
  assert.equal(musicMime(ascii("OggS....")), "audio/ogg");
  assert.equal(musicMime(ascii("ID3....")), "audio/mpeg");
  assert.equal(musicMime(ascii("a mod title")), null);
});

test("OnMusicSel: the list starts on the stock pick, else BREAK; OK stores MUSIC\\<NAME>.WAV in 20 bytes", () => {
  assert.equal(stockMusicSelName(null), "BREAK");
  assert.equal(stockMusicSelName(ascii("RIFF....")), "BREAK");
  const pick = stockMusicPick("VOODOO");
  assert.equal(pick.length, 20);
  assert.equal(text(pick.subarray(0, 16)), "MUSIC\\VOODOO.WAV");
  assert.equal(pick[16], 0);
  assert.equal(stockMusicSelName(pick), "VOODOO");
});

// ---- Resizable windows.

test("OnInitDialog: a remembered size wins only when at least the template; never past the screen", () => {
  const min = { w: 360, h: 240 }, first = { w: 530, h: 410 }, screen = { w: 1920, h: 1080 };
  assert.deepEqual(openingSize(undefined, min, first, screen), first);
  assert.deepEqual(openingSize({ w: 700, h: 500 }, min, first, screen), { w: 700, h: 500 });
  assert.deepEqual(openingSize({ w: 300, h: 500 }, min, first, screen), first, "narrower than the template: stale");
  assert.deepEqual(openingSize({ w: 4000, h: 3000 }, min, first, screen), { w: 1920, h: 1080 });
  assert.deepEqual(openingSize(undefined, min, first, { w: 320, h: 200 }), { w: 320, h: 200 });
});

test("DisplayThumbnail keeps the aspect whatever shape the display is", () => {
  assert.deepEqual(fitThumbnail(64, 32, 208, 184), { w: 208, h: 104 });
  assert.deepEqual(fitThumbnail(32, 64, 208, 184), { w: 92, h: 184 });
  // A wide thumbnail in a tall-and-narrow display used to overflow (width-first by the thumbnail's shape alone).
  assert.deepEqual(fitThumbnail(64, 48, 100, 400), { w: 100, h: 75 });
  // A tall one in a very wide display.
  assert.deepEqual(fitThumbnail(48, 64, 400, 100), { w: 75, h: 100 });
  assert.equal(fitThumbnail(0, 10, 100, 100), null);
});

test("DrawGridImage samples any texture size down or up to 64 x 64", () => {
  assert.equal(sample64(64, 64, 5, 7), 5 + 64 * 7);
  assert.equal(sample64(256, 256, 1, 1), 4 + 256 * 4, "every fourth texel of a 256 tile, as before");
  assert.equal(sample64(32, 32, 63, 63), 31 + 32 * 31, "a 32 tile is sampled up, never past its end");
  assert.equal(sample64(128, 64, 63, 63), 126 + 128 * 63, "non-square");
  for (const [w, h] of [[1, 1], [16, 48], [512, 256]]) assert.ok(sample64(w, h, 63, 63) < w * h);
  assert.equal(squareSide(300, 200), 200);
});

// ---- Surface meshes.

function mount(name: string, files: Record<string, string>): Mount {
  const bytes = writePod1(name, Object.entries(files).map(([n, d]) => ({ name: n, data: ascii(d) })));
  const archive = parsePod(bytes);
  return { name, archive, readEntry: async (e) => readPodEntry(bytes, e) };
}

test("FindSurfaceSidecar's name and PodModelStem", () => {
  assert.equal(sidecarPath("SUB\\TREE.BIN"), "SUB\\TREE.SRF");
  assert.equal(sidecarPath("dir.v2/tree"), "dir.v2/tree.SRF", "a dot in a folder is not the extension");
  assert.equal(podModelStem("MODELS\\Foo.BIN"), "FOO");
  assert.equal(podModelStem("foo.bin"), "FOO");
  assert.equal(podModelStem("MODELS\\Foo"), "FOO");
});

test("a .SRF comes only from the layer that served its model (TrackEd folder, MODELS folder or library)", async () => {
  const folder: Record<string, string> = { "TREE.BIN": "folder-tree", "TREE.SRF": "folder-srf", "ROCK.BIN": "folder-rock" };
  const store: Record<string, string> = { "ROCK.SRF": "store-rock-srf", "HUT.BIN": "store-hut", "HUT.SRF": "store-hut-srf" };
  const reader = (files: Record<string, string>) => async (p: string) => (p.toUpperCase() in files ? ascii(files[p.toUpperCase()]!) : null);
  const models = layeredModels([reader(folder), reader(store)]);
  assert.equal(await models("TREE.SRF"), null, "no model served yet: no sidecar");
  assert.equal(text(await models("TREE.BIN")), "folder-tree");
  assert.equal(text(await models("TREE.SRF")), "folder-srf");
  assert.equal(text(await models("ROCK.BIN")), "folder-rock");
  assert.equal(await models("ROCK.srf"), null, "ROCK came from the folder, which has no .SRF: the store's is another file's");
  assert.equal(text(await models("hut.bin")), "store-hut");
  assert.equal(text(await models("HUT.SRF")), "store-hut-srf");
});

test("a library model's .SRF is the one in its own pod", async () => {
  const a = mount("A.POD", { "MODELS\\TREE.BIN": "a-tree" });
  const c = mount("C.POD", { "MODELS\\TREE.BIN": "c-tree", "MODELS\\TREE.SRF": "c-srf", "MODELS\\BUSH.BIN": "c-bush", "MODELS\\BUSH.SRF": "c-bush-srf" });
  const vfs = createVfs([a, c]);
  const models = libraryModels(() => vfs);
  assert.equal(text(await models("TREE.BIN")), "a-tree");
  assert.equal(await models("TREE.SRF"), null, "A.POD has no TREE.SRF; C.POD's belongs to another TREE.BIN");
  assert.equal(text(await models("BUSH.BIN")), "c-bush");
  assert.equal(text(await models("BUSH.SRF")), "c-bush-srf");
  assert.equal(text(await sidecarInMount(c, "MODELS\\TREE.BIN")), "c-srf");
  assert.equal(await sidecarInMount(a, "MODELS\\TREE.BIN"), null);
});

test("Clone: a cloned model keeps the .SRF beside the .BIN it was read from", async () => {
  const files: Record<string, string> = { "MODELS\\TREE.BIN": "tracked-tree", "MODELS\\TREE.SRF": "tracked-srf", "MODELS\\ROCK.BIN": "tracked-rock" };
  const folder: TrackedFolder = {
    read: async (p) => (p.toUpperCase() in files ? ascii(files[p.toUpperCase()]!) : null),
    has: (p) => p.toUpperCase() in files,
  };
  const lib = layeredModels([async (p) => (p.toUpperCase() === "ROCK.SRF" ? ascii("lib-rock-srf") : p.toUpperCase() === "HUT.BIN" ? ascii("lib-hut") : p.toUpperCase() === "HUT.SRF" ? ascii("lib-hut-srf") : null)]);
  const library: AssetSource = { art: async () => null, model: lib };
  const assets = cloneAssetSource(folder, library);
  assert.equal(text(await assets.model("TREE.BIN")), "tracked-tree");
  assert.equal(text(await assets.model("TREE.SRF")), "tracked-srf");
  assert.equal(text(await assets.model("ROCK.BIN")), "tracked-rock");
  assert.equal(await assets.model("ROCK.SRF"), null);
  assert.equal(text(await assets.model("HUT.BIN")), "lib-hut");
  assert.equal(text(await assets.model("HUT.SRF")), "lib-hut-srf");
});

test("Load from disk: a .SRF picked with its .BIN pairs by stem", () => {
  assert.deepEqual(pairSidecars(["tree.bin", "TREE.SRF", "rock.bin", "hut.srf"]), [1, -1, -1, -1]);
});

test("the (surface) tag: a .SRF beside the source, or one in the pod the model was read from", () => {
  const models: { name: string; srf?: Uint8Array | null; podSurface?: boolean }[] = [{ name: "MODELS\\TREE.BIN" }, { name: "MODELS\\ROCK.BIN" }, { name: "MODELS\\HUT.BIN", srf: ascii("x") }];
  notePodSurfaces(models, ["MODELS\\TREE.BIN", "models\\tree.srf", "MODELS\\ROCK.BIN"]);
  assert.deepEqual(models.map((m) => isSurfaceMesh(m)), [true, false, true]);
  assert.equal(modelLabel(models[0], "MODELS\\TREE.BIN"), "MODELS\\TREE.BIN  (surface)");
  assert.equal(modelLabel(models[1], "MODELS\\ROCK.BIN"), "MODELS\\ROCK.BIN");
});

test("FindLostSurfaceSidecars: only a model still packed with no .SRF now loses one", () => {
  const old = ["MODELS\\TREE.BIN", "MODELS\\TREE.SRF", "MODELS\\GONE.SRF", "MODELS\\HUT.SRF", "ART\\X.SRF", "MODELS\\ROCK.SRF"];
  const packed = [{ name: "MODELS\\TREE.BIN" }, { name: "MODELS\\HUT.BIN", srf: ascii("srf") }, { name: "MODELS\\ROCK.BIN", podSurface: true }];
  const lost = findLostSurfaceSidecars(old, packed);
  assert.deepEqual(lost, ["MODELS\\TREE.SRF", "MODELS\\ROCK.SRF"], "a model read out of a pod has no .SRF to carry");
  assert.equal(lostSurfaceMessage(lost),
    "The pod being overwritten contains surface-mesh files (.SRF) that the new pod\nwill no longer carry - no .SRF was found beside these models:\n\n    MODELS\\TREE.SRF\n    MODELS\\ROCK.SRF\n\nTheir surface types (grip, skids, sound) would be lost.\n\nWrite the pod anyway?");
});
