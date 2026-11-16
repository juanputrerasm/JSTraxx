/*
  The waterfalls' mist as the engine's fog volumes, Traxx 1.8.0 (commit 35b087b, at 34aaa67):
  TrackPOD/TrackPODFalls.cpp MistFog, MistRegistered and MistLandings (Traxx/TrackPODFalls.h), the
  slot plan of Traxx/TraxxViewFalls.cpp DrawWaterfallsOpenGL and Traxx/TraxxViewDisplay.cpp
  AppendMistFogVolumes. The engine side is cursh2 core\Waterfalls.cpp wfRegisterMist ->
  fogVolumeRegisterRec (core\FogVolume.cpp).

  Each landing's mist is an ordinary engine fog volume: density
  d = clamp(crestLength * speed * drop / 7200 * share, 0.25, 2) * mist/100 * scale/100 (share = the
  stream's live columns over all the landings' columns), vis = clamp(120 / d, 20, 1000), half H/2,
  round 1, wisps (0.6, 25 ft, 2 ft/s), fogPropDefaults' colour, edge 20, top 5, maxOp 1, wmask 511
  without Snow (bit 5) for a Freeze fall. Float arithmetic as the C++ (Math.fround per step).

  Slots: the engine's 64 (ENGINEFOG_SLOTS) take every fog box first, then the mist in
  landing-outer, fall-inner order (stream 0 of every fall before any fall's stream 1). The boxes
  (W, L, H, centre, floor, flow axis) are falls.ts mistVolumes'; the per-stream drop and live
  column count wfRegisterMist also needs are not returned by it, so mistStreamStats below measures
  them with the same grouping rule (C++ MistVolumes' dropftOut / columnsOut).
*/
import {
  crestLength, fallEffectiveHeight, fallMistLandings, fallMistRegistered, landContinuous, mistVolumes,
  FALLEND_WATER, FALLFLAG_FREEZE, FALLWARN_DROPPED, FALL_MAX_LANDINGS,
  type FallColumn, type FallGround, type FallLakes, type FallShape, type TraxxFall,
} from "./falls.ts";
import { ENGINEFOG_SLOTS, engineFogDrawn, type EngineFogParams } from "../view/engine-fog.ts";

const f32 = Math.fround;

/** The renderer's id of a mist volume: 100000 + fall * FALL_MAX_LANDINGS + stream, past every fog box's (slot + 1). */
export function mistFogId(fall: number, stream: number): number {
  return 100000 + fall * FALL_MAX_LANDINGS + stream;
}

/**
  MistFogVol: one mist fog volume as the engine registers it, in the shape's unwrapped feet frame:
  centre (x, z), floorY, W across axX, L along axZ, H, the two horizontal unit axes
  (axX = (-axZz, axZx)), the fog props the engine sets and the density d the vis came from.
*/
export interface MistFogVol {
  /** The landing index (0..3), the engine's li; nstreams = the fall's landings. */
  stream: number;
  nstreams: number;
  x: number;
  z: number;
  floorY: number;
  W: number;
  L: number;
  H: number;
  axXx: number;
  axXz: number;
  axZx: number;
  axZz: number;
  /** d, before the clamp that makes vis. */
  density: number;
  r: number;
  g: number;
  b: number;
  vis: number;
  half: number;
  edge: number;
  top: number;
  maxop: number;
  round: number;
  wisp: number;
  wsize: number;
  wspeed: number;
  bot: number;
  wmask: number;
}

/* A column the engine sees: not merged into a neighbour (FLOW TUBES, handover 4.7; read when the shape carries the flag). */
const live = (c: FallColumn | undefined) => !!c && !(c as FallColumn & { merged?: unknown }).merged;

/**
  C++ MistVolumes' dropftOut / columnsOut: per stream, in the order mistVolumes returns its boxes,
  the mean drop (crest - landing y, feet, a float) and the live column count. The same rule as
  mistVolumes: the landing row (a water column's last row, a dry column's land row when
  1 <= land < n), the candidates (the water columns if any ends in water, else every column),
  groups split at a non-candidate or a discontinuous landing (landContinuous), the 4 largest kept
  (a tie to the lower first column) in column order. Written here because falls.ts mistVolumes
  does not return them.
*/
export function mistStreamStats(w: TraxxFall, height: number, s: FallShape, g: FallGround): { dropft: number[]; columns: number[] } {
  const out = { dropft: [] as number[], columns: [] as number[] };
  if (w.mist === 0 || s.ncols < 1 || !s.col.length) return out;
  const lv: number[] = [];
  for (let k = 0; k < s.ncols; k++) if (live(s.col[k])) lv.push(k);
  const C = lv.length;
  if (C < 1) return out;
  const crest = height * 0.5;
  const rowOf = (c: FallColumn) => ((c.land ?? -1) >= 1 && (c.land ?? -1) < c.n && c.end !== FALLEND_WATER ? c.land! : c.n - 1);
  const landOf = (k: number): Float32Array | null => {
    const c = s.col[lv[k]!];
    if (!c || c.n < 1 || !c.p) return null;
    const r = rowOf(c);
    return c.p.subarray(3 * r, 3 * r + 3);
  };
  let nvalid = 0, anywater = false;
  for (let k = 0; k < C; k++) {
    if (!landOf(k)) continue;
    nvalid++;
    if (s.col[lv[k]!]!.end === FALLEND_WATER) anywater = true;
  }
  if (nvalid === 0) return out;
  const cand = new Uint8Array(C);
  for (let k = 0; k < C; k++) if (landOf(k)) cand[k] = anywater ? (s.col[lv[k]!]!.end === FALLEND_WATER ? 1 : 0) : 1;
  const g0: number[] = [], g1: number[] = [];
  for (let k = 0; k < C;) {
    if (!cand[k]) { k++; continue; }
    let e = k;
    while (e + 1 < C) {
      if (!cand[e + 1]) break;
      if (!landContinuous(landOf(e)!, landOf(e + 1)!, anywater, w.source, g)) break;
      e++;
    }
    g0.push(k); g1.push(e);
    k = e + 1;
  }
  let keep: number[];
  if (g0.length <= FALL_MAX_LANDINGS) keep = g0.map((_, q) => q);
  else {
    const used = new Uint8Array(g0.length);
    keep = [];
    for (let nk = 0; nk < FALL_MAX_LANDINGS; nk++) {
      let b = -1;
      for (let q = 0; q < g0.length; q++) if (!used[q] && (b < 0 || g1[q]! - g0[q]! > g1[b]! - g0[b]!)) b = q;
      used[b] = 1;
      keep.push(b);
    }
    keep.sort((a, b) => a - b);
  }
  for (const q of keep) {
    const a = g0[q]!, b = g1[q]!, n = b - a + 1;
    let sdrop = 0;
    for (let j = a; j <= b; j++) sdrop += crest - landOf(j)![1]!;
    out.dropft.push(f32(sdrop / n));
    out.columns.push(n);
  }
  return out;
}

const clampF = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
  The per-stream half of MistFog: the fog records from the stream boxes (mistVolumes' [x, floorY,
  z, W, L, H, fx, fz]) and their drops and live column counts. A stream whose d is not above 0 is
  skipped (the engine takes no slot for it). scalePct = the player's INI [Graphics] waterfallMist
  (default 100).
*/
export function mistFogFromStreams(w: TraxxFall, boxes: readonly (readonly number[])[], dropft: readonly number[],
  columns: readonly number[], scalePct = 100, cells = 256): MistFogVol[] {
  const out: MistFogVol[] = [];
  if (w.mist === 0) return out;
  if (scalePct < 0) scalePct = 0;
  const crestw = crestLength(w, cells), speed = f32(w.speed / 16.0);
  const n = boxes.length;
  let landCols = 0;
  for (let q = 0; q < n; q++) landCols += columns[q]!;
  for (let q = 0; q < n; q++) {
    const box = boxes[q]!;
    const share = landCols > 0 ? f32(columns[q]! / landCols) : 1.0;
    const raw = f32(f32(f32(f32(f32(crestw * speed) * f32(dropft[q]!)) / 7200.0) * share));
    const d = f32(f32(clampF(raw, 0.25, 2.0) * f32(w.mist / 100.0)) * f32(scalePct / 100.0));
    if (d <= 0.0) continue; // the engine skips it: no slot taken
    const H = f32(box[5]!);
    let wmask = 511;
    if (w.flags & FALLFLAG_FREEZE) wmask &= ~(1 << 5); // WEATHER_SNOW
    out.push({
      stream: q, nstreams: n,
      x: f32(box[0]!), floorY: f32(box[1]!), z: f32(box[2]!), W: f32(box[3]!), L: f32(box[4]!), H,
      axZx: f32(box[6]!), axZz: f32(box[7]!), axXx: f32(-box[7]!), axXz: f32(box[6]!),
      density: d,
      // fogPropDefaults (core\FogVolume.cpp:48), then wfRegisterMist's own
      r: f32(0.75), g: f32(0.78), b: f32(0.82),
      edge: 20.0, top: 5.0, maxop: 1.0, bot: 0.0,
      vis: clampF(f32(120.0 / d), 20.0, 1000.0),
      half: f32(H / 2.0),
      round: 1.0,
      wisp: f32(0.6), wsize: 25.0, wspeed: 2.0,
      wmask,
    });
  }
  return out;
}

/**
  MistFog: the fog volumes a fall registers, in landing order (none when mist is 0; the caller
  skips errors, DROPPED and under 2 columns, as mistLandings does: see mistRegistered). height =
  the fall's effective height (raw), g the world its landing is sampled in.
*/
export function mistFog(w: TraxxFall, height: number, s: FallShape, g: FallGround, scalePct = 100): MistFogVol[] {
  if (w.mist === 0) return [];
  const boxes = mistVolumes(w, height, s, g);
  // falls.ts mistVolumes carries C++ MistVolumes' dropftOut / columnsOut as [8] and [9]; measured here otherwise.
  const st = boxes.every((b) => b.length >= 10)
    ? { dropft: boxes.map((b) => b[8]!), columns: boxes.map((b) => b[9]!) }
    : mistStreamStats(w, height, s, g);
  // The two share one grouping rule; should they ever disagree, only the streams both measured are registered.
  const n = Math.min(boxes.length, st.dropft.length);
  return mistFogFromStreams(w, boxes.slice(0, n), st.dropft.slice(0, n), st.columns.slice(0, n), scalePct, g.cells ?? 256);
}

/*
  MistRegistered and MistLandings are falls.ts' (fallMistRegistered, fallMistLandings), shared with
  Write POD and the Waterfall window; the old names stay as aliases.
*/
export const mistRegistered = fallMistRegistered;
export function mistLandings(falls: readonly TraxxFall[], lakes: FallLakes, err: readonly number[], shapes: readonly FallShape[],
  g: FallGround | null): number[] {
  return fallMistLandings(falls, lakes.lakes, err, shapes, g);
}

/** One mist record the fog pass draws (AppendMistFogVolumes): the fall, the stream, its slot (0-based, after the fog boxes) and the record. */
export interface MistDraw {
  fall: number;
  stream: number;
  slot: number;
  vol: MistFogVol;
}

/**
  The mist plan of DrawWaterfallsOpenGL / AppendMistFogVolumes: plans[f] = mistFog of fall f (empty
  for a fall not registered). Slots after the nfogs fog boxes are handed out landing-outer,
  fall-inner; a stream is drawn when it got a slot, its wmask has the previewed weather and its W,
  L and H are over 0.5 ft (the engine's draw skip). Returns the drawn records in that order (the
  order they follow the fog boxes into the renderer's list) and draw[f], a bit per stream; a
  stream without its bit keeps a dim dashed outline instead.
*/
export function mistDrawPlan(nfogs: number, plans: readonly (readonly MistFogVol[])[], weather: number): { list: MistDraw[]; draw: number[] } {
  const draw = plans.map(() => 0);
  const list: MistDraw[] = [];
  let slot = 0;
  for (let li = 0; li < FALL_MAX_LANDINGS; li++) {
    for (let f = 0; f < plans.length; f++) {
      const m = plans[f]![li];
      if (!m) continue;
      slot++;
      if (slot <= ENGINEFOG_SLOTS - nfogs && engineFogDrawn(m.wmask, weather, m.W, m.L, m.H)) {
        draw[f] = draw[f]! | (1 << li);
        list.push({ fall: f, stream: li, slot: nfogs + slot - 1, vol: m });
      }
    }
  }
  return { list, draw };
}

/** AppendMistFogVolumes: the engine fog fields of a mist record (W across, L along, H). */
export function mistFogParams(m: MistFogVol): EngineFogParams {
  return {
    w: m.W, l: m.L, h: m.H, vis: m.vis, half: m.half, edge: m.edge, top: m.top, maxop: m.maxop,
    round: m.round, wisp: m.wisp, wsize: m.wsize, wspeed: m.wspeed, bot: m.bot,
  };
}
