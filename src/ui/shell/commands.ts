/*
  Commands: everything a menu item, toolbar button or shortcut can do, by Traxx's command id.

  The prompt and tooltip text come from Traxx's string table (Traxx/Traxx.rc): the part before
  "\n" is the status bar prompt, the part after is the tooltip. A command with no `run` yet is
  shown greyed out, so the menus already list everything Traxx has.
*/
import type { AppState } from "../../app/state.ts";

export interface Command {
  id: string;
  label: string;
  /** Status bar prompt shown while the item is hovered. */
  prompt?: string;
  /** Toolbar tooltip. */
  tip?: string;
  /** Shortcut as shown in menus ("Ctrl+S"). */
  shortcut?: string;
  run?: () => unknown;
  enabled?: () => boolean;
  checked?: () => boolean;
}

export class CommandRegistry {
  private map = new Map<string, Command>();
  private app: AppState;

  constructor(app: AppState) {
    this.app = app;
  }

  register(command: Command): void {
    this.map.set(command.id, { ...this.map.get(command.id), ...command });
  }

  /** Attach behaviour to a command defined earlier. */
  bind(id: string, run: Command["run"], extra: Partial<Command> = {}): void {
    const c = this.map.get(id);
    if (!c) throw new Error(`Unknown command ${id}`);
    Object.assign(c, extra, { run });
    this.app.emit("commands", undefined);
  }

  get(id: string): Command | undefined {
    return this.map.get(id);
  }

  isEnabled(id: string): boolean {
    const c = this.map.get(id);
    return Boolean(c?.run) && (c?.enabled?.() ?? true);
  }

  isChecked(id: string): boolean {
    return this.map.get(id)?.checked?.() ?? false;
  }

  async exec(id: string): Promise<void> {
    const c = this.map.get(id);
    if (!c?.run || !this.isEnabled(id)) return;
    try {
      await c.run();
    } catch (err) {
      console.error(err);
      this.app.status(err instanceof Error ? err.message : String(err));
    }
    this.app.emit("commands", undefined);
  }
}

/* Traxx's string table entries, as [id, label, prompt, tip, shortcut]. */
const TABLE: [string, string, string?, string?, string?][] = [
  // File
  ["ID_FILE_NEW", "Classic 8-bit", "Create a track for MTM2", "New MTM2", "Ctrl+N"],
  ["ID_FILE_NEW_CLASSIC16", "16-bit", "Create a track with 16-bit terrain heights", "New 16-bit"],
  ["ID_FILE_NEW_SPLINE", "16-bit Spline", "Create a track with a smoothed 16-bit terrain surface", "New 16-bit Spline"],
  ["ID_FILE_NEW_FINE", "16-bit Full Map", "Create a track with the 16-bit Full Map terrain grid", "New 16-bit Full Map"],
  // JSTraxx: track format version 6 (not in Traxx.rc).
  ["ID_FILE_NEW_WORLD", "World Size...", "Create a track with a 256-cell (8,192 ft) or 512-cell (16,384 ft, track format version 6) world"],
  ["ID_TERRAIN_IMPORTV6", "Import Heightmap (Version 6)...", "Replace the terrain heights from a 16-bit PNG or .RAW in feet, with any height range; the height step and base are picked automatically"],
  ["ID_TERRAIN_EXPORTV6", "Export Heightmap (Version 6)...", "Save the terrain heights as a 16-bit grayscale PNG or 16-bit .RAW at the track format version 6 height step and base"],
  ["ID_TERRAIN_IMPORTRAW", "&Import Heightmap (.RAW/.PNG/.TGA)...", "Replace the terrain heights from a heightmap: 16-bit or 8-bit .RAW, or a grayscale PNG or TGA"],
  ["ID_TERRAIN_EXPORTRAW", "&Export Heightmap...", "Save the terrain heights as a grayscale PNG (16-bit or 8-bit) or a heightmap .RAW file (16-bit files are little-endian)"],
  ["ID_TERRAIN_GRID_CLASSIC8", "Classic 8-bit", "Convert the terrain to the Classic 8-bit grid (2 ft height steps, 32 ft triangles)"],
  ["ID_TERRAIN_GRID_CLASSIC16", "16-bit", "Convert the terrain to 16-bit heights on the 32 ft triangle grid"],
  ["ID_TERRAIN_GRID_SPLINE", "16-bit Spline", "Convert the terrain to 16-bit heights with a smoothed surface"],
  ["ID_TERRAIN_GRID_FINE", "16-bit Full Map", "Convert the terrain to the 16-bit Full Map 8 ft grid"],
  ["ID_TERRAIN_SMOOTHFINE", "Smooth Full Map from 32 ft grid...", "Rebuild every 8 ft point from the 32 ft points with the game's spline"],
  ["ID_TERRAIN_HEIGHTSPNG", "Store heights as PNG", "Write POD stores this track's heights as a grayscale PNG (16-bit, or 8-bit on Classic 8-bit)."],
  ["ID_EDIT_VEGETATION", "&Vegetation...", "Author trees and grass from painted masks", "Vegetation"],
  ["ID_VIEW_VEGETATION", "Show &Vegetation", "Show or hide the trees in the OpenGL view", "Show Vegetation"],
  ["ID_VIEW_GRASS", "Show &Grass", "Show or hide the grass near the camera in the OpenGL view", "Show Grass"],
  ["ID_VIEW_VEGMASK", "Vegetation &Mask Wash", "Wash the ground with the painted vegetation masks", "Vegetation Mask Wash"],
  ["ID_VIEW_VEGAIDS", "Vegetation &Aids", "Show trunk collision cylinders and the AI corridor", "Vegetation Aids"],
  ["ID_VIEW_SUN", "Show &Sun", "Show the sun as the game draws it (large disc) and the light/shadow direction (small ring)", "Show Sun"],
  // Traxx 1.8.0: View > Visual Helpers, Light Guide and Preview Weather (Traxx.rc's string table).
  ["ID_VIEW_SKY", "Show S&ky", "Show or hide the game's own sky in the 3D view (art from the Game Library)", "Show Sky"],
  ["ID_VIEW_LIGHTGLOWS", "Show Light G&lows", "Show or hide every light's glow and cone as the game draws them (art from the Game Library)", "Show Light Glows"],
  ["ID_VIEW_DETAILMAPS", "Show Detail M&aps", "Shade ground, water and lakes as the game shades the track's own detail maps (needs its _MASK / _WMSK). Drawn lit from the .LTE, so darker than the unlit view; smooth terrain unshadowed; terrDetail 10, terrDetailRep 64", "Show Detail Maps"],
  ["ID_VIEW_DETAILMASK", "Show &Detail Strength", "Wash the ground with the detail strength the painted terrain mask gives (per texel)", "Show Detail Strength"],
  ["ID_VIEW_WATERMASK", "Show &Water Mask", "Show or hide the water detail mask (_WMSK) as an orange tint over the ground in the 3D view", "Show Water Mask"],
  ["ID_VIEW_DRAWALLFOG", "Draw All &Fog Volumes", "Draw every fog and mist volume instead of the nearest 16 the game draws (may be slower)", "Draw All Fog Volumes"],
  ["ID_VIEW_LIGHTCORE", "Show &Core and Extent", "Show or hide the light guide: the exact saturated core ring and the vertical extent of the selected light", "Show Light Core and Extent"],
  ["ID_VIEW_PW_CLEAR", "&Clear", "Preview the track as it looks in Clear (fog colour, light pools)", "Preview Weather: Clear"],
  ["ID_VIEW_PW_CLOUDY", "C&loudy", "Preview the track as it looks in Cloudy (fog colour, light pools)", "Preview Weather: Cloudy"],
  ["ID_VIEW_PW_FOGGY", "&Foggy", "Preview the track as it looks in Foggy (fog colour, light pools)", "Preview Weather: Foggy"],
  ["ID_VIEW_PW_DENSEFOG", "&Dense fog", "Preview the track as it looks in Dense fog (fog colour, light pools)", "Preview Weather: Dense fog"],
  ["ID_VIEW_PW_RAIN", "&Rain", "Preview the track as it looks in Rain (fog colour, light pools)", "Preview Weather: Rain"],
  ["ID_VIEW_PW_SNOW", "&Snow", "Preview the track as it looks in Snow (fog colour, light pools)", "Preview Weather: Snow"],
  ["ID_VIEW_PW_DUSK", "D&usk", "Preview the track as it looks in Dusk (fog colour, light pools)", "Preview Weather: Dusk"],
  ["ID_VIEW_PW_NIGHT", "&Night", "Preview the track as it looks in Night (fog colour, light pools)", "Preview Weather: Night"],
  ["ID_VIEW_PW_PITCHBLACK", "&Pitch black", "Preview the track as it looks in Pitch black (fog colour, light pools)", "Preview Weather: Pitch black"],
  ["ID_VIEW_FOV_50", "&50 degrees", "Field of view across the window's longer side", "50 degrees"],
  ["ID_VIEW_FOV_60", "&60 degrees", "Field of view across the window's longer side", "60 degrees"],
  ["ID_VIEW_FOV_70", "&70 degrees", "Field of view across the window's longer side (the default)", "70 degrees"],
  ["ID_VIEW_FOV_80", "&80 degrees", "Field of view across the window's longer side", "80 degrees"],
  ["ID_VIEW_FOV_90", "&90 degrees", "Field of view across the window's longer side", "90 degrees"],
  ["ID_VIEW_FOV_LEGACY", "&Legacy (57.5 degrees tall)", "JSTraxx 1.0's fixed field of view: the angle Traxx's old 512 px focal gives in a 640 x 480 window", "Legacy field of view"],
  ["ID_VIEW_LAKEWALLS", "Show &Lake Walls", "Show the wall edges round each lake (at the waterline) in the OpenGL view", "Show Lake Walls"],
  ["ID_FILE_OPEN", "&Open...", "Open an existing Track", "Open", "Ctrl+O"],
  ["ID_FILE_SAVE", "&Save", "Save the active Track", "Save", "Ctrl+S"],
  ["ID_FILE_SAVE_AS", "Save &As...", "Save the active Track with a new name", "Save As"],
  ["ID_FILE_CLONE", "&Clone TrackEd Track...", "Edit track from TrackEd components", "Clone old track"],
  ["ID_FILE_VIEWPOD", "&View POD file...", "Load an existing POD file (view only)", "View POD"],
  ["ID_FILE_IMPORT", "&Import Viewed POD as Track...", "Extract the viewed POD's art and models and save it as a track you can edit", "Import as Track"],
  ["ID_FILE_DOWNLOAD", "&Download .TXX...", "Save a copy of the track's .TXX file to your computer", "Download .TXX"],
  ["ID_FILE_WRITEPOD", "&Write POD File...", "Write the track to POD file.", "Write POD", "Ctrl+W"],
  // Print becomes an image of the view: a browser prints pages, not a 3D view.
  ["ID_FILE_PRINT", "Save View as &Image...", "Save the current view as a PNG image", "Save View as Image", "Ctrl+P"],
  ["ID_FILE_CLOSE", "&Close Track", "Close the active track", "Close"],
  // Edit
  ["ID_EDIT_UNDO", "&Undo", "Undo the last action", "Undo", "Ctrl+Z"],
  ["ID_EDIT_REDO", "&Redo", "Redo the previously undone action", "Redo", "Ctrl+Y"],
  ["ID_EDIT_COPY", "&Copy", "Copy the selected object", "Copy", "Ctrl+C"],
  ["ID_EDIT_PASTE", "&Paste", "Paste object", "Paste", "Ctrl+V"],
  ["ID_EDIT_CUT", "Cu&t", "Cut the selection and put on Clipboard", "Cut", "Ctrl+X"],
  ["ID_VIEW_COMPONENTS", "Track C&omponents", "View/Edit miscellaneous track components", "Track Components"],
  ["ID_TERRAIN_COPYBITMAP", "Copy &Terrain as Bitmap", "Copy Terrain to Clipboard as Greyscale Bitmap"],
  ["ID_TERRAIN_PASTEBITMAP", "Paste Terrain &Bitmap", "Paste Terrain from Greyscale Bitmap on Clipboard"],
  ["ID_TERRAIN_RAISELOWER", "Adjust Terrain &Heights...", "Raise or lower the terrain"],
  ["ID_EDIT_EXTRACT", "E&xtract Models and Art", "Extracts Textures and Models into the project folders", "Extract Models/Art"],
  // Special
  ["ID_EDIT_WEATHERMASK", "&Weather Mask", "Set the Weather Mask", "Set the Weather Mask (MTM2 only)"],
  ["ID_EDIT_GENTERRAIN", "&Random Terrain", "Generate Random Terrain", "Random Terrain"],
  ["ID_EDIT_LIGHTING", "&Lighting", "Set the Ambient/Specular Lighting", "Set Lighting"],
  ["ID_EDIT_TRANSITIONS", "&Texture Transitions", "Paint transitions between textures"],
  ["ID_EDIT_PALETTE", "&Palette", "Set the track Palette", "Set Palette"],
  // View
  ["ID_VIEW_TOOLBAR", "&Tool Bar", "Show or hide the main toolbar", "Toggle ToolBar"],
  ["ID_VIEW_STATUS_BAR", "&Status Bar", "Show or hide the status bar", "Toggle StatusBar"],
  ["ID_VIEW_VIEWCONTROL", "&View Control Bar", "Show or hide the view control bar", "Toggle View Control Bar"],
  ["ID_VIEW_EDITCONTROL", "&Edit Tools Bar", "Show or hide the edit tools box", "Toggle Edit Tools"],
  ["ID_VIEW_TEXTURES", "Te&xtures", "Show or hide the Textures box", "Toggle Textures Box"],
  ["ID_VIEW_PATTERNS", "&Patterns", "Show or hide the Patterns box", "Toggle Patterns Box"],
  ["ID_VIEW_OBJECTS", "&Models", "Show or hide the Models box", "Toggle Models Box"],
  ["ID_VIEW_OPTIONS", "&Options", "Configure general options for the program", "Program Options"],
  ["ID_VIEW_STATS", "Statisti&cs", "Display track statistics"],
  ["ID_VIEW_LIBRARY", "Game &Library...", "Add, order and remove the game PODs JSTraxx reads art and models from", "Game Library"],
  // Navigation
  ["ID_FUNCTION_2", "&Save Location", "Save current location", undefined, "F2"],
  ["ID_FUNCTION_3", "&Return to Location", "Return to previously saved location", undefined, "F3"],
  ["ID_FUNCTION_4", "&Lock View Altitude", "Keep same height above ground while moving", undefined, "F4"],
  ["ID_FUNCTION_5", "Always Show &Course", "Show the course in every edit mode", undefined, "F5"],
  ["ID_FUNCTION_6", "Always Show &Objects", "Show the objects in every edit mode", undefined, "F6"],
  ["ID_FUNCTION_7", "Always Show &Ground Boxes", "Show the ground boxes in every edit mode", undefined, "F7"],
  ["ID_FUNCTION_8", "Show &Water", "Show or hide the water", undefined, "F8"],
  ["ID_FUNCTION_9", "Show &Backdrop", "Show or hide the backdrop", undefined, "F9"],
  // Help
  ["ID_HELP_CONTENTS", "&Contents", "Open the Traxx help"],
  ["ID_HELP_KEYBOARD", "&Keyboard Summary", "List every key and mouse action"],
  ["ID_APP_ABOUT", "&About JSTraxx...", "Display program information, version number and copyright", "About"],
  // Edit modes
  ["ID_EDITMODE_TERRAIN", "Terrain", "Edit the World Terrain", "Edit Terrain"],
  ["ID_EDITMODE_TEXTURES", "Textures", "Edit the Textures on the terrain surface", "Edit Textures"],
  ["ID_EDITMODE_COURSE", "Course", "Edit the Course segments", "Edit Course"],
  ["ID_EDITMODE_OBJECTS", "Objects", "Edit the Scenery Objects", "Edit Objects"],
  ["ID_EDITMODE_BUILDINGS", "Ground Boxes", "Edit Ground Boxes", "Edit Ground Boxes"],
  // Textures window toolbar
  ["ID_TEXTURE_OPEN", "Load Texture", "Load Texture", "Load Texture"],
  ["ID_TEXTURE_CUT", "Cut", "Cut", "Cut"],
  ["ID_TEXTURE_COPY", "Copy", "Copy", "Copy"],
  ["ID_TEXTURE_PASTE", "Paste Texture", "Paste Texture", "Paste Texture"],
  ["ID_TEXTURE_PASTEX", "Paste Composite", "Paste Composite", "Paste Composite"],
  ["ID_TEXTURE_ANIMATE", "Animate...", "Animate", "Animate"],
  ["ID_TEXTURE_PURGE", "Purge Unused...", "Purge Unused Textures", "Purge Unused Textures"],
  ["ID_TEXTURE_ZOOMOUT", "Smaller Textures", "Smaller Textures", "Smaller Textures"],
  ["ID_TEXTURE_ZOOMRESET", "Default Texture Size", "Default Texture Size", "Default Texture Size"],
  ["ID_TEXTURE_ZOOMIN", "Larger Textures", "Larger Textures", "Larger Textures"],
  // Models window toolbar
  ["ID_OBJECT_OPEN", "Load Model", "Load Model", "Load Model"],
  ["ID_OBJECT_CUT", "Cut Model", "Cut Model", "Cut Model"],
  ["ID_OBJECT_CUTEX", "Cut Model + Objects", "Cut Model + Objects", "Cut Model + Objects"],
  ["ID_OBJECT_PURGE", "Purge Unused Models", "Purge Unused Models", "Purge Unused Models"],
  // Patterns window toolbar
  ["ID_PATTERN_FILE", "Select TXP File", "Select TXP File", "Select TXP File"],
  ["ID_PATTERN_CUT", "Cut", "Cut", "Cut"],
  ["ID_PATTERN_COPY", "Copy", "Copy", "Copy"],
  ["ID_PATTERN_PASTE", "Paste", "Paste", "Paste"],
  // Context menus (IDR_CONTEXT_MENU)
  ["ID_TEXTURE_ROTATE90", "Rotate 90\u00b0", "Rotate the selected cell's texture 90 degrees", undefined, "Ctrl+R"],
  ["ID_TEXTURE_MIRROR", "Mirror", "Mirror the selected cell's texture", undefined, "Ctrl+M"],
  ["ID_TEXTURE_AREAROT90", "Rotate Area 90\u00b0", "Rotate the selected area 90 degrees", undefined, "R"],
  ["ID_TEXTURE_AREAMIRROR", "Mirror Area", "Mirror the selected area", undefined, "M"],
  ["ID_TEXTURE_AREACOPY", "Copy Area", "Copy the selected area's textures"],
  ["ID_TEXTURE_AREAPASTE", "Paste Area", "Paste the copied area or pattern", undefined, "Ctrl+V"],
  ["ID_TEXTURE_SELECT", "Select", "Select the texture under the pointer in the Textures box"],
  ["ID_TEXTURE_FLOOD", "Replace", "Replace this texture everywhere on the map"],
  ["ID_TEXTURE_DISPLAYBOX", "Display Textures Box", "Show the Textures box"],
  ["ID_PATTERN_DISPLAYBOX", "Display Patterns Box", "Show the Patterns box"],
  ["ID_COURSE_INSERTSEGMENT", "Insert Segment", "Insert a course segment"],
  ["ID_COURSE_DELETESEGMENT", "Delete Segment", "Delete the course segment"],
  ["ID_COURSE_REVERSE", "Reverse", "Reverse the course's direction"],
  ["ID_COURSE_SPEEDLIMIT", "Speed Limit", "Set the segment's speed limit"],
  ["ID_COURSE_GENERATE", "Generate from Main", "Make this course from the main one"],
  ["ID_COURSE_DELALLSEGMENTS", "Delete All Segments", "Delete every segment of this course"],
  ["ID_OBJECT_INSERT", "Insert", "Insert an object here"],
  ["ID_OBJECT_DELETE", "Delete", "Delete the selected objects"],
  ["ID_OBJECT_PROPERTIES", "Properties", "Edit the selected object", undefined, "Enter"],
  ["ID_OBJECT_GROUPPROPERTIES", "Group &Properties..."],
  ["ID_OBJECT_COPY", "Copy Object", "Copy the selected object"],
  ["ID_OBJECT_PASTE", "Paste Object", "Paste the copied object here", undefined, "Ctrl+V"],
  ["ID_OBJECT_DISPLAYBOX", "Display Models Box", "Show the Models box"],
  ["ID_BITMAP_COPY", "Copy", "Copy the picture"],
  ["ID_BITMAP_PASTE", "Paste", "Paste a picture"],
  ["ID_BITMAP_LOAD", "Load...", "Load a picture"],
  ["ID_BITMAP_STOCK", "Stock...", "Use a stock picture"],
  ["ID_BITMAP_SAVEAS", "Save As...", "Save the picture"],
  ["ID_BITMAP_VIEW", "View", "View the picture"],
  ["ID_MUSIC_LOAD", "Load...", "Load the track's music"],
  ["ID_MUSIC_SAVEAS", "Save As...", "Save the track's music"],
  ["ID_MUSIC_PLAY", "Play", "Play the track's music"],
  ["ID_TERRAIN_COPY", "Copy Area", "Copy the terrain under the edit grid"],
  ["ID_TERRAIN_PASTE", "Paste Area", "Paste the copied terrain here", undefined, "Ctrl+V"],
  ["ID_BUILDING_INSERT", "Insert", "Insert a ground box here"],
  ["ID_BUILDING_DELETE", "Delete", "Delete the ground box"],
  ["ID_BUILDING_ROT90", "Rotate 90\u00b0", "Rotate the face's texture 90 degrees", undefined, "R"],
  ["ID_BUILDING_MIRROR", "Mirror", "Mirror the face's texture", undefined, "M"],
  ["ID_BUILDING_CUT", "Cut Box", "Cut the ground box"],
  ["ID_BUILDING_COPY", "Copy Box", "Copy the ground box"],
  ["ID_BUILDING_PASTE", "Paste Box", "Paste the copied ground box here", undefined, "Ctrl+V"],
  ["ID_BACKDROP_LOAD", "Load", "Load a backdrop model"],
  ["ID_BACKDROP_ARENA", "Arena Settings", "Set the arena's placement"],
  ["ID_TRUCK_REVERSE", "Reverse", "Turn the truck around"],
  ["ID_TRUCK_PROPERTIES", "Properties", "Edit the truck's start"],
  ["ID_TFOLDER_DELETE", "Delete", "Delete Texture"],
  ["ID_TFOLDER_RENAME", "Rename", "Rename the texture file"],
  // Palette dialog toolbar
  ["ID_PALETTE_NEW", "Create Optimized Palette", "Create Optimized Palette", "Create Optimized Palette"],
  ["ID_PALETTE_OPEN", "Load Palette File", "Load Palette File", "Load Palette File"],
  ["ID_PALETTE_SAVE", "Save Palette to File", "Save Palette to File", "Save Palette to File"],
];

export function registerTraxxCommands(registry: CommandRegistry): void {
  for (const [id, label, prompt, tip, shortcut] of TABLE) registry.register({ id, label, prompt, tip: tip ?? prompt, shortcut });
}

/*
  The main menu (IDR_MAINFRAME MENU in Traxx/Traxx.rc). Print Preview, Print Setup, Exit and
  New (MTM1) are left out: JSTraxx is MTM2 only and a browser tab has no exit. "-" is a
  separator; "@recent" is the recent-tracks list. Close, Import Viewed POD, Download .TXX,
  Redo, Cut, F5..F9 and Game Library are JSTraxx additions.
*/
export type MenuItem = string | { label: string; items: MenuItem[] } | { id: string; label: string };
export const MAIN_MENU: { label: string; items: MenuItem[] }[] = [
  { label: "&File", items: [{ label: "&New", items: ["ID_FILE_NEW", "ID_FILE_NEW_CLASSIC16", "ID_FILE_NEW_SPLINE", "ID_FILE_NEW_FINE", "-", "ID_FILE_NEW_WORLD"] }, "ID_FILE_OPEN", "ID_FILE_SAVE", "ID_FILE_SAVE_AS", "ID_FILE_CLOSE", "-", "ID_FILE_CLONE", "ID_FILE_VIEWPOD", "ID_FILE_IMPORT", "ID_FILE_WRITEPOD", "-", "ID_FILE_DOWNLOAD", "ID_FILE_PRINT", "-", "@recent"] },
  { label: "&Edit", items: ["ID_EDIT_UNDO", "ID_EDIT_REDO", "-", "ID_EDIT_CUT", "ID_EDIT_COPY", "ID_EDIT_PASTE", "-", "ID_VIEW_COMPONENTS", "-", "ID_TERRAIN_COPYBITMAP", "ID_TERRAIN_PASTEBITMAP", "ID_TERRAIN_IMPORTRAW", "ID_TERRAIN_EXPORTRAW", "ID_TERRAIN_IMPORTV6", "ID_TERRAIN_EXPORTV6", "ID_TERRAIN_RAISELOWER", "-", "ID_EDIT_EXTRACT"] },
  { label: "&Special", items: ["ID_EDIT_WEATHERMASK", "ID_EDIT_GENTERRAIN", "ID_EDIT_LIGHTING", "ID_EDIT_TRANSITIONS", "ID_EDIT_PALETTE", "ID_EDIT_VEGETATION", "-",
    { label: "Terrain &Grid", items: ["ID_TERRAIN_GRID_CLASSIC8", "ID_TERRAIN_GRID_CLASSIC16", "ID_TERRAIN_GRID_SPLINE", "ID_TERRAIN_GRID_FINE", "-", "ID_TERRAIN_SMOOTHFINE", "-", "ID_TERRAIN_HEIGHTSPNG"] }] },
  { label: "&View", items: ["ID_VIEW_TOOLBAR", "ID_VIEW_STATUS_BAR", "ID_VIEW_VIEWCONTROL", "ID_VIEW_EDITCONTROL", "-", "ID_VIEW_TEXTURES", "ID_VIEW_PATTERNS", "ID_VIEW_OBJECTS", "-", "ID_VIEW_OPTIONS", "ID_VIEW_LIBRARY", "ID_VIEW_STATS", "-",
    { label: "Ve&getation", items: ["ID_VIEW_VEGETATION", "ID_VIEW_GRASS", "ID_VIEW_VEGMASK", "ID_VIEW_VEGAIDS", "-", "ID_VIEW_LAKEWALLS"] },
    { label: "Visual &Helpers", items: ["ID_VIEW_SUN", "ID_VIEW_SKY", "ID_VIEW_LIGHTGLOWS", "ID_VIEW_DETAILMAPS", "ID_VIEW_DETAILMASK", "ID_VIEW_WATERMASK", "ID_VIEW_DRAWALLFOG"] },
    { label: "&Light Guide", items: ["ID_VIEW_LIGHTCORE"] },
    { label: "Preview &Weather", items: ["ID_VIEW_PW_CLEAR", "ID_VIEW_PW_CLOUDY", "ID_VIEW_PW_FOGGY", "ID_VIEW_PW_DENSEFOG", "ID_VIEW_PW_RAIN", "ID_VIEW_PW_SNOW", "ID_VIEW_PW_DUSK", "ID_VIEW_PW_NIGHT", "ID_VIEW_PW_PITCHBLACK"] },
    { label: "&Field of View", items: ["ID_VIEW_FOV_50", "ID_VIEW_FOV_60", "ID_VIEW_FOV_70", "ID_VIEW_FOV_80", "ID_VIEW_FOV_90", "-", "ID_VIEW_FOV_LEGACY"] }] },
  { label: "&Navigation", items: ["ID_FUNCTION_2", "ID_FUNCTION_3", "-", "ID_FUNCTION_4", "-", "ID_FUNCTION_5", "ID_FUNCTION_6", "ID_FUNCTION_7", "ID_FUNCTION_8", "ID_FUNCTION_9"] },
  { label: "&Help", items: ["ID_HELP_CONTENTS", "ID_HELP_KEYBOARD", "-", "ID_APP_ABOUT"] },
];

/*
  The right-click menus (IDR_CONTEXT_MENU in Traxx/Traxx.rc), by name. "@types" is the Set Type
  submenu, filled with the object types when it opens.
*/
export const CONTEXT_MENUS: Record<string, MenuItem[]> = {
  Texture: ["ID_TEXTURE_ROTATE90", "ID_TEXTURE_MIRROR", "-", "ID_TEXTURE_AREAROT90", "ID_TEXTURE_AREAMIRROR", "ID_TEXTURE_AREACOPY", "ID_TEXTURE_AREAPASTE", "-", "ID_TEXTURE_SELECT", "ID_TEXTURE_FLOOD", "-", "ID_TEXTURE_DISPLAYBOX", "ID_PATTERN_DISPLAYBOX"],
  Course: ["ID_COURSE_INSERTSEGMENT", "ID_COURSE_DELETESEGMENT", "ID_COURSE_REVERSE", "ID_COURSE_SPEEDLIMIT", "-", "ID_COURSE_GENERATE", "ID_COURSE_DELALLSEGMENTS"],
  Object: ["ID_OBJECT_INSERT", "ID_OBJECT_DELETE", "-", "ID_OBJECT_PROPERTIES", "ID_OBJECT_GROUPPROPERTIES", { label: "Set &Type", items: ["@types"] }, "-", "ID_OBJECT_COPY", "ID_OBJECT_PASTE", "-", "ID_OBJECT_DISPLAYBOX"],
  Bitmap: ["ID_BITMAP_COPY", "ID_BITMAP_PASTE", "-", "ID_BITMAP_LOAD", "ID_BITMAP_STOCK", "ID_BITMAP_SAVEAS", "-", "ID_BITMAP_VIEW"],
  Music: ["ID_MUSIC_LOAD", "ID_MUSIC_SAVEAS", "-", "ID_MUSIC_PLAY"],
  Terrain: ["ID_TERRAIN_COPY", "ID_TERRAIN_PASTE", "-", { id: "ID_TERRAIN_RAISELOWER", label: "Adjust Heights..." }, "-", { id: "ID_TERRAIN_COPYBITMAP", label: "Copy Terrain as Bitmap" }, { id: "ID_TERRAIN_PASTEBITMAP", label: "Paste Terrain Bitmap" }, { id: "ID_TERRAIN_IMPORTRAW", label: "Import Heightmap (.RAW/.PNG/.TGA)..." }, { id: "ID_TERRAIN_EXPORTRAW", label: "Export Heightmap..." }],
  Building: ["ID_BUILDING_INSERT", "ID_BUILDING_DELETE", "-", "ID_BUILDING_ROT90", "ID_BUILDING_MIRROR", "-", "ID_BUILDING_CUT", "ID_BUILDING_COPY", "ID_BUILDING_PASTE", "-", "ID_TEXTURE_DISPLAYBOX"],
  Backdrop: ["ID_BACKDROP_LOAD", "ID_BACKDROP_ARENA"],
  Truck: ["ID_TRUCK_REVERSE", "ID_TRUCK_PROPERTIES"],
  TextureEdit: [{ id: "ID_TEXTURE_CUT", label: "Cut" }, { id: "ID_TEXTURE_COPY", label: "Copy" }, "ID_TEXTURE_PASTE", "ID_TEXTURE_PASTEX", "-", "ID_TEXTURE_ANIMATE", "ID_TEXTURE_PURGE"],
  PatternEdit: ["ID_PATTERN_CUT", "ID_PATTERN_COPY", "ID_PATTERN_PASTE"],
  TextureFolder: ["ID_TFOLDER_DELETE", "ID_TFOLDER_RENAME"],
};

/*
  Accelerators (IDR_MAINFRAME ACCELERATORS), as "Ctrl+Z" style keys. Ctrl+Y and Ctrl+Shift+Z
  for Redo are additions. Browsers reserve Ctrl+N and Ctrl+W, so those two only reach the page
  when it runs as an installed app; the menu items work everywhere.
*/
export const ACCELERATORS: Record<string, string> = {
  "Ctrl+C": "ID_EDIT_COPY",
  "Ctrl+Insert": "ID_EDIT_COPY",
  "Ctrl+N": "ID_FILE_NEW",
  "Ctrl+O": "ID_FILE_OPEN",
  "Ctrl+P": "ID_FILE_PRINT",
  "Ctrl+S": "ID_FILE_SAVE",
  "Ctrl+V": "ID_EDIT_PASTE",
  "Shift+Insert": "ID_EDIT_PASTE",
  "Alt+Backspace": "ID_EDIT_UNDO",
  "Shift+Delete": "ID_EDIT_CUT",
  "Ctrl+X": "ID_EDIT_CUT",
  "Ctrl+W": "ID_FILE_WRITEPOD",
  "Ctrl+Z": "ID_EDIT_UNDO",
  "Ctrl+Y": "ID_EDIT_REDO",
  "Ctrl+Shift+Z": "ID_EDIT_REDO",
  F2: "ID_FUNCTION_2",
  F3: "ID_FUNCTION_3",
  F4: "ID_FUNCTION_4",
  F5: "ID_FUNCTION_5",
  F6: "ID_FUNCTION_6",
  F7: "ID_FUNCTION_7",
  F8: "ID_FUNCTION_8",
  F9: "ID_FUNCTION_9",
};

/** "Ctrl+Shift+Z" for a keyboard event; Cmd counts as Ctrl on macOS. */
export function keyName(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (e.code.startsWith("Key")) key = e.code.slice(3);
  parts.push(key);
  return parts.join("+");
}
