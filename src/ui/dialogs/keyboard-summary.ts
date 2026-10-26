/*
  Help > Keyboard Summary (IDD_KBDHELP): Traxx's keyboard picture and its notes, then what
  JSTraxx adds - the mouse in the 3D view, and the accelerators as this build has them.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import { ACCELERATORS, type CommandRegistry } from "../shell/commands.ts";

export async function keyboardSummary(registry: CommandRegistry): Promise<void> {
  const notes = (title: string, lines: string[]) => el("div", { class: "kbd-notes" }, el("strong", {}, title), ...lines.map((l) => el("p", {}, l)));
  const accel = Object.entries(ACCELERATORS).map(([key, id]) => el("tr", {}, el("th", {}, key), el("td", {}, (registry.get(id)?.label ?? id).replace(/&/g, ""))));
  await openDialog({
    title: "Keyboard Summary",
    className: "kbd-dialog",
    body: el("div", { class: "kbd" },
      el("img", { src: `${import.meta.env.BASE_URL}ui/keyboard.bmp`, alt: "The keyboard as Traxx uses it", class: "kbd-image" }),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "Selecting several, and the finest steps"),
        el("div", { class: "obj-two" },
          notes("Objects", [
            "Ctrl+click adds or removes an object; Ctrl+drag draws a box that adds every object inside.",
            "Drag any selected object to move the whole group.",
            "Move, raise, turn, tilt and size keys act on every selected object, each in its own place.",
            "Delete removes them all (it asks first). Right-click > Set Type changes them all.",
            "A model picked in the Models window goes onto all of them.",
          ]),
          notes("Textures", [
            "Drag across the texture window to select a box of textures; Shift+drag adds more, Shift+click adds or removes one. Type and grip depth then change for all of them. The wheel scrolls it.",
          ]),
          notes("Object Properties", [
            "Every object key above also works while Object Properties is open.",
            "Ctrl+Shift with any of them is one click of that window's arrows: 0.1 of a unit, 0.01 of a degree.",
          ]))),
      el("fieldset", { class: "opt-group" }, el("legend", {}, "In JSTraxx"),
        el("div", { class: "obj-two" },
          notes("Mouse in the 3D view", [
            "Middle drag looks around; Shift+middle drag pans.",
            "The wheel moves forward and back.",
            "Alt+left drag orbits around the point under the pointer.",
            "Right-click opens the mode's menu, as in Traxx.",
          ]),
          notes("Keys", [
            "Cmd works as Ctrl on a Mac.",
            "Ctrl+Y and Ctrl+Shift+Z redo; undo covers every mode.",
            "Browsers keep Ctrl+N and Ctrl+W for themselves unless JSTraxx is installed as an app; use the menu.",
          ]),
          el("table", { class: "stats" }, ...accel)))),
  });
}
