/*
  Keys and mouse in the 3D view.

  Navigation keys are Traxx's (CTraxxView::OnKeyDown, OnKeyUp): arrows or numpad 8/2/4/6 move
  and turn, PgUp/PgDn or numpad 9/3 pitch, A and Z climb and descend, comma and period strafe,
  Shift goes faster, numpad 5 (or Clear) levels the view, Home faces north. They act while the
  view has the focus; losing it stops everything (OnKillFocus).

  Mouse additions (JSTraxx): the wheel moves forward and back (with Ctrl, up and down),
  middle-drag looks around, Shift+middle-drag pans, Alt+left-drag orbits the point under the
  pointer. The right button stays the context menu.
*/
import type { NavKeys, TraxxCamera } from "../../core/view/camera.ts";

const KEYS: Record<string, keyof NavKeys> = {
  ArrowUp: "up", Numpad8: "up", ArrowDown: "down", Numpad2: "down",
  ArrowLeft: "left", Numpad4: "left", ArrowRight: "right", Numpad6: "right",
  PageUp: "pgUp", Numpad9: "pgUp", PageDown: "pgDown", Numpad3: "pgDown",
  KeyA: "a", KeyZ: "z", Comma: "strafeLeft", Period: "strafeRight",
  ShiftLeft: "shift", ShiftRight: "shift",
};

export interface ViewInputHooks {
  camera: TraxxCamera;
  groundAt: (x: number, y: number) => number;
  /** Something moved: redraw and update the read-outs. */
  changed: () => void;
  /** Start the per-frame stepping while keys are held. */
  animate: () => void;
  /** The terrain point under a client position, for orbiting. */
  pick: (clientX: number, clientY: number) => [number, number, number] | null;
}

export function attachViewInput(element: HTMLElement, hooks: ViewInputHooks): void {
  const { camera } = hooks;
  element.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // NumLock off sends Home, arrows and Clear for the keypad; e.code still names the key.
    if (e.code === "Numpad5" || e.key === "Clear") { camera.level(); hooks.changed(); e.preventDefault(); return; }
    if (e.code === "Home" || (e.code === "Numpad7" && e.key === "Home")) { camera.home(); hooks.changed(); e.preventDefault(); return; }
    const key = KEYS[e.code];
    if (!key) return;
    e.preventDefault();
    if (!camera.keys[key]) {
      camera.keys[key] = true;
      hooks.animate();
    }
  });
  element.addEventListener("keyup", (e) => {
    const key = KEYS[e.code];
    if (!key) return;
    camera.release(key);
    hooks.changed();
  });
  element.addEventListener("blur", () => { camera.stop(); hooks.changed(); });

  element.addEventListener("wheel", (e) => {
    e.preventDefault();
    const step = -Math.sign(e.deltaY) * Math.min(400, Math.abs(e.deltaY)) * (e.shiftKey ? 4 : 1);
    if (e.ctrlKey) camera.move(0, 0, step / 4, hooks.groundAt);
    else camera.move(step, 0, 0, hooks.groundAt);
    hooks.changed();
  }, { passive: false });

  element.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.altKey) return;
    const pivot = hooks.pick(e.clientX, e.clientY);
    if (!pivot) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    element.focus();
    element.setPointerCapture(e.pointerId);
    let lx = e.clientX, ly = e.clientY;
    const move = (m: PointerEvent) => {
      camera.orbit(pivot, -(m.clientX - lx) * 4, (m.clientY - ly) * 4);
      lx = m.clientX; ly = m.clientY;
      hooks.changed();
    };
    const up = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
  });

  element.addEventListener("pointerdown", (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    element.focus();
    element.setPointerCapture(e.pointerId);
    let lx = e.clientX, ly = e.clientY;
    const pan = e.shiftKey;
    const move = (m: PointerEvent) => {
      const dx = m.clientX - lx, dy = m.clientY - ly;
      lx = m.clientX; ly = m.clientY;
      if (pan) camera.move(0, -dx * 4, dy * 2, hooks.groundAt);
      else camera.look(dx * 3, dy * 3);
      hooks.changed();
    };
    const up = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
  });
  // A middle click would otherwise start the browser's autoscroll.
  element.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
}
