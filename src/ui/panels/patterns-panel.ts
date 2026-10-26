/*
  The Patterns window (IDD_PATTERNS, Traxx/TraxxPatternsDlg.cpp): the patterns of one .TXP
  file, one at a time with its name, size and thumbnail; the arrows (or the wheel) step
  through them.

    Select TXP File  pick, create or import a pattern file (kept in jstraxx/patterns)
    Cut              delete the shown pattern
    Copy             make it what Paste Area pastes in Textures mode (TX_SELPATTERN)
    Paste            a new pattern from the area last taken with Copy Area (2 to 16 cells a side)

  Pasting a pattern whose textures the track lacks asks to load them from the ART folder and
  the library, or loads them at once with "Always load textures". The file is rewritten after
  every change, as Traxx does. The first time, the file is Traxx's own Patterns.txp.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { Editor } from "../../app/editor.ts";
import type { DocumentService } from "../../app/document-service.ts";
import type { WorkerClient } from "../../shared/worker-client.ts";
import { CONTEXT_MENUS, type CommandRegistry } from "../shell/commands.ts";
import { showContextMenu } from "../shell/context-menu.ts";
import type { FloatingPanel } from "../shell/panel.ts";
import { alertDialog, confirmDialog, openDialog } from "../shell/dialog.ts";
import { readTxp, writeTxp, type TxpPattern } from "../../core/traxx/txp.ts";
import { buildPattern, MAX_PATTERNS, missingTextures, pasteMapping, pastePattern, patternThumbnail } from "../../core/edit/patterns.ts";
import { addTexture } from "../../core/edit/texture-list.ts";
import { recordFields, recordGrid, type Recording } from "../../core/edit/record.ts";
import { gammaMap } from "../../core/view/tiles.ts";
import type { TextureClip } from "../../app/modes/textures-mode.ts";
import type { Area } from "../../core/edit/textures.ts";
import type { TextureAsset } from "../../core/doc/document.ts";

export interface PatternsPanelContext {
  app: AppState;
  editor: Editor;
  docs: DocumentService;
  registry: CommandRegistry;
  panel: FloatingPanel;
  worker: WorkerClient;
}

export function patternsPanel(ctx: PatternsPanelContext): void {
  const { app, editor, docs, registry, panel, worker } = ctx;
  let patterns: TxpPattern[] = [];
  let selected = -1;
  let loaded = false;

  const fileLabel = el("div", { class: "pat-file" });
  const label = el("input", { type: "text", readonly: true, class: "pat-label", "aria-label": "Pattern name" });
  const display = el("canvas", { class: "pat-display", width: 208, height: 184, "aria-label": "Pattern" });
  const sizeText = el("span", { class: "pat-size" });
  const autoload = el("input", { type: "checkbox", checked: app.settings.txp_autoload });
  autoload.addEventListener("change", () => app.updateSettings((s) => { s.txp_autoload = autoload.checked; }));
  const counter = el("span", { class: "pat-count" });
  panel.body.replaceChildren(el("div", { class: "pat-window" },
    fileLabel,
    el("div", { class: "tex-row" }, label,
      el("button", { type: "button", "aria-label": "Previous pattern", onclick: () => step(-1) }, "▲"),
      el("button", { type: "button", "aria-label": "Next pattern", onclick: () => step(1) }, "▼"),
      counter),
    display,
    el("div", { class: "tex-row" }, sizeText, el("label", { class: "opt-check" }, autoload, "Always load textures"))));

  function select(i: number): void {
    selected = i >= 0 && i < patterns.length ? i : -1;
    const p = selected >= 0 ? patterns[selected]! : null;
    label.value = p ? p.name : "?";
    sizeText.textContent = p ? `${p.w}x${p.h}` : "";
    counter.textContent = patterns.length ? `${selected + 1} / ${patterns.length}` : "";
    draw();
    app.emit("commands", undefined);
  }

  function step(delta: number): void {
    if (!patterns.length) return;
    select(Math.max(0, Math.min(patterns.length - 1, selected + delta)));
  }
  display.addEventListener("wheel", (e) => { e.preventDefault(); step(e.deltaY > 0 ? 1 : -1); }, { passive: false });

  /* DisplayThumbnail: across the width for a wide one, down the height for a tall one. */
  function draw(): void {
    const g = display.getContext("2d")!;
    g.fillStyle = "#c0c0c0";
    g.fillRect(0, 0, display.width, display.height);
    const p = selected >= 0 ? patterns[selected] : null;
    const t = p ? patternThumbnail(p) : null;
    if (!t) return;
    const c = new OffscreenCanvas(t.width, t.height);
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.width, t.height), 0, 0);
    const wide = t.width >= t.height;
    const dw = wide ? display.width : Math.trunc((t.width * display.height) / t.height);
    const dh = wide ? Math.trunc((t.height * display.width) / t.width) : display.height;
    g.imageSmoothingEnabled = false;
    g.drawImage(c, 0, 0, dw, dh);
  }

  async function load(name: string): Promise<void> {
    let bytes = await worker.call<Uint8Array | null>("txp.read", { name });
    if (!bytes && name.toLowerCase() === "patterns.txp") {
      // Traxx's own file, the first time.
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}ui/Patterns.txp`);
        if (r.ok) { bytes = new Uint8Array(await r.arrayBuffer()); await worker.call("txp.write", { name, bytes }); }
      } catch { bytes = null; }
    }
    try { patterns = bytes ? readTxp(bytes) : []; } catch (err) {
      patterns = [];
      await alertDialog("Patterns", `"${name}" could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
    fileLabel.textContent = name;
    loaded = true;
    select(patterns.length ? 0 : -1);
  }

  const save = () => worker.call("txp.write", { name: app.settings.txp_file, bytes: writeTxp(patterns) });

  /* OnPatternFile: another file, a new one, or one from disk. */
  async function chooseFile(): Promise<void> {
    const names = await worker.call<string[]>("txp.list");
    const list = el("select", { size: 8, class: "pat-files" }, ...names.map((n) => el("option", { value: n, selected: n === app.settings.txp_file }, n)));
    const newName = el("input", { type: "text", placeholder: "New file name", class: "tex-name" });
    newName.addEventListener("keydown", (e) => e.stopPropagation());
    const picker = el("input", { type: "file", accept: ".txp", hidden: true });
    let imported: File | null = null;
    const importButton = el("button", { type: "button", onclick: () => picker.click() }, "Import from disk...");
    picker.addEventListener("change", () => { imported = picker.files?.[0] ?? null; if (imported) importButton.textContent = imported.name; });
    const download = el("button", { type: "button", onclick: () => {
      const a = el("a", { href: URL.createObjectURL(new Blob([writeTxp(patterns) as BlobPart])), download: app.settings.txp_file });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } }, "Download current");
    const r = await openDialog({
      title: "Select TXP File",
      body: [list, el("div", { class: "opt-row" }, newName), el("div", { class: "opt-row" }, importButton, picker, download)],
      buttons: [{ label: "Open", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    if (r !== "ok") return;
    let name = newName.value.trim() || list.value;
    if (imported) {
      const bytes = new Uint8Array(await (imported as File).arrayBuffer());
      try { readTxp(bytes); } catch (err) { await alertDialog("Patterns", `That is not a pattern file: ${err instanceof Error ? err.message : String(err)}`); return; }
      name = await worker.call<string>("txp.write", { name: (imported as File).name, bytes });
    }
    if (!name) return;
    if (!/\.txp$/i.test(name)) name += ".txp";
    app.updateSettings((s) => { s.txp_file = name; });
    await load(name);
  }

  /* OnPatternCut: delete the shown pattern. */
  async function cut(): Promise<void> {
    if (selected < 0) return;
    if (!(await confirmDialog("Delete Pattern", "Are you sure you want to delete this pattern?", "Yes"))) return;
    const gone = patterns.splice(selected, 1)[0];
    // TX_DELPATTERN: a pattern copied for pasting goes with it.
    const clip = editor.clipboard.texture as (TextureClip & { pattern?: TxpPattern }) | undefined;
    if (clip?.kind === "pattern" && clip.pattern === gone) delete editor.clipboard.texture;
    select(0);
    await save();
  }

  /* OnPatternCopy (TX_SELPATTERN). */
  function copy(): void {
    const p = selected >= 0 ? patterns[selected] : null;
    if (!p || !editor.canEdit) return;
    const clip = { kind: "pattern" as const, pattern: p, paste: (a: Area) => pasteInto(p, a) };
    editor.clipboard.texture = clip;
    app.emit("commands", undefined);
  }

  /* Extract: load what is missing (asking unless Always), then copy into the area. */
  async function pasteInto(p: TxpPattern, a: Area): Promise<void> {
    const d = editor.doc;
    if (!d || !editor.canEdit) return;
    const missing = missingTextures(d, p);
    const recs: Recording[] = [];
    if (missing.length) {
      if (!autoload.checked && !(await confirmDialog("Textures not Loaded", "Some textures are not loaded into you track.\nLoad them automatically?", "Yes"))) return;
      const results = await worker.call<(TextureAsset | string)[]>("art.loadNamed", { names: missing });
      const failed = results.find((r): r is string => typeof r === "string");
      if (failed) { await alertDialog("Patterns", failed); return; }
      recs.push(recordFields(d, ["textures"], "Paste Pattern", { textures: true }), recordFields(d.track, ["textures"], "Paste Pattern", { textures: true }));
      for (const tex of results as TextureAsset[]) addTexture(d, tex);
    }
    const rect = { minX: a.x0, minY: a.y0, maxX: Math.min(255, a.x0 + p.w - 1), maxY: Math.min(255, a.y0 + p.h - 1) };
    const grid = recordGrid(d.track.clr, rect, "Paste Pattern", (r) => ({ clr: r }));
    pastePattern(d.track.clr, p, pasteMapping(d, p), a);
    editor.commitAll("Paste Pattern", [...recs, grid]);
  }

  /* OnPatternPaste: a new pattern from the area Copy Area took. */
  async function paste(): Promise<void> {
    const d = editor.doc;
    if (!d) return;
    let name: string | null = null;
    const input = el("input", { type: "text", value: "New pattern", maxlength: 39, autofocus: true });
    input.addEventListener("keydown", (e) => e.stopPropagation());
    const r = await openDialog({
      title: "Enter Pattern Name",
      body: input,
      buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
      beforeClose: async (v) => {
        if (v !== "ok") return true;
        const n = input.value.slice(0, 39);
        if (!n) return confirmDialog("Add Pattern", "You must provide a name!\nTry again?", "Yes").then((again) => !again);
        if (patterns.some((p) => p.name === n)) return confirmDialog("Duplicate Name", "A pattern of that name already exists!\nTry again?", "Yes").then((again) => !again);
        name = n;
        return true;
      },
    });
    if (r !== "ok" || !name) return;
    if (patterns.length >= MAX_PATTERNS) { await alertDialog("Patterns", "Limit of 256 patterns per file."); return; }
    const clip = editor.clipboard.texture as TextureClip | undefined;
    const rect = clip?.kind === "area" ? clip.rect : null;
    const gamma = gammaMap(app.settings.gamma);
    const shown = d.track.palette.map((v) => gamma[v]!);
    const p = rect ? buildPattern(d, name, rect, shown) : null;
    if (!p) { await alertDialog("Patterns", "Error creating pattern!"); return; }
    patterns.push(p);
    select(patterns.length - 1);
    await save();
  }

  display.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, CONTEXT_MENUS.PatternEdit, registry, app);
  });

  const hasPattern = () => selected >= 0;
  registry.bind("ID_PATTERN_FILE", () => chooseFile());
  registry.bind("ID_PATTERN_CUT", () => cut(), { enabled: hasPattern });
  registry.bind("ID_PATTERN_COPY", () => copy(), { enabled: () => hasPattern() && editor.canEdit });
  registry.bind("ID_PATTERN_PASTE", () => paste(), { enabled: () => Boolean(editor.doc) });

  // The file is read when the window is first shown.
  const ensure = () => { if (!loaded) void load(app.settings.txp_file); };
  if (panel.visible) ensure();
  new MutationObserver(() => { if (panel.visible) ensure(); }).observe(panel.element, { attributes: true, attributeFilter: ["hidden"] });
  docs.on("opened", () => draw());
  select(-1);
}
