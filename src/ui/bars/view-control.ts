/*
  View Controls (IDD_VIEW_CONTROL): the terrain map, Gamma, Grid size, Whole Grid, Wire Frame
  and (Traxx 1.8.0) Detail Strength, Water Mask, Veg. Mask Wash and Veg. Aids. The map is drawn by the renderer (Phase 3); here it is a canvas that shows
  "No track" until then.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import { GRID_MAX, GRID_MIN, GRID_STEP } from "../../core/settings.ts";
import { bar, check, slider, triCheck } from "./controls.ts";

export class ViewControlBar {
  readonly element: HTMLElement;
  readonly map: HTMLCanvasElement;
  private rendererChecks: { enable(on: boolean): void }[] = [];

  constructor(app: AppState) {
    const s = app.settings;
    this.map = el("canvas", { class: "terrain-map", width: 256, height: 256, "aria-label": "Terrain map: click to move the view" });
    const gamma = slider((v) => `Gamma ${(v / 10).toFixed(1)}`, Math.round(s.gamma * 10), 5, 20, (v) => app.updateSettings((st) => { st.gamma = v / 10; }));
    const grid = slider((v) => `Grid size ${v * GRID_STEP}`, s.polysize / GRID_STEP, GRID_MIN / GRID_STEP, GRID_MAX / GRID_STEP, (v) => app.updateSettings((st) => { st.polysize = v * GRID_STEP; }));
    grid.enable(!s.show_whole_grid);
    const whole = check("Whole Grid", s.show_whole_grid, (v) => { grid.enable(!v); app.updateSettings((st) => { st.show_whole_grid = v; }); });
    const wire = triCheck("Wire Frame", s.edit.wireframe, (v) => app.updateSettings((st) => { st.edit.wireframe = v; }));
    // Traxx 1.8.0 (4ebf477, 2e8a268): Detail Strength, Water Mask, Veg. Mask Wash and Veg. Aids,
    // each in step with its View menu item both ways (the settings carry both).
    const mask = check("Detail Strength", s.show_mask_overlay, (v) => app.updateSettings((st) => { st.show_mask_overlay = v; }));
    const waterMask = check("Water Mask", s.show_water_mask, (v) => app.updateSettings((st) => { st.show_water_mask = v; }));
    const vegMask = check("Veg. Mask Wash", s.show_veg_mask, (v) => app.updateSettings((st) => { st.show_veg_mask = v; }));
    const vegAids = check("Veg. Aids", s.show_veg_aids, (v) => app.updateSettings((st) => { st.show_veg_aids = v; }));
    this.rendererChecks = [mask, waterMask, vegMask, vegAids];
    this.element = bar("View Controls", el("div", { class: "terrain-map-frame" }, this.map), gamma.element, grid.element, whole.element, wire.element,
      mask.element, waterMask.element, vegMask.element, vegAids.element);
    app.on("settings", (st) => {
      whole.set(st.show_whole_grid);
      grid.enable(!st.show_whole_grid);
      wire.set(st.edit.wireframe);
      mask.set(st.show_mask_overlay);
      waterMask.set(st.show_water_mask);
      vegMask.set(st.show_veg_mask);
      vegAids.set(st.show_veg_aids);
    });
    this.drawEmpty();
  }

  /** Traxx greys these out without its OpenGL renderer: JSTraxx without WebGL 2. */
  enableRendererChecks(on: boolean): void {
    for (const c of this.rendererChecks) c.enable(on);
  }

  private mapImage: OffscreenCanvas | null = null;
  /** `cells`: the world's N, 256 or a track format version 6 worldCells (spec section 8.1). */
  private marker: { gridx: number; gridy: number; dvector: [number, number]; cells: number } | null = null;

  /** The 64 x 64 terrain map (core/traxx/map.ts), scaled up without smoothing. */
  drawMap(image: { width: number; height: number; rgba: Uint8ClampedArray }): void {
    this.mapImage = new OffscreenCanvas(image.width, image.height);
    this.mapImage.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
    this.redraw();
  }

  /*
    The camera on the map (CTraxxView::DisplayMap): a green triangle with its tip at the grid
    position, pointing along the facing. Traxx's sizes are for its ~110 pixel map; they scale
    with this one.
  */
  drawCamera(gridx: number, gridy: number, dvector: [number, number], cells = 256): void {
    this.marker = { gridx, gridy, dvector, cells };
    this.redraw();
  }

  /** Map clicks, as fractions across and down (CTraxxView::OnMapClick). */
  onMapClick(fn: (fx: number, fy: number) => void): void {
    const pick = (e: PointerEvent) => {
      const r = this.map.getBoundingClientRect();
      fn((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    this.map.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.mapImage) return;
      this.map.setPointerCapture(e.pointerId);
      pick(e);
      const move = (m: PointerEvent) => pick(m);
      const up = () => { this.map.removeEventListener("pointermove", move); this.map.removeEventListener("pointerup", up); };
      this.map.addEventListener("pointermove", move);
      this.map.addEventListener("pointerup", up);
    });
  }

  private redraw(): void {
    const g = this.map.getContext("2d");
    if (!g || !this.mapImage) return;
    const w = this.map.width, h = this.map.height;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.mapImage, 0, 0, w, h);
    if (!this.marker) return;
    const k = w / 110;
    const { gridx, gridy, dvector: [d0, d1], cells } = this.marker;
    const mx = (w * (gridx + 1)) / cells, my = h - (h * (gridy + 1)) / cells;
    g.strokeStyle = "#00ff00";
    g.lineWidth = Math.max(1, k);
    g.beginPath();
    g.moveTo(mx, my);
    g.lineTo(mx + k * (-(d1 >> 6) - (d0 >> 4)), my + k * (-(d0 >> 6) + (d1 >> 4)));
    g.lineTo(mx + k * ((d1 >> 6) - (d0 >> 4)), my + k * ((d0 >> 6) + (d1 >> 4)));
    g.closePath();
    g.stroke();
  }

  drawEmpty(): void {
    this.mapImage = null;
    this.marker = null;
    const g = this.map.getContext("2d");
    if (!g) return;
    g.fillStyle = "#000";
    g.fillRect(0, 0, this.map.width, this.map.height);
    g.fillStyle = "#666";
    g.font = "24px sans-serif";
    g.textAlign = "center";
    g.fillText("No track", this.map.width / 2, this.map.height / 2 + 8);
  }
}
