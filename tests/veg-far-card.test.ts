/*
  Make Far Cards (Traxx/VegetationFarCard.cpp), the instancing warning
  (TrackPOD/TrackPODInstancing.cpp VegModelsThatWillNotInstance) and palette vegetation masks.

  The cp4sandbox checks read Traxx 1.7's fog_test.pod (JSTRAXX_CP4, default ~/games/cp4sandbox)
  and skip without it. Its three cards were made by older generators (FARCARD3: one quad;
  FARCARD4: crossed, no gutter), whose code is not in the Traxx repository; what they prove is
  the name recipe (tag, name, model bytes, the texture's .RAW then .ACT) and the 384-byte
  layout. Today's FARCARD5 card of the same model is then made from the same inputs.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { decodePngSamples } from "../src/vendor/openphotex/texture/png.js";
import { loadPodTrack, findModelTexture } from "../src/core/doc/load-pod.ts";
import { findAsset } from "../src/core/doc/names.ts";
import type { TextureAsset } from "../src/core/doc/document.ts";
import {
  encodePngRgba, hdTexQuantizeKeyed, traxxModelData, vcClearGutter, vcDownsample, vcMakeQuad, vcWidenCrossed, vegFarCardBuildBin,
  vegFarCardHashBegin, vegFarCardHashUpdate, vegFarCardIsFlatModel, vegFarCardIsKeyframe, vegFarCardName, vegMakeFarCards,
  VEGCARD_BIN_BYTES, type VegCardLoaded, type VegFarCardHost,
} from "../src/core/traxx/veg-far-card.ts";
import { instPodTextureOk, modelInstanceProblem, vegModelsThatWillNotInstance } from "../src/core/traxx/instancing.ts";
import { emptyVegetation, vegDefaultColour, vegDefaultEntry, vegetationFromTxx, VEG_KIND_GROUND, VEG_LAYER_GRASS, VEG_LAYER_TREES } from "../src/core/traxx/veg.ts";
import { vegDecodeMask, vegReplant } from "../src/core/edit/veg-planter.ts";
import { modelGeometry } from "../src/core/view/model-geometry.ts";
import { parseWtr } from "../src/vendor/openphotex/mtm/wtr.js";
import { buildTrackPod } from "../src/core/traxx/pod-writer.ts";

const CP4 = process.env.JSTRAXX_CP4 ?? join(process.env.HOME ?? "", "games", "cp4sandbox");
const POD = join(CP4, "fog_test.pod");
const noPod = existsSync(POD) ? false : `no ${POD}`;

const i32 = (words: number[]) => new Uint8Array(new Int32Array(words).buffer);

test("the card name is CRC-32 over tag, upper-case bare name, model, then textures", () => {
  const ref = (bytes: number[]) => {
    let c = 0xffffffff;
    for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
    return c >>> 0;
  };
  const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const crc = vegFarCardHashBegin("MODELS\\pine.bin");
  assert.equal(crc, ref(text("FARCARD5PINE.BIN")));
  const after = vegFarCardHashUpdate(crc, [1, 2, 3]);
  assert.equal(after, ref([...text("FARCARD5PINE.BIN"), 1, 2, 3]));
  assert.match(vegFarCardName(after), /^V[0-9A-F]{8}$/);
  assert.equal(vegFarCardName(0xffffffff), "V00000000");
});

test("the .BIN is MAGNIFY, 8 vertices, TEXTURE64, the foliage MATERIAL and two MATFACETs: 384 bytes", () => {
  const bin = vegFarCardBuildBin(-100, 120, -80, 90, -5, 2000, 0x20000, "V12345678.RAW")!;
  assert.equal(bin.length, VEGCARD_BIN_BYTES);
  const w = new Int32Array(bin.buffer, 0, 96);
  assert.deepEqual([...w.slice(0, 5)], [20, 0x20000, 2, 0, 8]);
  // Front quad TL BL BR TR at z = 0, side quad at x = 0 from +Z to -Z.
  assert.deepEqual([...w.slice(5, 17)], [-100, 2000, 0, -100, -5, 0, 120, -5, 0, 120, 2000, 0]);
  assert.deepEqual([...w.slice(17, 29)], [0, 2000, 90, 0, -5, 90, 0, -5, -80, 0, 2000, -80]);
  assert.equal(w[29], 62);
  assert.equal(String.fromCharCode(...bin.subarray(124, 137)), "V12345678.RAW");
  assert.deepEqual([...w.slice(47, 59)], [63, 0x1089, 0, 0, 0, 0x10000, 0, 0, 0x10000, 0x10000, 0x10000, 0x80000000 | 0]);
  assert.deepEqual([...w.slice(59, 77)], [64, 4, 0, 0, -65536, 0, 0, 0, 0, 1, 0, 0xffffff, 2, 0x7fffff, 0xffffff, 3, 0x7fffff, 0]);
  assert.deepEqual([...w.slice(77, 95)], [64, 4, -65536, 0, 0, 0, 4, 0x800000, 0, 5, 0x800000, 0xffffff, 6, 0xffffff, 0xffffff, 7, 0xffffff, 0]);
  assert.equal(w[95], 0);
  assert.equal(modelInstanceProblem(bin), null);
  // Refusals: an empty extent, a name too long, and a card the engine would call flat.
  assert.equal(vegFarCardBuildBin(5, 5, 0, 1, 0, 1, 0, "A.RAW"), null);
  assert.equal(vegFarCardBuildBin(0, 1, 0, 1, 0, 1, 0, "X".repeat(64)), null);
  assert.equal(vegFarCardBuildBin(-1, 1, -1, 1, 0, 1000, 0, "A.RAW"), null);
});

test("flat and keyframe models, the widening and the gutter quad", () => {
  // A flat quad (thin in z): flat. A cube: not.
  assert.equal(vegFarCardIsFlatModel(i32([20, 65536, 2, 0, 2, 0, 0, 0, 100, 100, 1])), true);
  assert.equal(vegFarCardIsFlatModel(i32([20, 65536, 2, 0, 2, 0, 0, 0, 100, 100, 100])), false);
  assert.equal(vegFarCardIsFlatModel(i32([20, 65536, 7])), false);
  assert.equal(vegFarCardIsKeyframe(i32([32, 0])), true);
  assert.equal(vegFarCardIsKeyframe(i32([65, 0])), true);
  assert.equal(vegFarCardIsKeyframe(i32([20, 0])), false);
  // A tall, thin model: the side quad widened to num/400 of the height, about its centre.
  const e = { fx0: -400, fx1: 400, sz0: -10, sz1: 10 };
  assert.equal(vcWidenCrossed(e, 0, 8000, 21), true);
  assert.ok(e.sz1 - e.sz0 >= Math.trunc((8000 * 21 + 399) / 400) + 2);
  assert.equal(e.sz0, -e.sz1);
  assert.deepEqual({ ...e, fx0: -400, fx1: 400 }, e);
  // VcMakeQuad: 4 px of gutter left, right and top; none at the bottom.
  const q = vcMakeQuad(-1000, 1000, -50, 4000, 128, 256);
  const mx = Math.trunc((2000 + 120 - 1) / 120), my = Math.trunc((4050 + 252 - 1) / 252);
  assert.deepEqual(q, { cx0: -1000, cx1: 1000, cy0: -50, cy1: 4000, x0: -1000 - 4 * mx, x1: 1000 + 4 * mx, y0: -50, y1: 4000 + 4 * my });
});

test("downsample is alpha-weighted; the gutter clears alpha only", () => {
  const src = new Uint8Array([200, 100, 50, 255, 0, 0, 0, 0, 0, 0, 0, 0, 100, 50, 25, 255]);
  const d = vcDownsample(src, 2, 2, 2);
  assert.deepEqual([...d.rgba], [150, 75, 38, 128]);
  const im = { w: 16, h: 8, rgba: new Uint8Array(16 * 8 * 4).fill(200) };
  vcClearGutter(im, 2, 2);
  const a = (x: number, y: number) => im.rgba[(y * 16 + x) * 4 + 3];
  assert.equal(a(5, 0), 0); assert.equal(a(5, 1), 0); assert.equal(a(5, 2), 200);
  assert.equal(a(0, 5), 0); assert.equal(a(1, 5), 0); assert.equal(a(2, 5), 200);
  assert.equal(a(6, 5), 0); assert.equal(a(7, 5), 0); assert.equal(a(8, 5), 0); assert.equal(a(9, 5), 0); assert.equal(a(10, 5), 200);
  assert.equal(a(5, 7), 200);
  assert.equal(im.rgba[0], 200);
});

test("the keyed quantiser keeps entry 0 for holes and no other entry black", () => {
  const rgba = new Uint8Array([0, 0, 0, 255, 10, 200, 30, 255, 9, 9, 9, 0, 10, 200, 30, 127]);
  const k = hdTexQuantizeKeyed(rgba, 4, 1)!;
  assert.deepEqual([...k.act.subarray(0, 3)], [0, 0, 0]);
  for (let e = 1; e < 256; e++) assert.notDeepEqual([...k.act.subarray(e * 3, e * 3 + 3)], [0, 0, 0]);
  assert.equal(k.indices[2], 0);
  assert.equal(k.indices[3], 0);
  assert.ok(k.indices[0]! > 0 && k.indices[1]! > 0);
  assert.deepEqual([...k.act.subarray(k.indices[1]! * 3, k.indices[1]! * 3 + 3)], [10, 200, 30]);
  assert.equal(hdTexQuantizeKeyed(new Uint8Array([1, 2, 3, 0]), 1, 1), null);
});

test("the RGBA PNG decodes back to its pixels", () => {
  const w = 7, h = 5, rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 53 + 7) & 255);
  const s = decodePngSamples(encodePngRgba(rgba, w, h));
  assert.equal(s.colorType, 6);
  assert.deepEqual([...s.samples], [...rgba]);
});

test("TranslateBIN: first vertex list halved, texture names, facets clamped to 4, unknown records stepped over", () => {
  const name = (s: string, n: number) => { const b = new Uint8Array(n); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return [...new Int32Array(b.buffer)]; };
  const bin = i32([
    20, 65536, 2, 0, 3, 2, 4, 6, 8, 10, 12, 14, 16, 18,
    13, 0, ...name("leaf.raw", 16),
    1, 0, 0, 0, // ORGIN: stepped over
    14, 3, 0, 0, 0, 0, 0, 0x10000, 0x20000, 1, 0x30000, 0x40000, 2, 0xff0000, 0,
    10, 5, // COLOR: no texture
    25, 3, 0, 0, 0, 0, 0, 1, 2,
    0,
  ]);
  const m = traxxModelData(bin)!;
  assert.deepEqual([...m.x], [1, 4, 7]);
  assert.deepEqual([...m.z], [2, 5, 8]);
  assert.deepEqual([...m.y], [3, 6, 9]);
  assert.equal(m.polygons.length, 2);
  assert.deepEqual(m.polygons[0], { texturename: "LEAF.RAW", type: 14, nvertices: 3, vertindex: [0, 1, 2], txmap: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 255, y: 0 }] });
  assert.equal(m.polygons[1]!.texturename, "");
  assert.equal(m.polygons[1]!.type, 25);
  assert.equal(m.incomplete, false);
  assert.equal(traxxModelData(i32([20, 65536, 2, 0, 0, 99]))!.incomplete, true);
});

test("a palette PNG mask is expanded to RGB, as stbi_load(..., 3) does", () => {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 4);
  new DataView(ihdr.buffer).setUint32(4, 2);
  ihdr[8] = 2; ihdr[9] = 3;
  // 2-bit indices: row 0 = 0 1 2 3, row 1 = 3 2 1 0.
  const raw = Uint8Array.from([0, 0b00011011, 0, 0b11100100]);
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("PLTE", Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255])), chunk("tRNS", Uint8Array.from([0])),
    chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))];
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { data.set(p, o); o += p.length; }
  const r = vegDecodeMask({ ext: ".PNG", data });
  assert.equal(r.err, null);
  assert.deepEqual([...r.img!.rgb], [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0]);
});

test("VegModelsThatWillNotInstance: species first, else the colour entries; a bad texture is not loadable", () => {
  const tex = (n: string) => { const b = new Uint8Array(16); for (let i = 0; i < n.length; i++) b[i] = n.charCodeAt(i); return [...new Int32Array(b.buffer)]; };
  const model = (t: string, facet = 14) => i32([20, 65536, 2, 0, 3, 0, 0, 0, 1, 0, 0, 0, 1, 0, 13, 0, ...tex(t), facet, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0]);
  const bins: Record<string, Uint8Array> = { "GOOD.BIN": model("ok.raw"), "BADTEX.BIN": model("broken.raw"), "FLAT.BIN": model("ok.raw", 5) };
  const textures = [{ name: "ART\\OK.RAW", bad: false }, { name: "ART\\BROKEN.RAW", bad: true }];
  const texOk = instPodTextureOk((n) => textures[findModelTexture(textures, n)] ?? null);
  assert.equal(modelInstanceProblem(bins["BADTEX.BIN"]!, texOk), "texture BROKEN.RAW is not loadable");
  assert.equal(modelInstanceProblem(bins["BADTEX.BIN"]!), null);
  const v = emptyVegetation();
  const trees = vegDefaultColour(VEG_LAYER_TREES);
  trees.entries.push({ ...vegDefaultEntry(VEG_LAYER_TREES), model: "GOOD.BIN" }, { ...vegDefaultEntry(VEG_LAYER_TREES), model: "BADTEX.BIN" }, { ...vegDefaultEntry(VEG_LAYER_TREES), model: "MISSING.BIN" });
  const grass = vegDefaultColour(VEG_LAYER_GRASS);
  grass.entries.push({ ...vegDefaultEntry(VEG_LAYER_GRASS), model: "FLAT.BIN" }, { ...vegDefaultEntry(VEG_LAYER_GRASS), model: "badtex.bin" });
  v.colours[VEG_LAYER_TREES] = [trees];
  v.colours[VEG_LAYER_GRASS] = [grass];
  const issues = vegModelsThatWillNotInstance(v, (n) => bins[n.toUpperCase()] ?? null, texOk);
  assert.deepEqual(issues.map((i) => [i.model, i.kind]), [["BADTEX.BIN", 0], ["FLAT.BIN", VEG_KIND_GROUND], ["badtex.bin", VEG_KIND_GROUND]]);
  assert.match(issues[1]!.why, /opcode 5/);
  // With a species table, the species are judged, once per model and kind.
  v.species = [{ model: "BADTEX.BIN", farmodel: "", kind: 0, collide: 0, flags: 0, trunkdiam: 0, trunkheight: 0 }, { model: "BADTEX.BIN", farmodel: "", kind: 0, collide: 0, flags: 0, trunkdiam: 0, trunkheight: 0 }];
  assert.deepEqual(vegModelsThatWillNotInstance(v, (n) => bins[n.toUpperCase()] ?? null, texOk).map((i) => i.model), ["BADTEX.BIN"]);
});

/* fog_test.pod as a document, and a host whose ART folder is the pod's ART\ entries plus what the run writes. */
async function sandbox() {
  const bytes = new Uint8Array(readFileSync(POD));
  const archive = parsePod(bytes);
  const entry = async (name: string) => {
    const e = archive.entries.find((x) => x.name.toUpperCase() === name.toUpperCase());
    return e ? readPodEntry(bytes, e) : null;
  };
  const doc = await loadPodTrack({ archive, read: async (e) => readPodEntry(bytes, e) }, 0, "fog_test.pod");
  const art = new Map<string, Uint8Array>();
  const bins = new Map<string, Uint8Array>();
  const host: VegFarCardHost<{ name: string; bytes: Uint8Array }, TextureAsset> = {
    trackPalette: doc.track.palette,
    modelBytes: (n) => { const at = findAsset(doc.models, n); return at >= 0 ? doc.models[at]!.bytes : null; },
    modelLoaded: (n) => findAsset(doc.models, n) >= 0,
    modelTexture: (face) => doc.modelTextures[findModelTexture(doc.modelTextures, face)] ?? null,
    artFile: async (n) => art.get(n.toUpperCase()) ?? (await entry(`ART\\${n}`)),
    artExists: async (n) => art.has(n.toUpperCase()),
    binExists: async (n) => bins.has(n.toUpperCase()),
    writeArt: async (stem, f) => { art.set(`${stem}.PNG`, f.png); art.set(`${stem}.RAW`, f.raw); art.set(`${stem}.ACT`, f.act); return null; },
    writeBin: async (bare, b) => { bins.set(bare.toUpperCase(), b); return true; },
    deleteArt: async (stem) => { for (const e of ["PNG", "RAW", "ACT"]) art.delete(`${stem}.${e}`); },
    loadCard: async (bare) => {
      const b = bins.get(bare.toUpperCase());
      if (!b) return "cannot read";
      const stem = bare.replace(/\.BIN$/i, "");
      const raw = art.get(`${stem}.RAW`), act = art.get(`${stem}.ACT`);
      const textures: TextureAsset[] = raw ? [{ name: `ART\\${stem}.RAW`, side: 256, indices: raw, act: act ?? null, hd: null, bad: false }] : [];
      return { model: { name: `MODELS\\${bare}`, bytes: b }, textures, bytes: b, missing: raw ? [] : [`${stem}.RAW`] };
    },
    addCard: (c: VegCardLoaded<{ name: string; bytes: Uint8Array }, TextureAsset>) => {
      doc.models.push({ name: c.model.name, bytes: c.bytes, textureNames: [], frameNames: [], bad: false });
      doc.modelTextures.push(...c.textures);
    },
    loadedTexture: (c, face) => c.textures[findModelTexture(c.textures, `ART\\${face}`)] ?? null,
    modelsFolderLabel: "MODELS", artFolderLabel: "ART",
  };
  return { doc, entry, art, bins, host };
}

test("fog_test.pod: Traxx's own cards are named from the model and its .RAW / .ACT", { skip: noPod }, async () => {
  const { entry } = await sandbox();
  const name = async (tag: string, model: string, tex: string) => {
    let c = vegFarCardHashBegin(model, tag);
    c = vegFarCardHashUpdate(c, (await entry(`MODELS\\${model}`))!);
    c = vegFarCardHashUpdate(c, (await entry(`ART\\${tex}.RAW`))!);
    c = vegFarCardHashUpdate(c, (await entry(`ART\\${tex}.ACT`))!);
    return vegFarCardName(c);
  };
  assert.equal(await name("FARCARD4", "HORSE.BIN", "HORSE"), "V91534924");
  assert.equal(await name("FARCARD3", "HORSE.BIN", "HORSE"), "VB6A76DCD");
  assert.equal(await name("FARCARD3", "AK8PINEA.BIN", "AK8PINE"), "V208715A8");
  // The FARCARD4 crossed card's 384 bytes are VegFarCardBuildBIN's layout, given its own extents.
  const card = (await entry("MODELS\\V91534924.BIN"))!;
  const w = new Int32Array(card.slice().buffer);
  const rebuilt = vegFarCardBuildBin(w[5]!, w[11]!, w[25]!, w[19]!, w[9]!, w[6]!, w[1]!, "V91534924.RAW")!;
  assert.deepEqual([...rebuilt], [...card]);
});

test("fog_test.pod: Make Far Cards renders HORSE.BIN, skips the flat AK8PINEA.BIN, loads the card and sets the far model", { skip: noPod }, async () => {
  const { doc, art, bins, host } = await sandbox();
  const v = vegetationFromTxx(doc.track.vegetation);
  for (const c of v.colours[VEG_LAYER_TREES]!) for (const e of c.entries) e.farmodel = "";
  const models = doc.models.length;
  const r = await vegMakeFarCards(host, v);
  assert.match(r.report, /^Far cards: 1 made, 0 reused, 0 failed, 1 already flat \(none needed\)\./);
  assert.match(r.report, /Skipped AK8PINEA.BIN is already a flat card/);
  // The FARCARD5 name of the same inputs as Traxx's FARCARD4 card (the legacy tile and palette).
  assert.deepEqual(r.added, ["VD8D29F1C.BIN"]);
  assert.equal(doc.models.length, models + 1);
  assert.equal(r.changed, 1);
  for (const c of v.colours[VEG_LAYER_TREES]!) for (const e of c.entries) assert.equal(e.farmodel, e.model === "HORSE.BIN" ? "VD8D29F1C.BIN" : "");
  for (const b of r.added) {
    const bin = bins.get(b)!;
    assert.equal(bin.length, VEGCARD_BIN_BYTES);
    assert.equal(modelInstanceProblem(bin), null);
    assert.equal(vegFarCardIsFlatModel(bin), false);
    const stem = b.replace(".BIN", "");
    const png = decodePngSamples(art.get(`${stem}.PNG`)!);
    assert.equal(png.width, png.height);
    assert.equal(art.get(`${stem}.RAW`)!.length, 65536);
    // The gutter: the top 4 rows and the 4 columns each side of the seam are clear.
    const s = png.width;
    for (let x = 0; x < s; x++) for (let y = 0; y < 4; y++) assert.equal(png.samples[(y * s + x) * 4 + 3], 0);
    for (let y = 0; y < s; y++) for (const x of [0, 3, s / 2 - 4, s / 2 - 1, s / 2, s / 2 + 3, s - 1]) assert.equal(png.samples[(y * s + x) * 4 + 3], 0);
    // The bottom row is the model's base: something of the model is drawn there.
    let base = 0;
    for (let x = 0; x < s; x++) if (png.samples[((s - 1) * s + x) * 4 + 3]! > 0) base++;
    assert.ok(base > 0);
  }
  // HORSE's card stands on its first VLIST's lowest vertex, its width and depth the horse's own.
  const horse = new Int32Array(bins.get("VD8D29F1C.BIN")!.slice().buffer);
  const hb = new Int32Array(doc.models[findAsset(doc.models, "HORSE.BIN")]!.bytes!.slice().buffer);
  let ymin = hb[6]!;
  for (let i = 1; i < hb[4]!; i++) ymin = Math.min(ymin, hb[5 + i * 3 + 1]!);
  assert.equal(horse[9], ymin);
  // Again: same inputs, same card, already in the track.
  for (const c of v.colours[VEG_LAYER_TREES]!) for (const e of c.entries) e.farmodel = "";
  const again = await vegMakeFarCards(host, v);
  assert.match(again.report, /^Far cards: 0 made, 1 reused, 0 failed, 1 already flat/);
  assert.match(again.report, /Reused  HORSE.BIN -> VD8D29F1C.BIN \(already in the track\)/);
  assert.equal(doc.models.length, models + 1);
});

test("fog_test.pod: a FARCARD5 HORSE card looks like Traxx's FARCARD4 one", { skip: noPod }, async () => {
  const { doc, art, entry, host } = await sandbox();
  const v = vegetationFromTxx(doc.track.vegetation);
  for (const c of v.colours[VEG_LAYER_TREES]!) for (const e of c.entries) e.farmodel = "";
  await vegMakeFarCards(host, v);
  const ours = decodePngSamples(art.get("VD8D29F1C.PNG")!);
  const theirs = decodePngSamples((await entry("ART\\V91534924.PNG"))!);
  assert.equal(ours.width, theirs.width);
  // Coverage of each half agrees closely (the gutter moves the picture by a few pixels).
  const s = ours.width;
  for (const half of [0, 1]) {
    let a = 0, b = 0;
    for (let y = 0; y < s; y++) for (let x = half * s / 2; x < (half + 1) * s / 2; x++) {
      if (ours.samples[(y * s + x) * 4 + 3]! >= 128) a++;
      if (theirs.samples[(y * s + x) * 4 + (theirs.channels - 1)]! >= 128) b++;
    }
    assert.ok(Math.abs(a - b) / b < 0.15, `half ${half}: ${a} vs ${b}`);
  }
});

test("fog_test.pod: Write POD's instancing warning names the species models the game will not instance", { skip: noPod }, async () => {
  const { doc } = await sandbox();
  assert.deepEqual(buildTrackPod(doc).vegNotInstanced, []);
  // A texture that failed to load (the purple placeholder) keeps its models off instancing.
  doc.modelTextures.find((t) => /HORSE\.RAW$/i.test(t.name))!.bad = true;
  assert.deepEqual(buildTrackPod(doc).vegNotInstanced, [
    { model: "HORSE.BIN", kind: 0, why: "texture HORSE.RAW is not loadable" },
    { model: "HORSE.BIN", kind: VEG_KIND_GROUND, why: "texture HORSE.RAW is not loadable" },
  ]);
});

test("fog_test.pod: Re-plant ends its report with one warning line per model the game will not instance", { skip: noPod }, async () => {
  const { doc, entry } = await sandbox();
  const t = doc.track;
  const models = new Map<string, ArrayLike<number>>();
  for (const m of doc.models) { const g = m.bytes ? modelGeometry(m.bytes) : null; if (g) models.set(m.name, g.raw); }
  doc.modelTextures.find((x) => /HORSE\.RAW$/i.test(x.name))!.bad = true;
  const texOk = instPodTextureOk((n) => doc.modelTextures[findModelTexture(doc.modelTextures, n)] ?? null);
  const bytesOf = (n: string) => { const at = findAsset(doc.models, n); return at >= 0 ? doc.models[at]!.bytes : null; };
  const wtr = parseWtr((await entry(`WORLD\\${t.prefix}.WTR`))!);
  const v = vegetationFromTxx(t.vegetation);
  const r = vegReplant(t, v, models, wtr.tileMap, undefined, (veg) => vegModelsThatWillNotInstance(veg, bytesOf, texOk))!;
  assert.equal(r.ok, true);
  assert.deepEqual(r.report.slice(-2), [
    "Warning: HORSE.BIN will not be instanced by the game (texture HORSE.RAW is not loadable) - as a tree it draws only the nearest ~128 copies.",
    "Warning: HORSE.BIN will not be instanced by the game (texture HORSE.RAW is not loadable) - as grass it is not drawn at all.",
  ]);
});

test("stb's expansion scales 1, 2 and 4-bit grey to 8 bits (stbi__depth_scale_table)", async () => {
  const { stbiPngRgba } = await import("../src/core/image/stbi-png.ts");
  const grey = (bitDepth: 1 | 2 | 4, v: number) => stbiPngRgba({
    width: 1, height: 1, bitDepth, colorType: 0, channels: 1, samples: Uint16Array.of(v), palette: null, paletteAlpha: null, transparentKey: null,
  } as never);
  assert.deepEqual([...grey(1, 1)], [255, 255, 255, 255]);
  assert.deepEqual([...grey(2, 2)], [170, 170, 170, 255]);
  assert.deepEqual([...grey(4, 7)], [119, 119, 119, 255]);
});
