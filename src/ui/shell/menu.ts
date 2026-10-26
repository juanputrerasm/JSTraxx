/*
  The menu bar. Behaves like a Windows menu: click a title to open it, move across titles to
  switch while one is open, Escape or a click elsewhere closes it, Alt+letter opens the menu
  with that mnemonic, and the arrow keys walk the items.
*/
import { el, clear } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import { MAIN_MENU, type CommandRegistry, type MenuItem } from "./commands.ts";

/** "&File" -> label nodes with the mnemonic underlined, and the mnemonic letter. */
function mnemonic(label: string): { nodes: (string | HTMLElement)[]; key: string | null } {
  const i = label.indexOf("&");
  if (i < 0 || i === label.length - 1) return { nodes: [label], key: null };
  return {
    nodes: [label.slice(0, i), el("u", {}, label[i + 1]), label.slice(i + 2)],
    key: label[i + 1].toUpperCase(),
  };
}

export interface MenuBarOptions {
  /** Items for "@recent": label and action. */
  recent(): { label: string; run: () => void }[];
}

export class MenuBar {
  readonly element: HTMLElement;
  private open: number | null = null;
  private dropdown: HTMLElement | null = null;
  private titles: HTMLElement[] = [];
  private registry: CommandRegistry;
  private app: AppState;
  private options: MenuBarOptions;

  constructor(registry: CommandRegistry, app: AppState, options: MenuBarOptions) {
    this.registry = registry;
    this.app = app;
    this.options = options;
    this.element = el("nav", { class: "menubar", role: "menubar" });
    MAIN_MENU.forEach((menu, i) => {
      const title = el("button", {
        class: "menu-title", role: "menuitem", "aria-haspopup": "true",
        onmousedown: (e: MouseEvent) => { e.preventDefault(); this.open === i ? this.close() : this.show(i); },
        onmouseenter: () => { if (this.open !== null && this.open !== i) this.show(i); },
      }, ...mnemonic(menu.label).nodes);
      this.titles.push(title);
      this.element.append(title);
    });
    document.addEventListener("mousedown", (e) => {
      if (this.open !== null && !this.element.contains(e.target as Node) && !this.dropdown?.contains(e.target as Node)) this.close();
    });
    window.addEventListener("blur", () => this.close());
    document.addEventListener("keydown", (e) => this.onKey(e), true);
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  close(): void {
    this.dropdown?.remove();
    this.dropdown = null;
    if (this.open !== null) this.titles[this.open].classList.remove("open");
    this.open = null;
    this.app.status("");
  }

  private show(index: number): void {
    this.close();
    this.open = index;
    const title = this.titles[index];
    title.classList.add("open");
    this.dropdown = this.build(MAIN_MENU[index].items);
    document.body.append(this.dropdown);
    const r = title.getBoundingClientRect();
    this.dropdown.style.left = `${r.left}px`;
    this.dropdown.style.top = `${r.bottom}px`;
  }

  private build(items: MenuItem[]): HTMLElement {
    const list = el("div", { class: "menu-dropdown", role: "menu" });
    for (const item of items) {
      if (item === "-") { list.append(el("div", { class: "menu-sep", role: "separator" })); continue; }
      if (item === "@recent") {
        const recent = this.options.recent();
        if (recent.length === 0) list.append(el("div", { class: "menu-item disabled" }, el("span", { class: "check" }), el("span", { class: "label" }, "Recent Track"), el("span", { class: "key" })));
        recent.forEach((r, i) => list.append(this.row(`&${i + 1} ${r.label}`, "", true, false, () => r.run())));
        continue;
      }
      if (typeof item !== "string" && !("id" in item)) continue;
      const id = typeof item === "string" ? item : item.id;
      const c = this.registry.get(id);
      if (!c) continue;
      const row = this.row(typeof item === "string" ? c.label : item.label, c.shortcut ?? "", this.registry.isEnabled(id), this.registry.isChecked(id), () => this.registry.exec(id));
      row.addEventListener("mouseenter", () => this.app.status(c.prompt ?? ""));
      list.append(row);
    }
    return list;
  }

  private row(label: string, key: string, enabled: boolean, checked: boolean, run: () => void): HTMLElement {
    return el("div", {
      class: `menu-item${enabled ? "" : " disabled"}`, role: "menuitem", tabindex: "-1",
      "aria-disabled": enabled ? null : "true",
      onmouseup: () => { if (!enabled) return; this.close(); run(); },
      onmouseenter: (e: MouseEvent) => (e.currentTarget as HTMLElement).focus(),
    },
    el("span", { class: "check" }, checked ? "✓" : ""),
    el("span", { class: "label" }, ...mnemonic(label).nodes),
    el("span", { class: "key" }, key));
  }

  private onKey(e: KeyboardEvent): void {
    // Alt+letter opens a menu, as Windows does.
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code.startsWith("Key")) {
      const letter = e.code.slice(3);
      const index = MAIN_MENU.findIndex((m) => mnemonic(m.label).key === letter);
      if (index >= 0) { e.preventDefault(); e.stopPropagation(); this.show(index); this.focusItem(0); }
      return;
    }
    if (this.open === null || !this.dropdown) return;
    const items = [...this.dropdown.querySelectorAll<HTMLElement>(".menu-item:not(.disabled)")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "Escape": this.close(); break;
      case "ArrowDown": this.focusItem(at + 1); break;
      case "ArrowUp": this.focusItem(at <= 0 ? items.length - 1 : at - 1); break;
      case "ArrowRight": this.show((this.open + 1) % MAIN_MENU.length); this.focusItem(0); break;
      case "ArrowLeft": this.show((this.open + MAIN_MENU.length - 1) % MAIN_MENU.length); this.focusItem(0); break;
      case "Enter": if (at >= 0) items[at].dispatchEvent(new MouseEvent("mouseup")); break;
      default: {
        // A letter picks the item with that mnemonic.
        if (e.key.length !== 1) return;
        const hit = items.find((it) => it.querySelector(".label u")?.textContent?.toUpperCase() === e.key.toUpperCase());
        if (!hit) return;
        hit.dispatchEvent(new MouseEvent("mouseup"));
      }
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private focusItem(index: number): void {
    const items = [...(this.dropdown?.querySelectorAll<HTMLElement>(".menu-item:not(.disabled)") ?? [])];
    if (items.length) items[((index % items.length) + items.length) % items.length].focus();
  }

  /** Rebuild the open dropdown, so enabled and checked states follow the app. */
  refresh(): void {
    if (this.open === null || !this.dropdown) return;
    const fresh = this.build(MAIN_MENU[this.open].items);
    clear(this.dropdown);
    this.dropdown.append(...fresh.childNodes);
  }
}
