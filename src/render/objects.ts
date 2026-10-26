/*
  The objects layer: every box with its model, or Traxx's purple collider box (yellow wedge for
  a ramp) when it has none; a top crush draws its cab and its base under the same transform
  (CTraxxView::DrawBoxOpenGL). Drawn in Objects mode or with Always Show Objects, for boxes
  inside the grid window (at most 256 cells; CalculateBoxLocationsOpenGL).

  One InstancedMesh per model part, rebuilt when the window moves or the objects change.
*/
import * as THREE from "three";
import type { TrackDocument } from "../core/doc/document.ts";
import { objectMatrix } from "../core/view/model-geometry.ts";
import { gammaMap } from "../core/view/tiles.ts";
import { remapIndices } from "../core/traxx/palette.ts";
import { TRAXX_BOX_CRUSH, TRAXX_BOX_RAMP } from "../core/traxx/sit.ts";
import type { ModelLibrary } from "./models.ts";

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
  hideColliders = false;

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
    const byModel = new Map<string, THREE.Matrix4[]>();
    const boxes: THREE.Matrix4[] = [], ramps: THREE.Matrix4[] = [];
    const add = (name: string, m: THREE.Matrix4) => { let l = byModel.get(name); if (!l) byModel.set(name, (l = [])); l.push(m); };
    for (const box of this.doc.track.boxes) {
      if (box.ipos[0] < bounds.minx || box.ipos[0] > bounds.maxx || box.ipos[1] < bounds.miny || box.ipos[1] > bounds.maxy) continue;
      const m = new THREE.Matrix4().fromArray(objectMatrix(box));
      const drawName = box.type === TRAXX_BOX_CRUSH && box.crushName ? this.crushCab(box.crushName) : box.modelName;
      const meshes = drawName ? this.models.meshesFor(drawName) : null;
      if (meshes && meshes.parts.length) {
        add(drawName, m);
        if (box.type === TRAXX_BOX_CRUSH && box.modelName && box.modelName !== drawName && this.models.meshesFor(box.modelName)) add(box.modelName, m);
        continue;
      }
      if (box.type !== TRAXX_BOX_RAMP && this.hideColliders) continue;
      // The collider's corners are +-width, +-length, +-height in ipos before the squash.
      const scaled = m.clone().multiply(new THREE.Matrix4().makeScale(box.width, box.length, box.height));
      (box.type === TRAXX_BOX_RAMP ? ramps : boxes).push(scaled);
    }
    for (const [name, list] of byModel) {
      const meshes = this.models.meshesFor(name)!;
      for (const part of meshes.parts) this.group.add(instanced(part.geometry, part.material, list));
    }
    if (boxes.length) this.group.add(instanced(this.boxGeo, this.solidMat, boxes));
    if (ramps.length) this.group.add(instanced(this.rampGeo, this.solidMat, ramps));
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
  }
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
