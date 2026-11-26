/*
  The keys stay with the 3D view, as in Traxx, where the toolbars and control bars never take
  the focus from CTraxxView.

  After a click on a toolbar button, a checkbox, a slider or another control that does not
  type, the focus goes back to the view, so the next key moves the camera or edits the track
  without first clicking the view (which in most modes would edit something). The same
  happens when a dialog closes. Fields that take typing (text, numbers, lists) keep the
  focus until the user leaves them; Enter or Escape in a bar's field hands it back.

  Traxx 1.8.2 (TakeViewFocus): while a modeless window is open the view takes the keys when the
  pointer enters it (takeViewFocusOnEnter), so the camera keys work without a click.
*/

/* Controls that take typing or their own keys: they keep the focus. */
const TYPING = [
  "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=color]):not([type=file])",
  "textarea", "select", "[contenteditable]", "[role=listbox]", "[role=menu]", "canvas[tabindex]", "ol[tabindex]", "ul[tabindex]",
].join(", ");

function typing(a: Element | null): boolean {
  return Boolean(a && a.closest(TYPING));
}

export function keepViewFocus(viewport: HTMLElement, hasTrack: () => boolean): void {
  const giveBack = () => {
    if (!hasTrack() || !viewport.isConnected) return;
    // A modal dialog has the keys; a modeless one (Object Properties) leaves them to the view.
    if (document.querySelector("dialog:modal")) return;
    const a = document.activeElement;
    if (a === viewport || typing(a)) return;
    viewport.focus({ preventScroll: true });
  };
  // After the click has done its work (a checkbox has toggled, a slider has moved).
  document.addEventListener("pointerup", (e) => {
    const t = e.target as Element | null;
    // A click in a modeless window (Object Properties) works there, as in Traxx.
    if (!t || viewport.contains(t) || typing(t) || t.closest("dialog")) return;
    setTimeout(giveBack, 0);
  });
  // A dialog closing hands the focus back to whatever opened it, often a toolbar button.
  document.addEventListener("close", () => setTimeout(giveBack, 0), true);
  // A field left for nothing (Enter or Escape blurs it) leaves the focus on the page.
  document.addEventListener("focusout", (e) => {
    if ((e as FocusEvent).relatedTarget === null) setTimeout(() => { if (document.activeElement === document.body) giveBack(); }, 0);
  });
}

/**
  Traxx 1.8.2 CTraxxView::TakeViewFocus for a modeless window: the pointer ENTERING the view hands
  it the keyboard (resting there does not, so typing in the window is never interrupted), and at
  open, if the pointer is already over the view, the view takes it at once. Returns the remover.
*/
export function takeViewFocusOnEnter(viewport: HTMLElement, pointerOver: boolean): () => void {
  const take = () => { if (!document.querySelector("dialog:modal")) viewport.focus({ preventScroll: true }); };
  viewport.addEventListener("pointerenter", take);
  if (pointerOver) setTimeout(take, 0);
  return () => viewport.removeEventListener("pointerenter", take);
}
