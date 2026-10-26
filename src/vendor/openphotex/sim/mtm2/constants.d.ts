/** Gravity, ft/s² (§8.7). */
export declare const G = 32.174;
/** 1 / G: pounds to slugs (§8.7). */
export declare const INV_G = 0.031081;
/** Air and water densities used for drag, slug/ft³ (§2.3). */
export declare const AIR_DENSITY = 0.002377;
export declare const WATER_DRAG_DENSITY = 0.15;
/**
 * The rules that differ between the two games' builds of this simulation. Monster Truck Madness
 * (1996, version 1.00) runs the same vehicle model with these differences, each read from its
 * executable (OpenMTM2 docs/MTM1_MONSTER_EXE_ANALYSIS.md 4.3); nothing else is known to differ.
 */
export interface Mtm2Rules {
    id: "mtm2" | "mtm1" | "evo1" | "evo2" | "cpr";
    /** Drag density of water, slug/ft³: a submerged part drags 6.7 times harder in MTM1. */
    waterDragDensity: number;
    /** Ground below the water level reads deep water (type 13), or ice in Snow. MTM1 has neither. */
    deepWater: boolean;
    /** Rain and Snow lower the grip. MTM1 has no weather. */
    weatherGrip: boolean;
    /** Hull impacts are reported for crash damage (the host's to honour). */
    crashDamage: boolean;
    /**
     * A tire against a tire, the velocity the force is made from: half the relative velocity
     * (MTM2), or axis by axis the relative velocity unless the faster point's own is smaller (MTM1).
     */
    wheelImpact: "half" | "smaller";
    /** A tire against a tire, the factor on the spinning tires' climb. */
    wheelSpinClimb: number;
    /** Whether a tire's spin counts in that climb only while it is on the ground. */
    wheelSpinNeedsGround: boolean;
}
export declare const MTM2_RULES: Mtm2Rules;
export declare const MTM1_RULES: Mtm2Rules;
/** The rules by name; an unknown name is MTM2's. */
export declare function simRules(id: string | null | undefined): Mtm2Rules;
/** Terrain grid (§2.1): 256 × 256 cells of 32 ft, heights in 2 ft steps. */
export declare const TERRAIN_CELLS = 256;
export declare const CELL_FT = 32;
export declare const WORLD_FT: number;
export declare const HEIGHT_STEP_FT = 2;
/** Weather states (A§13) and their grip factors (§2.3). */
export declare const WEATHER: Readonly<{
    CLEAR: 0;
    CLOUDY: 1;
    FOGGY: 2;
    DENSE_FOG: 3;
    RAIN: 4;
    SNOW: 5;
    DUSK: 6;
    NIGHT: 7;
    PITCH_BLACK: 8;
}>;
export declare function weatherGrip(weather: number): number;
/** Difficulty (A§6.5). */
export declare const DIFFICULTY: Readonly<{
    ROOKIE: 0;
    INTERMEDIATE: 1;
    PROFESSIONAL: 2;
}>;
/** Race modes, the SIT's track type code (A§6). */
export declare const RACE_MODE: Readonly<{
    DRAG: 1;
    CIRCUIT: 2;
    RALLY: 3;
    SUMMIT: 4;
}>;
/** Gear numbers (A§8.3): 1 Park, 2 Reverse, 3 Neutral, 4..6 first to third. */
export declare const GEAR: Readonly<{
    PARK: 1;
    REVERSE: 2;
    NEUTRAL: 3;
    FIRST: 4;
    SECOND: 5;
    THIRD: 6;
}>;
export declare const TRUCK: Readonly<{
    bodyWeightLb: 6000;
    axleWeightLb: 2000;
    /** Roll (p, about body z), pitch (q, about x), yaw (r, about y) inertias, slug ft². */
    inertia: readonly [5000, 5000, 7500];
    /** Centre of gravity relative to the body origin, ft. */
    cgOffset: readonly [0, -3, 0];
    tireRadiusFt: 3;
    tireWidthFt: 4;
    /** Default hub anchors (x, y, z) when a TRK gives none: right x = +4, left x = -4. */
    frontAxleZ: 5.67;
    rearAxleZ: -4;
    hubY: -4;
    hubHalfTrackX: 4;
    maxWheelbaseFt: 11.6;
    articulationLimit: 0.5;
    bumpTravelFt: 2;
    torqueSplit: Readonly<{
        front: 0.2;
        rear: 0.8;
    }>;
    /** Aero areas facing x, y, z (ft²) and their coefficients (§5.4). */
    aeroArea: readonly [125, 150, 75];
    aeroCd: readonly [5, 1.5, 1.5];
}>;
/** Engine (A§8.4): T(rpm) = scale · (a·rpm² + b·rpm + c), lb ft. */
export declare const ENGINE: Readonly<{
    torqueScale: 1700;
    a: -2.367e-8;
    b: 0.00009467;
    c: 0.905;
    idleRpm: 800;
    maxRpm: 8500;
    upshiftRpm: 7000;
    downshiftRpm: 3500;
}>;
/** Overall gear ratios by gear number (A§8.4); 0 for Park and Neutral. */
export declare const GEAR_RATIOS: readonly number[];
/** Transfer gear by Garage setting / 100 (A§8.5): settings 600..2000. */
export declare const TRANSFER_TABLE: readonly number[];
export declare const DEFAULT_TRANSFER_SETTING = 1500;
/** Transfer ratio multiplier by difficulty (A§8.5). */
export declare const TRANSFER_DIFFICULTY: readonly number[];
/** Static sag by suspension setting (§3.2): soft, medium, hard. */
export declare const SUSPENSION_SAG_FT: readonly number[];
export declare const SPRING_SHARE = 0.5;
export declare const DAMPER_FACTOR = 3.5;
/** Base friction coefficient by ground type, index = TTY value / 100 (§2.3). */
export declare const SURFACE_MU: readonly number[];
/** Ground types whose drag density is water's (§2.3). */
export declare const WATER_TYPES: ReadonlySet<number>;
/** The type reported below the water level, and in Snow (§2.3). */
export declare const DEEP_WATER_TYPE = 13;
export declare const FROZEN_WATER_TYPE = 8;
/** Grip by tire cut (shallow, medium, deep) per ground type (A§8.6). */
export declare const CUT_FACTORS: readonly (readonly [number, number, number])[];
/** Tire grip factor K (§5.1); 2.0 for CPU trucks on Professional on a Sonic track. */
export declare const TIRE_GRIP_K = 1.75;
export declare const TIRE_GRIP_K_SONIC_PRO = 2;
/** Hull contact friction factor (§6). */
export declare const HULL_FRICTION_K = 0.5;
/**
 * Lateral force coefficient against slip angle in radians (§5.3), as stored (0x647568): linear
 * between points, signed to oppose the slip. Note the stored ±π/2 points differ (−1.5707,
 * +1.5708).
 */
export declare const LATERAL_TABLE: readonly (readonly [number, number])[];
/** Speeds where behaviour changes, ft/s (§8.7): 10, 20, 40, 70 mph. */
export declare const MPH_10 = 14.67;
export declare const MPH_20 = 29.34;
export declare const MPH_40 = 58.68;
export declare const MPH_70 = 102.69;
/** Controls (A§7). */
export declare const CONTROLS: Readonly<{
    rampUpPerSec: 3.5;
    rampDownPerSec: 8;
    steerLock: 0.45;
    steerReturnFactor: 4;
    rearSteerFactor: -0.33;
    rearSteerDragFactor: 1.25;
}>;
/**
 * The step the original's per-step laws were tuned at (hypothesis: about 1/30 s, see
 * OpenMTM2's docs/PLAN.md "Step-length policy"). Fractions applied "per step" in the original
 * are converted with it.
 */
export declare const REFERENCE_DT: number;
/** Longest physics substep (§4, A§8.1). */
export declare const MAX_SUBSTEP = 0.1;
