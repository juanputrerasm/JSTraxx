export interface CockpitSection {
    label: string;
    values: string[];
}
export type Rect = [number, number, number, number];
export interface CockpitGauge {
    center: [number, number];
    radius: number;
    needleModel: string;
    zeroAngle: number;
    /** Degrees per mph (speedometer) or per rpm (tachometer). */
    degreesPerUnit: number;
    faceRedraw: Rect;
}
export interface CockpitMirror {
    location: Rect;
    angles: [number, number, number];
    translation: [number, number, number];
    zoom: number;
    bitmapRect: Rect;
    bitmap: string;
}
export interface MtmCockpitLayout {
    /** Every comment and the lines under it, as written. */
    sections: CockpitSection[];
    backgrounds: string[];
    window3d: Rect;
    speedometer: CockpitGauge;
    tachometer: CockpitGauge;
    steeringWheel: Rect;
    eraseWindow: Rect;
    steeringWheelBase: string;
    mirrors: CockpitMirror[];
    shifter: string;
    shifterRect: Rect;
    shiftLight: string;
    shiftLightRect: Rect;
}
/** The comments and their values. */
export declare function parseCockpitSections(input: Uint8Array | string): CockpitSection[];
/** Read a POWERBIG layout; null when it ends early. */
export declare function parseCockpitLayout(input: Uint8Array | string): MtmCockpitLayout | null;
