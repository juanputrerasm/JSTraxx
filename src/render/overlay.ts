/*
  The 2D overlay over the 3D view: text and marks drawn in screen pixels, as Traxx draws its
  GDI overlay (segment numbers, checkpoint labels, and later the edit marks). Drawers are
  registered by whoever needs them and run after each frame.
*/
import * as THREE from "three";

/*
  Line widths are device pixels, as Traxx's GL overlay draws them (glLineWidth 1, smoothed):
  on a high-density screen a CSS pixel is two device pixels, and a one-pixel grid drawn at
  CSS size reads twice as heavy as Traxx's.
*/
export function devicePx(g: CanvasRenderingContext2D, n: number): number {
  return n / (g.getTransform().a || 1);
}

export type OverlayDrawer = (g: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => { x: number; y: number } | null) => void;

export class Overlay2D {
  readonly canvas: HTMLCanvasElement;
  private drawers = new Set<OverlayDrawer>();
  private camera: THREE.Camera;
  private v = new THREE.Vector3();

  constructor(host: HTMLElement, camera: THREE.Camera) {
    this.camera = camera;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "view-overlay";
    host.append(this.canvas);
  }

  add(drawer: OverlayDrawer): () => void {
    this.drawers.add(drawer);
    return () => this.drawers.delete(drawer);
  }

  draw(): void {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const project = (x: number, y: number, z: number) => {
      this.v.set(x, y, z).project(this.camera);
      // Behind the camera, or past the far plane.
      if (this.v.z > 1 || this.v.z < -1) return null;
      return { x: ((this.v.x + 1) / 2) * w, y: ((1 - this.v.y) / 2) * h };
    };
    for (const d of this.drawers) {
      g.lineWidth = devicePx(g, 1);
      d(g, project);
    }
  }
}
