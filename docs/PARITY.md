# JSTraxx and Traxx: parity checklist

Every feature of Traxx 1.6.7 (`Traxx_OnGoing_Updates`), and where it stands in JSTraxx. The
status column is what the code does; the box is for checking it in a browser against Traxx.

Status: **Ported** works as in Traxx. **Changed** works, differently on purpose (the reason
is given). **Added** is not in Traxx. **Not ported** is left out, with the reason.

## File menu

| | Item | Status |
| --- | --- | --- |
| [ ] | New | Ported. The new track's values are the constructor's; MTM2 palette and pictures as LoadMTM2Palette. |
| [ ] | New (MTM1) | Not ported: JSTraxx is MTM2 only. |
| [ ] | Open... | Ported. Lists the `.TXX` files kept in the browser (`jstraxx/tracks`), or opens one from disk. |
| [ ] | Save, Save As... | Ported. Saves a `.TXX` (lowest TRAXXV version that holds the track) into the browser. |
| [ ] | Close | Added (a browser tab has no File > Exit). |
| [ ] | Clone TrackEd Track... | Ported. Pick the TrackEd folder (WORLD, LEVELS, DATA...). |
| [ ] | View POD file... | Ported, read-only; a POD with several tracks asks which (Select Track). |
| [ ] | Import Viewed POD as Track | Added: extracts the POD's art and models, then saves a `.TXX`. |
| [ ] | Write POD File... (Ctrl+W) | Ported: Incomplete Track, the fallback explanation, the omit option, then a save dialog or a download. |
| [ ] | Download Track (.TXX) | Added: the `.TXX` as a file. |
| [ ] | Print... (Ctrl+P) | Changed: saves the view as a PNG. Print Preview and Print Setup are not ported. |
| [ ] | Recent files | Ported. |
| [ ] | Exit | Not ported (close the tab). |

## Edit menu

| | Item | Status |
| --- | --- | --- |
| [ ] | Undo (Ctrl+Z, Alt+Backspace) | Changed: many levels, in every mode (Traxx: one level, terrain and textures). |
| [ ] | Redo (Ctrl+Y, Ctrl+Shift+Z) | Added. |
| [ ] | Copy, Paste (Ctrl+C, Ctrl+V) | Ported, per mode (terrain area, texture area or pattern, object, ground box). |
| [ ] | Track Components | Ported. |
| [ ] | Copy Terrain as Bitmap, Paste Terrain Bitmap | Ported (the system clipboard carries PNG). |
| [ ] | Adjust Terrain Heights... | Ported. |
| [ ] | Extract Models and Art | Ported: into the browser's ART and MODELS folders; an existing file is kept. |

## Special menu

| | Item | Status |
| --- | --- | --- |
| [ ] | Weather Mask | Ported (MTM2 tracks). |
| [ ] | Random Terrain | Ported: Classic and Fractal with MSVC's `rand()`, so a seed gives Traxx's terrain. |
| [ ] | Lighting | Ported: BuildLte, altitude bias, terrain and ground-box shadows, object shadows, the sun for the .LVL. |
| [ ] | Texture Transitions | Ported (the Auto Texture Transitions window). |
| [ ] | Palette | Ported: New (optimised palette), Open and Save `.PAL` / `.ACT`. The bottom ten system colours are Windows' static colours (Traxx reads the desktop's). |

## View menu

| | Item | Status |
| --- | --- | --- |
| [ ] | Tool Bar, Status Bar, View Control Bar, Edit Tools Bar | Ported. |
| [ ] | Textures, Patterns, Models | Ported (floating windows; position and size remembered). |
| [ ] | Options | Ported: General, Auto-Save, Colors, Advanced; Library replaces Folders. |
| [ ] | Game Library | Added: the PODs JSTraxx reads art and models from. |
| [ ] | Statistics | Ported. |

## Navigation menu and function keys

| | Key | Status |
| --- | --- | --- |
| [ ] | F2 Save Location, F3 Return to Location, F4 Lock View Altitude | Ported. |
| [ ] | F5 Always Show Course, F6 Objects, F7 Ground Boxes, F8 Water, F9 Backdrop | Ported (Traxx has them as keys and Options; JSTraxx lists them in the menu too). |

## Help menu

| | Item | Status |
| --- | --- | --- |
| [ ] | Contents | Ported: Traxx's WinHelp topics converted to pages (`public/help`). Context help (F1 in a dialog) is not ported. |
| [ ] | Keyboard Summary | Ported, with JSTraxx's mouse additions. |
| [ ] | About | Ported (the registration nag is dropped). |

## Toolbars

| | Bar | Status |
| --- | --- | --- |
| [ ] | Main: New, Open, Components, Save, Write POD, Copy, Undo, Print | Ported (Traxx's own button art). |
| [ ] | Edit Mode: Terrain, Textures, Course, Objects, Ground Boxes | Ported. |
| [ ] | Windows: Textures, Models | Ported. |
| [ ] | Textures window: Load, Cut, Copy, Paste, Paste Composite, Animate, Purge, zoom out/reset/in | Ported. |
| [ ] | Models window: Load, Cut, Cut + Objects, Purge | Ported. |
| [ ] | Patterns window: Select TXP File, Cut, Copy, Paste | Ported. |
| [ ] | Track Palette: New, Open, Save | Ported. |
| [ ] | View Control bar: map, camera, gamma, grid size, Wire Frame, Show Whole Grid | Ported. |
| [ ] | Terrain, Textures, Course, Ground Boxes tool bars | Ported. Objects has none, as in Traxx. |

## Moving around (3D view)

| | Control | Status |
| --- | --- | --- |
| [ ] | Arrows / keypad: move and turn; PgUp / PgDn pitch; A / Z climb; comma / period strafe; Shift fast; keypad 5 level; Home north | Ported (NavigationTick). |
| [ ] | Click the terrain map to jump | Ported. |
| [ ] | Wheel forward and back (Ctrl: up and down), middle-drag look, Shift+middle-drag pan, Alt+left-drag orbit | Added. |

## Edit modes

| | Mode | Keys and mouse | Status |
| --- | --- | --- | --- |
| [ ] | Terrain | Brush follows the pointer; click or Space applies (Direct Edit: S / ] and X / [); Tab orientation; - + curvature; [ ] X S altitude; tools Platform, Hill, Wedge, Mound, Random, Smooth, Plane, Manual | Ported, quirks included (Bumps). Drag-paint is not in Traxx and not added here. |
| [ ] | Textures | Paint Mode brush or click / Shift+click area; Space applies; R / M area, Ctrl+R / Ctrl+M each cell; Copy / Paste Area or pattern; Select (eyedropper); Replace | Ported. Holding the button paints on (added). |
| [ ] | Course | Drag segment ends (20 px) and trucks (64 px) on the ground; insert, delete, reverse, speed limit, generate from main, delete all; truck reverse and properties | Ported. |
| [ ] | Objects | Click (128 px), Ctrl+click / Ctrl+drag box, drag moves, Shift+drag turns, double-click Properties; R T, C D, V F, X S, G B, H N, 1-6 with Shift / Ctrl+Shift steps; Tab; Delete; Enter; Set Type with caps and checkpoint order | Ported. |
| [ ] | Ground Boxes | Hovered face outlined, click selects and paints (Face, Sides, Top-Bottom, All); R / M; Delete; X S [ ] move Top or Bottom; Insert, Rotate, Mirror, Cut, Copy, Paste | Ported. |

## Overlays in the view

| | Overlay | Status |
| --- | --- | --- |
| [ ] | Terrain brush grid with heights; texture selection outline; course lines and segment numbers; trucks | Ported. |
| [ ] | Object outlines (model faces or box edges); "CP nn" labels; the arrow through a model-less checkpoint (none in a rumble, first four in a drag) | Ported. |
| [ ] | A Light's ground pool (cyan) with stem and leader; its cone arrow in glow mode 2 (yellow); both follow Light Properties as you type | Ported. |
| [ ] | Display FPS, model transparency, hide colliders, water opacity, painted mask overlay | Ported. |
| [ ] | Models drawn one-sided (as the game, JSPod and JSTrackViewer), two-sided only with MRGLMAT_TWOSIDED | Deliberate change: Traxx draws both sides, so a sign's back covers its front (CHEV81). |
| [ ] | Model Transparency: cutout faces (0x11, 0x33) punched through only when on; solid otherwise | As Traxx's settransparency. |
| [ ] | Wire Frame options (Options > Advanced): cell diagonals, line width 1-4 px | Additions; defaults match Traxx (edges only, thin). |
| [ ] | Several backdrops (SIT backdropCount > 1, e.g. Wastelands): loaded, drawn in order, edited in Track Components > Backdrops (ordered list, up to 4; an arena has its stadium only), written to the SIT and pod | Addition; kept in a .TXX trailer that Traxx ignores (it opens the file with the first backdrop). |
| [ ] | Keys stay with the 3D view after clicks on toolbars, bar controls and closing dialogs | As Traxx, where bars never take the focus. |
| [ ] | About: the GuitarBill picture (IDB_BILL) behind a button | As Traxx's About toggle. |

## Windows

| | Window | Status |
| --- | --- | --- |
| [ ] | Textures | Ported: grid with zoom, click / Shift+click / box select, Ctrl+click animation frames (8, names of 15 at most), Type and Grip depth for the selection, Apply; Load >> pane (filter, pages, Add Page, Delete / Rename in the ART folder) over the ART folder then the game library; Cut, Copy, Paste (64 or 256 square), Paste Composite, Animate, Purge. |
| [ ] | Models | Ported: list, 3D preview (turn, tilt, zoom 40..600), vertex and polygon counts, Apply / double-click; Load from the MODELS folder, the library or disk; Cut, Cut + Objects, Purge. |
| [ ] | Patterns | Ported: one `.TXP` at a time (Traxx's `Patterns.txp` to start); Copy picks the pattern Paste Area pastes, loading its textures (asked, or always); Paste makes one from the area Copy Area took. |
| [ ] | Auto Texture Transitions | Ported. |

## Dialogs

| | Dialog | Status |
| --- | --- | --- |
| [ ] | Object Properties | Ported, live in the view, Reset to the resting height, nudge keys, sounds (stock list or a WAV), cab and base models (from the track's models), Light... |
| [ ] | Group Properties | Ported, live; blank fields are left alone. |
| [ ] | Light Properties | Ported, live. |
| [ ] | Truck Properties, Speed Limit | Ported. |
| [ ] | Track Components | Ported: name and World Name, comment, icon and browse pictures (BMP or HD art with Traxx's shape rules, stock icons), backdrop and arena settings, sound theme, palette, water level in quarters, music (stock, WAV, MOD), type, detail normal, mask, info photo and description with the panel fit, BMP copies. View and Play work (Traxx: "not yet implemented"). |
| [ ] | Texture Name, Texture Animation, Paste Composite (Texture Cut) | Ported. Paste Composite takes a true-colour picture (the browser clipboard has no 8-bit bitmaps) and writes PNG, TGA or RAW tiles. |
| [ ] | Stock Sounds, Stock Music, Stock Icons | Ported. |
| [ ] | Generate Terrain, Lighting, Weather Mask, Track Palette, Statistics | Ported. |
| [ ] | Adjust Heights, Select Track, Clone, Incomplete Track, Legacy .RAW fallback, Write POD options | Ported. |
| [ ] | Options | Ported (see View menu). "Keep HD art only" is how JSTraxx always works, so it is a note instead of a box. |
| [ ] | Registration nag | Not ported. |

## Files

| | Format | Status |
| --- | --- | --- |
| [ ] | `.TXX` read and write (TRAXXV1 to V11) | Ported; Traxx-written files round-trip byte for byte. |
| [ ] | POD read (View POD, Clone, library) | Ported, with Traxx's name rules (SeekToItem). Additions: a missing art or model is looked for in the library; box sounds and `.ANI` frames are kept. |
| [ ] | POD write | Ported: tracks Traxx wrote come back out entry for entry (tests/pod-writer.test.ts). MTM1's fog files are not written (MTM2 only). |
| [ ] | `.SIT` / `.SI2`, `.LVL`, `.TEX`, `.TTY`, `.ANI`, `.TXV` (unknown keys kept), `.CLR`, `.LTE`, ground-box grids | Ported. The TXV is stamped `tool=JSTraxx`, `toolVersion=1.0.0` instead of Traxx. |
| [ ] | HD art: PNG and TGA, `_N` / `_AO` maps, detail normal and mask, HD track pictures | Ported. HD-only art gets its 8-bit tile in memory (Traxx's HDTexture median cut). |
| [ ] | `.TXP` patterns, `.PAL` / `.ACT` palettes | Ported. |

## Deliberate changes

- Undo covers every mode and keeps many steps.
- Textures mode paints while the button is held.
- Terrain Paste Area is not transposed (Traxx pastes rows as columns).
- Deleting a texture renumbers an animation's first frame too (Traxx leaves it pointing at the wrong texture).
- New objects are appended (Traxx reuses the first empty slot); the list stays dense.
- Model vertices keep full precision (Traxx rounds to whole units for its polygon library).
- Loading art from disk copies it into the browser's ART or MODELS folder, so the track finds it again.
- Purge Unused Models keeps a model a top-crush uses as its base.
- The software renderer is replaced by WebGL; there is no Display Resolution setting (the view fills the window).
- Write POD saves through the browser.

## Not ported

- MTM1 tracks (New (MTM1), MTM1 fog files, the zoom picture as an MTM1 feature).
- Print Preview and Print Setup; Exit; the registration nag; context help (F1).
- Reading a model again when its `.BIN` changes on disk while the track is open (RefreshChangedModels).
- Traxx's "Textures window behind the main window" option.
