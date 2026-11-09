/** The routine's frame-time scale: a 16.16 multiply by 0x7fff. */
export declare const KEY_DT_SCALE: number;
export interface KeyInput {
    accelerate: boolean;
    brake: boolean;
    left: boolean;
    right: boolean;
    /** Edge-triggered manual shift keys. */
    shiftUp?: boolean;
    shiftDown?: boolean;
}
export interface ControlState {
    throttle: number;
    brakeFront: number;
    brakeRear: number;
    /** Front steering angle, rad (positive right). */
    steer: number;
    rearSteer: number;
    gear: number;
    shiftRequest: number;
    /** Optional handling (not the game's): the automatic box takes shift requests too, then holds the gear (drivetrain.ts). */
    autoOverride?: boolean;
    shiftHold?: boolean;
    /** The steering exponent from the previous frame. */
    steerExponent: number;
}
export interface ControlContext {
    dt: number;
    autoShift: boolean;
    /** Body forward speed, ft/s. */
    forwardSpeed: number;
    dragMode: boolean;
    /** Course segments passed (the drag-race gate). */
    segments: number;
    /** MONSTER.INI steering response / 10 (1 by default; Community Patch 3 takes it to 2). */
    steeringResponse?: number;
    /** Community Patch 3's `steerCurveMode`: 0 the game's power curve ("Original (1998)", the default), 1 "Expo". */
    steerCurveMode?: number;
    /** Community Patch 3's `steerRange`, 5 to 100: the percentage of the stick's throw that reaches full lock (90). */
    steerRange?: number;
    /** Community Patch 3's `steerExpo`, 0 to 100: the Expo curve's share of x³ against x. */
    steerExpo?: number;
    /** Community Patch 3's `steerSpeedSens`, 0 to 100: how much the Expo curve eases off up to 88 ft/s (35). */
    steerSpeedSens?: number;
    /** Difficulty (the joystick's Rookie steering scale); Intermediate when absent. */
    difficulty?: number;
}
/** A joystick or wheel, each axis -1..1 from its calibrated centre. */
export interface JoystickInput {
    /** Steering, positive right. */
    x: number;
    /** Pedals: negative is the throttle, positive the brake. */
    y: number;
    /** The dead zone as a fraction of the throw (MONSTER.INI `nullZone` / 65536). */
    deadZone?: number;
    shiftUp?: boolean;
    shiftDown?: boolean;
}
export declare function createControlState(gear?: number): ControlState;
/** Apply one frame of keyboard input to the pedals, gear selection and steering. */
export declare function applyKeyboard(c: ControlState, keys: KeyInput, ctx: ControlContext): void;
/** Community Patch 3's steering defaults (its INI and its Reset Steering & Feedback). */
export declare const CP3_STEER: Readonly<{
    range: 90;
    speedSens: 35;
    easeOff: 0.6;
    easeSpeed: 88;
}>;
/**
 * The shaped steering of a stick at `x` (-1..1, dead zone already out), 0..1 of full lock: the
 * game's power curve, or Community Patch 3's Expo curve (`steerCurveMode` 1).
 */
export declare function joystickSteer(x: number, ctx: ControlContext): number;
/**
 * Apply one sub-step of joystick or wheel input (MONSTER_EXE_ANALYSIS.md §7). Steering follows
 * the stick through a steep power curve (`joystickSteer`); the pedal axis sets the throttle or the
 * brakes directly, selecting Reverse or first gear as the keyboard does with autoShift.
 */
export declare function applyJoystick(c: ControlState, j: JoystickInput, ctx: ControlContext): void;
/** The rear axle's steering angle for a front angle. */
export declare function rearSteer(front: number, dragMode: boolean): number;
