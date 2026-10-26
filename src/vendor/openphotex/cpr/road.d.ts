import { type CprTrackSurface } from "./track.ts";
export declare const CPR_WALL_PART_HEIGHT_FT = 4;
type Point = [number, number, number];
export interface CprRoadQuad {
    /** The record that owns the stretch, and the cross section slot. */
    segment: number;
    slot: number;
    /** Corners in order: this record's point `slot`, the next record's, the next record's `slot + 1`, this record's. */
    corners: [Point, Point, Point, Point];
    /** Index into the `.TTX`. */
    texture: number;
    /** Texture coordinates per corner, `[u, v]`, v down the texture as stored. */
    uvs: [number, number][];
}
export interface CprRoadWallPanel {
    /** Feet above the wall's foot. */
    baseFt: number;
    topFt: number;
    /** The catch fence (its texture is not in the `.TTX`), or a strip of a `.TTX` texture. */
    fence: boolean;
    texture: number;
    /** The strip's V range in its texture, top then bottom (four 256 x 64 strips stacked). */
    vTop: number;
    vBottom: number;
}
export interface CprRoadWall {
    segment: number;
    point: number;
    wallType: number;
    /** Whether a car meets it: every wall but a tree (CART.EXE makeWallList 0x44be30). */
    solid: boolean;
    /** The wall's foot: at this record's point and at the next record's. */
    from: Point;
    to: Point;
    heightFt: number;
    /** How often a texture repeats along the wall: once a stretch, as the game draws it. */
    uRepeat: number;
    /**
     * +1 when the track lies on the side of increasing cross section offset (a wall left of the
     * midpoint), -1 when on the other: the face a driver sees.
     */
    facing: 1 | -1;
    panels: CprRoadWallPanel[];
}
export interface CprRoad {
    quads: CprRoadQuad[];
    walls: CprRoadWall[];
}
/** `textureCount` is the `.TTX`'s length: a reference outside it reads as texture 0. */
export declare function buildCprRoad(surfaces: readonly CprTrackSurface[], textureCount?: number): CprRoad;
/** A point of a track's centreline: where it is, and how far the road reaches either side of it (feet). */
export interface CprLinePoint {
    pos: Point;
    /** The road's extent from the centreline to the left (negative offsets) and the right, feet, both positive. */
    left: number;
    right: number;
}
/**
 * The track's centreline, one point per cross section in the file's order: the place on each section at lateral offset
 * 0 (the `pointOffsets` are measured from it), between the two points either side of it in the section's left half,
 * where the game's sections keep the racing surface. With it, how far the road's own slots (Road and Curb) reach either
 * way from it, on the run of them that holds the centreline. Sections without points are skipped.
 */
export declare function cprCentreline(surfaces: readonly CprTrackSurface[]): CprLinePoint[];
export {};
