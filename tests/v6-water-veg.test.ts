/*
  Track format version 6 (openmtm2.github.io/proposals/track-format-v6.md, sections 8 and 9):
  lakes, vegetation and waterfalls in a 512-cell world and on heights CP4 cannot hold.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { parseWtr } from "../src/vendor/openphotex/mtm/wtr.js";
import type { LakeGround } from "../src/core/traxx/surface.ts";
import {
  buildWtr, buildWtrV6, lakeMaxHeightFor, lakeMinHeight, lakeSpill, parseWtrLakes, recomputeLakes, seedIndex,
  LAKE_MAX_HEIGHT, LAKE_NO_BASIN, LAKEERR_HEIGHT,
} from "../src/core/traxx/lakes.ts";
import { buildVeg, emptyVegetation, vegBoundsProblem, vegDefaultColour, vegDefaultEntry, vegParseImage, VEG_KIND_PLACED, VEG_LAYER_TREES } from "../src/core/traxx/veg.ts";
import { treeTile, vegWindow } from "../src/core/view/veg-draw.ts";
import { vegDecodeMask, vegGroundHeightClassic8, vegPlant } from "../src/core/edit/veg-planter.ts";
import { deflateSync } from "node:zlib";
import { trackNotches, fallDefaults } from "../src/core/traxx/falls.ts";
import { LAKE_DIR_S, LAKE_RULE_EDGE, LAKE_RULE_TILE } from "../src/core/traxx/lake-ground.ts";

/**
  A Classic 8-bit ground of N x N at 100 (200 ft) with a 12 x 12 basin at 80 round (cx, cz), and
  a deeper pit at 50 round (n / 2, 10) for the water to spill to.
*/
function basin8(n: number, cx: number, cz: number): Uint8Array {
  const raw = new Uint8Array(n * n).fill(100);
  for (let z = cz - 5; z <= cz + 6; z++) for (let x = cx - 5; x <= cx + 6; x++) raw[x + z * n] = 80;
  for (let z = 10; z <= 12; z++) for (let x = n / 2; x <= n / 2 + 2; x++) raw[x + z * n] = 50;
  return raw;
}

test("a lake in a 512-cell world: the tile map is 512 x 512, the box past cell 255, the walk wraps at 512", () => {
  const n = 512;
  const g: LakeGround = { raw: basin8(n, 400, 450), tilemin: null, groundAtLevel: null, step: 0, pointU: null };
  assert.equal(lakeSpill(g, null, 0, 400, 450, -1), 399);
  const lake = { height: 399, flags: 1, seeds: [[400, 450]] as [number, number][] };
  const st = recomputeLakes(g, [lake], 0);
  assert.equal(st.tmap.length, n * n);
  assert.equal(st.lakes[0]!.errors, 0);
  // The basin's corners wet the ring of tiles left and above it too: 13 x 13.
  assert.equal(st.lakes[0]!.tilecount, 13 * 13);
  assert.deepEqual([st.lakes[0]!.minx, st.lakes[0]!.maxx, st.lakes[0]!.minz, st.lakes[0]!.maxz], [394, 406, 444, 456]);
  assert.equal(st.tmap[400 + 450 * n], 1);
  assert.equal(seedIndex([lake], 0, 400, 450, n), 0);
  // A basin across the seam: cells 510..511 and 0..9 are one lake.
  const seam = basin8(n, 300, 300);
  for (let z = 100; z < 110; z++) for (const x of [510, 511, 0, 1, 2, 3, 4, 5, 6, 7]) seam[x + z * n] = 80;
  const sg: LakeGround = { raw: seam, tilemin: null, groundAtLevel: null, step: 0, pointU: null };
  const s2 = recomputeLakes(sg, [{ height: 399, flags: 1, seeds: [[511, 105]] }], 0);
  assert.equal(s2.lakes[0]!.errors, 0);
  assert.equal(s2.tmap[3 + 105 * n], 1);
  assert.equal(s2.lakes[0]!.minx, 509);
  assert.equal(s2.lakes[0]!.maxx, 7);
});

test("a version 2 .WTR: written for a 512 world, read back only with cells, refused by Traxx's 256 reader", () => {
  const n = 512;
  const g: LakeGround = { raw: basin8(n, 300, 300), tilemin: null, groundAtLevel: null, step: 0, pointU: null };
  const lakes = [{ height: 399, flags: 1, seeds: [[300, 300]] as [number, number][] }];
  const st = recomputeLakes(g, lakes, 0);
  const wtr = buildWtrV6(lakes, st)!;
  assert.ok(wtr);
  const parsed = parseWtr(wtr, { cells: n });
  assert.equal(parsed.major, 2);
  const back = parseWtrLakes(wtr, n)!;
  assert.deepEqual(back.lakes, lakes);
  assert.equal(back.tmap!.length, n * n);
  assert.equal(parseWtrLakes(wtr), null);
  // A 256 world is version 1, as Traxx writes it (the world's size picks the version, spec 9.1).
  const g256: LakeGround = { raw: basin8(256, 100, 100), tilemin: null, groundAtLevel: null, step: 0, pointU: null };
  const l256 = [{ height: 399, flags: 1, seeds: [[100, 100]] as [number, number][] }];
  const s256 = recomputeLakes(g256, l256, 0);
  assert.equal(parseWtr(buildWtr(l256, s256)!).major, 1);
  // A 256 map with a height version 1 cannot hold writes nothing (never a 256-cell version 2).
  assert.equal(buildWtr([{ ...l256[0]!, height: 5000 }], s256), null);
});

/*
  A 16-bit ground in u (1/64 ft) far above 512 ft: a 256 x 256 grid at 1500 ft with a 10 x 10
  basin at 1400 ft round (100, 100). Corners as tilemin; pointU the tile's own corner.
*/
function tallGround(n: number, high: number, low: number): LakeGround {
  const corner = new Int32Array(n * n).fill(high);
  for (let z = 95; z <= 105; z++) for (let x = 95; x <= 105; x++) corner[x + z * n] = low;
  // A pit far lower, for the water to spill to.
  for (let z = 10; z <= 12; z++) for (let x = 200; x <= 202; x++) corner[x + z * n] = low - 64 * 300;
  const tilemin = new Int32Array(n * n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const x1 = (x + 1) % n, z1 = (z + 1) % n;
      tilemin[x + z * n] = Math.min(corner[x + z * n]!, corner[x1 + z * n]!, corner[x + z1 * n]!, corner[x1 + z1 * n]!);
    }
  }
  const at = (tile: number, u: number) => {
    const x = tile % n, z = Math.floor(tile / n), x1 = (x + 1) % n, z1 = (z + 1) % n;
    return [corner[x + z * n], corner[x1 + z * n], corner[x + z1 * n], corner[x1 + z1 * n]].includes(u);
  };
  return { raw: null, tilemin, groundAtLevel: at, step: 1, pointU: (px, pz) => corner[(px & (n - 1)) + (pz & (n - 1)) * n]! };
}

test("lakes on a version 6 ground above 512 ft: heights are not capped at Traxx's 511.5 ft", () => {
  const g = tallGround(256, 1500 * 64, 1400 * 64);
  assert.ok(lakeMaxHeightFor(g) > LAKE_MAX_HEIGHT);
  // The rim is at 1500 ft = 3000 water units, so the basin holds up to just under it.
  const spill = lakeSpill(g, null, 0, 100, 100, -1);
  assert.equal(spill, 2999);
  const lake = { height: 2900, flags: 1, seeds: [[100, 100]] as [number, number][] };
  const st = recomputeLakes(g, [lake], 0);
  assert.equal(st.lakes[0]!.errors, 0);
  assert.equal(st.lakes[0]!.tilecount, 12 * 12);
  // 2800 is the basin floor's own level (CORNER_AT_H), so one water unit above it.
  assert.equal(lakeMinHeight(g, 0, lake), 2801);
  const wtr = buildWtrV6([lake], st)!;
  // 1450 ft is inside version 1's 0.5..2048 ft, so a 256 world keeps version 1.
  assert.equal(parseWtr(wtr, { cells: 256 }).major, 1);
  assert.equal(parseWtrLakes(wtr, 256)!.lakes[0]!.height, 2900);
});

test("lakes on a version 6 ground below 0 ft: held at 512 cells, an error at 256 (.WTR version 1)", () => {
  const g = tallGround(256, -100 * 64, -200 * 64);
  const spill = lakeSpill(g, null, 0, 100, 100, -1);
  assert.equal(spill, -201);
  const lake = { height: -300, flags: 1, seeds: [[100, 100]] as [number, number][] };
  const st = recomputeLakes(g, [lake], 0);
  // Below 0.5 ft on a 256-cell world: version 1 cannot hold it, so it is LAKEERR_HEIGHT only.
  assert.equal(st.lakes[0]!.errors, LAKEERR_HEIGHT);
  assert.equal(st.lakes[0]!.tilecount, 12 * 12);
  assert.equal(buildWtr([lake], st), null);
  assert.notEqual(lakeSpill(g, null, 0, 100, 100, -1), LAKE_NO_BASIN);
  // The same basin in a 512-cell world is a version 2 lake, no error.
  const g512 = tallGround(512, -100 * 64, -200 * 64);
  const s512 = recomputeLakes(g512, [lake], 0);
  assert.equal(s512.lakes[0]!.errors, 0);
  assert.equal(parseWtr(buildWtr([lake], s512)!, { cells: 512 }).major, 2);
});

function vegWithTree(xFt: number, zFt: number) {
  const v = emptyVegetation();
  v.species.push({ model: "TREE.BIN", farmodel: "", kind: VEG_KIND_PLACED, collide: 0, flags: 0, trunkdiam: 64, trunkheight: 16 });
  v.trees.push({ x: xFt * 256, y: 0, z: zFt * 256, species: 0, heading: 0, scale: 4096, tier: 0 });
  return v;
}

test("a .VEG in a 512-cell world: trees past 8192 ft are written and read with cells 512 only", () => {
  const v = vegWithTree(12000, 15000);
  assert.equal(buildVeg(v, "BIG"), null);
  const bytes = buildVeg(v, "BIG", "2026-11-13", 512)!;
  assert.ok(bytes);
  assert.equal(vegBoundsProblem(bytes, 512), null);
  assert.ok(vegBoundsProblem(bytes, 256));
  const back = emptyVegetation();
  assert.ok(vegParseImage(back, bytes, 512));
  assert.equal(back.trees.length, 1);
  assert.equal(back.trees[0]!.x, 12000 * 256);
  const narrow = emptyVegetation();
  vegParseImage(narrow, bytes);
  assert.equal(narrow.trees.length, 0);
});

test("the vegetation pass and planter ground follow N", () => {
  assert.deepEqual(vegWindow(0, 0, 0, true), { cx0: 0, cy0: 0, cx1: 255, cy1: 255 });
  assert.deepEqual(vegWindow(0, 0, 0, true, 512), { cx0: 0, cy0: 0, cx1: 511, cy1: 511 });
  assert.deepEqual(treeTile({ x: 12000 * 256, z: 100 * 256 }), [255, 3]);
  assert.deepEqual(treeTile({ x: 12000 * 256, z: 100 * 256 }, 512), [375, 3]);
  const raw = new Uint8Array(512 * 512).fill(10);
  raw[400 + 300 * 512] = 60;
  assert.equal(vegGroundHeightClassic8(raw, 400 * 32, 300 * 32), 120);
  // Wraps at N: the last column's far corner is column 0.
  assert.equal(vegGroundHeightClassic8(raw, 511 * 32 + 16, 0), 20);
});

test("a vegetation mask covers the whole world once: on 512 cells a pixel is twice the feet (spec 9.5)", () => {
  // The same 256 x 256 mask, a 16 x 8 pixel block at (100, 50), planted on a 256 and a 512-cell world.
  const w = 256, rgb = new Uint8Array(w * w * 3);
  for (let y = 50; y < 58; y++) for (let x = 100; x < 116; x++) rgb.set([0, 200, 0], (y * w + x) * 3);
  const img = { w, h: w, rgb };
  const plant = (cells: number) => {
    const v = emptyVegetation();
    v.seed = 42;
    const col = vegDefaultColour(VEG_LAYER_TREES);
    col.r = 0; col.g = 200; col.b = 0; col.spacing = 20; col.density = 100;
    const e = vegDefaultEntry(VEG_LAYER_TREES);
    e.model = "PINE.BIN";
    col.entries = [e];
    v.colours[VEG_LAYER_TREES] = [col];
    v.masks[VEG_LAYER_TREES] = { ext: ".PNG", data: Uint8Array.of(1) };
    const raw = new Uint8Array(cells * cells).fill(50);
    vegPlant({
      veg: v, cells, ground: (x, z) => vegGroundHeightClassic8(raw, x, z), waterLevel4: 0, lakeTiles: null, lakeHeights: [],
      groundBoxes: [], boxes: [], courses: [[]], trucks: [],
      model: (n) => (n.toUpperCase() === "PINE.BIN" ? { basez: -31, radiusFt: 4 } : null), images: [img, null],
    });
    return v.trees.map((t) => [t.x / 256, t.z / 256] as const);
  };
  for (const [cells, px] of [[256, 32], [512, 64]] as const) {
    const trees = plant(cells);
    assert.ok(trees.length > 50, `${cells}: planted ${trees.length}`);
    // px = floor(ft * size / W): the block is x 100..116 and z 50..58 pixels of W / 256 ft.
    for (const [x, z] of trees) assert.ok(x >= 100 * px && x < 116 * px && z >= 50 * px && z < 58 * px, `${cells}: tree at ${x},${z}`);
  }
});

test("a vegetation mask of 4096 a side (twice a 256-cell track's 2048) is taken, as any up to Traxx's 16384", () => {
  const side = 4096;
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    return out; // the reader does not check the CRC
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, side);
  new DataView(ihdr.buffer).setUint32(4, side);
  ihdr[8] = 8; ihdr[9] = 0; // 8-bit grey
  const raw = new Uint8Array(side * (side + 1));
  raw[1 + 5] = 200;
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  const { img, err } = vegDecodeMask({ ext: ".PNG", data: png });
  assert.equal(err, null);
  assert.deepEqual([img!.w, img!.h, img!.rgb[15]], [side, side, 200]);
});

test("waterfalls cut their notches in the N x N tile map (WFL version 2, spec 9.3)", () => {
  const w = fallDefaults();
  w.source = 1;
  w.npoints = 2;
  w.pt[0] = [100 * 16, 100 * 16];
  w.pt[1] = [120 * 16, 100 * 16];
  // The tile rule's form (Traxx 1.7.1): the notch tiles in the N x N map.
  const n256 = trackNotches({ falls: [w], lakeRule: LAKE_RULE_TILE })!;
  assert.equal(n256.notchlake!.length, 65536);
  const n512 = trackNotches({ worldCells: 512, falls: [w], lakeRule: LAKE_RULE_TILE })!;
  assert.equal(n512.notchlake!.length, 512 * 512);
  assert.equal(n512.hasnotch[1], 1);
  // Beyond 8,192 ft: the notch tile is past column 255 in a 512 world.
  w.pt[0] = [12000 * 16, 100 * 16];
  w.pt[1] = [12020 * 16, 100 * 16];
  const far = trackNotches({ worldCells: 512, falls: [w], lakeRule: LAKE_RULE_TILE })!;
  const tiles = [...far.notchlake!.keys()].filter((i) => far.notchlake![i]);
  assert.ok(tiles.length > 0 && tiles.every((i) => i % 512 === 375 && Math.floor(i / 512) === 3), String(tiles));
  // The edge rule's form (Traxx 1.7.3): the crest on the line z = 96 ft flows north, so every column's
  // notch edge is the S side of tile (375, 2), named once, in the 512 world's coordinates.
  w.pt[0] = [12000 * 16, 96 * 16];
  w.pt[1] = [12020 * 16, 96 * 16];
  const edges = trackNotches({ worldCells: 512, falls: [w] })!;
  assert.equal(edges.rule, LAKE_RULE_EDGE);
  assert.equal(edges.notchlake, null);
  assert.deepEqual(edges.edges, [{ lake: 1, x: 375, z: 2, dir: LAKE_DIR_S }]);
  assert.equal(edges.hasedge[1], 1);
  const e256 = trackNotches({ falls: [{ ...w, pt: [[1000 * 16, 96 * 16], [1020 * 16, 96 * 16], ...w.pt.slice(2)] }] })!;
  assert.deepEqual(e256.edges, [{ lake: 1, x: 31, z: 2, dir: LAKE_DIR_S }]);
});

import { writeWtr } from "../src/vendor/openphotex/mtm/wtr.js";
import { writePod1 } from "../src/vendor/openphotex/pod/write.js";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { newTrackDocument } from "../src/core/doc/new-track.ts";
import { buildTrackPod } from "../src/core/traxx/pod-writer.ts";
import { loadPodTrack } from "../src/core/doc/load-pod.ts";
import { LAKES_MISMATCH, storedLakesOf, trackLakes } from "../src/core/traxx/lakes.ts";

test("a pod whose lake map is not Traxx's fill keeps its map and file until a lake changes", async () => {
  // A pod with one lake of three tiles on ground Traxx's fill would flood: another tool's map.
  const out = buildTrackPod(newTrackDocument(), { date: new Date(2026, 10, 16) });
  const stem = out.entries.find((e) => /^WORLD\\.*\.SIT$/i.test(e.name))!.name.slice(6, -4);
  const tmap = new Uint8Array(256 * 256);
  for (const x of [100, 101, 102]) tmap[x + 100 * 256] = 1;
  const wtr = writeWtr([{ height: 200, flags: 1, seeds: [{ x: 101, z: 100 }], box: { minX: 100, minZ: 100, maxX: 102, maxZ: 100 }, tileCount: 3 }], tmap);
  const bytes = writePod1(out.comment, [...out.entries, { name: `WORLD\\${stem}.WTR`, data: wtr }]);
  const doc = await loadPodTrack({ archive: parsePod(bytes), read: async (e: { offset: number; length: number }) => readPodEntry(bytes, e) }, 0, "lake.pod");
  assert.ok(doc.warnings.includes(LAKES_MISMATCH));
  const t = doc.track;
  assert.ok(storedLakesOf(t), "the pod's map is kept");
  const st = trackLakes(t);
  assert.deepEqual(Array.from(st.tmap), Array.from(tmap), "the lakes are the pod's tiles");
  assert.deepEqual([st.lakes[0]!.tilecount, st.lakes[0]!.errors, st.lakes[0]!.minx, st.lakes[0]!.maxx, st.lakes[0]!.minz, st.lakes[0]!.maxz], [3, 0, 100, 102, 100, 100]);
  doc.viewOnly = false;
  const wtrOf = () => buildTrackPod(doc, { date: new Date(2026, 10, 16) }).entries.find((e) => /\.WTR$/i.test(e.name))?.data;
  assert.deepEqual(wtrOf(), wtr, "Write POD writes the pod's .WTR back unchanged");
  // A lake edit: Traxx's fill from then on; putting it back (an undo) brings the stored map back.
  t.lakes[0]!.height = 201;
  assert.equal(storedLakesOf(t), null);
  assert.notDeepEqual(Array.from(trackLakes(t).tmap), Array.from(tmap));
  assert.notDeepEqual(wtrOf(), wtr);
  t.lakes[0]!.height = 200;
  assert.ok(storedLakesOf(t));
  assert.deepEqual(wtrOf(), wtr);
});
