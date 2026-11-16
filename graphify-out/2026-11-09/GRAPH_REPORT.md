# Graph Report - JSTraxx  (2026-11-09)

## Corpus Check
- 488 files · ~416,733 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4149 nodes · 11311 edges · 250 communities (177 shown, 73 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 144 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `34f006a5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- openphotex/index.js
- hd-texture.ts
- lakes.ts
- readTxx
- transitions-panel.ts
- truck-truck.js
- special-commands.ts
- trk.js
- components-dialog.ts
- objects-mode.ts
- hb-nav.js
- tool-bars.ts
- course-mode.ts
- dynamics.js
- track.js
- constants.js
- sit.ts
- model-handlers.ts
- evo/sit.js
- ModelLibrary
- mtm/sit.js
- context-menu.ts
- TraxxCamera
- bin.js
- surface.ts
- load-pod.ts
- pod-writer.ts
- PolyForm Noncommercial License 1.0.0
- LineReader
- terrain-mode.ts
- WorkerClient
- TrackView
- package.json
- settings.ts
- veg.ts
- mtm2/index.js
- AppState
- veg-far-card.ts
- height-image.ts
- compilerOptions
- race.js
- heights.js
- f32
- vegetation.ts
- doc-handlers.ts
- water.js
- el
- mtm/veg.js
- surface.js
- textures-mode.ts
- recovery.js
- patterns-panel.ts
- ModeHandler
- surface-pick.ts
- TrackDocument
- main.ts
- decodePngSamples
- encode.js
- smk.js
- JSTraxx and Traxx: parity checklist
- asset-worker.ts
- inflate.js
- spline.js
- object-dialogs.ts
- terrain-commands.ts
- controls.js
- solveHullContacts
- wtr.js
- damage.js
- veg-planter.ts
- replay.js
- mtm/write.d.ts
- LineCursor
- scenery.js
- mtm/sit.d.ts
- high-scores.js
- Overlay2D
- mod.js
- garage.js
- lte.js
- terrain-gen16.ts
- traxx-help.mjs
- vegetation-dialog.ts
- globe.js
- Reader
- write-pod2.js
- raw.js
- traxx-ui-art.mjs
- textures-panel.ts
- drive-surface.test.ts
- traxx-stock-data.mjs
- sound.js
- track-view.ts
- findAsset
- course.d.ts
- top-crush.js
- cpr/road.d.ts
- evo/sit.d.ts
- bin-write.d.ts
- LineReader
- evo/ground.js
- edges.d.ts
- tiff.js
- def.js
- track.d.ts
- EvoTreeFieldInput
- cockpit.d.ts
- sound.d.ts
- dfm.d.ts
- cpr/step.d.ts
- top-crush.d.ts
- contacts.d.ts
- checkpoints.d.ts
- cmd.d.ts
- script.d.ts
- smf.d.ts
- trk.d.ts
- bin.d.ts
- replay.d.ts
- pod/write.d.ts
- spec.d.ts
- controls.d.ts
- truck/params.d.ts
- state.d.ts
- Mtm2Ground
- RoadGround
- palette-rank.d.ts
- Working on JSTraxx
- mod.d.ts
- errors.d.ts
- scenery.d.ts
- openphotex/index.d.ts
- geo.d.ts
- kfm.d.ts
- set.d.ts
- pod2.d.ts
- types.d.ts
- evo/params.d.ts
- box.d.ts
- truck-truck.d.ts
- race.d.ts
- drivetrain.d.ts
- recovery.d.ts
- bundled-palettes.js
- raw.d.ts
- mtm-trk.d.ts
- def.d.ts
- garage.d.ts
- evo/lvl.d.ts
- probe.js
- tex.d.ts
- veg.d.ts
- globe.d.ts
- quadrant.d.ts
- sun.d.ts
- trn.d.ts
- skl.d.ts
- thm.d.ts
- evo/step.d.ts
- faces.d.ts
- ramp.d.ts
- truck-face.d.ts
- math.d.ts
- summit.d.ts
- AutopilotContext
- dynamics.d.ts
- ground-boxes.d.ts
- manifest.d.ts
- tv/lvl.d.ts
- ai-line.d.ts
- lte.d.ts
- parts.d.ts
- bsp.d.ts
- tagged.d.ts
- loc.d.ts
- txv.d.ts
- cth.d.ts
- fog.d.ts
- zth.d.ts
- parse.d.ts
- driveline.d.ts
- evo/rules.d.ts
- truck-box.d.ts
- constants.d.ts
- traffic.d.ts
- water-drag.d.ts
- surface.d.ts
- terrain.d.ts
- hb-underground.d.ts
- height.d.ts
- bundled-palettes.d.ts
- encode.d.ts
- tiff.d.ts
- common.d.ts
- cpr-car.d.ts
- ani.d.ts
- hb-briefing.d.ts
- hb-nav.d.ts
- nav.d.ts
- pup.d.ts
- tables.d.ts
- tdf.d.ts
- box.js
- smk.d.ts
- mtm/veg.d.ts
- hb-qke.d.ts
- tnl.d.ts
- wtr.d.ts
- cpt.d.ts
- heights.d.ts
- high-scores.d.ts
- player-pro.d.ts
- saved-game.d.ts
- srf.d.ts
- write-pod2.d.ts
- probe.d.ts
- png.d.ts
- instancing.ts
- truck-box.js
- ground-box-geometry.ts
- mtm/write.js
- Viewport
- LakesLayer
- player-pro.js

## God Nodes (most connected - your core abstractions)
1. `el()` - 125 edges
2. `AppState` - 67 edges
3. `openDialog()` - 67 edges
4. `alertDialog()` - 67 edges
5. `TrackView` - 53 edges
6. `f32` - 51 edges
7. `DocumentService` - 44 edges
8. `TrackDocument` - 43 edges
9. `CommandRegistry` - 41 edges
10. `componentsDialog()` - 40 edges

## Surprising Connections (you probably didn't know these)
- `hilly()` --calls--> `resetTrack()`  [EXTRACTED]
  tests/surface-lakes.test.ts → src/core/doc/new-track.ts
- `pngTestMap()` --calls--> `MsvcRand`  [EXTRACTED]
  tests/height-image.test.ts → src/core/edit/terrain-gen.ts
- `track()` --calls--> `refreshRaw()`  [EXTRACTED]
  tests/height-image.test.ts → src/core/traxx/terrain16.ts
- `cloneFirst()` --calls--> `cloneFromSit()`  [EXTRACTED]
  tests/clone-folder.test.ts → src/core/doc/clone.ts
- `sandbox()` --calls--> `loadPodTrack()`  [EXTRACTED]
  tests/veg-far-card.test.ts → src/core/doc/load-pod.ts

## Import Cycles
- None detected.

## Communities (250 total, 73 thin omitted)

### Community 0 - "openphotex/index.js"
Cohesion: 0.03
Nodes (111): CMD_FACE_TYPE, CMD_NORMAL_SCALE, CMD_POSITION_SCALE, CMD_UV_SCALE, cmdFaceTriangles(), cmdWingPackages(), scoreSplit(), lapRuns() (+103 more)

### Community 1 - "hd-texture.ts"
Cohesion: 0.07
Nodes (53): fill(), fillHdLegacy(), legacyFromHd(), applyLimits(), compositeRefusal(), CUT_MAXGRID, CutFormat, cutRgb() (+45 more)

### Community 2 - "lakes.ts"
Cohesion: 0.09
Nodes (47): lakeCommands(), lakeErrors(), lakeRefusal(), lakesNow(), anyLakeErrors(), buildWtr(), corner(), cornerAt() (+39 more)

### Community 3 - "readTxx"
Cohesion: 0.10
Nodes (24): cString(), latin1(), readBox(), readCourse(), Reader, readTerrain(), readTruck(), readTxx() (+16 more)

### Community 4 - "transitions-panel.ts"
Cohesion: 0.21
Nodes (11): AGRD_COL, fitThumbnail(), openingSize(), sample64(), Size, squareSide(), gammaMap(), makeResizable() (+3 more)

### Community 5 - "truck-truck.js"
Cohesion: 0.18
Nodes (25): add(), collideNear(), collideTrucks(), cross(), dot(), halfAxis(), impactVelocity(), insideHullBox() (+17 more)

### Community 6 - "special-commands.ts"
Cohesion: 0.23
Nodes (13): bindSpecial(), PAL_HEADER, readActFile(), readPalFile(), writeActFile(), writePalFile(), traxxFogMap(), lightingDialog() (+5 more)

### Community 7 - "trk.js"
Cohesion: 0.11
Nodes (31): applyLight(), colorEntry(), COUNTED_LISTS, EVO_VERSIONS, EVO_WHEEL_KEYS, isEvoTrk(), isEvoTrkLines(), isVec3() (+23 more)

### Community 8 - "components-dialog.ts"
Cohesion: 0.08
Nodes (58): applyComponents(), bitmapRefusal(), clampArena(), cleanStem(), Components, componentsOf(), hdArtRefusal(), INFO_TEXT_MAX (+50 more)

### Community 9 - "objects-mode.ts"
Cohesion: 0.09
Nodes (51): objectsMode(), Spot, applyGroup(), applyLook(), usable(), applyObjectFields(), previewObject(), radians() (+43 more)

### Community 10 - "hb-nav.js"
Cohesion: 0.05
Nodes (56): ANIMATION_BASE_FPS, parseAnimations(), writeAnimations(), hbPlacementToEditor(), parseIntTriple(), placementToEditor(), toDataLines(), TV_UNITS_PER_CELL (+48 more)

### Community 11 - "tool-bars.ts"
Cohesion: 0.10
Nodes (24): Channel, channels, onTerrainMode(), amplitudeFractional(), editSizeMax(), wholeAmplitude(), bar(), check() (+16 more)

### Community 12 - "course-mode.ts"
Cohesion: 0.08
Nodes (22): courseMode(), blankSegment(), courseOf(), deleteAllSegments(), deleteSegment(), generateFromMain(), insertSegment(), moveAnchor() (+14 more)

### Community 13 - "dynamics.js"
Cohesion: 0.05
Nodes (83): CPR_AIR_DENSITY, CPR_CAR, CPR_FRICTION, CPR_MU_FRONT, CPR_MU_REAR, CPR_MU_SCALE, CPR_RULES, CPR_TORQUE (+75 more)

### Community 14 - "track.js"
Cohesion: 0.09
Nodes (44): buildCprRoad(), CPR_WALL_PART_HEIGHT_FT, cprCentreline(), point(), CPR_CATCH_FENCE_NAMES, CPR_CHECKPOINT_ROLES, CPR_COURSE_PURPOSES, CPR_CROSS_SECTION_MIDPOINT (+36 more)

### Community 15 - "constants.js"
Cohesion: 0.05
Nodes (50): EVO1_RULES, EVO2_RULES, EVO_SURFACE_MU, EVO_TREAD, EVO_TREAD_FACTORS, applyEvoGarage(), evoSpecFromMtm2(), evoSpecFromTrk() (+42 more)

### Community 16 - "sit.ts"
Cohesion: 0.08
Nodes (43): cTrunc(), asciiUpper(), boxFrom(), byteText(), fit(), FOG_KEYS, insertFogBlocks(), LIGHT_KEYS (+35 more)

### Community 17 - "model-handlers.ts"
Cohesion: 0.07
Nodes (44): ImageDecoder, MAX_ANIMATION_FRAMES, MAX_ANIMATIONS, MAX_TEXTURES, modelWithTextures(), sidecarInMount(), sidecarPath(), ArtFile (+36 more)

### Community 18 - "evo/sit.js"
Cohesion: 0.09
Nodes (36): num(), parseEvoLvl(), parseEvoWat(), parseCall(), parseEvoScript(), splitOutside(), stripComment(), EVO_TRACK_TYPES (+28 more)

### Community 19 - "ModelLibrary"
Cohesion: 0.26
Nodes (3): ModelLibrary, instanced(), ObjectLayer

### Community 20 - "mtm/sit.js"
Cohesion: 0.05
Nodes (84): archiveTitle, basenameWithoutExtension(), normalizeArchiveName, replaceExtension(), PodFormatError, BOX_FOG, BOX_LIGHT, BOX_MOVING (+76 more)

### Community 21 - "context-menu.ts"
Cohesion: 0.12
Nodes (17): ContextMenuRequest, MAIN_MENU, MenuItem, closeContextMenu(), ContextMenuOptions, DynamicItem, escape(), host() (+9 more)

### Community 22 - "TraxxCamera"
Cohesion: 0.13
Nodes (6): groundZ(), NavKeys, noKeys(), TraxxCamera, KEYS, ViewInputHooks

### Community 23 - "bin.js"
Cohesion: 0.08
Nodes (33): parseFlyBsp(), STRUCTURE, BIN_GEOMETRY_DIVISOR, BIN_MAPPED_FACETS, BIN_SOLID_FACE_TYPE, BIN_TEXTURE_NAME_MAX, BIN_TRANSPARENT_FACE_TYPES, BIN_UNMAPPED_FACETS (+25 more)

### Community 24 - "surface.ts"
Cohesion: 0.12
Nodes (26): fitHeight8(), LAKEERR_CORNER_AT_H, LAKEERR_LEAK, LAKES_NOT_SAVED, adjustedHeight(), adjustHeights16(), applyStamp16(), getSurface() (+18 more)

### Community 25 - "load-pod.ts"
Cohesion: 0.05
Nodes (98): CloneError, cloneFromSit(), ERR, pickCloneStem(), DocumentSource, emptyCarry(), MTM2_ONLY, PodCarryOver (+90 more)

### Community 26 - "pod-writer.ts"
Cohesion: 0.14
Nodes (25): hdDimensions(), defaultFogMap(), afterSlash(), ascii(), buildTrackPod(), groundBoxGrids(), latin1(), OUR_TXV_KEYS (+17 more)

### Community 27 - "PolyForm Noncommercial License 1.0.0"
Cohesion: 0.06
Nodes (28): Acceptance, Changes and New Works License, Copyright License, Definitions, Distribution License, Fair Use, No Liability, No Other Rights (+20 more)

### Community 28 - "LineReader"
Cohesion: 0.17
Nodes (16): parseCth(), parseDfm(), triple(), BinaryReader, parseBinary(), parseKfm(), parseText(), parseNocturneSet() (+8 more)

### Community 29 - "terrain-mode.ts"
Cohesion: 0.09
Nodes (51): terrainMode(), publishTerrainMode(), amplitudeFromText(), amplitudeText(), readBox(), stepAmplitude(), recordWindow(), adjustHeights() (+43 more)

### Community 30 - "WorkerClient"
Cohesion: 0.11
Nodes (9): Library, LibraryEntry, StoreFolder, Deferred, Listener, WorkerClient, WorkerReply, LibraryItem (+1 more)

### Community 31 - "TrackView"
Cohesion: 0.13
Nodes (3): decodeHd(), opaque(), TrackView

### Community 32 - "package.json"
Cohesion: 0.07
Nodes (27): dependencies, three, description, devDependencies, @types/node, @types/three, typescript, vite (+19 more)

### Community 33 - "settings.ts"
Cohesion: 0.10
Nodes (26): ATXT_COL, BG_COL, clamp(), defaultAltitudeForTool(), defaultSettings(), EDIT_BUILDINGS, EDIT_COURSE, EDIT_OBJECTS (+18 more)

### Community 34 - "veg.ts"
Cohesion: 0.05
Nodes (65): groundH(), vegExtractPalette(), vegGroundFromSurface(), vegGroundHeightClassic8(), VegMaskImage, vegModelLookup(), vegReplant(), vegSyncPalette() (+57 more)

### Community 35 - "mtm2/index.js"
Cohesion: 0.08
Nodes (42): collideTruckRamp(), createRamp(), insideRamp(), pointVelocity(), pushOut(), rampEdges(), rampSlopeNormal(), toBody() (+34 more)

### Community 36 - "AppState"
Cohesion: 0.06
Nodes (29): BACKDROP_PATTERNS, TRACK_FIELDS, DocumentService, TrackListItem, Editor, EditorEvents, ModeContext, AppEvents (+21 more)

### Community 37 - "veg-far-card.ts"
Cohesion: 0.06
Nodes (52): asciiBytes(), be32(), cName(), encodePngRgba(), exactBlack(), hdTexQuantizeKeyed(), mrglSkipInts(), rdInt() (+44 more)

### Community 38 - "height-image.ts"
Cohesion: 0.06
Nodes (52): HEIGHTMAP_BAD_LENGTH, HEIGHTMAP_COARSE_FULL, heightmapExportBytes(), heightmapImportBytes(), bitrev(), Bytes, crc32(), CRC_TABLE (+44 more)

### Community 39 - "compilerOptions"
Cohesion: 0.08
Nodes (24): DOM, DOM.Iterable, ES2022, node, src, tests, vite/client, vite.config.ts (+16 more)

### Community 40 - "race.js"
Cohesion: 0.09
Nodes (54): ahead(), COUNTDOWN_S, createRace(), finishLap(), missedCheckpoint(), NO_BOX(), OFF_COURSE_FT, OFF_COURSE_PAST (+46 more)

### Community 41 - "heights.js"
Cohesion: 0.20
Nodes (14): coarseOfFine(), decodeMtm2HeightPng(), decodeMtm2Heights(), finish(), MTM2_FINE_CELL_FT, MTM2_H16_PER_FT, MTM2_RAW_LENGTH_16BIT, MTM2_RAW_LENGTH_8BIT (+6 more)

### Community 42 - "f32"
Cohesion: 0.14
Nodes (36): ddvRangeMessage(), ddxFloatText(), ddxParseFloat(), FOG_FIELDS, FOG_RANGES, FOG_WEATHERS, fogDialogDefaults(), fogDialogResult() (+28 more)

### Community 43 - "vegetation.ts"
Cohesion: 0.07
Nodes (46): vegModelInfo, surfaceFeet(), VEG_FLAG_CROSSFADE, VEG_FLAG_FACING, Vegetation, clumpHeadingIndex(), clumpScale(), clumpScene() (+38 more)

### Community 44 - "doc-handlers.ts"
Cohesion: 0.08
Nodes (32): cloneAssetSource(), TrackedFolder, documentBuffers(), AssetSource, findLostSurfaceSidecars(), isSrfPath(), isSurfaceMesh(), layeredModels() (+24 more)

### Community 45 - "water.js"
Cohesion: 0.83
Nodes (3): fixedSin(), table(), waterLevelFt()

### Community 46 - "el"
Cohesion: 0.09
Nodes (55): bindFileCommands(), report(), save(), saveAsFlow(), saveModified(), fallbackBytes(), DEFAULT_COLORS, append() (+47 more)

### Community 47 - "mtm/veg.js"
Cohesion: 0.11
Nodes (24): cstr(), emptyClumps(), emptyTrees(), i32(), isMtm2Veg(), keyValues(), latin1, parseMtm2Veg() (+16 more)

### Community 48 - "surface.js"
Cohesion: 0.12
Nodes (25): groundBoxHeightAt(), stepMovingObject(), rampHeightAt(), CUT_FACTORS, DEEP_WATER_TYPE, FROZEN_WATER_TYPE, SURFACE_MU, TERRAIN_CELLS (+17 more)

### Community 49 - "textures-mode.ts"
Cohesion: 0.12
Nodes (33): ViewPoint, groundBoxesMode(), outlineCells(), texturesMode(), boxAt(), clampBottom(), clampTop(), copyGroundBox() (+25 more)

### Community 50 - "recovery.js"
Cohesion: 0.18
Nodes (19): arcPoint(), atRestAction(), CARRY_S, cpuResetTruck(), FLIGHT_QUEUE_S, FLIGHT_S, headingTo(), HELI_IDLE_RPM (+11 more)

### Community 51 - "patterns-panel.ts"
Cohesion: 0.13
Nodes (22): TextureClip, Rect, clampRect(), copyRect(), Grid, recordGrid(), addTexture(), ascii() (+14 more)

### Community 53 - "surface-pick.ts"
Cohesion: 0.22
Nodes (14): pickCornerV(), pickPoint(), pickRay(), pickSurfaceV(), pickTriangle(), rayCoarseHit(), refineRayOnSurface(), V3 (+6 more)

### Community 54 - "TrackDocument"
Cohesion: 0.06
Nodes (42): DocEvents, TrackDocument, modelTextureUsage(), optimalPalette(), textureUsage(), WINDOWS_LOW_COLORS, fromBase64(), CUSTOM_PALETTE_INDEX (+34 more)

### Community 56 - "main.ts"
Cohesion: 0.12
Nodes (21): startAutosave(), bindComponents(), registerModes(), OPENPHOTEX_VERSION, assetWorker(), MapImage, terrainMap(), bindEditCommands() (+13 more)

### Community 57 - "decodePngSamples"
Cohesion: 0.24
Nodes (11): vegDecodeMask(), decodeTga(), stbiPngRgba(), hdTexDecodeRgba(), inflateZlib(), CHANNELS, decodePngSamples(), isPng() (+3 more)

### Community 58 - "encode.js"
Cohesion: 0.19
Nodes (18): buildFogMap(), MTM2_PALETTE_AUTHORED_COUNT, MTM2_PALETTE_FIRST_AUTHORED, MTM2_PALETTE_WHITE_INDEX, mtm2LevelPalette(), SYSTEM_HIGH, SYSTEM_LOW, colourCube() (+10 more)

### Community 59 - "smk.js"
Cohesion: 0.26
Nodes (15): bigCode(), Bits, BLOCK_RUNS, decodeTree(), level(), openSmk(), decodeAudio(), decodePalette() (+7 more)

### Community 60 - "JSTraxx and Traxx: parity checklist"
Cohesion: 0.11
Nodes (17): Deliberate changes, Dialogs, Edit menu, Edit modes, File menu, Files, Help menu, JSTraxx and Traxx: parity checklist (+9 more)

### Community 61 - "asset-worker.ts"
Cohesion: 0.06
Nodes (61): pickStored(), StoredFile, StoreSummary, summarizeStore(), createVfs(), find(), findByTitle(), Mount (+53 more)

### Community 62 - "inflate.js"
Cohesion: 0.22
Nodes (9): buildHuffman(), CL_ORDER, DIST_BASE, DIST_EXTRA, fixedTables(), Inflater, inflateRaw(), LEN_BASE (+1 more)

### Community 63 - "spline.js"
Cohesion: 0.22
Nodes (13): BA, BB, BC, BD, clamp16(), fillSegment(), floorDiv(), segBig() (+5 more)

### Community 64 - "object-dialogs.ts"
Cohesion: 0.08
Nodes (49): FogBox, GP_ANGLE, GP_HEIGHT, GP_INT, GP_MASS, GP_NAMES, GP_PITCH, GP_SIZEH (+41 more)

### Community 65 - "terrain-commands.ts"
Cohesion: 0.08
Nodes (34): ALL, bindTerrainCommands(), TERRAIN_FIELDS, HEIGHTMAP_BYTEORDER, HEIGHTMAP_CANNOT_OPEN, HEIGHTMAP_CANNOT_READ, HEIGHTMAP_EXPORT_CAPTION, HEIGHTMAP_EXPORT_FAILED (+26 more)

### Community 66 - "controls.js"
Cohesion: 0.27
Nodes (10): CONTROLS, DIFFICULTY, applyJoystick(), applyKeyboard(), CP3_STEER, deadZoned(), joystickSteer(), KEY_DT_SCALE (+2 more)

### Community 67 - "solveHullContacts"
Cohesion: 0.23
Nodes (18): boxInertia(), postStepBox(), stepBox(), toWorld(), AIR_DENSITY, add(), cross(), dot() (+10 more)

### Community 68 - "wtr.js"
Cohesion: 0.17
Nodes (14): readVegetationAndLakes(), sameBytes(), parseWtrLakes(), isWtr(), parseWtr(), r16(), r32(), WTR_FLAG_REFLECTIVE (+6 more)

### Community 69 - "damage.js"
Cohesion: 0.18
Nodes (11): DAMAGE_LEVEL_1_FORCE, DAMAGE_LEVEL_2_FORCE, DAMAGE_ZONES, damageLevelForForce(), dentUnits(), dentVertices(), MODEL_UNITS_PER_FT, recordZoneHit() (+3 more)

### Community 71 - "veg-planter.ts"
Cohesion: 0.08
Nodes (45): axisBuild(), AxisTable, buildLayerMap(), clampI(), colourHash(), Ctx, findOrAddSpecies(), gatherObstacles() (+37 more)

### Community 72 - "replay.js"
Cohesion: 0.19
Nodes (14): decoder, f(), numbers(), parseMtmReplay(), REPLAY_CRUSH_HEADING, REPLAY_CRUSH_VERSION, REPLAY_FRAME_TICKS, REPLAY_RING_RECORDS (+6 more)

### Community 73 - "mtm/write.d.ts"
Cohesion: 0.15
Nodes (13): Mtm2Lvl, Mtm2Sit, Mtm2SitBox, Mtm2SitCourseSegment, Mtm2SitRamp, Mtm2SitStadium, Mtm2SitTopCrush, Mtm2SitTruck (+5 more)

### Community 75 - "scenery.js"
Cohesion: 0.38
Nodes (10): bounds(), FLY_OBJECT_SNAP_TO_GROUND, numberOrNull(), parseFlySceneryObjects(), parseFlyScf(), decoder, flyTag(), flyTags() (+2 more)

### Community 76 - "mtm/sit.d.ts"
Cohesion: 0.14
Nodes (13): MtmLvl, MtmSit, SitArena, SitBox, SitCourse, SitCourseSegment, SitFog, SitLight (+5 more)

### Community 77 - "high-scores.js"
Cohesion: 0.29
Nodes (11): decipherBlock(), decipherHighScores(), encipherBlock(), encipherHighScores(), HIGH_SCORES_FILE, KEY, latin1, mul() (+3 more)

### Community 79 - "mod.js"
Cohesion: 0.25
Nodes (10): cString(), dec, finetuned(), MOD_MIX_GAIN, modChannels(), parseMod(), PERIODS, renderMod() (+2 more)

### Community 80 - "garage.js"
Cohesion: 0.22
Nodes (10): cloneCprSetup(), CPR_DEFAULT_SETUP, decoder, INTEGERS, numbers(), ORDER, parseCprGarage(), STOCK (+2 more)

### Community 81 - "lte.js"
Cohesion: 0.25
Nodes (10): decodeEvoLzw(), EVO_LITE_GRID, EVO_LITE_MAX_FILE, EVO_LITE_TERRAIN_BYTES, EVO_LZW_ENTRIES, EVO_LZW_MAX_OUTPUT, isEvoLite(), latin1 (+2 more)

### Community 82 - "terrain-gen16.ts"
Cohesion: 0.12
Nodes (25): buildLighting(), buildLte(), clampLight(), groundBoxLower(), LightingSettings, SUN_VECTORS, sunPosition(), boxColumns() (+17 more)

### Community 83 - "traxx-help.mjs"
Cohesion: 0.24
Nodes (9): cnt, convert(), esc(), files, helpDir, hpj, page(), SKIP (+1 more)

### Community 84 - "vegetation-dialog.ts"
Cohesion: 0.13
Nodes (37): VEG_UNMATCHED_WARN, VegPlantResult, cG(), VEG_COLLIDE_NONE, VEG_COLLIDE_TRUNK, VEG_COLOURNAME, VEG_MAX_CLUMPS_PER_TILE, VEG_MAX_ENTRIES (+29 more)

### Community 85 - "globe.js"
Cohesion: 0.13
Nodes (22): FLY_EQUATOR_ROW, FLY_QUADRANT_CELLS, FLY_TILE_CELLS, FLY_TILE_COLUMNS, FLY_TILE_DEGREES, flyColumnLongitude(), flyFolderName(), flyRowLatitude() (+14 more)

### Community 87 - "write-pod2.js"
Cohesion: 0.11
Nodes (31): ACTIONS, CRC32_MPEG2_INIT, crc32Mpeg2(), crc32Mpeg2Update(), CRC_TABLE, decoder, readPod2AuditRecords(), readPod2AuditTrail() (+23 more)

### Community 88 - "raw.js"
Cohesion: 0.29
Nodes (8): ACT_PALETTE_SIZE, actPaletteDepth(), decodeActPalette(), applyOpacityPlane(), decodeIndexedImage(), decodeRawTexture(), rawTextureSide(), SIDE_LIMITS

### Community 89 - "traxx-ui-art.mjs"
Cohesion: 0.28
Nodes (7): chunk(), crc32(), crcTable, icons, png(), src, strips

### Community 90 - "textures-panel.ts"
Cohesion: 0.11
Nodes (31): recordFields(), addAnimationFrame(), findAnimation(), findTexture(), TextureSelection, pod1ArtStemBudget(), textureAnimateDialog(), textureNameDialog() (+23 more)

### Community 91 - "drive-surface.test.ts"
Cohesion: 0.09
Nodes (27): cornerV(), fineV(), tileMinMaxU(), FINE_LOD_TILES, floorDiv(), hasFineLod(), SURFACE_LOD_32FT, SURFACE_LOD_8FT (+19 more)

### Community 92 - "traxx-stock-data.mjs"
Cohesion: 0.29
Nodes (6): header, numbers, palettes, res(), root, table()

### Community 93 - "sound.js"
Cohesion: 0.36
Nodes (7): decoder, lines(), parseKlp(), parseMtmAmbientSounds(), textOf(), weatherMaskIncludes(), writeKlp()

### Community 94 - "track-view.ts"
Cohesion: 0.07
Nodes (39): outlineFog(), outlineObject(), TraxxBox, TraxxFog, arrowSegments(), checkpointArrow(), checkpointWantsArrow(), lightArrow() (+31 more)

### Community 95 - "findAsset"
Cohesion: 0.12
Nodes (18): checkIntegrity(), findModelTexture(), afterFirstSlash(), findAsset(), sameAsset(), bitmapInfo(), buildPattern(), MAX_PATTERNS (+10 more)

### Community 96 - "course.d.ts"
Cohesion: 0.25
Nodes (7): CourseArc, CourseBuildOptions, CourseSegment, CourseStraight, GroundHeightFn, Point3, SitStraightInput

### Community 97 - "top-crush.js"
Cohesion: 0.15
Nodes (36): add(), cornerSlot(), createEdgeState(), cross(), dot(), edgeAgainstHull(), edgeAgainstTire(), edgeAgainstTruck() (+28 more)

### Community 98 - "cpr/road.d.ts"
Cohesion: 0.29
Nodes (6): CprLinePoint, CprRoad, CprRoadQuad, CprRoadWall, CprRoadWallPanel, Point

### Community 99 - "evo/sit.d.ts"
Cohesion: 0.29
Nodes (6): EvoCourseSegment, EvoPath, EvoPathPoint, EvoSit, EvoSitBox, EvoSitVehicle

### Community 100 - "bin-write.d.ts"
Cohesion: 0.29
Nodes (6): BinWriteFace, BinWriteGroup, BinWriteMaterial, BinWriteMaterial2, BinWriteModel, BinWriteResult

### Community 103 - "evo/ground.js"
Cohesion: 0.33
Nodes (5): blend(), EVO_SUB, EVO_SUB_FT, evoSmoothHeights(), W

### Community 104 - "edges.d.ts"
Cohesion: 0.29
Nodes (5): EdgeContext, EdgeForces, EdgeObstacle, EdgeState, V3

### Community 105 - "tiff.js"
Cohesion: 0.43
Nodes (6): decodeTiff(), isTiff(), readIfd(), scalar(), TAG, TYPE_SIZE

### Community 107 - "def.js"
Cohesion: 0.17
Nodes (20): TV_UNITS_PER_HEIGHT_STEP, decoder, DEF_SEPARATOR_OFFSETS, DEF_SEPARATORS, defPlacementToEditor(), findNextEnemyDefinitionHeaderLine(), isEnemyDefinitionHeaderLine(), isFixedDefinitionRecord() (+12 more)

### Community 108 - "track.d.ts"
Cohesion: 0.33
Nodes (5): CprCheckpointRole, CprTrackSurface, CprTrk, CprTtxEntry, CprWallLayer

### Community 110 - "cockpit.d.ts"
Cohesion: 0.33
Nodes (5): CockpitGauge, CockpitMirror, CockpitSection, MtmCockpitLayout, Rect

### Community 111 - "sound.d.ts"
Cohesion: 0.33
Nodes (5): KlpLoop, MtmAmbientSounds, MtmKlp, MtmLoopedSound, MtmOneShotSound

### Community 112 - "dfm.d.ts"
Cohesion: 0.33
Nodes (5): DfmInfluence, DfmLod, DfmModel, DfmPart, DfmTriangle

### Community 113 - "cpr/step.d.ts"
Cohesion: 0.33
Nodes (5): CprAids, CprSpec, CprState, CprTruckParams, CprTruckState

### Community 114 - "top-crush.d.ts"
Cohesion: 0.33
Nodes (5): CrushPart, SimTopCrush, TopCrushContext, TopCrushSource, V3

### Community 115 - "contacts.d.ts"
Cohesion: 0.33
Nodes (4): ContactBody, ContactResult, HullFriction, V

### Community 116 - "checkpoints.d.ts"
Cohesion: 0.33
Nodes (5): CheckpointBox, CheckpointBoxInput, ModelExtentsFn, Mtm2Checkpoint, Point3

### Community 118 - "cmd.d.ts"
Cohesion: 0.40
Nodes (4): CmdCorner, CmdFace, CmdModel, CmdPart

### Community 119 - "script.d.ts"
Cohesion: 0.40
Nodes (4): EvoScript, EvoScriptCall, EvoScriptCondition, EvoScriptRule

### Community 120 - "smf.d.ts"
Cohesion: 0.40
Nodes (4): SmfFrame, SmfGroup, SmfMaterial, SmfModel

### Community 121 - "trk.d.ts"
Cohesion: 0.40
Nodes (4): EvoTrk, EvoTrkColor, EvoTrkLight, EvoTrkSpec

### Community 122 - "bin.d.ts"
Cohesion: 0.40
Nodes (4): BinFace, BinMaterial, BinMaterial2, BinModel

### Community 123 - "replay.d.ts"
Cohesion: 0.33
Nodes (5): MtmReplay, MtmReplayCrush, MtmReplayRecord, MtmReplaySample, MtmReplayVehicle

### Community 124 - "pod/write.d.ts"
Cohesion: 0.40
Nodes (3): Pod1DirectoryEntry, PodWriteError, PodWriteErrorCode

### Community 125 - "spec.d.ts"
Cohesion: 0.40
Nodes (4): EvoGarage, EvoPartsResult, EvoVehicleSpec, Mtm2SpecInput

### Community 126 - "controls.d.ts"
Cohesion: 0.40
Nodes (4): ControlContext, ControlState, JoystickInput, KeyInput

### Community 127 - "truck/params.d.ts"
Cohesion: 0.40
Nodes (4): Mtm2TruckGeometry, Mtm2TruckParams, Mtm2TruckSetup, Triplet

### Community 128 - "state.d.ts"
Cohesion: 0.40
Nodes (4): AutopilotState, AxleState, Mtm2TruckState, TireState

### Community 131 - "palette-rank.d.ts"
Cohesion: 0.40
Nodes (4): PaletteCandidate, PaletteCandidateOptions, PaletteOrigin, PaletteTextureKind

### Community 132 - "Working on JSTraxx"
Cohesion: 0.50
Nodes (3): Commands, Rules, Working on JSTraxx

### Community 133 - "mod.d.ts"
Cohesion: 0.50
Nodes (3): ModSample, ModSong, RenderedMod

### Community 135 - "scenery.d.ts"
Cohesion: 0.50
Nodes (3): FlyObjectModel, FlySceneryManifest, FlySceneryObject

### Community 136 - "openphotex/index.d.ts"
Cohesion: 0.50
Nodes (3): cprSim, evoSim, mtm2Sim

### Community 137 - "geo.d.ts"
Cohesion: 0.50
Nodes (3): GeoCell, GeoTriangle, NocturneGeo

### Community 138 - "kfm.d.ts"
Cohesion: 0.50
Nodes (3): KfmCorner, KfmModel, KfmPolygon

### Community 139 - "set.d.ts"
Cohesion: 0.50
Nodes (3): NocturneSet, SetCamera, SetLight

### Community 140 - "pod2.d.ts"
Cohesion: 0.50
Nodes (3): Pod2AuditAction, Pod2AuditRecord, PodChecksumReport

### Community 141 - "types.d.ts"
Cohesion: 0.50
Nodes (3): PodArchive, PodEntry, PodFormat

### Community 142 - "evo/params.d.ts"
Cohesion: 0.50
Nodes (3): EvoGeometry, EvoSetup, EvoTruckParams

### Community 143 - "box.d.ts"
Cohesion: 0.50
Nodes (3): LevelBoxSource, ModelBounds, SimBox

### Community 144 - "truck-truck.d.ts"
Cohesion: 0.50
Nodes (3): TruckBody, TruckContact, V3

### Community 145 - "race.d.ts"
Cohesion: 0.50
Nodes (3): Race, RaceTruck, V3

### Community 146 - "drivetrain.d.ts"
Cohesion: 0.50
Nodes (3): GearboxContext, GearboxState, TorqueDriver

### Community 147 - "recovery.d.ts"
Cohesion: 0.50
Nodes (3): CarryRates, RecoveryAction, RecoveryContext

### Community 148 - "bundled-palettes.js"
Cohesion: 0.40
Nodes (5): BUNDLED_PALETTE_IDS, bundledPalette(), decodeBase64(), decoded, ENCODED

### Community 149 - "raw.d.ts"
Cohesion: 0.50
Nodes (3): DecodeRawTextureOptions, RawTextureFamily, RgbaImage

### Community 150 - "mtm-trk.d.ts"
Cohesion: 0.50
Nodes (3): MtmTrk, MtmTrkDialect, MtmTrkLight

### Community 151 - "def.d.ts"
Cohesion: 0.50
Nodes (3): DefDefinition, DefFile, DefPlacement

### Community 154 - "probe.js"
Cohesion: 0.49
Nodes (9): ascii(), audioSampleRate(), detectAudioFormat(), id3End(), mp3FrameAt(), MPEG1_RATES, oggRate(), u32() (+1 more)

### Community 231 - "box.js"
Cohesion: 0.17
Nodes (12): CORNERS, createBox(), createLevelBox(), GROUND_BOX_CELL_FT, groundBoxesAround(), MAX_GROUND_BOXES, NON_COLLIDING_TYPES, raceCheckpoints() (+4 more)

### Community 234 - "smk.d.ts"
Cohesion: 0.29
Nodes (4): SmkAudioTrack, SmkError, SmkFrame, SmkInfo

### Community 235 - "mtm/veg.d.ts"
Cohesion: 0.33
Nodes (5): Veg, VegClumps, VegGrassTile, VegSpecies, VegTrees

### Community 236 - "hb-qke.d.ts"
Cohesion: 0.60
Nodes (4): HbBoxQuake, HbGroundQuake, HbQuakeBase, HbQuakes

### Community 237 - "tnl.d.ts"
Cohesion: 0.40
Nodes (4): TunnelRing, TunnelSegment, TunnelSegmentGeometry, TvTunnel

### Community 239 - "wtr.d.ts"
Cohesion: 0.50
Nodes (3): Wtr, WtrLake, WtrWriteLake

### Community 252 - "instancing.ts"
Cohesion: 0.27
Nodes (11): VegPlantInput, familyOk(), materialProblem(), modelInstanceProblem(), ModelTextureOk, rd(), recordBytes(), vegFarCardBaseY() (+3 more)

### Community 254 - "truck-box.js"
Cohesion: 0.22
Nodes (27): collideBoxes(), toBody(), toWorld(), depthInside(), faceNormal(), FACES, HULL_ORDER, nearestFace() (+19 more)

### Community 256 - "ground-box-geometry.ts"
Cohesion: 0.19
Nodes (11): TxxGroundBox, BOTTOM, boxGrids(), groundBoxGeometry, SIDE_TRIS, SIDE_UV1, SIDE_UV2, TOP (+3 more)

### Community 262 - "mtm/write.js"
Cohesion: 0.11
Nodes (31): decoder, MTM2_SAVED_GAME_HEADER, parseMtm2SavedGame(), writeMtm2SavedGame(), formatSitFogLine(), SIT_FOG_HEADER, buildMtm2Lte(), clean() (+23 more)

### Community 263 - "Viewport"
Cohesion: 0.21
Nodes (4): applyTraxxCamera(), FOCAL_480, FOV_Y, Viewport

### Community 271 - "player-pro.js"
Cohesion: 0.33
Nodes (5): decoder, newMtmDriver(), parseMtmPlayerPro(), PLAYER_PRO_VERSION, writeMtmPlayerPro()

## Knowledge Gaps
- **850 isolated node(s):** `name`, `version`, `private`, `description`, `license` (+845 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **73 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `el()` connect `el` to `object-dialogs.ts`, `terrain-commands.ts`, `lakes.ts`, `hd-texture.ts`, `AppState`, `transitions-panel.ts`, `special-commands.ts`, `components-dialog.ts`, `objects-mode.ts`, `f32`, `tool-bars.ts`, `terrain-gen16.ts`, `patterns-panel.ts`, `vegetation-dialog.ts`, `context-menu.ts`, `main.ts`, `textures-panel.ts`, `terrain-mode.ts`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `writePod1()` connect `asset-worker.ts` to `openphotex/index.js`, `components-dialog.ts`, `el`, `write-pod2.js`, `load-pod.ts`, `pod-writer.ts`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `decodePngSamples()` connect `decodePngSamples` to `openphotex/index.js`, `veg-far-card.ts`, `height-image.ts`, `veg-planter.ts`, `heights.js`, `load-pod.ts`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _850 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `openphotex/index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.028105482303955587 - nodes in this community are weakly interconnected._
- **Should `hd-texture.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07175141242937853 - nodes in this community are weakly interconnected._
- **Should `lakes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08874912648497554 - nodes in this community are weakly interconnected._