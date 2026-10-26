export interface SunFlareLayer {
    texture: string;
    axisPosition: number;
    radius: number;
    /** Texture rectangle corners, in texels. */
    tex: [number, number, number, number];
}
export interface MtmSun {
    type: number;
    /** In 1/256 ft, as stored. */
    position: [number, number, number];
    masterRadius: number;
    layers: SunFlareLayer[];
    /** Visibility rays, in 1/256 ft. */
    rays: [number, number, number][];
}
export declare function parseMtmSun(input: Uint8Array | string): MtmSun;
