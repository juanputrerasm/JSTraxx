/*
  What the Course Tools bar follows about the open track (Traxx 1.8.2, CTraxxFrame::RefreshCourseBar):
  whether it is a lane track (a drag, or Parallel rules: the radios read "Lane 1", "Lane 2" and the
  tickbox "Always show lanes") and the lead-in of the selected course 2..4. Course mode publishes it
  after every command update and course change; the bar's "Lead-in, then:" pick goes back to Course
  mode (OnLeadIn), which owns the document.
*/
import type { AppState } from "./state.ts";

export interface CourseBarState {
  /** A track is open. */
  open: boolean;
  /** CourseLaneTrack. */
  lanes: boolean;
  /** The selected course's lead-in (GetLeadIn: -1 none, 0 Lane 1, 1 Lane 2); -1 for courses 0 and 1. */
  leadIn: number;
}

interface Channel {
  state: CourseBarState;
  known: boolean;
  listeners: Set<(s: CourseBarState) => void>;
  pick: ((course: number, cur: number) => void) | null;
}

const channels = new WeakMap<AppState, Channel>();

function channel(app: AppState): Channel {
  let c = channels.get(app);
  if (!c) { c = { state: { open: false, lanes: false, leadIn: -1 }, known: false, listeners: new Set(), pick: null }; channels.set(app, c); }
  return c;
}

/** Publish; every listener hears it, changed or not (a refused pick snaps the combo back). */
export function publishCourseBar(app: AppState, state: CourseBarState): void {
  const c = channel(app);
  c.known = true;
  c.state = state;
  for (const l of c.listeners) l(state);
}

/** Listen; a listener added after the first publish hears the current state at once. */
export function onCourseBar(app: AppState, listener: (s: CourseBarState) => void): void {
  const c = channel(app);
  c.listeners.add(listener);
  if (c.known) listener(c.state);
}

/** OnLeadIn's owner: Course mode. */
export function setLeadInHandler(app: AppState, pick: (course: number, cur: number) => void): void {
  channel(app).pick = pick;
}

/** The bar's combo: course `course` (2..4) and the combo index `cur` (0 None, 1 Lane 1, 2 Lane 2). */
export function pickLeadInFromBar(app: AppState, course: number, cur: number): void {
  channel(app).pick?.(course, cur);
}
