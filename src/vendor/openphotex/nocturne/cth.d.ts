export interface CthCloth {
    version: number;
    model: string;
    weight: number;
    gravity: number;
    dampen: number;
    spring: number;
    bodyFriction: number;
    floorFriction: number;
    windArea: number;
    momentOfInertia: number;
    transparency: number;
    doubleSided: boolean;
    lockedVertices: Int32Array;
    collisionBones: {
        name: string;
        values: number[];
    }[];
}
export declare function parseCth(bytes: Uint8Array, name?: string): CthCloth;
