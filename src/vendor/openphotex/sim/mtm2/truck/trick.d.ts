/** The trick strengths a host may set (any model's rules may carry them). */
export interface TrickRules {
    airPitchControl?: number;
    airRotationDamping?: number;
    groundYawDamping?: number;
}
/** The aero damping's scale: `[rot, yaw]`, rot for the roll and pitch rates, yaw for the yaw rate. */
export declare function trickDamping(rules: TrickRules | null | undefined, aloft: boolean): [number, number];
/**
 * The pitch moment the pedals give with all four wheels off, for moment[0] (body x): throttle nose up, brakes nose
 * down, `airPitchControl` rad/s² a full pedal on the pitch inertia `pitchInertia`. 0 on the ground or without the rule.
 */
export declare function trickPitchMoment(rules: TrickRules | null | undefined, aloft: boolean, throttle: number, brakeFront: number, brakeRear: number, pitchInertia: number): number;
