/*
  The editor's settings. Traxx keeps these in the registry (CTraxxReg, Traxx/Traxx.h); the
  defaults below are CTraxxReg::CTraxxReg (Traxx/Traxx.cpp). JSTraxx stores them as JSON in
  OPFS (jstraxx/settings.json).

  Left out, because a browser has no use for them: the folder paths (ART, MODELS, POD, SIT,
  SOUND, BITMAPS; their place is taken by the library mount order and projects), the
  software-renderer switch and vsync, and the registration name and key.
*/

/** The edit modes, numbered as Traxx's EDIT_* values (Traxx/Traxx.h); Traxx 1.8.2 adds EDIT_WALLS. */
export const EDIT_TERRAIN = 0;
export const EDIT_TEXTURES = 1;
export const EDIT_COURSE = 2;
export const EDIT_OBJECTS = 3;
export const EDIT_BUILDINGS = 4;
/** Traxx 1.8.2 (TraxxFrame.cpp OnEditmodeWalls): editmode 5, on a new-style drag or Parallel track only. */
export const EDIT_WALLS = 5;
export type EditMode = 0 | 1 | 2 | 3 | 4 | 5;

/** View grid size, in cells (TRAXX_GRID_* in Traxx/Traxx.h). */
export const GRID_DEFAULT = 64;
export const GRID_MIN = 16;
export const GRID_MAX = 256;
export const GRID_STEP = 8;

/** The View Controls grid radios (Traxx 1.8.2, IDC_GRIDMODE_SLIDER .. IDC_GRIDMODE_WORLD). */
export const GRID_MODE_SLIDER = 0;
export const GRID_MODE_256 = 1;
export const GRID_MODE_WORLD = 2;

/**
  Traxx.h CTraxxReg::EffectiveGridMode: on a 256 world 256 x 256 and Whole world are the same
  window, so a stored 1 is drawn, and shown, as 2 there.
*/
export function effectiveGridMode(gridMode: number, worldn: number): number {
  return gridMode === GRID_MODE_256 && worldn <= 256 ? GRID_MODE_WORLD : gridMode;
}

/** Traxx.h CTraxxReg::WantedGridSize (the OpenGL branch): the grid size the view is given for a world of worldn cells. */
export function wantedGridSize(s: { grid_mode: number; polysize: number }, worldn: number): number {
  const mode = effectiveGridMode(s.grid_mode, worldn);
  if (mode === GRID_MODE_256) return 256;
  if (mode === GRID_MODE_WORLD) return worldn;
  return s.polysize;
}

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
  /**
    Traxx 1.8.2 (7469220, CTraxxReg grid_mode, registry "Grid Mode"): the View Controls render size,
    GRID_MODE_SLIDER (the Grid size slider), GRID_MODE_256 (256 x 256) or GRID_MODE_WORLD (Whole
    world). When absent it comes from the old Whole Grid setting (show_whole_grid true = Whole
    world), as Traxx takes it from the old Flags bit 0x400.
  */
  grid_mode: number;
  display_fps: boolean;
  model_transparency: boolean;
  hide_colliders: boolean;
  water_opacity: number;
  /**
    Options > Advanced "Traditional Traxx clicking (pick the nearest object base)" (Traxx 1.8.2,
    2031ec1, CTraxxReg traditional_clicking, registry "Traditional Clicking"): Objects mode picks
    the nearest object base instead of the projected outline. Off by default.
  */
  traditional_clicking: boolean;
  /** Wire Frame: also draw each cell's diagonal (Traxx draws the cell edges only). */
  wire_diagonals: boolean;
  /** Wire Frame: line width in screen pixels, 1..4 (Traxx: about 1). */
  wire_width: number;
  show_sit_units: boolean;
  pod_fallback_noask: boolean;
  show_mask_overlay: boolean;
  /** View > Vegetation (CTraxxReg show_vegetation, show_grass, show_veg_mask, show_veg_aids, show_lake_walls). */
  show_vegetation: boolean;
  show_grass: boolean;
  show_veg_mask: boolean;
  show_veg_aids: boolean;
  show_lake_walls: boolean;
  /** View > Show Sun (Traxx 1.7.2, CTraxxReg show_sun): the sun marker in the 3D view, on by default. */
  show_sun: boolean;
  /**
    Traxx 1.8.0 (CTraxxReg, "Flags" bits and "Preview Weather"): View > Visual Helpers > Show Sky,
    Show Light Glows, Show Detail Maps (on), Show Water Mask and Draw All Fog Volumes (off); View >
    Light Guide > Show Core and Extent (off); View > Preview Weather, the engine weather 0..8
    (0 Clear, the default).
  */
  show_sky: boolean;
  show_light_glows: boolean;
  /** Traxx 1.8.2 View > Visual Helpers > Show Walls (CTraxxReg show_walls, "Show Walls"): on by default. */
  show_walls: boolean;
  show_detail_maps: boolean;
  show_water_mask: boolean;
  draw_all_fog: boolean;
  show_light_core: boolean;
  preview_weather: number;
  /**
    View > Field of View (Traxx 1.7.3, registry "OpenGL FOV"): degrees across the window's longer
    side, 50, 60, 70, 80 or 90; 0 is Legacy. Default 70.
  */
  opengl_fov: number;
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
    grid_mode: 0,
    display_fps: false,
    model_transparency: false,
    hide_colliders: false,
    water_opacity: WATER_OPACITY_DEFAULT,
    traditional_clicking: false,
    wire_diagonals: false,
    wire_width: 1,
    show_sit_units: false,
    pod_fallback_noask: false,
    show_mask_overlay: false,
    // Traxx.cpp: trees on, the rest off.
    show_vegetation: true,
    show_grass: false,
    show_veg_mask: false,
    show_veg_aids: false,
    show_lake_walls: false,
    show_sun: true,
    show_sky: true,
    show_light_glows: true,
    show_walls: true,
    show_detail_maps: true,
    show_water_mask: false,
    draw_all_fog: false,
    show_light_core: false,
    preview_weather: 0,
    opengl_fov: 70,
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
/** View > Field of View's choices; 0 is Legacy. */
export const FOV_CHOICES: readonly number[] = [50, 60, 70, 80, 90, 0];

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
  // CTraxxReg::Load: "Grid Mode" 0..2, else from the old Whole Grid flag.
  out.grid_mode = typeof s.grid_mode === "number" && Number.isInteger(s.grid_mode) && s.grid_mode >= 0 && s.grid_mode <= 2
    ? s.grid_mode : s.show_whole_grid === true ? GRID_MODE_WORLD : GRID_MODE_SLIDER;
  out.wire_width = Math.round(clamp(s.wire_width, 1, 4, d.wire_width));
  // CTraxxReg::Load: anything but 0 (Legacy), 50, 60, 70, 80 or 90 is 70.
  if (!FOV_CHOICES.includes(out.opengl_fov)) out.opengl_fov = d.opengl_fov;
  // CTraxxReg::Load: a Preview Weather outside 0..8 is 0 (Clear).
  if (!Number.isInteger(out.preview_weather) || out.preview_weather < 0 || out.preview_weather > 8) out.preview_weather = 0;
  out.mode = Math.round(clamp(s.mode, 0, 5, d.mode)) as EditMode;
  const e = s.edit ?? {};
  out.edit = {
    wireframe: Math.round(clamp(e.wireframe, 0, 2, d.edit.wireframe)) as 0 | 1 | 2,
    tool: Math.round(clamp(e.tool, 0, 7, d.edit.tool)),
    orientation: Math.round(clamp(e.orientation, 0, 7, d.edit.orientation)),
    curvature: Math.round(clamp(e.curvature, 0, 6, d.edit.curvature)),
    // Traxx 1.7: decimal steps on 16-bit tracks (kept in v, so a multiple of 1/256), and the
    // brush up to 100 8 ft points on a Full Map (the edit bar clamps to 25 elsewhere). Traxx origin/main: a
    // v6 track's Altitude runs to its height limit, 8,192 ft (4,096 steps) on Tall Heights; the edit bar
    // brings it back inside 255 steps on another track (FollowAmplitudeKind).
    altitude: Math.round(clamp(e.altitude, -4096, 4096, d.edit.altitude) * 256) / 256,
    terrainw: Math.round(clamp(e.terrainw, 1, 100, d.edit.terrainw)),
    terrainh: Math.round(clamp(e.terrainh, 1, 100, d.edit.terrainh)),
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
