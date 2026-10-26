/*
  The mouse and keys of the view, to the active mode (CTraxxView::OnLButtonDown, OnLButtonUp,
  OnMouseMove, OnLButtonDblClk, OnContextMenu, OnKeyDown, OnKeyUp).

  Traxx ignores a move with the button down in the first 200 ms after the press, so a click
  does not turn into a tiny drag; that rule is kept. Navigation keys and the mouse's own view
  moves (middle button, wheel, Alt+left) are view-input's and never reach a mode.
*/
import type { Editor, ViewPoint } from "../../app/editor.ts";
import type { AppState } from "../../app/state.ts";
import type { CommandRegistry } from "../shell/commands.ts";
import { showContextMenu } from "../shell/context-menu.ts";

const CLICK_GUARD_MS = 200;

export function attachEditInput(element: HTMLElement, editor: Editor, registry: CommandRegistry, app: AppState): void {
  const point = (e: MouseEvent): ViewPoint => {
    const r = element.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, clientX: e.clientX, clientY: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
  };
  let pressedAt = 0;
  let dragging = false;

  element.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.altKey) return;
    element.focus();
    const p = point(e);
    editor.lastPoint = p;
    if (!editor.canEdit) return;
    pressedAt = performance.now();
    dragging = true;
    element.setPointerCapture(e.pointerId);
    editor.handler?.down?.(p);
  });
  element.addEventListener("pointermove", (e) => {
    const p = point(e);
    editor.lastPoint = p;
    if (!editor.canEdit) return;
    // A right drag is the context menu's; Traxx returns on MK_RBUTTON.
    if (e.buttons & 2) return;
    if (dragging && (e.buttons & 1)) {
      if (performance.now() - pressedAt < CLICK_GUARD_MS) return;
      editor.handler?.drag?.(p);
    } else {
      editor.handler?.hover?.(p);
    }
  });
  const release = (e: PointerEvent) => {
    if (!dragging || e.button !== 0) return;
    dragging = false;
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
    if (editor.canEdit) editor.handler?.up?.(point(e));
  };
  element.addEventListener("pointerup", release);
  element.addEventListener("pointercancel", release);
  element.addEventListener("dblclick", (e) => {
    if (e.button !== 0 || !editor.canEdit) return;
    editor.handler?.dblclick?.(point(e));
  });
  element.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!editor.canEdit) return;
    const req = editor.handler?.contextMenu?.(point(e));
    if (req) showContextMenu(e.clientX, e.clientY, req.items, registry, app, req.options);
  });
  element.addEventListener("keydown", (e) => {
    if (!editor.canEdit || e.defaultPrevented) return;
    if (editor.handler?.keyDown?.(e)) e.preventDefault();
  });
  element.addEventListener("keyup", (e) => {
    if (!editor.canEdit) return;
    if (editor.handler?.keyUp?.(e)) e.preventDefault();
  });
}
