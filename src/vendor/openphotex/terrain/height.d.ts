/** CPR terrain: uint16LE / 64.0, 10.6 fixed point, giving CPR native steps. */
export declare const CPR_HEIGHT_DIVISOR = 64;
/** CPR SIT/TRK altitude (feet) per CPR native step: trkAltitude / 4 == raw16 / 64. */
export declare const CPR_ALTITUDE_DIVISOR = 4;
/** Canonical (MTM, 2 ft) legacy steps per CPR native (4 ft) step. */
export declare const CPR_HEIGHT_UNIT_SCALE = 2;
/**
 * Feet of SIT or TRK altitude per canonical legacy step, for every SIT-family game.
 * For CPR this is CPR_ALTITUDE_DIVISOR / CPR_HEIGHT_UNIT_SCALE; for MTM1/MTM2 it is the
 * classic `/ 2`.
 */
export declare const LEGACY_ALTITUDE_DIVISOR: number;
/**
 * One RAW sample at byte offset `off`, as a legacy height.
 *
 * @param {Uint8Array} raw
 * @param {number} off            byte offset of the sample
 * @param {number} bytesPerCell   1 or 2
 * @param {number|null} heightDivisor  the 16-bit encoding's fixed-point divisor, if known
 * @param {number} [heightUnitScale]   canonical steps per native step, default 1
 */
export declare function decodeHeightSample(raw: Uint8Array, off: number, bytesPerCell: number, heightDivisor: number | null, heightUnitScale?: number): number;
/**
 * Compatibility reading for a 16-bit grid whose loader declared no encoding.
 *
 * This is the JTraxx `sampleLegacyHeightWhole` rule: a zero high byte is taken as an 8-bit
 * height stored two bytes wide, anything else as 10.6 fixed point floored to a whole step.
 * It discards precision and exists only so an undeclared grid builds as it always has; CPR and
 * Evo both declare a divisor and never reach it.
 */
export declare function legacyWholeHeight16(raw16: number): number;
/**
 * The legacy height at grid corner (cx, cz), clamped to the grid.
 *
 * @param {object} terrain  { gridSize, rawBytesPerCell, heightDivisor, heightUnitScale }
 * @param {Uint8Array} raw
 */
/** How a heightfield grid encodes its samples. */
export interface HeightGrid {
    gridSize?: number;
    rawBytesPerCell?: number;
    heightDivisor?: number | null;
    heightUnitScale?: number;
}
export declare function heightAtCell(terrain: HeightGrid | null | undefined, raw: Uint8Array | null | undefined, cx: number, cz: number): number;
