import { type Mtm2Rules } from "../mtm2/constants.ts";
export declare const CPR_RULES: Mtm2Rules;
export declare function isCprRules(id: string | null | undefined): id is "cpr";
/** The car as the constructor makes it (CART.EXE 0x4b2b00; CPR_PHYSICS.md 2.1). */
export declare const CPR_CAR: Readonly<{
    /** Weight without fuel (+0x164c) and with 35 gallons (+0x1654), lb; fuel weighs 6.75 lb a gallon (+0x900 236.25 lb). */
    dryWeightLb: 1675;
    fuelLbPerGallon: 6.75;
    /** Roll, pitch, yaw inertia, slug ft² (+0x1660, +0x1664, +0x1668). */
    inertia: readonly [200, 400, 400];
    /** Drag reference area (+0x167c) and side area (+0x1678), ft². */
    refAreaFt2: 15;
    sideAreaFt2: 150;
    /** Rev limit (+0x3dc, 0x466a6000) and upshift rpm (+0x7f0, 0x46629000). */
    revLimit: 15000;
    upshiftRpm: 14500;
}>;
/** Air density at sea level, slug/ft³ (0x463810 with ambient temperature off). */
export declare const CPR_AIR_DENSITY = 0.002377;
/** Load sensitivity (0x5ec430 front, 0x5ec488 rear): mu every 100 lb from 0, held at the last entry; times 1.1875 (0x5b23d8). */
export declare const CPR_MU_FRONT: readonly number[];
export declare const CPR_MU_REAR: readonly number[];
export declare const CPR_MU_SCALE = 1.1875;
/** The load-sensitive mu of a front (`front`) or rear tire under `loadLb`. */
export declare function cprMu(loadLb: number, front: boolean): number;
export declare function cprForceFactor(slip: number): number;
/** Grip by compound and weather (tire +0x88, 0xa45244): [dry, rain] for compounds 0, 1 and the rain tire (4). */
export declare function cprCompoundGrip(compound: number, rain: boolean): number;
/**
 * Grip by surface (CPR_PHYSICS.md 6.2): Road 1.0, Curb 0.9, Grass 0.6, Dirt 0.7, Rocks 0.7. The port's ground carries
 * MTM2's types (a CPR track maps Road and Curb to 1, Grass to 6, Dirt to 2, Rocks to 12: worker/cpr-road.js), so a curb
 * reads as road. Another game's surfaces under CPR's car take the nearest of these (the port's rule).
 */
export declare function cprSurfaceGrip(mtm2Type: number): number;
/** Engine friction torque every 1,000 rpm from 0 to 15,000, lb-ft (0x5ec3f0). */
export declare const CPR_FRICTION: readonly number[];
/**
 * Net torque at full throttle every 1,000 rpm, lb-ft: **the port's**. The game builds torque from a mixture table, a boost
 * table, the air density and the fuel flow (0x475580), whose composition is not traced; this curve gives a 1998 CART
 * engine's figure instead, about 850 hp at 14,000 rpm.
 */
export declare const CPR_TORQUE: readonly number[];
/** The engine's torque at the flywheel, lb-ft: the throttle's share of the curve less the friction (engine braking shut). */
export declare function cprEngineTorque(rpm: number, throttle: number): number;
/** Dampers (CPR_PHYSICS.md 6.1): the force at damper speed `v` (ft/s) for a slow and a fast click. */
export declare function cprDamperForce(v: number, slow: number, fast: number): number;
/** The draft factor (0x470370): `gap` the time to the car ahead, s; `side` the lateral share. */
export declare function cprDraft(gap: number, side: number): number;
