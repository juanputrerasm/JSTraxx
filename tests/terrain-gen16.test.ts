/*
  Generate Terrain for the 16-bit grids (TrackPOD/TrackPODTerrainGen.cpp), after
  tools/terraingentest.cpp. The hashes are of what Traxx 1.7.0's own TerrainGen8 / TerrainGenV
  made (the C++ built as-is, with MSVC's rand() and no fused multiply-add), as little-endian words.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateTerrain, type TerrainGenSettings } from "../src/core/edit/terrain-gen.ts";
import { terrainGenPreview, terrainGenTarget, terrainGenV } from "../src/core/edit/terrain-gen16.ts";

const SLIDERS = [
  [100, 50, 20, 40], [0, 0, 0, 0], [255, 255, 255, 100], [0, 255, 255, 0], [255, 0, 0, 100],
  [128, 128, 128, 50], [10, 200, 30, 100], [250, 30, 220, 0], [1, 255, 0, 73],
];
const SEEDS = [0, 1, 7, 42, 99, 128, 200, 255];

function params(mode: number, seed: number, s: number[]): TerrainGenSettings {
  return { mode, seed, ground: s[0]!, hillHeight: s[1]!, valleyDepth: s[2]!, smoothness: s[3]! };
}

function sha(v: Uint8Array | Uint16Array): string {
  let b: Uint8Array;
  if (v instanceof Uint16Array) {
    b = new Uint8Array(v.length * 2);
    for (let i = 0; i < v.length; i++) { b[2 * i] = v[i]! & 255; b[2 * i + 1] = v[i]! >> 8; }
  } else b = v;
  return createHash("sha256").update(b).digest("hex");
}

test("TerrainGen8 and TerrainGenV are byte for byte Traxx's", () => {
  const g8: [number, number, number, string][] = [
    [0, 0, 42, "e0d83a1445a2becd135268c9ea030361c54f9b1c6b12f48d94cd28df910faeae"],
    [1, 5, 42, "0af09c11f9c0206d16369b222b6118c0fc9f137efc2dd34837e8b846f69674c2"],
    [0, 2, 255, "d0c0af6b94822a7c0bbcb293107d7fc6706033e727331fd68debaec30a2e44b9"],
    [1, 8, 0, "9662a06286605025468c3c9b248a401feeb9fecb82d99453dde79f2a078084bb"],
  ];
  for (const [m, s, seed, h] of g8) assert.equal(sha(generateTerrain(params(m, seed, SLIDERS[s]!))), h, `gen8 ${m} ${s} ${seed}`);
  const v256: [number, number, number, string][] = [
    [0, 0, 42, "2f44755eaacf48e1c6dca6b843acc5a90ddf16d667058890efa33e02ef6272b6"],
    [1, 5, 42, "c34ab077d66e58505d031dfbd934c726021848f6e3847c8cfecbf0b44f37e78e"],
    [0, 6, 7, "e21317796c6fc6f8cb87a9db49fcb05ded4a99b68065c8e4e8f878d26678c3cc"],
    [1, 2, 255, "7545ba3d2ef005d84510f9db47c4a42dcde7a44e3395404298f593c6c0e216b2"],
  ];
  for (const [m, s, seed, h] of v256) assert.equal(sha(terrainGenV(params(m, seed, SLIDERS[s]!), 256)!), h, `v256 ${m} ${s} ${seed}`);
  const v1024: [number, number, number, string][] = [
    [0, 0, 0, "e4f750d5d88067fe0891a15cf1c56b77ec352d46688b7d962499541c1f11fe6f"],
    [1, 0, 1, "7575333d81f2f46c3d438076561a5d951c29fdf84b703296524e57fe50e76ddf"],
    [0, 2, 1, "4d366a1787002dfe28aebd9937eb76ccbb591e76e0ca9a6791cf5d178eddaa11"],
    [1, 8, 0, "0bbcf93a35ae95aa353ebc5ae3c72ccc1b75b3da626ae2b9d1659c1805ac766c"],
  ];
  for (const [m, s, seed, h] of v1024) assert.equal(sha(terrainGenV(params(m, seed, SLIDERS[s]!), 1024)!), h, `v1024 ${m} ${s} ${seed}`);
});

// 3. TerrainGenV(256) is TerrainGen8's landscape without the truncations.
test("TerrainGenV(256) is the same landscape as TerrainGen8", () => {
  for (let mode = 0; mode < 2; mode++) for (const s of SLIDERS) for (const seed of SEEDS) {
    const p = params(mode, seed, s);
    const b = generateTerrain(p), v = terrainGenV(p, 256)!;
    let sum = 0, madround = 0, ma = 0, mb = 0;
    for (let i = 0; i < 65536; i++) {
      sum += v[i]! / 256 - b[i]!;
      madround += Math.abs(((v[i]! + 128) >> 8) - b[i]!);
      ma += v[i]! / 256;
      mb += b[i]!;
    }
    const mean = sum / 65536;
    ma /= 65536; mb /= 65536;
    let centred = 0, sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < 65536; i++) {
      centred += Math.abs(v[i]! / 256 - b[i]! - mean);
      const x = v[i]! / 256 - ma, y = b[i]! - mb;
      sab += x * y; saa += x * x; sbb += y * y;
    }
    centred /= 65536;
    const label = `${mode} ${s.join(",")} ${seed}`;
    if (Math.sqrt(saa / 65536) < 0.5 || Math.sqrt(sbb / 65536) < 0.5) assert.ok(centred < 1, label);
    else assert.ok(sab / Math.sqrt(saa * sbb) > 0.95, label);
    assert.ok(madround / 65536 < 20, label);
  }
});

// 3b. The 16-bit path is not terraced.
test("TerrainGenV(256) leaves real fractions", () => {
  for (const p of [params(0, 42, SLIDERS[0]!), params(1, 42, SLIDERS[5]!)]) {
    const v = terrainGenV(p, 256)!;
    assert.ok(v.filter((x) => (x & 255) !== 0).length > 60000);
  }
});

// 4. Deterministic per seed, in range, a different seed a different map, bad sizes refused.
test("TerrainGenV(1024): deterministic, in range, seeded, sizes checked", () => {
  for (let mode = 0; mode < 2; mode++) for (const s of SLIDERS) for (const seed of SEEDS.slice(0, 2)) {
    const p = params(mode, seed, s);
    const a = terrainGenV(p, 1024)!, b = terrainGenV(p, 1024)!;
    assert.deepEqual(a, b);
    let lo = 65535, hi = 0;
    for (const x of a) { if (x < lo) lo = x; if (x > hi) hi = x; }
    assert.ok(hi <= 255 * 256);
    if (mode === 0 && p.ground >= 1) assert.ok(lo >= 256);
  }
  for (let mode = 0; mode < 2; mode++) assert.notDeepEqual(terrainGenV(params(mode, 3, SLIDERS[0]!), 1024), terrainGenV(params(mode, 4, SLIDERS[0]!), 1024));
  // Traxx origin/main: 512 (a 512 world's coarse grid) and 2048 (its Full Map) are made too; any other size is refused.
  assert.equal(terrainGenV(params(0, 1, SLIDERS[0]!), 512)?.length, 512 * 512);
  assert.equal(terrainGenV(params(0, 1, SLIDERS[0]!), 300), null);
  assert.equal(terrainGenV(params(0, 1, SLIDERS[0]!), 0), null);
});

// 4b. The 1024 grid has the 256 grid's large shape.
test("TerrainGenV(1024) has the 256 grid's spread of heights", () => {
  for (let mode = 0; mode < 2; mode++) {
    const p = params(mode, 9, SLIDERS[0]!);
    const v = terrainGenV(p, 256)!, f = terrainGenV(p, 1024)!;
    const stats = (a: Uint16Array) => {
      let m = 0;
      for (const x of a) m += x;
      m /= a.length;
      let s = 0;
      for (const x of a) s += (x - m) * (x - m);
      return { m, s: Math.sqrt(s / a.length) };
    };
    const a = stats(v), b = stats(f);
    assert.ok(Math.abs(a.m - b.m) < 12 * 256);
    assert.ok(b.s > 0.4 * a.s && b.s < 2.5 * a.s);
  }
});

test("the dialog set-up per terrain mode, and the preview", () => {
  // Traxx origin/main OnEditGenTerrain's "For:" lines, on a 256 and a 512 world.
  assert.deepEqual(terrainGenTarget(0), { gridSize: 256, precise: false, forText: "For: Traditional 8-bit" });
  assert.deepEqual(terrainGenTarget(1), { gridSize: 256, precise: true, forText: "For: 16-bit Classic (256 × 32 ft)" });
  assert.deepEqual(terrainGenTarget(2), { gridSize: 256, precise: true, forText: "For: Finer Heights 16-bit Spline (256 × 32 ft)" });
  assert.deepEqual(terrainGenTarget(3), { gridSize: 1024, precise: true, forText: "For: Precision 8 ft grid and 16-bit Heights Full Map (1024 × 8 ft)" });
  assert.deepEqual(terrainGenTarget(1, 512), { gridSize: 512, precise: true, forText: "For: 16-bit Classic (512 × 32 ft)" });
  assert.deepEqual(terrainGenTarget(2, 512), { gridSize: 512, precise: true, forText: "For: Finer Heights 16-bit Spline (512 × 32 ft)" });
  assert.deepEqual(terrainGenTarget(3, 512), { gridSize: 2048, precise: true, forText: "For: Precision 8 ft grid and 16-bit Heights Full Map (2048 × 8 ft)" });
  assert.deepEqual([...terrainGenPreview(new Uint16Array([0, 255, 256, 65535]))], [0, 0, 1, 255]);
});
