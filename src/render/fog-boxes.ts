/*
  The fog volumes (CTraxxView::DrawFogVolumesOpenGL, COpenGLTerrainRenderer::DrawFogVolumes), Traxx
  1.8.0 (ce4aa17, 35b087b): every Fog in the track (and the one a dialog is previewing) and the
  waterfalls' mist, drawn with the ENGINE'S density (core/view/engine-fog.ts) as stacked slices.

    - A grid of extinctions per volume (engineFogGridBuild), cached on the volume's id and a hash of
      its fields (FogHash), so it is rebuilt only when the author changes something. A failed build is
      cached as failed.
    - Per frame the slice axis is the box axis the camera looks down most; each node's alpha is
      1 - exp(-extinction * thickness / |cos|), |cos| baked at one of three bands with 0.03 of
      hysteresis; each column is scaled so its optical depth stops at -ln(1 - maxOp). The slices are
      drawn far to near for the look direction; recompiled only when the axis, the look's sign, the
      band or the colour changes.
    - Colour = rgb * the Preview Weather's fog ambient (engineFogAmbient, floored at 0.05).
    - Volumes far to near by horizontal distance to the footprint centre; only the nearest 16 unless
      View > Visual Helpers > Draw All Fog Volumes (the cut ones draw nothing, not even an outline).
    - Guides: the pale loop where the side fade ends (at the floor and the top), a dashed loop where
      2^(-y/half) halves, and the firmer footprint edges in the fog's colour (alpha 0.7).
    Depth tested, not written; both faces; SRC_ALPHA, ONE_MINUS_SRC_ALPHA.

  The caller (track-view.ts) applies the engine's skips (the wmask's preview weather bit, W, L or H
  <= 0.5 ft) and appends the mist after the fog boxes (fall-mist.ts mistDrawPlan).

  Known limits, as Traxx's: 8-bit blending loses very faint fog, slices meet the ground in steps,
  and 1/|cos| is baked in three bands. Scene units: a foot is 2 across, 1.5 up.
*/
import * as THREE from "three";
import {
  engineFogBand, engineFogBandCos, engineFogCameraLocal, engineFogColour, engineFogDrawOrder, engineFogGridBuild, engineFogGuideColour,
  engineFogHalfGuide, engineFogInsetRing, engineFogParamsHash, engineFogResolve, engineFogSliceAlphas, engineFogSliceAxis, engineFogSliceMesh,
  type EngineFogFrame, type EngineFogGrid, type EngineFogParams, type EngineFogVol,
} from "../core/view/engine-fog.ts";

/** One volume to draw (TraxxGLFogVolume), in scene units. */
export interface FogDrawVolume {
  /** Box slot + 1, or mistFogId (100000 + fall * 4 + stream). */
  id: number;
  params: EngineFogParams;
  frame: EngineFogFrame;
  r: number;
  g: number;
  b: number;
  /** The previewed weather's fog ambient (engineFogAmbient). */
  ambient: number;
  /** The footprint outline (x, y) at floorz and topz. */
  ring: [number, number][];
  floorz: number;
  topz: number;
}

interface Entry {
  id: number;
  hash: number;
  failed: boolean;
  vol: EngineFogVol;
  grid: EngineFogGrid | null;
  ringEdge: [number, number][];
  ringOut: [number, number][];
  axis: number;
  descending: boolean;
  band: number;
  colour: string;
  slices: THREE.Mesh | null;
  guides: THREE.Group;
}

const sliceVertex = /* glsl */ `
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const sliceFragment = /* glsl */ `
  uniform vec3 uColour;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(uColour, vAlpha); }
`;

/** The frame matrix: local feet (x across, y up from the floor, z along) to scene units. */
function frameMatrix(f: EngineFogFrame): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    f.ex[0], 0, f.ez[0], f.cx,
    f.ex[1], 0, f.ez[1], f.cy,
    0, f.zpf, 0, f.floorz,
    0, 0, 0, 1);
}

export class FogBoxLayer {
  readonly group = new THREE.Group();
  private volumes: FogDrawVolume[] = [];
  private entries = new Map<number, Entry>();
  private edges: THREE.LineSegments | null = null;
  private edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  private drawAll = false;
  /** The volumes the last frame drew, in order (their ids), to skip rebuilding the group. */
  private drawn = "";

  constructor() {
    // After the water (renderOrder 10): DrawFogVolumesOpenGL follows DrawLakes.
    this.group.renderOrder = 11;
  }

  /** The volumes as they are now (after the engine's skips), and Draw All Fog Volumes. */
  setVolumes(volumes: FogDrawVolume[], drawAll: boolean): void {
    this.volumes = volumes;
    this.drawAll = drawAll;
    this.drawn = "";
    // Volumes no longer drawn: their grids and meshes go (FogMeshFree of the unused).
    const ids = new Set(volumes.map((v) => v.id));
    for (const [id, e] of this.entries) {
      const v = volumes.find((x) => x.id === id);
      if (!ids.has(id) || !v || engineFogParamsHash(v.params) !== e.hash) this.free(id);
    }
    for (const v of volumes) if (!this.entries.has(v.id)) this.entries.set(v.id, this.entryFor(v));
    for (const v of volumes) this.placeGuides(this.entries.get(v.id)!, v);
  }

  private entryFor(v: FogDrawVolume): Entry {
    const vol = engineFogResolve(v.params, 0);
    const grid = engineFogGridBuild(vol);
    return {
      id: v.id, hash: engineFogParamsHash(v.params), failed: !grid, vol, grid,
      ringEdge: engineFogInsetRing(vol, vol.edge), ringOut: engineFogInsetRing(vol, 0),
      axis: -1, descending: false, band: -1, colour: "", slices: null, guides: new THREE.Group(),
    };
  }

  private free(id: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.slices) { e.slices.geometry.dispose(); (e.slices.material as THREE.Material).dispose(); }
    for (const c of e.guides.children) { (c as THREE.Line).geometry.dispose(); ((c as THREE.Line).material as THREE.Material).dispose(); }
    this.entries.delete(id);
  }

  /* The guides in the volume's own frame: the side fade's end at the floor and top, the dashed y = half loop. */
  private placeGuides(e: Entry, v: FogDrawVolume): void {
    for (const c of [...e.guides.children]) { e.guides.remove(c); (c as THREE.Line).geometry.dispose(); ((c as THREE.Line).material as THREE.Material).dispose(); }
    e.guides.matrixAutoUpdate = false;
    e.guides.matrix.copy(frameMatrix(v.frame));
    const [pr, pg, pb, pa] = engineFogGuideColour(v.r, v.g, v.b);
    const loop = (ring: [number, number][], y: number, dashed: boolean) => {
      if (ring.length < 2) return;
      const pts = ring.map(([x, z]) => new THREE.Vector3(x, y, z));
      pts.push(pts[0]!.clone());
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = dashed
        ? new THREE.LineDashedMaterial({ color: new THREE.Color(pr, pg, pb), transparent: true, opacity: pa, depthWrite: false, dashSize: 3, gapSize: 3 })
        : new THREE.LineBasicMaterial({ color: new THREE.Color(pr, pg, pb), transparent: true, opacity: pa, depthWrite: false });
      const l = new THREE.Line(g, m);
      if (dashed) l.computeLineDistances();
      l.frustumCulled = false;
      e.guides.add(l);
    };
    loop(e.ringEdge, 0, false);
    loop(e.ringEdge, e.vol.H, false);
    const half = engineFogHalfGuide(e.vol);
    if (half !== null) loop(e.ringOut, half, true);
    e.colour = "";
  }

  /** The frame's pass: order, the nearest 16, the slices for the camera. */
  update(camera: THREE.Camera): void {
    if (!this.group.visible) return;
    const vols = this.volumes;
    camera.updateMatrixWorld();
    const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const look = new THREE.Vector3();
    camera.getWorldDirection(look);
    const locals = vols.map((v) => engineFogCameraLocal(v.frame, [eye.x, eye.y, eye.z], [look.x, look.y, look.z]));
    const dists = locals.map((l) => (l ? Math.sqrt(l.cam[0] * l.cam[0] + l.cam[2] * l.cam[2]) : 0));
    const order = engineFogDrawOrder(dists, this.drawAll);
    let changed = false;
    for (const i of order) {
      const v = vols[i]!, e = this.entries.get(v.id), l = locals[i];
      if (!e || e.failed || !e.grid || !l) continue;
      const s = engineFogSliceAxis(l.dir);
      if (!s) continue;
      const band = engineFogBand(s.cosv, s.axis, e.axis, e.band);
      const [cr, cg, cb] = engineFogColour(v.r, v.g, v.b, v.ambient);
      const colour = `${cr},${cg},${cb}`;
      if (!e.slices || e.axis !== s.axis || e.descending !== s.descending || e.band !== band || e.colour !== colour) {
        e.axis = s.axis; e.descending = s.descending; e.band = band; e.colour = colour;
        this.compile(e, v, new THREE.Color(cr, cg, cb));
        changed = true;
      }
    }
    const key = order.map((i) => vols[i]!.id).join(",");
    if (!changed && key === this.drawn) return;
    this.drawn = key;
    this.group.clear();
    let k = 0;
    for (const i of order) {
      const e = this.entries.get(vols[i]!.id);
      if (!e) continue;
      // Far to near: each volume's slices, then its guides.
      if (e.slices) { e.slices.renderOrder = 11 + k++ * 1e-4; this.group.add(e.slices); }
      e.guides.renderOrder = 11 + k++ * 1e-4;
      for (const c of e.guides.children) c.renderOrder = e.guides.renderOrder;
      this.group.add(e.guides);
    }
    this.buildEdges(order);
  }

  /* FogMeshCompile: the slices far to near for this axis, look sign and band. */
  private compile(e: Entry, v: FogDrawVolume, colour: THREE.Color): void {
    if (e.slices) { e.slices.geometry.dispose(); (e.slices.material as THREE.Material).dispose(); e.slices = null; }
    const alphas = engineFogSliceAlphas(e.grid!, e.vol.maxop, e.axis, engineFogBandCos(e.band));
    const mesh = engineFogSliceMesh(e.grid!, alphas, e.axis, e.descending, e.vol);
    if (!mesh.quads) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
    g.setAttribute("aAlpha", new THREE.Float32BufferAttribute(mesh.alphas, 1));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: sliceVertex, fragmentShader: sliceFragment, uniforms: { uColour: { value: colour } },
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.NormalBlending,
    });
    const o = new THREE.Mesh(g, m);
    o.matrixAutoUpdate = false;
    o.matrix.copy(frameMatrix(v.frame));
    o.frustumCulled = false;
    e.slices = o;
  }

  /* The firmer edges: floor and top outlines, verticals at every corner (eight round a rounded footprint). */
  private buildEdges(order: number[]): void {
    if (this.edges) { this.edges.geometry.dispose(); this.edges = null; }
    const p: number[] = [], c: number[] = [];
    for (const i of order) {
      const v = this.volumes[i]!;
      const n = v.ring.length;
      if (n < 3) continue;
      const stride = n > 4 ? Math.trunc(n / 8) : 1;
      const push = (a: [number, number], za: number, b: [number, number], zb: number) => {
        p.push(a[0], a[1], za, b[0], b[1], zb);
        c.push(v.r, v.g, v.b, 0.7, v.r, v.g, v.b, 0.7);
      };
      for (let k = 0; k < n; k++) {
        const a = v.ring[k]!, b = v.ring[(k + 1) % n]!;
        push(a, v.floorz, b, v.floorz);
        push(a, v.topz, b, v.topz);
        if (k % stride === 0) push(a, v.floorz, a, v.topz);
      }
    }
    if (!p.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(c, 4));
    this.edges = new THREE.LineSegments(g, this.edgeMat);
    this.edges.frustumCulled = false;
    this.edges.renderOrder = 12;
    this.group.add(this.edges);
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.free(id);
    if (this.edges) this.edges.geometry.dispose();
    this.edgeMat.dispose();
    this.group.clear();
  }
}
