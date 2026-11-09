/*
  The vegetation pass (COpenGLTerrainRenderer::DrawVegetation, Traxx/OpenGLTerrainRenderer.cpp)
  and the engine's instancing test (TrackPOD/TrackPODInstancing.cpp ModelWillInstance) with
  VegFarCardBaseY (Traxx/VegetationFarCard.cpp).

  The cp4sandbox check resolves fog_test.pod's species against its own models (JSTRAXX_CP4,
  default ~/games/cp4sandbox) and skips when the pod is absent.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import { modelInstanceProblem, vegFarCardBaseY } from "../src/core/traxx/instancing.ts";
import { objectMatrix } from "../src/core/view/model-geometry.ts";
import { modelGeometry } from "../src/core/view/model-geometry.ts";
import { emptyVegetation, vegParseImage, VEG_FLAG_CROSSFADE, VEG_FLAG_FACING } from "../src/core/traxx/veg.ts";
import {
  clumpHeadingIndex, clumpScene, facingCosSin, farBand, headingCosSin, keepClump, plantHash, plantMatrix, resolveVegSpecies,
  treeHeadingIndex, treeScene, treeTile, useFarCard, vegModelFacts, vegWindow,
} from "../src/core/view/veg-draw.ts";

const CP4 = process.env.JSTRAXX_CP4 ?? join(process.env.HOME ?? "", "games", "cp4sandbox");
const POD = join(CP4, "fog_test.pod");

/* A model: MAGNIFY, a VLIST of `verts`, a TEXTURE, then `faces` ([opcode, ...corner indices]), EOL. */
function bin(verts: [number, number, number][], faces: number[][], { texture = "PINE.RAW", power = 65536, material = null as number | null } = {}): Uint8Array {
  const w: number[] = [20, power, 2, 0, verts.length];
  for (const v of verts) w.push(...v);
  if (material !== null) w.push(63, material, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  const tex = [13, 0, 0, 0, 0, 0];
  const name = new TextEncoder().encode(texture);
  const tb = new Uint8Array(16);
  tb.set(name.slice(0, 16));
  const tw = new Int32Array(tb.buffer);
  tex.splice(2, 4, ...tw);
  w.push(...tex);
  for (const [op, ...idx] of faces) {
    w.push(op!, idx.length, 0, 0, 0, 0);
    for (const i of idx) w.push(i, 0, op === 17 ? i : 0);
  }
  w.push(0);
  return new Uint8Array(new Int32Array(w).buffer);
}

const TRI: [number, number, number][] = [[0, -100, 0], [100, 0, 0], [0, 400, 50]];

test("ModelWillInstance: textured facets instance; flat colour, no texture and bad indices do not", () => {
  assert.equal(modelInstanceProblem(bin(TRI, [[14, 0, 1, 2]])), null);
  assert.equal(modelInstanceProblem(bin(TRI, [[17, 0, 1, 2]])), null);
  assert.match(modelInstanceProblem(bin(TRI, [[5, 0, 1, 2]]))!, /opcode 5/);
  assert.match(modelInstanceProblem(bin(TRI, [[14, 0, 1, 7]]))!, /vertex index \(7\)/);
  assert.match(modelInstanceProblem(bin(TRI, [[14, 0, 1]]))!, /2 points/);
  assert.match(modelInstanceProblem(bin(TRI, []))!, /no drawable face/);
  assert.match(modelInstanceProblem(bin(TRI, [[14, 0, 1, 2]], { texture: "" }))!, /empty name/);
  assert.match(modelInstanceProblem(new Uint8Array(new Int32Array([7, 0]).buffer))!, /neither MAGNIFY nor a keyframe/);
  assert.equal(modelInstanceProblem(null), "the model has no data");
  // Materials: two-sided needs alpha-test; blend flags keep it off.
  assert.equal(modelInstanceProblem(bin(TRI, [[64, 0, 1, 2]], { material: 0x0088 })), null);
  assert.match(modelInstanceProblem(bin(TRI, [[64, 0, 1, 2]], { material: 0x0080 }))!, /two-sided without alpha-test/);
  assert.match(modelInstanceProblem(bin(TRI, [[64, 0, 1, 2]], { material: 0x0010 }))!, /0x0010/);
  // The glass trick: a cutout face with all its corners on one texture point.
  const glass = bin(TRI, [[51, 0, 1, 2]]);
  const g = new Int32Array(glass.buffer);
  const facet = g.length - 1 - (6 + 9);
  for (let k = 0; k < 3; k++) { g[facet + 6 + k * 3 + 1] = 5; g[facet + 6 + k * 3 + 2] = 5; }
  assert.match(modelInstanceProblem(glass)!, /glass trick/);
  // The stream ends at an unknown record: what came before still counts.
  const cut = bin(TRI, [[14, 0, 1, 2]]);
  const c = new Int32Array(cut.buffer);
  c[c.length - 1] = 99;
  assert.equal(modelInstanceProblem(cut), null);
});

test("VegFarCardBaseY: the first VLIST's lowest y (the second int), scaled by MAGNIFY", () => {
  assert.deepEqual(vegFarCardBaseY(bin(TRI, [[14, 0, 1, 2]])), { fileMinY: -100, engineMinY: -100 });
  // power 32768: (0x7FFFFFFF / 32768) * 2 = 131070; -100 * 131070 >> 16 = -200 (floor).
  assert.deepEqual(vegFarCardBaseY(bin(TRI, [[14, 0, 1, 2]], { power: 32768 })), { fileMinY: -100, engineMinY: -200 });
  // power 16384: (0x7FFFFFFF / 16384) * 2 = 262142; -100 * 262142 >> 16 = -400 (floor).
  assert.deepEqual(vegFarCardBaseY(bin(TRI, [[14, 0, 1, 2]], { power: 16384 })), { fileMinY: -100, engineMinY: -400 });
  assert.equal(vegFarCardBaseY(new Uint8Array(new Int32Array([20, 1, 13, 0, 0, 0, 0, 0, 0]).buffer)), null);
});

test("a tree's matrix is the box matrix at its heading, scaled by scale / 4096", () => {
  const t = { x: 70000, y: 25600, z: 123456, heading: 12345, scale: 6144 };
  const [x, y, z] = treeScene(t);
  assert.deepEqual([x, y, z], [70000 / 128, 123456 / 128, 150]);
  const [cs, sn] = headingCosSin(treeHeadingIndex(t.heading));
  const m: number[] = new Array(16);
  plantMatrix(m, 0, [x, y, z], cs, sn, t.scale / 4096);
  const psi = (2 * Math.PI * (((t.heading + 8) >> 4) & 4095)) / 4096;
  const box = objectMatrix({ ipos: [0, 0, 0], fraction: [0, 0, 0], theta: 0, phi: 0, psi });
  for (let i = 0; i < 12; i++) assert.ok(Math.abs(m[i]! - 1.5 * box[i]!) < 1e-6, `element ${i}`);
  assert.deepEqual(m.slice(12), [x, y, z, 1]);
});

test("heading tables, positions and tiles", () => {
  assert.equal(treeHeadingIndex(0), 0);
  assert.equal(treeHeadingIndex(7), 0);
  assert.equal(treeHeadingIndex(8), 1);
  assert.equal(treeHeadingIndex(65535), 0);
  assert.equal(clumpHeadingIndex(255), 4080);
  assert.deepEqual(clumpScene({ tx: 3, tz: 4, fx: 8, fz: 255, y: 512 }), [192 + 2, 256 + 63.75, 3]);
  assert.deepEqual(treeTile({ x: 8192 * 10 + 5, z: -1 }), [10, 0]);
  assert.deepEqual(treeTile({ x: 8192 * 300, z: 8191 }), [255, 0]);
});

test("far cards: 900 to 1000 ft dithered with the cross-fade flag, a hard 950 without", () => {
  assert.deepEqual(farBand(VEG_FLAG_CROSSFADE), [900, 1000]);
  assert.deepEqual(farBand(0), [950, 950]);
  assert.equal(useFarCard(899, [900, 1000], 1), false);
  assert.equal(useFarCard(1000, [900, 1000], 1), true);
  assert.equal(useFarCard(949.9, [950, 950], 1), false);
  assert.equal(useFarCard(950, [950, 950], 1), true);
  // In the band about the fraction crossed turn to cards, the same ones every time.
  const at = (d: number) => [...Array(10000).keys()].filter((i) => useFarCard(d, [900, 1000], i)).length;
  assert.ok(Math.abs(at(925) - 2500) < 300);
  assert.ok(Math.abs(at(975) - 7500) < 300);
  assert.equal(plantHash(1), (2654435761 >>> 16) & 0xffff);
});

test("grass: all of it to 750 ft, thinning to none at 1000", () => {
  assert.equal(keepClump(750, 123), true);
  assert.equal(keepClump(1000.01, 0), false);
  const kept = (d: number) => [...Array(10000).keys()].filter((i) => keepClump(d, i)).length;
  assert.equal(kept(700), 10000);
  assert.ok(Math.abs(kept(875) - 5000) < 300);
  assert.ok(kept(999) < 100);
});

test("the facing yaw lays the card across the camera's right", () => {
  const [cs, sn] = facingCosSin(0, 2);
  // Model x goes to (cs, -sn): the camera's right, normalised.
  assert.ok(Math.abs(cs) < 1e-12 && Math.abs(-sn - 1) < 1e-12);
  assert.deepEqual(facingCosSin(0, 0), [1, 0]);
});

test("the window is the terrain's cells, or the whole map", () => {
  assert.deepEqual(vegWindow(128, 100, 97, false), { cx0: 80, cy0: 52, cx1: 175, cy1: 147 });
  assert.deepEqual(vegWindow(5, 5, 97, true), { cx0: 0, cy0: 0, cx1: 255, cy1: 255 });
});

test("species: a card only when it and the model instance; a facing species has none", () => {
  const good = bin(TRI, [[14, 0, 1, 2]]);
  const flat = bin([[-100, -100, 0], [100, -100, 0], [100, 300, 1], [-100, 300, 0]], [[14, 0, 1, 2], [14, 0, 2, 3]]);
  const bad = bin(TRI, [[5, 0, 1, 2]]);
  const models: Record<string, Uint8Array> = { "TREE.BIN": good, "CARD.BIN": flat, "BAD.BIN": bad };
  const find = (n: string) => {
    const b = models[n.toUpperCase()];
    if (!b) return null;
    const g = modelGeometry(b)!;
    const vertices = Float32Array.from(g.groups.flatMap((x) => [...x.positions].map((p) => p * 64)));
    return { name: `MODELS\\${n}`, bytes: b, vertices };
  };
  const sp = (model: string, farmodel: string, flags: number) => ({ model, farmodel, kind: 0, collide: 0, flags, trunkdiam: 0, trunkheight: 0 });
  const v = { species: [sp("TREE.BIN", "CARD.BIN", VEG_FLAG_CROSSFADE), sp("TREE.BIN", "CARD.BIN", VEG_FLAG_FACING), sp("BAD.BIN", "CARD.BIN", 0), sp("NONE.BIN", "", 0)] };
  const d = resolveVegSpecies(v, find, (b) => modelInstanceProblem(b) === null, (b) => vegFarCardBaseY(b)?.engineMinY ?? null);
  assert.equal(d[0]!.model, "MODELS\\TREE.BIN");
  assert.equal(d[0]!.far, "MODELS\\CARD.BIN");
  assert.equal(d[0]!.farFlat, true);
  // sp.minY - fsp.minY in polyobj units: (-100 - -100) / 2.
  assert.equal(d[0]!.farLift, 0);
  assert.equal(d[1]!.far, null);
  assert.equal(d[1]!.facing, true);
  assert.equal(d[2]!.model, "MODELS\\BAD.BIN");
  assert.equal(d[2]!.far, null);
  assert.equal(d[3]!.model, null);
  assert.equal(vegModelFacts(find("TREE.BIN")!.vertices).flat, false);
});

test("fog_test.pod: every species resolves to its model and far card", { skip: existsSync(POD) ? false : `no ${POD}` }, async () => {
  const pod = new Uint8Array(readFileSync(POD));
  const archive = parsePod(pod);
  const entry = async (name: string) => {
    const e = archive.entries.find((x: { name: string }) => x.name.toUpperCase() === name.toUpperCase());
    return e ? await readPodEntry(pod, e) : null;
  };
  const v = emptyVegetation();
  assert.ok(vegParseImage(v, (await entry("WORLD\\FOGTEST.VEG"))!));
  const cache = new Map<string, Uint8Array | null>();
  for (const s of v.species) for (const n of [s.model, s.farmodel]) if (n) cache.set(n, await entry(`MODELS\\${n}`));
  const find = (n: string) => {
    const b = cache.get(n) ?? null;
    const g = b ? modelGeometry(b) : null;
    return b && g ? { name: `MODELS\\${n}`, bytes: b, vertices: Float32Array.from(g.groups.flatMap((x) => [...x.positions].map((p) => p * 64))) } : null;
  };
  const d = resolveVegSpecies(v, find, (b) => modelInstanceProblem(b) === null, (b) => vegFarCardBaseY(b)?.engineMinY ?? null);
  assert.deepEqual(d.map((x) => [x.model, x.far]), [
    ["MODELS\\AK8PINEA.BIN", "MODELS\\V208715A8.BIN"], ["MODELS\\HORSE.BIN", "MODELS\\V91534924.BIN"],
    ["MODELS\\AK8PINEA.BIN", "MODELS\\V208715A8.BIN"], ["MODELS\\HORSE.BIN", null],
  ]);
  // The pine's card is seated by (sp.minY - fsp.minY) / 2 polyobj units: (-25600 + 25701) / 2.
  assert.equal(d[0]!.farLift, 50.5);
  assert.deepEqual(d.map((x) => x.band), [[900, 1000], [900, 1000], [900, 1000], [950, 950]]);
  assert.equal(v.trees.length, 12394);
  assert.equal(v.clumps.length, 131072);
});
