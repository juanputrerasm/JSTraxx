/*
  "Will the game instance this model?" and a model's lowest point as the engine takes it: the
  two facts about a vegetation model's raw .BIN bytes that decide how its far card is drawn.

  ModelWillInstance is TrackPOD/TrackPODInstancing.cpp (the engine's instModelValidate, with its
  default INI switches); vegFarCardBaseY is Traxx/VegetationFarCard.cpp VegFarCardBaseY. The
  engine only uses a far card when the near model AND the card both instance; otherwise the
  model is drawn at every distance (COpenGLTerrainRenderer::VegEnsureList).

  The texture-loadable callback is optional, as in Traxx: the viewport passes NULL (every texture
  counts as loadable); the Write POD warning and the planter pass InstPodTextureOK's rule (a
  texture the track holds but marked bad is not loadable), and Make Far Cards VcTexOK's.
*/

const INST_EOL = 0;
const INST_VLIST = 2;
const INST_ILIST = 3;
const INST_FACETTMAP = 14;
const INST_FACETTTMAP = 17;
const INST_MAGNIFY = 20;
const INST_ZFACETTMAP = 24;
const INST_FFACETTMAP = 30;
const INST_ZPFACETTMAP = 34;
const INST_ZGFACETTMAP = 41;
const INST_UZFACETTTMAP = 51;
const INST_UZFACETTMAP = 52;
const INST_ZXFACETTMAP = 56;
const INST_TEXTURE = 13;
const INST_TEXTURE64 = 62;
const INST_MATERIAL = 63;
const INST_MATFACET = 64;
const INST_MATERIAL2 = 66;
const INST_KEYFRAME = 32;
const INST_KEYSCRIPT = 38;
const INST_KEYFRAME64 = 65;

const SIZE_BAD = -1;
const SIZE_UNMEASURED = -2;
const SIZE_HUGE = 0x7fffffff;

const BYTES_MAGNIFY = 8;
const BYTES_TEXTURE = 24;
const BYTES_TEXTURE64 = 72;
const BYTES_MATERIAL = 48;
const BYTES_MATERIAL2 = 32;
const BYTES_LIST = 12;
const BYTES_FACET = 24;

const MAT_LIT = 0x0001;
const MAT_GOURAUD = 0x0002;
const MAT_ALPHATEST = 0x0008;
const MAT_TWOSIDED = 0x0080;
const MAT_TRANSLUCENT = 0x1000;
const MAT_INSTANCEABLE = MAT_LIT | MAT_GOURAUD | MAT_ALPHATEST | MAT_TWOSIDED | MAT_TRANSLUCENT;

function rd(bin: Uint8Array, at: number): number {
  return (bin[at]! | (bin[at + 1]! << 8) | (bin[at + 2]! << 16) | (bin[at + 3]! << 24)) | 0;
}

/* InstRecordBytes: MRGLSizeRaw for the record at byte p, in bytes. */
function recordBytes(bin: Uint8Array, p: number, len: number): number {
  const code = rd(bin, p);
  const avail = len - p;
  let hdr: number, per: number, cntat: number;
  switch (code) {
    case 0: return 4;
    case 1: return 16;
    case 9: return 32;
    case 10: return 8;
    case 11: return 8;
    case 12: return 28;
    case INST_TEXTURE: return BYTES_TEXTURE;
    case INST_TEXTURE64: return BYTES_TEXTURE64;
    case INST_MATERIAL: return BYTES_MATERIAL;
    case INST_MATERIAL2: return BYTES_MATERIAL2;
    case 16: return 20;
    case 18: return 8;
    case INST_MAGNIFY: return BYTES_MAGNIFY;
    case 23: return 12;
    case 61: return 8;
    case INST_KEYFRAME: return 344;
    case INST_KEYFRAME64: return 4376;
    case INST_KEYSCRIPT: return SIZE_UNMEASURED;
    case INST_VLIST: case INST_ILIST: hdr = BYTES_LIST; cntat = 8; per = 12; break;
    case 4: hdr = BYTES_LIST; cntat = 8; per = 8; break;
    case 31: hdr = BYTES_LIST; cntat = 8; per = 4; break;
    case 22: hdr = 8; cntat = 4; per = 4; break;
    case 29: hdr = 28; cntat = 8; per = 32; break;
    case 5: case 6: case 7: case 8: case 15: case 21: case 25: case 26: case 27: case 33:
      hdr = BYTES_FACET; cntat = 4; per = 4; break;
    case INST_FACETTMAP: case INST_FACETTTMAP: case INST_ZFACETTMAP: case INST_ZGFACETTMAP: case INST_FFACETTMAP:
    case INST_ZPFACETTMAP: case INST_UZFACETTTMAP: case INST_ZXFACETTMAP: case INST_UZFACETTMAP: case INST_MATFACET:
      hdr = BYTES_FACET; cntat = 4; per = 12; break;
    default: return SIZE_BAD;
  }
  if (cntat + 4 > avail) return SIZE_HUGE;
  const s = hdr + rd(bin, p + cntat) * per;
  if (s <= 0) return SIZE_BAD;
  if (s > SIZE_HUGE) return SIZE_HUGE;
  return s;
}

/* InstFamilyOK: instFamilyClass, the instanceable plain facet opcodes. */
function familyOk(code: number): boolean {
  return code === INST_ZGFACETTMAP || code === INST_ZFACETTMAP || code === INST_ZPFACETTMAP || code === INST_FACETTMAP ||
    code === INST_FFACETTMAP || code === INST_UZFACETTMAP || code === INST_FACETTTMAP || code === INST_UZFACETTTMAP || code === INST_ZXFACETTMAP;
}

/* InstMaterialOK: instMaterialClass under the default INI; the reason or null. */
function materialProblem(haveMat: boolean, flags: number): string | null {
  if (!haveMat) return "a material facet with no material before it (malformed model)";
  if (flags & ~MAT_INSTANCEABLE) {
    return `its material flags 0x${(flags >>> 0).toString(16).toUpperCase().padStart(4, "0")} are not instanceable (blend, additive, reflect, fresnel, nozwrite, emissive, tint and alpharef all keep a model off instancing)`;
  }
  if ((flags & MAT_TWOSIDED) && !(flags & MAT_ALPHATEST)) return "its material is two-sided without alpha-test (double-sided opaque has no instanced slot)";
  return null;
}

/** ModelTextureOKFunc: is the texture the record names (upper case, at most 31 characters) loadable? */
export type ModelTextureOk = (name: string) => boolean;

/**
  ModelWillInstance over the raw .BIN bytes: null when the game will instance the model,
  otherwise the reason. Pass 1 is loadModel's truncation walk, pass 2 instModelValidate on the
  stream as truncated. `texOk` is the optional texture-loadable callback.
*/
export function modelInstanceProblem(bin: Uint8Array | null, texOk?: ModelTextureOk | null): string | null {
  const len = bin ? bin.length : 0;
  if (!bin || len < 4) return "the model has no data";
  const first = rd(bin, 0);
  if (first !== INST_MAGNIFY && first !== INST_KEYFRAME && first !== INST_KEYFRAME64) {
    return `the game will not load it at all (its first record, opcode ${first}, is neither MAGNIFY nor a keyframe)`;
  }

  let q = 0;
  while (q + 4 <= len && rd(bin, q) !== INST_EOL) {
    const s = recordBytes(bin, q, len);
    if (s === SIZE_UNMEASURED) { q = len; break; }
    if (s <= 0 || s > len - q) break;
    q += s;
  }
  const end = q;

  let p = first === INST_MAGNIFY ? BYTES_MAGNIFY : 0;
  let vbase = 0, vcount = 0, haveVlist = false, sawTexture = false, sawFacet = false, haveMat = false, matFlags = 0;
  for (;;) {
    if (p + 4 > end) break;
    const code = rd(bin, p);
    if (code === INST_EOL) break;
    let size: number;
    if (code === INST_MATERIAL) {
      if (p + BYTES_MATERIAL > len) return "a material record runs past the end of the model";
      haveMat = true;
      matFlags = rd(bin, p + 4);
      size = BYTES_MATERIAL;
    } else if (code === INST_MATERIAL2) {
      size = BYTES_MATERIAL2;
    } else if (code === INST_VLIST) {
      if (p + BYTES_LIST > len) return "a vertex list runs past the end of the model";
      vbase = rd(bin, p + 4);
      const n = (vcount = rd(bin, p + 8));
      haveVlist = true;
      if (n < 0 || n > Math.trunc((len - p - BYTES_LIST) / 12)) return "a vertex list runs past the end of the model";
      size = BYTES_LIST + n * 12;
    } else if (code === INST_TEXTURE || code === INST_TEXTURE64) {
      size = code === INST_TEXTURE ? BYTES_TEXTURE : BYTES_TEXTURE64;
      if (p + size > len) return "a texture record runs past the end of the model";
      sawTexture = true;
      // Bounded, NUL-terminated, upper case, cut to the 31 characters a pod name holds (MODELTEXNAMELEN - 1).
      const namelen = code === INST_TEXTURE ? 16 : 64;
      let name = "";
      for (let i = 0; i < namelen && i < 31; i++) {
        const c = bin[p + 8 + i]!;
        if (c === 0) break;
        name += String.fromCharCode(c >= 0x61 && c <= 0x7a ? c - 0x20 : c);
      }
      if (name === "") return "a texture record has an empty name (the game cannot load art with no name)";
      if (texOk && !texOk(name)) return `texture ${name} is not loadable`;
    } else if (code === INST_ILIST) {
      if (p + BYTES_LIST > len) return "a normals list runs past the end of the model";
      const n = rd(bin, p + 8);
      if (n < 0 || n > Math.trunc((len - p - BYTES_LIST) / 12)) return "a normals list runs past the end of the model";
      size = BYTES_LIST + n * 12;
    } else {
      if (code === INST_MATFACET) {
        const why = materialProblem(haveMat, matFlags);
        if (why) return why;
      } else if (!familyOk(code)) {
        return `it uses a facet or record type the game cannot instance (opcode ${code}: flat-colour faces, alpha-blend, colour, texture-cycle, opacity and keyframe records all keep a model off instancing)`;
      }
      if (!sawTexture) return `a face (opcode ${code}) comes before any texture`;
      if (p + BYTES_FACET > len) return "a face runs past the end of the model";
      const n = rd(bin, p + 4);
      if (n < 3 || !haveVlist) return `a face (opcode ${code}) has ${n} points or no vertex list`;
      if (n > Math.trunc((len - p - BYTES_FACET) / 12)) return "a face runs past the end of the model";
      for (let k = 0; k < n; k++) {
        const idx = rd(bin, p + BYTES_FACET + k * 12) - vbase;
        if (idx < 0 || idx >= vcount) return `a face has a vertex index (${idx}) outside its vertex list`;
      }
      if (code === INST_UZFACETTTMAP || code === INST_FACETTTMAP) {
        const gu = rd(bin, p + BYTES_FACET + 4), gv = rd(bin, p + BYTES_FACET + 8);
        let degenerate = true;
        for (let k = 1; k < n; k++) {
          if (rd(bin, p + BYTES_FACET + k * 12 + 4) !== gu || rd(bin, p + BYTES_FACET + k * 12 + 8) !== gv) { degenerate = false; break; }
        }
        if (degenerate) return "it uses the transparent-face glass trick (a face with all its corners on one texture point), which the game draws per object";
      }
      sawFacet = true;
      size = BYTES_FACET + n * 12;
    }
    p += size;
  }
  if (!sawFacet) return "it has no drawable face";
  return null;
}

/**
  VegFarCardBaseY: the lowest vertex of the FIRST VLIST (the second int of each vertex is up),
  as the file has it and as the engine scales it by MAGNIFY. Null when the engine could not
  read it (first record not MAGNIFY, or not followed at once by a VLIST).
*/
export function vegFarCardBaseY(bin: Uint8Array | null): { fileMinY: number; engineMinY: number } | null {
  if (!bin || bin.length < 20 + 12) return null;
  if (rd(bin, 0) !== INST_MAGNIFY || rd(bin, 8) !== INST_VLIST) return null;
  const power = rd(bin, 4), n = rd(bin, 16);
  if (power <= 0 || n <= 0 || 20 + n * 12 > bin.length) return null;
  let ymin = rd(bin, 24);
  for (let i = 1; i < n; i++) {
    const y = rd(bin, 20 + i * 12 + 4);
    if (y < ymin) ymin = y;
  }
  const scale = (Math.trunc(0x7fffffff / power) * 2) | 0;
  // fmul(a, b) = (a * b) >> 16 on 64-bit integers.
  const engineMinY = Number((BigInt(ymin) * BigInt(scale)) >> 16n) | 0;
  return { fileMinY: ymin, engineMinY };
}

/** VegInstanceIssue: a species model the game will not instance, its kind (VEG_KIND_*) and why. */
export interface VegInstanceIssue { model: string; kind: number; why: string }

/**
  VegModelsThatWillNotInstance (TrackPOD/TrackPODInstancing.cpp): every species model the game
  will not instance, at most `max`. The planted species table when there is one; otherwise the
  colour entries (the trees layer as placed, the grass layer as ground). Each model once per
  kind; a model the track does not hold is skipped (InstJudge). `modelBytes` is IsModelLoaded +
  GetData (null when absent); `texOk` is InstPodTextureOK.
*/
export function vegModelsThatWillNotInstance(
  veg: { species: readonly { model: string; kind: number }[]; colours: readonly (readonly { entries: readonly { model: string }[] }[])[] },
  modelBytes: (bareName: string) => Uint8Array | null,
  texOk: ModelTextureOk | null,
  max = 16,
): VegInstanceIssue[] {
  const out: VegInstanceIssue[] = [];
  const judge = (bare: string, kind: number) => {
    if (!bare) return;
    const up = bare.toUpperCase();
    if (out.some((o) => o.kind === kind && o.model.toUpperCase() === up)) return;
    const bytes = modelBytes(bare);
    if (!bytes) return;
    const why = modelInstanceProblem(bytes, texOk);
    if (why === null || out.length >= max) return;
    out.push({ model: bare.slice(0, 63), kind, why: why.slice(0, 199) });
  };
  // VEG_KIND_GROUND = 1, VEG_KIND_PLACED = 0, VEG_LAYER_GRASS = 1.
  if (veg.species.length > 0) for (const s of veg.species) judge(s.model, s.kind === 1 ? 1 : 0);
  else veg.colours.forEach((layer, l) => { for (const c of layer) for (const e of c.entries) judge(e.model, l === 1 ? 1 : 0); });
  return out;
}

/**
  InstPodTextureOK: loadable unless the track holds the texture (IsModelTextureLoaded on the
  bare name) and has marked it bad. `find` is IsModelTextureLoaded; a texture absent from the
  track is not refused (the integrity report names it).
*/
export function instPodTextureOk(find: (name: string) => { bad: boolean } | null): ModelTextureOk {
  return (name) => {
    const t = find(name.slice(0, 31));
    return t ? !t.bad : true;
  };
}
