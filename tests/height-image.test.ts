/*
  The height-image codec (TrackPOD/TrackPODHeightImage.cpp) and the heights PNG on Write POD and in
  Import / Export Heightmap. The cases follow tools/terraintest.cpp's height-image tests. The PNG
  hashes are of the bytes Traxx's own HeightPngEncode wrote for the same heights (the C++ built
  as-is with stb_image_write v1.16 and MSVC's rand() for the noisy map).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { decodePngSamples } from "../src/vendor/openphotex/texture/png.js";
import { MsvcRand } from "../src/core/edit/terrain-gen.ts";
import {
  crc32, heightExportFormat, heightImageDecode, heightImageLooksLikeImage, heightImageSizeRefusal, heightImageToRaw,
  heightImportPlan, heightPngEncode, stbiZlibCompress,
} from "../src/core/traxx/height-image.ts";
import { encodeHeightsPng, heightsPodPlan, HEIGHTS_PNG_NAME_TOO_LONG } from "../src/core/traxx/heights-png.ts";
import {
  heightmapExportBytes, heightmapExportDefaults, heightmapExportName, heightmapImportPrecheck, heightmapImportQuestions,
  planHeightmapImport, HEIGHTMAP_BAD_LENGTH, HEIGHTMAP_COARSE_FULL,
} from "../src/core/edit/heightmap-io.ts";
import { saveRaw, refreshRaw, type Terrain16 } from "../src/core/traxx/terrain16.ts";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** PngTestMap (terraintest.cpp): 0/1 the edge values, 2 noisy full range from srand(1234 + kind), 3 a gradient. */
function pngTestMap(size: number, kind: number): Uint16Array {
  const v = new Uint16Array(size * size), edge = [0, 1, 65534, 65535], r = new MsvcRand(1234 + kind);
  for (let i = 0; i < size * size; i++) {
    if (kind === 0) v[i] = edge[i & 3]!;
    else if (kind === 1) v[i] = edge[(i >> 7) & 3]!;
    else if (kind === 2) v[i] = (r.next() * 2 + (r.next() & 1)) & 0xffff;
    else v[i] = ((i % size) * 40 + Math.trunc(i / size) * 20) & 0xffff;
  }
  return v;
}

// SHA-256 of Traxx 1.7.0's HeightPngEncode(PngTestMap(size, kind), size, bits).
const TRAXX_PNG: Record<string, string> = {
  "256/8/0": "630569cb74a3def9dca5b70d3a9c7c43c9a2ac031a63ae73e34f1ba744ea2518",
  "256/8/1": "035c1b6a5b0d0e656f2c3f63e91807b2f44dd98b1742b2eecd7eda58ad317890",
  "256/8/2": "eb88c5d2fcc80d2f7174c9075ffea37937687e6a7bbe7082775443c2019224ca",
  "256/8/3": "41cc3643eb3f5f226bcc1efcdc3a7847cedfe68a2e637953100a3d390e2caa13",
  "256/16/0": "47464a51595df9d386fedf269b20084b3a792f5d8081c691015c048bd50fdceb",
  "256/16/1": "e87bb069e2e568e79bd7773dc863bb046ba3e0c55dc7afd3f94fd3186828c8aa",
  "256/16/2": "703a0adcde267ed908cd4c7d42d5a6e7b40f1fc4ffac4e8dc8a3f434609874c3",
  "256/16/3": "958c0f2a6c408be9fb4c482a93777d380d72bd44ed1902d818a8ba5c2c7d7644",
  "1024/8/0": "6217112a19611fd1bf8bb90913b3b27c2e172c187d57cd22e560f08751cb4757",
  "1024/8/1": "0e603ab42d0cf2bca7e0a2d0816549b5b35be18ccbced482bce6202e8ea8df95",
  "1024/8/2": "5da9536e5c81d640aa571d838a8d8137c3349447c6930024d302ec76a9ec1652",
  "1024/8/3": "93da2ddf71d753e660779cdd84a2e9b921de0aedb13ad509816096f797b3b933",
  "1024/16/0": "77ce11ee49d053bae83ef91e33bad9a4edbc020506368dee8917f9862fb3d112",
  "1024/16/1": "2cbf784b5e25f73bbe3a3d577938eb5380ef04a297319d9a89933888862a7530",
  "1024/16/2": "6204e93f0ce2cb9ab373c2c9a037b8a2e56b692347e69f2898d12a46467786a5",
  "1024/16/3": "80e89ede53e9ba2ff66270844270b8f84509cb1a86fe6dc44ef4d78f1213745f",
};

test("HeightPngEncode is byte for byte Traxx's, at every size, depth and map kind", () => {
  for (const size of [256, 1024]) for (const bits of [8, 16]) for (let kind = 0; kind < 4; kind++) {
    const png = heightPngEncode(pngTestMap(size, kind), size, bits)!;
    assert.equal(sha(png), TRAXX_PNG[`${size}/${bits}/${kind}`], `${size} ${bits}-bit kind ${kind}`);
  }
});

/** The chunks of a PNG, CRCs checked. */
function chunks(png: Uint8Array): { type: string; data: Uint8Array }[] {
  const out: { type: string; data: Uint8Array }[] = [];
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let o = 8; o < png.length;) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    assert.equal(dv.getUint32(o + 8 + len), crc32(png, o + 4, o + 8 + len), `${type} CRC`);
    out.push({ type, data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  return out;
}

test("the PNG is IHDR, one IDAT, IEND; the IDAT inflates (node:zlib) to Paeth-filtered rows", () => {
  const v = pngTestMap(256, 3);
  const png = heightPngEncode(v, 256, 16)!;
  const c = chunks(png);
  assert.deepEqual(c.map((x) => x.type), ["IHDR", "IDAT", "IEND"]);
  assert.deepEqual([...c[0]!.data], [0, 0, 1, 0, 0, 0, 1, 0, 16, 0, 0, 0, 0]);
  assert.deepEqual([...c[1]!.data.subarray(0, 2)], [0x78, 0x5e]);
  const rows = inflateSync(c[1]!.data); // node checks the Adler-32
  assert.equal(rows.length, 256 * 513);
  for (let z = 0; z < 256; z++) assert.equal(rows[z * 513], 4);
  // The noisy map comes out as stored blocks, which zlib reads too.
  const noisy = heightPngEncode(pngTestMap(256, 2), 256, 8)!;
  const idat = chunks(noisy)[1]!.data;
  assert.equal(inflateSync(idat).length, 256 * 257);
  assert.equal(idat[2], 0); // first stored block, not final
});

test("stbi_zlib_compress output inflates back, tiny inputs included", () => {
  // (Empty input is stb's own edge: the stored fallback then writes no block at all. A PNG never has one.)
  for (const data of [new Uint8Array([7]), new Uint8Array([1, 2, 3, 4]), new Uint8Array(100000).map((_, i) => (i * 7) & 0x3f)]) {
    assert.deepEqual(new Uint8Array(inflateSync(stbiZlibCompress(data))), data);
  }
});

test("round trip: encode then OpenPhotex decodePngSamples and HeightImageDecode give the heights back", () => {
  for (const size of [256, 1024]) for (const bits of [8, 16]) for (let kind = 0; kind < 4; kind++) {
    const v = pngTestMap(size, kind);
    const png = heightPngEncode(v, size, bits)!;
    const s = decodePngSamples(png);
    assert.equal(s.width, size);
    assert.equal(s.bitDepth, bits);
    const d = heightImageDecode(png);
    assert.ok(d.ok);
    assert.equal(d.size, size);
    assert.equal(d.srcBits, bits);
    for (let i = 0; i < size * size; i++) {
      let e = v[i]!;
      if (bits === 8) e = Math.min(255, (e + 128) >> 8) << 8;
      if (d.v[i] !== e) assert.fail(`${size} ${bits} ${kind} at ${i}: ${d.v[i]} != ${e}`);
    }
  }
});

/** PngTestBuild (terraintest.cpp): stored zlib, filter 0, every sample byte `fill`. */
function pngTestBuild(w: number, h: number, depth: number, ctype: number, rowbytes: number, fill: number, alpha = -1): Uint8Array {
  const raw = new Uint8Array(h * (1 + rowbytes));
  for (let y = 0; y < h; y++) {
    raw.fill(fill, y * (1 + rowbytes) + 1, (y + 1) * (1 + rowbytes));
    if (ctype === 4 && alpha >= 0) for (let j = 0; j < rowbytes; j++) if (j % (depth / 4) >= depth / 8) raw[y * (1 + rowbytes) + 1 + j] = alpha;
  }
  const z: number[] = [0x78, 0x01];
  for (let pos = 0; ;) {
    const len = Math.min(60000, raw.length - pos), last = pos + len >= raw.length;
    z.push(last ? 1 : 0, len & 255, len >> 8, ~len & 255, (~len >> 8) & 255);
    for (let k = pos; k < pos + len; k++) z.push(raw[k]!);
    pos += len;
    if (last) break;
  }
  let a = 1, b = 0;
  for (const x of raw) { a = (a + x) % 65521; b = (b + a) % 65521; }
  const ad = ((b << 16) | a) >>> 0;
  z.push(ad >>> 24, (ad >> 16) & 255, (ad >> 8) & 255, ad & 255);
  const out: number[] = [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10];
  const chunk = (type: string, data: number[]) => {
    const c = new Uint8Array(12 + data.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, data.length);
    for (let k = 0; k < 4; k++) c[4 + k] = type.charCodeAt(k);
    c.set(data, 8);
    dv.setUint32(8 + data.length, crc32(c, 4, 8 + data.length));
    for (const x of c) out.push(x);
  };
  chunk("IHDR", [w >>> 24, (w >> 16) & 255, (w >> 8) & 255, w & 255, h >>> 24, (h >> 16) & 255, (h >> 8) & 255, h & 255, depth, ctype, 0, 0, 0]);
  if (ctype === 3) chunk("PLTE", new Array(48).fill(0x80));
  chunk("IDAT", z);
  chunk("IEND", []);
  return new Uint8Array(out);
}

const why = (f: Uint8Array | null) => { const d = heightImageDecode(f); assert.ok(!d.ok); return d.why; };

test("PNG refusals: colour, palette, 1/2/4-bit, wrong size, bad signature, truncated", () => {
  assert.match(why(pngTestBuild(256, 256, 8, 2, 768, 0x40)), /colour PNG; height maps must be grayscale/);
  assert.match(why(pngTestBuild(256, 256, 16, 6, 2048, 0x40)), /colour PNG; height maps must be grayscale/);
  assert.match(why(pngTestBuild(256, 256, 4, 3, 128, 0x11)), /colour PNG/);
  assert.match(why(pngTestBuild(256, 256, 8, 3, 256, 0x01)), /colour PNG/);
  for (const d of [1, 2, 4]) assert.equal(why(pngTestBuild(256, 256, d, 0, (256 * d) / 8, 0x55)), "This PNG is 1-, 2- or 4-bit grayscale; height maps must be 8- or 16-bit.");
  assert.equal(why(pngTestBuild(512, 512, 8, 0, 512, 0x22)), "This image is 512 x 512; height maps must be 256 x 256 or 1024 x 1024.");
  assert.equal(why(pngTestBuild(256, 128, 8, 0, 256, 0x22)), "This image is 256 x 128; height maps must be 256 x 256 or 1024 x 1024.");
  assert.equal(why(pngTestBuild(1025, 1025, 8, 0, 1025, 0x22)), "This image is 1025 x 1025; height maps must be 256 x 256 or 1024 x 1024 (a 1025 map: drop the last row and column).");
  assert.equal(why(new Uint8Array(64).fill(0x5a)), "This file is not a PNG or TGA image.");
  assert.equal(why(new Uint8Array(3).fill(0x5a)), "This file is not a PNG or TGA image.");
  assert.equal(why(null), "This file is not a PNG or TGA image.");
  assert.equal(why(pngTestBuild(256, 256, 8, 0, 256, 0x22).slice(0, 40)), "This image could not be decoded; the file may be damaged.");
});

test("an outside 16-bit PNG (Traxx's fixture, .NET PngBitmapEncoder) reads x * 160 + z * 95", () => {
  const d = heightImageDecode(new Uint8Array(readFileSync(new URL("./fixtures/gray16_256_gradient.png", import.meta.url))));
  assert.ok(d.ok);
  assert.equal(d.size, 256);
  assert.equal(d.srcBits, 16);
  for (let z = 0; z < 256; z++) for (let x = 0; x < 256; x++) if (d.v[z * 256 + x] !== x * 160 + z * 95) assert.fail(`${x},${z}`);
});

test("grey + alpha: the alpha is ignored", () => {
  const a = heightImageDecode(pngTestBuild(256, 256, 8, 4, 512, 0x7f, 0x11));
  assert.ok(a.ok);
  assert.equal(a.srcBits, 8);
  assert.equal(a.v[0], 0x7f00);
  assert.equal(a.v[65535], 0x7f00);
  const b = heightImageDecode(pngTestBuild(256, 256, 16, 4, 1024, 0x33, 0x11));
  assert.ok(b.ok);
  assert.equal(b.v[0], 0x3333);
});

/** TgaTestBuild (terraintest.cpp): logical row z filled with z; topleft picks the origin bit. */
function tgaTestBuild(type: number, bpp: number, topleft: boolean, rle: boolean): Uint8Array {
  const f: number[] = new Array(18).fill(0);
  f[2] = type; f[13] = 1; f[15] = 1; f[16] = bpp; f[17] = topleft ? 0x20 : 0;
  const px = bpp / 8;
  for (let r = 0; r < 256; r++) {
    const z = topleft ? r : 255 - r;
    if (rle) for (let k = 0; k < 2; k++) { f.push(0x80 | 127); for (let c = 0; c < px; c++) f.push(z); }
    else for (let x = 0; x < 256 * px; x++) f.push(z);
  }
  return new Uint8Array(f);
}

test("grey TGA, raw and RLE, either origin: top row = Z 0", () => {
  for (const rle of [false, true]) for (const topleft of [false, true]) {
    const d = heightImageDecode(tgaTestBuild(rle ? 11 : 3, 8, topleft, rle));
    assert.ok(d.ok, `rle ${rle} topleft ${topleft}`);
    assert.equal(d.size, 256);
    assert.equal(d.srcBits, 8);
    for (let z = 0; z < 256; z++) for (let x = 0; x < 256; x++) if (d.v[z * 256 + x] !== z << 8) assert.fail(`${rle} ${topleft} ${x},${z}`);
  }
});

test("TGA refusals: colour, not 8-bit, right to left", () => {
  assert.match(why(tgaTestBuild(2, 24, true, false)), /colour TGA/);
  assert.match(why(tgaTestBuild(10, 24, true, true)), /colour TGA/);
  assert.equal(why(tgaTestBuild(3, 16, true, false)), "This TGA is not 8-bit; height maps must be 8-bit grayscale.");
  const f = tgaTestBuild(3, 8, true, false);
  assert.ok(heightImageDecode(f).ok);
  f[17]! |= 0x10;
  assert.equal(why(f), "This TGA is stored right to left; flip it horizontally and save it again.");
});

test("HeightImageSizeRefusal reads the size from the header alone", () => {
  assert.match(heightImageSizeRefusal(pngTestBuild(4096, 4096, 8, 0, 4096, 0x22).slice(0, 33), 20 * 1024 * 1024) ?? "", /This image is 4096 x 4096;/);
  const ok = pngTestBuild(1024, 1024, 8, 0, 1024, 0x22);
  assert.equal(heightImageSizeRefusal(ok.slice(0, 33), ok.length), null);
  const rgb = pngTestBuild(256, 256, 8, 2, 768, 0x40);
  assert.equal(heightImageSizeRefusal(rgb.slice(0, 33), rgb.length), null);
  const tga = new Uint8Array(18);
  tga[2] = 3; tga[13] = 8; tga[15] = 8; tga[16] = 8;
  assert.match(heightImageSizeRefusal(tga, 5 * 1024 * 1024) ?? "", /This image is 2048 x 2048;/);
  tga[13] = 4; tga[15] = 4;
  assert.equal(heightImageSizeRefusal(tga, 5 * 1024 * 1024), null);
  assert.equal(heightImageSizeRefusal(new Uint8Array(33).fill(0x5a), 5 * 1024 * 1024), null);
  assert.equal(heightImageSizeRefusal(new Uint8Array(10).fill(0x5a), 10), null);
  assert.equal(heightImageSizeRefusal(null, 0), null);
});

test("HeightImportPlan and HeightImageToRaw", () => {
  assert.deepEqual([heightImportPlan(8, 256), heightImportPlan(16, 256), heightImportPlan(8, 1024), heightImportPlan(16, 1024)], [65536, 131072, 2097152, 2097152]);
  assert.deepEqual([heightImportPlan(8, 512), heightImportPlan(16, 255), heightImportPlan(12, 256), heightImportPlan(0, 0)], [0, 0, 0, 0]);
  const v = pngTestMap(1024, 2).map((x) => x & 0xff00);
  const b = heightImageToRaw(v, 8, 1024)!;
  assert.equal(b.length, 2097152);
  for (let i = 0; i < 1024 * 1024; i++) if (b[2 * i] !== 0 || b[2 * i + 1] !== v[i]! >> 8) assert.fail(String(i));
  assert.equal(heightImageToRaw(null, 8, 256), null);
  assert.equal(heightImageToRaw(new Uint16Array(4), 8, 512), null);
});

test("HeightImageLooksLikeImage: the sniff and the .RAW lengths", () => {
  assert.ok(heightImageLooksLikeImage(pngTestBuild(256, 256, 8, 0, 256, 0x40)));
  const tga = new Uint8Array(26);
  tga[2] = 3; tga[13] = 1; tga[15] = 1; tga[16] = 8;
  assert.ok(heightImageLooksLikeImage(tga));
  tga[2] = 2; tga[16] = 24;
  assert.ok(heightImageLooksLikeImage(tga));
  tga[2] = 3; tga[16] = 8; tga[13] = 0;
  assert.ok(!heightImageLooksLikeImage(tga));
  const raw = new Uint8Array(2097152);
  const at = (n: number) => raw.subarray(0, n);
  raw[2] = 3; raw[12] = 1; raw[14] = 1; raw[16] = 8;
  for (const n of [65536, 131072, 2097152]) assert.ok(!heightImageLooksLikeImage(at(n)));
  raw[1] = 1; raw[12] = 0; raw[13] = 1; raw[14] = 0; raw[15] = 1;
  assert.ok(!heightImageLooksLikeImage(at(65536)));
  raw[1] = 0; raw[16] = 16;
  assert.ok(!heightImageLooksLikeImage(at(65536)));
  raw[16] = 8; raw[2] = 11;
  assert.ok(heightImageLooksLikeImage(at(65536)));
  assert.ok(heightImageLooksLikeImage(at(131072)));
  raw[2] = 3; raw[13] = 4; raw[15] = 4;
  assert.ok(heightImageLooksLikeImage(at(2097152)));
  raw[13] = 2; raw[15] = 2;
  assert.ok(!heightImageLooksLikeImage(at(65536)));
  raw.fill(0x55);
  assert.ok(!heightImageLooksLikeImage(at(65536)));
  assert.ok(!heightImageLooksLikeImage(null));
  assert.ok(!heightImageLooksLikeImage(at(10)));
});

test("HeightExportFormat: the typed extension decides, else the filter", () => {
  const cases: [string | null, number, boolean, number][] = [
    ["raw", 1, false, 3], ["RAW", 2, false, 3], [".Raw", 1, true, 3], ["png", 3, false, 1], ["png", 3, true, 2],
    ["PNG", 1, false, 1], [".png", 2, false, 2], ["png", 1, true, 1], ["", 1, false, 1], ["", 2, false, 2],
    ["", 3, true, 3], ["txt", 3, false, 3], [null, 2, true, 2], ["", 0, true, 2], ["", 9, false, 1],
  ];
  for (const [ext, f, c8, want] of cases) assert.equal(heightExportFormat(ext, f, c8), want, `${ext} ${f} ${c8}`);
});

function track(mode: number, v: Uint16Array | null): Terrain16 {
  const t: Terrain16 = { terrainMode: mode, h16: null, fine: null, rawShadow: null, heights: new Uint8Array(65536) };
  if (mode === 1 || mode === 2) t.h16 = v!.slice();
  if (mode === 3) t.fine = v!.slice();
  if (mode !== 0) { t.rawShadow = new Uint8Array(65536); refreshRaw(t); }
  return t;
}

test("import of an exported PNG is byte for byte the .RAW export of the same heights", () => {
  for (const [mode, bits, size] of [[0, 8, 256], [1, 16, 256], [3, 16, 1024]] as const) {
    let v = pngTestMap(size, 2);
    const t = track(mode, v);
    if (mode === 0) { for (let i = 0; i < 65536; i++) t.heights[i] = v[i]! >> 8; v = v.map((_, i) => t.heights[i]! << 8); }
    const png = heightmapExportBytes(t, bits === 8 ? 2 : 1)!;
    assert.deepEqual(png, heightPngEncode(v, size, bits));
    const want = saveRaw(t);
    const d = heightImageDecode(png);
    assert.ok(d.ok);
    assert.equal(heightImportPlan(d.srcBits, d.size), want.length);
    assert.deepEqual(heightImageToRaw(d.v, d.srcBits, d.size), want);
    assert.deepEqual(heightmapExportBytes(t, 3), want);
  }
});

test("Write POD heights: PNG only outside classic 8-bit, both on classic 8-bit, nothing without the setting", () => {
  const v = pngTestMap(256, 3);
  const c16 = track(1, v);
  assert.deepEqual(heightsPodPlan(c16, "MYTRACK", false), { raw: true, png: null, txvKey: "", error: null });
  const on = heightsPodPlan(c16, "MYTRACK", true);
  assert.equal(on.raw, false);
  assert.equal(on.png!.name, "DATA\\MYTRACK_H.PNG");
  assert.equal(on.txvKey, "DATA\\MYTRACK_H.PNG");
  assert.equal(sha(on.png!.bytes), sha(heightPngEncode(v, 256, 16)!));
  const c8 = track(0, null);
  c8.heights.fill(77);
  const p8 = heightsPodPlan(c8, "MYTRACK", true);
  assert.equal(p8.raw, true);
  const d = heightImageDecode(p8.png!.bytes);
  assert.ok(d.ok && d.srcBits === 8 && d.v[0] === 77 << 8);
  const fine = track(3, pngTestMap(1024, 3));
  assert.equal(heightImageDecode(encodeHeightsPng(fine)).ok, true);
  assert.equal(heightsPodPlan(c16, "A".repeat(20), true).error, null);
  assert.equal(heightsPodPlan(c16, "A".repeat(21), true).error, HEIGHTS_PNG_NAME_TOO_LONG);
  // An 8-bit tool's edit on a 16-bit track is folded in first (SyncFromRaw).
  c16.heights[5] = 200;
  const after = heightImageDecode(heightsPodPlan(c16, "T", true).png!.bytes);
  assert.ok(after.ok && after.v[5] === 200 << 8);
});

test("Import Heightmap: precheck, the size x mode questions, the plan", async () => {
  assert.equal(heightmapImportPrecheck(10, new Uint8Array(10))!.text, HEIGHTMAP_BAD_LENGTH);
  assert.equal(heightmapImportPrecheck(65536, new Uint8Array(33)), null);
  assert.match(heightmapImportPrecheck(5 << 20, pngTestBuild(4096, 4096, 8, 0, 4096, 0x22).slice(0, 33))!.text, /4096 x 4096/);
  assert.equal(heightmapImportPrecheck(33 << 20, new Uint8Array(33))!.text, HEIGHTMAP_BAD_LENGTH);
  assert.deepEqual(heightmapImportQuestions(131072, 0).map((q) => [q.question.buttons, q.yes, q.no, q.cancel]), [["yesnocancel", 1, 0, null]]);
  assert.deepEqual(heightmapImportQuestions(2097152, 1).map((q) => [q.question.buttons, q.yes, q.no]), [["yesno", 3, null]]);
  assert.match(heightmapImportQuestions(65536, 3)[0]!.question.text, /Replace this track's 16-bit Full Map heights/);
  assert.equal(heightmapImportQuestions(65536, 1).length, 0);
  assert.equal(heightmapImportQuestions(131072, 2).length, 0);

  const said: string[] = [];
  const ui = (answer: "yes" | "no" | "cancel") => ({
    message: async (m: { text: string }) => { said.push(m.text); },
    ask: async () => answer,
  });
  const png16 = heightPngEncode(pngTestMap(256, 3), 256, 16)!;
  assert.deepEqual({ ...(await planHeightmapImport(png16, 0, ui("yes")))!, raw: null }, { raw: null, target: 1, undoable: false, coarseFull: false });
  assert.equal((await planHeightmapImport(png16, 0, ui("no")))!.target, 0);
  assert.equal(await planHeightmapImport(png16, 0, ui("cancel")), null);
  assert.equal((await planHeightmapImport(png16, 2, ui("no")))!.undoable, true);
  const png8k = heightPngEncode(pngTestMap(1024, 3), 1024, 8)!;
  const p = (await planHeightmapImport(png8k, 1, ui("yes")))!;
  assert.equal(p.target, 3);
  assert.equal(p.raw.length, 2097152);
  assert.equal(p.coarseFull, true);
  assert.ok(HEIGHTMAP_COARSE_FULL.includes("2 ft height steps"));
  assert.equal(await planHeightmapImport(png8k, 1, ui("no")), null);
  assert.equal(await planHeightmapImport(pngTestBuild(256, 256, 8, 2, 768, 0x40), 0, ui("yes")), null);
  assert.match(said.at(-1)!, /colour PNG/);
  assert.equal(await planHeightmapImport(new Uint8Array(1000), 0, ui("yes")), null);
  assert.equal(said.at(-1), HEIGHTMAP_BAD_LENGTH);
});

test("Export Heightmap: defaults and the name typed", () => {
  assert.deepEqual(heightmapExportDefaults(0, "Mytrack.txx"), { filterIndex: 2, fileName: "Mytrack.png", title: "Export heightmap - 16-bit .RAW files are little-endian (IBM PC byte order in Photoshop's Raw dialog), rows top to bottom = Z." });
  assert.equal(heightmapExportDefaults(3, "Untitled").filterIndex, 1);
  assert.deepEqual(heightmapExportName("hills.RAW", 1, 1), { format: 3, fileName: "hills.RAW", appended: false, replaceQuestion: null });
  const a = heightmapExportName("hills.", 3, 1);
  assert.equal(a.fileName, "hills.raw");
  assert.equal(a.replaceQuestion!.text, "hills.raw already exists.\n\nReplace it?");
  assert.equal(heightmapExportName("hills", 2, 1).fileName, "hills.png");
  assert.equal(heightmapExportName("hills.txt", 2, 1).fileName, "hills.txt.png");
});
