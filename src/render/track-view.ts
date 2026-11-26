/*
  The open track in the 3D view: the terrain and its tiles, objects, ground boxes, water, the
  backdrop, the camera, and the View Controls and options that act on them.

  What shows follows Traxx: objects in Objects mode or with Always Show Objects (F6), ground
  boxes in Groundbox mode or with Always Show Ground Boxes (F7), water with Show Water (F8),
  the backdrop with Show Backdrop (F9). Traxx 1.7.2: the sun marker with View > Show Sun; Traxx
  1.7.3: the camera's field of view from View > Field of View.
*/
import * as THREE from "three";
import type { TrackDocument } from "../core/doc/document.ts";
import type { AppState } from "../app/state.ts";
import { TraxxCamera, cameraMaxZ, objectsHighZ, terrainZRange } from "../core/view/camera.ts";
import { heightLimit, tallHeights } from "../core/traxx/track-kind.ts";
import { cellsOf, isWideGrid, worldFtOf } from "../core/traxx/world.ts";
import { fallWorldOf } from "../core/traxx/v6.ts";
import { buildTileSet, gammaMap, type RgbaImage, type TileSet } from "../core/view/tiles.ts";
import { cameraGround } from "../core/traxx/box-ground.ts";
import { checkpointLabelEnds, checkpointLabelPx, checkpointLabelText, CP_LABEL_PX } from "../core/view/checkpoint-label.ts";
import { BG_COL, EDIT_BUILDINGS, EDIT_OBJECTS, GRID_MAX, WIRE_COL, WIREO_COL, wantedGridSize, type TraxxSettings } from "../core/settings.ts";
import { TerrainMesh } from "./terrain.ts";
import { Viewport } from "./viewport.ts";
import { decodeHd } from "./hd-decode.ts";
import { ModelLibrary } from "./models.ts";
import { ObjectLayer } from "./objects.ts";
import { GroundBoxLayer } from "./ground-boxes.ts";
import { FogBoxLayer, type FogDrawVolume } from "./fog-boxes.ts";
import { effectiveFog, fogDriftArrow, fogVolumeCorners, fogVolumeRing, FOG_DRIFT_COLOUR, FOG_RING, type FogPreview } from "../core/view/fog-volume.ts";
import { engineFogAmbient, engineFogDrawn, engineFogParamsOf } from "../core/view/engine-fog.ts";
import { mistDrawPlan, mistFog, mistFogId, mistFogParams, mistRegistered, type MistFogVol } from "../core/traxx/fall-mist.ts";
import { fallEffectiveHeight, FALL_MAX_FALLS, FALL_MAX_POINTS, FALLWARN_DROPPED } from "../core/traxx/falls.ts";
import { TRAXX_BOX_FOG } from "../core/traxx/sit.ts";
import { WaterLayer, LakesLayer, type LakeWallGround } from "./water.ts";
import { VegetationLayer } from "./vegetation.ts";
import { vegWindow } from "../core/view/veg-draw.ts";
import { tileMinMaxU } from "../core/traxx/surface.ts";
import { hasFineLod, SurfaceTileGrids } from "../core/view/surface-tiles.ts";
import { TERRAINMODE_CLASSIC8 } from "../core/traxx/terrain16.ts";
import { trackLakes, lakeNotchEdgesOf } from "../core/traxx/lakes.ts";
import { BackdropLayer } from "./backdrop.ts";
import { WaterfallsLayer } from "./waterfalls.ts";
import { WallsLayer } from "./walls.ts";
import { wallDrawList } from "../core/view/wall-draw.ts";
import { exportWallGround } from "../core/traxx/pod-writer.ts";
import { EDIT_WALLS } from "../core/settings.ts";
import { FallShapeCache, fallPreviewList, fallViewShift } from "../core/view/fall-shapes.ts";
import { fallGroundFor, fallNameInPod } from "../core/traxx/falls.ts";
import { buildLakeGround } from "../core/traxx/surface.ts";
import { CourseLayer } from "./course.ts";
import { Overlay2D } from "./overlay.ts";
import { arrowSegments, checkpointArrow } from "../core/view/arrows.ts";
import { checkpointRaceLabels, checkpointShowsArrow, courseLines } from "../core/edit/race-edit.ts";
import { objectMatrix } from "../core/view/model-geometry.ts";
import { pickSurface, pickTerrain, type TerrainHit } from "../core/view/pick.ts";
import { drivableMeshes, pickMesh, type DrivableMesh } from "../core/view/mesh-pick.ts";
import { EDIT_COURSE } from "../core/settings.ts";
import { ALTITUDE_SCALE } from "../core/view/camera.ts";
import type { Touch } from "../core/edit/history.ts";
import { SunMarker } from "./sun-marker.ts";
import { glowLightsOf, LightGlowLayer } from "./light-glows.ts";
import { SkyLayer } from "./sky.ts";
import { TerrainDetail } from "./terrain-detail.ts";
import type { GamePods } from "../core/view/game-pods.ts";
import { MTM2_ONLY } from "../core/doc/document.ts";
import { TRAXX_BOX_LIGHT, type TraxxBox, type TraxxLight } from "../core/traxx/sit.ts";
import { trackLighting } from "../core/edit/lighting.ts";

/* The object draw window is the grid window capped at 256 cells (TRAXX_GL_OBJECT_CULL_GRID). */
const OBJECT_CULL_GRID = 256;

export class TrackView {
  readonly viewport: Viewport;
  readonly camera = new TraxxCamera();
  private doc: TrackDocument | null = null;
  private terrain: TerrainMesh | null = null;
  private tiles: TileSet | null = null;
  private models: ModelLibrary | null = null;
  /** The placed models trucks drive on (core/view/mesh-pick.ts), built when first picked; null after a change. */
  private drivable: DrivableMesh[] | null = null;
  private objects: ObjectLayer | null = null;
  private groundBoxes: GroundBoxLayer | null = null;
  private water = new WaterLayer();
  private lakes = new LakesLayer();
  private backdrop = new BackdropLayer();
  private course = new CourseLayer();
  private fogBoxes = new FogBoxLayer();
  private vegetation = new VegetationLayer();
  private waterfalls = new WaterfallsLayer();
  /** Traxx 1.8.2: the walls (DrawWallsOpenGL), and the Walls mode's hover and capture (wallhw, wallhp, wallcappt). */
  private walls = new WallsLayer();
  private wallState: { hotWall: number; hotPoint: number; capture: [number, number][] | null } = { hotWall: -1, hotPoint: -1, capture: null };
  /** The falls' shapes and errors (FallShapesEnsure), shared with the Waterfall window. */
  readonly fallShapes = new FallShapeCache();
  /** The fall whose window is open (fallhighlight) and the crest being captured, in 1/16 ft. */
  private fallState: { highlight: number; capture: [number, number][] | null } = { highlight: -1, capture: null };
  /** The frame's mist plan (DrawWaterfallsOpenGL's g_mistplan): per fall its fog records, the streams drawn, its view shift. */
  private mistPlan: { plans: MistFogVol[][]; draw: number[]; shift: [number, number][] } = { plans: [], draw: [], shift: [] };
  /** The fog a properties dialog is previewing (CTraxxView::SetFogPreview), or null. */
  private fogPreview: FogPreview | null = null;
  readonly overlay: Overlay2D;
  /** View > Show Sun's disc (DrawSunMarker), drawn after the scene. */
  private sunMarker = new SunMarker();
  /** View > Show Light Glows (DrawLightGlows), drawn after the fog volumes. */
  private lightGlows = new LightGlowLayer();
  /** The detail-map shading's inputs (GLDetailMaps), Traxx 1.8.0. */
  private detail = new TerrainDetail();
  /** View > Show Sky (DrawSky), drawn first. */
  private sky = new SkyLayer();
  /** The light a properties dialog is previewing (EffectiveLight), or null. */
  private lightPreview: { box: TraxxBox; light: TraxxLight; isLight: boolean } | null = null;
  /** The game's art, read-only through the Game Library (GamePods), or null before the library is up. */
  private gamePods: GamePods | null = null;
  /** The status notes last given (LightGlowNote, SkyNote), so each is said once. */
  private notes = { glow: "", sky: "" };
  /** The truck selected in Course mode (1..8), or -1. */
  selectedTruck = -1;
  /** Decoded HD art by texture name (upper case): indices move when textures are added or removed. */
  private hd = new Map<string, RgbaImage | null>();
  private modelHd = new Map<number, RgbaImage>();
  private mask: { width: number; height: number; grey: Uint8Array } | null = null;
  private frames: number[] = [];
  private app: AppState;
  private lastTick = 0;
  private listeners: (() => void)[] = [];
  private objectWindow = "";
  /** The camera's tile the lake walls and the mask wash were laid on (currentLodKey). */
  private lodKey = "";

  constructor(host: HTMLElement, app: AppState) {
    this.app = app;
    this.viewport = new Viewport(host);
    this.viewport.onBeforeRender(() => this.step());
    // The fog pass for the camera as placed: order, the nearest 16, the slices (DrawFogVolumes).
    this.viewport.onBeforeRender(() => this.fogBoxes.update(this.viewport.camera));
    this.viewport.scene.add(this.water.group, this.lakes.mesh, this.lakes.walls, this.lakes.marks, this.backdrop.arena, this.course.group, this.fogBoxes.group, this.vegetation.group, this.waterfalls.group, this.walls.group);
    this.overlay = new Overlay2D(host, this.viewport.camera);
    // Traxx 1.8.0: every light's glow and cone after the fog volumes, not over a wireframe.
    this.lightGlows.onLoaded = () => this.viewport.requestRender();
    this.sky.onLoaded = () => this.viewport.requestRender();
    this.detail.onReady = () => this.applyDetail();
    this.viewport.onAfterRender(() => {
      const s = this.app.settings;
      if (!this.doc || !s.show_light_glows || s.edit.wireframe === 1 || !this.fogActive()) { this.lightGlows.note = ""; }
      else {
        const t = this.doc.track;
        const lights = glowLightsOf(t.boxes, (box) => (this.lightPreview && this.lightPreview.box === box ? this.lightPreview : { light: box.light, isLight: box.type === TRAXX_BOX_LIGHT }));
        this.lightGlows.render(this.viewport.renderer, this.viewport.camera, lights, s.preview_weather, this.gamePods, t.palette, (t.versionFlags & MTM2_ONLY) === 0);
      }
      this.say("glow", this.lightGlows.note);
    });
    // The sun after the scene, at the far plane against its depth (pod.sunvec, or Traxx's defaults).
    this.viewport.onAfterRender(() => {
      if (!this.doc || !this.app.settings.show_sun) return;
      const c = this.viewport.canvas;
      this.sunMarker.render(this.viewport.renderer, this.viewport.camera, trackLighting(this.doc.track).sun, c.clientWidth, c.clientHeight);
    });
    this.viewport.onAfterRender(() => this.overlay.draw());
    this.overlay.add((g, project) => this.drawLabels(g, project));
    this.overlay.add((g) => this.drawFps(g));
    app.on("settings", (s) => this.applySettings(s));
    app.on("mode", () => { this.applyVisibility(); this.rebuildCourse(); });
    app.on("tools", () => this.rebuildCourse());
    this.applySettings(app.settings);
  }

  /** The Game Library as the engine's pods (GamePods): the sky and the light glows read their art there. */
  setGamePods(pods: GamePods | null): void {
    this.gamePods = pods;
    this.viewport.requestRender();
  }

  /* DrawSky for the track as it is, then its note. */
  private drawSky(renderer: THREE.WebGLRenderer, backdrop: boolean): void {
    const doc = this.doc;
    if (!doc) return;
    const t = doc.track, c = this.viewport.canvas;
    this.sky.render(renderer, this.viewport.camera, {
      weather: this.app.settings.preview_weather, palette: t.palette, levelType4: (t.versionFlags & MTM2_ONLY) === 0,
      sun: trackLighting(t).sun, backdrop,
    }, this.gamePods, c.clientWidth, c.clientHeight);
    this.say("sky", this.sky.note);
  }

  /** A properties dialog's working light (EffectiveLight), drawn in place of the box's own; null ends it. */
  setLightPreview(preview: { box: TraxxBox; light: TraxxLight; isLight: boolean } | null): void {
    this.lightPreview = preview;
    this.viewport.requestRender();
  }

  /* A status-bar note (SetMessageText) when it changes; nothing when it goes. */
  private say(which: "glow" | "sky", note: string): void {
    if (this.notes[which] === note) return;
    this.notes[which] = note;
    if (note) this.app.status(note);
  }

  /** Called whenever the camera moved or turned. */
  onCameraChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  /*
    The grid window's size (Traxx 1.8.2 CTraxxReg::WantedGridSize): the Grid size slider, 256 x 256,
    or the whole world (256 with no track, ViewWorldN). A track format version 6 world of 512
    cells is 512 cells whole (spec section 8.1); the slider keeps its 256 cap, and the object
    window its own (OBJECT_CULL_GRID).
  */
  private gridSizeOf(s: TraxxSettings): number {
    return wantedGridSize(s, this.doc ? cellsOf(this.doc.track) : GRID_MAX);
  }

  /* The camera's world and z range (TraxxCamera.setWorld) for the track as it is. */
  private placeWorld(): void {
    if (!this.doc) return;
    const t = this.doc.track;
    // Only a version 6 32-bit store can hold ground beyond 0..512 ft; a 16-bit or 8-bit track
    // is always inside Traxx's range, so its grid is not scanned on every edit.
    const [lo, hi] = isWideGrid(t.h16) || isWideGrid(t.fine) ? terrainZRange(t) : [0, 0];
    // JSTraxx (not Traxx): the headroom also counts the highest object, so a track built of objects
    // high above its ground (a sky track on flat terrain) can be reached and looked down on.
    this.camera.setWorld(cellsOf(t), lo, Math.max(hi, objectsHighZ(t.boxes)), cameraMaxZ(tallHeights(t), heightLimit(t)));
    this.viewport.setFarFor(cellsOf(t) << 6, this.camera.zMax - this.camera.zMin);
  }

  /* The camera's ground in steps: whole on Classic 8-bit, v / 256 on the drive surface (cameraGround). */
  readonly groundAt = (x: number, y: number) => (this.doc ? cameraGround(this.doc.track, x, y) : 0);

  async open(doc: TrackDocument | null): Promise<void> {
    this.clear();
    this.doc = doc;
    if (!doc) { this.viewport.requestRender(); return; }
    this.placeWorld();
    this.camera.resetForTrack(this.groundAt);
    this.terrain = new TerrainMesh(doc.track);
    this.viewport.scene.add(this.terrain.group);
    this.groundBoxes = new GroundBoxLayer(this.terrain.siblingMaterial());
    this.viewport.scene.add(this.groundBoxes.mesh);
    this.rebuildWater();
    this.detail.open(doc);
    this.fallState = { highlight: -1, capture: null };
    this.fallShapes.invalidate();
    this.rebuildFalls();
    this.rebuildWalls();
    this.buildModels();
    this.rebuildTiles();
    this.applySettings(this.app.settings);
    this.changed();
    // HD art decodes in the background; tiles and models are rebuilt once it is in.
    const terrainHd = this.decodeTerrainHd(doc);
    const modelHd = this.models!.loadHd();
    if (doc.track.maskMap && doc.track.maskExt.toUpperCase() === ".PNG") {
      void decodeHd({ ext: "PNG", data: doc.track.maskMap }).then((img) => {
        if (!img || this.doc !== doc) return;
        const grey = new Uint8Array(img.width * img.height);
        for (let i = 0; i < grey.length; i++) grey[i] = Math.round(0.299 * img.rgba[i * 4] + 0.587 * img.rgba[i * 4 + 1] + 0.114 * img.rgba[i * 4 + 2]);
        this.mask = { width: img.width, height: img.height, grey };
        this.terrain?.setMask(this.mask, this.app.settings.show_mask_overlay);
        this.viewport.requestRender();
      });
    }
    const decoded = await terrainHd;
    if (this.doc !== doc) return;
    if (decoded) this.rebuildTiles();
    if (await modelHd) { if (this.doc === doc) this.buildModels(); }
  }

  private clear(): void {
    if (this.terrain) { this.viewport.scene.remove(this.terrain.group); this.terrain.dispose(); }
    if (this.groundBoxes) { this.viewport.scene.remove(this.groundBoxes.mesh); this.groundBoxes.dispose(); }
    if (this.objects) { this.viewport.scene.remove(this.objects.group); this.objects.dispose(); }
    this.models?.dispose();
    this.terrain = null; this.groundBoxes = null; this.objects = null; this.models = null; this.tiles = null; this.drivable = null;
    this.water.rebuild(new Uint8Array(65536), 0);
    this.lakes.rebuild(null, [], []);
    this.waterfalls.rebuild([], 0, 0);
    this.walls.rebuild([], 0, 0);
    this.wallState = { hotWall: -1, hotPoint: -1, capture: null };
    this.vegetation.build(null, null);
    this.backdrop.scene.clear();
    this.backdrop.arena.clear();
    this.course.group.clear();
    this.fogPreview = null;
    this.mistPlan = { plans: [], draw: [], shift: [] };
    this.fogBoxes.setVolumes([], false);
    this.fogKey = "";
    this.viewport.backdrop = null;
    this.hd.clear();
    this.modelHd.clear();
    this.mask = null;
  }

  /** Models, objects, backdrop and arena: built again after a gamma or model change. */
  private buildModels(): void {
    const doc = this.doc;
    if (!doc) return;
    const s = this.app.settings;
    if (this.objects) { this.viewport.scene.remove(this.objects.group); this.objects.dispose(); }
    this.models?.dispose();
    const models = new ModelLibrary(doc, s.gamma, this.modelHd);
    models.transparency = s.model_transparency;
    this.models = models;
    this.drivable = null;
    this.objects = new ObjectLayer(doc, models, s.gamma);
    this.objects.hideColliders = s.hide_colliders;
    this.viewport.scene.add(this.objects.group);
    this.backdrop.build(models, [doc.track.backdropName, ...doc.track.extraBackdrops], doc.track.arena ? { x: doc.track.arena.x, y: doc.track.arena.y } : null, doc.track.heights);
    // The vegetation draws with the same models (its species are in the model list).
    this.vegetation.build(doc, models);
    this.objectWindow = "";
    this.updateWindow();
    this.applyVisibility();
  }

  /** The course lines and trucks, for the window and the course being edited. */
  rebuildCourse(): void {
    if (!this.doc) return;
    const s = this.app.settings;
    const gridsize = this.gridSizeOf(s);
    const half = (gridsize - 1) >> 1;
    const { gridx, gridy } = this.camera;
    this.course.rebuild(this.doc, { course: this.app.tools.course, alwaysMain: this.app.tools.alwaysMain, selectedTruck: this.selectedTruck },
      { minx: (gridx - half) << 6, maxx: (gridx + half) << 6, miny: (gridy - half) << 6, maxy: (gridy + half) << 6 });
    this.viewport.requestRender();
  }

  /*
    Screen text: the segment numbers (white, 5 pixels under each segment's start;
    CTraxxView::OverlayCourse) and, in Objects mode, "CP nn" on every checkpoint, numbered in
    object order (OverlayCheckpoints).
  */
  private drawLabels(g: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => { x: number; y: number } | null): void {
    const doc = this.doc;
    if (!doc) return;
    const s = this.app.settings, mode = this.app.mode, t = doc.track;
    g.font = "12px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#ffffff";
    const gridsize = this.gridSizeOf(s);
    const half = (gridsize - 1) >> 1;
    const inside = (x: number, y: number) => Math.abs((x >> 6) - this.camera.gridx) <= half && Math.abs((y >> 6) - this.camera.gridy) <= half;
    if (mode === EDIT_COURSE || s.always_course) {
      const { course, alwaysMain } = this.app.tools;
      // Traxx 1.8.2 (OverlayCourse): the passes follow the lanes; a line's name ("Lane 1", "Lane 2",
      // "Lead-in -> Lane N") sits 21 pixels under its first segment's start, under the index.
      for (const line of courseLines(t.trackType, t.raceRules, course, alwaysMain)) {
        const list = line.which === 0 ? t.course : t.extendedCourses[line.which - 1] ?? [];
        list.forEach((seg, i) => {
          if (!inside(seg.cstart[0], seg.cstart[1])) return;
          const p = project(seg.cstart[0], seg.cstart[1], ALTITUDE_SCALE * seg.cstart[2]);
          if (!p) return;
          g.fillText(String(i), p.x, p.y + 5);
          if (i === 0 && line.label) g.fillText(line.label, p.x, p.y + 21);
        });
      }
    }
    // OverlayFogDrift: every fog's wisp drift arrow while the fog volumes are drawn.
    if (mode === EDIT_OBJECTS || s.always_objects) {
      g.save();
      g.strokeStyle = FOG_DRIFT_COLOUR;
      for (const box of t.boxes) {
        const { fog, isFog } = effectiveFog(box, this.fogPreview);
        const arrow = isFog ? fogDriftArrow(box, fog) : null;
        if (arrow) for (const [a, b] of arrow) {
          const pa = project(a[0], a[1], a[2]), pb = project(b[0], b[1], b[2]);
          if (pa && pb) { g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pb.x, pb.y); g.stroke(); }
        }
      }
      g.restore();
    }
    if (mode === EDIT_OBJECTS) {
      let cp = 0;
      // Traxx 1.8.2: with race rules the label is CpxFormatLabel of the slot ("*" on the main copy) and every gate has its arrow.
      const raceLabels = checkpointRaceLabels(t.boxes, t.raceRules.mode);
      const labelRules = raceLabels ? { label: (k: number) => raceLabels[k] ?? null } : null;
      for (const box of t.boxes) {
        if (box.type !== 6) continue;
        const n = cp++;
        if (!inside(box.ipos[0], box.ipos[1])) continue;
        // The arrow through a gate without a model first, so the number reads over it.
        if (!box.modelName && checkpointShowsArrow(t.trackType, t.raceRules.mode, n)) {
          g.save();
          g.strokeStyle = "#00ff00";
          for (const [a, b] of arrowSegments(checkpointArrow(box), objectMatrix(box))) {
            const pa = project(a[0], a[1], a[2]), pb = project(b[0], b[1], b[2]);
            if (pa && pb) { g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pb.x, pb.y); g.stroke(); }
          }
          g.restore();
        }
        const p = project(box.ipos[0] + box.fraction[0] / 256, box.ipos[1] + box.fraction[1] / 256, 3 * (box.ipos[2] + box.fraction[2] / 256));
        if (!p) continue;
        // Traxx 1.8.2 (94ebfe5, OverlayCheckpoints): a model-less gate's label shrinks with its on-screen width.
        const label = checkpointLabelText(n, labelRules);
        let ends: [{ x: number; y: number }, { x: number; y: number }] | null = null;
        if (!box.modelName) {
          const m = objectMatrix(box);
          const [e0, e1] = checkpointLabelEnds(box).map(([x, y, z]) => project(
            m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!));
          if (e0 && e1) ends = [e0, e1];
        }
        const px = checkpointLabelPx(ends, (size) => { g.font = `${size}px Arial, sans-serif`; return g.measureText(label).width; });
        if (px === null) continue;
        g.font = px === CP_LABEL_PX ? "12px system-ui, sans-serif" : `${px}px Arial, sans-serif`;
        g.fillText(label, p.x, p.y);
      }
    }
  }

  /* Display FPS (Options > Advanced): frames over the last half second, top right, yellow. */
  private drawFps(g: CanvasRenderingContext2D): void {
    if (!this.app.settings.display_fps) return;
    const now = performance.now();
    this.frames.push(now);
    while (this.frames.length && now - this.frames[0] > 500) this.frames.shift();
    const fps = this.frames.length > 1 ? (1000 * (this.frames.length - 1)) / (now - this.frames[0]) : 0;
    g.font = "12px system-ui, sans-serif";
    g.textAlign = "right";
    g.fillStyle = "#ffff00";
    g.fillText(`FPS ${fps.toFixed(1)}`, g.canvas.clientWidth - 8, 16);
  }

  /** Redraw what a change touched (core/edit/history.ts). */
  refresh(touch: Touch): void {
    if (!this.doc) return;
    if (touch.palette || touch.textures) this.rebuildTiles();
    if (touch.textures) {
      const doc = this.doc;
      void this.decodeTerrainHd(doc).then((any) => { if (any && this.doc === doc) this.rebuildTiles(); });
    }
    if (touch.palette || touch.models) this.buildModels();
    if (touch.models) {
      const doc = this.doc;
      void this.models?.loadHd().then((any) => { if (any && this.doc === doc) { this.buildModels(); this.viewport.requestRender(); } });
    }
    if (touch.heights) { this.terrain?.updateLevels(); this.placeWorld(); this.detail.heightsChanged(); }
    else if (touch.objects) this.placeWorld();
    // Track Components may have replaced a map; the lighting may have changed (the light texture's key).
    if (touch.track) this.detail.refresh();
    this.applyDetail();
    for (const r of [touch.heights, touch.clr]) if (r) this.terrain?.updateCells(r.minX, r.minY, r.maxX, r.maxY);
    if (touch.heights || touch.water || touch.falls) this.rebuildWater();
    // The falls' ground, water and lake tiles (and the notches their crests cut) follow.
    if (touch.heights || touch.water || touch.falls) this.fallShapes.invalidate();
    if (touch.textures || touch.track) this.fallShapes.rejudge();
    if (touch.heights || touch.water || touch.falls || touch.textures || touch.track) this.rebuildFalls();
    // The walls stand on the ground under each point (TraxxViewWalls.cpp: no cache, every frame).
    if (touch.walls || touch.heights || touch.track) this.rebuildWalls();
    if (touch.heights) { this.vegetation.invalidate(); this.updateVegetation(); }
    if (touch.objects || touch.groundBoxes || touch.heights) this.objectsChanged();
    if (touch.course || touch.trucks) this.rebuildCourse();
    if (touch.track && !touch.palette) this.buildModels();
    this.viewport.requestRender();
  }

  /** A point in the scene on the view, in CSS pixels from its top left; null when behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.viewport.camera);
    if (v.z > 1 || v.z < -1) return null;
    const r = this.viewport.canvas;
    return { x: ((v.x + 1) / 2) * r.clientWidth, y: ((1 - v.y) / 2) * r.clientHeight };
  }

  /**
    InputToScreenPoint with its depth (Traxx 1.8.2's outline pick): the point on screen in CSS
    pixels and its camera depth in scene units (64 a 32 ft cell; Traxx's are 64 times finer), or
    null behind the camera.
  */
  projectDepth(x: number, y: number, z: number): { x: number; y: number; depth: number } | null {
    const cam = this.viewport.camera;
    cam.updateMatrixWorld();
    const v = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    const depth = -v.z;
    if (!(depth > 0)) return null;
    v.applyMatrix4(cam.projectionMatrix);
    const r = this.viewport.canvas;
    return { x: ((v.x + 1) / 2) * r.clientWidth, y: ((1 - v.y) / 2) * r.clientHeight, depth };
  }

  /** The view's size in CSS pixels. */
  get size(): { width: number; height: number } {
    return { width: this.viewport.canvas.clientWidth, height: this.viewport.canvas.clientHeight };
  }

  /** The ground-box face under a point: [box index, face 0..5], or null (SelectBuilding). */
  pickGroundBox(clientX: number, clientY: number): [number, number] | null {
    const gb = this.groundBoxes;
    if (!gb?.geometry || !gb.mesh.visible) return null;
    const r = this.viewport.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.viewport.camera);
    const hit = ray.intersectObject(gb.mesh, false)[0];
    if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return null;
    const f = gb.geometry.faceOf[hit.faceIndex];
    return [f >> 3, f & 7];
  }

  requestRender(): void {
    this.viewport.requestRender();
  }

  /** The view as it is, overlay included, for File > Print (saved as a PNG). */
  snapshot(): Promise<HTMLCanvasElement> {
    return this.viewport.capture([this.overlay.canvas]);
  }

  /** A model's meshes as the view has them (the Models window's preview), or null. */
  modelMeshes(name: string) {
    return this.models?.meshesFor(name) ?? null;
  }

  /** A model's geometry as the view has it (for outlines and Apply Model), or null. */
  modelGeometry(name: string) {
    return this.models?.meshesFor(name)?.geometry ?? null;
  }

  /** Objects inside the object draw window, nearest last (SortBoxes, for Tab). */
  objectsByDepth(): number[] {
    const doc = this.doc;
    if (!doc) return [];
    const s = this.app.settings;
    const gridsize = this.gridSizeOf(s);
    const oh = (Math.min(gridsize, OBJECT_CULL_GRID) - 1) >> 1;
    const { gridx, gridy } = this.camera;
    const cam = this.viewport.camera.position;
    return doc.track.boxes
      .map((b, i) => ({ i, b }))
      .filter(({ b }) => Math.abs((b.ipos[0] >> 6) - gridx) <= oh && Math.abs((b.ipos[1] >> 6) - gridy) <= oh)
      .map(({ i, b }) => ({ i, d: Math.hypot(b.ipos[0] - cam.x, b.ipos[1] - cam.y, 3 * b.ipos[2] - cam.z) }))
      .sort((a, b) => b.d - a.d)
      .map((x) => x.i);
  }

  /*
    DrawWaterfallsOpenGL: every fall (and the crest being captured) from the shape cache, shifted
    for the grid centre. Not drawn over a wireframe, as Traxx's `if (!wireframe)`.
  */
  rebuildFalls(): void {
    const doc = this.doc;
    if (!doc) return;
    const t = doc.track;
    const capture = this.fallState.capture;
    if (!t.falls.length && !capture) { this.waterfalls.rebuild([], 0, 0); this.mistPlan = { plans: [], draw: [], shift: [] }; this.rebuildFog(); return; }
    // Track format version 6 (spec 9.3): the falls are judged and walked in the track's N world.
    this.fallShapes.ensure(t, () => (t.lakes.length ? trackLakes(t) : null), fallNameInPod(t.sounds, doc.textures, doc.modelTextures), () => buildLakeGround(t),
      () => fallWorldOf(t));
    const g = fallGroundFor(t, null, this.fallShapes.world);
    const list = fallPreviewList(t, this.fallShapes, g, this.fallState.highlight, capture);
    const mistDim = this.planMist(list, g);
    this.waterfalls.rebuild(list, this.camera.gridx, this.camera.gridy, worldFtOf(cellsOf(t)), mistDim);
    this.rebuildFog();
    this.viewport.requestRender();
  }

  /** The fog pass runs (DrawFogVolumesOpenGL's condition): the objects are shown. */
  private fogActive(): boolean {
    return this.app.mode === EDIT_OBJECTS || this.app.settings.always_objects;
  }

  /*
    Traxx 1.8.0 (35b087b) DrawWaterfallsOpenGL's mist plan: a fall the engine registers mist for
    (mistRegistered) goes through mistFog, whose records the fog pass draws; the slots after the
    fog boxes go landing-outer, fall-inner (mistDrawPlan). In the preview a stream the fog pass
    draws has no outline (the volume carries its own guides); one it does not draw keeps it, dim
    and dashed, as does every stream of a DROPPED fall. Returns the dim bits per preview entry and
    rewrites `list`'s mist outlines. Without the fog pass every outline is plain.
  */
  private planMist(list: ReturnType<typeof fallPreviewList>, g: ReturnType<typeof fallGroundFor>): number[] {
    const doc = this.doc!;
    const t = doc.track;
    const n = Math.min(t.falls.length, FALL_MAX_FALLS);
    const active = this.fogActive() && this.app.settings.edit.wireframe !== 1;
    const plans: MistFogVol[][] = [], index: number[] = [], shift: [number, number][] = [];
    const dim = list.map(() => 0);
    const worldFt = worldFtOf(cellsOf(t));
    let li = 0;
    for (let i = 0; i < n; i++) {
      const w = t.falls[i]!;
      const valid = w.npoints >= 1 && w.npoints <= FALL_MAX_POINTS;
      index.push(valid ? li : -1);
      plans.push([]);
      const F = valid ? list[li] : undefined;
      shift.push(F ? fallViewShift(F.px[0]!, F.pz[0]!, this.camera.gridx, this.camera.gridy, worldFt) : [0, 0]);
      if (valid) li++;
      const shape = this.fallShapes.shapes[i], err = this.fallShapes.errors[i] ?? 1;
      if (!F || !F.shape || !g || !shape) continue;
      if (mistRegistered(w, err, shape)) plans[i] = mistFog(w, fallEffectiveHeight(t.falls, i, t.lakes), F.shape, g, 100);
      else if (active && err === 0 && shape.warn & FALLWARN_DROPPED) dim[index[i]!] = (1 << F.mist.length) - 1;
    }
    const nfogs = t.boxes.filter((b) => b.type === TRAXX_BOX_FOG).length;
    const plan = mistDrawPlan(nfogs, plans, this.app.settings.preview_weather);
    const draw = active ? plan.draw : plans.map(() => 0);
    for (let i = 0; i < n; i++) {
      const k = index[i]!;
      if (k < 0 || !plans[i]!.length) continue;
      const F = list[k]!;
      const boxes: number[][] = [];
      let d = 0;
      plans[i]!.forEach((m, s) => {
        if (active && draw[i]! & (1 << s)) return; // the fog pass draws it
        if (active) d |= 1 << boxes.length;
        boxes.push([m.x, m.floorY, m.z, m.W, m.L, m.H, m.axZx, m.axZz]);
      });
      F.mist = boxes;
      dim[k] = d;
    }
    this.mistPlan = { plans, draw, shift };
    return dim;
  }

  /*
    DrawFogVolumesOpenGL (Traxx 1.8.0): the fog boxes the engine would draw in the Preview Weather
    (wmask bit, W, L and H over 0.5 ft), then the mist the plan drew, through one renderer.
  */
  private rebuildFog(): void {
    const doc = this.doc;
    if (!doc) { this.fogBoxes.setVolumes([], false); return; }
    const s = this.app.settings, t = doc.track;
    const weather = s.preview_weather;
    const ambient = engineFogAmbient(weather);
    const out: FogDrawVolume[] = [];
    t.boxes.forEach((box, b) => {
      const { fog, isFog } = effectiveFog(box, this.fogPreview);
      if (!isFog || !engineFogDrawn(fog.wmask, weather, box.width, box.length, box.height)) return;
      const r = fogVolumeRing(box, fog), c = fogVolumeCorners(box, fog);
      if (!r || !c || r.ring.length < 3) return;
      out.push({
        id: b + 1, params: engineFogParamsOf(box, fog), r: fog.r, g: fog.g, b: fog.b, ambient, ring: r.ring, floorz: r.floorz, topz: r.topz,
        frame: {
          cx: (c[0]![0] + c[2]![0]) * 0.5, cy: (c[0]![1] + c[2]![1]) * 0.5,
          ex: [(c[1]![0] - c[0]![0]) / box.width, (c[1]![1] - c[0]![1]) / box.width],
          ez: [(c[3]![0] - c[0]![0]) / box.length, (c[3]![1] - c[0]![1]) / box.length],
          zpf: (c[4]![2] - c[0]![2]) / box.height, floorz: c[0]![2],
        },
      });
    });
    // AppendMistFogVolumes: landing-outer, fall-inner; no mist over a wireframe.
    const { plans, draw, shift } = this.mistPlan;
    if (s.edit.wireframe !== 1) {
      for (let li = 0; li < 4; li++) {
        for (let f = 0; f < plans.length; f++) {
          const m = plans[f]![li];
          if (!m || !(draw[f]! & (1 << li))) continue;
          const [sx, sz] = shift[f]!;
          const cx = (m.x + sx) * 2, cy = (m.z + sz) * 2;
          const ex: [number, number] = [m.axXx * 2, m.axXz * 2], ez: [number, number] = [m.axZx * 2, m.axZz * 2];
          const ring: [number, number][] = [];
          for (let i = 0; i < FOG_RING; i++) {
            const a = m.W * 0.5 * Math.cos((2 * Math.PI * i) / FOG_RING), bb = m.L * 0.5 * Math.sin((2 * Math.PI * i) / FOG_RING);
            ring.push([cx + a * ex[0] + bb * ez[0], cy + a * ex[1] + bb * ez[1]]);
          }
          const floorz = m.floorY * 1.5;
          out.push({
            id: mistFogId(f, li), params: mistFogParams(m), r: m.r, g: m.g, b: m.b, ambient, ring, floorz, topz: floorz + m.H * 1.5,
            frame: { cx, cy, ex, ez, zpf: 1.5, floorz },
          });
        }
      }
    }
    this.fogBoxes.setVolumes(out, s.draw_all_fog);
    this.viewport.requestRender();
  }

  /*
    DrawWallsOpenGL (Traxx 1.8.2, TraxxViewWalls.cpp): every wall exported as Write POD exports it
    (ground under every point), the ribbons under View > Show Walls in every mode, the points and
    the capture in Walls mode only; each at the world copy nearest the grid centre.
  */
  rebuildWalls(): void {
    const doc = this.doc;
    if (!doc) { this.walls.rebuild([], 0, 0); return; }
    const t = doc.track, s = this.app.settings;
    const list = wallDrawList({
      walls: t.raceRules.walls, ground: exportWallGround(t), mode: this.app.mode === EDIT_WALLS, ribbons: s.show_walls,
      hotWall: this.wallState.hotWall, hotPoint: this.wallState.hotPoint, capture: this.wallState.capture,
    });
    this.walls.rebuild(list, this.camera.gridx, this.camera.gridy, worldFtOf(cellsOf(t)));
    this.viewport.requestRender();
  }

  /** The walls were edited, or the hover or the capture changed (the view's ReDisplay in TraxxViewWalls.cpp). */
  wallsChanged(state?: { hotWall?: number; hotPoint?: number; capture?: [number, number][] | null }): void {
    if (state) this.wallState = { ...this.wallState, ...state };
    this.rebuildWalls();
  }

  /** A fall was edited or its window opened or closed (FallChanged): the shapes follow when `shape`, then the view. */
  fallChanged(shape: boolean, state?: { highlight?: number; capture?: [number, number][] | null }): void {
    if (state) this.fallState = { ...this.fallState, ...state };
    if (shape) { this.fallShapes.invalidate(); this.rebuildWater(); }
    this.rebuildFalls();
  }

  /** Body 0 (on the drive surface outside Classic 8-bit) and the lakes, for the track as it is. */
  private rebuildWater(): void {
    if (!this.doc) return;
    const t = this.doc.track;
    this.water.rebuild(t.heights, t.waterLevel4, tileMinMaxU(t));
    if (t.lakes.length) {
      const st = trackLakes(t);
      // Traxx 1.7.3: the walls follow the lakes' rule (edges, notch edges cyan); the escape and at-H marks.
      this.lakes.rebuild(st.tmap, t.lakes.map((l) => l.height), st.lakes.map((l) => l.errors), this.wallGround(),
        { rule: st.rule, notchEdges: lakeNotchEdgesOf(st), lakes: st.lakes });
    } else this.lakes.rebuild(null, [], []);
    this.lodKey = this.currentLodKey();
  }

  /*
    The ground the lake wall rings ride, as drawn (DrawLakes, 4cbc21a): the classic corners
    (wrapping, RingZ), else each tile's height grid at the level the terrain draws it.
  */
  private wallGround(): LakeWallGround | null {
    if (!this.doc) return null;
    const t = this.doc.track;
    if (t.terrainMode === TERRAINMODE_CLASSIC8) {
      const n = cellsOf(t), m = n - 1;
      return { per: () => 1, z: (gi, gj, a, b) => ALTITUDE_SCALE * t.heights[((gi + a) & m) + ((gj + b) & m) * n]! };
    }
    const grids = new SurfaceTileGrids(t, this.camera.gridx, this.camera.gridy);
    return { per: (gi, gj) => grids.per(gi, gj), z: (gi, gj, a, b) => (ALTITUDE_SCALE * grids.at(gi, gj, a, b)) / 256 };
  }

  /* The camera's tile on a track drawn with the 8 ft ring, "" otherwise: the drawn ground's key. */
  private currentLodKey(): string {
    const t = this.doc?.track;
    if (!t || !hasFineLod(t)) return "";
    return `${this.camera.gridx >> 2},${this.camera.gridy >> 2}`;
  }

  /** The camera's ray through a point of the view (client pixels), scene units. */
  private rayAt(clientX: number, clientY: number): { o: THREE.Vector3; d: THREE.Vector3 } {
    const r = this.viewport.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.viewport.camera);
    return { o: ray.ray.origin, d: ray.ray.direction };
  }

  /*
    The drivable surface under a point of the view: the terrain (`pick`), or a placed model's floor nearer the eye
    (a street, deck or tunnel floor of a track built of meshes, core/view/mesh-pick.ts), as a TerrainHit whose point
    carries its 1/256 fractions. A JSTraxx addition: Traxx picks the terrain only.
  */
  pickDrivable(clientX: number, clientY: number): TerrainHit | null {
    const ground = this.pick(clientX, clientY);
    if (!this.doc || !this.models) return ground;
    const models = this.models;
    this.drivable ??= drivableMeshes(this.doc.track.boxes, (name) => models.meshesFor(name)?.geometry ?? null);
    if (!this.drivable.length) return ground;
    const { o, d } = this.rayAt(clientX, clientY);
    const hit = pickMesh(this.drivable, [o.x, o.y, o.z], [d.x, d.y, d.z], ground ? ground.t : Infinity);
    if (!hit) return ground;
    const cells = cellsOf(this.doc.track);
    const px = Math.floor(hit.point[0] * 256), py = Math.floor(hit.point[1] * 256), v = Math.floor((hit.point[2] * 256) / ALTITUDE_SCALE);
    const ix = px >> 8, iy = py >> 8;
    if (ix < 0 || iy < 0 || ix >= cells << 6 || iy >= cells << 6) return ground;
    return {
      point: hit.point, cell: [ix >> 6, iy >> 6], vertex: [Math.round(hit.point[0] / 64) & (cells - 1), Math.round(hit.point[1] / 64) & (cells - 1)], t: hit.t,
      ipos: [ix, iy, v >> 8], fraction: [px & 255, py & 255, v & 255],
    };
  }

  /** The terrain under a point of the view (client pixels), or null. */
  pick(clientX: number, clientY: number): TerrainHit | null {
    if (!this.doc) return null;
    const { o, d } = this.rayAt(clientX, clientY);
    const t = this.doc.track;
    if (t.terrainMode === TERRAINMODE_CLASSIC8) return pickTerrain(t.heights, [o.x, o.y, o.z], [d.x, d.y, d.z]);
    // Traxx 1.7: the drive surface itself, over the grid window (PickSurfaceRay).
    const s = this.app.settings;
    const gridsize = this.gridSizeOf(s);
    const half = (gridsize - 1) >> 1;
    return pickSurface(t, [o.x, o.y, o.z], [d.x, d.y, d.z], { x0: this.camera.gridx - half, y0: this.camera.gridy - half, n: gridsize });
  }

  /** Decode the terrain HD art not decoded yet. True when any was. */
  private async decodeTerrainHd(doc: TrackDocument): Promise<boolean> {
    const jobs = doc.textures.map((t) => {
      if (!t?.hd) return null;
      const key = t.name.toUpperCase();
      if (this.hd.has(key)) return null;
      this.hd.set(key, null);
      return decodeHd(t.hd).then((img) => { this.hd.set(key, img); return img !== null; });
    }).filter((j): j is Promise<boolean> => j !== null);
    return (await Promise.all(jobs)).some(Boolean);
  }

  /** The tiles again, after a gamma, palette or texture change. */
  rebuildTiles(): void {
    if (!this.doc || !this.terrain) return;
    const hd = new Map<number, RgbaImage>();
    this.doc.textures.forEach((t, i) => { const img = t?.hd ? this.hd.get(t.name.toUpperCase()) : null; if (img) hd.set(i, img); });
    this.tiles = buildTileSet(this.doc, this.app.settings.gamma, hd);
    this.terrain.setTiles(this.tiles);
    this.groundBoxes?.rebuild(this.doc.track.groundBoxes, this.tiles, cellsOf(this.doc.track));
    this.viewport.requestRender();
  }

  /** Cells changed by an edit, inclusive bounds in cells. */
  cellsChanged(minX: number, minY: number, maxX: number, maxY: number): void {
    this.terrain?.updateCells(minX, minY, maxX, maxY);
    if (this.doc) this.rebuildWater();
    this.viewport.requestRender();
  }

  /*
    Traxx 1.8.0 (b6d56f2, 2e8a268): View > Show Detail Maps and Show Detail Strength through the
    engine's detail term when the track has its own _MASK (the per-cell wash otherwise), and View >
    Show Water Strength's tint (Show Water Mask before 1.8.1).
  */
  private applyDetail(): void {
    const s = this.app.settings, doc = this.doc;
    if (!this.terrain || !doc) return;
    const d = s.show_detail_maps || s.show_mask_overlay ? this.detail.terrain() : null;
    this.terrain.setDetail(d ? { ...d, look: s.show_detail_maps, wash: s.show_mask_overlay } : null);
    this.terrain.setMask(this.mask, s.show_mask_overlay && !d);
    // Traxx 1.8.1 Show Water Strength (DrawWaterMaskWash, GLDetailBeginWater): the exact wash per
    // texel on the water fill and the lakes; the ground's per-tile wash goes faint while the water
    // carries it (water shown, opacity > 0, the track has its _WMSK), full otherwise.
    const wmaps = this.detail.water();
    const waterWash = s.show_water_mask && wmaps !== null && s.show_water && s.water_opacity > 0;
    this.terrain.setWaterMask(s.show_water_mask ? this.detail.waterMaskCells() : null, waterWash);
    const w = s.show_detail_maps || s.show_water_mask ? wmaps : null, mapFt = cellsOf(doc.track) * 32;
    this.water.setDetail(w, mapFt, s.show_detail_maps, s.show_water_mask);
    this.lakes.setDetail(w, mapFt, s.show_detail_maps, s.show_water_mask);
    this.viewport.requestRender();
  }

  /** The objects or ground boxes changed. */
  objectsChanged(): void {
    this.drivable = null;
    this.objectWindow = "";
    this.updateWindow();
    if (this.doc && this.groundBoxes) this.groundBoxes.rebuild(this.doc.track.groundBoxes, this.tiles, cellsOf(this.doc.track));
    this.rebuildFog();
    this.viewport.requestRender();
  }

  /** SetFogPreview: a dialog's working copy drawn in place of the box's own fog; null ends it. */
  setFogPreview(preview: FogPreview | null): void {
    this.fogPreview = preview;
    this.rebuildFog();
    this.viewport.requestRender();
  }

  private shown = { gamma: 0, transparency: false, colliders: false };
  private applySettings(s: TraxxSettings): void {
    this.viewport.setBackground(s.colors[BG_COL]);
    this.viewport.setFieldOfView(s.opengl_fov);
    if (!this.terrain || !this.doc) return;
    const p = this.doc.track.palette;
    const g = gammaMap(s.gamma);
    this.terrain.setLook({ wireMode: s.edit.wireframe, wire: s.colors[WIRE_COL], overlay: s.colors[WIREO_COL], background: s.colors[BG_COL], fallback: [p[0], p[1], p[2]], diagonals: s.wire_diagonals, width: s.wire_width });
    this.water.setLook([g[p[252 * 3]], g[p[252 * 3 + 1]], g[p[252 * 3 + 2]]], s.water_opacity, s.edit.wireframe !== 1);
    this.lakes.setOpacity(s.water_opacity);
    if (this.shown.gamma !== s.gamma) { this.shown.gamma = s.gamma; this.rebuildTiles(); this.buildModels(); }
    else if (this.shown.transparency !== s.model_transparency || this.shown.colliders !== s.hide_colliders) this.buildModels();
    this.applyDetail();
    this.shown.transparency = s.model_transparency;
    this.shown.colliders = s.hide_colliders;
    this.updateWindow();
    this.applyVisibility();
  }

  /** What the fog and mist plan depend on beyond the track: the Preview Weather, Draw All, the fog pass, wireframe. */
  private fogKey = "";

  private applyVisibility(): void {
    const s = this.app.settings, mode = this.app.mode;
    const fogKey = `${s.preview_weather},${s.draw_all_fog},${this.fogActive()},${s.edit.wireframe}`;
    if (fogKey !== this.fogKey && this.doc) {
      this.fogKey = fogKey;
      if (this.doc.track.falls.length) this.rebuildFalls();
      else this.rebuildFog();
    }
    this.course.group.visible = mode === EDIT_COURSE || s.always_course;
    if (this.objects) this.objects.group.visible = mode === EDIT_OBJECTS || s.always_objects;
    this.fogBoxes.group.visible = mode === EDIT_OBJECTS || s.always_objects;
    if (this.groundBoxes) this.groundBoxes.mesh.visible = mode === EDIT_BUILDINGS || s.always_buildings;
    this.water.group.visible = s.show_water;
    this.lakes.mesh.visible = s.show_water && s.water_opacity > 0;
    this.lakes.walls.visible = s.show_water && s.show_lake_walls;
    this.lakes.marks.visible = s.show_water;
    this.waterfalls.group.visible = s.edit.wireframe !== 1;
    // CTraxxView::Display: DrawWallsOpenGL is not called over a wireframe.
    this.walls.group.visible = s.edit.wireframe !== 1;
    this.rebuildWalls();
    this.updateVegetation();
    // Traxx 1.8.0: with the sky on, no backdrop in Snow and the fogs (the engine draws only the fog colour).
    const skyOn = Boolean(this.doc) && s.show_sky && s.edit.wireframe !== 1;
    const backdrop = s.show_backdrop && s.edit.wireframe !== 1 && !this.doc?.track.arena && (!skyOn || SkyLayer.backdropShows(s.preview_weather));
    this.viewport.backdrop = backdrop ? this.backdrop.scene : null;
    this.viewport.sky = skyOn ? (renderer, hasBackdrop) => this.drawSky(renderer, hasBackdrop) : null;
    if (!skyOn) this.say("sky", "");
    this.backdrop.arena.visible = s.show_backdrop;
    this.viewport.requestRender();
  }

  /*
    The vegetation for the camera as it is: what shows, model or card, and the facing yaw.
    Neither the plants nor the wash are drawn over a wireframe (CTraxxView::Display).
  */
  private updateVegetation(): void {
    if (!this.vegetation.active) return;
    const s = this.app.settings;
    const solid = s.edit.wireframe !== 1;
    const gridsize = this.gridSizeOf(s), worldn = this.doc ? cellsOf(this.doc.track) : 256;
    const cam = this.viewport.camera;
    cam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    this.vegetation.lodCentre = [this.camera.gridx, this.camera.gridy];
    this.vegetation.update(cam.position, right, vegWindow(this.camera.gridx, this.camera.gridy, gridsize, gridsize >= worldn, worldn), {
      trees: solid && s.show_vegetation, grass: solid && s.show_grass, aids: solid && s.show_veg_aids, wash: solid && s.show_veg_mask,
    });
  }

  private updateWindow(): void {
    const s = this.app.settings;
    const gridsize = this.gridSizeOf(s);
    const { gridx, gridy } = this.camera;
    this.terrain?.setWindow(gridx, gridy, gridsize);
    // The 8 ft ring moved with the camera's tile: the lake walls ride it again (the mask wash
    // keys on the camera's tile itself).
    const lod = this.currentLodKey();
    if (lod !== this.lodKey) {
      this.lodKey = lod;
      if (this.doc?.track.lakes.length) this.lakes.reride(this.wallGround());
    }
    const half = (gridsize - 1) >> 1;
    this.water.setWindow(new THREE.Vector4(gridx - half, gridy - half, gridx + half, gridy + half));
    this.lakes.setWindow(new THREE.Vector4(gridx - half, gridy - half, gridx + half, gridy + half));
    // Objects: the window capped at 256 cells, in ipos, rebuilt only when it moves.
    const oh = (Math.min(gridsize, OBJECT_CULL_GRID) - 1) >> 1;
    const key = `${gridx},${gridy},${oh}`;
    if (key !== this.objectWindow) {
      this.objectWindow = key;
      this.objects?.rebuild({ minx: (gridx - oh) << 6, maxx: (gridx + oh) << 6, miny: (gridy - oh) << 6, maxy: (gridy + oh) << 6 });
      this.rebuildCourse();
      // Each fall sits at the copy nearest the grid centre, which just moved.
      if (this.doc?.track.falls.length) this.rebuildFalls();
      if (this.doc?.track.raceRules.walls.length) this.rebuildWalls();
    }
  }

  /** Redraw after the camera changed. */
  changed(): void {
    this.updateWindow();
    this.viewport.placeCamera(this.camera);
    this.updateVegetation();
    this.viewport.requestRender();
    for (const fn of this.listeners) fn();
  }

  /** Keep stepping while navigation keys are held (IdleNavigate). */
  animate(): void {
    this.lastTick = 0;
    this.viewport.requestRender();
  }

  private step(): void {
    if (!this.camera.moving) { this.viewport.placeCamera(this.camera); return; }
    const now = performance.now();
    const ms = this.lastTick ? now - this.lastTick : 55;
    this.lastTick = now;
    this.camera.tick(ms, this.groundAt);
    this.updateWindow();
    this.viewport.placeCamera(this.camera);
    this.updateVegetation();
    for (const fn of this.listeners) fn();
    this.viewport.requestRender();
  }
}
