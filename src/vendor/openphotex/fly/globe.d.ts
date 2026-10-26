export declare const FLY_TILE_DEGREES = 1.40625;
export declare const FLY_TILE_COLUMNS = 256;
export declare const FLY_EQUATOR_ROW = 128;
/** Cells along each side of a globe tile. */
export declare const FLY_TILE_CELLS = 64;
/** Cells along each side of a quadrant (G00, G01, G10, G11). */
export declare const FLY_QUADRANT_CELLS = 32;
/** A latitude/longitude box in signed decimal degrees (south and west negative). */
export interface FlyBounds {
    south: number;
    west: number;
    north: number;
    east: number;
}
/** The latitude where globe tile row `row` starts (its southern edge), in degrees. */
export declare function flyRowLatitude(row: number): number;
/** The longitude where globe tile column `column` starts (its western edge), in -180..180. */
export declare function flyColumnLongitude(column: number): number;
/** The box a globe tile covers. */
export declare function flyTileBounds(column: number, row: number): FlyBounds;
/**
 * The globe tile a point lies in, and where in it as fractional cells from the tile's
 * south-west corner (0 to 64 on each axis).
 */
export declare function flyTileAt(latitude: number, longitude: number): {
    column: number;
    row: number;
    x: number;
    y: number;
};
/** The column and row a `Dxxxyyy` folder name encodes, or null. */
export declare function parseFlyFolderName(name: string): {
    first: number;
    second: number;
} | null;
/** The `Dxxxyyy` folder name for two numbers. */
export declare function flyFolderName(first: number, second: number): string;
export interface FlyTextureName {
    /** The first number of the folder name: the tile column, or a detail folder's cell x. */
    folderFirst: number;
    /** The second number: the tile row, or a detail folder's cell y. */
    folderSecond: number;
    /** Column, counted from the west. */
    x: number;
    /** Row, counted from the south. */
    y: number;
}
export declare function parseFlyTextureName(name: string): FlyTextureName | null;
