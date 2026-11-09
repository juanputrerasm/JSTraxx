import test from "node:test";
import assert from "node:assert/strict";
import { pickStored, summarizeStore, type StoredFile } from "../src/core/storage.ts";

const files: StoredFile[] = [
  { folder: "art", path: "VPMPOST.PNG", size: 100 },
  { folder: "art", path: "VPMPOST.RAW", size: 65536 },
  { folder: "art", path: "SUB/GRASS.RAW", size: 4096 },
  { folder: "models", path: "VPMPOST.BIN", size: 6288 },
  { folder: "models", path: "TREE1.BIN", size: 900 },
];

test("the summary counts each folder", () => {
  assert.deepEqual(summarizeStore(files), { art: { files: 3, bytes: 69732 }, models: { files: 2, bytes: 7188 } });
});

test("an empty filter picks every file of the chosen folders", () => {
  assert.equal(pickStored(files, ["art", "models"], "").length, 5);
  assert.deepEqual(pickStored(files, ["models"], " ").map((f) => f.path), ["VPMPOST.BIN", "TREE1.BIN"]);
});

test("plain text matches anywhere in the title, a wildcard as written, case ignored", () => {
  assert.deepEqual(pickStored(files, ["art", "models"], "vpm").map((f) => f.path), ["VPMPOST.PNG", "VPMPOST.RAW", "VPMPOST.BIN"]);
  assert.deepEqual(pickStored(files, ["art", "models"], "VPM*.BIN").map((f) => f.path), ["VPMPOST.BIN"]);
  assert.deepEqual(pickStored(files, ["art"], "GRASS*").map((f) => f.path), ["SUB/GRASS.RAW"]);
  assert.deepEqual(pickStored(files, [], "*"), []);
});
