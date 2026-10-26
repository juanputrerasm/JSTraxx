/*
  Picking things by where they land on the screen (SelectCourseAnchor, SelectTruck,
  SelectNearestObject): the nearest projected point by Manhattan distance, only points in
  front of the camera and inside the view, and only within a limit.

  Traxx's limits are pixels of its 640 x 480 view (20 for course anchors, 64 for trucks, 128
  for objects); `scale` stretches them to the view's real size (its height / 480).
*/
export const COURSE_ANCHOR_LIMIT = 20;
export const TRUCK_LIMIT = 64;
export const OBJECT_LIMIT = 128;

export interface ScreenPoint { x: number; y: number }

export function nearestOnScreen(
  points: readonly (ScreenPoint | null)[], at: ScreenPoint, limit: number, view: { width: number; height: number },
): number {
  const scale = view.height / 480;
  let best = Infinity, index = -1;
  points.forEach((p, i) => {
    if (!p || p.x < 0 || p.y < 0 || p.x >= view.width || p.y >= view.height) return;
    const d = Math.abs(at.x - p.x) + Math.abs(at.y - p.y);
    if (d < best) { best = d; index = i; }
  });
  return best < limit * scale ? index : -1;
}

/** Every point inside a screen rectangle (Ctrl+drag), by index. */
export function insideRect(points: readonly (ScreenPoint | null)[], a: ScreenPoint, b: ScreenPoint, view: { width: number; height: number }): number[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const out: number[] = [];
  points.forEach((p, i) => {
    if (!p || p.x < 0 || p.y < 0 || p.x >= view.width || p.y >= view.height) return;
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) out.push(i);
  });
  return out;
}
