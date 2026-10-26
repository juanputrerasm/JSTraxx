/*
  Group Properties (Traxx/GroupPropertiesDlg.cpp and CTraxxView::OnObjectGroupProperties): one
  value onto every selected object. Each field opens with the text the objects share, or blank
  where they differ; only a field changed to something that reads as a number is applied.

    groupStart   the fields the selection shares (GroupFieldTexts, compared as shown)
    applyLook    height, the three angles and (plain boxes only) size, for the preview and OK
    applyGroup   OK: type first (Set Type's caps), then mass and the look; level and sounds
                 skip a Ramp or a Top-Crush
*/
import type { TxxTrack } from "../traxx/txx.ts";
import { traxxSignedSplit, TRAXX_BOX_CRUSH, TRAXX_BOX_RAMP, type TraxxBox } from "../traxx/sit.ts";
import { interpolateRawAtPoint } from "../traxx/terrain.ts";
import { cFixed } from "../traxx/cformat.ts";
import { setTypeOfObjects, typeToIndex } from "./objects.ts";
import { setObjectSound } from "./object-properties.ts";

export const GP_MASS = 0, GP_HEIGHT = 1, GP_ANGLE = 2, GP_PITCH = 3, GP_TILT = 4, GP_SIZEW = 5, GP_SIZEL = 6, GP_SIZEH = 7;
export const GP_NAMES = ["Mass", "Above ground", "Orientation", "Pitch", "Tilt", "Width", "Length", "Height"];
const GP_INT = [true, false, false, false, false, true, true, true];

export interface GroupFields {
  /** Combo index the set shares, or -1. */
  typeIndex: number;
  level: number;
  soundCont: string;
  soundImpact: string;
  text: string[];
  anyPlain: boolean;
}

const stem = (n: string) => { const d = n.lastIndexOf("."); return d >= 0 ? n.slice(0, d) : n; };

/** GroupFieldTexts: every object written the same way, so equal text means shared. */
export function groupFieldTexts(box: TraxxBox): string[] {
  const deg = [box.psi, box.phi, box.theta].map((r) => {
    let d = (180 * r) / Math.PI;
    while (d < 0) d += 360;
    while (d >= 360) d -= 360;
    return d;
  });
  return [
    String(Math.trunc(box.mass)),
    cFixed(Math.fround(box.heightAboveGround + box.fraction[2] / 256), 3),
    cFixed(deg[0]!, 2), cFixed(deg[1]!, 2), cFixed(deg[2]!, 2),
    String(box.width), String(box.length), String(box.height),
  ];
}

export function groupStart(boxes: readonly TraxxBox[]): GroupFields {
  const out: GroupFields = { typeIndex: -1, level: -1, soundCont: "", soundImpact: "", text: Array(8).fill(""), anyPlain: false };
  let firstPlain = true;
  boxes.forEach((box, i) => {
    const v = groupFieldTexts(box);
    const type = typeToIndex(box.type), cont = stem(box.soundCont), impact = stem(box.soundImpact);
    if (i === 0) {
      Object.assign(out, { typeIndex: type, level: box.priority, soundCont: cont, soundImpact: impact });
      for (let f = GP_MASS; f <= GP_TILT; f++) out.text[f] = v[f]!;
    } else {
      if (type !== out.typeIndex) out.typeIndex = -1;
      if (box.priority !== out.level) out.level = -1;
      if (cont !== out.soundCont) out.soundCont = "";
      if (impact !== out.soundImpact) out.soundImpact = "";
      for (let f = GP_MASS; f <= GP_TILT; f++) if (v[f] !== out.text[f]) out.text[f] = "";
    }
    if (!box.modelName) {
      out.anyPlain = true;
      for (let f = GP_SIZEW; f <= GP_SIZEH; f++) {
        if (firstPlain) out.text[f] = v[f]!;
        else if (v[f] !== out.text[f]) out.text[f] = "";
      }
      firstPlain = false;
    }
  });
  if (out.level < 0 || out.level > 2) out.level = -1;
  return out;
}

/** GPParses: the whole text reads as a number of the field's kind. */
export function parses(field: number, text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return GP_INT[field] ? /^[\t ]*[+-]?\d+$/.test(t) : /^[\t ]*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t);
}

/** Changed and readable (Usable). */
export function usable(field: number, text: string, orig: string): boolean {
  const t = text.trim();
  return t !== "" && t !== orig && parses(field, t);
}

/** ApplyGroupLook. */
export function applyLook(box: TraxxBox, text: readonly string[], orig: readonly string[], heights: Uint8Array): void {
  const ok = (f: number) => usable(f, text[f]!, orig[f]!);
  if (ok(GP_HEIGHT)) {
    [box.heightAboveGround, box.fraction[2]] = traxxSignedSplit(Math.fround(Number(text[GP_HEIGHT])));
    if (box.heightAboveGround >= 500) { box.heightAboveGround = 500; box.fraction[2] = 0; }
    box.ipos[2] = interpolateRawAtPoint(heights, box.ipos[0], box.ipos[1]) + box.heightAboveGround;
  }
  if (ok(GP_ANGLE)) box.psi = Math.fround((Math.PI * Number(text[GP_ANGLE])) / 180);
  if (ok(GP_PITCH)) box.phi = Math.fround((Math.PI * Number(text[GP_PITCH])) / 180);
  if (ok(GP_TILT)) box.theta = Math.fround((Math.PI * Number(text[GP_TILT])) / 180);
  if (!box.modelName) {
    if (ok(GP_SIZEW)) box.width = Math.trunc(Number(text[GP_SIZEW]));
    if (ok(GP_SIZEL)) box.length = Math.trunc(Number(text[GP_SIZEL]));
    if (ok(GP_SIZEH)) box.height = Math.trunc(Number(text[GP_SIZEH]));
  }
}

export interface GroupResult {
  start: GroupFields;
  typeIndex: number;
  level: number;
  soundCont: string;
  soundImpact: string;
  text: string[];
  wavs: { cont: Uint8Array | null; impact: Uint8Array | null };
}

/**
  OK: the selection by index; returns the new selection (Set Type may move checkpoints) and the
  messages to show.
*/
export function applyGroup(track: TxxTrack, selection: readonly number[], r: GroupResult): { selection: number[]; refused: number; group: number; messages: string[] } {
  const boxes = selection.map((i) => track.boxes[i]!);
  let refused = 0, group = 0;
  if (r.typeIndex >= 0 && r.typeIndex !== r.start.typeIndex) ({ refused, group } = setTypeOfObjects(track, selection, r.typeIndex));
  const messages: string[] = [];
  let soundRefused = false;
  for (const box of boxes) {
    if (usable(GP_MASS, r.text[GP_MASS]!, r.start.text[GP_MASS]!)) box.mass = Math.trunc(Number(r.text[GP_MASS]));
    applyLook(box, r.text, r.start.text, track.heights);
    if (box.type === TRAXX_BOX_RAMP || box.type === TRAXX_BOX_CRUSH) continue;
    if (r.level >= 0 && r.level !== r.start.level) box.priority = r.level;
    for (const [continuous, name, start, wav] of [[true, r.soundCont, r.start.soundCont, r.wavs.cont], [false, r.soundImpact, r.start.soundImpact, r.wavs.impact]] as const) {
      if (!name || name === start) continue;
      const m = setObjectSound(track, box, continuous, name, wav);
      if (m && !soundRefused) messages.push(m);
      if (m) soundRefused = true;
    }
  }
  return { selection: boxes.map((b) => track.boxes.indexOf(b)).filter((i) => i >= 0), refused, group, messages };
}
