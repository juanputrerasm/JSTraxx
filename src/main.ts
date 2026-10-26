/*
  JSTraxx entry point: loads the settings, starts the asset worker, builds the editor window
  and binds the commands that work so far.
*/
import "./styles.css";
import { AppState } from "./app/state.ts";
import { Library } from "./app/library.ts";
import { assetWorker } from "./app/workers.ts";
import { loadSettings } from "./shared/settings-store.ts";
import { CommandRegistry, registerTraxxCommands, ACCELERATORS, keyName } from "./ui/shell/commands.ts";
import { AppShell } from "./ui/shell/app-shell.ts";
import { keepViewFocus } from "./ui/input/view-focus.ts";
import { showOptions } from "./ui/dialogs/options.ts";
import { showAbout } from "./ui/dialogs/about.ts";
import { alertDialog } from "./ui/shell/dialog.ts";
import { el } from "./shared/dom.ts";
import type { EditMode, TraxxSettings } from "./core/settings.ts";
import { OPENPHOTEX_VERSION } from "./app/version.ts";
import { JSTRAXX_VERSION } from "./core/version.ts";
import { DocumentService } from "./app/document-service.ts";
import { bindFileCommands } from "./app/file-commands.ts";
import { attachProgress } from "./ui/shell/progress.ts";
import { TrackView } from "./render/track-view.ts";
import { attachViewInput } from "./ui/input/view-input.ts";
import { terrainMap } from "./core/traxx/map.ts";
import type { AppShell as Shell } from "./ui/shell/app-shell.ts";
import type { DocumentService as Docs } from "./app/document-service.ts";
import { Editor } from "./app/editor.ts";
import { attachEditInput } from "./ui/input/edit-input.ts";
import { registerModes } from "./app/modes/index.ts";
import { texturesPanel } from "./ui/panels/textures-panel.ts";
import { transitionsPanel } from "./ui/panels/transitions-panel.ts";
import { patternsPanel } from "./ui/panels/patterns-panel.ts";
import { modelsPanel } from "./ui/panels/models-panel.ts";
import { bindComponents } from "./app/components-command.ts";
import { bindWritePod } from "./app/write-pod-command.ts";
import { startAutosave } from "./app/autosave.ts";
import { bindSpecial } from "./app/special-commands.ts";
import { keyboardSummary } from "./ui/dialogs/keyboard-summary.ts";


async function start(): Promise<void> {
  const app = new AppState(await loadSettings());
  const registry = new CommandRegistry(app);
  registerTraxxCommands(registry);
  const worker = assetWorker();
  const library = new Library(app, worker);

  const docs = new DocumentService(app, worker);
  let openRecent: (path: string) => Promise<void> = async () => {};
  const recent = () => app.settings.recent.map((path) => ({ label: path.split("/").pop() ?? path, run: () => { void openRecent(path); } }));
  const shell = new AppShell(app, registry, recent);
  document.body.append(shell.element);
  document.title = "JSTraxx";
  attachProgress(worker, shell.workArea);
  ({ openRecent } = bindFileCommands(registry, docs, app));

  const empty = el("div", { class: "viewport-empty" },
    el("img", { src: `${import.meta.env.BASE_URL}ui/traxxico.png`, alt: "", width: 32, height: 32 }),
    el("p", {}, "No track open."),
    el("p", {}, "Add your Monster Truck Madness 2 PODs in ", el("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); registry.exec("ID_VIEW_LIBRARY"); } }, "View > Game Library"), ", then use File > New, Open, View POD or Clone."));
  shell.viewport.append(empty);
  const editor = new Editor(app, docs);
  docs.on("saved", () => editor.saved());
  bindView(app, registry, shell, docs, empty, editor);
  bindEditCommands(app, registry, docs, editor);
  texturesPanel({ app, editor, docs, registry, panel: shell.panels.textures, worker });
  transitionsPanel({ app, editor, docs, registry, panel: shell.panels.transitions });
  patternsPanel({ app, editor, docs, registry, panel: shell.panels.patterns, worker });
  bindComponents(registry, app, editor, docs, worker);
  bindWritePod(registry, app, editor, docs, worker);
  startAutosave(app, docs);

  // Edit modes.
  const modes = ["ID_EDITMODE_TERRAIN", "ID_EDITMODE_TEXTURES", "ID_EDITMODE_COURSE", "ID_EDITMODE_OBJECTS", "ID_EDITMODE_BUILDINGS"];
  modes.forEach((id, i) => registry.bind(id, () => app.setMode(i as EditMode), { checked: () => app.mode === i }));

  // View menu bar toggles.
  const toggleBar = (id: string, key: keyof TraxxSettings["bars"]) =>
    registry.bind(id, () => app.updateSettings((s) => { s.bars[key] = !s.bars[key]; }), { checked: () => app.settings.bars[key] });
  toggleBar("ID_VIEW_TOOLBAR", "toolbar");
  toggleBar("ID_VIEW_STATUS_BAR", "statusbar");
  toggleBar("ID_VIEW_VIEWCONTROL", "viewcontrol");
  toggleBar("ID_VIEW_EDITCONTROL", "editcontrol");
  registry.bind("ID_VIEW_TEXTURES", () => shell.panels.textures.toggle(), { checked: () => shell.panels.textures.visible });
  registry.bind("ID_VIEW_PATTERNS", () => shell.panels.patterns.toggle(), { checked: () => shell.panels.patterns.visible });
  registry.bind("ID_VIEW_OBJECTS", () => shell.panels.models.toggle(), { checked: () => shell.panels.models.visible });
  // The right-click menus' "Display ... Box" items show the window (OnTextureDisplayBox and friends).
  registry.bind("ID_TEXTURE_DISPLAYBOX", () => shell.panels.textures.show());
  registry.bind("ID_PATTERN_DISPLAYBOX", () => shell.panels.patterns.show());
  registry.bind("ID_OBJECT_DISPLAYBOX", () => shell.panels.models.show());

  // F5..F9: the Always Show and Show options of Options > General.
  const toggleSetting = (id: string, key: "always_course" | "always_objects" | "always_buildings" | "show_water" | "show_backdrop") =>
    registry.bind(id, () => app.updateSettings((s) => { s[key] = !s[key]; }), { checked: () => app.settings[key] });
  toggleSetting("ID_FUNCTION_5", "always_course");
  toggleSetting("ID_FUNCTION_6", "always_objects");
  toggleSetting("ID_FUNCTION_7", "always_buildings");
  toggleSetting("ID_FUNCTION_8", "show_water");
  toggleSetting("ID_FUNCTION_9", "show_backdrop");

  registry.bind("ID_VIEW_OPTIONS", () => showOptions(app, library));
  registry.bind("ID_VIEW_LIBRARY", () => showOptions(app, library, "library"));
  registry.bind("ID_APP_ABOUT", () => showAbout(JSTRAXX_VERSION, OPENPHOTEX_VERSION));
  registry.bind("ID_HELP_KEYBOARD", () => keyboardSummary(registry));
  // Traxx's WinHelp, converted to pages by scripts/traxx-help.mjs.
  registry.bind("ID_HELP_CONTENTS", () => { window.open(`${import.meta.env.BASE_URL}help/index.html`, "_blank", "noopener"); });
  app.on("settings", () => app.emit("commands", undefined));

  // Accelerators, unless a field or a dialog has the keys.
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || shell.menu.isOpen) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, dialog, [contenteditable]")) return;
    const id = ACCELERATORS[keyName(e)];
    if (!id) return;
    e.preventDefault();
    registry.exec(id);
  });

  try {
    await worker.whenReady();
    await library.refresh();
  } catch (err) {
    await alertDialog("JSTraxx", err instanceof Error ? err.message : String(err));
  }
}

/*
  The 3D view and what drives it. Without WebGL 2 the editor still opens and saves tracks, and
  the view says why it is blank.
*/
/*
  Edit menu: Undo and Redo over the whole history; Copy and Paste go to the mode
  (CTraxxView::OnEditCopy, OnEditPaste). Cut does nothing in Traxx, and stays greyed.
*/
function bindEditCommands(app: AppState, registry: CommandRegistry, docs: Docs, editor: Editor): void {
  registry.bind("ID_EDIT_UNDO", () => editor.undo(), { enabled: () => editor.canEdit && editor.history.canUndo });
  registry.bind("ID_EDIT_REDO", () => editor.redo(), { enabled: () => editor.canEdit && editor.history.canRedo });
  registry.bind("ID_EDIT_COPY", () => editor.handler?.copy?.(), { enabled: () => editor.canEdit && Boolean(editor.handler?.copy) && (editor.handler?.canCopy?.() ?? true) });
  registry.bind("ID_EDIT_PASTE", () => editor.handler?.paste?.(editor.lastPoint), { enabled: () => editor.canEdit && Boolean(editor.handler?.paste) && (editor.handler?.canPaste?.() ?? true) });
  // The Undo item names what it undoes.
  const label = () => {
    const u = registry.get("ID_EDIT_UNDO"), r = registry.get("ID_EDIT_REDO");
    if (u) u.label = editor.history.undoLabel ? `&Undo ${editor.history.undoLabel}` : "&Undo";
    if (r) r.label = editor.history.redoLabel ? `&Redo ${editor.history.redoLabel}` : "&Redo";
  };
  app.on("commands", label);
  void docs;
}

function bindView(app: AppState, registry: CommandRegistry, shell: Shell, docs: Docs, empty: HTMLElement, editor: Editor): void {
  let view: TrackView;
  try {
    view = new TrackView(shell.viewport, app);
  } catch (err) {
    console.error(err);
    empty.replaceChildren(el("p", {}, "The 3D view needs WebGL 2, which this browser could not start. Check that hardware acceleration is on."));
    docs.on("opened", (doc) => {
      if (doc) shell.viewControl.drawMap(terrainMap(doc.track.heights, doc.track.palette, doc.track.course.map((s) => [s.cstart[0], s.cstart[1]])));
      else shell.viewControl.drawEmpty();
    });
    return;
  }
  attachViewInput(shell.viewport, { camera: view.camera, groundAt: view.groundAt, changed: () => view.changed(), animate: () => view.animate(),
    pick: (x, y) => view.pick(x, y)?.point ?? null });
  attachEditInput(shell.viewport, editor, registry, app);
  registerModes({ app, editor, docs, registry, view });
  view.overlay.add((g, project) => editor.handler?.drawOverlay?.(g, project));
  editor.on("selection", () => view.requestRender());
  const redrawMap = () => {
    const doc = docs.doc;
    if (doc) shell.viewControl.drawMap(terrainMap(doc.track.heights, doc.track.palette, doc.track.course.map((s) => [s.cstart[0], s.cstart[1]])));
  };
  editor.on("changed", (touch) => {
    view.refresh(touch);
    if (touch.heights || touch.course || touch.palette) redrawMap();
  });
  view.onCameraChange(() => {
    app.setIndicators(view.camera.indicators());
    shell.viewControl.drawCamera(view.camera.gridx, view.camera.gridy, view.camera.dvector);
  });
  shell.viewControl.onMapClick((fx, fy) => { view.camera.mapClick(fx, fy); view.changed(); });
  docs.on("opened", (doc) => {
    empty.hidden = Boolean(doc);
    if (doc) shell.viewControl.drawMap(terrainMap(doc.track.heights, doc.track.palette, doc.track.course.map((s) => [s.cstart[0], s.cstart[1]])));
    else { shell.viewControl.drawEmpty(); app.setIndicators({ x: "", y: "", z: "" }); }
    void view.open(doc);
    if (doc) shell.viewport.focus();
  });
  keepViewFocus(shell.viewport, () => docs.doc !== null);

  // Navigation menu: F2 saves the location, F3 returns to it, F4 locks the height above ground.
  const hasDoc = () => docs.doc !== null;
  registry.bind("ID_FUNCTION_2", () => { view.camera.saveLocation(); app.status("Location saved"); }, { enabled: hasDoc });
  registry.bind("ID_FUNCTION_3", () => { if (view.camera.restoreLocation()) view.changed(); }, { enabled: hasDoc });
  registry.bind("ID_FUNCTION_4", () => { view.camera.lockZ = !view.camera.lockZ; }, { enabled: hasDoc, checked: () => view.camera.lockZ });

  // File > Print: the view saved as a PNG (a browser has no page to print a 3D view onto).
  registry.bind("ID_FILE_PRINT", async () => {
    const canvas = await view.snapshot();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return;
    const name = (docs.doc?.track.trackName || "track").replace(/[^A-Za-z0-9 _-]/g, "").trim() || "track";
    const a = el("a", { href: URL.createObjectURL(blob), download: `${name}.png` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, { enabled: hasDoc });

  // The Models window draws with the view's models, so it listens after the view does.
  modelsPanel({ app, editor, docs, registry, panel: shell.panels.models, worker: assetWorker(), view });
  bindSpecial(app, registry, editor, view);
}

start().catch((err) => {
  console.error(err);
  document.body.textContent = `JSTraxx could not start: ${err instanceof Error ? err.message : err}`;
});
