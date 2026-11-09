# JSTraxx and Traxx: parity checklist

Every feature of Traxx 1.7.0 (`Traxx_OnGoing_Updates`; 1.7 additions are marked), and where it stands in JSTraxx. The
status column is what the code does; the box is for checking it in a browser against Traxx.

Status: **Ported** works as in Traxx. **Changed** works, differently on purpose (the reason
is given). **Added** is not in Traxx. **Not ported** is left out, with the reason.

## File menu

| | Item | Status |
| --- | --- | --- |
| [ ] | New | Ported. The new track's values are the constructor's; MTM2 palette and pictures as LoadMTM2Palette. |
| [ ] | New > Classic 8-bit / 16-bit / 16-bit Spline / 16-bit Full Map (1.7) | Ported (OnFileNewGrid): the fresh track is switched to the mode without a word and is not marked modified. |
| [ ] | New (MTM1) | Not ported: JSTraxx is MTM2 only. |
| [ ] | Open... | Ported. Lists the `.TXX` files kept in the browser (`jstraxx/tracks`), or opens one from disk. |
| [ ] | Save, Save As... | Ported. Saves a `.TXX` (lowest TRAXXV version that holds the track) into the browser. |
| [ ] | Close | Added (a browser tab has no File > Exit). |
| [ ] | Clone TrackEd Track... | Ported. Pick the TrackEd folder (WORLD, LEVELS, DATA...). |
| [ ] | View POD file... | Ported, read-only; a POD with several tracks asks which (Select Track). |
| [ ] | Import Viewed POD as Track | Added: extracts the POD's art and models, then saves a `.TXX`. |
| [ ] | Write POD File... (Ctrl+W) | Ported: Incomplete Track, the fallback explanation, the omit option, then a save dialog or a download. Traxx 1.7: before a pod is overwritten, the "Surface meshes would be lost" question (FindLostSurfaceSidecars, No the default; a download has no old pod to read, so it is not asked there); after it is written, the vegetation instancing warning (VegModelsThatWillNotInstance with InstPodTextureOK). |
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
| [ ] | Adjust Terrain Heights... | Ported. Traxx 1.7: on 16-bit, Spline and Full Map tracks it adjusts h16 or the 1024 grid (AdjustHeights16 / AdjustHeightsFine, lift x 256) so fractions survive; the lakes are refitted (lifted or scaled, then the nearest legal height) and the lake guard refuses an Adjust that breaks one. |
| [ ] | Import Heightmap (.RAW/.PNG/.TGA)..., Export Heightmap... (1.7) | Ported: the precheck, the size x mode questions, ImportHeights with PlanarExpand for a coarse file into a Full Map, the image decode (grayscale PNG 8/16-bit through OpenPhotex, TGA raw and RLE in JSTraxx), the coarse-full note; export by typed extension or filter, PNG encoded byte for byte as Traxx (stb_image_write zlib, Paeth rows, checked against Traxx's own C++ built locally). Changed: every import is undoable in JSTraxx (Traxx cannot snapshot a Full Map import), so a lake it breaks is refused rather than warned about. The export is a download (no overwrite prompt). Interlaced PNGs are refused (OpenPhotex's decoder). |
| [ ] | Extract Models and Art | Ported: into the browser's ART and MODELS folders; an existing file is kept. |

## Special menu

| | Item | Status |
| --- | --- | --- |
| [ ] | Weather Mask | Ported (MTM2 tracks). |
| [ ] | Random Terrain | Ported: Classic and Fractal with MSVC's `rand()`, so a seed gives Traxx's terrain. Traxx 1.7: 16-bit, Spline and Full Map tracks generate in v with TerrainGenV (1024 points on a Full Map), byte for byte against Traxx's C++, with the "For:" line; the grid it writes is settled before the undo record, so a mismatch leaves the track and undo untouched (78d7b93); the lake guard refuses a result that breaks a lake. |
| [ ] | Lighting | Ported: BuildLte, altitude bias, terrain and ground-box shadows, object shadows, the sun for the .LVL. |
| [ ] | Texture Transitions | Ported (the Auto Texture Transitions window). Traxx 1.7: resizable, opens larger, remembers its size, the grid stays square as it grows, any texture size sampled to 64 x 64. |
| [ ] | Palette | Ported: New (optimised palette), Open and Save `.PAL` / `.ACT`. The bottom ten system colours are Windows' static colours (Traxx reads the desktop's). |
| [ ] | Vegetation... (1.7) | Ported: the Vegetation window and its entry dialog (global seed, corridor, margin, per-colour rules, per-model settings), Re-plant with VegetationPlanter's rules (xorshift32, FNV-1a per colour, the +-8 match, Bridson multi-region with 30 tries, rejections, seating on the lowest of 8 samples, grass clumps with coverage, the warning per species model the game will not instance), BuildVEG with Traxx's RULE and INFO text. Re-planting `fog_test.txx` reproduces the `.VEG` in Traxx's `fog_test.pod` byte for byte (with the same INFO date). Make Far Cards (VegetationFarCard.cpp): Traxx's software rasteriser (front and side views on a 256 or 512 atlas, 2 x 2 supersampling, alpha-weighted downsample, 4 px gutter, colour bleed), the card named by CRC-32 of FARCARD5, the model and the textures drawn, the 384-byte crossed `.BIN`, the PNG plus keyed `.RAW` / `.ACT` in the ART folder, the `.BIN` in the MODELS folder, loaded into the track and judged by ModelWillInstance, entries given their far model; the names of `fog_test.pod`'s own cards and the layout of its crossed card are reproduced (its cards themselves came from older generators). Masks: palette PNGs and 1, 2 and 4-bit grey PNGs are expanded to RGB as stb_image does. The dialog's layout follows VegetationDlg.cpp's controls (the template is not in the repository). Changed: the cards go to JSTraxx's ART and MODELS folders in browser storage (no folder prompt, no protected game folder), the PNG is encoded by JSTraxx not WIC (same pixels, other bytes), and the cards are one undo step with the window's OK (or their own step on Cancel) where Traxx keeps them with no undo. Not ported: a LightWave species model gets no card (JSTraxx reads no LightWave models, see Not ported). |
| [ ] | Terrain Grid > Classic 8-bit / 16-bit / 16-bit Spline / 16-bit Full Map (1.7) | Ported: TerrainConvertMessage's question, then SetMode's table (Spline to Full Map through OpenPhotex's terrainSplineExpand, 16-bit and 8-bit through PlanarExpand, Full Map to 32 ft keeping every 4th point, down to 8-bit rounding to the nearest step), the radio mark, the new-lake-error warning. Changed: the conversion is one undo step (Traxx clears the terrain undo, and its message still says so). |
| [ ] | Terrain Grid > Smooth Full Map from 32 ft grid... (1.7) | Ported (SmoothFineFromCoarse), asked first, undoable, lake guard. |
| [ ] | Terrain Grid > Store heights as PNG (1.7) | Ported: the check mark, saved in the `.TXX`; Write POD packs `DATA\<stem>_H.PNG` (beside the `.RAW` on Classic 8-bit, in its place otherwise) and the `.TXV`'s `terrainHeights=`, and refuses the whole pod with Traxx's message when the name does not fit. |

## View menu

| | Item | Status |
| --- | --- | --- |
| [ ] | Tool Bar, Status Bar, View Control Bar, Edit Tools Bar | Ported. |
| [ ] | Textures, Patterns, Models | Ported (floating windows; position and size remembered). |
| [ ] | Options | Ported: General, Auto-Save, Colors, Advanced; Library replaces Folders. |
| [ ] | Game Library | Added: the PODs JSTraxx reads art and models from, headed by Browser storage (the ART and MODELS folders, read first) with Clear... (every file or a name filter). |
| [ ] | Statistics | Ported, with the 1.7 Fog count. |
| [ ] | Vegetation > Show Vegetation, Show Grass, Mask Wash, Aids, Show Lake Walls (1.7) | Ported: five persisted switches (trees on, the rest off), not drawn over a wireframe. Trees inside the terrain window at their heading and scale, each species' far card past 900 to 1000 ft (horizontal, dithered per tree; a hard 950 ft without the cross-fade flag), seated by the models' lowest first-VLIST points, only when the engine would instance both the model and the card (ModelWillInstance); facing species and flat cards turn to the camera. Grass to 1000 ft, thinned over the last quarter. Aids: the corridor band and discs, the start slots, the checkpoint discs, trunk cylinders within 600 ft (red as authored, orange estimated). The mask wash per 32 ft cell on the ground as drawn. Lake walls: a ring per dry tile next to a lake, on the ground, never under the lake, 1 ft up. Changed: plants are drawn as instanced meshes refilled when the camera moves, not Traxx's fast-draw tile lists (the same picture). |

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
| [ ] | Terrain | Brush follows the pointer; click or Space applies (Direct Edit: S / ] and X / [); Tab orientation; - + curvature; [ ] X S altitude; tools Platform, Hill, Wedge, Mound, Random, Smooth, Plane, Manual | Ported, quirks included (Bumps). Drag-paint is not in Traxx and not added here. Traxx 1.7: on 16-bit and Spline tracks the brush works on h16 in v (terraingridv, ApplyStamp16, Smooth rounding half up), clipped at the map edge, so untouched fractions stay. On a Full Map the brush point is the 8 ft vertex under the pointer (TerrainPickFine) and the brush works on the 1024 grid with wrap, sized 1-100 points (the Width and Height spins follow the track, 1-25 elsewhere); its preview draws every 2nd / 4th point above 40 / 80. The Altitude box takes decimal steps on every 16-bit track (2 decimals, 0.1 a click or key, decimal comma), whole steps on classic, and comes down to whole steps when the track becomes classic. Copy / Paste Area is 16-bit exact (h16 with fractions; 8 ft points with wrap on a Full Map), and a block pastes only on the kind of grid it was copied from. Paste Bitmap writes b << 8 into h16 and is refused on a Full Map. Every terrain edit folds pending 8-bit edits first and passes the lake guard (LakesRefuseTerrainEdit: put back with Traxx's message). Changed: undo keeps many levels and records only the window an 8 ft stroke writes (Traxx: one 2 MB snapshot); spinner mouse clicks step with the browser's arithmetic (keys use StepAmplitude); a cell copied off the map is skipped on paste (Traxx pastes stale data). |
| [ ] | Terrain right-click: Create Lake..., Edit Lake..., Delete Lake, Remove This Seed, Add Seed to Lake (1.7) | Ported (OnTerrainCreateLake and friends, the items built for the highlighted vertex as TraxxViewInteract.cpp does): Spill and FitHeight to start a lake, Traxx's refusals, the Lake window (height in quarter steps snapped to MinHeight .. spill, feet, holds-up-to, tiles, seeds, Reflective, Problems, water-heights note; OK refused while in error, Cancel restores), one undo step each. |
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
| [ ] | Wire Frame options (Options > Advanced): cell diagonals, line width 1-4 px | Additions; defaults match Traxx (edges only, thin). The wire outlines the cells as drawn: 8 ft on 8 ft tiles (Traxx 1.7). |
| [ ] | Several backdrops (SIT backdropCount > 1, e.g. Wastelands): loaded, drawn in order, edited in Track Components > Backdrops (ordered list, up to 4; an arena has its stadium only), written to the SIT and pod | Addition; kept in a .TXX trailer that Traxx ignores (it opens the file with the first backdrop). |
| [ ] | Keys stay with the 3D view after clicks on toolbars, bar controls and closing dialogs | As Traxx, where bars never take the focus. |
| [ ] | About: the GuitarBill picture (IDB_BILL) behind a button | As Traxx's About toggle. |

## Windows

| | Window | Status |
| --- | --- | --- |
| [ ] | Textures | Ported: grid with zoom, click / Shift+click / box select, Ctrl+click animation frames (8, names of 15 at most), Type and Grip depth for the selection, Apply; Load >> pane (filter, pages, Add Page, Delete / Rename in the ART folder) over the ART folder then the game library; Cut, Copy, Paste (64 or 256 square), Paste Composite, Animate, Purge. |
| [ ] | Models | Ported: list, 3D preview (turn, tilt, zoom 40..600), vertex and polygon counts, Apply / double-click; Load from the MODELS folder, the library or disk (addition: Delete... for MODELS folder files); Cut, Cut + Objects, Purge. |
| [ ] | Patterns | Ported: one `.TXP` at a time (Traxx's `Patterns.txp` to start); Copy picks the pattern Paste Area pastes, loading its textures (asked, or always); Paste makes one from the area Copy Area took. Traxx 1.7: resizable, opens larger, remembers its size, the preview fills the window and the thumbnail keeps its aspect. |
| [ ] | Auto Texture Transitions | Ported. Traxx 1.7: resizable, opens larger, remembers its size, the grid stays square as it grows, any texture size sampled to 64 x 64. |

## Dialogs

| | Dialog | Status |
| --- | --- | --- |
| [ ] | Object Properties | Ported, live in the view, Reset to the resting height, nudge keys, sounds (stock list or a WAV), cab and base models (from the track's models), Light... The 1.7 Type list (Fog at 14, Ramp 15, Top-Crush 16), the 50-fog cap and the Fog... button (Fog only; a Fog with a model is refused with Traxx's message) are ported. Traxx 1.7: on 16-bit, Spline and Full Map the height shown is Z less the drive surface and OK always re-grounds (BoxHeightPairOf / Store). |
| [ ] | Fog Properties (1.7) | Ported (FogPropertiesDlg): every field with its range and message, the Round slider, colour (the browser's colour picker), the nine weathers, Defaults, live preview, a finer round value from the file kept unless the slider moves. |
| [ ] | Lake (1.7) | Ported (LakeDlg). |
| [ ] | Group Properties | Ported, live; blank fields are left alone. |
| [ ] | Light Properties | Ported, live. |
| [ ] | Truck Properties, Speed Limit | Ported. |
| [ ] | Track Components | Ported: name and World Name, comment, icon and browse pictures (BMP or HD art with Traxx's shape rules, stock icons), backdrop and arena settings, sound theme, palette, water level in quarters, music (stock; WAV, MP3 or OGG Vorbis on MTM2, MOD on MTM1, judged by the bytes with Traxx 1.7's refusals and Vorbis check; Save As by kind), type, detail normal, mask, info photo and description with the panel fit, BMP copies. View and Play work (Traxx: "not yet implemented"); Play takes WAV, MP3 and OGG. |
| [ ] | Texture Name, Texture Animation, Paste Composite (Texture Cut) | Ported. Paste Composite takes a true-colour picture (the browser clipboard has no 8-bit bitmaps) and writes PNG, TGA or RAW tiles. |
| [ ] | Stock Sounds, Stock Music, Stock Icons | Ported. Stock Music (1.7): Name and Description columns, resizable, opens larger and remembers its size. |
| [ ] | Generate Terrain, Lighting, Weather Mask, Track Palette, Statistics | Ported. |
| [ ] | Vegetation, Vegetation entry (1.7) | Ported (see Special menu). |
| [ ] | Adjust Heights, Select Track, Clone, Incomplete Track, Legacy .RAW fallback, Write POD options | Ported. |
| [ ] | Options | Ported (see View menu). "Keep HD art only" is how JSTraxx always works, so it is a note instead of a box. |
| [ ] | Registration nag | Not ported. |

## Files

| | Format | Status |
| --- | --- | --- |
| [ ] | `.TXX` read and write (TRAXXV1 to V11) | Ported; Traxx-written files round-trip byte for byte. |
| [ ] | `.TXX` V12 to V17 (Traxx 1.7: fog values on every box, vegetation masks and `.VEG` image, lakes, terrain mode and 16-bit or Full Map heights, "heights as PNG" flag) | Ported: written at the generation Traxx picks (fog 14, vegetation 15, lakes 16, a non-classic terrain 17); Traxx 1.7's `fog_test.txx` round-trips byte for byte. The vegetation block is the `.VEG` image, whose RULE chunk the Vegetation window reads its settings from (ParseVEG). The JSTraxx trailer (extra backdrops) now follows the V17 block; older files with it after V11 still open. |
| [ ] | `.SIT` / `.SI2` 'F' fog block (1.7) | Ported: read tolerantly (engine defaults for missing fields, a model-less Fog takes a hand-edited size back), written for a Fog only, after the '@' block; Traxx 1.7's `FOGTEST.SI2` round-trips byte for byte. Added around OpenPhotex's reader and writer until OpenPhotex knows the block. |
| [ ] | Height file by size (1.7): 64 KB Classic 8-bit, 128 KB 16-bit (or Spline under `terrainGrid=spline`), 2 MB Full Map; other sizes read as 8-bit with Traxx's warning | Ported for POD read, Clone and Write POD (the `.RAW` of the mode's length, `.SI2` and `legacyFallback=0` outside classic). The 8-bit heights stay as the mirror Traxx keeps (nearest step), and 8-bit edits fold into the 16-bit heights on save (SyncFromRaw). |
| [ ] | `.TXV` 1.7 keys | Ported: formatVersion 2 / 4 (fog, with `fogVolumes=`) / 3 (vegetation) / 5 (non-classic terrain), `terrainGrid=` for Spline and Full Map, Traxx's owned-key list (an indented copy is not carried over). `vegetation=`, `vegTrees=`, `vegClumps=` are counted from the `.VEG` packed. |
| [ ] | `.VEG`, `_V` / `_G` masks, `.WTR` in a pod (1.7) | Ported: a pod's `.VEG` is kept and written back in Traxx's entry order (masks with the terrain maps; `.VEG` and `.WTR` after the `.TXV`); a mask is adopted only when the `.VEG`'s RULE chunk names it, and every model in such a pod is loaded so the vegetation's species are not lost. The `.WTR` is read into lakes (ParseWTR), recomputed on the pod's ground, and a stored tile map that differs is told once (Traxx's message); Write POD rebuilds it (Recompute, then BuildWTR through OpenPhotex's writeWtr), or reports Traxx's "Lakes not saved" when a lake is in error. `fog_test.txx`'s lakes build `WORLD\FOGTEST.WTR` of Traxx's `fog_test.pod` byte for byte. |
| [ ] | Lakes (1.7) | Ported (TrackPODLakes.cpp): the fill, Spill with its bucket queue (256 buckets on 8-bit ground, one per u on the drive surface), Recompute's order and every error code, FitHeight, NearestLegalHeight, MinHeight and LevelTouchesGround on both grounds, BuildLakeGround for 16-bit (4 corners) and Spline / Full Map (25 fine points, the flat-triangle CORNER_AT_H). Drawn as Traxx's sheets in the six tints (magenta in error) at the water opacity, with the wall rings under View > Vegetation > Show Lake Walls. |
| [ ] | `.SRF` surface meshes beside models (1.7) | Ported: FindSurfaceSidecar as one rule, the `.SRF` only from where its model came (the MODELS folder, a TrackEd folder, or the same library pod), for a `.TXX`'s models, cloned TrackEd tracks, the Models window's Load (a `.SRF` picked from disk with its `.BIN` is copied into the MODELS folder with it) and a backdrop loaded in Track Components; Write POD packs it right after its model (PodAddSurfaceSidecar), reports one it cannot name, and asks before overwriting a pod whose surface meshes would be lost. The Models window tags surface meshes "(surface)", including models of an opened pod that carries `MODELS\<stem>.SRF` (NotePodSurface). A model read out of a pod has none to pack, as in Traxx. |
| [ ] | Music: MP3 and OGG Vorbis (1.7) | Ported: MusicKindOf (RIFF, MUSIC, OggS, ID3 or MPEG frame sync, else MOD); `SOUND\<stem>.KLP` then `.WAV` / `.MP3` / `.OGG`, and the `.LVL` names the matching extension. Track Components picks WAV, MP3 or OGG Vorbis (OnMusicLoad: refused by the bytes, an Ogg must hold Vorbis, MTM1 takes MOD only), Save As follows the kind, a stock pick has nothing to save; the integrity message is 1.7's "Music MOD/WAV/MP3/OGG not specified.". |
| [ ] | POD read (View POD, Clone, library) | Ported, with Traxx's name rules (SeekToItem). Additions: a missing art or model is looked for in the library; box sounds and `.ANI` frames are kept. |
| [ ] | POD write | Ported: tracks Traxx wrote come back out entry for entry (tests/pod-writer.test.ts). MTM1's fog files are not written (MTM2 only). |
| [ ] | `.SIT` / `.SI2`, `.LVL`, `.TEX`, `.TTY`, `.ANI`, `.TXV` (unknown keys kept), `.CLR`, `.LTE`, ground-box grids | Ported. The TXV is stamped `tool=JSTraxx`, `toolVersion=1.0.0` instead of Traxx. |
| [ ] | HD art: PNG and TGA, `_N` / `_AO` maps, detail normal and mask, HD track pictures | Ported. HD-only art gets its 8-bit tile in memory (Traxx's HDTexture median cut). |
| [ ] | `.TXP` patterns, `.PAL` / `.ACT` palettes | Ported. |

## Deliberate changes

- Undo covers every mode and keeps many steps.
- Textures mode paints while the button is held.
- Deleting a texture renumbers an animation's first frame too (Traxx leaves it pointing at the wrong texture).
- New objects are appended (Traxx reuses the first empty slot); the list stays dense.
- Model vertices keep full precision (Traxx rounds to whole units for its polygon library).
- Loading art from disk copies it into the browser's ART or MODELS folder, so the track finds it again.
- Purge Unused Models keeps a model a top-crush uses as its base.
- The software renderer is replaced by WebGL; there is no Display Resolution setting (the view fills the window).
- Write POD saves through the browser.

## Traxx 1.7: ported

Every 1.7 feature is in (above): the formats, the terrain modes and conversions, the 8 ft drawn surface, picking and snapping on it, 16-bit and Full Map editing, lakes, vegetation planting, drawing and far cards, fog, the height images, MP3 / OGG music and `.SRF` sidecars. The rendering of the drive surface (SurfaceMesh.cpp, SurfaceTileLodsFor): 16-bit corners; on Spline and Full Map the 8 ft ring of 4 x 4-cell tiles within 8 tiles of the camera's tile, 32 ft beyond, 8 ft sides facing 32 ft tiles straightened onto the 32 ft edge (no cracks); the wire frame, the lake wall rings and the vegetation mask wash on the ground as drawn. Picking on the drive surface (PickRay: the walk over the window's 32 ft triangles, refined on Spline and Full Map with the step-back). Snap to ground with the surface's fraction (BoxHeightPairLoad / Store) for insert, drag, nudges, model swap, copy / paste, Object and Group Properties, the camera, light pools and Adjust Terrain Heights' placed points (ShiftPlacedPoints); course points and trucks round to the nearest step.

Differences that remain:

- Fast draw (display-list and VBO caching, the perf readout, the VBO-terrain and fast-draw registry bits) is not ported: WebGL draws the same picture.
- The pick ray starts at the camera (Traxx: its near distance, 8 world units, an eighth of a scene unit), and a ray that misses the window picks nothing.
- The Load dialogs' preview strips (texture and model thumbnails of up to six picks) are not ported, and Textures > Load uses the browser's picker, which shows neither Traxx's three filters nor its title.
- Options > Folders' 1.7 "Game folder (protected)" and "Allow Traxx to write generated art into the game folder" do not apply: JSTraxx writes generated art only to its own browser storage.

## Not ported

- MTM1 tracks (New (MTM1), MTM1 fog files, the zoom picture as an MTM1 feature).
- Print Preview and Print Setup; Exit; the registration nag; context help (F1).
- Reading a model again when its `.BIN` changes on disk while the track is open (RefreshChangedModels).
- Traxx's "Textures window behind the main window" option.
- LightWave (`.LWO`) models (CTrackPODModel::TranslateLWO): JSTraxx reads `.BIN` models only, so an `.LWO` cannot be loaded or given a far card.
