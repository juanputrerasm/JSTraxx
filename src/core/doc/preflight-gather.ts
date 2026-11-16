/*
  The Write POD pre-flight's gathering half (Traxx 1.8.0, Traxx/PodPreflightGather.cpp): read a
  document into the plain PfInput that core/traxx/preflight.ts checks. No judgement lives here;
  every limit is in preflight.ts.

  Not gathered, as in Traxx: the lines the writer emits as fixed or stem-derived text, the stem's
  characters (CheckIntegrity), the _DTL / _WDTL over 2048 (the export's resample prompt), lakes and
  waterfalls in error (podRefusal refuses the export first), and vegetation (Traxx's own caps are
  under the engine's).

  Changed: Traxx looks for each texture's HD file beside it in its ART folder; JSTraxx takes the
  texture's own HD source or the one the asset worker found (the same `extras` the writer packs),
  so the pre-flight judges exactly the bytes that go into the pod. A decode verdict is cached per
  HD source, as Traxx caches it per file.
*/
import type { TrackDocument, TextureAsset } from "./document.ts";
import { MTM2_ONLY } from "./document.ts";
import type { TextureExtras } from "../traxx/pod-writer.ts";
import {
  podPreflightCheck, podPreflightFallHasSound, podPreflightLegacyWritten, PF_HD_MAX, PF_HD_NOBODY, PF_HD_NOHEADER, PF_HD_NONE, PF_HD_OK,
  type PfAni, type PfBox, type PfInput, type PfList, type PfMap, type PfTex,
} from "../traxx/preflight.ts";
import { hdGetInfoMem } from "../image/hd-texture.ts";
import { decodeTga } from "../image/image-format.ts";
import { decodePngSamples } from "../../vendor/openphotex/texture/png.js";
import { TERRAINMODE_CLASSIC8 } from "../traxx/terrain16.ts";
import { musicKind } from "../traxx/pod-writer.ts";
import { buildLakeGround } from "../traxx/surface.ts";
import { recomputeLakes, withStoredLakes, LAKE_RULE_EDGE } from "../traxx/lakes.ts";
import {
  buildFallShape, emptyFallShape, fallBudget, fallEffectiveHeight, fallErrors, fallGroundFor, fallMistLandings, fallNameInPod, trackNotches,
  FALL_MAX_FALLS, FALL_SHAPE_ERRORS, type FallShape,
} from "../traxx/falls.ts";
import { fallWorldOf } from "../traxx/v6.ts";

const shortName = (name: string) => {
  const s = name.lastIndexOf("\\");
  return s >= 0 ? name.slice(s + 1) : name;
};

/** Does the picture decode (HDTexDecodeImageBGR)? */
function hdDecodes(data: Uint8Array): boolean {
  try {
    if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) decodePngSamples(data);
    else decodeTga(data, "texture");
    return true;
  } catch {
    return false;
  }
}

/** ExportOmitsRawFallback: the author's setting, or forced on by any terrain mode but Classic 8-bit. */
export function exportOmitsRawFallback(t: { omitRawFallback: boolean; terrainMode: number }): boolean {
  return t.omitRawFallback || t.terrainMode !== TERRAINMODE_CLASSIC8;
}

/** GatherTexture. */
function gatherTexture(tex: TextureAsset, type: number, omit: boolean, model: boolean, extras: ReadonlyMap<string, TextureExtras> | undefined, cache: Map<Uint8Array, boolean>): PfTex {
  const out: PfTex = { name: shortName(tex.name), w: tex.side, h: tex.side, type, hdstate: PF_HD_NONE, hdw: 0, hdh: 0, legacyWritten: true, model };
  const hd = tex.hd ?? extras?.get(tex.name.toUpperCase())?.hd ?? null;
  if (!tex.name.includes("\\") || !hd) return out;
  const info = hdGetInfoMem(hd.data, `${shortName(tex.name)}`);
  if ("err" in info) out.hdstate = PF_HD_NOHEADER;
  else { out.hdstate = PF_HD_OK; out.hdw = info.width; out.hdh = info.height; }
  out.legacyWritten = podPreflightLegacyWritten(true, omit, tex.bad);
  // Only when the .RAW is left out does a picture that will not decode matter; over 2048 it is not decoded.
  if (out.hdstate === PF_HD_OK && !out.legacyWritten && out.hdw <= PF_HD_MAX && out.hdh <= PF_HD_MAX) {
    let ok = cache.get(hd.data);
    if (ok === undefined) { ok = hdDecodes(hd.data); cache.set(hd.data, ok); }
    if (!ok) out.hdstate = PF_HD_NOBODY;
  }
  return out;
}

/** GatherMap. */
function gatherMap(data: Uint8Array, ext: string, suffix: string): PfMap {
  const out: PfMap = { suffix, extlen: ext ? ext.length : 4, dimsKnown: false, w: 0, h: 0 };
  const info = hdGetInfoMem(data, `${suffix}${ext || ".PNG"}`);
  if (!("err" in info)) { out.dimsKnown = true; out.w = info.width; out.h = info.height; }
  return out;
}

/**
  The mist volumes each fall registers (MistLandings), built the way the view builds the shapes
  (FallShapesEnsure): errors, shapes for falls without shape errors, nobudget for a fall in error,
  Budget, then MistLandings. Null when there are no falls.
*/
export function trackMistLandings(doc: TrackDocument): number[] | null {
  const t = doc.track;
  const falls = t.falls ?? [];
  const n = Math.min(falls.length, FALL_MAX_FALLS);
  if (n <= 0) return null;
  const notches = trackNotches({ falls, worldCells: t.worldCells, lakeRule: LAKE_RULE_EDGE });
  const lg = buildLakeGround(t);
  const st = t.lakes.length && lg ? withStoredLakes(t, recomputeLakes(lg, t.lakes, t.waterLevel4, notches)) : null;
  const world = fallWorldOf(t, doc.carry.situationIsSi3);
  const lakes = { lakes: t.lakes, tmap: st?.tmap ?? null, world, rule: LAKE_RULE_EDGE };
  const names = fallNameInPod(t.sounds, doc.textures, doc.modelTextures);
  const g = fallGroundFor(t, lakes.tmap, world);
  const err = falls.slice(0, n).map((_, f) => fallErrors(falls, f, lakes, names, lg));
  const shapes: FallShape[] = falls.slice(0, n).map((w, f) => (err[f]! & FALL_SHAPE_ERRORS ? emptyFallShape() : buildFallShape(w, fallEffectiveHeight(falls, f, t.lakes), g)));
  shapes.forEach((s, f) => { s.nobudget = err[f] !== 0; });
  fallBudget(shapes);
  return fallMistLandings(falls, t.lakes, err, shapes, g);
}

/** PodPreflightRun's gathering: the document as the writer will see it. */
export function gatherPreflight(doc: TrackDocument, extras?: ReadonlyMap<string, TextureExtras>): PfInput {
  const t = doc.track;
  const box: PfBox[] = t.boxes.map((b, i) => ({
    index: i + 1, type: b.type, model: b.modelName ? shortName(b.modelName) : null,
    sndImpact: b.soundImpact, sndCont: b.soundCont, lightRad: b.light.radius,
  }));
  const nCourseSeg = [t.course.length, ...[0, 1, 2, 3].map((i) => t.extendedCourses[i]?.length ?? 0)];
  const falls = t.falls ?? [];
  const nFallSounds = falls.filter((f) => podPreflightFallHasSound(f.flags, f.sound)).length;
  const weatherWritten = (t.versionFlags & MTM2_ONLY) !== 0;
  let stockBgm: string | null = null;
  if (t.music && musicKind(t.music) === "stock") {
    let s = "";
    for (let i = 6; i < t.music.length && t.music[i] !== 0; i++) s += String.fromCharCode(t.music[i]!);
    stockBgm = s.slice(0, 127);
  }
  const omit = exportOmitsRawFallback(t);
  const cache = new Map<Uint8Array, boolean>();
  const tex: PfTex[] = [];
  let maxIndex = -1;
  doc.textures.forEach((x, i) => {
    if (x) maxIndex = i;
    if (x && x.indices && x.side) tex.push(gatherTexture(x, t.textures[i]?.type ?? 0, omit, false, extras, cache));
  });
  for (const x of doc.modelTextures) if (x.indices && x.side) tex.push(gatherTexture(x, 0, omit, true, extras, cache));
  const ani: PfAni[] = t.animations.map((a) => {
    const nameOf = (k: number) => doc.textures[k]?.name ?? null;
    let longest = 0;
    for (let j = 0; j < a.nframes && j < 8; j++) {
      let n = nameOf(a.frames[j]!) ?? "NULL.RAW";
      if (n.startsWith("ART\\")) n = n.slice(4);
      if (n.length > longest) longest = n.length;
    }
    const first = nameOf(a.frames[0]!);
    return { period: a.period, nframes: a.nframes, longestName: longest, name: first ? shortName(first) : null };
  });
  const map: PfMap[] = [];
  if (t.detailMap) map.push(gatherMap(t.detailMap, t.detailExt, "_DTL"));
  if (t.maskMap) map.push(gatherMap(t.maskMap, t.maskExt, "_MASK"));
  if (t.waterDetailMap) map.push(gatherMap(t.waterDetailMap, t.waterDetailExt, "_WDTL"));
  if (t.waterMaskMap) map.push(gatherMap(t.waterMaskMap, t.waterMaskExt, "_WMSK"));
  return {
    stem: t.prefix, trackName: t.trackName, box, nCourseSeg, nFallSounds, stadium: Boolean(t.arena && t.backdropName),
    mistLandings: trackMistLandings(doc), weatherWritten, weatherMask: t.weatherMask,
    bgmChecked: weatherWritten, stockBgm, texCount: maxIndex + 1, tex, ani, map,
  };
}

/** PodPreflightRun: gather, then check. */
export function podPreflightRun(doc: TrackDocument, extras?: ReadonlyMap<string, TextureExtras>): PfList {
  return podPreflightCheck(gatherPreflight(doc, extras));
}
