/** Horizontal units per terrain cell. */
export declare const TV_UNITS_PER_CELL: number;
/** Vertical units per heightfield altitude step. */
export declare const TV_UNITS_PER_HEIGHT_STEP: number;
/**
 * Converts a raw TV-family (x, y, z) triple to the viewer's editor-space [x, y, altitude].
 *
 * Coordinates are frequently negative in shipped content, so the horizontal wrap is required
 * rather than defensive.
 *
 * Positions are kept exact, NOT snapped to a cell. 99.7% of the 16,323 placements in TV.pod,
 * FURY3.POD and FURYSE.POD sit inside a cell rather than on a cell centre (only 0.3% do), and
 * a heightfield sample (cx, cz) is a grid VERTEX at cx * 2^20: for ground-logic objects the
 * stored Y equals the terrain interpolated between the four vertices around the exact
 * position (99.9% of FURYSE, 92.6% of FURY3, 89% of TV within half a step), while reading the
 * cell centre fits worst of every convention tried (48-74%). TVCAD's own "snap to grid"
 * (X = GridX * 2^20) is an editor convenience that also lands on a vertex, not the centre.
 */
export declare function tvPlacementToEditor(x: number, y: number, z: number, gridSize: number): [number, number, number];
/** Converts a raw TV-family Y to a (fractional) heightfield altitude step. */
export declare function tvHeightToAltitude(y: number): number;
/** Splits a comma-separated integer triple, or null when the line is not one. */
export declare function parseIntTriple(line: string | null | undefined): [number, number, number] | null;
export declare function toDataLines(bytes: Uint8Array): string[];
/** Converts a raw Hellbender (x, y, z) triple to editor-space [x, y, altitude]. */
export declare function hbPlacementToEditor(x: number, y: number, z: number, gridSize: number): [number, number, number];
/**
 * Converts a side-file placement for whichever game wrote it.
 *
 * The two TV-family scales are picked by origin rather than sniffed from the values: the
 * ranges overlap, so a heuristic would silently put a Hellbender level's markers in one
 * corner of the map instead of failing.
 */
export declare function placementToEditor(x: number, y: number, z: number, gridSize: number, origin: string): [number, number, number];
