export type Triplet = [number, number, number];
/** Tire order everywhere in the simulation: front right, front left, rear right, rear left. */
export declare const TIRE_FR = 0, TIRE_FL = 1, TIRE_RR = 2, TIRE_RL = 3;
export interface Mtm2TruckGeometry {
    /** Wheel centres in body feet, FR, FL, RR, RL (the TRK `static_bpos` values). */
    wheelAnchors?: readonly Triplet[] | null;
    /** The 12 hull points in body feet (the TRK scrape points). */
    scrapePoints?: readonly Triplet[] | null;
    /**
     * The tires' radius and width in feet, for a vehicle of another game (a CPR car, a 4x4 Evolution
     * truck) driven by this model. Every MTM truck has the game's fixed 3 ft by 4 ft, the default.
     */
    tireRadiusFt?: number | null;
    tireWidthFt?: number | null;
}
export interface Mtm2TruckSetup {
    /** Garage transfer slider, 0..2000 (600..2000 in the Garage). */
    transferSetting?: number;
    /** 0 soft, 1 medium, 2 hard. */
    suspension?: number;
    /** 0 shallow, 1 medium, 2 deep. */
    tireCut?: number;
    difficulty?: number;
    /** A CPU truck (or a player on autopilot is still a player). */
    cpu?: boolean;
    autoShift?: boolean;
    /** The SIT names a `Sonic` track: CPU trucks on Professional get more grip and torque. */
    sonicTrack?: boolean;
}
export interface Mtm2TruckParams {
    bodyWeightLb: number;
    axleWeightLb: number;
    /** Body + both axles. */
    weightLb: number;
    massSlug: number;
    /** Roll (about z), pitch (about x), yaw (about y), slug ft². */
    inertia: Triplet;
    cgOffset: Triplet;
    tireRadiusFt: number;
    tireWidthFt: number;
    /** Wheel centres used by the simulation, after the wheelbase clamp. FR, FL, RR, RL. */
    hubs: Triplet[];
    /** Wheel centres as the TRK gives them, for drawing. */
    drawHubs: Triplet[];
    frontAxleZ: number;
    rearAxleZ: number;
    scrapePoints: Triplet[];
    /** Static sag, ft. */
    sagFt: number;
    /** Spring rate per wheel, lb/ft: front, rear. */
    spring: [number, number];
    /** Damper per wheel, lb s/ft: front, rear. */
    damper: [number, number];
    transferRatio: number;
    tireCut: number;
    /** Tire grip factor K. */
    gripK: number;
    /** Engine torque multiplier. */
    torqueGain: number;
    cpu: boolean;
    autoShift: boolean;
    difficulty: number;
    /**
     * Another vehicle model's own suspension and body (4x4 Evolution, `sim/evo`): per axle (front,
     * rear) the bump travel and the articulation limit, the spring arm of each tire and the aero
     * areas facing x, y, z. MTM2's constants apply when absent.
     */
    bumpTravelFt?: [number, number];
    articulationLimit?: [number, number];
    springArmFt?: number;
    aeroArea?: Triplet;
}
/** Wheel anchors used when a TRK gives none. */
export declare function defaultWheelAnchors(): Triplet[];
/**
 * The game's wheelbase clamp, per side: when |front z| + |rear z| exceeds 11.6 ft, both move in
 * by half the excess, and neither may cross z = 0. Returns new anchors.
 */
export declare function clampWheelbase(anchors: readonly Triplet[]): Triplet[];
/** Springs and dampers for a static sag (Garage suspension). */
export declare function suspensionRates(frontZ: number, rearZ: number, weightLb: number, suspension: number): {
    sag: number;
    spring: [number, number];
    damper: [number, number];
};
/** The transfer ratio for a Garage setting and a difficulty. */
export declare function transferRatio(setting: number, difficulty: number): number;
export declare function createTruckParams(geometry?: Mtm2TruckGeometry, setup?: Mtm2TruckSetup): Mtm2TruckParams;
