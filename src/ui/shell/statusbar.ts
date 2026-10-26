/* The status bar: the prompt line, then the Sel, X, Y and Z panes (CTraxxFrame's indicators). */
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";

export class StatusBar {
  readonly element: HTMLElement;

  constructor(app: AppState) {
    const message = el("span", { class: "sb-message", "aria-live": "polite" }, "Ready");
    const panes = {
      sel: el("span", { class: "sb-pane sb-sel", title: "Selection" }),
      x: el("span", { class: "sb-pane", title: "X" }),
      y: el("span", { class: "sb-pane", title: "Y" }),
      z: el("span", { class: "sb-pane", title: "Z" }),
    };
    this.element = el("footer", { class: "statusbar" }, message, panes.sel, panes.x, panes.y, panes.z);
    app.on("status", (text) => { message.textContent = text || "Ready"; });
    app.on("indicators", (ind) => {
      panes.sel.textContent = ind.sel;
      panes.x.textContent = ind.x;
      panes.y.textContent = ind.y;
      panes.z.textContent = ind.z;
    });
  }
}
