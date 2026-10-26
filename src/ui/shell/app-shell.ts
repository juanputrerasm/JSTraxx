/*
  The editor window, laid out as Traxx's frame (CTraxxFrame::OnCreate):

    menu bar
    toolbar row: main toolbar | Edit Mode bar | Windows bar
    work area: the 3D view, with View Controls docked on the right and the mode's tool bar under it
    status bar: prompt | Sel | X | Y | Z

  Floating windows (Textures, Models, Patterns) float over the work area.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { EditMode } from "../../core/settings.ts";
import { CommandRegistry } from "./commands.ts";
import { MenuBar } from "./menu.ts";
import { Toolbar } from "./toolbar.ts";
import { StatusBar } from "./statusbar.ts";
import { FloatingPanel } from "./panel.ts";
import { ViewControlBar } from "../bars/view-control.ts";
import { courseToolsBar, groundBoxToolsBar, terrainToolsBar, textureToolsBar } from "../bars/tool-bars.ts";

export class AppShell {
  readonly element: HTMLElement;
  readonly viewport: HTMLElement;
  readonly workArea: HTMLElement;
  readonly menu: MenuBar;
  readonly viewControl: ViewControlBar;
  readonly panels: Record<"textures" | "models" | "patterns" | "transitions", FloatingPanel>;
  private toolbars: Toolbar[];
  private modeBars: (HTMLElement | null)[];
  private dock: HTMLElement;
  private app: AppState;

  constructor(app: AppState, registry: CommandRegistry, recent: () => { label: string; run: () => void }[]) {
    this.app = app;
    this.menu = new MenuBar(registry, app, { recent });
    // Button order from the TOOLBAR resources in Traxx/Traxx.rc.
    const main = new Toolbar(registry, app, "toolbar-main.png",
      ["ID_FILE_NEW", "ID_FILE_OPEN", "ID_VIEW_COMPONENTS", "ID_FILE_SAVE", "ID_FILE_WRITEPOD", "|", "ID_EDIT_COPY", "ID_EDIT_UNDO", "|", "ID_FILE_PRINT"], "Toolbar");
    const modes = new Toolbar(registry, app, "toolbar-editmode.png",
      ["ID_EDITMODE_TERRAIN", "ID_EDITMODE_TEXTURES", "ID_EDITMODE_COURSE", "ID_EDITMODE_OBJECTS", "ID_EDITMODE_BUILDINGS"], "Edit Mode");
    const windows = new Toolbar(registry, app, "toolbar-windows.png", ["ID_VIEW_TEXTURES", "ID_VIEW_OBJECTS"], "Windows");
    this.toolbars = [main, modes, windows];
    main.element.classList.add("tb-main");

    this.viewControl = new ViewControlBar(app);
    this.modeBars = [terrainToolsBar(app), textureToolsBar(app), courseToolsBar(app), null, groundBoxToolsBar(app)];
    this.dock = el("aside", { class: "dock-right" }, this.viewControl.element, ...this.modeBars.filter((b): b is HTMLElement => b !== null));

    this.viewport = el("div", { class: "viewport", tabindex: "0", "aria-label": "3D view" });
    this.workArea = el("main", { class: "work-area" }, this.viewport);
    const statusBar = new StatusBar(app);
    this.element = el("div", { class: "app" },
      this.menu.element,
      el("div", { class: "toolbar-row" }, main.element, modes.element, windows.element),
      el("div", { class: "work-row" }, this.workArea, this.dock),
      statusBar.element);

    const placeholder = (text: string) => el("p", { class: "panel-empty" }, text);
    const panel = (id: string, title: string, width: number, height: number, strip: string | null, layout: string[]) => {
      const tb = strip ? new Toolbar(registry, app, strip, layout, `${title} toolbar`) : null;
      if (tb) this.toolbars.push(tb);
      const p = new FloatingPanel(app, this.workArea, { id, title, width, height, toolbar: tb?.element });
      p.body.append(placeholder(`Open a track to see its ${title.toLowerCase()}.`));
      return p;
    };
    this.panels = {
      textures: panel("textures", "Textures", 480, 360, "toolbar-textures.png",
        ["ID_TEXTURE_OPEN", "|", "ID_TEXTURE_CUT", "ID_TEXTURE_COPY", "ID_TEXTURE_PASTE", "ID_TEXTURE_PASTEX", "|", "ID_TEXTURE_ANIMATE", "|", "ID_TEXTURE_PURGE", "|", "ID_TEXTURE_ZOOMOUT", "ID_TEXTURE_ZOOMRESET", "ID_TEXTURE_ZOOMIN"]),
      models: panel("models", "Models", 330, 280, "toolbar-objects.png", ["ID_OBJECT_OPEN", "|", "ID_OBJECT_CUT", "ID_OBJECT_CUTEX", "|", "ID_OBJECT_PURGE"]),
      patterns: panel("patterns", "Patterns", 200, 240, "toolbar-patterns.png", ["ID_PATTERN_FILE", "|", "ID_PATTERN_CUT", "ID_PATTERN_COPY", "ID_PATTERN_PASTE"]),
      transitions: panel("transitions", "Auto Texture Transitions", 330, 290, null, []),
    };

    app.on("commands", () => this.refresh());
    app.on("settings", () => this.applyBars());
    app.on("mode", (m) => this.showModeBar(m));
    this.applyBars();
    this.showModeBar(app.mode);
  }

  refresh(): void {
    for (const tb of this.toolbars) tb.refresh();
    this.menu.refresh();
  }

  private applyBars(): void {
    const b = this.app.settings.bars;
    this.toolbars[0].element.hidden = !b.toolbar;
    this.element.querySelector<HTMLElement>(".statusbar")!.hidden = !b.statusbar;
    this.viewControl.element.hidden = !b.viewcontrol;
    this.showModeBar(this.app.mode);
    this.dock.hidden = !b.viewcontrol && (!b.editcontrol || this.modeBars[this.app.mode] === null);
  }

  /* One tool bar at a time, by mode; Objects has none (CTraxxFrame::OnEditmodeObjects). */
  private showModeBar(mode: EditMode): void {
    const on = this.app.settings.bars.editcontrol;
    this.modeBars.forEach((bar, i) => { if (bar) bar.hidden = !on || i !== mode; });
  }
}
