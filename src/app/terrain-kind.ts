/*
  What the terrain edit bar follows about the open track (Traxx 1.7, CTraxxFrame's idle
  OnUpdateEditSizeRange and FollowAmplitudeKind): its terrain mode, or null with no track. The
  track's mode changes by loading, Special > Terrain Grid and Import Heightmap, so rather than
  catch each, Terrain mode publishes it after every command update and the bar reacts when it
  differs.
*/
import type { AppState } from "./state.ts";

interface Channel { mode: number | null; known: boolean; listeners: Set<(mode: number | null) => void> }

const channels = new WeakMap<AppState, Channel>();

function channel(app: AppState): Channel {
  let c = channels.get(app);
  if (!c) { c = { mode: null, known: false, listeners: new Set() }; channels.set(app, c); }
  return c;
}

/** The open track's terrain mode, or null. */
export function trackTerrainMode(app: AppState): number | null {
  return channel(app).mode;
}

/** Publish the open track's terrain mode; listeners hear only a change (and the first value). */
export function publishTerrainMode(app: AppState, mode: number | null): void {
  const c = channel(app);
  if (c.known && c.mode === mode) return;
  c.known = true;
  c.mode = mode;
  for (const l of c.listeners) l(mode);
}

/** Listen; a listener added after the first publish hears the current mode at once. */
export function onTerrainMode(app: AppState, listener: (mode: number | null) => void): void {
  const c = channel(app);
  c.listeners.add(listener);
  if (c.known) listener(c.mode);
}

/*
  Traxx origin/main CTraxxFrame::FollowTrackKinds: the Altitude box, the Groundbox bar and the Transitions
  window also follow the track's kind. Published the same way: the height limit (v) of a track whose
  heights are in feet (a v6 track, HeightsInFeet), 0 for a classic track or none.
*/
const feetChannels = new WeakMap<AppState, { limit: number; known: boolean; listeners: Set<(limit: number) => void> }>();

function feetChannel(app: AppState) {
  let c = feetChannels.get(app);
  if (!c) { c = { limit: 0, known: false, listeners: new Set() }; feetChannels.set(app, c); }
  return c;
}

/** The open track's feet limit: its height limit when its heights are in feet, else 0. */
export function trackFeetLimit(app: AppState): number {
  return feetChannel(app).limit;
}

export function publishFeetLimit(app: AppState, limit: number): void {
  const c = feetChannel(app);
  if (c.known && c.limit === limit) return;
  c.known = true;
  c.limit = limit;
  for (const l of c.listeners) l(limit);
}

/** Listen; a listener added after the first publish hears the current limit at once. */
export function onFeetLimit(app: AppState, listener: (limit: number) => void): void {
  const c = feetChannel(app);
  c.listeners.add(listener);
  if (c.known) listener(c.limit);
}
