/*
  Ground-box editing (Traxx/TraxxViewEdit.cpp, OnBuilding*). One box per cell; faces 0..3 the
  sides (south, north, east, west), 4 the top, 5 the bottom, each a CLR-style word.
*/
import type { TxxGroundBox } from "../traxx/txx.ts";

export const MAX_GROUND_BOXES = 2048;

export function boxAt(boxes: readonly TxxGroundBox[], x: number, y: number): number {
  return boxes.findIndex((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
}

/*
  OnBuildingInsert: a box on an empty cell, from Bottom to Top, every face the texture picked
  in the Textures window (or texture 0). Returns its index, or null when the cell has one or
  the track is full.
*/
export function insertGroundBox(boxes: TxxGroundBox[], x: number, y: number, lower: number, upper: number, texture: number): number | null {
  if (boxAt(boxes, x, y) >= 0 || boxes.length >= MAX_GROUND_BOXES) return null;
  const face = texture >= 0 ? texture : 0;
  boxes.push({ x, y, w: 1, h: 1, lower, upper, faces: [face, face, face, face, face, face] });
  return boxes.length - 1;
}

/*
  ApplyBuildingTexture: Paint Face (1) the face, Sides (2) the four sides, Top/Bottom (3), All
  (4); each keeps its turn and mirror.
*/
export function paintGroundBox(box: TxxGroundBox, face: number, mode: number, texture: number): void {
  const faces = mode === 1 ? [face] : mode === 2 ? [0, 1, 2, 3] : mode === 3 ? [4, 5] : mode === 4 ? [0, 1, 2, 3, 4, 5] : [];
  for (const f of faces) box.faces[f] = (box.faces[f] & 0xf000) | (texture & 0x0fff);
}

/** OnBuildingMirror and OnBuildingRot90 on one face. */
export function mirrorFace(box: TxxGroundBox, face: number): void {
  box.faces[face] ^= 0x1000;
}

export function rotateFace(box: TxxGroundBox, face: number): void {
  box.faces[face] = (box.faces[face] & 0x3fff) | ((((box.faces[face] >> 14) + 1) & 3) << 14);
}

/* What Copy Box keeps: the size, heights and faces. */
export interface GroundBoxClip { w: number; h: number; lower: number; upper: number; faces: number[] }

export function copyGroundBox(box: TxxGroundBox): GroundBoxClip {
  return { w: box.w, h: box.h, lower: box.lower, upper: box.upper, faces: [...box.faces] };
}

/** OnBuildingPaste: the copy on an empty cell. */
export function pasteGroundBox(boxes: TxxGroundBox[], clip: GroundBoxClip, x: number, y: number): number | null {
  if (boxAt(boxes, x, y) >= 0 || boxes.length >= MAX_GROUND_BOXES) return null;
  boxes.push({ x, y, w: 1, h: 1, lower: clip.lower, upper: clip.upper, faces: [...clip.faces] });
  return boxes.length - 1;
}

/*
  The Top and Bottom spins (CTraxxFrame::OnBuildingTop, OnBuildingBottom): Top stays above
  Bottom, at most 255; Bottom below Top, at least 0.
*/
export function clampTop(top: number, bottom: number): number {
  return top <= bottom ? bottom + 1 : Math.min(255, top);
}

export function clampBottom(bottom: number, top: number): number {
  return bottom < 0 ? 0 : bottom >= top ? top - 1 : bottom;
}
