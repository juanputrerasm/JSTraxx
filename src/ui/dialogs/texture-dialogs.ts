/*
  Texture Name (IDD_TEXTURENAME, Traxx/TexturenameDlg.cpp) and Texture Animation
  (Traxx/TextureAnimateDlg.cpp).
*/
import { el } from "../../shared/dom.ts";
import { alertDialog, openDialog } from "../shell/dialog.ts";
import { pod1ArtStemBudget, pod1StemRefusal } from "../../core/traxx/pod-items.ts";
import type { RgbaImage } from "../../core/view/tiles.ts";

/** CTexturenameDlg::OnOK: no space, slash or dot, and within the ART stem budget. */
export function textureNameRefusal(name: string): string | null {
  if (/[ \\/]/.test(name)) return "Invalid character(s) in name!";
  if (name.includes(".")) return "A texture name cannot contain a dot - leave the extension off.";
  if (name.length > pod1ArtStemBudget()) return pod1StemRefusal("ART\\", ".RAW", name);
  return null;
}

/**
  "Specify a unique texture name:". Typing is capped at the budget (LimitText), but a longer
  name handed in stays editable; OK checks it. Upper case, as the edit box is ES_UPPERCASE.
  `unique` is asked after the name passes (TextureExists); a message keeps the dialog open.
*/
export async function textureNameDialog(initial = "", unique?: (name: string) => Promise<string | null>): Promise<string | null> {
  const input = el("input", { type: "text", value: initial.toUpperCase(), maxlength: Math.max(initial.length, pod1ArtStemBudget()), class: "tex-name", autofocus: true });
  input.addEventListener("input", () => { const at = input.selectionStart; input.value = input.value.toUpperCase(); input.setSelectionRange(at, at); });
  input.addEventListener("keydown", (e) => e.stopPropagation());
  let out: string | null = null;
  const r = await openDialog({
    title: "Texture Name",
    body: el("label", { class: "opt-row" }, el("span", {}, "Specify a unique texture name:"), input),
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: async (value) => {
      if (value !== "ok") return true;
      const name = input.value.trim();
      if (!name) return false;
      const why = textureNameRefusal(name) ?? (unique ? await unique(name) : null);
      if (why) { await alertDialog("Texture Name", why); return false; }
      out = name;
      return true;
    },
  });
  return r === "ok" ? out : null;
}

/**
  The animation of a texture: its frames played at the period (50 to 1000 ms), the frame names
  listed, and Un-animate to remove it. Resolves with the new period, "remove", or null.
*/
export async function textureAnimateDialog(frames: (RgbaImage | null)[], names: string[], period: number): Promise<number | "remove" | null> {
  const canvas = el("canvas", { width: 128, height: 128, class: "ani-preview" });
  const g = canvas.getContext("2d")!;
  const images = frames.map((f) => {
    if (!f) return null;
    const c = new OffscreenCanvas(f.width, f.height);
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), f.width, f.height), 0, 0);
    return c;
  });
  const periodInput = el("input", { type: "number", min: 50, max: 1000, step: 1, value: period, class: "spin" });
  periodInput.addEventListener("keydown", (e) => e.stopPropagation());
  const list = el("textarea", { readonly: true, rows: 8, class: "ani-names" }, names.map((n) => n.replace(/^ART\\/i, "")).join("\n"));
  let removed = false;
  let seq = 0;
  let timer = 0;
  const tick = () => {
    g.imageSmoothingEnabled = false;
    const img = removed ? null : images[seq];
    if (img) g.drawImage(img, 0, 0, canvas.width, canvas.height);
    else { g.fillStyle = "#000"; g.fillRect(0, 0, canvas.width, canvas.height); }
    seq = (seq + 1) % Math.max(1, images.length);
  };
  const clamp = () => Math.min(1000, Math.max(50, Math.trunc(Number(periodInput.value)) || 250));
  const restart = () => { clearInterval(timer); timer = window.setInterval(tick, clamp()); };
  periodInput.addEventListener("input", restart);
  const unanimate = el("button", { type: "button", onclick: () => { removed = true; list.value = ""; tick(); } }, "Un-animate");
  tick();
  restart();
  const r = await openDialog({
    title: "Texture Animation",
    body: el("div", { class: "ani-grid" }, canvas, el("div", { class: "opt-page" },
      el("label", { class: "opt-row" }, el("span", { class: "fld" }, "Period (ms)"), periodInput), list, unanimate)),
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  clearInterval(timer);
  if (r !== "ok") return null;
  return removed ? "remove" : clamp();
}
