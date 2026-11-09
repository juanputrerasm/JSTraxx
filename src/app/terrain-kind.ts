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
