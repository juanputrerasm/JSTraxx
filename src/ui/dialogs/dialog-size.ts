/*
  Resizable modal dialogs that open larger and remember their size, as Traxx 1.7 does for
  Stock Music (StockMusicDlg.cpp, e4b4cd5: OnInitDialog, OnGetMinMaxInfo, RememberSize).
  The opening rule is core/ui-layout.ts openingSize; the size is stored in
  settings.dialog_sizes under the dialog's id whenever the author resizes it.
*/
import type { AppState } from "../../app/state.ts";
import { openingSize, type Size } from "../../core/ui-layout.ts";

/**
  Make an open <dialog> resizable from its corner, sized as `openingSize` says (minimum `min`,
  the template size; `first` the first time). The dialog's body and the element `fill` stretch
  with it.
*/
export function makeResizable(dialog: HTMLDialogElement, app: AppState, id: string, min: Size, first: Size, fill?: HTMLElement): void {
  const size = openingSize(app.settings.dialog_sizes[id], min, first, { w: window.innerWidth - 16, h: window.innerHeight - 16 });
  Object.assign(dialog.style, {
    width: `${size.w}px`, height: `${size.h}px`, minWidth: `${Math.min(min.w, size.w)}px`, minHeight: `${Math.min(min.h, size.h)}px`,
    maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100dvh - 16px)", resize: "both", overflow: "hidden",
  });
  const form = dialog.querySelector("form");
  if (form) Object.assign(form.style, { height: "100%", maxHeight: "none" });
  const body = dialog.querySelector<HTMLElement>(".modal-body");
  if (body) Object.assign(body.style, { flex: "1", minHeight: "0", display: "flex", flexDirection: "column" });
  if (fill) Object.assign(fill.style, { flex: "1", minHeight: "0", width: "100%", boxSizing: "border-box" });
  // RememberSize: whenever the size changes while open.
  let last = `${size.w}x${size.h}`;
  const observer = new ResizeObserver(() => {
    if (!dialog.open) return;
    const w = Math.round(dialog.offsetWidth), h = Math.round(dialog.offsetHeight);
    if (!w || !h || `${w}x${h}` === last) return;
    last = `${w}x${h}`;
    app.updateSettings((s) => { s.dialog_sizes[id] = { w, h }; });
  });
  observer.observe(dialog);
  dialog.addEventListener("close", () => observer.disconnect(), { once: true });
}
