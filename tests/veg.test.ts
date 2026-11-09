/*
  Vegetation: the planter (Traxx/VegetationPlanter.cpp) and the .VEG builder and RULE text
  (TrackPOD/TrackPODVegetation.cpp).

  The cp4sandbox check re-plants fog_test.txx (JSTRAXX_CP4, default ~/games/cp4sandbox) from
  the rules and masks it carries and compares the result with WORLD\FOGTEST.VEG in
  fog_test.pod, which Traxx 1.7 planted. It skips when either file is absent.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { parseMtm2Veg, writeMtm2Veg } from "../src/vendor/openphotex/mtm/veg.js";
import { parseWtr } from "../src/vendor/openphotex/mtm/wtr.js";
import { readTxx } from "../src/core/traxx/txx.ts";
import { modelGeometry } from "../src/core/view/model-geometry.ts";
import {
  buildVeg, cG, emptyVegetation, vegCrc32, vegDefaultColour, vegDefaultEntry, vegetationFromPod, vegetationFromTxx,
  vegParseEntry, vegParseImage, vegParseRule, vegRuleText, vegTxvLines, VEG_COLLIDE_MODEL, VEG_LAYER_GRASS, VEG_LAYER_TREES,
} from "../src/core/traxx/veg.ts";
import type { Vegetation } from "../src/core/traxx/veg.ts";
import {
  colourHash, rngFloat, rngNext, rngSeed, vegDecodeMask, vegExtractPalette, vegGroundHeightClassic8, vegModelInfo,
  vegModelLookup, vegPlant, vegReplant,
} from "../src/core/edit/veg-planter.ts";
import type { VegMaskImage, VegPlantInput } from "../src/core/edit/veg-planter.ts";

const CP4 = process.env.JSTRAXX_CP4 ?? join(process.env.HOME ?? "", "games", "cp4sandbox");
const TXX = join(CP4, "fog_test.txx");
const POD = join(CP4, "fog_test.pod");
const noBoth = (existsSync(TXX) ? false : `no ${TXX}`) || (existsSync(POD) ? false : `no ${POD}`);

test("xorshift32 is Marsaglia's 13 / 17 / 5, seeded with four spins and never zero", () => {
  const r = { s: 1 };
  assert.deepEqual([rngNext(r), rngNext(r), rngNext(r)], [270369, 67634689, 2647435461]);
  // seed 1 spun four times is the fourth output from state 1.
  const ref = { s: 1 };
  for (let i = 0; i < 4; i++) rngNext(ref);
  assert.equal(rngSeed(1).s, ref.s);
  // A zero seed starts from the golden-ratio constant.
  const z = { s: 0x9e3779b9 };
  for (let i = 0; i < 4; i++) rngNext(z);
  assert.equal(rngSeed(0).s, z.s);
  // RngFloat: 24 bits in [0, 1).
  const f = rngSeed(12345);
  for (let i = 0; i < 1000; i++) {
    const v = rngFloat(f);
    assert.ok(v >= 0 && v < 1);
    assert.equal(v, Math.fround(v));
    assert.equal(Number.isInteger(v * 16777216), true);
  }
});

test("ColourHash is FNV-1a over (layer, r, g, b)", () => {
  const ref = (bytes: number[]) => {
    let h = 2166136261n;
    for (const b of bytes) h = ((h ^ BigInt(b)) * 16777619n) & 0xffffffffn;
    return Number(h);
  };
  for (const c of [[0, 0, 0, 0], [0, 12, 0, 255], [1, 255, 255, 255], [7, 0xa5, 0x5a, 0xc3]]) {
    assert.equal(colourHash(c[0]!, c[1]!, c[2]!, c[3]!), ref(c));
  }
  // Only the low byte of each part counts.
  assert.equal(colourHash(256 + 1, 300, 2, 3), colourHash(1, 44, 2, 3));
});

test("printf %g as the UCRT prints a float", () => {
  const cases: [number, string][] = [
    [Math.fround(0.8), "0.8"], [Math.fround(1.25), "1.25"], [18, "18"], [0, "0"], [100000, "100000"], [1e6, "1e+06"],
    [123456789, "1.23457e+08"], [0.0001, "0.0001"], [0.00001, "1e-05"], [Math.fround(0.4), "0.4"], [1234565, "1.23456e+06"],
    [-2.5, "-2.5"], [Math.fround(0.1), "0.1"], [999999.5, "1e+06"],
  ];
  for (const [v, s] of cases) assert.equal(cG(v), s, String(v));
});

test("the classic 8-bit ground is the engine's triangles over 2 ft steps", () => {
  const raw = new Uint8Array(65536);
  raw[0] = 10; raw[1] = 20; raw[256] = 30; raw[257] = 40;
  assert.equal(vegGroundHeightClassic8(raw, 0, 0), 20);
  assert.equal(vegGroundHeightClassic8(raw, 32, 0), 40);
  assert.equal(vegGroundHeightClassic8(raw, 0, 32), 60);
  assert.equal(vegGroundHeightClassic8(raw, 32, 32), 80);
  // Tile (0,0) is even: the diagonal runs from h00 to h11, so the centre is their mean.
  assert.equal(vegGroundHeightClassic8(raw, 16, 16), 50);
  // The world wraps.
  assert.equal(vegGroundHeightClassic8(raw, 8192, 0), 20);
});

function oneColourMask(w: number, h: number, paint: (x: number, y: number) => boolean, rgb: [number, number, number]): VegMaskImage {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (paint(x, y)) out.set(rgb, (y * w + x) * 3);
  return { w, h, rgb: out };
}

function treeRules(seed: number): Vegetation {
  const v = emptyVegetation();
  v.seed = seed;
  const col = vegDefaultColour(VEG_LAYER_TREES);
  col.r = 0; col.g = 200; col.b = 0; col.name = "pines"; col.spacing = 20; col.density = 100;
  const e = vegDefaultEntry(VEG_LAYER_TREES);
  e.model = "PINE.BIN";
  col.entries = [e];
  v.colours[VEG_LAYER_TREES] = [col];
  v.masks[VEG_LAYER_TREES] = { ext: ".PNG", data: Uint8Array.of(1) };
  return v;
}

function plantInput(v: Vegetation, img: VegMaskImage, extra: Partial<VegPlantInput> = {}): VegPlantInput {
  const raw = new Uint8Array(65536).fill(50);
  return {
    veg: v, ground: (x, z) => vegGroundHeightClassic8(raw, x, z), waterLevel4: 0, lakeTiles: null, lakeHeights: [],
    groundBoxes: [], boxes: [], courses: [[]], trucks: [],
    model: (n) => (n.toUpperCase() === "PINE.BIN" ? { basez: -31, radiusFt: 4 } : null), images: [img, null], ...extra,
  };
}

test("Poisson trees keep their spacing, stay in the painted region and repeat for the same seed", () => {
  // 256 x 256 mask: one pixel is 32 ft; paint a 16 x 8 pixel block (512 x 256 ft).
  const img = oneColourMask(256, 256, (x, y) => x >= 100 && x < 116 && y >= 50 && y < 58, [0, 200, 0]);
  const a = treeRules(42);
  const res = vegPlant(plantInput(a, img));
  assert.equal(res.ok, true);
  assert.ok(a.trees.length > 100, `planted ${a.trees.length}`);
  for (const t of a.trees) {
    const x = t.x / 256, z = t.z / 256;
    assert.ok(x >= 3200 && x < 3712 && z >= 1600 && z < 1856, `tree at ${x},${z}`);
    assert.ok(t.scale >= 256);
  }
  for (let i = 0; i < a.trees.length; i++) {
    for (let j = i + 1; j < a.trees.length; j++) {
      const dx = (a.trees[i]!.x - a.trees[j]!.x) / 256, dz = (a.trees[i]!.z - a.trees[j]!.z) / 256;
      assert.ok(dx * dx + dz * dz >= 19.99 * 19.99, "trees closer than the spacing");
    }
  }
  const b = treeRules(42);
  vegPlant(plantInput(b, img));
  assert.deepEqual(b.trees, a.trees);
  const c = treeRules(43);
  vegPlant(plantInput(c, img));
  assert.notDeepEqual(c.trees, a.trees);
  // y seats the model origin: ground 100 ft, basez -31 / 128 below it, no sink.
  assert.equal(a.trees[0]!.y, Math.floor((100 + (31 / 128) * (a.trees[0]!.scale / 4096)) * 256 + 0.5));
});

test("trees keep clear of the course corridor, water and missing models", () => {
  const img = oneColourMask(256, 256, (x, y) => x >= 100 && x < 116 && y >= 50 && y < 58, [0, 200, 0]);
  // A course segment across the block, in half-feet, with the default 40 ft corridor.
  const v = treeRules(7);
  vegPlant(plantInput(v, img, { courses: [[{ cstart: [6400, 3456, 0], cend: [7424, 3456, 0] }]] }));
  assert.ok(v.trees.length > 0);
  for (const t of v.trees) assert.ok(Math.abs(t.z / 256 - 1728) >= 40, "a tree in the corridor");
  // Water above the ground (100 ft): everything is rejected.
  const w = treeRules(7);
  const r = vegPlant(plantInput(w, img, { waterLevel4: 400 }));
  assert.equal(w.trees.length, 0);
  assert.ok(r.report.some((l) => /in water/.test(l)));
  // A model not in the track's list plants nothing and says so once.
  const m = treeRules(7);
  const rm = vegPlant(plantInput(m, img, { model: () => null }));
  assert.equal(m.trees.length, 0);
  assert.equal(rm.report.filter((l) => /PINE\.BIN is not in the track's model list/.test(l)).length, 1);
});

test("grass plants per 32 ft tile, scaled by coverage, grouped by tile", () => {
  // 512 x 512 mask: 2 pixels per tile; tile (10, 10) fully painted, tile (11, 10) a quarter.
  const img = oneColourMask(512, 512, (x, y) => (x >= 20 && x < 22 && y >= 20 && y < 22) || (x === 22 && y === 20), [9, 9, 200]);
  const v = emptyVegetation();
  const col = vegDefaultColour(VEG_LAYER_GRASS);
  col.r = 9; col.g = 9; col.b = 200; col.pertile = 100;
  const e = vegDefaultEntry(VEG_LAYER_GRASS);
  e.model = "PINE.BIN";
  col.entries = [e];
  v.colours[VEG_LAYER_GRASS] = [col];
  v.masks[VEG_LAYER_GRASS] = { ext: ".PNG", data: Uint8Array.of(2) };
  vegPlant({ ...plantInput(v, img), images: [null, img] });
  const per = new Map<string, number>();
  for (const c of v.clumps) per.set(`${c.tx},${c.tz}`, (per.get(`${c.tx},${c.tz}`) ?? 0) + 1);
  assert.deepEqual([...per], [["10,10", 100], ["11,10", 25]]);
  assert.equal(v.species.length, 1);
  assert.equal(v.species[0]!.kind, 1);
  // The built file round-trips through OpenPhotex with its tile table.
  const veg = parseMtm2Veg(buildVeg(v, "TEST", "2026-01-02")!);
  assert.deepEqual(veg.clumps.tiles, [{ tx: 10, tz: 10, first: 0, count: 100 }, { tx: 11, tz: 10, first: 100, count: 25 }]);
  assert.equal(veg.info.clumps, "125");
  assert.equal(veg.info.built, "2026-01-02");
});

test("the palette counts colours, merges within 8 levels and leaves stray pixels unmatched", () => {
  const img = oneColourMask(100, 100, (x) => x < 50, [100, 0, 0]);
  for (let i = 0; i < 100; i++) img.rgb.set([105, 3, 0], (i * 100 + 60) * 3);  // within tolerance: merged
  for (let i = 0; i < 10; i++) img.rgb.set([0, 0, 250], (i * 100 + 80) * 3);   // too few pixels
  const pal = vegExtractPalette(img, 16);
  assert.deepEqual(pal.rgb, [[100, 0, 0]]);
  assert.deepEqual(pal.count, [5100]);
  assert.equal(pal.unmatched, Math.fround(10 / 5110));
});

test("RULE text round-trips every setting", () => {
  const v = emptyVegetation();
  v.seed = 4000000000;
  v.corridorft = Math.fround(12.5);
  v.objectmarginft = 3;
  v.plantedcrc = [0xdeadbeef, 0x1234];
  v.masks = [{ ext: ".TGA", data: Uint8Array.of(1) }, null];
  const a = vegDefaultColour(0);
  a.r = 1; a.g = 2; a.b = 3; a.name = "oaks"; a.spacing = Math.fround(7.3); a.density = 55;
  const e1 = vegDefaultEntry(0);
  Object.assign(e1, {
    model: "OAK.BIN", farmodel: "OAKFAR.BIN", weight: 3, scalemin: Math.fround(0.6), scalemax: Math.fround(1.7), rotate: false,
    collide: VEG_COLLIDE_MODEL, trunkdiam: Math.fround(1.5), trunkheight: 9, sink: Math.fround(0.25), tier: 2, shadow: false,
    slopemax: 30, facing: true, crossfade: false,
  });
  a.entries = [e1, vegDefaultEntry(0)];
  a.entries[1]!.model = "BUSH.BIN";
  const g = vegDefaultColour(1);
  g.r = 200; g.name = "grass\tland"; g.pertile = 512;
  v.colours = [[a, vegDefaultColour(0)], [g]];
  const text = vegRuleText(v, "mytrack");
  assert.match(text, /^seed=4000000000\r\nvMask=ART\\MYTRACK_V\.TGA\r\nvMaskCRC=DEADBEEF\r\ngMaskCRC=00001234\r\ncorridorFt=12\.5\r\n/);
  assert.match(text, /v\.0\.entry\.0=OAK\.BIN,3,0\.6,1\.7,norot,model,1\.5,9,0\.25,2,noshadow,30,OAKFAR\.BIN,facing,nocrossfade\r\n/);
  assert.match(text, /v\.0\.entry\.1=BUSH\.BIN,1,0\.8,1\.25,rot,trunk,0,0,0,0,shadow,0,,,crossfade\r\n/);
  assert.match(text, /g\.0\.name=grass land\r\n/);
  const back = emptyVegetation();
  vegParseRule(back, text);
  assert.equal(back.seed, v.seed);
  assert.equal(back.corridorft, v.corridorft);
  assert.equal(back.objectmarginft, v.objectmarginft);
  assert.deepEqual(back.plantedcrc, v.plantedcrc);
  assert.deepEqual(back.rulenamesmask, [true, false]);
  g.name = "grass land";
  assert.deepEqual(back.colours, v.colours);
  assert.equal(vegRuleText(back, "mytrack").replace(/vMask=.*\r\n/, ""), text.replace(/vMask=.*\r\n/, ""));
});

test("an old or hand-edited RULE line keeps the defaults it lacks", () => {
  const e = vegParseEntry(VEG_LAYER_TREES, " PINE.BIN , 0 , -1 ")!;
  assert.equal(e.model, "PINE.BIN");
  assert.equal(e.weight, 1);
  assert.equal(e.scalemin, Math.fround(0.8));
  assert.equal(e.scalemax, Math.fround(1.25));
  assert.equal(e.crossfade, true);
  assert.equal(e.shadow, true);
  assert.equal(vegParseEntry(VEG_LAYER_TREES, ",1"), null);
  const v = emptyVegetation();
  vegParseRule(v, "# comment\r\nv.count=2\r\nv.1.entry.3=A.BIN\r\nv.1.entry.0=B.BIN\r\ng.5.rgb=1 , 2 , 3\r\nnonsense\r\n");
  assert.equal(v.colours[0]!.length, 2);
  assert.deepEqual(v.colours[0]![1]!.entries.map((x) => x.model), ["B.BIN", "A.BIN"]);
  assert.equal(v.colours[1]!.length, 6);
  assert.deepEqual([v.colours[1]![5]!.r, v.colours[1]![5]!.g, v.colours[1]![5]!.b], [1, 2, 3]);
});

test("a .VEG without RULE is kept read-only, byte for byte; the TXV keys count placements", () => {
  const v = treeRules(1);
  const img = oneColourMask(256, 256, (x, y) => x >= 100 && x < 104 && y >= 50 && y < 54, [0, 200, 0]);
  vegPlant(plantInput(v, img));
  const bytes = buildVeg(v, "T", "2026-01-01")!;
  const back = emptyVegetation();
  back.masks = v.masks;
  assert.equal(vegParseImage(back, bytes), true);
  assert.equal(back.readonly, false);
  assert.equal(back.stale, false);
  assert.deepEqual(back.trees, v.trees);
  assert.equal(vegTxvLines(back), `vegetation=1\r\nvegTrees=${v.trees.length}\r\nvegClumps=0\r\n`);
  // Masks changed after planting: stale.
  const changed = emptyVegetation();
  changed.masks = [{ ext: ".PNG", data: Uint8Array.of(9) }, null];
  vegParseImage(changed, bytes);
  assert.equal(changed.stale, true);
  // No RULE: foreign.
  const p = parseMtm2Veg(bytes);
  const foreignBytes = buildVegWithoutRule(p);
  const f = emptyVegetation();
  vegParseImage(f, foreignBytes);
  assert.equal(f.readonly, true);
  assert.deepEqual(buildVeg(f, "T"), foreignBytes);
});

function buildVegWithoutRule(p: ReturnType<typeof parseMtm2Veg>): Uint8Array {
  return writeMtm2Veg({ species: p.species, trees: p.trees, clumps: p.clumps, rule: null, info: "tool=Other\r\n" });
}

test("a mask decodes through stb's three components: grey replicated, alpha dropped", () => {
  const png = (colorType: number, channels: number, px: number[]) => {
    const crc = (b: Uint8Array) => vegCrc32(b);
    const chunk = (id: string, data: Uint8Array) => {
      const out = new Uint8Array(12 + data.length);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, data.length);
      out.set([...id].map((c) => c.charCodeAt(0)), 4);
      out.set(data, 8);
      dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
      return out;
    };
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, 1); dv.setUint32(4, 1); ihdr[8] = 8; ihdr[9] = colorType;
    const raw = Uint8Array.from([0, ...px.slice(0, channels)]);
    const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    return all;
  };
  assert.deepEqual([...vegDecodeMask({ ext: ".PNG", data: png(0, 1, [77]) }).img!.rgb], [77, 77, 77]);
  assert.deepEqual([...vegDecodeMask({ ext: ".PNG", data: png(6, 4, [1, 2, 3, 0]) }).img!.rgb], [1, 2, 3]);
  assert.equal(vegDecodeMask(null).err, "There is no mask loaded.");
});

test("fog_test re-planted from its own rules and masks is Traxx 1.7's WORLD\\FOGTEST.VEG", { skip: noBoth }, async () => {
  const track = readTxx(new Uint8Array(readFileSync(TXX)));
  const pod = new Uint8Array(readFileSync(POD));
  const archive = parsePod(pod);
  const entry = async (name: string) => {
    const e = archive.entries.find((x: { name: string }) => x.name.toUpperCase() === name.toUpperCase());
    return e ? await readPodEntry(pod, e) : null;
  };
  const expected = (await entry(`WORLD\\${track.prefix}.VEG`))!;
  const v = vegetationFromTxx(track.vegetation);
  assert.equal(v.stale, false);
  assert.equal(v.colours[0]!.length, 4);

  // The pod's own reading adopts the same rules and the masks RULE names.
  const fromPod = await vegetationFromPod(track.prefix, entry);
  assert.deepEqual(fromPod.colours, v.colours);
  assert.deepEqual(fromPod.masks.map((m) => m?.data.length), [48300, 39661]);
  assert.equal(fromPod.stale, false);

  const models = new Map<string, ArrayLike<number>>();
  for (const name of track.models) {
    const bytes = await entry(name);
    const geo = bytes ? modelGeometry(bytes) : null;
    if (geo) models.set(name, geo.raw);
  }
  const wtr = parseWtr((await entry(`WORLD\\${track.prefix}.WTR`))!);
  const result = vegReplant(track, v, models, wtr.tileMap)!;
  assert.equal(result.ok, true, result.report.join("\n"));

  const date = parseMtm2Veg(expected).info.built!;
  const got = buildVeg(v, track.prefix, date)!;
  const want = parseMtm2Veg(expected), mine = parseMtm2Veg(got);
  assert.deepEqual(mine.species, want.species);
  assert.equal(mine.trees.count, want.trees.count);
  for (let i = 0; i < want.trees.count; i++) {
    const at = (t: typeof want.trees) => [t.position[3 * i], t.position[3 * i + 1], t.position[3 * i + 2], t.species[i], t.heading[i], t.scale[i], t.tier[i]];
    assert.deepEqual(at(mine.trees), at(want.trees), `tree ${i}: x, y, z, species, heading, scale, tier`);
  }
  assert.equal(mine.clumps.count, want.clumps.count);
  assert.deepEqual(mine.clumps.tiles, want.clumps.tiles);
  for (let i = 0; i < want.clumps.count; i++) {
    const at = (c: typeof want.clumps) => [c.species[i], c.offset[2 * i], c.offset[2 * i + 1], c.y[i], c.heading[i], c.scale[i]];
    assert.deepEqual(at(mine.clumps), at(want.clumps), `clump ${i}: species, fx, fz, y, heading, scale`);
  }
  // With the date it was built on, the whole file is Traxx's, byte for byte.
  assert.deepEqual(got, expected);
});

test("model lookup takes a bare or MODELS\\ name, without case", () => {
  const look = vegModelLookup(new Map([["MODELS\\Pine.BIN", vegModelInfo([0, 0, -100, 128, 0, 0])]]));
  assert.deepEqual(look("pine.bin"), { basez: -131, radiusFt: 1 });
  assert.equal(look("MODELS\\OAK.BIN"), null);
});
