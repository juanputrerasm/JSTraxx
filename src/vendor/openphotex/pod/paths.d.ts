/**
 * The lookup key for an archive path: `\` becomes `/`, surrounding whitespace goes, and the
 * result is upper-cased. The games treat archive paths case-insensitively and mostly write
 * them with backslashes, while callers tend to write forward slashes.
 */
export declare function normalizePodPath(name: string | null | undefined): string;
/** The last component of a normalized archive path, e.g. `ART/GRASS.RAW` becomes `GRASS.RAW`. */
export declare function podPathTitle(name: string | null | undefined): string;
