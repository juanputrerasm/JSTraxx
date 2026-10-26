export interface SetLight {
    name: string;
    position: number[];
    orientation: number[];
    fov: number;
    aspect: number;
    intensity: number;
    type: number;
    colourAndAttenuation: number[];
    size: number[];
    filters: string[];
    blendFilter: number;
    filterFrame: number;
    filterMotion: number[];
    timing: number[];
    visibleIn: number[][];
}
export interface SetCamera {
    name: string;
    position: number[];
    orientation: number[];
    fov: number;
    viewMatrix: number[][];
    usesGlobalFog: boolean;
    fog: {
        colour: number[];
        velocity: number[];
        range: number[];
        temperature: number;
    } | null;
    boxMin: number[];
    boxMax: number[];
    reverbPreset: number;
}
export interface NocturneSet {
    version: number;
    unitScale: number;
    palette: string;
    geometry: string;
    geometryScale: number;
    fog: {
        colour: number[];
        velocity: number[];
        range: number[];
        temperature: number;
    };
    water: number[];
    environmentModel: string;
    transparentWater: boolean;
    hasSky: boolean;
    sky: string;
    worldGeometry: string;
    weatherType: number;
    lights: SetLight[];
    cameras: SetCamera[];
    trailingLines: string[];
}
export declare function parseNocturneSet(bytes: Uint8Array, name?: string): NocturneSet;
