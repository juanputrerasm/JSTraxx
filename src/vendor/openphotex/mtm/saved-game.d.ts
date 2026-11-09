export declare const MTM2_SAVED_GAME_HEADER = "MonsterTruckMadness 2.00";
/** One truck of a saved game: its catalogue name and Garage setup. */
export interface Mtm2SavedTruck {
    file: string;
    /** 0, 1, 2: shallow, medium, deep. */
    tireCut: number;
    /** 0, 1, 2: soft, medium, hard. */
    suspension: number;
    /** The transfer slider, 0..2000. */
    transfer: number;
}
export interface Mtm2SavedGame {
    playerTruck: string;
    raceIndex: number;
    laps: number;
    trucks: Mtm2SavedTruck[];
    weather: number;
    /** The situation, a SIT's text (read it with parseMtmSit). */
    sit: string;
}
/** A saved game's text as bytes, CR LF line ends; `sit` is appended as given (its own line ends made CR LF). */
export declare function writeMtm2SavedGame(game: Mtm2SavedGame): Uint8Array;
/** Read a saved game. Throws on a file whose first line is not the version line, as the game refuses it. */
export declare function parseMtm2SavedGame(input: Uint8Array | string): Mtm2SavedGame;
