/*
  A toolbar drawn from one of Traxx's button strips (public/ui/toolbar-*.png, made by
  scripts/traxx-ui-art.mjs): 16x15 images side by side, one per button, in the order of the
  TOOLBAR resource. "|" is a separator.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { CommandRegistry } from "./commands.ts";

export const BUTTON_W = 16;
export const BUTTON_H = 15;

export class Toolbar {
  readonly element: HTMLElement;
  private buttons: { id: string; node: HTMLButtonElement }[] = [];
  private registry: CommandRegistry;

  constructor(registry: CommandRegistry, app: AppState, strip: string, layout: string[], label: string) {
    this.registry = registry;
    this.element = el("div", { class: "toolbar", role: "toolbar", "aria-label": label });
    let image = 0;
    for (const id of layout) {
      if (id === "|") { this.element.append(el("span", { class: "tb-sep" })); continue; }
      const c = registry.get(id);
      const node = el("button", {
        class: "tb-button", title: c?.tip ?? c?.label ?? id, "aria-label": c?.tip ?? id,
        onclick: () => registry.exec(id),
        onmouseenter: () => app.status(c?.prompt ?? ""),
        onmouseleave: () => app.status(""),
      }, el("span", {
        class: "tb-icon",
        style: { backgroundImage: `url(${import.meta.env.BASE_URL}ui/${strip})`, backgroundPosition: `${-image * BUTTON_W}px 0` },
      }));
      image++;
      this.buttons.push({ id, node });
      this.element.append(node);
    }
    this.refresh();
  }

  refresh(): void {
    for (const { id, node } of this.buttons) {
      node.disabled = !this.registry.isEnabled(id);
      node.classList.toggle("checked", this.registry.isChecked(id));
      node.setAttribute("aria-pressed", String(this.registry.isChecked(id)));
    }
  }
}
