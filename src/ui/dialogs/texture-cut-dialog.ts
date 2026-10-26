/*
  Paste Composite's dialog (Traxx/TextureCutDlg.cpp): the image fitted in a preview with the
  grid of tiles over it (the part of each tile that will be seen), the base name (6 characters
  at most), the tile size, the X and Y offsets, columns and rows, the format of true-colour
  tiles (PNG, TGA, or RAW reduced to 256 colours each) and, for RAW, the shared border.

  JSTraxx always keeps HD tiles as they are and builds their 8-bit copies in memory, so there
  is no "Keep HD art only" box.
*/
import { el } from "../../shared/dom.ts";
import { alertDialog, openDialog } from "../shell/dialog.ts";
import { applyLimits, LEGACY_SIZES, HD_SIZES, pickSize, sizesFor, tileOrigin, tileRing, tileStride, type CutFormat, type CutSettings } from "../../core/image/composite.ts";
import type { RgbaImage } from "../../core/view/tiles.ts";

const FORMATS: CutFormat[] = ["PNG", "TGA", "RAW"];

export interface CutChoice { base: string; settings: CutSettings }

export async function textureCutDialog(image: RgbaImage, imageName: string, rememberedFormat: number, gridColour: string, check: (choice: CutChoice) => Promise<string | null>): Promise<CutChoice | null> {
  const w = image.width, h = image.height;
  let s: CutSettings = { format: FORMATS[rememberedFormat] ?? "PNG", size: 256, overlap: true, xoff: 0, yoff: 0, cols: 8, rows: 8 };

  const source = new OffscreenCanvas(w, h);
  source.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), w, h), 0, 0);
  const preview = el("canvas", { class: "cut-preview", width: 360, height: 300 });

  const num = (value: number) => {
    const input = el("input", { type: "number", min: 0, step: 1, value, class: "spin" });
    input.addEventListener("keydown", (e) => e.stopPropagation());
    input.addEventListener("input", () => update());
    return input;
  };
  const baseInput = el("input", { type: "text", maxlength: 6, value: "NEW", class: "tex-name", autofocus: true });
  baseInput.addEventListener("keydown", (e) => e.stopPropagation());
  baseInput.addEventListener("input", () => { baseInput.value = baseInput.value.toUpperCase(); info(); });
  const sizeSelect = el("select", {});
  sizeSelect.addEventListener("change", () => update());
  const xInput = num(0), yInput = num(0), colsInput = num(8), rowsInput = num(8);
  const formatRadios = FORMATS.map((f) => el("input", { type: "radio", name: "cut-format", value: f, checked: f === s.format }));
  formatRadios.forEach((r) => r.addEventListener("change", () => { s.format = r.value as CutFormat; fillSizes(); update(); }));
  const overlap = el("input", { type: "checkbox", checked: true });
  overlap.addEventListener("change", () => { s.overlap = overlap.checked; update(); });
  const infoText = el("p", { class: "modal-text cut-info" });

  function fillSizes(): void {
    const sizes = sizesFor(s.format, w, h);
    s.size = pickSize(sizes, s.size);
    sizeSelect.replaceChildren(...sizes.map((z) => el("option", { value: z, selected: z === s.size }, `${z} x ${z}`)));
  }

  function read(): void {
    const n = (i: HTMLInputElement) => Math.max(0, Math.trunc(Number(i.value)) || 0);
    s = { ...s, xoff: n(xInput), yoff: n(yInput), cols: n(colsInput), rows: n(rowsInput), size: Number(sizeSelect.value) || 0 };
  }

  function update(): void {
    read();
    const lim = applyLimits(s, w, h);
    s = { format: lim.format, size: lim.size, overlap: lim.overlap, xoff: lim.xoff, yoff: lim.yoff, cols: lim.cols, rows: lim.rows };
    const put = (i: HTMLInputElement, v: number, max: number) => { i.max = String(max); if (document.activeElement !== i || Number(i.value) !== v) i.value = String(v); };
    put(xInput, s.xoff, lim.maxX);
    put(yInput, s.yoff, lim.maxY);
    put(colsInput, s.cols, Math.max(1, lim.maxCols));
    put(rowsInput, s.rows, Math.max(1, lim.maxRows));
    overlap.disabled = s.format !== "RAW";
    overlap.checked = s.format === "RAW" && s.overlap;
    info();
    draw();
  }

  function info(): void {
    const base = baseInput.value.trim().toUpperCase();
    const line1 = s.format === "RAW"
      ? `${imageName} - ${w} x ${h}, true colour: legacy 8-bit tiles (.RAW + .ACT), each reduced to its own 256 colours.`
      : `${imageName} - ${w} x ${h}, true colour: HD tiles (.${s.format}); the 8-bit tile is built in memory.`;
    const smallest = (s.format === "RAW" ? LEGACY_SIZES : HD_SIZES)[0];
    const line2 = s.size <= 0 ? `The image is smaller than the smallest tile (${smallest} x ${smallest}).`
      : s.cols < 1 || s.rows < 1 ? "No whole tile fits from these offsets."
      : !base ? "Enter a base name of up to 6 characters."
      : `${s.cols * s.rows} texture${s.cols * s.rows === 1 ? "" : "s"}, ${base}00 to ${base}${(s.cols - 1).toString(16).toUpperCase()}${(s.rows - 1).toString(16).toUpperCase()}.`;
    infoText.textContent = `${line1}\n${line2}`;
  }

  function draw(): void {
    const g = preview.getContext("2d")!;
    const cw = preview.width, ch = preview.height;
    g.fillStyle = "#808080";
    g.fillRect(0, 0, cw, ch);
    const k = Math.min(cw / w, ch / h);
    const dw = Math.max(1, Math.trunc(w * k)), dh = Math.max(1, Math.trunc(h * k));
    const ox = (cw - dw) >> 1, oy = (ch - dh) >> 1;
    g.imageSmoothingEnabled = true;
    g.drawImage(source, ox, oy, dw, dh);
    if (s.size <= 0 || s.cols < 1 || s.rows < 1) return;
    const ring = tileRing(s), stride = tileStride(s);
    const x0 = s.xoff + ring, y0 = s.yoff + ring, x1 = x0 + s.cols * stride, y1 = y0 + s.rows * stride;
    g.strokeStyle = gridColour;
    g.lineWidth = 1;
    g.beginPath();
    for (let r = 0; r <= s.rows; r++) { const y = oy + Math.trunc((y0 + r * stride) * k) + 0.5; g.moveTo(ox + Math.trunc(x0 * k), y); g.lineTo(ox + Math.trunc(x1 * k), y); }
    for (let c = 0; c <= s.cols; c++) { const x = ox + Math.trunc((x0 + c * stride) * k) + 0.5; g.moveTo(x, oy + Math.trunc(y0 * k)); g.lineTo(x, oy + Math.trunc(y1 * k)); }
    g.stroke();
  }

  fillSizes();
  update();

  const row = (label: string, ...inputs: Node[]) => el("label", { class: "opt-row" }, el("span", { class: "fld" }, label), ...inputs);
  let choice: CutChoice | null = null;
  const r = await openDialog({
    title: "Paste Composite",
    className: "cut-dialog",
    body: [
      el("div", { class: "cut-grid" }, preview,
        el("div", { class: "opt-page" },
          row("Base name", baseInput),
          row("Texture size", sizeSelect),
          row("X offset", xInput),
          row("Y offset", yInput),
          row("Columns", colsInput),
          row("Rows", rowsInput),
          el("fieldset", { class: "opt-group" }, el("legend", {}, "Save tiles as"), ...formatRadios.map((rd, i) => el("label", { class: "opt-check" }, rd, FORMATS[i] === "RAW" ? "RAW + ACT" : FORMATS[i]))),
          el("label", { class: "opt-check" }, overlap, "Overlap borders"))),
      infoText,
    ],
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (value) => {
      if (value !== "ok") return true;
      update();
      const base = baseInput.value.trim().toUpperCase();
      const fail = (m: string) => alertDialog("Paste Composite", m).then(() => false);
      if (s.size <= 0) return fail("The image is smaller than the smallest tile.");
      if (!base) return fail("Please enter base name.");
      if (/[ .\\/]/.test(base)) return fail("Invalid character(s) in name!");
      if (s.cols * s.rows < 2) return fail("Must divide into at least 2 textures.");
      const last = tileOrigin(s, s.cols - 1, s.rows - 1);
      if (last.x + s.size > w || last.y + s.size > h) return fail("The last tile runs off the edge of the image.");
      const conflict = await check({ base, settings: s });
      if (conflict) return fail(`${conflict}\n\nNothing has been written.  Choose another base name.`);
      choice = { base, settings: { ...s } };
      return true;
    },
  });
  return r === "ok" ? choice : null;
}

export const cutFormatIndex = (f: CutFormat) => FORMATS.indexOf(f);
