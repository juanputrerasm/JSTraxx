/*
  Course and truck editing (Traxx/TraxxViewEdit.cpp, Course editing). Courses are 0 (main) and
  1..4 (extended); an anchor is 2 x segment for its start, 2 x segment + 1 for its end
  (courseindex). Positions are ipos, heights whole steps.
*/
import type { TxxCourseSegment, TxxTrack } from "../traxx/txx.ts";

export function courseOf(track: TxxTrack, which: number): TxxCourseSegment[] | null {
  return which === 0 ? track.course : track.extendedCourses[which - 1];
}

/** CTrackPODCourse::AddSegment's blank segment. */
export function blankSegment(): TxxCourseSegment {
  return { cstart: [0, 0, 0], cend: [0, 0, 0], speedLimit: 0, trackWidth: 16, spare: [0, 0] };
}

/*
  OnCourseInsertSegment. On an empty course the first segment starts at `at` (the ground under
  the right-click) and runs 40 east; on the main course every truck then lines up behind it
  (truck t at end - 80 + 20t, 40 south). Otherwise a 40-long segment goes in 20 beyond the
  selected anchor: after the segment from its end, before it from its start. Returns false
  when there is nowhere to put it.
*/
export function insertSegment(track: TxxTrack, which: number, anchor: number, at: [number, number, number] | null): boolean {
  let course = courseOf(track, which);
  if (!course) {
    if (which === 0) return false;
    course = track.extendedCourses[which - 1] = [];
  }
  const seg = blankSegment();
  if (course.length < 1) {
    if (!at) return false;
    seg.cstart = [at[0], at[1], at[2]];
    seg.cend = [at[0] + 40, at[1], at[2]];
    course.push(seg);
    if (which === 0) {
      track.trucks.forEach((t, i) => { t.ipos = [seg.cend[0] - 80 + 20 * i, seg.cend[1] - 40, seg.cend[2]]; });
    }
    return true;
  }
  const ref = course[anchor >> 1];
  if (!ref) return false;
  if (anchor & 1) {
    seg.cstart = [ref.cend[0] + 20, ref.cend[1], ref.cend[2]];
    seg.cend = [seg.cstart[0] + 40, seg.cstart[1], seg.cstart[2]];
    course.splice((anchor >> 1) + 1, 0, seg);
  } else {
    seg.cend = [ref.cstart[0] - 20, ref.cstart[1], ref.cstart[2]];
    seg.cstart = [seg.cend[0] - 40, seg.cend[1], seg.cend[2]];
    course.splice(anchor >> 1, 0, seg);
  }
  return true;
}

export function deleteSegment(track: TxxTrack, which: number, anchor: number): void {
  courseOf(track, which)?.splice(anchor >> 1, 1);
}

export function deleteAllSegments(track: TxxTrack, which: number): void {
  const c = courseOf(track, which);
  if (c) c.length = 0;
}

/** OnCourseReverse: the selected segment's two ends swapped. */
export function reverseSegment(track: TxxTrack, which: number, anchor: number): void {
  const seg = courseOf(track, which)?.[anchor >> 1];
  if (!seg) return;
  [seg.cstart, seg.cend] = [seg.cend, seg.cstart];
}

/*
  OnCourseSpeedLimit: the dialog shows half the stored value and stores twice what is typed;
  "Apply to All" sets the segment with the same index on every course.
*/
export function setSpeedLimit(track: TxxTrack, which: number, anchor: number, speed: number, allCourses: boolean): void {
  const s = anchor >> 1;
  if (allCourses) {
    for (const c of [track.course, ...track.extendedCourses]) if (c?.[s]) c[s].speedLimit = 2 * speed;
  } else {
    const seg = courseOf(track, which)?.[s];
    if (seg) seg.speedLimit = 2 * speed;
  }
}

/** OnCourseGenerate: extended course `which` becomes the main one, each end nudged by -7..+8 in x and y. */
export function generateFromMain(track: TxxTrack, which: number, random: () => number = Math.random): boolean {
  if (which === 0 || track.course.length < 1) return false;
  const jitter = () => (Math.trunc(random() * 16) & 15) - 7;
  track.extendedCourses[which - 1] = track.course.map((seg) => {
    const s = structuredClone(seg);
    s.cstart[0] += jitter(); s.cstart[1] += jitter();
    s.cend[0] += jitter(); s.cend[1] += jitter();
    return s;
  });
  return true;
}

/** Dragging an anchor (OnMouseMove, course mode): it lands on the ground point. */
export function moveAnchor(track: TxxTrack, which: number, anchor: number, at: [number, number, number]): void {
  const seg = courseOf(track, which)?.[anchor >> 1];
  if (!seg) return;
  if (anchor & 1) seg.cend = [at[0], at[1], at[2]];
  else seg.cstart = [at[0], at[1], at[2]];
}

/** Dragging a truck: it lands 4 steps above the ground point. */
export function moveTruck(track: TxxTrack, truck: number, at: [number, number, number]): void {
  const t = track.trucks[truck];
  if (t) t.ipos = [at[0], at[1], at[2] + 4];
}

/** OnTruckReverse. */
export function reverseTruck(track: TxxTrack, truck: number): void {
  const t = track.trucks[truck];
  if (t) t.psi = Math.fround(t.psi + Math.fround(Math.PI));
}
