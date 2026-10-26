export interface EvoScriptCall {
    name: string;
    args: string[];
}
export interface EvoScriptCondition {
    negate: boolean;
    /** A call (`objectsIntersect`), or null for a flag. */
    call: EvoScriptCall | null;
    /** The flag's name, for a flag condition. */
    flag: string | null;
}
export interface EvoScriptRule {
    /** Empty for a rule with no `->`. */
    conditions: EvoScriptCondition[];
    actions: EvoScriptCall[];
    /** The line it was read from, counted from 1. */
    line: number;
}
export interface EvoScript {
    sourceName: string;
    rules: EvoScriptRule[];
    warnings: string[];
}
export declare function parseEvoScript(bytes: Uint8Array, sourceName: string): EvoScript;
