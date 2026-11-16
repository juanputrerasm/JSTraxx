/*
  The 3D view: a three.js renderer in the work area, Traxx's camera (core/view/camera.ts)
  applied to a perspective camera, and drawing on demand.

  Colours pass through untouched (no colour management), as Traxx's GL view writes palette
  colours straight to the screen.

  Projection (View > Field of View, Traxx 1.7.3 2e6965d, COpenGLTerrainRenderer::RecomputeViewFocal):
  the focal is (longer side / 2) / tan(fov / 2), the field of view measured across the window's
  longer side, 50 to 90 degrees (default 70). Traxx's camera depth is stretched by 1200/1024 (the
  nav stack's PushZStretch(1200)), which three.js has no place for, so it is folded into the
  focal: the camera's effective focal is focal * 1024 / 1200, exactly what Traxx draws.

  Legacy (fov 0): Traxx's focal is a fixed 512 pixels (about 437 after the stretch), so its angle
  grows with the window. JSTraxx 1.0 deliberately kept the angle that gives at Traxx's default
  640 x 480 window, a 57.5 degree vertical field, at any window size; Legacy keeps that.

  Picking (three.js rays through this camera) and the 2D overlay (projection through it) follow
  the same projection.
*/
import * as THREE from "three";
import type { TraxxCamera } from "../core/view/camera.ts";
import { applyTraxxCamera } from "./camera-math.ts";

THREE.ColorManagement.enabled = false;

export const FOCAL_480 = 512 * (1024 / 1200);
export const FOV_Y = (2 * Math.atan(240 / FOCAL_480) * 180) / Math.PI;
/** TRAXX_GL_VIEWSTATE_ZSTRETCH: the camera depth stretch folded into the focal. */
const ZSTRETCH = 1200 / 1024;

/**
  The vertical field of view (degrees) three.js needs for a w x h view at Traxx's field of view
  `fovDeg` across the longer side (RecomputeViewFocal); 0 or less is Legacy (FOV_Y).
*/
export function verticalFovFor(fovDeg: number, w: number, h: number): number {
  const longer = Math.max(w, h);
  if (fovDeg <= 0 || longer <= 0 || h <= 0) return FOV_Y;
  const deg = Math.min(150, fovDeg);
  const focal = (longer * 0.5) / Math.tan((deg * Math.PI) / 360);
  return (2 * Math.atan((h * 0.5) / (focal / ZSTRETCH)) * 180) / Math.PI;
}

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV_Y, 4 / 3, 4, 40000);
  readonly canvas: HTMLCanvasElement;
  /** Drawn before the scene, around the camera, without depth (the backdrop). */
  backdrop: THREE.Scene | null = null;
  private backdropCamera = new THREE.PerspectiveCamera(FOV_Y, 4 / 3, 1, 1e7);
  /** Drawn first over the cleared frame (Traxx 1.8.0, the game's sky), told whether a backdrop follows; null for none. */
  sky: ((renderer: THREE.WebGLRenderer, backdrop: boolean) => void) | null = null;
  private pending = false;
  /** Traxx's field of view across the longer side, in degrees; 0 is Legacy. */
  private fovDeg = 70;
  private beforeRender: (() => void)[] = [];
  private afterRender: (() => void)[] = [];
  private captures: { layers: HTMLCanvasElement[]; done: (c: HTMLCanvasElement) => void }[] = [];

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // The world-wrap border's object copies are trimmed by material clipping planes (BeginWrapBorderPass).
    this.renderer.localClippingEnabled = true;
    this.canvas = this.renderer.domElement;
    this.canvas.className = "view-canvas";
    host.append(this.canvas);
    this.camera.up.set(0, 0, 1);
    this.camera.rotation.order = "ZXY";
    new ResizeObserver(() => this.resize(host)).observe(host);
    this.resize(host);
  }

  /**
    The far plane: Traxx's 40000 scene units, or more when the world is wider or taller than that
    reaches (track format version 6, spec section 10 item 8: a 512-cell world is 32768 units a
    side, and the ground can rise thousands of feet). Never below 40000, so a retail-sized track
    draws as before.
  */
  setFarFor(worldSide: number, zSpan: number): void {
    const far = Math.max(40000, Math.ceil(1.1 * Math.hypot(worldSide, worldSide, zSpan)));
    if (far === this.camera.far) return;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private size = { w: 1, h: 1 };
  private resize(host: HTMLElement): void {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = verticalFovFor(this.fovDeg, w, h);
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** SetFieldOfView: degrees across the longer side (clamped to 0..150), 0 for Legacy. */
  setFieldOfView(degrees: number): void {
    const deg = Math.max(0, Math.min(150, Math.round(degrees)));
    if (deg === this.fovDeg) return;
    this.fovDeg = deg;
    this.camera.fov = verticalFovFor(deg, this.size.w, this.size.h);
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
      const backdrop = Boolean(this.backdrop && this.backdrop.children.length);
      if (this.sky) {
        // Traxx 1.8.0 DrawSky: the sky first (over the cleared background), then the backdrop, then depth cleared.
        this.renderer.autoClear = false;
        this.renderer.setClearColor((this.scene.background as THREE.Color | null) ?? new THREE.Color(0));
        this.renderer.clear();
        this.sky(this.renderer, backdrop);
        if (backdrop) {
          const bc = this.backdropCamera;
          bc.aspect = this.camera.aspect;
          bc.fov = this.camera.fov;
          bc.updateProjectionMatrix();
          bc.position.set(0, 0, 0);
          bc.quaternion.copy(this.camera.quaternion);
          bc.updateMatrixWorld();
          this.renderer.render(this.backdrop!, bc);
        }
        this.renderer.clearDepth();
        const bg = this.scene.background;
        this.scene.background = null;
        this.renderer.render(this.scene, this.camera);
        this.scene.background = bg;
        this.renderer.autoClear = true;
      } else if (this.backdrop && this.backdrop.children.length) {
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
