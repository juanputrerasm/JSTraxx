export declare const MRGL: {
    readonly EOL: 0;
    readonly ORGIN: 1;
    readonly VLIST: 2;
    readonly ILIST: 3;
    readonly TLIST: 4;
    readonly FACET: 5;
    readonly GFACET: 6;
    readonly TFACET: 7;
    readonly GTFACET: 8;
    readonly ICALL: 9;
    readonly COLOR: 10;
    readonly SCALL: 11;
    readonly ORDER: 12;
    readonly TEXTURE: 13;
    readonly FACETTMAP: 14;
    readonly TTFACET: 15;
    readonly TCALL: 16;
    readonly FACETTTMAP: 17;
    readonly JUMP: 18;
    readonly MAGNIFY: 20;
    readonly PTFACET: 21;
    readonly OUTLINE: 22;
    readonly ZBUFFERPOLY: 23;
    readonly ZFACETTMAP: 24;
    readonly ZFACET: 25;
    readonly ZTFACET: 26;
    readonly ZGFACET: 27;
    readonly TEXTURECYCLE: 29;
    readonly FFACETTMAP: 30;
    readonly CLIST: 31;
    readonly KEYFRAME: 32;
    readonly XTFACET: 33;
    readonly ZPFACETTMAP: 34;
    readonly ZGFACETTMAP: 41;
    readonly UZFACETTTMAP: 51;
    readonly UZFACETTMAP: 52;
    readonly ZXFACETTMAP: 56;
    readonly OPACITY: 61;
    readonly TEXTURE64: 62;
    readonly MATERIAL: 63;
    readonly MATFACET: 64;
    readonly KEYFRAME64: 65;
    readonly MATERIAL2: 66;
    readonly NORMALMAP: 67;
};
/** Facets with per-corner texture coordinates. MATFACET also takes the current material. */
export declare const BIN_MAPPED_FACETS: ReadonlySet<number>;
/** Facets with vertex indices only. */
export declare const BIN_UNMAPPED_FACETS: ReadonlySet<number>;
/** Legacy transparent (colour-keyed) face types, for faces with no material. */
export declare const BIN_TRANSPARENT_FACE_TYPES: ReadonlySet<number>;
/** The untextured face type that takes its colour from the preceding MRGL_COLOR. */
export declare const BIN_SOLID_FACE_TYPE = 25;
export declare const MRGLMAT: {
    readonly LIT: 1;
    readonly BLEND: 4;
    readonly ALPHATEST: 8;
    readonly ADDITIVE: 16;
    readonly TWOSIDED: 128;
    readonly NOZWRITE: 256;
    readonly EMISSIVE: 512;
    readonly TINT: 1024;
    readonly ALPHAREF: 2048;
    readonly TEXSOLID: 8192;
};
/** MRGL_MATERIAL2 flag bits. */
export declare const MRGLMAT2: {
    readonly NORMALMAP: 1;
};
export declare const BIN_GEOMETRY_DIVISOR: {
    readonly legacy: 64;
    readonly hellbender: 4096;
    readonly terminalVelocity: 8192;
};
export declare const BIN_TEXTURE_NAME_MAX = 31;
/** MRGL_MATERIAL: everything but `flags` and the foliage word is 16.16 fixed point. */
export interface BinMaterial {
    /** 1-based, in the order the model declares its materials. */
    id: number;
    flags: number;
    reflectivity: number;
    fresnelBias: number;
    fresnelStrength: number;
    baseAlpha: number;
    specPower: number;
    emissive: number;
    tint: [number, number, number];
    /** Low 16 bits of the foliage word. */
    alphaRef: number;
    /** High 16 bits of the foliage word. */
    translucency: number;
}
/** MRGL_MATERIAL2. `normalStrength` is as stored; it is meaningful only with MRGLMAT2.NORMALMAP. */
export interface BinMaterial2 {
    flags2: number;
    normalStrength: number;
    reserved: number[];
}
export interface BinFace {
    opcode: number;
    /** Byte offset of the facet record's opcode. */
    offset: number;
    /** Whether the record carries per-corner texture coordinates. */
    mapped: boolean;
    /** The current texture when the face was read, as written (up to its NUL); "" for none. */
    textureName: string;
    /** The record that set that texture: MRGL.TEXTURE, TEXTURE64 or TEXTURECYCLE; null for none. */
    textureOpcode: number | null;
    /** MRGL_TEXTURECYCLE: every frame's texture name in order (the first is `textureName`); absent otherwise. */
    textureFrames?: string[];
    /** The current MRGL_COLOR, 0xRRGGBB (COLORREF bytes), when the face was read. */
    solidColor: number;
    /** Index into `materials` (MATFACET only), or null. */
    material: number | null;
    /** Index into `materials2` (MATFACET only), or null. */
    material2: number | null;
    /** The facet header's stored normal, raw. */
    storedNormal: [number, number, number];
    /** The facet header's fourth word ("funk"), raw. */
    magic: number;
    /** Zero-based vertex indices. */
    vertexIndices: number[];
    /** Raw texture coordinates, over 0xFF0000; zeros for an unmapped face. */
    u: number[];
    v: number[];
    /** Whether the file stored the indices one-based (and they were corrected). */
    oneBased: boolean;
}
export interface BinModel {
    kind: "mrgl" | "animated" | "lwo" | "unknown";
    /** The first word, which identifies the kind. */
    signature: number | null;
    /** The leading MRGL_MAGNIFY power (mrgl) or the header's magnify word (animated), as stored. */
    magnify: number | null;
    /** Any later MRGL_MAGNIFY records' powers, in order. */
    magnifyRecords: number[];
    /** Whether the vertex count was readable and in range; without it no faces are read. */
    vertexListValid: boolean;
    /**
     * Raw vertex words, three per vertex in file order. The engine shifts each right by one:
     * (w0 >> 1, w1 >> 1, w2 >> 1) are (x, z, y) with z up.
     */
    vertices: Int32Array;
    faces: BinFace[];
    materials: BinMaterial[];
    materials2: BinMaterial2[];
    /** ANIMATED_BIN: the frame models, as written (up to 16 bytes each). */
    frameNames: string[];
    /**
     * ANIMATED_BIN: how long one frame lasts, in seconds (the header's fourth word, 16.16), or null. The game runs the
     * frames in a loop on its frame clock and joins them with a Catmull-Rom spline (MONSTER.EXE 0x431960).
     */
    frameSeconds: number | null;
    /** Whether the walk stopped before MRGL_EOL, and why. */
    incomplete: boolean;
    stopReason: string | null;
    warnings: string[];
}
/** Parse a .BIN. Never throws: an unreadable model is returned with `kind` or `stopReason` saying so. */
export declare function parseBin(input: Uint8Array | ArrayBuffer): BinModel;
