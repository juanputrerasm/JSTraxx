/*
  Right-click menus: a popup at the pointer, built from CONTEXT_MENUS or any item list. Items
  are command ids (shown with the command's label, shortcut and state), { id, label } to give a
  command another label in this menu, submenus, and "@name" slots filled by the caller (Set
  Type's object types). Escape, a click elsewhere or a choice closes it.

  Each popup is a manual popover, so it is drawn in the top layer: over an open modal dialog
  too, which nothing else can cover (Track Components' picture and backdrop menus). While a
  modal dialog is open everything outside it is inert, so the popup is placed inside that
  dialog, where it can be clicked.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { CommandRegistry, MenuItem } from "./commands.ts";

export interface DynamicItem { label: string; enabled?: boolean; checked?: boolean; run: () => void }

export interface ContextMenuOptions {
  /** Items for "@name" slots. */
  slots?: Record<string, DynamicItem[]>;
  /** Overrides for this showing: enabled or label by command id (Traxx's EnableMenuItem and ModifyMenu). */
  enabled?: Record<string, boolean>;
  labels?: Record<string, string>;
}

let open: HTMLElement[] = [];

export function closeContextMenu(): void {
  for (const m of open) m.remove();
  open = [];
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("keydown", escape, true);
}

function outside(e: Event): void {
  if (!open.some((m) => m.contains(e.target as Node))) closeContextMenu();
}

function escape(e: KeyboardEvent): void {
  if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); closeContextMenu(); }
}

function plain(label: string): string {
  return label.replace(/&(.)/g, "$1");
}

export function showContextMenu(x: number, y: number, items: MenuItem[], registry: CommandRegistry, app: AppState, options: ContextMenuOptions = {}): void {
  closeContextMenu();
  const level = (list: MenuItem[], px: number, py: number, depth: number): HTMLElement => {
    const menu = el("div", { class: "menu-dropdown context-menu", role: "menu" });
    for (const item of list) {
      if (item === "-") { menu.append(el("div", { class: "menu-sep", role: "separator" })); continue; }
      if (typeof item === "string" && item.startsWith("@")) {
        const dyn = options.slots?.[item.slice(1)] ?? [];
        if (!dyn.length) menu.append(row("(none)", "", false, false, () => {}));
        for (const d of dyn) menu.append(row(d.label, "", d.enabled ?? true, d.checked ?? false, d.run));
        continue;
      }
      if (typeof item === "object" && "items" in item) {
        const sub = row(plain(item.label), "▸", true, false, () => {});
        sub.addEventListener("mouseenter", () => {
          // One submenu open per level.
          open.slice(depth + 1).forEach((m) => m.remove());
          open = open.slice(0, depth + 1);
          const r = sub.getBoundingClientRect();
          const child = level(item.items, r.right - 2, r.top - 4, depth + 1);
          open.push(child);
          host().append(child);
          raise(child);
          place(child, r.right - 2, r.top - 4);
        });
        menu.append(sub);
        continue;
      }
      const id = typeof item === "string" ? item : item.id;
      const c = registry.get(id);
      if (!c) continue;
      const label = options.labels?.[id] ?? (typeof item === "object" ? item.label : c.label);
      const enabled = options.enabled?.[id] ?? registry.isEnabled(id);
      const r = row(plain(label), c.shortcut ?? "", enabled, registry.isChecked(id), () => registry.exec(id));
      r.addEventListener("mouseenter", () => app.status(c.prompt ?? ""));
      menu.append(r);
    }
    void px; void py;
    return menu;
  };
  const row = (label: string, key: string, enabled: boolean, checked: boolean, run: () => void) => el("div", {
    class: `menu-item${enabled ? "" : " disabled"}`, role: "menuitem", tabindex: "-1", "aria-disabled": enabled ? null : "true",
    onmouseup: (e: MouseEvent) => { if (!enabled || key === "▸") return; e.stopPropagation(); closeContextMenu(); run(); },
  }, el("span", { class: "check" }, checked ? "✓" : ""), el("span", { class: "label" }, label), el("span", { class: "key" }, key));
  const root = level(items, x, y, 0);
  open = [root];
  host().append(root);
  raise(root);
  place(root, x, y);
  setTimeout(() => {
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
  });
}

/** The topmost open modal dialog, or the page. */
function host(): HTMLElement {
  const dialogs = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")];
  return dialogs[dialogs.length - 1] ?? document.body;
}

/** Into the top layer, above any modal dialog (where the browser has popovers). */
function raise(menu: HTMLElement): void {
  if (typeof menu.showPopover !== "function") return;
  menu.setAttribute("popover", "manual");
  menu.showPopover();
}

/** Keep a popup inside the window. */
function place(menu: HTMLElement, x: number, y: number): void {
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = `${Math.max(0, window.innerWidth - r.width - 4)}px`;
  if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(0, window.innerHeight - r.height - 4)}px`;
}
