/*
  The vegetation in the view (COpenGLTerrainRenderer::DrawVegetation, VegDrawAids and
  DrawVegetationMaskWash, Traxx/OpenGLTerrainRenderer.cpp), switched by View > Vegetation:

    - Show Vegetation: the trees, each species' model, or its far card past the far band;
    - Show Grass: the clumps near the camera, thinning out over the last quarter of 1000 ft;
    - Vegetation Aids: the AI corridor round every course segment and start slot, the
      checkpoint gates' keep-out discs, and the engine's trunk box at every colliding trunk within 600 ft (Traxx 1.8.0);
    - Vegetation Mask Wash: the painted _V mask (the _G mask where _V is unpainted) as a
      see-through colour per 32 ft cell over the ground.

  Plants are drawn only inside the terrain's window, like Traxx. Which plants show, as model or
  card, depends on the camera, so the instance lists are refilled whenever it moves
  (core/view/veg-draw.ts holds the rules). One InstancedMesh per species model part.

  Not ported: Traxx's fast draw (per-tile display lists, a speed-up that draws the same picture).
*/
import * as THREE from "three";
import type { TrackDocument } from "../core/doc/document.ts";
import { vegTrunkDerive, vegTrunkFirstFrame, vegTrunkPlace, type VegTrunk } from "../core/traxx/veg-trunk.ts";
import { vegetationFromTxx, VEG_KIND_PLACED, VEG_COLLIDE_TRUNK, VEG_LAYER_GRASS, VEG_LAYER_TREES, type Vegetation } from "../core/traxx/veg.ts";
import { vegDecodeMask, vegGroundHeightClassic8, vegModelInfo } from "../core/edit/veg-planter.ts";
import { modelInstanceProblem, vegFarCardBaseY } from "../core/traxx/instancing.ts";
import { surfaceFeet } from "../core/traxx/surface.ts";
import { SurfaceTileGrids } from "../core/view/surface-tiles.ts";
import { TERRAINMODE_CLASSIC8 } from "../core/traxx/terrain16.ts";
import type { Terrain16 } from "../core/traxx/terrain16.ts";
import {
  clumpHeadingIndex, clumpScale, clumpScene, facingCosSin, headingCosSin, keepClump, plantMatrix, resolveVegSpecies,
  treeHeadingIndex, treeScale, treeScene, treeTile, useFarCard, vegModelFacts, VEG_AID_RANGE_FT, VEG_GRASS_DIST_FT,
  SCENE_PER_FT, SCENE_Z_PER_FT, type VegSpeciesDraw,
} from "../core/view/veg-draw.ts";
import type { ModelLibrary } from "./models.ts";
import { cellsOf } from "../core/traxx/world.ts";

export interface VegShow {
  trees: boolean;
  grass: boolean;
  aids: boolean;
  wash: boolean;
}

export interface VegWindow {
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
}

/* One species' instanced parts, sharing one matrix buffer. */
class Batch {
  readonly meshes: THREE.InstancedMesh[] = [];
  readonly attr: THREE.InstancedBufferAttribute;
  count = 0;

  constructor(parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[], capacity: number, group: THREE.Group) {
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 16), 16);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    for (const p of parts) {
      const mesh = new THREE.InstancedMesh(p.geometry, p.material, Math.max(1, capacity));
      mesh.instanceMatrix = this.attr;
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      group.add(mesh);
    }
  }

  get array(): Float32Array {
    return this.attr.array as Float32Array;
  }

  commit(): void {
    for (const m of this.meshes) m.count = this.count;
    this.attr.needsUpdate = true;
    this.attr.clearUpdateRanges();
    this.attr.addUpdateRange(0, this.count * 16);
  }
}

interface Run {
  tx: number;
  tz: number;
  start: number;
  count: number;
  zmin: number;
  zmax: number;
  /** The biggest reach of the run's plants, scene units. */
  pad: number;
}

export class VegetationLayer {
  readonly group = new THREE.Group();
  private trees = new THREE.Group();
  private grass = new THREE.Group();
  private aids = new THREE.Group();
  private wash: THREE.Mesh;
  /** The camera's cell the terrain's 8 ft ring is laid round (the grid window's centre). */
  lodCentre: [number, number] = [128, 128];
  private doc: TrackDocument | null = null;
  private veg: Vegetation | null = null;
  /** N, the track's cells a side (track format version 6). */
  private cells = 256;
  private draw: VegSpeciesDraw[] = [];
  private near: (Batch | null)[] = [];
  private far: (Batch | null)[] = [];
  private clumpBatch: (Batch | null)[] = [];
  private treeRuns: Run[] = [];
  private clumpRuns: Run[] = [];
  /** Per species: radius, hrad and height of the model (model units), for runs and aids. */
  private facts: ({ radius: number; hrad: number; height: number } | null)[] = [];
  private farRadius: number[] = [];
  /** Per species: the engine's trunk box (vegTrunkDerive), null for no trunk. */
  private trunks: (VegTrunk | null)[] = [];
  private maskCells: (Uint8Array | null)[] = [null, null];
  private washKey = "";
  private aidsKey = "";
  private models: ModelLibrary | null = null;

  constructor() {
    this.wash = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 115 / 255, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    this.wash.frustumCulled = false;
    this.wash.renderOrder = 5;
    this.aids.renderOrder = 6;
    this.group.add(this.trees, this.grass, this.aids, this.wash);
  }

  /** The track's vegetation and its models, again (after a load, an edit or a model change). */
  build(doc: TrackDocument | null, models: ModelLibrary | null): void {
    this.clear();
    this.doc = doc;
    this.models = models;
    if (!doc || !models || !doc.track.vegetation) return;
    // Track format version 6 (9.2): placements across an N-cell world.
    this.cells = cellsOf(doc.track);
    const v = vegetationFromTxx(doc.track.vegetation, this.cells);
    if (!v.trees.length && !v.clumps.length && !v.masks.some(Boolean)) return;
    this.veg = v;

    const find = (name: string) => {
      const asset = models.asset(name);
      if (!asset) return null;
      const g = models.meshesFor(asset.name)?.geometry ?? null;
      return { name: asset.name, bytes: asset.bytes ?? null, vertices: g ? drawnVertices(g.groups) : null };
    };
    this.draw = resolveVegSpecies(v, find, (b) => modelInstanceProblem(b) === null, (b) => vegFarCardBaseY(b)?.engineMinY ?? null);
    this.facts = this.draw.map((d) => {
      const g = d.model ? models.meshesFor(d.model)?.geometry : null;
      return g ? vegModelFacts(drawnVertices(g.groups)) : null;
    });
    // VegUpdateTrunk: once per (re)build, from the species model's raw bytes (a keyframed one's frame 0).
    this.trunks = v.species.map((sp, s) => {
      const name = this.draw[s]?.model;
      if (!name || sp.kind !== VEG_KIND_PLACED || sp.collide !== VEG_COLLIDE_TRUNK) return null;
      const bytes = models.asset(name)?.bytes ?? null;
      if (!bytes) return null;
      const frame = vegTrunkFirstFrame(bytes);
      const src = frame !== null ? models.asset(frame)?.bytes ?? null : bytes;
      return src ? vegTrunkDerive(src, frame !== null, sp.trunkdiam, sp.trunkheight) : null;
    });
    this.farRadius = this.draw.map((d) => {
      const g = d.far ? models.meshesFor(d.far)?.geometry : null;
      return g ? vegModelFacts(drawnVertices(g.groups)).radius : 0;
    });

    const treeCount = new Array(this.draw.length).fill(0), clumpCount = new Array(this.draw.length).fill(0);
    for (const t of v.trees) treeCount[t.species]++;
    for (const c of v.clumps) clumpCount[c.species]++;
    this.draw.forEach((d, s) => {
      const parts = d.model ? models.meshesFor(d.model)?.parts ?? [] : [];
      const farParts = d.far ? models.meshesFor(d.far)?.parts ?? [] : [];
      this.near[s] = parts.length && treeCount[s] ? new Batch(parts, treeCount[s], this.trees) : null;
      this.far[s] = farParts.length && treeCount[s] ? new Batch(farParts, treeCount[s], this.trees) : null;
      this.clumpBatch[s] = parts.length && clumpCount[s] ? new Batch(parts, clumpCount[s], this.grass) : null;
    });
    this.buildRuns(v);
  }

  /* VegBuildTreeRuns / VegBuildClumpRuns: consecutive plants on one 32 ft tile. */
  private buildRuns(v: Vegetation): void {
    const reach = (s: number, k: number, card: boolean) => {
      const rad = Math.max(this.facts[s]?.radius ?? 0, this.draw[s]?.far ? this.farRadius[s]! : 0);
      const lift = card && this.draw[s]?.far ? Math.abs(this.draw[s]!.farLift) : 0;
      return (rad * k + k * 0.75 * lift) / 64;
    };
    const runs = (n: number, tile: (i: number) => [number, number], z: (i: number) => number, r: (i: number) => number): Run[] => {
      const out: Run[] = [];
      let cur: Run | null = null;
      for (let i = 0; i < n; i++) {
        const [tx, tz] = tile(i), zi = z(i);
        if (!cur || cur.tx !== tx || cur.tz !== tz) out.push((cur = { tx, tz, start: i, count: 0, zmin: zi, zmax: zi, pad: 0 }));
        cur.count++;
        cur.zmin = Math.min(cur.zmin, zi);
        cur.zmax = Math.max(cur.zmax, zi);
        cur.pad = Math.max(cur.pad, r(i));
      }
      return out;
    };
    const t = v.trees, c = v.clumps;
    this.treeRuns = runs(t.length, (i) => treeTile(t[i]!, this.cells), (i) => treeScene(t[i]!)[2], (i) => reach(t[i]!.species, treeScale(t[i]!.scale), true));
    this.clumpRuns = runs(c.length, (i) => [c[i]!.tx, c[i]!.tz], (i) => (c[i]!.y * 3) / 512, (i) => reach(c[i]!.species, clumpScale(c[i]!.scale), false));
  }

  /** True when the track has anything this layer draws. */
  get active(): boolean {
    return this.veg !== null;
  }

  /**
    Refill the lists for the camera: `eye` its position, `right` its right-hand axis, both in
    scene units; `win` the cell window.
  */
  update(eye: THREE.Vector3, right: THREE.Vector3, win: VegWindow, show: VegShow): void {
    const v = this.veg;
    this.trees.visible = Boolean(v) && show.trees;
    this.grass.visible = Boolean(v) && show.grass;
    this.aids.visible = Boolean(v) && show.aids;
    this.wash.visible = Boolean(v) && show.wash;
    if (!v) return;
    const [fcs, fsn] = facingCosSin(right.x, right.y);
    const inWin = (r: Run) => r.tx >= win.cx0 && r.tx <= win.cx1 && r.tz >= win.cy0 && r.tz <= win.cy1;
    const pos = [0, 0, 0];

    if (show.trees) {
      for (const b of [...this.near, ...this.far]) if (b) b.count = 0;
      for (const run of this.treeRuns) {
        if (!inWin(run)) continue;
        for (let i = run.start; i < run.start + run.count; i++) {
          const t = v.trees[i]!, d = this.draw[t.species];
          const near = this.near[t.species];
          if (!d || !near) continue;
          const [x, y, z] = treeScene(t);
          const far = this.far[t.species];
          const usefar = far !== null && far !== undefined && useFarCard(Math.hypot(x - eye.x, y - eye.y) / SCENE_PER_FT, d.band, i);
          let cs: number, sn: number;
          if (d.facing || (usefar && d.farFlat)) { cs = fcs; sn = fsn; }
          else [cs, sn] = headingCosSin(treeHeadingIndex(t.heading));
          const k = treeScale(t.scale);
          pos[0] = x; pos[1] = y; pos[2] = z;
          // The card's seating lift: k * 0.75 * (sp.minY - fsp.minY) model units, straight up.
          if (usefar && d.farLift !== 0) pos[2] = z + (k * 0.75 * d.farLift) / 64;
          const b = usefar ? far! : near;
          plantMatrix(b.array, b.count * 16, pos, cs, sn, k);
          b.count++;
        }
      }
      for (const b of [...this.near, ...this.far]) b?.commit();
    }

    if (show.grass) {
      for (const b of this.clumpBatch) if (b) b.count = 0;
      const lim = VEG_GRASS_DIST_FT;
      for (const run of this.clumpRuns) {
        if (!inWin(run)) continue;
        // The run's horizontal reach: half the tile diagonal plus its plants' reach.
        const cx = run.tx * 64 + 32, cy = run.tz * 64 + 32;
        if ((Math.hypot(cx - eye.x, cy - eye.y) - 45.26 - run.pad) / SCENE_PER_FT > lim) continue;
        for (let i = run.start; i < run.start + run.count; i++) {
          const c = v.clumps[i]!, d = this.draw[c.species], b = this.clumpBatch[c.species];
          if (!d || !b) continue;
          const [x, y, z] = clumpScene(c);
          if (!keepClump(Math.hypot(x - eye.x, y - eye.y) / SCENE_PER_FT, i, lim)) continue;
          const [cs, sn] = d.facing ? [fcs, fsn] : headingCosSin(clumpHeadingIndex(c.heading));
          pos[0] = x; pos[1] = y; pos[2] = z;
          plantMatrix(b.array, b.count * 16, pos, cs, sn, clumpScale(c.scale));
          b.count++;
        }
      }
      for (const b of this.clumpBatch) b?.commit();
    }

    if (show.aids) this.buildAids(eye, win);
    if (show.wash) this.buildWash(win);
  }

  /* VegDrawAids. */
  private buildAids(eye: THREE.Vector3, win: VegWindow): void {
    const doc = this.doc!, v = this.veg!, t = doc.track;
    const key = `${win.cx0},${win.cy0},${win.cx1},${win.cy1},${Math.round(eye.x / 16)},${Math.round(eye.y / 16)},${Math.round(eye.z / 16)}`;
    if (key === this.aidsKey) return;
    this.aidsKey = key;
    this.clearAids();
    const ground = groundFeet(t);
    const SIDES = 12;
    const ring = [...Array(SIDES).keys()].map((j) => [Math.cos((2 * Math.PI * j) / SIDES), Math.sin((2 * Math.PI * j) / SIDES)] as const);

    // The AI corridor: a translucent band round every segment and a disc at every end and start slot.
    const band: number[] = [], gates: number[] = [];
    const disc = (out: number[], px: number, py: number, pz: number, r: number) => {
      for (let j = 0; j < SIDES; j++) {
        const a = ring[j]!, b = ring[(j + 1) % SIDES]!;
        out.push(px, py, pz, px + r * a[0], py + r * a[1], pz, px + r * b[0], py + r * b[1], pz);
      }
    };
    const hw = Math.max(0, v.corridorft) * SCENE_PER_FT;
    const minx = win.cx0 << 6, maxx = (win.cx1 + 1) << 6, miny = win.cy0 << 6, maxy = (win.cy1 + 1) << 6;
    const whole = win.cx0 <= 0 && win.cy0 <= 0 && win.cx1 >= this.cells - 1 && win.cy1 >= this.cells - 1;
    const outside = (x0: number, y0: number, x1: number, y1: number) => !whole &&
      (Math.max(x0, x1) < minx - 64 || Math.min(x0, x1) > maxx + 64 || Math.max(y0, y1) < miny - 64 || Math.min(y0, y1) > maxy + 64);
    if (hw > 0) {
      for (const course of [t.course, ...t.extendedCourses]) {
        if (!course) continue;
        for (const seg of course) {
          if (outside(seg.cstart[0], seg.cstart[1], seg.cend[0], seg.cend[1])) continue;
          const x0 = seg.cstart[0], y0 = seg.cstart[1], z0 = 3 * seg.cstart[2];
          const x1 = seg.cend[0], y1 = seg.cend[1], z1 = 3 * seg.cend[2];
          const len = Math.hypot(x1 - x0, y1 - y0);
          if (len > 0.5 / 64) {
            const nx = (-(y1 - y0) / len) * hw, ny = ((x1 - x0) / len) * hw;
            band.push(x0 + nx, y0 + ny, z0, x0 - nx, y0 - ny, z0, x1 - nx, y1 - ny, z1, x1 - nx, y1 - ny, z1, x1 + nx, y1 + ny, z1, x0 + nx, y0 + ny, z0);
          }
          disc(band, x0, y0, z0, hw);
          disc(band, x1, y1, z1, hw);
        }
      }
      // The start grid; slot 0 counts only if it was placed.
      for (const truck of t.trucks.slice(0, 9)) {
        if (truck.ipos[0] === 0 && truck.ipos[1] === 0) continue;
        if (outside(truck.ipos[0], truck.ipos[1], truck.ipos[0], truck.ipos[1])) continue;
        disc(band, truck.ipos[0], truck.ipos[1], 3 * truck.ipos[2], hw);
      }
    }
    // Checkpoint gates: the gate's own radius plus the corridor, on the ground.
    for (const box of t.boxes) {
      if (box.type !== 6) continue;
      const xft = (box.ipos[0] + box.fraction[0] / 256) * 0.5, zft = (box.ipos[1] + box.fraction[1] / 256) * 0.5;
      const raw = box.modelName ? this.models?.meshesFor(box.modelName)?.geometry.raw ?? null : null;
      let rft = raw ? vegModelInfo(raw).radiusFt : Math.sqrt(box.length * box.length + box.width * box.width) * 0.5;
      rft += Math.max(0, v.corridorft);
      disc(gates, xft * SCENE_PER_FT, zft * SCENE_PER_FT, ground(xft, zft) * SCENE_Z_PER_FT, rft * SCENE_PER_FT);
    }
    this.aids.add(translucent(band, [255, 200, 40]), translucent(gates, [255, 120, 200]));

    /*
      Trunk collision (Traxx 1.8.0, ae75b30): the ENGINE'S box, not an estimate (veg-trunk.ts,
      vegTrunkDerive / vegTrunkPlace): a square side trunkDiam x s and height trunkHeight x s,
      centred on the tree's origin and yawed by its heading the way the model is drawn, its bottom
      at tree y + s x minY. Red = the engine's box; orange = the same box when canopy vertices are
      inside the lowest-5-ft band (a huge box). Only species with collide = TRUNK and a model in
      the track; within 600 ft.
    */
    const red: number[] = [], orange: number[] = [];
    const range = VEG_AID_RANGE_FT * SCENE_PER_FT;
    for (const run of this.treeRuns) {
      if (run.tx < win.cx0 || run.tx > win.cx1 || run.tz < win.cy0 || run.tz > win.cy1) continue;
      const cz = 0.5 * (run.zmax + run.zmin), r = 2896 / 64 + 0.5 * (run.zmax - run.zmin) + run.pad;
      if (Math.hypot(run.tx * 64 + 32 - eye.x, run.tz * 64 + 32 - eye.y, cz - eye.z) - r > range) continue;
      for (let i = run.start; i < run.start + run.count; i++) {
        const tr = v.trees[i]!;
        const trunk = this.trunks[tr.species];
        if (!trunk) continue; // not a TRUNK species, or no model: the engine has no box
        const pl = vegTrunkPlace(trunk, tr.y, tr.scale);
        const out = trunk.canopyInBand ? orange : red;
        const a = 0.5 * pl.side * SCENE_PER_FT;
        const hd = (2 * Math.PI * tr.heading) / 65536, cs = Math.cos(hd), sn = Math.sin(hd);
        const bx = tr.x / 128, by = tr.z / 128;
        const zb = pl.base * SCENE_Z_PER_FT, zt = (pl.base + pl.height) * SCENE_Z_PER_FT;
        const qx: number[] = [], qy: number[] = [];
        for (let j = 0; j < 4; j++) {
          const lx = j === 0 || j === 3 ? -a : a, ly = j < 2 ? -a : a;
          qx.push(bx + lx * cs + ly * sn);
          qy.push(by - lx * sn + ly * cs);
        }
        for (let j = 0; j < 4; j++) {
          const n = (j + 1) & 3;
          out.push(qx[j]!, qy[j]!, zb, qx[n]!, qy[n]!, zb, qx[j]!, qy[j]!, zt, qx[n]!, qy[n]!, zt, qx[j]!, qy[j]!, zb, qx[j]!, qy[j]!, zt);
        }
      }
    }
    this.aids.add(lines(red, [255, 64, 64]), lines(orange, [255, 160, 0]));
  }

  private clearAids(): void {
    for (const child of [...this.aids.children] as (THREE.Mesh | THREE.LineSegments)[]) {
      this.aids.remove(child);
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }

  /*
    DrawVegetationMaskWash: one colour per 32 ft cell over the ground, on the terrain's split.
    Off Classic 8-bit, on the ground as drawn (DrawVegetationMaskWashSurface): each tile's
    height grid at the level the terrain pass drew it (8 ft near the camera on Spline and Full
    Map, straightened sides included), the split on the grid's own indices.
  */
  private buildWash(win: VegWindow): void {
    const v = this.veg!, t: Terrain16 = this.doc!.track;
    const key = `${win.cx0},${win.cy0},${win.cx1},${win.cy1},${this.lodCentre[0] >> 2},${this.lodCentre[1] >> 2}`;
    if (key === this.washKey) return;
    this.washKey = key;
    for (const l of [VEG_LAYER_TREES, VEG_LAYER_GRASS]) {
      if (this.maskCells[l] === null && v.masks[l]) this.maskCells[l] = maskCells(v.masks[l], this.cells);
    }
    const cx0 = Math.max(0, win.cx0), cy0 = Math.max(0, win.cy0), cx1 = Math.min(this.cells - 2, win.cx1), cy1 = Math.min(this.cells - 2, win.cy1);
    const grids = t.terrainMode === TERRAINMODE_CLASSIC8 ? null : new SurfaceTileGrids(t, this.lodCentre[0], this.lodCentre[1]);
    const n = this.cells;
    const zCorner = (gx: number, gy: number) => 3 * t.heights[gx + gy * n]!;
    const p: number[] = [], c: number[] = [];
    const quad = (x0: number, y0: number, x1: number, y1: number, z: [number, number, number, number], odd: boolean, rgb: number[]) => {
      const vx = [x0, x1, x1, x0], vy = [y0, y0, y1, y1];
      for (const a of odd ? [3, 2, 1, 1, 0, 3] : [0, 3, 2, 2, 1, 0]) { p.push(vx[a]!, vy[a]!, z[a]!); c.push(rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255); }
    };
    for (let gj = cy0; gj <= cy1; gj++) {
      for (let gi = cx0; gi <= cx1; gi++) {
        const rgb = maskColour(this.maskCells[VEG_LAYER_TREES], gi, gj, n) ?? maskColour(this.maskCells[VEG_LAYER_GRASS], gi, gj, n);
        if (!rgb) continue;
        if (!grids) {
          quad(gi * 64, gj * 64, gi * 64 + 64, gj * 64 + 64, [zCorner(gi, gj), zCorner(gi + 1, gj), zCorner(gi + 1, gj + 1), zCorner(gi, gj + 1)], ((gi + gj) & 1) === 1, rgb);
          continue;
        }
        const per = grids.per(gi, gj), step = 64 / per;
        const z = (a: number, b: number) => (3 * grids.at(gi, gj, a, b)) / 256;
        for (let b = 0; b < per; b++) {
          for (let a = 0; a < per; a++) {
            const fx = gi * per + a, fy = gj * per + b;
            quad(gi * 64 + a * step, gj * 64 + b * step, gi * 64 + (a + 1) * step, gj * 64 + (b + 1) * step,
              [z(a, b), z(a + 1, b), z(a + 1, b + 1), z(a, b + 1)], ((fx + fy) & 1) === 1, rgb);
          }
        }
      }
    }
    this.wash.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    this.wash.geometry = g;
  }

  /** The ground or the window changed: the wash and aids are built again on the next update. */
  invalidate(): void {
    this.washKey = "";
    this.aidsKey = "";
  }

  private clear(): void {
    // The geometry and materials belong to the ModelLibrary; only the instance buffers are ours.
    for (const g of [this.trees, this.grass]) for (const child of [...g.children]) { g.remove(child); (child as THREE.InstancedMesh).dispose(); }
    this.clearAids();
    this.wash.geometry.dispose();
    this.wash.geometry = new THREE.BufferGeometry();
    this.near = []; this.far = []; this.clumpBatch = []; this.draw = []; this.facts = []; this.farRadius = [];
    this.treeRuns = []; this.clumpRuns = [];
    this.maskCells = [null, null];
    this.veg = null;
    this.invalidate();
  }

  dispose(): void {
    this.clear();
    (this.wash.material as THREE.Material).dispose();
  }
}

/* The model's drawn vertices back in model units (the geometry holds raw / 64). */
function drawnVertices(groups: { positions: Float32Array }[]): Float32Array {
  const n = groups.reduce((a, g) => a + g.positions.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const g of groups) for (let i = 0; i < g.positions.length; i++) out[o++] = g.positions[i]! * 64;
  return out;
}

/* VegGroundHeight: feet at world feet (x, z). */
function groundFeet(t: TrackDocument["track"]): (x: number, z: number) => number {
  if (t.terrainMode === TERRAINMODE_CLASSIC8) return (x, z) => vegGroundHeightClassic8(t.heights, x, z);
  return (x, z) => surfaceFeet(t, x, z);
}

/* VegEnsureMasks: one RGB per 32 ft cell, the pixel at (gi * w / N, gj * h / N); N x N cells (version 6, 8.1). */
function maskCells(mask: { ext: string; data: Uint8Array }, n = 256): Uint8Array | null {
  const { img } = vegDecodeMask(mask);
  if (!img) return null;
  const cells = new Uint8Array(n * n * 3);
  for (let gj = 0; gj < n; gj++) {
    const my = Math.min(img.h - 1, Math.trunc((gj * img.h) / n));
    for (let gi = 0; gi < n; gi++) {
      const mx = Math.min(img.w - 1, Math.trunc((gi * img.w) / n));
      const s = (my * img.w + mx) * 3, d = (gj * n + gi) * 3;
      cells[d] = img.rgb[s]!; cells[d + 1] = img.rgb[s + 1]!; cells[d + 2] = img.rgb[s + 2]!;
    }
  }
  return cells;
}

/* VegMaskColour: the cell's colour, or null when it is unpainted (every channel 4 or less). */
function maskColour(cells: Uint8Array | null, gi: number, gj: number, n = 256): number[] | null {
  if (!cells) return null;
  const p = (Math.min(n - 1, Math.max(0, gj)) * n + Math.min(n - 1, Math.max(0, gi))) * 3;
  if (cells[p]! <= 4 && cells[p + 1]! <= 4 && cells[p + 2]! <= 4) return null;
  return [cells[p]!, cells[p + 1]!, cells[p + 2]!];
}

function translucent(p: number[], rgb: [number, number, number]): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255), transparent: true, opacity: 72 / 255, depthWrite: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  m.frustumCulled = false;
  return m;
}

function lines(p: number[], rgb: [number, number, number]): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) }));
  l.frustumCulled = false;
  return l;
}
