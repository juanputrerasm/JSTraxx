export interface SklMotion {
    name: string;
    fps: number;
    state: number;
    frameStart: number;
    frameCount: number;
    exitForward: number[];
    exitForwardCommand: number[];
    exitBackward: number[];
    transitions: number[][];
    signals: number[][];
    markers: number[];
}
export interface SklSkeleton {
    version: number;
    boneCount: number;
    frameCount: number;
    bones: {
        name: string;
        parent: number;
    }[];
    rotations: Float32Array;
    rootOffsets: Float32Array;
    cancelledMovement: Float32Array;
    motionListVersion: number;
    states: string[];
    motions: SklMotion[];
    referenceOrigins: Float32Array;
}
export declare function parseSkl(bytes: Uint8Array, name?: string): SklSkeleton;
