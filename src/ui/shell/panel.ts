/*
  Floating tool windows, as Traxx's Textures, Models, Patterns and Transitions boxes: a title
  bar to drag, a close button, a resize grip, and the last position and size remembered in
  settings.panels. They float over the work area and are kept inside it.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";

export interface PanelOptions {
  id: string;
  title: string;
  /** Default size and position (from the top right of the work area) when none is stored. */
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  /** Optional toolbar row under the title. */
  toolbar?: HTMLElement;
  onShow?: () => void;
  onHide?: () => void;
}

let topZ = 10;

export class FloatingPanel {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  private app: AppState;
  private options: PanelOptions;
  private area: HTMLElement;

  constructor(app: AppState, area: HTMLElement, options: PanelOptions) {
    this.app = app;
    this.area = area;
    this.options = options;
    const titleBar = el("div", { class: "panel-title" },
      el("span", {}, options.title),
      el("button", { class: "panel-close", title: "Close", "aria-label": `Close ${options.title}`, onclick: () => this.hide() }, "×"));
    this.body = el("div", { class: "panel-body" });
    const grip = el("div", { class: "panel-grip", "aria-hidden": "true" });
    this.element = el("section", { class: "floating-panel", role: "dialog", "aria-label": options.title, hidden: true },
      titleBar, options.toolbar ?? null, this.body, grip);
    this.element.addEventListener("pointerdown", () => this.raise());
    this.drag(titleBar, (dx, dy, start) => this.place(start.x + dx, start.y + dy, start.w, start.h));
    this.drag(grip, (dx, dy, start) => this.place(start.x, start.y, start.w + dx, start.h + dy));
    area.append(this.element);
    const stored = app.settings.panels[options.id];
    if (stored?.open) queueMicrotask(() => this.show());
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    const stored = this.app.settings.panels[this.options.id];
    const a = this.area.getBoundingClientRect();
    const r = stored ?? { x: Math.max(0, a.width - this.options.width - 12), y: 12, w: this.options.width, h: this.options.height };
    this.element.hidden = false;
    this.place(r.x, r.y, r.w, r.h);
    this.raise();
    this.remember();
    this.options.onShow?.();
    this.app.emit("commands", undefined);
  }

  hide(): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    this.remember();
    this.options.onHide?.();
    this.app.emit("commands", undefined);
  }

  private raise(): void {
    this.element.style.zIndex = String(++topZ);
  }

  private place(x: number, y: number, w: number, h: number): void {
    const a = this.area.getBoundingClientRect();
    w = Math.max(this.options.minWidth ?? 160, Math.min(w, a.width));
    h = Math.max(this.options.minHeight ?? 100, Math.min(h, a.height));
    x = Math.max(0, Math.min(x, a.width - Math.min(w, 80)));
    y = Math.max(0, Math.min(y, a.height - 24));
    Object.assign(this.element.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }

  private remember(): void {
    const s = this.element.style;
    const rect = { x: parseFloat(s.left) || 0, y: parseFloat(s.top) || 0, w: parseFloat(s.width) || this.options.width, h: parseFloat(s.height) || this.options.height, open: this.visible };
    this.app.updateSettings((st) => { st.panels[this.options.id] = rect; });
  }

  private drag(handle: HTMLElement, move: (dx: number, dy: number, start: { x: number; y: number; w: number; h: number }) => void): void {
    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button") || e.button !== 0) return;
      e.preventDefault();
      const s = this.element.style;
      const start = { x: parseFloat(s.left), y: parseFloat(s.top), w: this.element.offsetWidth, h: this.element.offsetHeight };
      const ox = e.clientX, oy = e.clientY;
      handle.setPointerCapture(e.pointerId);
      const onMove = (m: PointerEvent) => move(m.clientX - ox, m.clientY - oy, start);
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        this.remember();
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }
}
