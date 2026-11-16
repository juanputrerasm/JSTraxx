/*
  Traxx 1.7.3's lakes (TrackPOD/TrackPODLakes.cpp at 4364111), ported from Traxx's own console test
  tools/laketest.cpp: the EDGE rule (water crosses between 4-neighbours only through an edge whose
  lowest point is <= H), the heap order of the spill for both rules, the notch EDGES and the lip
  rule, the seed on a lip, the .WTR header's rule, where a leak gets out (escape) and where the
  ground is exactly at H (the CORNER_AT_H points), then the same on the 16-bit and Full Map grounds
  and in a 512-cell world.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWtr, lakeAt, lakeFitHeight, lakeHasNotches, lakeHoldsUpTo, lakeNearestLegalHeight, lakeNotches, lakeSpill, lakeSpillAt, parseWtrLakes,
  recomputeLakes, LAKEERR_CORNER_AT_H, LAKEERR_LEAK, LAKEERR_SEED_ABOVE_WATER, LAKE_DIR_E, LAKE_MAX_HEIGHT, LAKE_NO_BASIN, LAKE_RULE_EDGE,
  LAKE_RULE_TILE, lakeDefaultRule, type LakeNotchEdge, type LakeNotches, type LakesState,
} from "../src/core/traxx/lakes.ts";
import { LAKE_LIP_W } from "../src/core/traxx/lake-ground.ts";
import type { TxxLake } from "../src/core/traxx/txx.ts";
import { readTxx, writeTxx } from "../src/core/traxx/txx.ts";
import { buildLakeGround, setMode, type LakeGround } from "../src/core/traxx/surface.ts";
import { resetTrack } from "../src/core/doc/new-track.ts";
import { TERRAINMODE_CLASSIC16, TERRAINMODE_FINE } from "../src/core/traxx/terrain16.ts";
import { lakeProblemsText } from "../src/ui/dialogs/lake-dialog.ts";

/* assert.ok without the narrowing (the checks re-read fields the code under test changes). */
const ok: (value: unknown, message?: string) => void = assert.ok;
const NTILE = (x: number, z: number) => x + (z << 8);
const raw = new Uint8Array(65536);
const g8 = (): LakeGround => ({ raw, tilemin: null, groundAtLevel: null });
const lake = (h: number, x: number, z: number): TxxLake => ({ height: h, flags: 1, seeds: [[x, z]] });
/* A rule-only notch input (no notch): the rule the lakes run. */
const rule = (r: number): LakeNotches | null => lakeNotches(null, null, null, r);
const fill = (lakes: TxxLake[], r: number, body0 = 0, n: LakeNotches | null = rule(r)) => recomputeLakes(g8(), lakes, body0, n);
const spill = (r: number, x: number, z: number, body0 = 0, tmap: Uint8Array | null = null, lakes: TxxLake[] | null = null, n: LakeNotches | null = rule(r)) =>
  lakeSpill(g8(), tmap, body0, x, z, lakes ? 0 : -1, n, lakes);

function wrap(a: number, b: number): number {
  const d = (a - b) & 255;
  return d > 128 ? 256 - d : d;
}
/* Bowl: wrapped Chebyshev distance d <= r floor; r < d <= r + 2 rim; otherwise outside. */
function bowl(cx: number, cz: number, r: number, floor: number, rim: number, outside: number): void {
  for (let z = 0; z < 256; z++) for (let x = 0; x < 256; x++) {
    const d = Math.max(wrap(x, cx), wrap(z, cz));
    raw[x + (z << 8)] = d <= r ? floor : d <= r + 2 ? rim : outside;
  }
}
/* Ring: a ring of byte 50 on vertices lo..lo+n (wrapping), floor 20 inside, outside 10. */
function ring(lo: number, n: number): void {
  raw.fill(10);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) raw[((lo + i) & 255) + (((lo + j) & 255) << 8)] = i === 0 || j === 0 || i === n || j === n ? 50 : 20;
}
function plateauBowl(cx: number, cz: number, plate: number, floor: number): void {
  raw.fill(20);
  for (let dz = -7; dz <= 7; dz++) for (let dx = -7; dx <= 7; dx++) raw[((cx + dx) & 255) + (((cz + dz) & 255) << 8)] = plate;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) raw[((cx + dx) & 255) + (((cz + dz) & 255) << 8)] = floor;
}
function eastSlope(): void {
  const col = [70, 60, 50, 45, 55, 65, 75];
  raw.fill(80);
  for (let z = 0; z < 256; z++) for (let x = 109; x < 256; x++) raw[NTILE(x, z)] = 10;
  for (let z = 103; z < 108; z++) for (let x = 103; x < 108; x++) raw[NTILE(x, z)] = 10;
  for (let z = 102; z <= 108; z++) raw[NTILE(108, z)] = col[z - 102]!;
}
function diag(lo: number, thick: boolean): void {
  raw.fill(5);
  for (let z = 100; z < 256; z++) for (let x = 100; x < 256; x++) {
    const s = x + z;
    if (x === 100 || z === 100 || s === lo || (thick && s === lo + 1)) raw[NTILE(x, z)] = 80;
    else if (s < lo) raw[NTILE(x, z)] = 10;
  }
}
function notchRaw(lip: number, far: number): void {
  raw.fill(80);
  for (let z = 0; z < 256; z++) for (let x = 110; x < 256; x++) raw[NTILE(x, z)] = 10;
  for (let z = 103; z < 108; z++) for (let x = 103; x < 108; x++) raw[NTILE(x, z)] = 10;
  raw[NTILE(108, 104)] = raw[NTILE(108, 105)] = lip;
  raw[NTILE(109, 104)] = raw[NTILE(109, 105)] = far;
}
const NE: LakeNotchEdge = { lake: 1, x: 107, z: 104, dir: LAKE_DIR_E };
const edgeNotch = (edges: LakeNotchEdge[] = [NE]) => lakeNotches(null, null, edges, LAKE_RULE_EDGE);
const tileNotch = (r: number) => {
  const nl = new Uint8Array(65536), lp = new Uint8Array(65536);
  nl[NTILE(108, 104)] = 1;
  lp[NTILE(108, 104)] = LAKE_LIP_W;
  return lakeNotches(nl, lp, null, r);
};
const count = (st: LakesState) => st.tmap.reduce((n, v) => n + (v === 1 ? 1 : 0), 0);
const sameLakes = (a: LakesState, b: LakesState) => Buffer.from(a.tmap).equals(Buffer.from(b.tmap)) &&
  a.lakes.every((l, i) => l.errors === b.lakes[i]!.errors && l.spill === b.lakes[i]!.spill && l.tilecount === b.lakes[i]!.tilecount);

test("the default rule is EDGE", () => {
  assert.equal(lakeDefaultRule(), LAKE_RULE_EDGE);
  assert.equal(recomputeLakes(null, [], 0).rule, LAKE_RULE_EDGE);
});

test("a one-vertex ridge holds to 199 under EDGE; the tile rule's flood goes down at once (test_edge_ridge, test_edge_wrap)", () => {
  ring(100, 10);
  let st = fill([lake(100, 105, 105)], LAKE_RULE_EDGE);
  assert.equal(st.lakes[0]!.errors, 0);
  ok(st.lakes[0]!.tilecount === 100 && st.lakes[0]!.spill === 199);
  assert.equal(spill(LAKE_RULE_EDGE, 105, 105), 199);
  const L = [lake(100, 105, 105)];
  ok(lakeAt(st, L, 100, 100) === 0 && lakeAt(st, L, 109, 109) === 0 && lakeAt(st, L, 110, 105) === -1 && lakeAt(st, L, 99, 105) === -1);
  assert.equal(count(st), 100);
  ok(fill([lake(199, 105, 105)], LAKE_RULE_EDGE).lakes[0]!.errors === 0);
  ok(fill([lake(200, 105, 105)], LAKE_RULE_EDGE).lakes[0]!.errors & LAKEERR_LEAK);
  st = fill([lake(100, 105, 105)], LAKE_RULE_TILE);
  ok(st.lakes[0]!.spill === LAKE_NO_BASIN && st.lakes[0]!.errors & LAKEERR_LEAK);
  assert.equal(spill(LAKE_RULE_TILE, 105, 105), LAKE_NO_BASIN);
  // across the map edge: vertices 250..4
  ring(250, 10);
  st = fill([lake(100, 0, 0)], LAKE_RULE_EDGE);
  ok(st.lakes[0]!.errors === 0 && st.lakes[0]!.tilecount === 100 && st.lakes[0]!.spill === 199);
  const W = [lake(100, 0, 0)];
  ok(lakeAt(st, W, 250, 250) === 0 && lakeAt(st, W, 3, 3) === 0 && lakeAt(st, W, 4, 0) === -1 && lakeAt(st, W, 249, 0) === -1);
  assert.deepEqual([st.lakes[0]!.minx, st.lakes[0]!.maxx, st.lakes[0]!.minz, st.lakes[0]!.maxz], [250, 3, 250, 3]);
});

test("a bowl both rules agree on, a sloping east wall (the lowest EDGE pours), a diagonal staircase (test_edge_bowl, _east_slope, _diagonal_staircase)", () => {
  plateauBowl(105, 105, 80, 10);
  for (const r of [LAKE_RULE_EDGE, LAKE_RULE_TILE]) {
    const st = fill([lake(100, 104, 104)], r);
    ok(st.lakes[0]!.errors === 0 && st.lakes[0]!.tilecount === 36 && st.lakes[0]!.spill === 319, `rule ${r}`);
  }
  eastSlope();
  let st = fill([lake(179, 104, 104)], LAKE_RULE_EDGE);
  ok(st.lakes[0]!.errors === 0 && st.lakes[0]!.tilecount === 36 && st.lakes[0]!.spill === 179);
  st = fill([lake(181, 104, 104)], LAKE_RULE_EDGE);
  ok(st.lakes[0]!.errors & LAKEERR_LEAK);
  ok(st.lakes[0]!.spill === 179, "the spill");
  ok(st.lakes[0]!.escape === NTILE(108, 104), "the escape");
  diag(210, true);
  st = fill([lake(100, 104, 104)], LAKE_RULE_EDGE);
  ok(st.lakes[0]!.errors === 0 && st.lakes[0]!.tilecount === 53 && st.lakes[0]!.spill === 319);
  st = fill([lake(100, 104, 104)], LAKE_RULE_TILE);
  ok(st.lakes[0]!.spill === LAKE_NO_BASIN && st.lakes[0]!.errors & LAKEERR_LEAK);
});

test("the heap's ties: the lowest key, then z, then x, for both rules (test_edge_heap_tie_order)", () => {
  bowl(100, 100, 3, 10, 50, 5);
  const o1 = NTILE(96, 95), o2 = NTILE(104, 100);
  const L = [lake(121, 100, 100)];
  const e = fill(L, LAKE_RULE_EDGE), t = fill(L, LAKE_RULE_TILE);
  ok(e.tmap[o1] === 0 && e.tmap[o2] === 0 && t.tmap[o1] === 0 && t.tmap[o2] === 0);
  const sp = (r: number, tm: Uint8Array) => lakeSpill(g8(), tm, 0, 100, 100, 0, rule(r), L);
  ok(sp(LAKE_RULE_EDGE, e.tmap) === 199 && sp(LAKE_RULE_TILE, t.tmap) === 199);
  e.tmap[o1] = t.tmap[o1] = 2;
  assert.equal(sp(LAKE_RULE_TILE, t.tmap), LAKE_NO_BASIN);
  assert.equal(sp(LAKE_RULE_EDGE, e.tmap), 199);
  e.tmap[o1] = t.tmap[o1] = 0;
  e.tmap[o2] = t.tmap[o2] = 2;
  assert.equal(sp(LAKE_RULE_TILE, t.tmap), 199);
  assert.equal(sp(LAKE_RULE_EDGE, e.tmap), 199);
});

test("the notch EDGE: closed to the fill, its lip points at H read H + 1 (test_edge_notch_classic8)", () => {
  notchRaw(25, 22);
  let st = fill([lake(100, 104, 104)], LAKE_RULE_EDGE);
  ok(st.lakes[0]!.errors & LAKEERR_LEAK);
  const n = edgeNotch();
  ok(lakeHasNotches(n, 0) && !lakeHasNotches(n, 1) && n!.edges.length === 1);
  const L = [lake(100, 104, 104)];
  st = recomputeLakes(g8(), L, 0, n);
  ok(st.lakes[0]!.errors === 0 && st.lakes[0]!.tilecount === 36);
  ok(lakeAt(st, L, 108, 104) === -1 && lakeAt(st, L, 107, 104) === 0);
  assert.equal(lakeHoldsUpTo(g8(), L, st, 0, 0), 100);
  assert.equal(lakeNearestLegalHeight(g8(), L[0]!, 100, 41, 100, n, 0), 100);
  assert.equal(lakeFitHeight(g8(), L[0]!, 100, 100, n, 0), 100);
  for (let h = 92; h <= 100; h++) {
    const Lh = [lake(h, 104, 104)];
    const s = recomputeLakes(g8(), Lh, 0, n);
    ok(s.lakes[0]!.errors === 0 && lakeHoldsUpTo(g8(), Lh, s, 0, 0) === 100, `h ${h}`);
  }
  ok(recomputeLakes(g8(), [lake(101, 104, 104)], 0, n).lakes[0]!.errors & LAKEERR_LEAK);
  // the tile form (lip bit W of the notch tile) gives the same lake under EDGE
  const viaTile = tileNotch(LAKE_RULE_EDGE);
  ok(lakeHasNotches(viaTile, 0) && viaTile!.edges.length === 0);
  ok(sameLakes(recomputeLakes(g8(), L, 0, viaTile), st));
  // a side-wall corner at H that is not a lip point leaks; a lip point below H keeps its height; above H holds
  raw[NTILE(108, 103)] = 25;
  ok(recomputeLakes(g8(), L, 0, n).lakes[0]!.errors & LAKEERR_LEAK);
  notchRaw(24, 22);
  ok(recomputeLakes(g8(), L, 0, n).lakes[0]!.errors & LAKEERR_LEAK);
  notchRaw(26, 22);
  st = recomputeLakes(g8(), L, 0, n);
  ok(st.lakes[0]!.errors === 0 && st.lakes[0]!.tilecount === 36);
  // one crest over two notch edges: the shared end point counts as H + 1 toward the walls
  notchRaw(25, 22);
  raw[NTILE(108, 106)] = 25;
  raw[NTILE(109, 106)] = 22;
  const two = edgeNotch([NE, { lake: 1, x: 107, z: 105, dir: LAKE_DIR_E }]);
  st = recomputeLakes(g8(), L, 0, two);
  ok(two!.edges.length === 2 && st.lakes[0]!.errors === 0 && st.lakes[0]!.tilecount === 36 && lakeHoldsUpTo(g8(), L, st, 0, 0) === 100);
});

test("a seed whose only low corner is a lip point at H is above the water under EDGE (test_edge_seed_on_lip)", () => {
  raw.fill(80);
  raw[NTILE(104, 104)] = 25;
  const n = edgeNotch([{ lake: 1, x: 103, z: 104, dir: LAKE_DIR_E }]);
  let st = recomputeLakes(g8(), [lake(100, 104, 104)], 0, n);
  ok(st.lakes[0]!.errors & LAKEERR_SEED_ABOVE_WATER);
  assert.equal(st.lakes[0]!.tilecount, 0);
  st = fill([lake(100, 104, 104)], LAKE_RULE_EDGE);
  ok(!(st.lakes[0]!.errors & LAKEERR_SEED_ABOVE_WATER) && st.lakes[0]!.tilecount >= 1);
});

test("the spill under EDGE has no 'seed tile wet at the result' tail (test_edge_seed_tile_dry_at_result)", () => {
  raw.fill(50);
  raw[NTILE(105, 104)] = raw[NTILE(105, 105)] = 25;
  raw[NTILE(106, 104)] = 20;
  raw[NTILE(106, 105)] = 23;
  raw[NTILE(106, 106)] = 6;
  assert.equal(spill(LAKE_RULE_EDGE, 104, 104, 24), 91);
  assert.equal(spill(LAKE_RULE_EDGE, 104, 104, 0), 91);
  assert.equal(spill(LAKE_RULE_TILE, 104, 104, 24), LAKE_NO_BASIN);
  const st = fill([lake(100, 104, 104)], LAKE_RULE_EDGE, 24);
  ok(st.lakes[0]!.spill === 91 && st.lakes[0]!.errors & LAKEERR_LEAK);
});

test("the .WTR carries the rule: minor 1 and flags bit 0 for EDGE, 0 / 0 for TILE; the .TXX does not (test_edge_wtr_header, _txx_default)", () => {
  ring(100, 10);
  const L = [lake(100, 105, 105)];
  const be = buildWtr(L, fill(L, LAKE_RULE_EDGE))!;
  ok(be[6] === 1 && be[7] === 0 && be[20] === 1 && be[21] === 0 && be[24] === 0 && be[28] === 0);
  bowl(100, 100, 3, 10, 50, 5);
  const T = [lake(121, 100, 100)];
  const bt = buildWtr(T, fill(T, LAKE_RULE_TILE))!;
  ok(bt[6] === 0 && bt[20] === 0);
  const pe = parseWtrLakes(be)!, pt = parseWtrLakes(bt)!;
  ok(pe.rule === LAKE_RULE_EDGE && pe.lakes.length === 1 && pe.lakes[0]!.height === 100);
  assert.equal(pt.rule, LAKE_RULE_TILE);
  // the .TXX holds the authored lakes only: no rule on reading one back
  const t = resetTrack();
  t.lakes = L;
  t.lakeRule = LAKE_RULE_TILE;
  assert.equal(readTxx(writeTxx(t)).lakeRule, undefined);
});

test("where a leak gets out: the escape tile (test_escape_tile, test_escape_none)", () => {
  bowl(100, 100, 3, 10, 50, 50);
  raw[104 + (100 << 8)] = 30;
  raw[105 + (100 << 8)] = 30;
  raw[106 + (101 << 8)] = 5;
  const e = 105 + (100 << 8);
  for (const r of [LAKE_RULE_TILE, LAKE_RULE_EDGE]) {
    const at = lakeSpillAt(g8(), null, 0, 100, 100, -1, rule(r));
    if (r === LAKE_RULE_TILE) assert.deepEqual(at, { spill: 119, escape: e });
    const st = fill([lake(121, 100, 100)], r);
    ok(st.lakes[0]!.errors & LAKEERR_LEAK);
    if (r === LAKE_RULE_TILE) ok(st.lakes[0]!.spill === 119 && st.lakes[0]!.escape === e);
    else ok(st.lakes[0]!.escape >= 0);
  }
  // a lake that holds has none; no spill (the whole map) has no tile; the sea stops at the seed tile
  bowl(100, 100, 3, 10, 50, 5);
  assert.equal(fill([lake(121, 100, 100)], LAKE_RULE_TILE).lakes[0]!.escape, -1);
  raw.fill(50);
  assert.deepEqual(lakeSpillAt(g8(), null, 0, 10, 10, -1, rule(LAKE_RULE_TILE)), { spill: LAKE_MAX_HEIGHT, escape: -1 });
  assert.deepEqual(lakeSpillAt(g8(), null, 240, 10, 10, -1, rule(LAKE_RULE_TILE)), { spill: LAKE_NO_BASIN, escape: 10 + (10 << 8) });
  // the Lake window says where (and where the ground is at H)
  eastSlope();
  const st = fill([lake(181, 104, 104)], LAKE_RULE_EDGE);
  assert.match(lakeProblemsText(st.lakes[0]!), /The water spills over the rim[^\n]*\r\n {2}The water gets out at tile \(108, 104\)\.\r\n/);
});

test("where CORNER_AT_H is: the points, once each, lip points left out, up to 32 kept (test_corner_at_h_points)", () => {
  const three = () => { notchRaw(25, 22); raw[NTILE(104, 104)] = 25; raw[NTILE(106, 105)] = 25; raw[NTILE(105, 106)] = 25; };
  const has = (l: LakesState["lakes"][0], x: number, z: number) => l.atx.some((ax, i) => ax === x && l.atz[i] === z);
  const checkThree = (l: LakesState["lakes"][0]) => {
    assert.equal(l.errors, LAKEERR_CORNER_AT_H);
    ok(l.atcount === 3 && l.atstep === 1, `${l.atcount}`);
    ok(has(l, 104, 104) && has(l, 106, 105) && has(l, 105, 106) && !has(l, 108, 104) && !has(l, 108, 105));
  };
  three();
  checkThree(recomputeLakes(g8(), [lake(100, 104, 104)], 0, edgeNotch()).lakes[0]!);
  checkThree(recomputeLakes(g8(), [lake(100, 104, 104)], 0, tileNotch(LAKE_RULE_TILE)).lakes[0]!);
  for (const r of [LAKE_RULE_EDGE, LAKE_RULE_TILE]) {
    const l = fill([lake(100, 104, 104)], r).lakes[0]!;
    assert.equal(l.atcount, 5, `rule ${r}`);
    ok(has(l, 104, 104) && has(l, 108, 104) && has(l, 108, 105));
  }
  ok(fill([lake(99, 104, 104)], LAKE_RULE_EDGE).lakes[0]!.atcount === 0);
  notchRaw(25, 22);
  for (let i = 0; i < 36; i++) raw[NTILE(103 + (i % 6), 103 + Math.trunc(i / 6))] = 25;
  const big = fill([lake(100, 104, 104)], LAKE_RULE_EDGE).lakes[0]!;
  ok(big.atcount >= 36 && big.atx.length === 32 && has(big, 103, 103) && !has(big, 108, 108));
  // the Problems line: the first 6, and how many more
  assert.match(lakeProblemsText(big), /Ground exactly at the water's height at \(103,103\), \(104,103\), .*, \+\d+ more - raise or lower them a quarter step\./);
});

test("Classic 16-bit (8-bit exact) and Full Map give the 8-bit answers under EDGE (test_edge_drive_surface_matches_8bit)", () => {
  const same = (what: string, h: number, sx: number, sz: number, n: LakeNotches | null, cmpfine = true) => {
    const L = [lake(h, sx, sz)];
    const a = recomputeLakes(g8(), L, 0, n);
    const t16 = resetTrack();
    t16.heights.set(raw);
    setMode(t16, TERRAINMODE_CLASSIC16);
    const g16 = buildLakeGround(t16)!;
    assert.equal(g16.step, 1);
    const b = recomputeLakes(g16, L, 0, n);
    ok(sameLakes(a, b), `16-bit differs: ${what}`);
    const tf = resetTrack();
    tf.heights.set(raw);
    setMode(tf, TERRAINMODE_FINE);
    const gf = buildLakeGround(tf)!;
    assert.equal(gf.step, 4);
    const c = recomputeLakes(gf, L, 0, n);
    if (cmpfine) ok(sameLakes(a, c), `Full Map differs: ${what}`);
    else ok((c.lakes[0]!.errors & LAKEERR_LEAK) === (a.lakes[0]!.errors & LAKEERR_LEAK) && c.lakes[0]!.tilecount === a.lakes[0]!.tilecount, what);
  };
  const E = rule(LAKE_RULE_EDGE);
  ring(100, 10); same("ridge", 100, 105, 105, E);
  plateauBowl(105, 105, 80, 10); same("bowl", 100, 104, 104, E);
  eastSlope(); same("east slope", 179, 104, 104, E); same("east slope, leaking", 181, 104, 104, E);
  diag(210, true); same("diagonal staircase", 100, 104, 104, E);
  notchRaw(25, 22); same("notch edge", 100, 104, 104, edgeNotch());
  notchRaw(25, 22); raw[NTILE(108, 103)] = 25; same("notch edge, flank corner at H", 100, 104, 104, edgeNotch(), false);
  bowl(100, 100, 3, 10, 50, 5); same("thick-rim bowl", 121, 100, 100, E);
});

test("track format version 6: the edge rule, the escape and the at-H points in a 512-cell world", () => {
  // the ridge ring placed past column 255 of a 512 world
  const n = 512, r512 = new Uint8Array(n * n).fill(10);
  for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) r512[(400 + i) + (300 + j) * n] = i === 0 || j === 0 || i === 10 || j === 10 ? 50 : 20;
  const g: LakeGround = { raw: r512, tilemin: null, groundAtLevel: null };
  let st = recomputeLakes(g, [lake(100, 405, 305)], 0, rule(LAKE_RULE_EDGE));
  ok(st.tmap.length === n * n && st.lakes[0]!.errors === 0 && st.lakes[0]!.tilecount === 100 && st.lakes[0]!.spill === 199);
  assert.deepEqual([st.lakes[0]!.minx, st.lakes[0]!.maxx, st.lakes[0]!.minz, st.lakes[0]!.maxz], [400, 409, 300, 309]);
  // a leak gets out at a tile of the 512 map (x + z * 512)
  st = recomputeLakes(g, [lake(200, 405, 305)], 0, rule(LAKE_RULE_EDGE));
  ok(st.lakes[0]!.errors & LAKEERR_LEAK);
  const esc = st.lakes[0]!.escape;
  ok(esc >= 0 && esc % n >= 399 && esc % n <= 411 && Math.floor(esc / n) >= 299 && Math.floor(esc / n) <= 311, `${esc}`);
  assert.match(lakeProblemsText(st.lakes[0]!, n), new RegExp(`gets out at tile \\(${esc % n}, ${Math.floor(esc / n)}\\)`));
  // the ground at H inside: one corner at 100 (byte 25) on the floor
  r512[403 + 303 * n] = 25;
  st = recomputeLakes(g, [lake(100, 405, 305)], 0, rule(LAKE_RULE_EDGE));
  ok(st.lakes[0]!.errors & LAKEERR_CORNER_AT_H && st.lakes[0]!.atcount === 1 && st.lakes[0]!.atx[0] === 403 && st.lakes[0]!.atz[0] === 303);
  // a notch edge at x 450 closes the wall there
  const nb = lakeNotches(null, null, [{ lake: 1, x: 409, z: 305, dir: LAKE_DIR_E }], LAKE_RULE_EDGE);
  r512[403 + 303 * n] = 20;
  r512[410 + 305 * n] = r512[410 + 306 * n] = 25;
  ok(recomputeLakes(g, [lake(100, 405, 305)], 0, rule(LAKE_RULE_EDGE)).lakes[0]!.errors & LAKEERR_LEAK);
  st = recomputeLakes(g, [lake(100, 405, 305)], 0, nb);
  ok(st.lakes[0]!.errors === 0 && st.lakes[0]!.tilecount === 100, `${st.lakes[0]!.errors}`);
});
