/*
  The Models window's preview (COpenGLTerrainRenderer::DrawModelPreview): one model on its own,
  40 degrees of vertical field of view, the camera backed off to fit the model's bounding
  sphere (with 1.15 of headroom) times the zoom, tipped by the pitch and the model turned by
  the yaw about its own vertical. Depth tested, no culling. Uses the main view's meshes and
  materials; a second WebGL context of its own.
*/
import * as THREE from "three";
import type { ModelMeshes } from "./models.ts";

const PREVIEW_FOV = 40;

export class ModelPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(PREVIEW_FOV, 1, 1, 1000);
  private group = new THREE.Group();

  readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    } catch {
      this.renderer = null;
    }
    this.group.matrixAutoUpdate = false;
    this.scene.add(this.group);
  }

  get available(): boolean {
    return this.renderer !== null;
  }

  /** yaw and pitch in degrees; zoom as the distance over 200 (OBJZOOM_START). */
  draw(meshes: ModelMeshes | null, yaw: number, pitch: number, zoom: number, background: string): void {
    const r = this.renderer;
    if (!r) return;
    const w = Math.max(8, this.canvas.clientWidth), h = Math.max(8, this.canvas.clientHeight);
    r.setPixelRatio(window.devicePixelRatio || 1);
    r.setSize(w, h, false);
    r.setClearColor(new THREE.Color(background));
    this.group.clear();
    let radius = 0;
    if (meshes) {
      for (const g of meshes.geometry.groups) {
        const p = g.positions;
        for (let i = 0; i < p.length; i += 3) radius = Math.max(radius, p[i]! * p[i]! + p[i + 1]! * p[i + 1]! + p[i + 2]! * p[i + 2]!);
      }
      for (const part of meshes.parts) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.frustumCulled = false;
        this.group.add(mesh);
      }
    }
    radius = Math.max(1, Math.sqrt(radius));
    const z = Math.min(20, Math.max(0.05, zoom));
    const distance = (radius / Math.sin((PREVIEW_FOV * Math.PI) / 360)) * 1.15 * z;
    this.camera.aspect = w / h;
    this.camera.near = radius * 0.01 + 1;
    this.camera.far = distance + radius * 4 + 1000;
    this.camera.updateProjectionMatrix();
    const m = new THREE.Matrix4().makeTranslation(0, 0, -distance)
      .multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(pitch - 90)))
      .multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(yaw)));
    this.group.matrix.copy(m);
    this.group.matrixWorldNeedsUpdate = true;
    r.render(this.scene, this.camera);
  }

  dispose(): void {
    this.group.clear();
    this.renderer?.dispose();
  }
}
