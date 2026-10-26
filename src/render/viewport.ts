/*
  The 3D view: a three.js renderer in the work area, Traxx's camera (core/view/camera.ts)
  applied to a perspective camera, and drawing on demand.

  Colours pass through untouched (no colour management), as Traxx's GL view writes palette
  colours straight to the screen.

  Projection: Traxx's GL view uses a fixed focal length of 512 pixels with the camera depth
  stretched by 1200/1024 (COpenGLTerrainRenderer::SetPerspectiveProjection and the nav stack's
  PushZStretch(1200)), about 437 pixels; at its default 640 x 480 that is a 57.5 degree
  vertical field. The same field is kept at any window size.
*/
import * as THREE from "three";
import type { TraxxCamera } from "../core/view/camera.ts";
import { applyTraxxCamera } from "./camera-math.ts";

THREE.ColorManagement.enabled = false;

export const FOCAL_480 = 512 * (1024 / 1200);
export const FOV_Y = (2 * Math.atan(240 / FOCAL_480) * 180) / Math.PI;

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV_Y, 4 / 3, 4, 40000);
  readonly canvas: HTMLCanvasElement;
  /** Drawn before the scene, around the camera, without depth (the backdrop). */
  backdrop: THREE.Scene | null = null;
  private backdropCamera = new THREE.PerspectiveCamera(FOV_Y, 4 / 3, 1, 1e7);
  private pending = false;
  private beforeRender: (() => void)[] = [];
  private afterRender: (() => void)[] = [];
  private captures: { layers: HTMLCanvasElement[]; done: (c: HTMLCanvasElement) => void }[] = [];

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.className = "view-canvas";
    host.append(this.canvas);
    this.camera.up.set(0, 0, 1);
    this.camera.rotation.order = "ZXY";
    new ResizeObserver(() => this.resize(host)).observe(host);
    this.resize(host);
  }

  private resize(host: HTMLElement): void {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Run before each frame (to step the camera, say). */
  onBeforeRender(fn: () => void): void {
    this.beforeRender.push(fn);
  }

  /** Run after each frame (the 2D overlay). */
  onAfterRender(fn: () => void): void {
    this.afterRender.push(fn);
  }

  requestRender(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      for (const fn of this.beforeRender) fn();
      if (this.backdrop && this.backdrop.children.length) {
        const bc = this.backdropCamera;
        bc.aspect = this.camera.aspect;
        bc.fov = this.camera.fov;
        bc.updateProjectionMatrix();
        bc.position.set(0, 0, 0);
        bc.quaternion.copy(this.camera.quaternion);
        bc.updateMatrixWorld();
        this.renderer.autoClear = false;
        this.renderer.setClearColor((this.scene.background as THREE.Color | null) ?? new THREE.Color(0));
        this.renderer.clear();
        this.renderer.render(this.backdrop, bc);
        this.renderer.clearDepth();
        const bg = this.scene.background;
        this.scene.background = null;
        this.renderer.render(this.scene, this.camera);
        this.scene.background = bg;
        this.renderer.autoClear = true;
      } else {
        this.renderer.render(this.scene, this.camera);
      }
      for (const fn of this.afterRender) fn();
      // A capture reads the frame in the same task it was drawn, before the browser clears it.
      for (const cap of this.captures.splice(0)) {
        const out = document.createElement("canvas");
        out.width = this.canvas.width;
        out.height = this.canvas.height;
        const g = out.getContext("2d")!;
        g.drawImage(this.canvas, 0, 0);
        for (const layer of cap.layers) g.drawImage(layer, 0, 0, out.width, out.height);
        cap.done(out);
      }
    });
  }

  /** The next frame as a picture, with `layers` (the 2D overlay) drawn over it. */
  capture(layers: HTMLCanvasElement[] = []): Promise<HTMLCanvasElement> {
    return new Promise((done) => { this.captures.push({ layers, done }); this.requestRender(); });
  }

  setBackground(colour: string): void {
    this.scene.background = new THREE.Color(colour);
    this.requestRender();
  }

  /** The three.js camera at Traxx's position and facing (render/camera-math.ts). */
  placeCamera(cam: TraxxCamera): void {
    applyTraxxCamera(this.camera, cam);
  }
}
