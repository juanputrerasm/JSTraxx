/**
 * Parses a Hellbender .TXT briefing.
 *
 * Returns null when the file is not one, so a level that names something else at line 1
 * simply has no briefing rather than a panel full of filenames.
 */
/** The two labelled lines of a Hellbender briefing ("PLANET: Snow City", "MISSION: Freedom"). */
export interface HbBriefing {
    headingLabel: string | null;
    heading: string | null;
    missionLabel: string | null;
    mission: string | null;
}
export declare function parseHbBriefing(bytes: Uint8Array | null | undefined): HbBriefing | null;
