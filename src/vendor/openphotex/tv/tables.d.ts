/** Pickup model and names by .PUP type / .DEF drop type. */
export interface TvPowerup {
    model: string;
    name: string;
    furyName: string;
}
export declare const TV_POWERUPS: readonly TvPowerup[];
/** The powerup entry for a type index, or null. -1 is TVCAD's "Random". */
export declare function tvPowerup(type: number): TvPowerup | null;
/** Enemy logic names by .DEF header slot 0 (TVCAD.INI [Logic]). */
export declare const TV_LOGIC_NAMES: string[];
/** Primary weapon names by .DEF body line 1 slot 4 (TVCAD.INI [Weapons]). */
export declare const TV_WEAPON_NAMES: string[];
export declare function tvLogicName(index: number): string;
export declare function tvWeaponName(index: number): string;
