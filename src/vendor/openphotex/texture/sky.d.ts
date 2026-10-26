/** The palette slot the gradient is copied into. */
export declare const SKY_PALETTE_FIRST_SLOT = 240;
/** The .ACT colour it is read from. */
export declare const SKY_ACT_FIRST_COLOUR = 192;
/** How many colours; the last is the horizon. */
export declare const SKY_GRADIENT_COLOURS = 16;
/** The 16 gradient colours (48 bytes) of a sky .ACT, or null when it is too short. */
export declare function skyGradient(act: Uint8Array | null | undefined): Uint8Array | null;
/** The horizon colour: the gradient's last entry. */
export declare function skyHorizon(gradient: Uint8Array): [number, number, number];
