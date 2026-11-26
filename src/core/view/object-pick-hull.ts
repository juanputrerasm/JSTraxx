/*
  Object edit mode's "outline pick" (Traxx 1.8.2, 2031ec1: Traxx/ObjectPickHull.h, tested by
  tools/objectpicktest.cpp). An object is hit when the click falls inside the convex hull of its 8
  projected bounding-box corners. Of the objects hit, the front-most wins; a fog volume is
  see-through, so it wins only when no solid object is hit.

  Points are whole pixels (Traxx's POINT); the cross products are exact in a double up to 2^53,
  where Traxx uses 64-bit integers, so far-off-screen corners cannot overflow either.
*/

export interface PickPt { x: number; y: number }

export interface PickCandidate {
  /** The click is inside this object's hull. */
  hit: boolean;
  /** Camera depth of the nearest face under the click (pickFaceDepth). */
  depth: number;
  isFog: boolean;
}

/** PickCross: twice the signed area of o -> a -> b. */
export function pickCross(o: PickPt, a: PickPt, b: PickPt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
  PickHull: the convex hull of n <= 8 points (Andrew's monotone chain), counter-clockwise in a
  y-up sense. Duplicates and collinear points are dropped, so fewer than 3 back means the points
  have no area (an edge-on box) and nothing can be inside it.
*/
export function pickHull(pts: readonly PickPt[] | null, n = pts?.length ?? 0): PickPt[] {
  if (!pts || n <= 0) return [];
  if (n > 8) n = 8;
  // Sort by x then y (insertion: 8 points at most).
  const s: PickPt[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    let j = i;
    for (; j > 0 && (s[j - 1]!.x > p.x || (s[j - 1]!.x === p.x && s[j - 1]!.y > p.y)); j--) s[j] = s[j - 1]!;
    s[j] = p;
  }
  // Drop exact duplicates.
  let m = 1;
  for (let i = 1; i < n; i++) if (s[i]!.x !== s[m - 1]!.x || s[i]!.y !== s[m - 1]!.y) s[m++] = s[i]!;
  n = m;
  if (n < 3) return s.slice(0, n).map((p) => ({ ...p }));
  const h: PickPt[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k >= 2 && pickCross(h[k - 2]!, h[k - 1]!, s[i]!) <= 0) k--;
    h[k++] = s[i]!;
  }
  for (let i = n - 2, lo = k + 1; i >= 0; i--) {
    while (k >= lo && pickCross(h[k - 2]!, h[k - 1]!, s[i]!) <= 0) k--;
    h[k++] = s[i]!;
  }
  k--;   // the last point is the first again
  // All points collinear: the chain doubles back on itself, no area.
  if (k < 3) return [];
  return h.slice(0, k).map((p) => ({ ...p }));
}

/** PickPointInHull: (px, py) inside the hull, edges and corners included; fewer than 3 points is never a hit. */
export function pickPointInHull(hull: readonly PickPt[] | null, px: number, py: number): boolean {
  if (!hull || hull.length < 3) return false;
  const p = { x: px, y: py }, n = hull.length;
  for (let i = 0; i < n; i++) if (pickCross(hull[i]!, hull[(i + 1) % n]!, p) < 0) return false;
  return true;
}

/** PickChooseWinner: front-most hit wins, the lower index on a tie; a fog only if no solid is hit; -1 for none. */
export function pickChooseWinner(c: readonly PickCandidate[] | null, n = c?.length ?? 0): number {
  if (!c) return -1;
  let best = -1, bestFog = -1;
  for (let i = 0; i < n; i++) {
    if (!c[i]!.hit) continue;
    if (c[i]!.isFog) { if (bestFog < 0 || c[i]!.depth < c[bestFog]!.depth) bestFog = i; }
    else if (best < 0 || c[i]!.depth < c[best]!.depth) best = i;
  }
  return best >= 0 ? best : bestFog;
}

/** Corner order (OverlayBoxOutline, FogVolumeCorners, SelectObjectByOutline): bottom ring 0..3, top ring 4..7 above it. */
const FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];

/**
  PickFaceDepth: the camera depth of the nearest box face under the click. Each face is cut into
  two screen triangles; where one holds the click its depth is the perspective-correct
  1 / (b0/z0 + b1/z1 + b2/z2) with screen-space barycentrics b, and the smallest wins. If none
  holds it the smallest corner depth stands in. Depths must be positive. Rounded as (int)(z + 0.5).
*/
export function pickFaceDepth(p: readonly PickPt[], depth: readonly number[], px: number, py: number): number {
  const c = { x: px, y: py };
  let best = 0, found = false, mind = depth[0]!;
  for (let i = 1; i < 8; i++) if (depth[i]! < mind) mind = depth[i]!;
  for (const face of FACES) {
    for (let t = 0; t < 2; t++) {
      // Triangles (0,1,2) and (0,2,3) of the face.
      const a = face[0]!, b = face[t + 1]!, d = face[t + 2]!;
      let area = pickCross(p[a]!, p[b]!, p[d]!);
      if (area === 0) continue;
      let w0 = pickCross(c, p[b]!, p[d]!), w1 = pickCross(p[a]!, c, p[d]!), w2 = pickCross(p[a]!, p[b]!, c);
      if (area < 0) { area = -area; w0 = -w0; w1 = -w1; w2 = -w2; }
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const inv = (w0 / depth[a]! + w1 / depth[b]! + w2 / depth[d]!) / area;
      const z = 1 / inv;
      if (!found || z < best) { best = z; found = true; }
    }
  }
  return found ? Math.trunc(best + 0.5) : mind;
}

/**
  PickResolve: the final choice. A solid hit stands; a Fog is see-through, so an object whose base
  is near the click (baseHit, the traditional nearest-base rule, -1 for none) beats it; with no
  outline hit the base-point rule is the answer.
*/
export function pickResolve(winner: number, winnerIsFog: boolean, baseHit: number): number {
  if (winner < 0) return baseHit;
  if (!winnerIsFog) return winner;
  return baseHit >= 0 ? baseHit : winner;
}

/** SelectObjectByOutline: a corner at depth <= 10 (Traxx's units) or one that does not project leaves the box out. */
export const PICK_MIN_DEPTH = 10;

/**
  SelectObjectByOutline's 8 local corners from the bounds lo / hi, OverlayBoxOutline's order
  (pickFaceDepth relies on it): the bottom ring 0..3 going round, the top ring 4..7 above it.
*/
export function pickLocalCorners(lo: readonly number[], hi: readonly number[]): [number, number, number][] {
  return Array.from({ length: 8 }, (_, k) => {
    const c = k & 3;
    return [c === 0 || c === 1 ? lo[0]! : hi[0]!, c === 0 || c === 3 ? lo[1]! : hi[1]!, k < 4 ? lo[2]! : hi[2]!];
  });
}

/** A model's vertex bounds (x, y, z triples), or null with no vertices. */
export function pickModelBounds(vertices: ArrayLike<number>): { lo: [number, number, number]; hi: [number, number, number] } | null {
  if (vertices.length < 3) return null;
  const lo: [number, number, number] = [vertices[0]!, vertices[1]!, vertices[2]!], hi: [number, number, number] = [...lo];
  for (let v = 3; v + 2 < vertices.length; v += 3) {
    for (let a = 0; a < 3; a++) {
      const x = vertices[v + a]!;
      if (x < lo[a]!) lo[a] = x;
      if (x > hi[a]!) hi[a] = x;
    }
  }
  return { lo, hi };
}

/**
  One box's candidate from its 8 projected corners (whole pixels, depths in Traxx's units), or null
  when a corner failed to project or is at depth <= PICK_MIN_DEPTH (the camera is inside or
  against it: standing in a fog volume must not make every click pick the fog).
*/
export function pickCandidateOf(corners: readonly ({ x: number; y: number; depth: number } | null)[], px: number, py: number, isFog: boolean): PickCandidate | null {
  if (corners.length < 8 || corners.some((c) => !c || !(c.depth > PICK_MIN_DEPTH))) return null;
  const pts = corners.map((c) => ({ x: c!.x, y: c!.y }));
  const hit = pickPointInHull(pickHull(pts, 8), px, py);
  return { hit, depth: hit ? pickFaceDepth(pts, corners.map((c) => c!.depth), px, py) : 0, isFog };
}
