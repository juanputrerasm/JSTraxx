/*
  The race-rules data a track carries (Traxx 1.8.2: new-style drags, Parallel, split checkpoints on
  circuits and rallies, walls, lead-ins). Plain data only, shared by the .TXX codec (txx.ts), the
  race-rules core (race-rules.ts), the walls core (walls.ts), the pod writer and reader and the editor.

  Units as Traxx stores them (Include/TrackPODRaceRules.h, Include/TrackPODWalls.h, Include/TrackPOD.h):
  wall coordinates, bends, heights above ground, thickness and height are integers in 1/256 ft; the
  world is cells * 32 ft wide.
*/

/** RACERULES_NONE / DRAG / PARALLEL / RACE (mode 3: split checkpoints on a Circuit or Rally). */
export const RACERULES_NONE = 0;
export const RACERULES_DRAG = 1;
export const RACERULES_PARALLEL = 2;
export const RACERULES_RACE = 3;
export type RaceRulesMode = 0 | 1 | 2 | 3;

/** CPX_SPLIT_NONE / ANY (any copy) / LANE (per lane). */
export const CPX_SPLIT_NONE = 0;
export const CPX_SPLIT_ANY = 1;
export const CPX_SPLIT_LANE = 2;

/** CPX_ROLE_*: the role of a checkpoint slot. */
export const CPX_ROLE_PRESTAGE = 1;
export const CPX_ROLE_STAGE = 2;
export const CPX_ROLE_LAUNCH = 3;
export const CPX_ROLE_FINISH = 4;
export const CPX_ROLE_GATE = 5;

/** Wall side: commentary and line colour only. */
export const WALL_SIDE_NONE = 0;
export const WALL_SIDE_INSIDE = 1;
export const WALL_SIDE_OUTSIDE = 2;

/** One authored wall point (WallPoint). */
export interface WallPoint {
  /** 1/256 ft, 0..cells * 32 * 256. */
  x: number;
  z: number;
  /** Sideways offset of the stretch after this point at mid-stretch, 1/256 ft (signed). */
  bend: number;
  /** Height above the ground under the point, 1/256 ft (signed). */
  above: number;
  /** 1: the stretch after this point is left open. */
  gap: 0 | 1;
}

/** One wall (Wall). */
export interface Wall {
  /** At most 31 characters. */
  name: string;
  side: number;
  closed: 0 | 1;
  noline: 0 | 1;
  /** 1/256 ft, > 0. */
  thickness: number;
  height: number;
  points: WallPoint[];
}

/** The race rules of a track, as the .TXX V21 / V22 / V23 blocks hold them. */
export interface RaceRules {
  mode: RaceRulesMode;
  /** Drag: 0 looped (laps from the game menu), 1 one run. Parallel and race: 0. Traxx keeps 1 with the rules off. */
  laps: number;
  walls: Wall[];
  /** leadin_then[0..4]: for course 2..4, the lane course (0 or 1) it hands over to, else -1. [0] and [1] stay -1. */
  leadinThen: [number, number, number, number, number];
}

export function raceRulesDefaults(): RaceRules {
  return { mode: RACERULES_NONE, laps: 1, walls: [], leadinThen: [-1, -1, -1, -1, -1] };
}
