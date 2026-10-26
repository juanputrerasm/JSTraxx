/*
  The Textures window (IDD_TEXTURES, Traxx/TraxxTexturesDlg.cpp).

  Left: the track's textures in a grid, drawn through the track palette. A click selects; Shift
  adds or removes (the newest is the anchor); Ctrl adds the clicked texture as the next frame of
  the selected one's animation; a drag draws a box that selects every texture it touches (Shift
  adds). Under the grid: the anchor's name and size, its Type and Grip depth (a change goes to
  every selected texture), and Apply (TX_APPLYTEXTURE: the Textures and Ground Boxes modes).

  Right, behind "Load >>": the ART folder and the game library's art, a page at a time, as
  Traxx's folder pane lists them; a click adds one texture, Add Page all of the page, and the
  right-click menu deletes or renames a file in the ART folder.

  Toolbar: Load, Cut, Copy, Paste, Paste Composite, Animate, Purge and the three zoom buttons.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { Editor } from "../../app/editor.ts";
import type { DocumentService } from "../../app/document-service.ts";
import type { WorkerClient } from "../../shared/worker-client.ts";
import { CONTEXT_MENUS, type CommandRegistry } from "../shell/commands.ts";
import { showContextMenu } from "../shell/context-menu.ts";
import type { FloatingPanel } from "../shell/panel.ts";
import { alertDialog, confirmDialog } from "../shell/dialog.ts";
import { textureAnimateDialog, textureNameDialog } from "../dialogs/texture-dialogs.ts";
import { cutFormatIndex, textureCutDialog } from "../dialogs/texture-cut-dialog.ts";
import { compositeRefusal, cutRgb, encodeTga24, legacyTile, tileName, tileOrigin } from "../../core/image/composite.ts";
import { rgbaToRgb } from "../../core/image/image-format.ts";
import { decodeImage } from "../../shared/image-decode.ts";
import { AGRD_COL } from "../../core/settings.ts";
import { recordFields, recordGrid, type Recording } from "../../core/edit/record.ts";
import { TextureSelection } from "../../core/edit/texture-selection.ts";
import { TEXTURE_TYPE_NAMES, addAnimationFrame, addTexture, findAnimation, findTexture, frameLabels, setTypeDepth } from "../../core/edit/texture-list.ts";
import { deleteTexture } from "../../core/edit/textures.ts";
import { gammaMap, legacyTileRgba, sourceTileRgba, type RgbaImage } from "../../core/view/tiles.ts";
import { hdDimensions, indexImage } from "../../core/image/hd-texture.ts";
import { copyImage, pasteImage } from "../../shared/system-clipboard.ts";
import type { TextureAsset } from "../../core/doc/document.ts";
import type { ArtItem, ArtTile } from "../../worker/art-handlers.ts";

/** kTexZoom: the sizes both panes draw textures at; 64 is the default. */
const ZOOMS = [32, 48, 64, 96, 128];
const ZOOM_DEFAULT = 64;
const zoomLevel = (size: number) => ZOOMS.reduce((best, z, i) => (z <= size ? i : best), 0);

export interface TexturesPanelContext {
  app: AppState;
  editor: Editor;
  docs: DocumentService;
  registry: CommandRegistry;
  panel: FloatingPanel;
  worker: WorkerClient;
}

export function texturesPanel(ctx: TexturesPanelContext): void {
  const { app, editor, docs, registry, panel, worker } = ctx;
  const sel = new TextureSelection();
  const doc = () => editor.doc;
  const count = () => doc()?.textures.length ?? 0;
  const zoom = () => ZOOMS[zoomLevel(app.settings.texture_zoom || ZOOM_DEFAULT)]!;
  const pitch = () => zoom() + 3;

  // ---- Tile images, through the track palette and gamma, cached per texture object.
  let images = new WeakMap<TextureAsset, CanvasImageSource | null>();
  const toCanvas = (img: RgbaImage | null): OffscreenCanvas | null => {
    if (!img) return null;
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
    return c;
  };
  const trackRgba = (tex: { indices: Uint8Array | null; act: Uint8Array | null; side: number; trackIndexed?: boolean }) => {
    const d = doc();
    if (!d) return null;
    return legacyTileRgba({ name: "", hd: null, bad: false, ...tex }, d.track.palette, gammaMap(app.settings.gamma));
  };
  const imageOf = (tex: TextureAsset): CanvasImageSource | null => {
    if (!images.has(tex)) images.set(tex, toCanvas(trackRgba(tex)));
    return images.get(tex) ?? null;
  };

  // ---- Layout.
  const gridCanvas = el("canvas", { class: "tex-grid", tabindex: "0", "aria-label": "Track textures" });
  const gridSpace = el("div", { class: "tex-grid-space" }, gridCanvas);
  const gridScroll = el("div", { class: "tex-grid-scroll" }, gridSpace);
  const nameBox = el("div", { class: "tex-sunken tex-name-box" });
  const sizeBox = el("div", { class: "tex-sunken tex-size-box" });
  const typeSelect = el("select", { "aria-label": "Type" }, ...TEXTURE_TYPE_NAMES.map((n, i) => el("option", { value: i }, n)));
  const depthInput = el("input", { type: "number", min: 0, max: 99, step: 1, value: 1, class: "spin", "aria-label": "Grip depth" });
  depthInput.addEventListener("keydown", (e) => e.stopPropagation());
  const applyButton = el("button", { type: "button", class: "primary", onclick: () => apply() }, "Apply");
  const loadToggle = el("button", { type: "button", class: "tex-load-toggle", "aria-pressed": "false", onclick: () => setLoadShown(!loadShown) }, "Load  >>");

  const filterInput = el("input", { type: "text", maxlength: 11, value: app.settings.texture_filter === "*" ? "" : app.settings.texture_filter, class: "tex-filter", "aria-label": "Filter", title: "Filter: part of a name, or a pattern with *" });
  filterInput.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") void refreshFolder(); });
  filterInput.addEventListener("input", () => { filterInput.value = filterInput.value.toUpperCase(); });
  const folderCanvas = el("canvas", { class: "tex-folder", "aria-label": "Art folder" });
  const pageLabel = el("span", { class: "tex-page" });
  const pane = el("div", { class: "tex-load", hidden: true },
    el("div", { class: "tex-row" }, filterInput,
      el("button", { type: "button", onclick: () => void refreshFolder() }, "Refresh"),
      el("button", { type: "button", onclick: () => void addPage() }, "Add Page")),
    el("div", { class: "tex-folder-wrap" }, folderCanvas),
    el("div", { class: "tex-row tex-pager" },
      el("button", { type: "button", "aria-label": "Previous page", onclick: () => turnPage(-1) }, "◀"),
      pageLabel,
      el("button", { type: "button", "aria-label": "Next page", onclick: () => turnPage(1) }, "▶")));

  panel.body.replaceChildren(el("div", { class: "tex-window" },
    el("div", { class: "tex-left" },
      el("div", { class: "tex-row tex-top" }, loadToggle),
      gridScroll,
      el("div", { class: "tex-row" }, nameBox, sizeBox),
      el("div", { class: "tex-row" },
        el("label", { class: "tex-field" }, "Type", typeSelect),
        el("label", { class: "tex-field" }, "Grip depth", depthInput),
        applyButton)),
    pane));

  // ---- The grid.
  const cols = () => Math.max(1, Math.floor((gridScroll.clientWidth - 4) / pitch()));
  const cellAt = (x: number, y: number) => {
    const p = pitch(), c = Math.floor((x - 2) / p), r = Math.floor((y - 2) / p);
    if (c < 0 || c >= cols() || r < 0) return -1;
    const i = r * cols() + c;
    return i < count() ? i : -1;
  };

  let band: { x0: number; y0: number; x1: number; y1: number } | null = null;

  function drawGrid(): void {
    const d = doc();
    const w = gridScroll.clientWidth, h = gridScroll.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const p = pitch(), z = zoom(), n = count();
    gridSpace.style.height = `${Math.max(h, Math.ceil(n / cols()) * p + 4)}px`;
    gridCanvas.style.top = `${gridScroll.scrollTop}px`;
    gridCanvas.style.width = `${w}px`;
    gridCanvas.style.height = `${h}px`;
    gridCanvas.width = Math.max(1, Math.round(w * dpr));
    gridCanvas.height = Math.max(1, Math.round(h * dpr));
    const g = gridCanvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#c0c0c0";
    g.fillRect(0, 0, w, h);
    if (!d) return;
    g.imageSmoothingEnabled = false;
    const top = gridScroll.scrollTop;
    const animation = sel.anchor >= 0 ? findAnimation(d.track, sel.anchor) : -1;
    g.font = "bold 11px system-ui, sans-serif";
    g.textBaseline = "top";
    for (let i = 0; i < n; i++) {
      const x = 2 + (i % cols()) * p, y = 2 + Math.floor(i / cols()) * p - top;
      if (y > h) break;
      if (y < -p) continue;
      const tex = d.textures[i];
      const img = tex ? imageOf(tex) : null;
      if (img) g.drawImage(img, x, y, z, z);
      else { g.fillStyle = "#808080"; g.fillRect(x, y, z, z); }
      if (i === sel.anchor || sel.has(i)) {
        g.strokeStyle = i === sel.anchor ? "#ff0000" : "#ffb000";
        g.lineWidth = 1;
        g.strokeRect(x - 1.5, y - 1.5, z + 3, z + 3);
      } else if (animation >= 0) {
        const label = frameLabels(d.track, animation, i);
        if (label) {
          g.fillStyle = "#000";
          g.fillText(label, x + 3, y + 3);
          g.fillStyle = "#fff";
          g.fillText(label, x + 2, y + 2);
        }
      }
    }
    if (band) {
      g.setLineDash([2, 2]);
      g.strokeStyle = "#000";
      g.strokeRect(Math.min(band.x0, band.x1) + 0.5, Math.min(band.y0, band.y1) - top + 0.5, Math.abs(band.x1 - band.x0), Math.abs(band.y1 - band.y0));
      g.setLineDash([]);
    }
  }

  /* Display: the readouts for the anchor; type and depth shown are the anchor's. */
  let filling = false;
  function display(): void {
    sel.validate(count());
    drawGrid();
    const d = doc();
    const tex = d && sel.anchor >= 0 ? d.textures[sel.anchor] : null;
    const info = d && sel.anchor >= 0 ? d.track.textures[sel.anchor] : null;
    const name = tex?.name ?? info?.name ?? "";
    const title = name.replace(/^ART\\/i, "");
    nameBox.textContent = sel.size > 1 ? `${title} +${sel.size - 1}` : name;
    let size = tex ? String(tex.side || "") : "";
    if (tex?.hd) {
      const dim = hdDimensions(tex.hd.ext, tex.hd.data);
      if (dim) size = `${tex.side || "?"} / HD ${dim.width}`;
    }
    sizeBox.textContent = size;
    filling = true;
    typeSelect.value = String(info?.type ?? 0);
    depthInput.value = String(info?.depth ?? 1);
    filling = false;
    const editable = editor.canEdit;
    typeSelect.disabled = depthInput.disabled = !editable || sel.anchor < 0;
    applyButton.disabled = !editable || sel.anchor < 0;
  }

  /* SetSelection: the anchor, which the editor and the "Sel" indicator follow. */
  function setSelection(i: number): void {
    sel.select(i);
    syncEditor();
  }
  function syncEditor(): void {
    editor.selectTexture(sel.anchor);
    const name = sel.anchor >= 0 ? doc()?.textures[sel.anchor]?.name ?? "" : "";
    app.setIndicators({ sel: name.replace(/^ART\\/i, "") });
  }

  /* OnClickTextures. */
  async function click(i: number, shift: boolean, ctrl: boolean): Promise<void> {
    const d = doc();
    if (!d) return;
    if (ctrl && sel.anchor >= 0 && editor.canEdit) {
      if (i >= 0 && i !== sel.anchor) {
        const rec = recordFields(d.track, ["animations"], "Animate Texture", { textures: true });
        const out = addAnimationFrame(d, sel.anchor, i);
        editor.commit(rec);
        if (typeof out === "string") {
          await alertDialog("Textures", out);
          if (out.startsWith("Max. number")) setSelection(i);
        }
      }
      display();
      return;
    }
    if (shift) {
      if (i >= 0) { sel.toggle(i, count()); syncEditor(); }
      display();
      return;
    }
    sel.clearSet();
    setSelection(i);
    display();
  }

  // Grid pointer: a click, a box, or (with Ctrl) nothing when dragged.
  let press: { x: number; y: number; shift: boolean; ctrl: boolean; moved: boolean } | null = null;
  const local = (e: PointerEvent | MouseEvent) => {
    const r = gridCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top + gridScroll.scrollTop };
  };
  gridCanvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const p = local(e);
    press = { ...p, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, moved: false };
    gridCanvas.setPointerCapture(e.pointerId);
  });
  gridCanvas.addEventListener("pointermove", (e) => {
    if (!press) return;
    const p = local(e);
    if (!press.moved && Math.abs(p.x - press.x) < 4 && Math.abs(p.y - press.y) < 4) return;
    press.moved = true;
    if (press.ctrl) return;
    band = { x0: press.x, y0: press.y, x1: p.x, y1: p.y };
    drawGrid();
  });
  const endPress = (cancel: boolean) => {
    if (!press) return;
    const pr = press;
    press = null;
    if (cancel) { band = null; drawGrid(); return; }
    if (band) {
      const b = band;
      band = null;
      boxSelect(b, pr.shift);
      return;
    }
    if (!pr.moved) void click(cellAt(pr.x, pr.y), pr.shift, pr.ctrl);
  };
  gridCanvas.addEventListener("pointerup", () => endPress(false));
  gridCanvas.addEventListener("pointercancel", () => endPress(true));

  /* SelectGridBox. */
  function boxSelect(b: { x0: number; y0: number; x1: number; y1: number }, add: boolean): void {
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const p = pitch(), c = cols();
    const touched: number[] = [];
    let pressed = -1;
    for (let i = 0; i < count(); i++) {
      const cx = 2 + (i % c) * p, cy = 1 + Math.floor(i / c) * p;
      if (cx >= x1 || cx + p <= x0 || cy >= y1 || cy + p <= y0) continue;
      touched.push(i);
      if (b.x0 >= cx && b.x0 < cx + p && b.y0 >= cy && b.y0 < cy + p) pressed = i;
    }
    sel.box(touched, pressed, add, count());
    syncEditor();
    display();
  }

  gridCanvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!editor.canEdit) return;
    const p = local(e);
    const hit = cellAt(p.x, p.y);
    if (hit < 0 || !sel.has(hit)) { sel.clearSet(); setSelection(hit); display(); }
    const d = doc();
    const hasAnim = Boolean(d && sel.anchor >= 0 && findAnimation(d.track, sel.anchor) >= 0);
    showContextMenu(e.clientX, e.clientY, CONTEXT_MENUS.TextureEdit, registry, app, {
      enabled: { ID_TEXTURE_CUT: sel.anchor >= 0, ID_TEXTURE_COPY: sel.anchor >= 0, ID_TEXTURE_ANIMATE: hasAnim },
    });
  });
  gridScroll.addEventListener("scroll", () => drawGrid());
  new ResizeObserver(() => { drawGrid(); drawFolder(); }).observe(panel.body);

  // ---- Type and grip depth, for every selected texture.
  const changeInfo = (change: { type?: number; depth?: number }) => {
    const d = doc();
    if (filling || !d || !editor.canEdit || sel.anchor < 0) return;
    const rec = recordFields(d.track, ["textures"], change.type !== undefined ? "Texture Type" : "Grip Depth", {});
    setTypeDepth(d.track, sel.all(), change);
    editor.commit(rec);
  };
  typeSelect.addEventListener("change", () => changeInfo({ type: Number(typeSelect.value) }));
  depthInput.addEventListener("change", () => {
    const v = Math.max(0, Math.min(99, Math.trunc(Number(depthInput.value)) || 0));
    depthInput.value = String(v);
    changeInfo({ depth: v });
  });

  function apply(): void {
    if (!editor.canEdit || sel.anchor < 0) return;
    editor.handler?.applyTexture?.(sel.anchor);
  }

  // ---- Adding textures (LoadTextureFile), one undo step for a batch.
  function addAll(results: (TextureAsset | string)[], label: string): Promise<void> {
    return (async () => {
      const d = doc();
      if (!d) return;
      const recs: Recording[] = [recordFields(d, ["textures"], label, { textures: true }), recordFields(d.track, ["textures"], label, { textures: true })];
      let first = -1;
      let message: string | null = null;
      for (const r of results) {
        if (typeof r === "string") { message = r; break; }
        if (findTexture(d, r.name) >= 0) { message = `Texture "${r.name.replace(/^ART\\/i, "")}" already loaded.`; continue; }
        const at = addTexture(d, r);
        if (at < 0) { message = "The track holds 1024 textures, the most it can."; break; }
        if (first < 0) first = at;
        sel.clearSet();
        setSelection(at);
      }
      editor.commitAll(label, recs);
      if (first >= 0) gridScroll.scrollTop = gridScroll.scrollHeight;
      display();
      if (message) await alertDialog("Textures", message);
    })();
  }

  const fileInput = el("input", { type: "file", multiple: true, accept: ".raw,.act,.png,.tga", hidden: true });
  document.body.append(fileInput);
  fileInput.addEventListener("change", async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    if (!files.length || !editor.canEdit) return;
    const results = await worker.call<(TextureAsset | string)[]>("art.import", { files });
    await addAll(results, "Load Texture");
    void refreshFolder();
  });

  // ---- Cut, Copy, Paste.
  function cut(): void {
    const d = doc();
    if (!d || !editor.canEdit || sel.anchor < 0) return;
    void copy();
    const t = d.track, index = sel.anchor;
    const recs = [
      recordGrid(t.clr, { minX: 0, minY: 0, maxX: 255, maxY: 255 }, "Cut Texture", (r) => ({ clr: r })),
      recordFields(t, ["groundBoxes", "animations", "textures"], "Cut Texture", { groundBoxes: true, textures: true }),
      recordFields(d, ["textures"], "Cut Texture", { textures: true }),
    ];
    deleteTexture(d, index);
    sel.clearSet();
    setSelection(-1);
    editor.commitAll("Cut Texture", recs);
    display();
  }

  async function copy(): Promise<void> {
    const d = doc();
    const tex = d && sel.anchor >= 0 ? d.textures[sel.anchor] : null;
    if (!d || !tex) return;
    const img = sourceTileRgba(tex, d.track.palette);
    if (!img) { await alertDialog("Textures", "Bad Texture!"); return; }
    try { await copyImage(new Uint8ClampedArray(img.rgba), img.width, img.height); } catch (err) { await alertDialog("Copy", `The clipboard would not take the picture: ${err instanceof Error ? err.message : String(err)}`); }
  }

  /* OnEditPaste: a 64 or 256 square picture, named, written to the ART folder and loaded. */
  async function paste(): Promise<void> {
    if (!editor.canEdit) return;
    let img: Awaited<ReturnType<typeof pasteImage>>;
    try { img = await pasteImage(); } catch { img = null; }
    if (!img) { await alertDialog("Paste Texture", "Can't get bitmap from clipboard"); return; }
    if (img.width !== img.height || (img.width !== 64 && img.width !== 256)) { await alertDialog("Paste Texture", "Bitmap must be 64x64 or 256x256."); return; }
    const name = await textureNameDialog("", async (n) => ((await worker.call<boolean[]>("art.exists", { names: [`${n}.RAW`] }))[0] ? `"${n}" is not unique.\nPlease try a different name.` : null));
    if (!name) return;
    const rgb = new Uint8Array(img.width * img.height * 3);
    for (let i = 0; i < img.width * img.height; i++) rgb.set(img.rgba.subarray(i * 4, i * 4 + 3), i * 3);
    const { indices, act } = indexImage(rgb, img.width, img.height);
    const failed = await worker.call<string | null>("art.write", { files: [{ name: `${name}.ACT`, bytes: act }, { name: `${name}.RAW`, bytes: indices }] });
    if (failed) { await alertDialog("Paste Texture", failed); return; }
    const results = await worker.call<(TextureAsset | string)[]>("art.load", { items: [{ source: "art", file: `${name}.RAW`, ext: "RAW", stem: name }] });
    await addAll(results, "Paste Texture");
    void refreshFolder();
  }

  /* OnEditPasteX: the clipboard's picture, or a PNG or TGA picked, cut into a grid of textures. */
  const imageInput = el("input", { type: "file", accept: ".png,.tga", hidden: true });
  document.body.append(imageInput);
  const pickImage = () => new Promise<File | null>((resolve) => {
    imageInput.value = "";
    imageInput.onchange = () => resolve(imageInput.files?.[0] ?? null);
    imageInput.oncancel = () => resolve(null);
    imageInput.click();
  });

  async function pasteComposite(): Promise<void> {
    const d = doc();
    if (!d || !editor.canEdit) return;
    let img: RgbaImage | null = null;
    let imageName = "Clipboard";
    try { img = await pasteImage(); } catch { img = null; }
    if (!img) {
      const file = await pickImage();
      if (!file) return;
      imageName = file.name;
      try { img = await decodeImage(new Uint8Array(await file.arrayBuffer()), /\.tga$/i.test(file.name) ? "TGA" : "PNG", file.name); } catch (err) {
        await alertDialog("Paste Composite", err instanceof Error ? err.message : "That image could not be read.");
        return;
      }
    }
    const refusal = compositeRefusal(img.width, img.height);
    if (refusal) { await alertDialog("Paste Composite", refusal); return; }
    const exts = ["RAW", "ACT", "PNG", "TGA"];
    const choice = await textureCutDialog(img, imageName, app.settings.texcut_format, app.settings.colors[AGRD_COL] ?? "#ffff00", async ({ base, settings }) => {
      const names: string[] = [];
      for (let c = 0; c < settings.cols; c++) for (let r = 0; r < settings.rows; r++) names.push(tileName(base, c, r));
      for (const n of names) if (findTexture(d, `${n}.RAW`) >= 0) return `The track already has a texture called ${n}.`;
      const files = names.flatMap((n) => exts.map((e) => `${n}.${e}`));
      const there = await worker.call<boolean[]>("art.exists", { names: files });
      const hit = there.findIndex(Boolean);
      return hit >= 0 ? `${files[hit]} is already in the art folder.` : null;
    });
    if (!choice) return;
    const { base, settings: cs } = choice;
    app.updateSettings((st) => { st.texcut_format = cutFormatIndex(cs.format); });
    const rgb = rgbaToRgb(img);
    const writes: { name: string; bytes: Uint8Array }[] = [];
    const items: ArtItem[] = [];
    for (let r = 0; r < cs.rows; r++) {
      for (let c = 0; c < cs.cols; c++) {
        const at = tileOrigin(cs, c, r);
        const tile = cutRgb(rgb, img.width, at.x, at.y, cs.size);
        const stem = tileName(base, c, r);
        if (cs.format === "RAW") {
          const { raw, act } = legacyTile(tile, cs.size);
          writes.push({ name: `${stem}.RAW`, bytes: raw }, { name: `${stem}.ACT`, bytes: act });
        } else if (cs.format === "TGA") {
          writes.push({ name: `${stem}.TGA`, bytes: encodeTga24(tile, cs.size, cs.size) });
        } else {
          writes.push({ name: `${stem}.PNG`, bytes: await encodePng(tile, cs.size) });
        }
        items.push({ source: "art", file: `${stem}.${cs.format}`, ext: cs.format, stem });
      }
    }
    const failed = await worker.call<string | null>("art.write", { files: writes });
    if (failed) { await alertDialog("Paste Composite", failed); return; }
    const results = await worker.call<(TextureAsset | string)[]>("art.load", { items });
    await addAll(results, "Paste Composite");
    void refreshFolder();
  }

  /* OnTextureAnimate. */
  async function animate(): Promise<void> {
    const d = doc();
    if (!d || !editor.canEdit || sel.anchor < 0) return;
    const at = findAnimation(d.track, sel.anchor);
    if (at < 0) return;
    const ani = d.track.animations[at]!;
    const frames = ani.frames.slice(0, ani.nframes);
    const out = await textureAnimateDialog(frames.map((f) => { const t = d.textures[f]; return t ? trackRgba(t) : null; }), frames.map((f) => d.textures[f]?.name ?? ""), ani.period);
    if (out === null) return;
    const rec = recordFields(d.track, ["animations"], out === "remove" ? "Remove Animation" : "Animation Period", { textures: true });
    if (out === "remove") d.track.animations.splice(at, 1);
    else ani.period = out;
    editor.commit(rec);
    display();
  }

  function setZoom(level: number): void {
    const z = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, level))]!;
    if (z === zoom()) return;
    app.updateSettings((s) => { s.texture_zoom = z; });
    display();
    drawFolder();
  }

  const canEdit = () => editor.canEdit;
  const hasAnchor = () => editor.canEdit && sel.anchor >= 0 && sel.anchor < count();
  registry.bind("ID_TEXTURE_OPEN", () => fileInput.click(), { enabled: canEdit });
  registry.bind("ID_TEXTURE_CUT", () => cut(), { enabled: hasAnchor });
  registry.bind("ID_TEXTURE_COPY", () => copy(), { enabled: () => Boolean(doc()) && sel.anchor >= 0 });
  registry.bind("ID_TEXTURE_PASTE", () => paste(), { enabled: canEdit });
  registry.bind("ID_TEXTURE_PASTEX", () => pasteComposite(), { enabled: canEdit });
  registry.bind("ID_TEXTURE_ANIMATE", () => animate(), { enabled: () => hasAnchor() && findAnimation(doc()!.track, sel.anchor) >= 0 });
  registry.bind("ID_TEXTURE_ZOOMIN", () => setZoom(zoomLevel(zoom()) + 1));
  registry.bind("ID_TEXTURE_ZOOMOUT", () => setZoom(zoomLevel(zoom()) - 1));
  registry.bind("ID_TEXTURE_ZOOMRESET", () => setZoom(zoomLevel(ZOOM_DEFAULT)));

  // ---- The Load pane.
  let loadShown = false;
  let listing: ArtItem[] = [];
  let page = 0;
  let thumbs: (OffscreenCanvas | null)[] = [];
  let listed = false;
  const folderGeometry = () => {
    const z = zoom(), w = folderCanvas.parentElement!.clientWidth, h = folderCanvas.parentElement!.clientHeight;
    const cw = z + 2, ch = z + 10;
    const fcols = Math.max(1, Math.floor(w / cw)), frows = Math.max(1, Math.floor(h / ch));
    return { z, w, h, cw, ch, fcols, frows, per: fcols * frows };
  };
  const pageItems = () => {
    const { per } = folderGeometry();
    return listing.slice(page * per, page * per + per);
  };

  function setLoadShown(on: boolean): void {
    if (on === loadShown) return;
    loadShown = on;
    pane.hidden = !on;
    loadToggle.setAttribute("aria-pressed", String(on));
    // The pane is added to or taken off the window's width (OnShowLoad).
    const w = panel.element.offsetWidth;
    panel.element.style.width = `${Math.max(200, w + (on ? 240 : -240))}px`;
    if (on && !listed) void refreshFolder();
    else drawFolder();
  }

  async function refreshFolder(): Promise<void> {
    const filter = filterInput.value.trim();
    app.updateSettings((s) => { s.texture_filter = filter || "*"; });
    listed = true;
    listing = await worker.call<ArtItem[]>("art.list", { filter });
    page = 0;
    await loadThumbs();
  }

  let thumbJob = 0;
  async function loadThumbs(): Promise<void> {
    const job = ++thumbJob;
    const items = pageItems();
    thumbs = [];
    drawFolder();
    const tiles = await worker.call<(ArtTile | null)[]>("art.thumbs", { items });
    if (job !== thumbJob) return;
    const d = doc();
    // As Traxx does, remap the thumbnails through the track palette when a track is open.
    thumbs = tiles.map((t) => (t ? toCanvas(d ? trackRgba(t) : sourceTileRgba({ name: "", hd: null, bad: false, ...t }, new Uint8Array(768))) : null));
    drawFolder();
  }

  function turnPage(delta: number): void {
    const { per } = folderGeometry();
    const pages = Math.max(1, Math.ceil(listing.length / per));
    const next = Math.max(0, Math.min(pages - 1, page + delta));
    if (next === page) return;
    page = next;
    void loadThumbs();
  }

  function drawFolder(): void {
    if (!loadShown) return;
    const { z, w, h, cw, ch, frows, per } = folderGeometry();
    const dpr = window.devicePixelRatio || 1;
    folderCanvas.style.width = `${w}px`;
    folderCanvas.style.height = `${h}px`;
    folderCanvas.width = Math.max(1, Math.round(w * dpr));
    folderCanvas.height = Math.max(1, Math.round(h * dpr));
    const g = folderCanvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#c0c0c0";
    g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = false;
    g.font = "9px system-ui, sans-serif";
    g.textBaseline = "top";
    g.textAlign = "center";
    const items = pageItems();
    items.forEach((item, i) => {
      // Column by column (folderrows*col + row).
      const x = Math.floor(i / frows) * cw + 1, y = (i % frows) * ch + 1;
      const img = thumbs[i];
      if (img) g.drawImage(img, x, y, z, z);
      else { g.fillStyle = "#a0a0a0"; g.fillRect(x, y, z, z); }
      g.fillStyle = item.source === "library" ? "#303080" : "#000";
      g.fillText(item.stem.slice(0, Math.max(4, Math.floor(z / 5))), x + z / 2, y + z, z + 2);
    });
    const pages = Math.max(1, Math.ceil(listing.length / per));
    pageLabel.textContent = listed ? `${Math.min(page + 1, pages)} / ${pages} (${listing.length})` : "";
  }

  const folderHit = (e: MouseEvent) => {
    const r = folderCanvas.getBoundingClientRect();
    const { cw, ch, fcols, frows } = folderGeometry();
    const c = Math.floor((e.clientX - r.left) / cw), rr = Math.floor((e.clientY - r.top) / ch);
    if (c < 0 || rr < 0 || c >= fcols || rr >= frows) return -1;
    const i = frows * c + rr;
    return i < pageItems().length ? i : -1;
  };

  /* SelectPreview: one texture from the pane. */
  folderCanvas.addEventListener("click", async (e) => {
    const i = folderHit(e);
    const d = doc();
    if (i < 0 || !d || !editor.canEdit) return;
    const item = pageItems()[i]!;
    const raw = `${item.stem}.RAW`;
    if (findTexture(d, raw) >= 0) { await alertDialog("Textures", `Texture "${raw}" already loaded.`); return; }
    const results = await worker.call<(TextureAsset | string)[]>("art.load", { items: [item] });
    await addAll(results, "Load Texture");
  });

  /* OnLoadPage: every texture of the page not already loaded. */
  async function addPage(): Promise<void> {
    const d = doc();
    if (!d || !editor.canEdit) return;
    const items = pageItems();
    if (!items.length) { await alertDialog("Textures", "Empty Page!"); return; }
    const todo = items.filter((it) => findTexture(d, `${it.stem}.RAW`) < 0);
    if (!todo.length) return;
    const results = await worker.call<(TextureAsset | string)[]>("art.load", { items: todo });
    await addAll(results, "Load Textures");
  }

  let folderOp: ArtItem | null = null;
  folderCanvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const i = folderHit(e);
    if (i < 0 || !editor.canEdit) return;
    folderOp = pageItems()[i]!;
    const own = folderOp.source === "art";
    showContextMenu(e.clientX, e.clientY, CONTEXT_MENUS.TextureFolder, registry, app, { enabled: { ID_TFOLDER_DELETE: own, ID_TFOLDER_RENAME: own } });
  });

  /* OnTFolderDelete. */
  registry.bind("ID_TFOLDER_DELETE", async () => {
    const item = folderOp, d = doc();
    if (!item || !d) return;
    const raw = `${item.stem}.RAW`;
    if (/_N$/.test(item.stem) && findTexture(d, `${item.stem.slice(0, -2)}.RAW`) >= 0) {
      await alertDialog("Normal map", `"${raw}" is the NORMAL MAP for "${item.stem.slice(0, -2)}.RAW", which is in use.\n\nIt is not listed as a texture of its own and is carried into the pod automatically. Remove the base texture if you want the map gone too.`);
      return;
    }
    if (findTexture(d, raw) >= 0) { await alertDialog("Delete Texture", `Texture "${raw}" is being used!`); return; }
    if (!(await confirmDialog("Delete Texture", `Sure you want to permanently delete "${item.file}"?`, "Yes"))) return;
    await worker.call("art.delete", { file: item.file });
    await refreshFolder();
  });

  /* OnTFolderRename. */
  registry.bind("ID_TFOLDER_RENAME", async () => {
    const item = folderOp, d = doc();
    if (!item || !d) return;
    const raw = `${item.stem}.RAW`;
    if (findTexture(d, raw) >= 0) { await alertDialog("Rename", `Texture "${raw}" is being used!`); return; }
    // The rename is made when OK is pressed; a name already taken keeps the dialog open.
    const name = await textureNameDialog(item.stem, (n) => worker.call<string | null>("art.rename", { file: item.file, stem: n }));
    if (name) await refreshFolder();
  });

  // ---- Keeping up with the track.
  docs.on("opened", () => {
    images = new WeakMap();
    sel.clearSet();
    sel.select(-1);
    gridScroll.scrollTop = 0;
    display();
    if (loadShown) void loadThumbs();
  });
  editor.on("changed", (touch) => {
    if (touch.palette) { images = new WeakMap(); if (loadShown) void loadThumbs(); }
    if (touch.textures || touch.palette) display();
  });
  editor.on("texture", (i) => {
    // The eyedropper, or a mode, picked a texture: that ends a set it is not in.
    if (i !== sel.anchor) { sel.select(i); display(); }
  });
  let gamma = app.settings.gamma;
  app.on("settings", (s) => {
    if (s.gamma === gamma) return;
    gamma = s.gamma;
    images = new WeakMap();
    display();
    if (loadShown) void loadThumbs();
  });
  display();
}

/** A square tile of packed RGB as PNG bytes. */
async function encodePng(rgb: Uint8Array, size: number): Promise<Uint8Array> {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) { rgba[i * 4] = rgb[i * 3]!; rgba[i * 4 + 1] = rgb[i * 3 + 1]!; rgba[i * 4 + 2] = rgb[i * 3 + 2]!; rgba[i * 4 + 3] = 255; }
  const canvas = new OffscreenCanvas(size, size);
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, size, size), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}
