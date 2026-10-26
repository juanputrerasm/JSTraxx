/*
  Traxx's pattern and palette files, laid out by hand as Traxx writes them.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readTxp, TxpError, writeTxp } from "../src/core/traxx/txp.ts";
import { readActFile, readPalFile, writeActFile, writePalFile } from "../src/core/traxx/palette-file.ts";

function txpFixture(): Uint8Array {
  const out: number[] = [];
  const u8 = (v: number) => out.push(v & 0xff);
  const u16 = (v: number) => { u8(v); u8(v >> 8); };
  const i32 = (v: number) => { u8(v); u8(v >> 8); u8(v >> 16); u8(v >> 24); };
  const raw = (s: string) => { for (const c of s) u8(c.charCodeAt(0)); };
  raw("TXPH1"); u16(1);
  raw("TXP1"); u8(4); raw("Road");
  u16(2); u16(1); u16(0x0001); u16(0x4000);
  i32(2);
  raw("ART\\ROAD.RAW"); for (let i = 12; i < 32; i++) u8(0);
  raw("ART\\GRASS.RAW"); for (let i = 13; i < 32; i++) u8(0);
  // BITMAPINFOHEADER: size 40, width 4, height -2 (top-down), then 256 colours.
  i32(40); i32(4); i32(-2); for (let i = 12; i < 40; i++) u8(0);
  for (let i = 0; i < 1024; i++) u8(i);
  for (let i = 0; i < 8; i++) u8(i + 1);
  i32(0);
  return Uint8Array.from(out);
}

test("a .TXP reads into its patterns and writes back the same bytes", () => {
  const bytes = txpFixture();
  const [road, ...rest] = readTxp(bytes);
  assert.equal(rest.length, 0);
  assert.equal(road.name, "Road");
  assert.deepEqual([road.w, road.h], [2, 1]);
  assert.deepEqual(road.cells, [1, 0x4000]);
  assert.deepEqual(road.textures, ["ART\\ROAD.RAW", "ART\\GRASS.RAW"]);
  assert.deepEqual([...road.thumbPixels], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(writeTxp([road]), bytes);
  assert.throws(() => readTxp(bytes.subarray(0, 40)), TxpError);
  assert.throws(() => writeTxp([{ ...road, name: "" }]), TxpError);
});

test("a .PAL is Traxx's fixed RIFF header, four bytes per colour and four zeros; an .ACT the bare triples", () => {
  const rgb = Uint8Array.from({ length: 768 }, (_, i) => i % 251);
  const pal = writePalFile(rgb);
  assert.equal(pal.length, 1052);
  assert.equal(String.fromCharCode(...pal.subarray(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...pal.subarray(8, 16)), "PAL data");
  assert.deepEqual([...pal.subarray(24, 28)], [rgb[0], rgb[1], rgb[2], 0]);
  assert.deepEqual([...pal.subarray(1048)], [0, 0, 0, 0]);
  assert.deepEqual(readPalFile(pal), rgb);
  assert.deepEqual(readActFile(writeActFile(rgb)), rgb);
  assert.equal(readPalFile(pal.subarray(0, 100)), null);
});
