/*
  The objects layer: every box with its model, or Traxx's purple collider box (yellow wedge for
  a ramp) when it has none; a top crush draws its cab and its base under the same transform
  (CTraxxView::DrawBoxOpenGL). Drawn in Objects mode or with Always Show Objects, for boxes
  inside the grid window (at most 256 cells; CalculateBoxLocationsOpenGL).

  One InstancedMesh per model part, rebuilt when the window moves or the objects change.

  Traxx 1.7.1 (c30ad86, DrawBoxWrapCopiesOpenGL): an object within 3 cells of an edge is drawn
  again past the opposite edge (SurfaceBoxWrapShifts), tinted and trimmed to the world-wrap
  border as the terrain's copy is. Copies are never in the track's list, so nothing selects
  them; ground boxes (buildings) are not copied, and neither are model-less fogs.
*/
import * as THREE from "three";
import type { TrackDocument } from "../core/doc/document.ts";
import { objectMatrix } from "../core/view/model-geometry.ts";
import { gammaMap } from "../core/view/tiles.ts";
import { remapIndices } from "../core/traxx/palette.ts";
import { TRAXX_BOX_CRUSH, TRAXX_BOX_FOG, TRAXX_BOX_RAMP } from "../core/traxx/sit.ts";
import type { ModelLibrary } from "./models.ts";
import { cellsOf } from "../core/traxx/world.ts";
import { surfaceBoxWrapShifts, SURFACE_WRAP_BORDER_CELLS, WRAP_BORDER_TINT, WRAP_BORDER_TINT_WEIGHT } from "../core/view/surface-tiles.ts";

/*
  The border band, cells -3..N+2, as clipping planes in scene units (64 a cell): BeginWrapBorderPass's
  planes. N is 256, or a track format version 6 world's worldCells (spec section 8.1).
*/
function borderPlanes(cells: number): THREE.Plane[] {
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), SURFACE_WRAP_BORDER_CELLS * 64),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), (cells + SURFACE_WRAP_BORDER_CELLS) * 64),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), SURFACE_WRAP_BORDER_CELLS * 64),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), (cells + SURFACE_WRAP_BORDER_CELLS) * 64),
  ];
}

/* A copy's material: the object's own, its colour washed 0.35 of (0.70, 0.80, 0.95), clipped to the band. */
function borderMaterial(m: THREE.Material, planes: THREE.Plane[]): THREE.Material {
  const c = m.clone();
  c.clippingPlanes = planes;
  const tint = `vec3(${WRAP_BORDER_TINT.map((v) => v.toFixed(2)).join(", ")})`;
  c.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(/}\s*$/, `  gl_FragColor.rgb = mix(gl_FragColor.rgb, ${tint}, ${WRAP_BORDER_TINT_WEIGHT.toFixed(2)});\n}`);
  };
  c.customProgramCacheKey = () => "wrap-border";
  return c;
}

/* The collider box and ramp (CTraxxView::BuildPoly): corners 0..3 bottom, 4..7 top, at
   (-w,-l) (-w,+l) (+w,+l) (+w,-l); faces and their colours. */
const BOX_FACES: [number, number, number, "top" | "side" | "bottom"][] = [
  [0, 2, 1, "bottom"], [2, 0, 3, "bottom"], [4, 6, 7, "top"], [6, 4, 5, "top"],
  [4, 0, 5, "side"], [5, 0, 1, "side"], [5, 1, 6, "side"], [6, 1, 2, "side"],
  [6, 2, 7, "side"], [7, 2, 3, "side"], [7, 3, 4, "side"], [4, 3, 0, "side"],
];
const RAMP_FACES: [number, number, number, "top" | "side" | "bottom"][] = [
  [0, 2, 1, "bottom"], [2, 0, 3, "bottom"], [0, 5, 3, "top"], [3, 5, 6, "top"],
  [2, 3, 6, "side"], [1, 5, 0, "side"], [5, 1, 6, "side"], [6, 1, 2, "side"],
];
const UNIT = [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1], [-1, -1, 1], [-1, 1, 1], [1, 1, 1], [1, -1, 1]];

function solidGeometry(faces: typeof BOX_FACES, colours: Record<"top" | "side" | "bottom", THREE.Color>): THREE.BufferGeometry {
  const p: number[] = [], c: number[] = [];
  for (const [a, b, d, kind] of faces) for (const v of [a, b, d]) { p.push(...UNIT[v]); c.push(colours[kind].r, colours[kind].g, colours[kind].b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
  return g;
}

/** BestMatch of an RGB in the track palette, through the gamma. */
function paletteColour(palette: Uint8Array, gamma: Uint8Array, rgb: [number, number, number]): THREE.Color {
  const want = new Uint8Array(768);
  want.set(rgb);
  const i = remapIndices(Uint8Array.of(0), want, palette)[0];
  return new THREE.Color(gamma[palette[i * 3]] / 255, gamma[palette[i * 3 + 1]] / 255, gamma[palette[i * 3 + 2]] / 255);
}

export class ObjectLayer {
  readonly group = new THREE.Group();
  private doc: TrackDocument;
  private models: ModelLibrary;
  private boxGeo: THREE.BufferGeometry;
  private rampGeo: THREE.BufferGeometry;
  private solidMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  /** The border copies' materials, one per material copied. */
  private borderMats = new Map<THREE.Material, THREE.Material>();
  hideColliders = false;
  private planes: THREE.Plane[] | null = null;

  constructor(doc: TrackDocument, models: ModelLibrary, gamma: number) {
    this.doc = doc;
    this.models = models;
    const g = gammaMap(gamma), p = doc.track.palette;
    this.boxGeo = solidGeometry(BOX_FACES, { top: paletteColour(p, g, [140, 0, 200]), side: paletteColour(p, g, [100, 0, 150]), bottom: paletteColour(p, g, [60, 0, 100]) });
    this.rampGeo = solidGeometry(RAMP_FACES, { top: paletteColour(p, g, [200, 200, 0]), side: paletteColour(p, g, [150, 150, 0]), bottom: paletteColour(p, g, [100, 100, 0]) });
  }

  /** Rebuild the instances for the boxes inside the window (ipos bounds, inclusive). */
  rebuild(bounds: { minx: number; maxx: number; miny: number; maxy: number }): void {
    for (const child of [...this.group.children]) { this.group.remove(child); (child as THREE.InstancedMesh).dispose?.(); }
    // Two passes: the objects (pass 0) and their world-wrap border copies (pass 1).
    const byModel = [new Map<string, THREE.Matrix4[]>(), new Map<string, THREE.Matrix4[]>()];
    const boxes: THREE.Matrix4[][] = [[], []], ramps: THREE.Matrix4[][] = [[], []];
    let pass = 0;
    const add = (name: string, m: THREE.Matrix4) => { let l = byModel[pass]!.get(name); if (!l) byModel[pass]!.set(name, (l = [])); l.push(m); };
    const cells = cellsOf(this.doc.track);
    const places: { box: TrackDocument["track"]["boxes"][number]; dx: number; dy: number; copy: boolean }[] = [];
    for (const box of this.doc.track.boxes) {
      places.push({ box, dx: 0, dy: 0, copy: false });
      for (const [dx, dy] of surfaceBoxWrapShifts((box.ipos[0] >> 6) & (cells - 1), (box.ipos[1] >> 6) & (cells - 1), SURFACE_WRAP_BORDER_CELLS, cells)) places.push({ box, dx, dy, copy: true });
    }
    for (const { box, dx, dy, copy } of places) {
      // A copy is culled and placed by its shifted position (CalculateBoxLocationsOpenGL's shiftx, shifty).
      const x = box.ipos[0] + (dx << 6), y = box.ipos[1] + (dy << 6);
      if (x < bounds.minx || x > bounds.maxx || y < bounds.miny || y > bounds.maxy) continue;
      pass = copy ? 1 : 0;
      const m = new THREE.Matrix4().fromArray(objectMatrix(box));
      if (copy) m.premultiply(new THREE.Matrix4().makeTranslation(dx * 64, dy * 64, 0));
      const drawName = box.type === TRAXX_BOX_CRUSH && box.crushName ? this.crushCab(box.crushName) : box.modelName;
      const meshes = drawName ? this.models.meshesFor(drawName) : null;
      if (meshes && meshes.parts.length) {
        add(drawName, m);
        if (box.type === TRAXX_BOX_CRUSH && box.modelName && box.modelName !== drawName && this.models.meshesFor(box.modelName)) add(box.modelName, m);
        continue;
      }
      // A model-less Fog is not drawn as a solid: its volume is its picture (DrawBoxOpenGL; render/fog-boxes.ts).
      if (box.type === TRAXX_BOX_FOG) continue;
      if (box.type !== TRAXX_BOX_RAMP && this.hideColliders) continue;
      // The collider's corners are +-width, +-length, +-height in ipos before the squash.
      const scaled = m.clone().multiply(new THREE.Matrix4().makeScale(box.width, box.length, box.height));
      (box.type === TRAXX_BOX_RAMP ? ramps : boxes)[pass]!.push(scaled);
    }
    for (let p = 0; p < 2; p++) {
      const mat = (m: THREE.Material) => (p ? this.borderMaterial(m) : m);
      for (const [name, list] of byModel[p]!) {
        const meshes = this.models.meshesFor(name)!;
        for (const part of meshes.parts) this.group.add(instanced(part.geometry, mat(part.material), list));
      }
      if (boxes[p]!.length) this.group.add(instanced(this.boxGeo, mat(this.solidMat), boxes[p]!));
      if (ramps[p]!.length) this.group.add(instanced(this.rampGeo, mat(this.solidMat), ramps[p]!));
    }
  }

  private borderMaterial(m: THREE.Material): THREE.Material {
    let c = this.borderMats.get(m);
    if (!c) this.borderMats.set(m, (c = borderMaterial(m, (this.planes ??= borderPlanes(cellsOf(this.doc.track))))));
    return c;
  }

  /** The cab of a top crush: a keyframe control record draws its frame 0 (ParseSITFile). */
  private crushCab(name: string): string {
    const asset = this.models.asset(name);
    return asset && asset.frameNames.length ? asset.frameNames[0] : name;
  }

  dispose(): void {
    this.boxGeo.dispose();
    this.rampGeo.dispose();
    this.solidMat.dispose();
    for (const m of this.borderMats.values()) m.dispose();
  }
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
