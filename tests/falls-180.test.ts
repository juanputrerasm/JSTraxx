/*
  Waterfall flow tubes + ribbons (Traxx 1.8.0, f7fb1b9, handover 4.7): tools/wfltest.cpp
  TestFlowTubes. Every number is a pin of the engine reference (wtr_check / core\FallShape.cpp),
  on fallshape_harness' split, gully, ridge and cliff worlds over 32 ft corner ground. The ridge
  landings and the mud world's pins are in falls-173.test.ts with the other landing cases.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFallShape, emptyFallShape, fallClassicHeightRaw, fallDefaults, fallFlowMesh, fallMistLandings, fallMistRegistered, fitFall,
  FALLEND_GROUND, FALLEND_LIMIT, FALLWARN_DROPPED, FALL_IDX_UNLIMITED, type FallGround, type FallShape, type FallStat, type TraxxFall,
} from "../src/core/traxx/falls.ts";

const ok: (value: unknown, message?: string) => void = assert.ok;

function crest2(x0: number, z0: number, x1: number, z1: number): TraxxFall {
  const w = fallDefaults();
  w.npoints = 2;
  w.pt[0] = [Math.trunc(x0 * 16), Math.trunc(z0 * 16)];
  w.pt[1] = [Math.trunc(x1 * 16), Math.trunc(z1 * 16)];
  w.height = 200;
  return w;
}

/* fallshape_harness funcH (wtr_check _func_h): feet at corner (x, z); fX0 = 4000, fZc = 4000. */
const fw = { kind: 0, top: 0, floorFt: 0, k: 0, r: 0, r0: 0, a: 0, sl: 0 };
function flowH(x: number, z: number): number {
  const dx = x - 4000.0;
  if (fw.kind === 1) {
    if (dx <= 0.0) return fw.top;
    const t = dx / 64.0;
    let h = fw.top - fw.sl * dx + fw.k * Math.abs(z - 4000.0) * (t < 1.0 ? t : 1.0);
    h = h < fw.top ? h : fw.top;
    return h > fw.floorFt ? h : fw.floorFt;
  }
  const len = (fw.top - fw.floorFt) / 0.5, az = fw.a > 0.0 ? Math.abs(Math.abs(z - 4000.0) - fw.a) : Math.abs(z - 4000.0);
  if (dx <= 0.0) return fw.top;
  if (dx < len) {
    const q = 1.0 - az / fw.r, u = dx / 16.0;
    const h = fw.top - 0.5 * dx + fw.k * (q > 0.0 ? q : 0.0) * (u < 1.0 ? u : 1.0) * (1.0 - dx / len);
    return h > fw.floorFt ? h : fw.floorFt;
  }
  const t = 1.0 - Math.abs(z - 4000.0) / 8.0;
  return fw.floorFt + fw.r0 * (t > 0.0 ? t : 0.0);
}
const flowGround: FallGround = { height: (x, z) => Math.fround(fallClassicHeightRaw((tx, tz) => Math.floor(flowH(tx * 32.0, tz * 32.0) * 64.0), x, z)), water: () => null };

/* The tent ridge (RidgeCorner): 100 ft at tile row 126, falling 20 ft a tile; RidgeWater with a ctx is the 10 ft plane. */
const ridge = (_tx: number, tz: number) => { const v = 100 * 64 - 20 * 64 * Math.abs((tz & 255) - 126); return v > 0 ? v : 0; };
const ridgeGround = (water: boolean): FallGround => ({ height: (x, z) => fallClassicHeightRaw(ridge, x, z), water: water ? () => Math.fround(10) : () => null });

/* SlabCliff: corners `top` (1/64 ft) to tile column `edge`, `base` beyond, under a body-0 plane at `plane` ft. */
function slabCliff(top: number, base: number, edge: number, plane: number): FallGround {
  const corner = (tx: number) => ((tx & 255) <= edge ? top : base);
  return { height: (x, z) => fallClassicHeightRaw(corner, x, z), water: () => Math.fround(plane) };
}

interface Want { verts: number; back: number; tris: number; merges: number; split: number; ribbon: number }

/* FlowFit: one fall (crest x 4000, z0..z1, crestFt up, speed ft/s) through FitFall with the given budgets. */
function flowFit(nm: string, g: FallGround, crestFt: number, z0: number, z1: number, speed: number, vb: number, ib: number, want: Want, wantSp: number, wantShort: boolean): void {
  const w = crest2(4000, z0, 4000, z1);
  w.source = 0;
  w.speed = Math.floor(speed * 16 + 0.5);
  const s = buildFallShape(w, crestFt * 2, g);
  const f = fitFall(s, Math.min(vb, 32768), ib);
  ok(f, nm);
  const got = `${f!.verts} ${f!.back} ${f!.tris} ${f!.merges} ${f!.splitTris} ${f!.ribbon} ${f!.spacing}${f!.shortened ? " shortened" : ""}`;
  ok(f!.verts === want.verts && f!.tris === want.tris, `${nm}: ${got}`);
  ok((want.back < 0 || f!.back === want.back) && (want.merges < 0 || f!.merges === want.merges) && (want.split < 0 || f!.splitTris === want.split)
    && (want.ribbon < 0 || f!.ribbon === want.ribbon), `${nm}: ${got}`);
  ok(f!.spacing === wantSp && f!.shortened === wantShort, `${nm}: ${got}`);
}

test("flow tubes: ridge_part, ridge_part30, gully_6 / 20, ridge_dry, ridge_pools, cliff (wfltest t_flow_totals)", () => {
  Object.assign(fw, { kind: 0, top: 100, floorFt: 60, k: 6, r: 24, r0: 0, a: 0, sl: 0 });
  const part = { verts: 1137, back: 0, tris: 2124, merges: 0, split: 1, ribbon: 0 };
  flowFit("ridge_part", flowGround, 100, 3980, 4020, 6, 32768, FALL_IDX_UNLIMITED, part, 2.0, false);
  flowFit("ridge_part_budget", flowGround, 100, 3980, 4020, 6, 1137, FALL_IDX_UNLIMITED, part, 2.0, false);
  Object.assign(fw, { k: 30, r: 48 });
  flowFit("ridge_part30", flowGround, 100, 3980, 4020, 6, 32768, FALL_IDX_UNLIMITED, { verts: 445, back: 0, tris: 636, merges: 18, split: 114, ribbon: 182 }, 2.0, false);
  Object.assign(fw, { kind: 1, top: 300, floorFt: 150, sl: 0.3, k: 0.5 });
  flowFit("gully_6", flowGround, 300, 3960, 4040, 6, 32768, FALL_IDX_UNLIMITED, { verts: 1434, back: 0, tris: 2295, merges: 32, split: 512, ribbon: 458 }, 2.0, false);
  flowFit("gully_20", flowGround, 300, 3960, 4040, 20, 32768, FALL_IDX_UNLIMITED, { verts: 1581, back: 49, tris: 2560, merges: 32, split: 505, ribbon: 440 }, 2.0, false);
  flowFit("ridge_dry", ridgeGround(false), 100, 3969, 4095, 6, 32768, FALL_IDX_UNLIMITED, { verts: 1744, back: 731, tris: 3025, merges: 62, split: 40, ribbon: 80 }, 2.0, false);
  flowFit("ridge_pools", ridgeGround(true), 100, 3969, 4095, 6, 32768, FALL_IDX_UNLIMITED, { verts: 1678, back: 731, tris: 2937, merges: 62, split: 18, ribbon: 36 }, 2.0, false);
  const cliff = slabCliff(100 * 64, 40 * 64, 124, 42.0);
  flowFit("cliff", cliff, 100, 4000, 4040, 6, 32768, FALL_IDX_UNLIMITED, { verts: 1239, back: 588, tris: 2240, merges: 0, split: 0, ribbon: 0 }, 2.0, false);
  // fall_index_budget: the INDEX budget binding before the vertex budget
  flowFit("cliff idx 6000", cliff, 100, 4000, 4040, 6, 32768, 6000, { verts: 645, back: -1, tris: 1120, merges: -1, split: -1, ribbon: -1 }, 3.0, false);
  Object.assign(fw, { kind: 0, top: 100, floorFt: 60, k: 6, r: 24, r0: 0, a: 0, sl: 0 });
  flowFit("ridge_part idx 3000", flowGround, 100, 3980, 4020, 6, 32768, 3000, { verts: 308, back: -1, tris: 540, merges: -1, split: -1, ribbon: -1 }, 4.0, false);
});

test("flow tubes: the merge row guard (fall_merge_row_guard) and a hand-built stat", () => {
  const c0 = [[0, 0], [2, 1.9], [4, 1.9], [6, 1.9], [8, 1.9], [10, 1.9]];
  const c1 = [[0, 2], [1, 3.8], [2, 1.9], [4, 1.9], [6, 1.9], [8, 1.9]];
  const st: FallStat = {
    ncols: 5, rows: new Int32Array(5).fill(6), endk: new Uint8Array(5).fill(FALLEND_LIMIT), off: Int32Array.from([0, 6, 12, 18, 24]),
    air: new Uint8Array(30).fill(1), mark: new Uint8Array(30), pt: new Float64Array(90),
  };
  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 6; r++) {
      const p = 3 * (6 * c + r);
      st.pt![p] = c === 0 ? c0[r]![0]! : c === 1 ? c1[r]![0]! : 2.0 * r;
      st.pt![p + 1] = 100.0 - 2.0 * r;
      st.pt![p + 2] = c === 0 ? c0[r]![1]! : c === 1 ? c1[r]![1]! : 2.0 * c;
    }
  }
  const m = fallFlowMesh(st, 2.0, 0x7fffffff, null)!;
  ok(m && m.info.rowsOk && m.endR[1] === 2, `${m?.endR[1]}`);
  const fi = m.info;
  ok(fi.sheet === 23 && fi.ribbon === 0 && fi.back === 23 && fi.frontTris + fi.ribbonTris + fi.backTris + fi.foamTris === 52, JSON.stringify(fi));

  // a stat without path points never merges: the written counts are the full grid's
  const hs = emptyFallShape();
  hs.width = 10;
  [2, 3, 4, 6, 8].forEach((sp, j) => {
    const n = Math.max(1, Math.ceil(10 / sp - 1e-9)) + 1;
    hs.stat[j] = { ncols: n, rows: new Int32Array(n).fill(Math.ceil(20 / sp - 1e-9) + 1), endk: new Uint8Array(n).fill(FALLEND_GROUND) };
  });
  hs.ncols = hs.stat[0]!.ncols;
  assert.equal(fallFlowMesh(hs.stat[0]!, 2.0, 0x7fffffff, null), null);
  const f = fitFall(hs, 32768, FALL_IDX_UNLIMITED)!;
  ok(f.verts === 66 && f.ribbon === 0 && f.merges === 0 && f.spacing === 2);
});

test("MistRegistered and MistLandings (13507dc, 35b087b)", () => {
  const g = ridgeGround(true);
  const w = crest2(4000, 3969, 4000, 4095);
  w.source = 0;
  const s: FallShape = buildFallShape(w, 200, g);
  ok(fallMistRegistered(w, 0, s));
  ok(!fallMistRegistered(w, 1, s), "a fall with errors registers none");
  ok(!fallMistRegistered({ ...w, mist: 0 }, 0, s), "mist 0 registers none");
  ok(!fallMistRegistered(w, 0, { ...s, warn: FALLWARN_DROPPED }), "a DROPPED fall registers none");
  ok(!fallMistRegistered(w, 0, { ...s, ncols: 1 }), "under 2 columns registers none");
  assert.deepEqual(fallMistLandings([w, { ...w, mist: 0 }], [], [0, 0], [s, s], g), [2, 0]);
  assert.deepEqual(fallMistLandings([w], [], [0], [s], null), [0], "no ground: none");
});
