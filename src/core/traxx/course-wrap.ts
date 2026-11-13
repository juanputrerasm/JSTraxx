/*
  The world is a torus, and course coordinates wrap with it (Traxx 1.7.1, TraxxView.h, e3665e5):
  64 units per 32 ft cell, 256 cells, so 16384 units on both x and y in every terrain mode. The
  game's TAB map joins course points the shortest way round (the engine's mapWrapDelta), so the
  cyan join lines do too.
*/

/** TRAXX_COURSE_WRAP. */
export const TRAXX_COURSE_WRAP = 16384;

/** CourseWrapDelta: d folded mod 16384 into [-8192, 8192) (C's % truncates, as JavaScript's does). */
export function courseWrapDelta(d: number): number {
  d %= TRAXX_COURSE_WRAP;
  if (d >= TRAXX_COURSE_WRAP >> 1) d -= TRAXX_COURSE_WRAP;
  else if (d < -(TRAXX_COURSE_WRAP >> 1)) d += TRAXX_COURSE_WRAP;
  return d;
}

/**
  CourseJoinPieces: the straight join from A (a segment's cend) to B (the next segment's cstart),
  the way the game's map draws it, as [x0, y0, x1, y1] pieces. Piece 0 runs A -> B' (B moved to
  A's nearest torus copy); if B' != B it crossed the seam, and piece 1 is the same leg anchored
  at B (A' -> B) so the end entering from the other edge shows.
*/
export function courseJoinPieces(ax: number, ay: number, bx: number, by: number): [number, number, number, number][] {
  const dx = courseWrapDelta(bx - ax);
  const dy = courseWrapDelta(by - ay);
  const pieces: [number, number, number, number][] = [[ax, ay, ax + dx, ay + dy]];
  if (ax + dx === bx && ay + dy === by) return pieces;
  pieces.push([bx - dx, by - dy, bx, by]);
  return pieces;
}
