import type { Mtm2TruckParams } from "../mtm2/truck/params.ts";
import type { EvoRules } from "./rules.ts";
import type { EvoVehicleSpec } from "./spec.ts";
export interface EvoSetup {
    difficulty?: number;
    cpu?: boolean;
    autoShift?: boolean;
    /** Tire tread 0..3 (shallow, medium, deep, studded). */
    tread?: number;
    /** Parts modifiers (1 = stock). */
    torqueModifier?: number;
    tireCFModifier?: number;
    brakeBalance?: number;
}
export interface EvoTruckParams extends Mtm2TruckParams {
    evo: {
        spec: EvoVehicleSpec;
        rules: EvoRules;
        tread: number;
        torqueModifier: number;
        tireCFModifier: number;
        brakeBalance: number;
    };
}
export interface EvoGeometry {
    /** The tires' radius and width, ft (the tire model's bounds). */
    tireRadiusFt?: number | null;
    tireWidthFt?: number | null;
}
export declare function createEvoParams(spec: EvoVehicleSpec, rules: EvoRules, geometry?: EvoGeometry, setup?: EvoSetup): EvoTruckParams;
