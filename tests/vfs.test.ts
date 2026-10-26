import test from "node:test";
import assert from "node:assert/strict";
import { writePod1 } from "../src/vendor/openphotex/pod/write.js";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { createVfs, type Mount } from "../src/core/vfs.ts";

const text = (s: string) => new TextEncoder().encode(s);

function mount(name: string, files: Record<string, string>): Mount {
  const bytes = writePod1(name, Object.entries(files).map(([n, d]) => ({ name: n, data: text(d) })));
  const archive = parsePod(bytes);
  return { name, archive, readEntry: async (e) => readPodEntry(bytes, e) };
}

const a = mount("A.POD", { "ART\\GRASS.RAW": "a-grass", "WORLD\\TRACK.SIT": "a-sit" });
const b = mount("B.POD", { "art\\grass.raw": "b-grass", "ART\\DIRT.RAW": "b-dirt", "MODELS\\TREE.BIN": "b-tree" });

test("the first mount with a path wins, ignoring case and slash direction", async () => {
  const vfs = createVfs([a, b]);
  assert.equal(new TextDecoder().decode((await vfs.read("art/Grass.raw"))!), "a-grass");
  assert.equal(new TextDecoder().decode((await vfs.read("ART\\DIRT.RAW"))!), "b-dirt");
  assert.equal(await vfs.read("ART/NONE.RAW"), null);
  assert.equal(vfs.find("art/grass.raw")?.mount.name, "A.POD");
});

test("preferMount puts one archive ahead of the rest", async () => {
  const vfs = createVfs([a, b]).preferMount("B.POD");
  assert.equal(vfs.find("ART/GRASS.RAW")?.mount.name, "B.POD");
  assert.deepEqual(vfs.mounts.map((m) => m.name), ["B.POD", "A.POD"]);
});

test("findByTitle resolves a bare file name in any folder", async () => {
  const vfs = createVfs([a, b]);
  assert.equal(vfs.findByTitle("tree.bin")?.path, "MODELS/TREE.BIN");
  assert.equal(vfs.findByTitle("SOMEDIR\\GRASS.RAW")?.mount.name, "A.POD");
  assert.equal(vfs.findByTitle("NOPE.BIN"), null);
});

test("list returns each visible path once, from the mount that wins it", () => {
  const vfs = createVfs([a, b]);
  const raws = vfs.list(".raw").map((h) => `${h.mount.name}:${h.path}`);
  assert.deepEqual(raws, ["A.POD:ART/GRASS.RAW", "B.POD:ART/DIRT.RAW"]);
});
