/*
  Object Properties (Traxx/ObjectPropertiesDlg.cpp and CTraxxView::OnObjectProperties):

    objectFields       what the dialog shows for a box (OnInitDialog)
    previewObject      ApplySettings: the place, height, angles and size, live while editing
    applyObjectFields  OnObjectProperties on OK: every field, the 500 height cap, the sounds,
                       the checkpoint sequence and the caps on ramps, top-crush, movers, lights
    setObjectSound     SetObjectSound: a stock sound, one the track holds, or a WAV added
*/
import type { TxxTrack } from "../traxx/txx.ts";
import { traxxSignedSplit, TRAXX_BOX_CRUSH, TRAXX_BOX_LIGHT, TRAXX_BOX_RAMP, type TraxxBox, type TraxxLight } from "../traxx/sit.ts";
import { interpolateRawAtPoint } from "../traxx/terrain.ts";
import { POD1_NAME_MAX } from "../traxx/pod-items.ts";
import { STOCK_CONT_SOUNDS, STOCK_SOUNDS } from "../traxx/stock-data.ts";
import { findAsset } from "../doc/names.ts";
import { applyTypeIndex, CHECKPOINT, typeToIndex } from "./objects.ts";

export const SOUND_CONTINUOUS = 1;
/** MAXNPODSOUNDS. */
export const MAX_SOUNDS = 512;
/** The caps OnObjectProperties checks after OK. */
const MAX_RAMPS = 100, MAX_TOP_CRUSH = 100, MAX_MOVERS = 100, MAX_LIGHTS = 100, MAX_CHECKPOINTS = 20;
const HAG_MAX = 500;

export interface ObjectFields {
  /** The Type list's index (ObjectPropertiesDlg.h: Ramp 14, Top-Crush 15). */
  typeIndex: number;
  checkpoint: number;
  vx: number;
  vy: number;
  /** Size: width, length (shown as H), height (shown as D), for a box without a model. */
  sizeW: number;
  sizeH: number;
  sizeD: number;
  /** Position in ipos steps with the fraction, and the height above ground in steps. */
  fx: number;
  fy: number;
  fz: number;
  mass: number;
  /** Degrees: orientation (psi), elevation (phi), tilt (theta). */
  angle: number;
  elev: number;
  tilt: number;
  /** Scenery level (priority): 0 sparse, 1 normal, 2 complex. */
  level: number;
  crush: [number, number, number];
  /** Sound names without the extension. */
  soundCont: string;
  soundImpact: string;
  light: TraxxLight;
}

const f32 = Math.fround;
const PI = 3.1415926535898;

/** m_objangle = (180 * psi) / 3.141592654f, kept in 0..360. */
function degrees(rad: number): number {
  let d = f32(f32(180 * rad) / f32(3.141592654));
  while (d < 0) d = f32(d + 360);
  while (d > 360) d = f32(d - 360);
  return d;
}

/** (float)(PI * (double)deg / 180.0f). */
export function radians(deg: number): number {
  return f32((PI * deg) / 180);
}

const stripExt = (name: string) => { const dot = name.lastIndexOf("."); return dot >= 0 ? name.slice(0, dot) : name; };

export function objectFields(box: TraxxBox): ObjectFields {
  return {
    typeIndex: typeToIndex(box.type),
    checkpoint: box.checkpointSeq,
    vx: Math.trunc(box.bvel[0]),
    vy: Math.trunc(box.bvel[1]),
    sizeW: box.width,
    sizeH: box.length,
    sizeD: box.height,
    fx: f32(box.ipos[0] + box.fraction[0] / 256),
    fy: f32(box.ipos[1] + box.fraction[1] / 256),
    fz: f32(box.heightAboveGround + box.fraction[2] / 256),
    mass: Math.trunc(box.mass),
    angle: degrees(box.psi),
    elev: degrees(box.phi),
    tilt: degrees(box.theta),
    level: box.priority,
    crush: [...box.crush],
    soundCont: stripExt(box.soundCont),
    soundImpact: stripExt(box.soundImpact),
    light: { ...box.light },
  };
}

/** ApplySettings: what the view shows while the dialog is open. */
export function previewObject(box: TraxxBox, heights: Uint8Array, f: ObjectFields): void {
  [box.ipos[0], box.fraction[0]] = traxxSignedSplit(Math.max(0, f.fx));
  [box.ipos[1], box.fraction[1]] = traxxSignedSplit(Math.max(0, f.fy));
  [box.heightAboveGround, box.fraction[2]] = traxxSignedSplit(f.fz);
  box.ipos[2] = interpolateRawAtPoint(heights, box.ipos[0], box.ipos[1]) + box.heightAboveGround;
  box.psi = radians(f.angle);
  box.phi = radians(f.elev);
  box.theta = radians(f.tilt);
  box.height = f.sizeD;
  box.length = f.sizeH;
  box.width = f.sizeW;
}

/** IsStockSound: a name ("AIRHORN.WAV") of the game's own sounds, either list. */
export function isStockSound(wav: string): boolean {
  const up = wav.toUpperCase();
  return [...STOCK_SOUNDS, ...STOCK_CONT_SOUNDS].some(([n]) => `${n.toUpperCase()}.WAV` === up);
}

/** Pod1SoundStemBudget: SOUND\<stem> with .WAV and .KLP, at most the tools' 18. */
const soundBudget = () => Math.min(18, POD1_NAME_MAX - "SOUND\\".length - 4);

/**
  SetObjectSound: the name, upper case and within the budget, with .WAV, onto the box. A stock
  sound or one the track holds needs nothing more, unless the track holds it for the other use;
  otherwise `wav` (the file picked) is added to the track's sounds. Returns a message or null.
*/
export function setObjectSound(track: TxxTrack, box: TraxxBox, continuous: boolean, name: string, wav: Uint8Array | null): string | null {
  let stem = stripExt(name.slice(0, 27)) || "NULL";
  if (stem.length > soundBudget()) stem = stem.slice(0, soundBudget());
  const dest = `${stem}.WAV`.toUpperCase();
  const set = (v: string) => { if (continuous) box.soundCont = v; else box.soundImpact = v; };
  set(dest);
  if (isStockSound(dest)) return null;
  const at = findAsset(track.sounds, dest);
  if (at >= 0) {
    if (((track.sounds[at]!.flags & SOUND_CONTINUOUS) !== 0) !== continuous) {
      set("NULL.WAV");
      return continuous
        ? "Continuous sound already loaded as impact sound.\nSounds can only be used as one or the other."
        : "Impact sound already loaded as continuous sound.\nSounds can only be used as one or the other.";
    }
    return null;
  }
  if (!wav) return null;
  if (track.sounds.length >= MAX_SOUNDS) return "Max. 512 Sounds! Sound dropped.";
  track.sounds.push({ name: `SOUND\\${dest}`, flags: continuous ? SOUND_CONTINUOUS : 0, data: wav });
  return null;
}

/**
  OnObjectProperties after OK, onto box `index`. `wavs` holds WAV files picked in the dialog.
  Returns the messages Traxx shows (sounds, caps), in order. The box array may be reordered
  (checkpoints), so the box is found again by identity.
*/
export function applyObjectFields(track: TxxTrack, index: number, f: ObjectFields, heights: Uint8Array, wavs: { cont: Uint8Array | null; impact: Uint8Array | null }, oldHag: number): string[] {
  const box = track.boxes[index]!;
  const messages: string[] = [];
  applyTypeIndex(box, f.typeIndex);
  box.light = { ...f.light };
  box.bvel[0] = f.vx;
  box.bvel[1] = f.vy;
  box.width = f.sizeW;
  box.length = f.sizeH;
  box.height = f.sizeD;
  if (f.fx >= 0) [box.ipos[0], box.fraction[0]] = traxxSignedSplit(f.fx);
  if (f.fy >= 0) [box.ipos[1], box.fraction[1]] = traxxSignedSplit(f.fy);
  box.mass = f.mass;
  [box.heightAboveGround, box.fraction[2]] = traxxSignedSplit(f.fz);
  if (box.heightAboveGround >= HAG_MAX) { box.heightAboveGround = HAG_MAX; box.fraction[2] = 0; }
  if (box.heightAboveGround !== oldHag) box.ipos[2] = interpolateRawAtPoint(heights, box.ipos[0], box.ipos[1]) + box.heightAboveGround;
  box.psi = radians(f.angle);
  box.phi = radians(f.elev);
  box.theta = radians(f.tilt);
  box.priority = f.level;
  box.crush = [...f.crush];
  for (const [continuous, name, wav] of [[true, f.soundCont, wavs.cont], [false, f.soundImpact, wavs.impact]] as const) {
    const m = setObjectSound(track, box, continuous, name, wav);
    if (m) messages.push(m);
  }

  // The checkpoint sequence: this one takes its number, the rest at or above it move up, and
  // all of them are put back in order across the checkpoint slots, numbered from 0.
  if (box.type === CHECKPOINT) {
    box.checkpointSeq = f.checkpoint;
    const list: TraxxBox[] = [box];
    track.boxes.forEach((b, i) => {
      if (i === index || b.type !== CHECKPOINT) return;
      if (b.checkpointSeq >= box.checkpointSeq) b.checkpointSeq++;
      list.push(b);
    });
    if (list.length > MAX_CHECKPOINTS) {
      box.type = 0;
      messages.push("Max. 20 Checkpoints!");
    }
    const kept = list.slice(0, MAX_CHECKPOINTS);
    if (kept.length > 1) {
      const sorted = [...kept].sort((a, b) => a.checkpointSeq - b.checkpointSeq);
      let seq = 0;
      for (let b = 0; b < track.boxes.length && seq < sorted.length; b++) {
        if (track.boxes[b]!.type !== CHECKPOINT) continue;
        track.boxes[b] = sorted[seq]!;
        sorted[seq]!.checkpointSeq = seq;
        seq++;
      }
    }
  }

  const count = (test: (b: TraxxBox) => boolean) => track.boxes.filter(test).length;
  if (box.type === TRAXX_BOX_RAMP && count((b) => b.type === TRAXX_BOX_RAMP) > MAX_RAMPS) { messages.push("Max. 100 Ramps!"); box.type = 0; }
  if (box.type === TRAXX_BOX_CRUSH && count((b) => b.type === TRAXX_BOX_CRUSH) > MAX_TOP_CRUSH) { messages.push(`Max. ${MAX_TOP_CRUSH} Top-Crush!`); box.type = 0; }
  const moves = (b: TraxxBox) => b.type === 10 || b.type === 13;
  if (moves(box) && count(moves) > MAX_MOVERS) { messages.push("Max. 100 Moving objects (Train and Moving combined)!"); box.type = 0; }
  if (box.type === TRAXX_BOX_LIGHT && count((b) => b.type === TRAXX_BOX_LIGHT) > MAX_LIGHTS) { messages.push("Max. 100 Lights!"); box.type = 0; }
  return messages;
}
