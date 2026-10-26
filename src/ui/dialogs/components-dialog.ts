/*
  Track Components (IDD_COMPONENTS, Traxx/TraxxComponentsDlg.cpp): the track's name and World
  Name, comment, icon and browse pictures, backdrop, sound theme, palette, water level, music,
  type, terrain detail normal and mask, info photo and description.

  The three pictures take a right-click menu (Copy, Paste, Load, Stock for the MTM2 icon, Save
  As, View): an 8-bit BMP is kept as it is; a PNG, a TGA or a true-colour picture is HD art,
  checked for the old shape, and an 8-bit copy is made from it ("Also write 8-bit BMP copies"
  decides on OK whether the copy is kept). Music and the backdrop have menus of their own.

  Additions: View shows a picture at its own size and Play plays a WAV (Traxx says "not yet
  implemented" for both). The backdrop list is the MODELS folder and the game library.
*/
import { el } from "../../shared/dom.ts";
import type { AppState } from "../../app/state.ts";
import type { CommandRegistry } from "../shell/commands.ts";
import { alertDialog, confirmDialog, openDialog } from "../shell/dialog.ts";
import { showContextMenu } from "../shell/context-menu.ts";
import { decodeImage, tryDecodeImage } from "../../shared/image-decode.ts";
import { copyImage, pasteImage } from "../../shared/system-clipboard.ts";
import { rgbaToRgb } from "../../core/image/image-format.ts";
import { bmpInfo, makeBmp8, stockIcon, stockIconCell } from "../../core/image/bmp.ts";
import { bitmapRefusal, clampArena, cleanStem, hdArtRefusal, INFO_TEXT_MAX, MAX_BACKDROPS, PALETTE_NAMES, slotSpec, slotWhat, SLOT_BROWSE, SLOT_ICON, SLOT_INFO, SOUND_THEMES, STOCK_MUSIC, type Components } from "../../core/doc/components.ts";
import type { RgbaImage } from "../../core/view/tiles.ts";
import type { TxxHdArt } from "../../core/traxx/txx.ts";
import type { TraxxArena } from "../../core/traxx/sit.ts";
import type { ModelLoad } from "../../worker/model-handlers.ts";

export interface ComponentsContext {
  app: AppState;
  registry: CommandRegistry;
  viewOnly: boolean;
  /** UIInfoName: the info photo's name; "" when the browse bitmap's name cannot make one. */
  infoName: string;
  /** The track stem, for the detail and mask readouts. */
  prefix: string;
  detailFromPod: boolean;
  maskFromPod: boolean;
  /** Load a backdrop: the MODELS folder and library list, or a file; resolves with the load. */
  chooseBackdrop: () => Promise<{ load: ModelLoad; isArena: boolean } | null>;
}

const stop = <T extends HTMLElement>(i: T) => { i.addEventListener("keydown", (e) => e.stopPropagation()); return i; };

/* InfoTextFit's panel (TraxxComponentsDlg.cpp, measured from the engine's own layout). */
const INFO_PANEL_W = 280, INFO_PANEL_TOP = 30, INFO_PANEL_BOTTOM = 481, INFO_LINE_H = 19, INFO_TITLE_H = 27, INFO_BLANK_H = 9.5;
const INFO_FONT_BODY = 15, INFO_FONT_TITLE = 21, INFO_MEASURE = 4;

/** InfoTextFit: the lines the description needs and how many fall outside the panel. */
export function infoTextFit(text: string, measure: (s: string, title: boolean) => number): { used: number; over: number; capacity: number } {
  const capacity = Math.trunc((INFO_PANEL_BOTTOM - INFO_PANEL_TOP) / INFO_LINE_H);
  let y = INFO_PANEL_TOP, used = 0, over = 0, first = true, start = 0;
  const len = text.length;
  while (start <= len) {
    let end = start;
    while (end < len && text[end] !== "\r" && text[end] !== "\n") end++;
    const line = text.slice(start, end);
    start = end < len && text[end] === "\r" && end + 1 < len && text[end + 1] === "\n" ? end + 2 : end + 1;
    if (!line) {
      y += INFO_BLANK_H;
      if (end >= len) break;
      continue;
    }
    const lineh = first ? INFO_TITLE_H : INFO_LINE_H;
    // InfoWrapLines: words onto a line until the next one would not fit.
    let n = 0, cur = "";
    for (const word of line.split(/[ \t]+/).filter(Boolean)) {
      const cand = cur ? `${cur} ${word}` : word;
      if (cur && measure(cand, first) > INFO_PANEL_W * INFO_MEASURE) { n++; cur = word; } else cur = cand;
    }
    if (cur) n++;
    for (let k = 0; k < n; k++) { used++; if (y >= INFO_PANEL_BOTTOM) over++; y += lineh; }
    first = false;
    if (end >= len) break;
  }
  return { used, over, capacity };
}

export async function componentsDialog(start: Components, ctx: ComponentsContext): Promise<Components | null> {
  const c: Components = { ...start, bitmaps: [...start.bitmaps], hd: [...start.hd], detail: { ...start.detail }, mask: { ...start.mask }, arena: start.arena ? { ...start.arena } : null };
  const ro = ctx.viewOnly;

  // ---- Name, World Name, comment.
  const name = stop(el("input", { type: "text", value: c.trackName, class: "cmp-wide" }));
  const stem = stop(el("input", { type: "text", value: c.stem, class: "cmp-stem", maxlength: 18 }));
  const stemAuto = el("input", { type: "checkbox", checked: c.stemAuto, disabled: ro });
  const comment = stop(el("textarea", { rows: 2, class: "cmp-wide" }, c.comment));
  const showDerived = () => { const s = cleanStem(name.value); if (s) stem.value = s; };
  name.addEventListener("input", () => { if (stemAuto.checked) showDerived(); });
  stemAuto.addEventListener("change", () => { stem.disabled = stemAuto.checked || ro; if (stemAuto.checked) showDerived(); else stem.focus(); });
  stem.addEventListener("input", () => { stem.value = stem.value.toUpperCase(); });
  stem.disabled = c.stemAuto || ro;
  if (c.stemAuto) showDerived();

  // ---- The three pictures.
  const sheet = new Image();
  sheet.src = `${import.meta.env.BASE_URL}ui/stock-icons.bmp`;
  const canvases = [0, 1, 2].map((slot) => el("canvas", { class: `cmp-pic cmp-pic-${slot}`, width: slot === SLOT_ICON ? 96 : 200, height: slot === SLOT_ICON ? 72 : 150, tabindex: "0", "aria-label": slotWhat(slot, c.mtm2Only) })) as HTMLCanvasElement[];
  const labels = [0, 1, 2].map(() => el("span", { class: "cmp-label" }));
  const hdDecoded: (RgbaImage | null)[] = [null, null, null];
  const bmpDecoded: (ImageBitmap | null)[] = [null, null, null];

  const caption = (slot: number) => {
    const base = slot === SLOT_ICON ? (c.mtm2Only ? "Icon Bitmap (32x24)" : "Zoom Bitmap (640x480)") : slot === SLOT_INFO ? "Info Photo (640x480)" : "Browse Bitmap";
    const hd = c.hd[slot];
    if (!hd) return base;
    const img = hdDecoded[slot];
    return `${base} - HD ${hd.ext.replace(/^\./, "")}${img ? ` ${img.width}x${img.height}` : ""}`;
  };

  async function decodeSlot(slot: number): Promise<void> {
    const hd = c.hd[slot];
    hdDecoded[slot] = hd ? await tryDecodeImage(hd.data, hd.ext.replace(/^\./, "").toUpperCase() === "TGA" ? "TGA" : "PNG") : null;
    bmpDecoded[slot]?.close();
    bmpDecoded[slot] = null;
    const b = c.bitmaps[slot];
    if (b && !stockIconCell(b) && !hdDecoded[slot]) {
      try { bmpDecoded[slot] = await createImageBitmap(new Blob([b as BlobPart], { type: "image/bmp" })); } catch { bmpDecoded[slot] = null; }
    }
    drawSlot(slot);
  }

  function drawSlot(slot: number): void {
    const cv = canvases[slot]!, g = cv.getContext("2d")!;
    g.fillStyle = "#808080";
    g.fillRect(0, 0, cv.width, cv.height);
    labels[slot]!.textContent = caption(slot);
    const fit = (w: number, h: number, draw: (x: number, y: number, dw: number, dh: number) => void) => {
      const k = Math.min(cv.width / w, cv.height / h);
      const dw = w * k, dh = h * k;
      draw((cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
    };
    const hd = hdDecoded[slot];
    if (hd) {
      const o = new OffscreenCanvas(hd.width, hd.height);
      o.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(hd.rgba), hd.width, hd.height), 0, 0);
      fit(hd.width, hd.height, (x, y, w, h) => g.drawImage(o, x, y, w, h));
      return;
    }
    const cell = stockIconCell(c.bitmaps[slot] ?? null);
    if (cell) {
      const paint = () => fit(32, 24, (x, y, w, h) => { g.imageSmoothingEnabled = false; g.drawImage(sheet, cell.col * 32, cell.row * 24, 32, 24, x, y, w, h); });
      if (sheet.complete) paint(); else sheet.onload = () => drawSlot(slot);
      return;
    }
    const b = bmpDecoded[slot];
    if (b) fit(b.width, b.height, (x, y, w, h) => { g.imageSmoothingEnabled = slot !== SLOT_ICON; g.drawImage(b, x, y, w, h); });
  }

  /* TakeHDArt: the shape rules, then the 8-bit copy made from it. */
  async function takeHd(slot: number, img: RgbaImage, art: TxxHdArt): Promise<boolean> {
    const refusal = hdArtRefusal(slot, c.mtm2Only, img.width, img.height);
    if (refusal) { await alertDialog("HD Track Art", refusal); return false; }
    const { lw, lh } = slotSpec(slot, c.mtm2Only);
    c.bitmaps[slot] = makeBmp8(rgbaToRgb(img), img.width, img.height, lw, lh);
    c.hd[slot] = art;
    await decodeSlot(slot);
    status();
    return true;
  }

  /* A whole 8-bit .BMP for a slot: the limits, and it replaces any HD art the slot had. */
  async function takeBmp(slot: number, bytes: Uint8Array): Promise<void> {
    const info = bmpInfo(bytes);
    if (!info || info.compression !== 0 || info.bits !== 8) { await alertDialog("Track Components", "Bitmap must be uncompressed 8-bit - or 24/32-bit, which becomes HD art."); return; }
    const refusal = bitmapRefusal(slot, c.mtm2Only, info.width, info.height);
    if (refusal) { await alertDialog("Track Components", refusal); return; }
    c.bitmaps[slot] = bytes;
    c.hd[slot] = null;
    await decodeSlot(slot);
    status();
  }

  async function encodePng(img: RgbaImage): Promise<Uint8Array> {
    const o = new OffscreenCanvas(img.width, img.height);
    o.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
    return new Uint8Array(await (await o.convertToBlob({ type: "image/png" })).arrayBuffer());
  }

  const picker = (accept: string) => new Promise<File | null>((resolve) => {
    const input = el("input", { type: "file", accept, hidden: true }) as HTMLInputElement;
    document.body.append(input);
    input.onchange = () => { resolve(input.files?.[0] ?? null); input.remove(); };
    input.oncancel = () => { resolve(null); input.remove(); };
    input.click();
  });

  const download = (bytes: Uint8Array, fileName: string) => {
    const a = el("a", { href: URL.createObjectURL(new Blob([bytes as BlobPart])), download: fileName });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  /* OnBitmapLoad: a PNG or TGA is HD art byte for byte; a BMP of 24 or 32 bits becomes a PNG. */
  async function loadPicture(slot: number): Promise<void> {
    const file = await picker(".bmp,.png,.tga");
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toUpperCase();
    if (ext === "PNG" || ext === "TGA") {
      let img: RgbaImage;
      try { img = await decodeImage(bytes, ext, file.name); } catch (err) { await alertDialog("HD Track Art", err instanceof Error ? err.message : "Cannot read that picture."); return; }
      await takeHd(slot, img, { ext: `.${ext}`, data: bytes });
      return;
    }
    const info = bmpInfo(bytes);
    if (info && (info.bits === 24 || info.bits === 32)) {
      const img = await tryDecodeBmp(bytes);
      if (!img) { await alertDialog("HD Track Art", "Cannot read that picture."); return; }
      await takeHd(slot, img, { ext: ".PNG", data: await encodePng(img) });
      return;
    }
    await takeBmp(slot, bytes);
  }

  async function tryDecodeBmp(bytes: Uint8Array): Promise<RgbaImage | null> {
    try {
      const b = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/bmp" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const o = new OffscreenCanvas(b.width, b.height);
      const g = o.getContext("2d")!;
      g.drawImage(b, 0, 0);
      b.close();
      return { width: o.width, height: o.height, rgba: g.getImageData(0, 0, o.width, o.height).data };
    } catch { return null; }
  }

  /* OnBitmapPaste: a browser clipboard gives true colour, which is HD art (PasteHDArt). */
  async function pastePicture(slot: number): Promise<void> {
    let img: Awaited<ReturnType<typeof pasteImage>>;
    try { img = await pasteImage(); } catch { img = null; }
    if (!img) { await alertDialog("Track Components", "Can't get bitmap from clipboard"); return; }
    await takeHd(slot, img, { ext: ".PNG", data: await encodePng(img) });
  }

  /* OnBitmapCopy: the HD art at its own size, else the bitmap. */
  async function copyPicture(slot: number): Promise<void> {
    const hd = hdDecoded[slot];
    const b = bmpDecoded[slot];
    try {
      if (hd) await copyImage(new Uint8ClampedArray(hd.rgba), hd.width, hd.height);
      else if (b) {
        const o = new OffscreenCanvas(b.width, b.height);
        const g = o.getContext("2d")!;
        g.drawImage(b, 0, 0);
        await copyImage(g.getImageData(0, 0, b.width, b.height).data, b.width, b.height);
      }
    } catch (err) { await alertDialog("Copy", `The clipboard would not take the picture: ${err instanceof Error ? err.message : String(err)}`); }
  }

  /* CStockIconDlg: click a cell of the sheet. */
  async function stockIconPick(): Promise<void> {
    const cv = el("canvas", { width: 96, height: 144, class: "cmp-stock" }) as HTMLCanvasElement;
    const draw = () => { const g = cv.getContext("2d")!; g.imageSmoothingEnabled = false; g.drawImage(sheet, 0, 0); };
    if (sheet.complete) draw(); else sheet.onload = draw;
    let cell: [number, number] | null = null;
    const done = openDialog({ title: "Icons", body: cv, buttons: [{ label: "Cancel", value: "cancel" }] });
    cv.addEventListener("click", (e) => {
      const r = cv.getBoundingClientRect();
      cell = [Math.max(0, Math.min(2, Math.trunc((3 * (e.clientX - r.left)) / r.width))), Math.max(0, Math.min(5, Math.trunc((6 * (e.clientY - r.top)) / r.height)))];
      (cv.closest("dialog") as HTMLDialogElement | null)?.close("ok");
    });
    await done;
    const picked = cell as [number, number] | null;
    if (!picked) return;
    c.bitmaps[SLOT_ICON] = stockIcon(picked[0], picked[1]);
    c.hd[SLOT_ICON] = null;
    await decodeSlot(SLOT_ICON);
  }

  async function viewPicture(slot: number): Promise<void> {
    const hd = hdDecoded[slot], b = bmpDecoded[slot];
    const w = hd?.width ?? b?.width ?? 0, h = hd?.height ?? b?.height ?? 0;
    if (!w) return;
    const cv = el("canvas", { width: w, height: h, class: "cmp-view" }) as HTMLCanvasElement;
    const g = cv.getContext("2d")!;
    if (hd) g.putImageData(new ImageData(new Uint8ClampedArray(hd.rgba), w, h), 0, 0); else if (b) g.drawImage(b, 0, 0);
    await openDialog({ title: slotWhat(slot, c.mtm2Only), body: cv });
  }

  function pictureMenu(slot: number, e: MouseEvent): void {
    e.preventDefault();
    const has = Boolean(c.bitmaps[slot] || c.hd[slot]);
    const real = has && !stockIconCell(c.bitmaps[slot] ?? null);
    showContextMenu(e.clientX, e.clientY, ["@items"], ctx.registry, ctx.app, { slots: { items: [
      { label: "Copy", enabled: real, run: () => void copyPicture(slot) },
      { label: "Paste", enabled: !ro, run: () => void pastePicture(slot) },
      { label: "Load...", enabled: !ro, run: () => void loadPicture(slot) },
      { label: "Stock...", enabled: !ro && slot === SLOT_ICON && c.mtm2Only, run: () => void stockIconPick() },
      { label: "Save As...", enabled: has, run: () => {
        const hd = c.hd[slot];
        if (hd) download(hd.data, `${slotWhat(slot, c.mtm2Only).replace(/ /g, "_")}${hd.ext}`);
        else if (c.bitmaps[slot]) download(c.bitmaps[slot]!, `${slotWhat(slot, c.mtm2Only).replace(/ /g, "_")}.bmp`);
      } },
      { label: "View", enabled: real, run: () => void viewPicture(slot) },
    ] } });
  }
  canvases.forEach((cv, slot) => cv.addEventListener("contextmenu", (e) => pictureMenu(slot, e)));

  const copies = el("input", { type: "checkbox", disabled: ro }) as HTMLInputElement;
  copies.checked = ![0, 1, 2].some((i) => c.hd[i] && !c.bitmaps[i]);

  // ---- Backdrops: a summary here, the list in its own dialog.
  const backdrop = el("span", { class: "tex-sunken cmp-name", title: "Right-click or press ... to change the backdrops." });
  const showBackdrops = () => {
    backdrop.textContent = c.backdrops.length ? `${c.backdrops.join(", ")}${c.isArena ? " (arena)" : ""}` : "(none)";
  };
  showBackdrops();
  const editBackdrops = async () => {
    await backdropsDialog(c, ctx, ro);
    showBackdrops();
  };
  const arenaSettings = async () => {
    const out = await arenaDialog(c.arena ?? { x: 128, y: 128, sx: 1, sy: 1 });
    if (out && !ro) c.arena = clampArena(out);
  };
  backdrop.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, ["@items"], ctx.registry, ctx.app, { slots: { items: [
      { label: "Backdrops...", run: () => void editBackdrops() },
      { label: "Arena Settings", enabled: c.isArena && !ro, run: () => void arenaSettings() },
    ] } });
  });

  // ---- Sound theme, palette, water, music, type.
  const ambient = stop(el("select", { disabled: !c.mtm2Only }, ...SOUND_THEMES.map((n, i) => el("option", { value: i }, n)))) as HTMLSelectElement;
  ambient.value = String(c.ambient);
  const palette = stop(el("select", { disabled: !c.mtm2Only }, ...PALETTE_NAMES.slice(0, c.paletteIndex === 16 ? 17 : 16).map((n, i) => el("option", { value: i }, n)))) as HTMLSelectElement;
  palette.value = String(c.paletteIndex);
  const water = stop(el("input", { type: "number", min: 0, max: 255, step: 0.25, value: c.water4 / 4, class: "spin", disabled: !c.mtm2Only })) as HTMLInputElement;
  const musicIcon = el("img", { alt: "", width: 24, height: 12, class: "cmp-music" }) as HTMLImageElement;
  const musicName = () => {
    const m = c.music;
    if (!m) return "";
    const s = String.fromCharCode(...m.subarray(0, Math.min(20, m.length)));
    return s.startsWith("MUSIC") ? s.replace(/\0.*$/, "") : `${m.length} bytes`;
  };
  const musicText = el("span", { class: "cmp-label" });
  const showMusic = () => { musicIcon.src = `${import.meta.env.BASE_URL}ui/${c.music ? "music_ic" : "nomusic_"}.png`; musicText.textContent = musicName(); };
  const musicSel = el("button", { type: "button", class: "mini", disabled: ro || !c.mtm2Only, title: "Stock music", onclick: async () => {
    const cur = musicName().replace(/^MUSIC\\/, "").replace(/\.WAV$/, "") || "BREAK";
    const pick = await stockMusicDialog(cur);
    if (pick) { c.music = Uint8Array.from(`MUSIC\\${pick}.WAV`.padEnd(20, "\0"), (ch) => ch.charCodeAt(0)); showMusic(); }
  } }, "#");
  const musicLoad = async () => {
    const f = await picker(c.mtm2Only ? ".wav" : ".mod");
    if (f) { c.music = new Uint8Array(await f.arrayBuffer()); showMusic(); }
  };
  const musicButton = el("button", { type: "button", class: "mini", disabled: ro, title: "Load music", onclick: () => void musicLoad() }, "...");
  musicIcon.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, ["@items"], ctx.registry, ctx.app, { slots: { items: [
      { label: "Load...", enabled: !ro, run: () => void musicLoad() },
      { label: "Save As...", enabled: Boolean(c.music), run: () => c.music && download(c.music, c.mtm2Only ? "music.wav" : "music.mod") },
      { label: "Play", enabled: Boolean(c.music && c.music.length > 64), run: () => { const a = new Audio(URL.createObjectURL(new Blob([c.music as BlobPart], { type: "audio/wav" }))); void a.play().catch(() => alertDialog("Play", "This browser cannot play that file.")); } },
    ] } });
  });
  showMusic();
  const types = ["Circuit", "Rally", "Rumble", "Drag"].map((_, i) => el("input", { type: "radio", name: "cmp-type", value: i, checked: c.typeIndex === i, disabled: i === 2 && !c.mtm2Only }) as HTMLInputElement);

  // ---- Detail normal and mask, carried byte for byte.
  const mapText = (which: "detail" | "mask") => {
    const m = c[which];
    if (!m.map) return which === "detail" ? "(generated)" : "(none)";
    const kb = Math.round(m.map.length / 1024);
    const ext = m.ext || ".PNG";
    const fromPod = which === "detail" ? ctx.detailFromPod && m.map === start.detail.map : ctx.maskFromPod && m.map === start.mask.map;
    return fromPod && ctx.prefix ? `ART\\${ctx.prefix}${which === "detail" ? "_DTL" : "_MASK"}${ext}  -  ${kb} KB` : `${ext.slice(1)}  ${kb} KB`;
  };
  const detailText = el("span", { class: "tex-sunken cmp-name" });
  const maskText = el("span", { class: "tex-sunken cmp-name" });
  const showMaps = () => { detailText.textContent = mapText("detail"); maskText.textContent = mapText("mask"); };
  const loadMap = async (which: "detail" | "mask") => {
    const f = await picker(".png,.tga");
    if (!f) return;
    if (f.size === 0 || f.size > 32 * 1024 * 1024) { await alertDialog("Terrain map", "That file is empty or improbably large for a terrain map."); return; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const ext = f.name.slice(f.name.lastIndexOf(".")).toUpperCase();
    const img = await tryDecodeImage(bytes, ext === ".TGA" ? "TGA" : "PNG", f.name);
    let warn = "";
    if (!img) warn = "Traxx could not read the size of this image.\n\nIt will be packed as-is. Load it anyway?";
    else if (which === "detail") {
      const { width: w, height: h } = img;
      if (w > 1024 || h > 1024) warn = `This detail normal is ${w}x${h}.\n\nThe engine refuses anything over 1024 and uses its own generated map instead, so this would have no effect in game. 256x256 is the recommended size.\n\nLoad it anyway?`;
      else if (w !== h || (w & (w - 1)) !== 0) warn = `This detail normal is ${w}x${h}, which is not a square power of two.\n\nIt will still tile correctly, but it mips less cleanly and the engine notes it in the log. 256x256 is the recommended size.\n\nLoad it anyway?`;
      else if (w < 32) warn = `This detail normal is only ${w}x${h}. The engine expects at least 32.\n\nLoad it anyway?`;
    } else {
      let bad = 0;
      for (let i = 0; i < img.width * img.height; i++) if (img.rgba[i * 4] !== img.rgba[i * 4 + 1] || img.rgba[i * 4] !== img.rgba[i * 4 + 2]) bad++;
      if (bad) warn = `This mask is not greyscale - ${bad} of its ${img.width * img.height} pixels have different red, green and blue.\n\nThe usual cause is the exported colour reference being flattened into the saved file. The engine reads those colours as mask values, so ground you never painted gets a strength you never asked for: it looks right here and wrong in game.\n\nLoad it anyway?`;
    }
    if (warn && !(await confirmDialog("Terrain map", warn, "Yes"))) return;
    c[which] = { ext, map: bytes };
    showMaps();
  };
  showMaps();
  const mapRow = (label: string, text: HTMLElement, which: "detail" | "mask") => el("div", { class: "opt-row" }, el("span", { class: "fld" }, label), text,
    el("button", { type: "button", class: "mini", disabled: ro, onclick: () => void loadMap(which) }, "..."),
    el("button", { type: "button", class: "mini", disabled: ro, onclick: () => { c[which] = { ext: "", map: null }; showMaps(); } }, "X"));

  // ---- Info description, with the panel's fit.
  const info = stop(el("textarea", { rows: 5, class: "cmp-info", maxlength: INFO_TEXT_MAX }, c.infoText)) as HTMLTextAreaElement;
  const infoStatus = el("p", { class: "hint cmp-status" });
  const measurer = new OffscreenCanvas(1, 1).getContext("2d")!;
  const measure = (s: string, title: boolean) => {
    measurer.font = `${(title ? INFO_FONT_TITLE : INFO_FONT_BODY) * INFO_MEASURE}px "Gill Sans MT", "Gill Sans", sans-serif`;
    return measurer.measureText(s).width;
  };
  const hasText = () => /[^\x00-\x20]/.test(info.value);
  const hasPhoto = () => Boolean(c.bitmaps[SLOT_INFO] || c.hd[SLOT_INFO]);
  function status(): void {
    let desc = "";
    if (hasText()) {
      const fit = infoTextFit(info.value, measure);
      desc = info.value.length > INFO_TEXT_MAX ? `Description: ${info.value.length} bytes; the engine reads only ${INFO_TEXT_MAX}.`
        : fit.over > 0 ? `About ${fit.over} description line${fit.over === 1 ? "" : "s"} will not fit in the panel.`
        : `Description: about ${fit.used} of ${fit.capacity} lines.`;
    }
    infoStatus.textContent = !ctx.infoName ? "No info pop-up possible: the browse bitmap's name must end in S (or T for MTM1)."
      : hasPhoto() && hasText() ? `Info pop-up ready - the button will appear. ${desc}`
      : hasPhoto() ? "Photo set. Add a description too, or no button appears."
      : hasText() ? `Add a 640x480 photo too, or no button appears. ${desc}`
      : "No info pop-up: right-click the photo box to load one, then add a description.";
  }
  info.addEventListener("input", status);
  status();

  for (const slot of [0, 1, 2]) void decodeSlot(slot);
  const row = (label: string, ...nodes: (Node | string)[]) => el("div", { class: "opt-row" }, el("span", { class: "fld" }, label), ...nodes);
  const body = el("div", { class: "cmp" },
    row("Track Name", name),
    row("World Name", stem, el("label", { class: "opt-check" }, stemAuto, "Based on Track Name")),
    row("Comment", comment),
    el("div", { class: "cmp-pics" },
      el("div", { class: "cmp-col" }, labels[SLOT_ICON]!, canvases[SLOT_ICON]!, el("p", { class: "hint", hidden: !c.mtm2Only }, "MTM2 track.")),
      el("div", { class: "cmp-col" }, labels[SLOT_BROWSE]!, canvases[SLOT_BROWSE]!)),
    el("div", { class: "cmp-two" },
      el("div", { class: "cmp-col" },
        row("Backdrops", backdrop, el("button", { type: "button", class: "mini", title: "Backdrops", onclick: () => void editBackdrops() }, "...")),
        row("Sound Theme", ambient),
        row("Color Palette", palette),
        row("Water Level", water),
        row("Music", musicIcon, musicSel, musicButton, musicText)),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Type"), ...types.map((r, i) => el("label", { class: "opt-check" }, r, ["Circuit", "Rally", "Rumble", "Drag"][i]!)))),
    mapRow("Detail Normal", detailText, "detail"),
    mapRow("Terrain Mask", maskText, "mask"),
    el("div", { class: "cmp-two" },
      el("div", { class: "cmp-col" }, labels[SLOT_INFO]!, canvases[SLOT_INFO]!),
      el("div", { class: "cmp-col" }, el("span", { class: "cmp-label" }, "Info Description"), info)),
    el("label", { class: "opt-check" }, copies, "Also write 8-bit BMP copies (old menus)"),
    infoStatus);

  let result: Components | null = null;
  const r = await openDialog({
    title: "Track Components",
    className: "cmp-dialog",
    body,
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (v) => {
      if (v !== "ok") return true;
      let worldName = stem.value;
      if (!stemAuto.checked) {
        worldName = cleanStem(stem.value);
        if (!worldName) { await alertDialog("Track Components", "The World Name needs at least one letter or digit."); stem.focus(); return false; }
        stem.value = worldName;
      }
      if (ctx.infoName && hasPhoto() && hasText() && !ro) {
        const fit = infoTextFit(info.value, measure);
        const warn = info.value.length > INFO_TEXT_MAX
          ? `The info description is ${info.value.length} bytes.\n\nThe engine reads only the first ${INFO_TEXT_MAX}, so everything past that is dropped when the track loads - it will never reach the pop-up at all.\n\nSave it anyway?`
          : fit.over > 0 ? `About ${fit.over} line${fit.over === 1 ? "" : "s"} of the info description will not fit in the pop-up panel.\n\nThe panel holds about ${fit.capacity} lines; this description needs about ${fit.used}. The end will simply not be shown in game.\n\nSave it anyway?` : "";
        if (warn && !(await confirmDialog("Info Description Too Long", warn, "Yes"))) { info.focus(); return false; }
      }
      // The BMP copies: kept, made from the HD art, or dropped (OnOK).
      for (const slot of [0, 1, 2]) {
        if (!c.hd[slot]) continue;
        if (!copies.checked) c.bitmaps[slot] = null;
        else if (!c.bitmaps[slot]) {
          const img = hdDecoded[slot];
          if (!img) { await alertDialog("Track Components", `Could not make the 8-bit BMP copy of the HD ${slotWhat(slot, c.mtm2Only)}.\n\nUntick "Also write 8-bit BMP copies" to keep the HD art alone.`); return false; }
          const { lw, lh } = slotSpec(slot, c.mtm2Only);
          c.bitmaps[slot] = makeBmp8(rgbaToRgb(img), img.width, img.height, lw, lh);
        }
      }
      result = {
        ...c,
        trackName: name.value,
        stem: worldName,
        stemAuto: stemAuto.checked,
        comment: comment.value,
        typeIndex: Math.max(0, types.findIndex((t) => t.checked)),
        water4: Math.max(0, Math.min(4 * 255, Math.floor((Number(water.value) || 0) * 4 + 0.5))),
        ambient: Number(ambient.value),
        paletteIndex: Number(palette.value),
        infoText: info.value,
      };
      return true;
    },
  });
  bmpDecoded.forEach((b) => b?.close());
  return r === "ok" ? result : null;
}

/* CArenaPropertiesDlg. */
/*
  Backdrops: the models drawn around the track, in drawing order (the first is the track's
  backdrop, each next one drawn over it), up to MAX_BACKDROPS. An arena's stadium is a
  backdrop of its own and the only one. Changes apply to the Track Components sheet on OK.
*/
async function backdropsDialog(c: Components, ctx: ComponentsContext, ro: boolean): Promise<void> {
  let names = [...c.backdrops];
  let isArena = c.isArena;
  let arena = c.arena ? { ...c.arena } : null;
  const loaded = [...c.loadedBackdrops];
  const list = el("select", { size: 6, class: "mod-files bd-list", "aria-label": "Backdrops in drawing order" }) as HTMLSelectElement;
  list.addEventListener("keydown", (e) => e.stopPropagation());
  const hint = el("p", { class: "hint" });
  const button = (label: string, run: () => void) => el("button", { type: "button", onclick: run }, label) as HTMLButtonElement;
  const pick = async (): Promise<{ name: string; isArena: boolean } | null> => {
    const r = await ctx.chooseBackdrop();
    if (!r) return null;
    if (typeof r.load === "string") { await alertDialog("Bad Backdrop", r.load); return null; }
    const model = { ...r.load.model, name: r.load.model.name.replace(/^MODELS\\/i, "") };
    loaded.push({ model, textures: r.load.textures });
    if (r.load.missing.length) await alertDialog("Backdrop", `Missing textures:\n${r.load.missing.join("\n")}\n\nThe backdrop has been KEPT and will be written to the pod.`);
    return { name: model.name, isArena: r.isArena };
  };
  const add = button("Add...", async () => {
    const r = await pick();
    if (!r) return;
    if (r.isArena) {
      if (names.length && !(await confirmDialog("Backdrops", "An arena's stadium is the track's only backdrop. Replace the list with it?"))) return;
      names = [r.name]; isArena = true; arena ??= { x: 128, y: 128, sx: 1, sy: 1 };
    } else {
      names.push(r.name);
    }
    draw(names.length - 1);
  });
  const replace = button("Replace...", async () => {
    const i = list.selectedIndex;
    if (i < 0) return;
    const r = await pick();
    if (!r) return;
    if (r.isArena) { names = [r.name]; isArena = true; arena ??= { x: 128, y: 128, sx: 1, sy: 1 }; draw(0); return; }
    names[i] = r.name;
    if (i === 0) isArena = false;
    draw(i);
  });
  const remove = button("Remove", () => {
    const i = list.selectedIndex;
    if (i < 0) return;
    names.splice(i, 1);
    if (!names.length) isArena = false;
    draw(Math.min(i, names.length - 1));
  });
  const move = (d: number) => () => {
    const i = list.selectedIndex, j = i + d;
    if (i < 0 || j < 0 || j >= names.length) return;
    [names[i], names[j]] = [names[j]!, names[i]!];
    draw(j);
  };
  const up = button("Move Up", move(-1)), down = button("Move Down", move(1));
  const arenaButton = button("Arena Settings...", async () => {
    const out = await arenaDialog(arena ?? { x: 128, y: 128, sx: 1, sy: 1 });
    if (out) arena = clampArena(out);
  });
  function draw(select = list.selectedIndex): void {
    list.replaceChildren(...names.map((n, i) => el("option", { value: i }, `${i + 1}. ${n}${i === 0 && isArena ? "  (arena)" : ""}`)));
    if (names.length) list.selectedIndex = Math.max(0, Math.min(select, names.length - 1));
    update();
  }
  function update(): void {
    const i = list.selectedIndex;
    add.disabled = ro || (!isArena && names.length >= MAX_BACKDROPS);
    replace.disabled = ro || i < 0;
    remove.disabled = ro || i < 0;
    up.disabled = ro || isArena || i <= 0;
    down.disabled = ro || isArena || i < 0 || i >= names.length - 1;
    arenaButton.hidden = !isArena;
    arenaButton.disabled = ro;
    hint.textContent = isArena
      ? "An arena track has one backdrop: its stadium, placed by Arena Settings."
      : `Drawn in this order, each over the one before. Up to ${MAX_BACKDROPS}.${names.length ? "" : " No backdrop: the sky stays empty."}`;
  }
  list.addEventListener("change", update);
  draw(0);
  const r = await openDialog({
    title: "Backdrops",
    className: "bd-dialog",
    body: el("div", { class: "bd" },
      el("div", { class: "bd-main" }, list, el("div", { class: "bd-buttons" }, add, replace, remove, up, down, arenaButton)),
      hint),
    buttons: ro ? [{ label: "Close", value: "cancel", primary: true }] : [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  if (r !== "ok" || ro) return;
  c.backdrops = names;
  c.isArena = isArena && names.length > 0;
  c.arena = c.isArena ? arena : c.arena;
  c.loadedBackdrops = loaded;
}

async function arenaDialog(a: TraxxArena): Promise<TraxxArena | null> {
  const n = (v: number) => stop(el("input", { type: "number", step: 1, value: v, class: "spin" })) as HTMLInputElement;
  const x = n(a.x), y = n(a.y), sx = n(a.sx), sy = n(a.sy);
  const r = await openDialog({
    title: "Arena Settings",
    body: el("div", { class: "opt-page" },
      el("label", { class: "opt-row" }, el("span", { class: "fld" }, "X"), x),
      el("label", { class: "opt-row" }, el("span", { class: "fld" }, "Y"), y),
      el("label", { class: "opt-row" }, el("span", { class: "fld" }, "Size X"), sx),
      el("label", { class: "opt-row" }, el("span", { class: "fld" }, "Size Y"), sy)),
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  return r === "ok" ? { x: Number(x.value), y: Number(y.value), sx: Number(sx.value), sy: Number(sy.value) } : null;
}

/* CStockMusicDlg. */
async function stockMusicDialog(current: string): Promise<string | null> {
  const select = stop(el("select", { size: 10, class: "stock-list" }, ...STOCK_MUSIC.map(([n, t]) => el("option", { value: n, selected: n === current }, `${n}  -  ${t}`)))) as HTMLSelectElement;
  if (select.selectedIndex < 0) select.selectedIndex = 1;
  const shown = openDialog({ title: "Stock Music", body: select, buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
  select.addEventListener("dblclick", () => (select.closest("form") as HTMLFormElement | null)?.requestSubmit());
  return (await shown) === "ok" ? select.value : null;
}
