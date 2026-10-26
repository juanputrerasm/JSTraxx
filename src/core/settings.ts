/*
  The editor's settings. Traxx keeps these in the registry (CTraxxReg, Traxx/Traxx.h); the
  defaults below are CTraxxReg::CTraxxReg (Traxx/Traxx.cpp). JSTraxx stores them as JSON in
  OPFS (jstraxx/settings.json).

  Left out, because a browser has no use for them: the folder paths (ART, MODELS, POD, SIT,
  SOUND, BITMAPS; their place is taken by the library mount order and projects), the
  software-renderer switch and vsync, and the registration name and key.
*/

/** The five edit modes, numbered as Traxx's EDIT_* values (Traxx/Traxx.h). */
export const EDIT_TERRAIN = 0;
export const EDIT_TEXTURES = 1;
export const EDIT_COURSE = 2;
export const EDIT_OBJECTS = 3;
export const EDIT_BUILDINGS = 4;
export type EditMode = 0 | 1 | 2 | 3 | 4;

/** View grid size, in cells (TRAXX_GRID_* in Traxx/Traxx.h). */
export const GRID_DEFAULT = 64;
export const GRID_MIN = 16;
export const GRID_MAX = 256;
export const GRID_STEP = 8;

export const WATER_OPACITY_DEFAULT = 50;

/** Indices into `colors` (BG_COL..AGRD_COL in Traxx/Traxx.h). */
export const BG_COL = 0;
export const WIRE_COL = 1;
export const WIREO_COL = 2;
export const OBJ_COL = 3;
export const ATXT_COL = 4;
export const AGRD_COL = 5;

/** Traxx's EditSettings (Traxx/Traxx.h). */
export interface EditSettings {
  /** The 3-state Wire Frame box: 0 textures, 1 wireframe only, 2 textures with the wire over them (CTraxxView::CTraxxView). */
  wireframe: 0 | 1 | 2;
  /** Terrain tool 0..7: Platform, Hill, Wedge, Mound, Random, Smooth, Plane, Manual. */
  tool: number;
  orientation: number;
  curvature: number;
  altitude: number;
  terrainw: number;
  terrainh: number;
  /** Texture paint mode. */
  paint: boolean;
  texturew: number;
  textureh: number;
}

/** A remembered window rectangle, in CSS pixels; null until the author moves it. */
export interface PanelRect { x: number; y: number; w: number; h: number; open: boolean }

export interface TraxxSettings {
  version: 1;
  gamma: number;
  /** Grid window size in cells (`polysize`). */
  polysize: number;
  always_course: boolean;
  always_objects: boolean;
  always_buildings: boolean;
  show_water: boolean;
  show_backdrop: boolean;
  show_whole_grid: boolean;
  display_fps: boolean;
  model_transparency: boolean;
  hide_colliders: boolean;
  water_opacity: number;
  /** Wire Frame: also draw each cell's diagonal (Traxx draws the cell edges only). */
  wire_diagonals: boolean;
  /** Wire Frame: line width in screen pixels, 1..4 (Traxx: about 1). */
  wire_width: number;
  show_sit_units: boolean;
  pod_fallback_noask: boolean;
  show_mask_overlay: boolean;
  hd_no_legacy_siblings: boolean;
  texture_filter: string;
  /** The patterns file the Patterns window works on (TXP_file), by name in jstraxx/patterns. */
  txp_file: string;
  /** The Patterns window's "Always load textures". */
  txp_autoload: boolean;
  /** Lighting dialog values (CTraxxReg::lighting). */
  lighting: { left: number; right: number; top: number; bottom: number };
  /** Random Terrain dialog values (CTraxxReg::autoterrain). */
  autoterrain: { left: number; right: number; top: number; bottom: number };
  randseed: number;
  /** Auto-save: enabled, period in minutes, and whether it writes TraxxAuto.txx (true) or overwrites the track. */
  autosave: { enabled: boolean; minutes: number; specialFile: boolean };
  edit: EditSettings;
  texture_zoom: number;
  texture_panew: number;
  models_listw: number;
  /** Floating windows (Textures, Models, Patterns, Transitions...), by id. */
  panels: Record<string, PanelRect>;
  /** Track Components, Object Properties and Paste Composite remember their size only. */
  dialog_sizes: Record<string, { w: number; h: number }>;
  texcut_format: number;
  /** Colours as "#rrggbb", indexed by the *_COL constants. */
  colors: string[];
  /** Which bars are shown (View menu). */
  bars: { toolbar: boolean; statusbar: boolean; viewcontrol: boolean; editcontrol: boolean; editmode: boolean; windows: boolean };
  /** Mount order of the archives in jstraxx/library, by file name. Unlisted archives follow, by name. */
  library_order: string[];
  /** Archives in the library that are not mounted. */
  library_disabled: string[];
  /** Most recently used projects, newest first (Traxx's MRU list). */
  recent: string[];
  /** The edit mode at last exit. */
  mode: EditMode;
}

export const DEFAULT_COLORS = ["#000000", "#008000", "#c0c0c0", "#ffffff", "#ffffff", "#ffff00", "#000000", "#ffffff"];

export function defaultSettings(): TraxxSettings {
  return {
    version: 1,
    gamma: 1.0,
    polysize: GRID_DEFAULT,
    always_course: false,
    always_objects: false,
    always_buildings: false,
    show_water: true,
    show_backdrop: true,
    show_whole_grid: false,
    display_fps: false,
    model_transparency: false,
    hide_colliders: false,
    water_opacity: WATER_OPACITY_DEFAULT,
    wire_diagonals: false,
    wire_width: 1,
    show_sit_units: false,
    pod_fallback_noask: false,
    show_mask_overlay: false,
    hd_no_legacy_siblings: false,
    texture_filter: "*",
    txp_file: "Patterns.txp",
    txp_autoload: false,
    lighting: { left: 0, right: 0, top: 237, bottom: 153 },
    autoterrain: { left: 100, right: 50, top: 20, bottom: 40 },
    randseed: 0,
    autosave: { enabled: false, minutes: 15, specialFile: true },
    edit: {
      wireframe: 2,
      tool: 0,
      orientation: 0,
      curvature: 3,
      altitude: 32,
      terrainw: 5,
      terrainh: 5,
      paint: true,
      texturew: 1,
      textureh: 1,
    },
    texture_zoom: 0,
    texture_panew: 0,
    models_listw: 0,
    panels: {},
    dialog_sizes: {},
    texcut_format: 0,
    colors: [...DEFAULT_COLORS],
    bars: { toolbar: true, statusbar: true, viewcontrol: true, editcontrol: true, editmode: true, windows: true },
    library_order: [],
    library_disabled: [],
    recent: [],
    mode: EDIT_TERRAIN,
  };
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/*
  Settings read from storage, laid over the defaults: unknown keys are dropped, missing ones
  take the default, and numbers are held to the ranges Traxx's controls allow, so a damaged
  file can never put the editor in a state Traxx could not reach.
*/
export function mergeSettings(stored: unknown): TraxxSettings {
  const d = defaultSettings();
  if (!stored || typeof stored !== "object") return d;
  const s = stored as Record<string, any>;
  const out: TraxxSettings = { ...d };
  for (const key of Object.keys(d) as (keyof TraxxSettings)[]) {
    const value = s[key];
    if (value === undefined) continue;
    const def = d[key];
    if (typeof def === "boolean" && typeof value === "boolean") (out as any)[key] = value;
    else if (typeof def === "string" && typeof value === "string") (out as any)[key] = value;
    else if (typeof def === "number" && typeof value === "number" && Number.isFinite(value)) (out as any)[key] = value;
  }
  out.version = 1;
  // Ranges from the controls: gamma slider 5..20 tenths, grid slider 16..256 in steps of 8.
  out.gamma = clamp(s.gamma, 0.5, 2.0, d.gamma);
  out.polysize = Math.round(clamp(s.polysize, GRID_MIN, GRID_MAX, d.polysize) / GRID_STEP) * GRID_STEP;
  out.water_opacity = Math.round(clamp(s.water_opacity, 0, 100, d.water_opacity));
  out.wire_width = Math.round(clamp(s.wire_width, 1, 4, d.wire_width));
  out.mode = Math.round(clamp(s.mode, 0, 4, d.mode)) as EditMode;
  const e = s.edit ?? {};
  out.edit = {
    wireframe: Math.round(clamp(e.wireframe, 0, 2, d.edit.wireframe)) as 0 | 1 | 2,
    tool: Math.round(clamp(e.tool, 0, 7, d.edit.tool)),
    orientation: Math.round(clamp(e.orientation, 0, 7, d.edit.orientation)),
    curvature: Math.round(clamp(e.curvature, 0, 6, d.edit.curvature)),
    altitude: Math.round(clamp(e.altitude, -255, 255, d.edit.altitude)),
    terrainw: Math.round(clamp(e.terrainw, 1, 25, d.edit.terrainw)),
    terrainh: Math.round(clamp(e.terrainh, 1, 25, d.edit.terrainh)),
    paint: typeof e.paint === "boolean" ? e.paint : d.edit.paint,
    texturew: Math.round(clamp(e.texturew, 1, 16, d.edit.texturew)),
    textureh: Math.round(clamp(e.textureh, 1, 16, d.edit.textureh)),
  };
  const rect4 = (v: any, def: TraxxSettings["lighting"]) => ({
    left: clamp(v?.left, -1e9, 1e9, def.left), right: clamp(v?.right, -1e9, 1e9, def.right),
    top: clamp(v?.top, -1e9, 1e9, def.top), bottom: clamp(v?.bottom, -1e9, 1e9, def.bottom),
  });
  out.lighting = rect4(s.lighting, d.lighting);
  out.autoterrain = rect4(s.autoterrain, d.autoterrain);
  const a = s.autosave ?? {};
  out.autosave = {
    enabled: typeof a.enabled === "boolean" ? a.enabled : d.autosave.enabled,
    minutes: Math.round(clamp(a.minutes, 1, 999, d.autosave.minutes)),
    specialFile: typeof a.specialFile === "boolean" ? a.specialFile : d.autosave.specialFile,
  };
  out.colors = d.colors.map((c, i) => (typeof s.colors?.[i] === "string" && /^#[0-9a-f]{6}$/i.test(s.colors[i]) ? s.colors[i].toLowerCase() : c));
  const b = s.bars ?? {};
  out.bars = { ...d.bars };
  for (const k of Object.keys(d.bars) as (keyof TraxxSettings["bars"])[]) if (typeof b[k] === "boolean") out.bars[k] = b[k];
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  out.library_order = strings(s.library_order);
  out.library_disabled = strings(s.library_disabled);
  out.recent = strings(s.recent).slice(0, 4);
  out.panels = {};
  for (const [id, r] of Object.entries((s.panels ?? {}) as Record<string, any>)) {
    if ([r?.x, r?.y, r?.w, r?.h].every((n) => typeof n === "number" && Number.isFinite(n))) {
      out.panels[id] = { x: r.x, y: r.y, w: r.w, h: r.h, open: Boolean(r.open) };
    }
  }
  out.dialog_sizes = {};
  for (const [id, r] of Object.entries((s.dialog_sizes ?? {}) as Record<string, any>)) {
    if (typeof r?.w === "number" && typeof r?.h === "number") out.dialog_sizes[id] = { w: r.w, h: r.h };
  }
  return out;
}

/** The default altitude the Altitude spin takes when a tool is picked (CTraxxFrame::OnCreate). */
export function defaultAltitudeForTool(tool: number): number {
  return tool === 6 ? 100 : tool === 7 ? 1 : 32;
}

/** Archives in mount order: the stored order first, then the rest by name. */
export function orderLibrary(names: readonly string[], order: readonly string[]): string[] {
  const present = new Set(names);
  const first = order.filter((n) => present.has(n));
  const listed = new Set(first);
  return [...first, ...names.filter((n) => !listed.has(n)).sort((a, b) => a.localeCompare(b))];
}
