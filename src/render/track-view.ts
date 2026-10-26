/*
  The open track in the 3D view: the terrain and its tiles, objects, ground boxes, water, the
  backdrop, the camera, and the View Controls and options that act on them.

  What shows follows Traxx: objects in Objects mode or with Always Show Objects (F6), ground
  boxes in Groundbox mode or with Always Show Ground Boxes (F7), water with Show Water (F8),
  the backdrop with Show Backdrop (F9).
*/
import * as THREE from "three";
import type { TrackDocument } from "../core/doc/document.ts";
import type { AppState } from "../app/state.ts";
import { TraxxCamera } from "../core/view/camera.ts";
import { buildTileSet, gammaMap, type RgbaImage, type TileSet } from "../core/view/tiles.ts";
import { interpolateRawAtPoint } from "../core/traxx/terrain.ts";
import { BG_COL, EDIT_BUILDINGS, EDIT_OBJECTS, GRID_MAX, WIRE_COL, WIREO_COL, type TraxxSettings } from "../core/settings.ts";
import { TerrainMesh } from "./terrain.ts";
import { Viewport } from "./viewport.ts";
import { decodeHd } from "./hd-decode.ts";
import { ModelLibrary } from "./models.ts";
import { ObjectLayer } from "./objects.ts";
import { GroundBoxLayer } from "./ground-boxes.ts";
import { WaterLayer } from "./water.ts";
import { BackdropLayer } from "./backdrop.ts";
import { CourseLayer } from "./course.ts";
import { Overlay2D } from "./overlay.ts";
import { arrowSegments, checkpointArrow, checkpointWantsArrow } from "../core/view/arrows.ts";
import { objectMatrix } from "../core/view/model-geometry.ts";
import { pickTerrain, type TerrainHit } from "../core/view/pick.ts";
import { EDIT_COURSE } from "../core/settings.ts";
import { ALTITUDE_SCALE } from "../core/view/camera.ts";
import type { Touch } from "../core/edit/history.ts";

/* The object draw window is the grid window capped at 256 cells (TRAXX_GL_OBJECT_CULL_GRID). */
const OBJECT_CULL_GRID = 256;

export class TrackView {
  readonly viewport: Viewport;
  readonly camera = new TraxxCamera();
  private doc: TrackDocument | null = null;
  private terrain: TerrainMesh | null = null;
  private tiles: TileSet | null = null;
  private models: ModelLibrary | null = null;
  private objects: ObjectLayer | null = null;
  private groundBoxes: GroundBoxLayer | null = null;
  private water = new WaterLayer();
  private backdrop = new BackdropLayer();
  private course = new CourseLayer();
  readonly overlay: Overlay2D;
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

  constructor(host: HTMLElement, app: AppState) {
    this.app = app;
    this.viewport = new Viewport(host);
    this.viewport.onBeforeRender(() => this.step());
    this.viewport.scene.add(this.water.group, this.backdrop.arena, this.course.group);
    this.overlay = new Overlay2D(host, this.viewport.camera);
    this.viewport.onAfterRender(() => this.overlay.draw());
    this.overlay.add((g, project) => this.drawLabels(g, project));
    this.overlay.add((g) => this.drawFps(g));
    app.on("settings", (s) => this.applySettings(s));
    app.on("mode", () => { this.applyVisibility(); this.rebuildCourse(); });
    app.on("tools", () => this.rebuildCourse());
    this.applySettings(app.settings);
  }

  /** Called whenever the camera moved or turned. */
  onCameraChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  readonly groundAt = (x: number, y: number) => (this.doc ? interpolateRawAtPoint(this.doc.track.heights, x, y) : 0);

  async open(doc: TrackDocument | null): Promise<void> {
    this.clear();
    this.doc = doc;
    if (!doc) { this.viewport.requestRender(); return; }
    this.camera.resetForTrack(this.groundAt);
    this.terrain = new TerrainMesh(doc.track);
    this.viewport.scene.add(this.terrain.group);
    this.groundBoxes = new GroundBoxLayer(this.terrain.siblingMaterial());
    this.viewport.scene.add(this.groundBoxes.mesh);
    this.water.rebuild(doc.track.heights, doc.track.waterLevel4);
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
    this.terrain = null; this.groundBoxes = null; this.objects = null; this.models = null; this.tiles = null;
    this.water.rebuild(new Uint8Array(65536), 0);
    this.backdrop.scene.clear();
    this.backdrop.arena.clear();
    this.course.group.clear();
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
    this.objects = new ObjectLayer(doc, models, s.gamma);
    this.objects.hideColliders = s.hide_colliders;
    this.viewport.scene.add(this.objects.group);
    this.backdrop.build(models, [doc.track.backdropName, ...doc.track.extraBackdrops], doc.track.arena ? { x: doc.track.arena.x, y: doc.track.arena.y } : null, doc.track.heights);
    this.objectWindow = "";
    this.updateWindow();
    this.applyVisibility();
  }

  /** The course lines and trucks, for the window and the course being edited. */
  rebuildCourse(): void {
    if (!this.doc) return;
    const s = this.app.settings;
    const gridsize = s.show_whole_grid ? GRID_MAX : s.polysize;
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
    const gridsize = s.show_whole_grid ? GRID_MAX : s.polysize;
    const half = (gridsize - 1) >> 1;
    const inside = (x: number, y: number) => Math.abs((x >> 6) - this.camera.gridx) <= half && Math.abs((y >> 6) - this.camera.gridy) <= half;
    if (mode === EDIT_COURSE || s.always_course) {
      const { course, alwaysMain } = this.app.tools;
      const lists = [...(course === 0 || alwaysMain ? [t.course] : []), ...(course > 0 ? [t.extendedCourses[course - 1] ?? []] : [])];
      for (const list of lists) list.forEach((seg, i) => {
        if (!inside(seg.cstart[0], seg.cstart[1])) return;
        const p = project(seg.cstart[0], seg.cstart[1], ALTITUDE_SCALE * seg.cstart[2]);
        if (p) g.fillText(String(i), p.x, p.y + 5);
      });
    }
    if (mode === EDIT_OBJECTS) {
      let cp = 0;
      for (const box of t.boxes) {
        if (box.type !== 6) continue;
        const n = cp++;
        if (!inside(box.ipos[0], box.ipos[1])) continue;
        // The arrow through a gate without a model first, so the number reads over it.
        if (!box.modelName && checkpointWantsArrow(t.trackType, n)) {
          g.save();
          g.strokeStyle = "#00ff00";
          for (const [a, b] of arrowSegments(checkpointArrow(box), objectMatrix(box))) {
            const pa = project(a[0], a[1], a[2]), pb = project(b[0], b[1], b[2]);
            if (pa && pb) { g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pb.x, pb.y); g.stroke(); }
          }
          g.restore();
        }
        const p = project(box.ipos[0] + box.fraction[0] / 256, box.ipos[1] + box.fraction[1] / 256, 3 * (box.ipos[2] + box.fraction[2] / 256));
        if (p) g.fillText(`CP ${String(n).padStart(2, "0")}`, p.x, p.y);
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
    for (const r of [touch.heights, touch.clr]) if (r) this.terrain?.updateCells(r.minX, r.minY, r.maxX, r.maxY);
    if (touch.heights || touch.water) this.water.rebuild(this.doc.track.heights, this.doc.track.waterLevel4);
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
    const gridsize = s.show_whole_grid ? GRID_MAX : s.polysize;
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

  /** The terrain under a point of the view (client pixels), or null. */
  pick(clientX: number, clientY: number): TerrainHit | null {
    if (!this.doc) return null;
    const r = this.viewport.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.viewport.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    return pickTerrain(this.doc.track.heights, [o.x, o.y, o.z], [d.x, d.y, d.z]);
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
    this.groundBoxes?.rebuild(this.doc.track.groundBoxes, this.tiles);
    this.viewport.requestRender();
  }

  /** Cells changed by an edit, inclusive bounds in cells. */
  cellsChanged(minX: number, minY: number, maxX: number, maxY: number): void {
    this.terrain?.updateCells(minX, minY, maxX, maxY);
    if (this.doc) this.water.rebuild(this.doc.track.heights, this.doc.track.waterLevel4);
    this.viewport.requestRender();
  }

  /** The objects or ground boxes changed. */
  objectsChanged(): void {
    this.objectWindow = "";
    this.updateWindow();
    if (this.doc && this.groundBoxes) this.groundBoxes.rebuild(this.doc.track.groundBoxes, this.tiles);
    this.viewport.requestRender();
  }

  private shown = { gamma: 0, transparency: false, colliders: false };
  private applySettings(s: TraxxSettings): void {
    this.viewport.setBackground(s.colors[BG_COL]);
    if (!this.terrain || !this.doc) return;
    const p = this.doc.track.palette;
    const g = gammaMap(s.gamma);
    this.terrain.setLook({ wireMode: s.edit.wireframe, wire: s.colors[WIRE_COL], overlay: s.colors[WIREO_COL], background: s.colors[BG_COL], fallback: [p[0], p[1], p[2]], diagonals: s.wire_diagonals, width: s.wire_width });
    this.water.setLook([g[p[252 * 3]], g[p[252 * 3 + 1]], g[p[252 * 3 + 2]]], s.water_opacity, s.edit.wireframe !== 1);
    if (this.shown.gamma !== s.gamma) { this.shown.gamma = s.gamma; this.rebuildTiles(); this.buildModels(); }
    else if (this.shown.transparency !== s.model_transparency || this.shown.colliders !== s.hide_colliders) this.buildModels();
    this.terrain.setMask(this.mask, s.show_mask_overlay);
    this.shown.transparency = s.model_transparency;
    this.shown.colliders = s.hide_colliders;
    this.updateWindow();
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const s = this.app.settings, mode = this.app.mode;
    this.course.group.visible = mode === EDIT_COURSE || s.always_course;
    if (this.objects) this.objects.group.visible = mode === EDIT_OBJECTS || s.always_objects;
    if (this.groundBoxes) this.groundBoxes.mesh.visible = mode === EDIT_BUILDINGS || s.always_buildings;
    this.water.group.visible = s.show_water;
    const backdrop = s.show_backdrop && s.edit.wireframe !== 1 && !this.doc?.track.arena;
    this.viewport.backdrop = backdrop ? this.backdrop.scene : null;
    this.backdrop.arena.visible = s.show_backdrop;
    this.viewport.requestRender();
  }

  private updateWindow(): void {
    const s = this.app.settings;
    const gridsize = s.show_whole_grid ? GRID_MAX : s.polysize;
    const { gridx, gridy } = this.camera;
    this.terrain?.setWindow(gridx, gridy, gridsize);
    const half = (gridsize - 1) >> 1;
    this.water.setWindow(new THREE.Vector4(gridx - half, gridy - half, gridx + half, gridy + half));
    // Objects: the window capped at 256 cells, in ipos, rebuilt only when it moves.
    const oh = (Math.min(gridsize, OBJECT_CULL_GRID) - 1) >> 1;
    const key = `${gridx},${gridy},${oh}`;
    if (key !== this.objectWindow) {
      this.objectWindow = key;
      this.objects?.rebuild({ minx: (gridx - oh) << 6, maxx: (gridx + oh) << 6, miny: (gridy - oh) << 6, maxy: (gridy + oh) << 6 });
      this.rebuildCourse();
    }
  }

  /** Redraw after the camera changed. */
  changed(): void {
    this.updateWindow();
    this.viewport.placeCamera(this.camera);
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
    for (const fn of this.listeners) fn();
    this.viewport.requestRender();
  }
}
