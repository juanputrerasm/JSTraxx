/*
  The checkpoint labels in Objects mode (TraxxViewDisplay.cpp OverlayCheckpoints, Traxx 1.8.2
  94ebfe5). The text is "CP nn", numbered in object order; the race-rules labels (CpxFormatLabel:
  slot, role, split, lane and the main route's "*") come with the race rules and go through
  checkpointLabelText's `rules` hook.

  A MODEL-LESS gate's label shrinks with distance: of the sizes 16, 14, 12, 11, 10, 9, 8, 7 capped
  at 12, the first whose text is no wider than 0.9 of the gate's on-screen width (the two ends of
  its width axis, local x, at the base: (+-width, 0, -height) through the object matrix, as
  OverlayBoxOutline builds the box) is used; none fits, no label. A model box, or a gate whose
  ends cannot be projected (depth <= 10 in Traxx), keeps the plain 12 px label. Fonts are Arial at
  the size in pixels, antialiased.
*/

/** The plain label size (DrawOverlayScreenText). */
export const CP_LABEL_PX = 12;
/** OverlayCheckpoints' sizes, largest first; only those <= CP_LABEL_PX are tried. */
export const CP_LABEL_SIZES: readonly number[] = [16, 14, 12, 11, 10, 9, 8, 7];

/** What a label may say beyond "CP nn" (the race-rules work fills it in). */
export interface CheckpointLabelRules {
  /** CpxFormatLabel's text for this checkpoint, or null to keep "CP nn". */
  label(n: number): string | null;
}

/** The label of checkpoint n (0-based, in object order): "CP nn", or the race rules' text. */
export function checkpointLabelText(n: number, rules: CheckpointLabelRules | null = null): string {
  return rules?.label(n) ?? `CP ${String(n).padStart(2, "0")}`;
}

/** A model-less gate's two label ends, local (x, y, z) before the object matrix: (+-width, 0, -height). */
export function checkpointLabelEnds(box: { width: number; height: number }): [[number, number, number], [number, number, number]] {
  return [[-box.width, 0, -box.height], [box.width, 0, -box.height]];
}

/**
  The size to draw a label at, in pixels, or null for none. ends: the gate's two ends on screen
  (null for a model box, or ends that could not be projected: the plain 12 px). width(px): the
  text's width at that size.
*/
export function checkpointLabelPx(ends: readonly [{ x: number; y: number }, { x: number; y: number }] | null, width: (px: number) => number): number | null {
  if (!ends) return CP_LABEL_PX;
  const dx = ends[1].x - ends[0].x, dy = ends[1].y - ends[0].y;
  const limit = Math.trunc(0.9 * Math.sqrt(dx * dx + dy * dy));
  for (const px of CP_LABEL_SIZES) if (px <= CP_LABEL_PX && width(px) <= limit) return px;
  return null;
}
