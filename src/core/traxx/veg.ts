/*
  The vegetation layer's data and its .VEG file image, as Traxx 1.7 keeps them
  (Traxx/TrackPODVegetation.h, TrackPOD/TrackPODVegetation.cpp).

  The pieces: the two painted masks (carried byte for byte), the per-colour rules (the RULE
  chunk's text, Traxx's own recipe), and the planted result (species, trees, clumps) that the
  engine loads. The bytes themselves go through OpenPhotex (writeMtm2Veg, parseMtm2Veg); what
  lives here is Traxx's side: its defaults, its RULE text and the way it reads it back, its
  INFO lines, its validation, and the .TXV keys.

  Settings persistence (TrackPODBinary.cpp, the V15 block; TrackPODFile.cpp, the pod loader):
  Traxx keeps no separate settings record. Both the .TXX and the pod carry the whole BuildVEG
  image, and ParseVEG recovers the seed, corridor, margin and colour rules from its RULE chunk.
  In a pod, the ART\<stem>_V / _G pictures are taken as masks only when RULE names them
  (vMask / gMask), so an HD texture that happens to share the name stays a texture.

  Floats: every field the C++ holds as a float is kept here as a float32 value (Math.fround).
*/
import { parseMtm2Veg, writeMtm2Veg } from "../../vendor/openphotex/mtm/veg.js";
import type { Veg, VegSpecies as OpVegSpecies } from "../../vendor/openphotex/mtm/veg.js";
import { cAtof, cAtoi, f32 } from "./cformat.ts";

/* Caps, TrackPODVegetation.h (VEGETATION_FORMAT.md section 8). */
export const VEG_MAX_SPECIES = 60;
export const VEG_ENGINE_MAX_SPECIES = 64;
export const VEG_MAX_GROUND_SPECIES = 16;
export const VEG_MAX_TREES = 30000;
export const VEG_MAX_CLUMPS = 131072;
export const VEG_MAX_CLUMPS_PER_TILE = 1024;
export const VEG_ENGINE_MAX_TREES = 32768;
export const VEG_ENGINE_MAX_CLUMPS = 131072;
export const VEG_MAX_COLOURS = 16;
export const VEG_MAX_ENTRIES = 8;
export const VEG_MODELNAME = 64;
export const VEG_COLOURNAME = 32;

export const VEG_LAYER_TREES = 0;
export const VEG_LAYER_GRASS = 1;
export const VEG_NLAYERS = 2;

export const VEG_KIND_PLACED = 0;
export const VEG_KIND_GROUND = 1;
export const VEG_COLLIDE_NONE = 0;
export const VEG_COLLIDE_TRUNK = 1;
export const VEG_COLLIDE_MODEL = 2;
export const VEG_FLAG_CASTSHADOW = 0x01;
export const VEG_FLAG_FARCASTSHADOW = 0x02;
export const VEG_FLAG_CROSSFADE = 0x04;
export const VEG_FLAG_FACING = 0x08;

export const VEG_DEFAULT_SCALEMIN = f32(0.8);
export const VEG_DEFAULT_SCALEMAX = f32(1.25);
export const VEG_DEFAULT_SPACING = 18;
export const VEG_DEFAULT_DENSITY = 70;
export const VEG_DEFAULT_PERTILE = 300;
export const VEG_DEFAULT_CORRIDOR = 40;
export const VEG_DEFAULT_OBJMARGIN = 8;

const VEG_TILES = 256;
const VEG_TILE_SUBUNITS = 8192;
const VEG_HEADER_SIZE = 32;

/** TRAXX_TOOL_VERSION, Traxx/TrackPOD.h. */
export const VEG_TOOL_VERSION = "1.7.0";

/** VegEntry: one model in a colour's weighted list. Floats are float32 values. */
export interface VegEntry {
  /** The bare name, "PINE01.BIN". */
  model: string;
  farmodel: string;
  weight: number;
  scalemin: number;
  scalemax: number;
  rotate: boolean;
  /** VEG_COLLIDE_*. */
  collide: number;
  trunkdiam: number;
  trunkheight: number;
  sink: number;
  tier: number;
  shadow: boolean;
  slopemax: number;
  facing: boolean;
  crossfade: boolean;
}

/** VegColour: one colour of one mask. */
export interface VegColour {
  r: number;
  g: number;
  b: number;
  name: string;
  spacing: number;
  density: number;
  pertile: number;
  entries: VegEntry[];
}

/** VegSpecies: a SPEC record, the fields Traxx sets. */
export interface VegSpeciesRec {
  model: string;
  farmodel: string;
  kind: number;
  collide: number;
  flags: number;
  /** 1/64 ft at scale 1. */
  trunkdiam: number;
  /** 1/16 ft at scale 1. */
  trunkheight: number;
}

/** VegTree: in the file's units (1/256 ft, 1/65536 turn, scale x 4096). */
export interface VegTreeRec {
  x: number;
  y: number;
  z: number;
  species: number;
  heading: number;
  scale: number;
  tier: number;
}

/** VegClump: in the file's units. Kept grouped by tile, ascending (tz, tx), shuffled within. */
export interface VegClumpRec {
  tx: number;
  tz: number;
  species: number;
  fx: number;
  fz: number;
  y: number;
  heading: number;
  scale: number;
}

/** A mask as CTrackPODVegetation holds it: the file bytes and their extension (".PNG"). */
export interface VegMaskFile {
  ext: string;
  data: Uint8Array;
}

/** CTrackPODVegetation, as plain data. */
export interface Vegetation {
  masks: (VegMaskFile | null)[];
  maskFromPod: boolean[];
  seed: number;
  corridorft: number;
  objectmarginft: number;
  /** colours[layer]: the trees (_V) then the grass (_G) colours. */
  colours: VegColour[][];
  species: VegSpeciesRec[];
  trees: VegTreeRec[];
  clumps: VegClumpRec[];
  /** The mask CRCs the placements were planted against (0 = none). */
  plantedcrc: number[];
  /** RULE names a vMask / gMask: the pod's ART\<stem>_V / _G is this layer's mask. */
  rulenamesmask: boolean[];
  stale: boolean;
  /** A .VEG with no RULE: shown, kept byte for byte, never edited. */
  readonly: boolean;
  foreign: Uint8Array | null;
}

/** VegDefaultEntry. */
export function vegDefaultEntry(layer: number): VegEntry {
  return {
    model: "", farmodel: "", weight: 1, scalemin: VEG_DEFAULT_SCALEMIN, scalemax: VEG_DEFAULT_SCALEMAX,
    rotate: true,
    collide: layer === VEG_LAYER_TREES ? VEG_COLLIDE_TRUNK : VEG_COLLIDE_NONE,
    trunkdiam: 0, trunkheight: 0, sink: 0, tier: 0,
    shadow: layer === VEG_LAYER_TREES,
    slopemax: 0, facing: false, crossfade: true,
  };
}

/** VegDefaultColour. */
export function vegDefaultColour(_layer: number): VegColour {
  return {
    r: 128, g: 128, b: 128, name: "", spacing: VEG_DEFAULT_SPACING, density: VEG_DEFAULT_DENSITY,
    pertile: VEG_DEFAULT_PERTILE, entries: [],
  };
}

/** The constructor / Clear(): no vegetation. */
export function emptyVegetation(): Vegetation {
  return {
    masks: [null, null], maskFromPod: [false, false],
    seed: 1, corridorft: VEG_DEFAULT_CORRIDOR, objectmarginft: VEG_DEFAULT_OBJMARGIN,
    colours: [[], []], species: [], trees: [], clumps: [], plantedcrc: [0, 0], rulenamesmask: [false, false],
    stale: false, readonly: false, foreign: null,
  };
}

/** VegResetRules (used by ParseVEG, which must not touch the masks). */
function resetRules(v: Vegetation): void {
  v.seed = 1;
  v.corridorft = VEG_DEFAULT_CORRIDOR;
  v.objectmarginft = VEG_DEFAULT_OBJMARGIN;
  v.colours = [[], []];
  v.plantedcrc = [0, 0];
  v.rulenamesmask = [false, false];
}

/** CTrackPODVegetation::IsEmpty. */
export function vegIsEmpty(v: Vegetation): boolean {
  return !v.masks[0] && !v.masks[1] && v.colours[0].length === 0 && v.colours[1].length === 0 &&
    v.species.length === 0 && v.trees.length === 0 && v.clumps.length === 0 && !v.foreign;
}

/** ClearPlacements: species, trees, clumps to none; also drops a foreign file. */
export function vegClearPlacements(v: Vegetation): void {
  v.species = [];
  v.trees = [];
  v.clumps = [];
  v.foreign = null;
  v.readonly = false;
}

/*
  CRC32 (poly 0xEDB88320, init and final XOR 0xFFFFFFFF), CTrackPODVegetation::CRC32.
*/
let crcTable: Uint32Array | null = null;
export function vegCrc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]!) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MaskCRC: 0 when there is no mask. */
export function vegMaskCrc(v: Vegetation, layer: number): number {
  const m = v.masks[layer];
  return m && m.data.length > 0 ? vegCrc32(m.data) : 0;
}

/** UpdateStale. */
export function vegUpdateStale(v: Vegetation): void {
  v.stale = false;
  for (let l = 0; l < VEG_NLAYERS; l++) if (v.plantedcrc[l] !== 0 && vegMaskCrc(v, l) !== v.plantedcrc[l]) v.stale = true;
}

/** UsesModel: the species table or a colour rule names this model (no case). */
export function vegUsesModel(v: Vegetation, barename: string): boolean {
  if (!barename) return false;
  const n = barename.toUpperCase();
  for (const s of v.species) if (s.model.toUpperCase() === n || s.farmodel.toUpperCase() === n) return true;
  for (const layer of v.colours) for (const c of layer) for (const e of c.entries) {
    if (e.model.toUpperCase() === n || e.farmodel.toUpperCase() === n) return true;
  }
  return false;
}

/*
  printf("%g") as the UCRT prints a double: six significant digits, the exact binary value
  rounded to nearest with ties to even, the shorter of %e and %f, trailing zeros removed.
*/
const G_VIEW = new DataView(new ArrayBuffer(8));
export function cG(value: number, precision = 6): string {
  if (Number.isNaN(value)) return "nan";
  const negative = value < 0 || Object.is(value, -0);
  const a = Math.abs(value);
  if (a === Infinity) return negative ? "-inf" : "inf";
  const sign = negative ? "-" : "";
  if (a === 0) return `${sign}0`;
  const P = precision === 0 ? 1 : precision;

  G_VIEW.setFloat64(0, a);
  const hi = G_VIEW.getUint32(0), lo = G_VIEW.getUint32(4);
  const biased = hi >>> 20;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp: number;
  if (biased === 0) exp = -1074;
  else { mant |= 1n << 52n; exp = biased - 1075; }
  // a = num / den exactly.
  const num0 = exp >= 0 ? mant << BigInt(exp) : mant;
  const den0 = exp >= 0 ? 1n : 1n << BigInt(-exp);

  // Round a * 10^shift to an integer, ties to even.
  const roundScaled = (shift: number): bigint => {
    let num = num0, den = den0;
    if (shift >= 0) num *= 10n ** BigInt(shift);
    else den *= 10n ** BigInt(-shift);
    let q = num / den;
    const twice = 2n * (num % den);
    if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
    return q;
  };
  let X = Math.floor(Math.log10(a));
  const lowP = 10n ** BigInt(P - 1), highP = 10n ** BigInt(P);
  let digits = roundScaled(P - 1 - X);
  for (let guard = 0; guard < 4; guard++) {
    if (digits >= highP) { X++; digits = roundScaled(P - 1 - X); continue; }
    if (digits < lowP) { X--; digits = roundScaled(P - 1 - X); continue; }
    break;
  }
  const strip = (s: string): string => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
  if (X < -4 || X >= P) {
    const d = digits.toString();
    const mantissa = strip(d.length > 1 ? `${d[0]}.${d.slice(1)}` : d);
    const ex = Math.abs(X);
    return `${sign}${mantissa}e${X < 0 ? "-" : "+"}${ex < 10 ? "0" : ""}${ex}`;
  }
  // %f with P - 1 - X decimals, from the same rounded digits.
  const decimals = P - 1 - X;
  let d = digits.toString();
  if (decimals > 0) {
    d = d.padStart(decimals + 1, "0");
    d = `${d.slice(0, -decimals)}.${d.slice(-decimals)}`;
  }
  return sign + strip(d);
}

/** VegCleanText: one line, control bytes to spaces, at most cap - 1 characters. */
function cleanText(src: string, cap: number): string {
  let out = "";
  for (let i = 0; i < src.length && i < cap - 1; i++) out += src.charCodeAt(i) < 32 ? " " : src[i];
  return out;
}

/** VbPrintf: a line is cut at the 1023-byte scratch buffer. */
function line(text: string): string {
  return text.length > 1023 ? text.slice(0, 1023) : text;
}

function collideWord(collide: number): string {
  if (collide === VEG_COLLIDE_TRUNK) return "trunk";
  if (collide === VEG_COLLIDE_MODEL) return "model";
  return "none";
}

function hex8(v: number): string {
  return (v >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/*
  VegWriteRule (TrackPODVegetation.cpp, with VegWriteEntries): the RULE chunk body. `stem` names
  the mask files (CTrackPOD::prefix).
*/
export function vegRuleText(v: Vegetation, stem: string): string {
  const maskkey = ["vMask", "gMask"], crckey = ["vMaskCRC", "gMaskCRC"], suffix = ["_V", "_G"];
  const st = cleanText(stem, 64);
  let out = line(`seed=${v.seed >>> 0}\r\n`);
  for (let l = 0; l < VEG_NLAYERS; l++) {
    const m = v.masks[l];
    if (m) {
      const name = `ART\\${st}${suffix[l]}${m.ext ? m.ext : ".PNG"}`.slice(0, 63).toUpperCase();
      out += line(`${maskkey[l]}=${name}\r\n`);
    }
    out += line(`${crckey[l]}=${hex8(v.plantedcrc[l] ?? 0)}\r\n`);
  }
  out += line(`corridorFt=${cG(v.corridorft)}\r\n`);
  out += line(`objectMarginFt=${cG(v.objectmarginft)}\r\n`);
  for (let l = 0; l < VEG_NLAYERS; l++) {
    const lc = l === VEG_LAYER_TREES ? "v" : "g";
    const cols = v.colours[l]!;
    out += line(`${lc}.count=${cols.length}\r\n`);
    cols.forEach((col, c) => {
      out += line(`${lc}.${c}.rgb=${col.r},${col.g},${col.b}\r\n`);
      out += line(`${lc}.${c}.name=${cleanText(col.name, VEG_COLOURNAME)}\r\n`);
      if (l === VEG_LAYER_TREES) {
        out += line(`${lc}.${c}.spacing=${cG(col.spacing)}\r\n`);
        out += line(`${lc}.${c}.density=${col.density | 0}\r\n`);
      } else out += line(`${lc}.${c}.perTile=${col.pertile | 0}\r\n`);
      col.entries.forEach((e, m) => {
        out += line(`${lc}.${c}.entry.${m}=${cleanText(e.model, VEG_MODELNAME)},${e.weight | 0},${cG(e.scalemin)},${cG(e.scalemax)},` +
          `${e.rotate ? "rot" : "norot"},${collideWord(e.collide)},${cG(e.trunkdiam)},${cG(e.trunkheight)},${cG(e.sink)},${e.tier | 0},` +
          `${e.shadow ? "shadow" : "noshadow"},${cG(e.slopemax)},${cleanText(e.farmodel, VEG_MODELNAME)},` +
          `${e.facing ? "facing" : ""},${e.crossfade ? "crossfade" : "nocrossfade"}\r\n`);
      });
    });
  }
  return out;
}

/** The INFO chunk (BuildVEG). `date` is the local date as YYYY-MM-DD. */
export function vegInfoText(trees: number, clumps: number, date: string): string {
  return `tool=Traxx\r\ntoolVersion=${VEG_TOOL_VERSION}\r\nbuilt=${date}\r\ntrees=${trees}\r\nclumps=${clumps}\r\n`;
}

/** GetLocalTime as BuildVEG prints it. */
export function vegToday(now = new Date()): string {
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(now.getFullYear(), 4)}-${p(now.getMonth() + 1, 2)}-${p(now.getDate(), 2)}`;
}

/*
  CTrackPODVegetation::BuildVEG: the whole WORLD\<stem>.VEG image, or null when the placements
  would make a file the engine only partly accepts (Traxx fails the build then). A foreign file
  comes back byte for byte.
*/
export function buildVeg(v: Vegetation, stem: string, date = vegToday()): Uint8Array | null {
  if (v.readonly && v.foreign && v.foreign.length > 0) return v.foreign.slice();
  const nspecies = v.species.length;
  if (nspecies > VEG_ENGINE_MAX_SPECIES) return null;
  for (const t of v.trees) {
    if (t.species >= nspecies || v.species[t.species]!.kind !== VEG_KIND_PLACED) return null;
    if (t.x < 0 || t.x >= VEG_TILES * VEG_TILE_SUBUNITS || t.z < 0 || t.z >= VEG_TILES * VEG_TILE_SUBUNITS) return null;
  }
  const tiles: { tx: number; tz: number; first: number; count: number }[] = [];
  const cl = v.clumps;
  for (let i = 0; i < cl.length; i++) {
    const c = cl[i]!;
    if (c.species >= nspecies || v.species[c.species]!.kind !== VEG_KIND_GROUND) return null;
    if (c.tx >= VEG_TILES || c.tz >= VEG_TILES) return null;
    const p = i > 0 ? cl[i - 1]! : null;
    if (!p || c.tx !== p.tx || c.tz !== p.tz) {
      if (p && c.tz * VEG_TILES + c.tx <= p.tz * VEG_TILES + p.tx) return null;
      tiles.push({ tx: c.tx, tz: c.tz, first: i, count: 0 });
    }
    const run = tiles[tiles.length - 1]!;
    run.count++;
    if (run.count > VEG_MAX_CLUMPS_PER_TILE) return null;
  }

  const species: OpVegSpecies[] = v.species.map((s) => ({
    model: s.model.slice(0, VEG_MODELNAME), farModel: s.farmodel.slice(0, VEG_MODELNAME), kind: s.kind,
    collide: s.kind === VEG_KIND_GROUND ? VEG_COLLIDE_NONE : s.collide, flags: s.flags,
    trunkDiameter: s.trunkdiam, trunkHeight: s.trunkheight,
  }));
  const nt = v.trees.length;
  const trees = {
    count: nt, position: new Int32Array(nt * 3), species: new Uint16Array(nt), heading: new Uint16Array(nt),
    scale: new Uint16Array(nt), tint: new Uint8Array(nt).fill(128), tier: new Uint8Array(nt),
  };
  v.trees.forEach((t, i) => {
    trees.position[3 * i] = t.x; trees.position[3 * i + 1] = t.y; trees.position[3 * i + 2] = t.z;
    trees.species[i] = t.species; trees.heading[i] = t.heading; trees.scale[i] = t.scale; trees.tier[i] = t.tier;
  });
  const nc = cl.length;
  const clumps = {
    count: nc, tiles, species: new Uint16Array(nc), offset: new Uint8Array(nc * 2), y: new Int32Array(nc),
    heading: new Uint8Array(nc), scale: new Uint8Array(nc), tint: new Uint8Array(nc).fill(128),
  };
  cl.forEach((c, i) => {
    clumps.species[i] = c.species; clumps.offset[2 * i] = c.fx; clumps.offset[2 * i + 1] = c.fz;
    clumps.y[i] = c.y; clumps.heading[i] = c.heading; clumps.scale[i] = c.scale;
  });
  return writeMtm2Veg({
    species, trees, clumps, rule: vegRuleText(v, stem), info: vegInfoText(nt, nc, date),
  });
}

/*
  Reading: VegParseRule and its helpers.
*/
/** VegTrim: leading space / tab, trailing space / tab / CR / LF. */
function trim(s: string): string {
  return s.replace(/^[ \t]+/, "").replace(/[ \t\r\n]+$/, "");
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** strtoul(value, NULL, base) for a DWORD (MSVC: unsigned long is 32 bits). */
function strtoul(text: string, base: 10 | 16): number {
  const m = (base === 10 ? /^[ \t\n\v\f\r]*([+-]?)(\d+)/ : /^[ \t\n\v\f\r]*([+-]?)(?:0[xX])?([0-9a-fA-F]+)/).exec(text);
  if (!m) return 0;
  const n = BigInt(base === 10 ? m[2]! : `0x${m[2]}`);
  if (n > 0xffffffffn) return 0xffffffff;
  const v = Number(n);
  return m[1] === "-" ? (-v) >>> 0 : v >>> 0;
}

/** VegSplitCommas: up to `max` fields, the remainder in the last. */
function splitCommas(text: string, max: number): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length && out.length + 1 < max; i++) {
    if (text[i] === ",") { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

const atofF = (s: string): number => f32(cAtof(s));

/** VegParseEntry: one entry line; missing trailing fields keep the defaults. Null = no model. */
export function vegParseEntry(layer: number, value: string): VegEntry | null {
  const e = vegDefaultEntry(layer);
  const f = splitCommas(value, 24).map(trim);
  const n = f.length;
  if (!f[0]) return null;
  e.model = f[0].slice(0, VEG_MODELNAME - 1);
  const lc = (s: string) => s.toLowerCase();
  if (n > 1 && f[1]) e.weight = clampInt(cAtoi(f[1]), 1, 1000000);
  if (n > 2 && f[2]) e.scalemin = atofF(f[2]);
  if (n > 3 && f[3]) e.scalemax = atofF(f[3]);
  if (n > 4) e.rotate = lc(f[4]!) !== "norot";
  if (n > 5) {
    if (lc(f[5]!) === "trunk") e.collide = VEG_COLLIDE_TRUNK;
    else if (lc(f[5]!) === "model") e.collide = VEG_COLLIDE_MODEL;
    else if (f[5]) e.collide = VEG_COLLIDE_NONE;
  }
  if (n > 6 && f[6]) e.trunkdiam = atofF(f[6]);
  if (n > 7 && f[7]) e.trunkheight = atofF(f[7]);
  if (n > 8 && f[8]) e.sink = atofF(f[8]);
  if (n > 9 && f[9]) e.tier = clampInt(cAtoi(f[9]), 0, 255);
  if (n > 10) e.shadow = lc(f[10]!) === "noshadow" ? false : (f[10] ? true : e.shadow);
  if (n > 11 && f[11]) e.slopemax = atofF(f[11]);
  if (n > 12 && f[12]) e.farmodel = f[12].slice(0, VEG_MODELNAME - 1);
  if (n > 13) e.facing = lc(f[13]!) === "facing";
  if (n > 14 && f[14]) e.crossfade = lc(f[14]) !== "nocrossfade";
  if (e.scalemin <= 0) e.scalemin = VEG_DEFAULT_SCALEMIN;
  if (e.scalemax < e.scalemin) e.scalemax = e.scalemin;
  return e;
}

/** VegParseRule: unknown keys are ignored and missing ones keep their defaults. */
export function vegParseRule(v: Vegetation, text: string): void {
  const haveColour: boolean[][] = [[], []];
  const haveEntry: boolean[][][] = [[], []];
  const declared = [0, 0], highest = [-1, -1];
  const work: VegColour[][] = [[], []];
  const entries: (VegEntry | undefined)[][][] = [[], []];

  // The chunk is read as one C string: a NUL ends it.
  const nul = text.indexOf("\0");
  for (const lineText of (nul >= 0 ? text.slice(0, nul) : text).split(/[\r\n]+/)) {
    if (!lineText || lineText[0] === "#") continue;
    const eq = lineText.indexOf("=");
    if (eq < 0) continue;
    const key = trim(lineText.slice(0, eq)).toLowerCase();
    const value = trim(lineText.slice(eq + 1));

    if (key === "seed") v.seed = strtoul(value, 10);
    else if (key === "vmask") v.rulenamesmask[VEG_LAYER_TREES] = value.length > 0;
    else if (key === "gmask") v.rulenamesmask[VEG_LAYER_GRASS] = value.length > 0;
    else if (key === "vmaskcrc") v.plantedcrc[VEG_LAYER_TREES] = strtoul(value, 16);
    else if (key === "gmaskcrc") v.plantedcrc[VEG_LAYER_GRASS] = strtoul(value, 16);
    else if (key === "corridorft") v.corridorft = atofF(value);
    else if (key === "objectmarginft") v.objectmarginft = atofF(value);
    else if ((key[0] === "v" || key[0] === "g") && key[1] === ".") {
      const l = key[0] === "v" ? VEG_LAYER_TREES : VEG_LAYER_GRASS;
      let rest = key.slice(2);
      if (rest === "count") { declared[l] = clampInt(cAtoi(value), 0, VEG_MAX_COLOURS); continue; }
      if (!/^[0-9]/.test(rest)) continue;
      let c = 0, i = 0;
      while (i < rest.length && /[0-9]/.test(rest[i]!) && c < 1000) c = c * 10 + (rest.charCodeAt(i++) - 48);
      rest = rest.slice(i);
      if (rest[0] !== "." || c >= VEG_MAX_COLOURS) continue;
      rest = rest.slice(1);
      if (!haveColour[l]![c]) { work[l]![c] = vegDefaultColour(l); haveColour[l]![c] = true; }
      const col = work[l]![c]!;
      if (c > highest[l]!) highest[l] = c;
      if (rest === "rgb") {
        const m = /^\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*,\s*([+-]?\d+)/.exec(value);
        if (m) {
          col.r = clampInt(parseInt(m[1]!, 10) | 0, 0, 255);
          col.g = clampInt(parseInt(m[2]!, 10) | 0, 0, 255);
          col.b = clampInt(parseInt(m[3]!, 10) | 0, 0, 255);
        }
      } else if (rest === "name") col.name = value.slice(0, VEG_COLOURNAME - 1);
      else if (rest === "spacing") col.spacing = atofF(value);
      else if (rest === "density") col.density = clampInt(cAtoi(value), 0, 100);
      else if (rest === "pertile") col.pertile = clampInt(cAtoi(value), 0, VEG_MAX_CLUMPS_PER_TILE);
      else if (rest.startsWith("entry.")) {
        const m = cAtoi(rest.slice(6));
        const entry = m >= 0 && m < VEG_MAX_ENTRIES ? vegParseEntry(l, value) : null;
        if (entry) {
          (entries[l]![c] ??= [])[m] = entry;
          (haveEntry[l]![c] ??= [])[m] = true;
        }
      }
    }
  }

  // Close the gaps: colours the file named, in order, with only the entries that parsed.
  for (let l = 0; l < VEG_NLAYERS; l++) {
    const top = declared[l]! > highest[l]! + 1 ? declared[l]! : highest[l]! + 1;
    const out: VegColour[] = [];
    for (let c = 0; c < top; c++) {
      const col = haveColour[l]![c] ? work[l]![c]! : vegDefaultColour(l);
      col.entries = [];
      for (let m = 0; m < VEG_MAX_ENTRIES; m++) if (haveEntry[l]![c]?.[m]) col.entries.push(entries[l]![c]![m]!);
      out.push(col);
    }
    v.colours[l] = out;
  }
}

function keepForeign(v: Vegetation, bytes: Uint8Array): Vegetation {
  vegClearPlacements(v);
  resetRules(v);
  v.stale = false;
  v.foreign = bytes.slice();
  v.readonly = true;
  return v;
}

/*
  CTrackPODVegetation::ParseVEG: read a .VEG image into `v` (whose masks must already be set,
  for the stale verdict). With a RULE chunk: the rules, species, trees and clumps. Without:
  kept verbatim as read-only. False when the file is unusable (v is then left as it was).
*/
export function vegParseImage(v: Vegetation, bytes: Uint8Array): boolean {
  if (bytes.length < VEG_HEADER_SIZE || String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) !== "MVEG") return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(4, true) > 1) { keepForeign(v, bytes); return true; }
  const headersize = dv.getUint32(8, true);
  if (dv.getUint16(16, true) !== VEG_TILES || dv.getUint16(18, true) !== VEG_TILES) { keepForeign(v, bytes); return true; }
  if (headersize < VEG_HEADER_SIZE || headersize > bytes.length) { keepForeign(v, bytes); return true; }
  let parsed: Veg;
  try { parsed = parseMtm2Veg(bytes); } catch { keepForeign(v, bytes); return true; }
  const hasPlacements = parsed.trees.count > 0 || parsed.clumps.count > 0 || hasChunk(bytes, "TREE") || hasChunk(bytes, "GRAS");
  const hasRule = parsed.rule !== null;
  if (!hasPlacements && !hasRule) { keepForeign(v, bytes); return true; }

  vegClearPlacements(v);
  resetRules(v);
  v.stale = false;
  v.readonly = false;

  v.species = parsed.species.slice(0, VEG_ENGINE_MAX_SPECIES).map((s) => ({
    model: s.model.slice(0, VEG_MODELNAME - 1), farmodel: s.farModel.slice(0, VEG_MODELNAME - 1), kind: s.kind,
    collide: s.collide, flags: s.flags, trunkdiam: s.trunkDiameter, trunkheight: s.trunkHeight,
  }));
  const ns = v.species.length;
  const t = parsed.trees;
  for (let i = 0; i < Math.min(t.count, VEG_ENGINE_MAX_TREES); i++) {
    const sp = t.species[i]!, x = t.position[3 * i]!, z = t.position[3 * i + 2]!;
    // The engine's own skip rules (format section 5.2).
    if (sp >= ns || v.species[sp]!.kind !== VEG_KIND_PLACED) continue;
    if (t.scale[i]! < 256) continue;
    if (x < 0 || x >= VEG_TILES * VEG_TILE_SUBUNITS || z < 0 || z >= VEG_TILES * VEG_TILE_SUBUNITS) continue;
    v.trees.push({ x, y: t.position[3 * i + 1]!, z, species: sp, heading: t.heading[i]!, scale: t.scale[i]!, tier: t.tier[i]! });
  }
  const c = parsed.clumps;
  const ccount = Math.min(c.count, VEG_ENGINE_MAX_CLUMPS);
  let havePrev = false, prevKey = 0, prevEnd = 0;
  for (const tile of c.tiles) {
    if (tile.tx >= VEG_TILES || tile.tz >= VEG_TILES) continue;
    const key = tile.tz * VEG_TILES + tile.tx;
    // The format's four tile skip rules (section 5.3).
    if (tile.count > VEG_MAX_CLUMPS_PER_TILE) continue;
    if (tile.first > ccount || tile.count > ccount - tile.first) continue;
    if (havePrev && key <= prevKey) continue;
    if (havePrev && tile.first < prevEnd) continue;
    prevKey = key; prevEnd = tile.first + tile.count; havePrev = true;
    for (let j = 0; j < tile.count; j++) {
      const i = tile.first + j;
      const sp = c.species[i]!;
      if (sp >= ns || v.species[sp]!.kind !== VEG_KIND_GROUND) continue;
      v.clumps.push({
        tx: tile.tx, tz: tile.tz, species: sp, fx: c.offset[2 * i]!, fz: c.offset[2 * i + 1]!, y: c.y[i]!,
        heading: c.heading[i]!, scale: c.scale[i]!,
      });
    }
  }

  if (hasRule) {
    vegParseRule(v, parsed.rule!);
    vegUpdateStale(v);
  } else {
    v.foreign = bytes.slice();
    v.readonly = true;
  }
  return true;
}

function hasChunk(bytes: Uint8Array, id: string): boolean {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dir = dv.getUint32(8, true);
  const count = Math.min(dv.getUint32(12, true), Math.floor((bytes.length - dir) / 16));
  for (let i = 0; i < count; i++) {
    const p = dir + i * 16;
    if (String.fromCharCode(bytes[p]!, bytes[p + 1]!, bytes[p + 2]!, bytes[p + 3]!) === id) return true;
  }
  return false;
}

/*
  The V15 .TXX block (TrackPODBinary.cpp): masks first, then the image, so the stale verdict
  compares the masks just set. `block` is txx.ts's TxxVegetation.
*/
export function vegetationFromTxx(block: { masks: (VegMaskFile | null)[]; image: Uint8Array | null } | null): Vegetation {
  const v = emptyVegetation();
  if (!block) return v;
  for (let l = 0; l < VEG_NLAYERS; l++) {
    const m = block.masks[l];
    v.masks[l] = m && m.data.length > 0 ? { ext: m.ext, data: m.data } : null;
  }
  if (block.image && block.image.length > 0) vegParseImage(v, block.image);
  return v;
}

/** The V15 block a save writes: the masks and the BuildVEG image (null when it fails). */
export function vegetationToTxx(v: Vegetation, stem: string, date = vegToday()): { masks: (VegMaskFile | null)[]; image: Uint8Array | null } {
  return { masks: v.masks.map((m) => (m ? { ext: m.ext, data: m.data } : null)), image: vegIsEmpty(v) ? null : buildVeg(v, stem, date) };
}

/** The pod loader's mask names for a layer, in the order it tries them (TrackPODFile.cpp). */
export function vegPodMaskNames(prefix: string, layer: number): string[] {
  const suffix = layer === VEG_LAYER_TREES ? "_V" : "_G";
  return [".PNG", ".TGA"].map((ext) => `ART\\${prefix}${suffix}${ext}`.slice(0, 63).toUpperCase());
}

/*
  The pod loader (TrackPODFile.cpp): WORLD\<stem>.VEG, then the masks RULE names, then the stale
  verdict. `entry` returns an entry's bytes or null.
*/
export async function vegetationFromPod(prefix: string, entry: (name: string) => Promise<Uint8Array | null>): Promise<Vegetation> {
  const v = emptyVegetation();
  const image = await entry(`WORLD\\${prefix}.VEG`.slice(0, 63).toUpperCase());
  if (image && image.length > 0) vegParseImage(v, image);
  for (let l = 0; l < VEG_NLAYERS; l++) {
    if (!v.rulenamesmask[l]) continue;
    const names = vegPodMaskNames(prefix, l);
    for (let e = 0; e < names.length; e++) {
      const data = await entry(names[e]!);
      if (data === null) continue;
      if (data.length > 0) { v.masks[l] = { ext: e === 0 ? ".PNG" : ".TGA", data }; v.maskFromPod[l] = true; }
      break;
    }
  }
  vegUpdateStale(v);
  return v;
}

/*
  The .TXV lines (TrackPODFile.cpp): only when the .VEG carries placements. formatVersion is
  raised to at least 3 then.
*/
export function vegTxvLines(v: Vegetation): string {
  if (v.trees.length === 0 && v.clumps.length === 0) return "";
  return `vegetation=1\r\nvegTrees=${v.trees.length}\r\nvegClumps=${v.clumps.length}\r\n`;
}

/** The formatVersion the .TXV rule asks for: at least 3 with placements. */
export function vegTxvFormatVersion(v: Vegetation, current: number): number {
  return (v.trees.length || v.clumps.length) && current < 3 ? 3 : current;
}

/** Deep copy (CopyFrom). */
export function vegCopy(v: Vegetation): Vegetation {
  return structuredClone(v);
}
