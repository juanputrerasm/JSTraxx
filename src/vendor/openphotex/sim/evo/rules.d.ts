import { type Mtm2Rules } from "../mtm2/constants.ts";
export interface EvoRules extends Mtm2Rules {
    id: "evo1" | "evo2";
    /** Weight over mass with all four tires off the ground: g (Evo 1), 56.3045 (Evo 2, 0x554600). */
    airborneG: number;
    /** The default CG's forward offset, ft: 0 (Evo 1), 2 (Evo 2, 0x5e9c80). */
    defaultCgZ: number;
    /** Rear grip falls when steering hard above 20 mph (Evo 2 only, 0x553920). */
    steerRearGripCut: boolean;
    /** Hull friction limit's factor on the support: 0.5 (Evo 1, as MTM2), 1.5 (Evo 2, 0x667090). */
    hullFrictionFactor: number;
}
export declare const EVO1_RULES: EvoRules;
export declare const EVO2_RULES: EvoRules;
/** The rules by name: "evo1" or "evo2" (anything else is Evo 2's). */
export declare function evoRules(id: string | null | undefined): EvoRules;
export declare function isEvoRules(id: string | null | undefined): id is "evo1" | "evo2";
/**
 * Friction coefficient by ground type (index = surface value / 100), the same in both games
 * (Evo 2 0x545ac0, Evo 1 0x504850). It differs from MTM2's on water, mud, ice, snow and deep
 * water, and adds type 14, train track. Unknown types read 1.0.
 */
export declare const EVO_SURFACE_MU: readonly number[];
export declare function evoSurfaceMu(type: number): number;
/** Tire tread: 0 shallow, 1 medium, 2 deep, 3 studded (the garage's tire cut). */
export declare const EVO_TREAD: Readonly<{
    SHALLOW: 0;
    MEDIUM: 1;
    DEEP: 2;
    STUDDED: 3;
}>;
/** Grip by tread per ground type (Evo 2 0x559500); unknown types read 1.0. */
export declare const EVO_TREAD_FACTORS: readonly (readonly [number, number, number, number])[];
export declare function evoTreadFactor(type: number, tread: number): number;
