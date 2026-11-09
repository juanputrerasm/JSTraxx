export type AudioFormat = "wav" | "ogg" | "mp3";
/** The format of a sound file, or null when it is none of WAV, Ogg and MP3. */
export declare function detectAudioFormat(bytes: Uint8Array): AudioFormat | null;
/** The rate, in samples per second, the file was made at; null when it cannot be read. */
export declare function audioSampleRate(bytes: Uint8Array): number | null;
