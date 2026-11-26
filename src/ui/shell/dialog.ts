/*
  Modal dialogs, on the native <dialog> element: Escape cancels, focus stays inside, and the
  page behind is inert. `openDialog` resolves with the button value that closed it, or null.
*/
import { el } from "../../shared/dom.ts";

export interface DialogButton { label: string; value: string; primary?: boolean }

export interface DialogOptions {
  title: string;
  body: Node | Node[];
  buttons?: DialogButton[];
  /** Called before closing with a value; return false to keep the dialog open. */
  beforeClose?: (value: string) => boolean | Promise<boolean>;
  className?: string;
}

export function openDialog(options: DialogOptions): Promise<string | null> {
  const buttons = options.buttons ?? [{ label: "OK", value: "ok", primary: true }];
  const dialog = el("dialog", { class: `modal ${options.className ?? ""}`, "aria-label": options.title }) as HTMLDialogElement;
  const form = el("form", { method: "dialog" },
    el("header", { class: "modal-title" }, options.title),
    el("div", { class: "modal-body" }, ...(Array.isArray(options.body) ? options.body : [options.body])),
    el("footer", { class: "modal-buttons" }, ...buttons.map((b) =>
      el("button", { value: b.value, class: b.primary ? "primary" : null, autofocus: b.primary ? true : null }, b.label))));
  dialog.append(form);
  document.body.append(dialog);
  return new Promise((resolve) => {
    form.addEventListener("submit", async (e) => {
      const value = ((e as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? "ok";
      e.preventDefault();
      if (options.beforeClose && !(await options.beforeClose(value))) return;
      dialog.close(value);
    });
    dialog.addEventListener("close", () => {
      const value = dialog.returnValue || null;
      dialog.remove();
      resolve(value === "" ? null : value);
    });
    dialog.addEventListener("cancel", () => { dialog.returnValue = ""; });
    dialog.showModal();
  });
}

export function alertDialog(title: string, message: string): Promise<string | null> {
  return openDialog({ title, body: el("p", { class: "modal-text" }, message) });
}

export async function confirmDialog(title: string, message: string, ok = "OK"): Promise<boolean> {
  const v = await openDialog({ title, body: el("p", { class: "modal-text" }, message), buttons: [{ label: ok, value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
  return v === "ok";
}

/** A modeless dialog's handle (openModeless). */
export interface ModelessDialog {
  readonly element: HTMLDialogElement;
  /** Bring it forward (a second request for the same window). */
  raise(): void;
  /** Take it down, without a word. */
  close(): void;
  readonly isOpen: boolean;
}

export interface ModelessOptions {
  title: string;
  body: Node | Node[];
  buttons: DialogButton[];
  className?: string;
  /** A button, or Enter in a field (the primary button's value). */
  onButton: (value: string) => void;
  /** Escape and the close box. */
  onCancel: () => void;
}

/*
  A modeless window on <dialog>.show() (Traxx 1.8.2's modeless Object Properties): the page
  behind stays live, so the view keeps its camera keys and the mouse. It opens beside the view
  at the right edge of the main window. Escape is Cancel (a non-modal dialog gets no cancel
  event of its own); Enter in a field presses the primary button. A modal dialog opened while
  it is up (openDialog) is modal over it too.
*/
export function openModeless(options: ModelessOptions): ModelessDialog {
  const dialog = el("dialog", { class: `modal modeless ${options.className ?? ""}`, "aria-label": options.title }) as HTMLDialogElement;
  /*
    novalidate: like Traxx's edit boxes, the window reads and clamps what is typed itself. The
    browser's own check would refuse a value off a spin box's step grid (an X shown to 3 decimals
    with a 0.1 step) and keep Apply and OK from working.
  */
  const form = el("form", { method: "dialog", novalidate: true },
    el("header", { class: "modal-title" }, options.title,
      el("button", { type: "button", class: "modeless-close", title: "Close", "aria-label": `Close ${options.title}`, onclick: () => options.onCancel() }, "×")),
    el("div", { class: "modal-body" }, ...(Array.isArray(options.body) ? options.body : [options.body])),
    el("footer", { class: "modal-buttons" }, ...options.buttons.map((b) =>
      el("button", { value: b.value, class: b.primary ? "primary" : null }, b.label))));
  dialog.append(form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
    options.onButton(submitter?.value ?? options.buttons.find((b) => b.primary)?.value ?? "ok");
  });
  // Capture: the fields stop their keys from bubbling (they belong to them, not to the view).
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.querySelector("dialog:modal")) { e.preventDefault(); e.stopPropagation(); options.onCancel(); }
  }, true);
  document.body.append(dialog);
  dialog.show();
  let open = true;
  return {
    element: dialog,
    raise: () => { if (!open) return; document.body.append(dialog); if (!dialog.open) dialog.show(); (dialog.querySelector("input, select, button") as HTMLElement | null)?.focus(); },
    close: () => { if (!open) return; open = false; dialog.close(); dialog.remove(); },
    get isOpen() { return open; },
  };
}
