export declare const HIGH_SCORES_FILE = "MTM2 High Scores";
export interface MtmHighScore {
    date: string;
    driver: string;
    truck: string;
    /** Seconds: a race or lap time, or a Summit Rumble's length. */
    time: number;
    points: number;
    /** 0 Rookie, 1 Intermediate, 2 Professional. */
    skill: number;
    summit: boolean;
}
export interface MtmHighScoreTrack {
    /** The catalogue's track name. */
    track: string;
    entries: MtmHighScore[];
}
/** The plain bytes of an enciphered file (whole blocks only; a trailing part of a block is dropped). */
export declare function decipherHighScores(bytes: Uint8Array): Uint8Array;
/** Plain bytes enciphered as the game writes them, with its closing block. */
export declare function encipherHighScores(plain: Uint8Array): Uint8Array;
/** The Hall of Fame from the file's bytes; null when they do not read as one. */
export declare function parseMtmHighScores(bytes: Uint8Array): MtmHighScoreTrack[] | null;
/** The file's bytes for a Hall of Fame, enciphered as the game writes it. */
export declare function writeMtmHighScores(tracks: MtmHighScoreTrack[]): Uint8Array;
