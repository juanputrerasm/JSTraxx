export interface CprPitStop {
    lapMin: number;
    lapMax: number;
    fuel: number;
    type: number;
}
export interface CprSetup {
    tireCompound: [number, number, number, number];
    tirePressure: [number, number, number, number];
    tireStagger: [number, number];
    brakeProportioning: number;
    springRate: [number, number, number, number];
    dampingFastBump: [number, number, number, number];
    dampingSlowBump: [number, number, number, number];
    dampingFastRebound: [number, number, number, number];
    dampingSlowRebound: [number, number, number, number];
    camber: [number, number, number, number];
    installationRatio: [number, number, number, number];
    thirdSpringRate: [number, number, number, number];
    thirdSpringFreePlay: [number, number, number, number];
    antiRollBar: [number, number];
    steeringLock: number;
    toeIn: [number, number];
    wingType: [number, number];
    wingAngle: [number, number];
    gurneyFlapSize: [number, number];
    staticRideHeight: [number, number];
    fuelAmount: number;
    ballastPosition: number;
    gearRatio: [number, number, number, number, number, number];
    finalDriveRatio: number;
    /** 1 limited slip, 2 locked, 3 open (CPR_PHYSICS.md 5). */
    differentialType: number;
    pitStops: CprPitStop[];
    mirrorAngles: [number, number];
}
export declare const CPR_DEFAULT_SETUP: Readonly<CprSetup>;
/** A setup to change, copied from `setup` (the stock one by default). */
export declare function cloneCprSetup(setup?: Readonly<CprSetup>): CprSetup;
/** Read a setup; whatever the file lacks keeps the stock value. Null when nothing in it is a setup label. */
export declare function parseCprGarage(input: Uint8Array | string): CprSetup | null;
/** The file's text for a setup, CRLF lines as the game writes them. */
export declare function writeCprGarage(setup: CprSetup): string;
