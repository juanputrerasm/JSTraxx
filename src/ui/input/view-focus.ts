/*
  The keys stay with the 3D view, as in Traxx, where the toolbars and control bars never take
  the focus from CTraxxView.

  After a click on a toolbar button, a checkbox, a slider or another control that does not
  type, the focus goes back to the view, so the next key moves the camera or edits the track
  without first clicking the view (which in most modes would edit something). The same
  happens when a dialog closes. Fields that take typing (text, numbers, lists) keep the
  focus until the user leaves them; Enter or Escape in a bar's field hands it back.
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
    if (document.querySelector("dialog[open]")) return;
    const a = document.activeElement;
    if (a === viewport || typing(a)) return;
    viewport.focus({ preventScroll: true });
  };
  // After the click has done its work (a checkbox has toggled, a slider has moved).
  document.addEventListener("pointerup", (e) => {
    const t = e.target as Element | null;
    if (!t || viewport.contains(t) || typing(t)) return;
    setTimeout(giveBack, 0);
  });
  // A dialog closing hands the focus back to whatever opened it, often a toolbar button.
  document.addEventListener("close", () => setTimeout(giveBack, 0), true);
  // A field left for nothing (Enter or Escape blurs it) leaves the focus on the page.
  document.addEventListener("focusout", (e) => {
    if ((e as FocusEvent).relatedTarget === null) setTimeout(() => { if (document.activeElement === document.body) giveBack(); }, 0);
  });
}
