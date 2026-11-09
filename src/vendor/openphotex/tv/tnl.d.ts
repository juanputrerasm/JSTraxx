/** One ring of a segment: start and end angle (65536 per turn) and radii (256 world units). */
export interface TunnelRing {
    startAngle: number;
    endAngle: number;
    radiusX: number;
    radiusY: number;
}
/** One tunnel segment, as the file stores it. */
export interface TunnelSegment {
    index: number;
    /** Ring A (segment start) centre, in 256 world units. */
    centreA: [number, number];
    /** Ring B (segment end) centre, in 256 world units. */
    centreB: [number, number];
    sides: number;
    ringA: TunnelRing;
    ringB: TunnelRing;
    /** Sides left out of the ring; 0 is a closed tube. */
    open: number;
    type: number;
    timer: number;
    textureList: number;
    /** One texture index per face, `sides` long. */
    sideTextures: number[];
    /** Fields the builder does not use, in file order: unk28, unk48, unk234, unk23C, unk240. */
    unknown: [number, number, number, number, number];
}
export interface TvTunnel {
    segments: TunnelSegment[];
    /** True when the file ended exactly after the last declared segment. */
    complete: boolean;
}
/** The longest tunnel the engine accepts. */
export declare const TUNNEL_MAX_SEGMENTS = 90;
/** Segment length along the tube, in the file's 256-world-unit units: one terrain cell. */
export declare const TUNNEL_SEGMENT_LENGTH = 4096;
/** World units per .TNL coordinate unit. */
export declare const TUNNEL_UNIT = 256;
/**
 * Parses a .TNL file. Returns null when the segment count is missing or out of range; a file
 * that ends early keeps the segments read so far, with `complete` false.
 */
export declare function parseTvTunnel(bytes: Uint8Array | null | undefined): TvTunnel | null;
/** A segment's two rings and faces, in 256-world-unit tunnel coordinates. */
export interface TunnelSegmentGeometry {
    /** `sides` vertices [x, y, z] at the segment start (z = index * TUNNEL_SEGMENT_LENGTH). */
    ringA: [number, number, number][];
    /** `sides` vertices at the segment end. */
    ringB: [number, number, number][];
    /** Face k joins ring vertices k and (k + 1) % sides on both rings, textured sideTextures[k]. */
    faces: {
        a: number;
        b: number;
        texture: number;
    }[];
}
/**
 * The geometry TV's tunnel builder (0x33f00) makes from a segment.
 *
 * Each ring has `sides - open` vertices on its ellipse, vertex k at angle
 * `start + k * (end - start) / (sides - open)`, x = cos * radiusX, y = sin * radiusY, relative
 * to ring A's centre; ring B adds its own centre's offset. When the ring is open, the vertices
 * from `sides - open` onwards sit on the tube's centre line, so the faces that reach them close
 * the cut side towards the axis; on both rings that point is ring A's centre, as the builder
 * writes it. Coordinates are absolute (centre added) and z advances one segment length per index.
 */
export declare function tunnelSegmentGeometry(segment: TunnelSegment): TunnelSegmentGeometry;
