/*
  Objects mode (EDIT_OBJECTS; Traxx/TraxxViewInteract.cpp, TraxxViewEdit.cpp, TraxxFrame.cpp):

    click            select the nearest object (within 128 pixels at 640 x 480)
    Ctrl+click/drag  add or remove one, or every object inside a box
    drag             move the selection on the ground; Shift+drag turns each one in place
    double-click     Properties
    keys             R / T turn, C D / V F move, X S raise, G B pitch, H N tilt, 1-6 size
                     (Shift faster, Ctrl+Shift finest; ObjectNudge.h), Tab next object,
                     Delete, Enter Properties
    right-click      the Object menu, with Set Type
*/
import type { ModeHandler, ViewPoint } from "../editor.ts";
import type { ModeContext } from "./context.ts";
import { CONTEXT_MENUS } from "../../ui/shell/commands.ts";
import { recordFields, type Recording } from "../../core/edit/record.ts";
import { applyModel, deleteObjects, dragObjects, dragRotate, insertObject, modelBaseZ, moveObjects, OBJECT_TYPE_NAMES, pasteObject, raiseObjects, rotateObjects, setTypeOfObjects, sizeObjects, tiltObjects, typeToIndex, budgetCap, unusedModels } from "../../core/edit/objects.ts";
import { insideRect, nearestOnScreen, OBJECT_LIMIT } from "../../core/view/screen-pick.ts";
import { objectMatrix } from "../../core/view/model-geometry.ts";
import { alertDialog, confirmDialog } from "../../ui/shell/dialog.ts";
import { ALTITUDE_SCALE } from "../../core/view/camera.ts";
import { OBJ_COL } from "../../core/settings.ts";
import { TRAXX_BOX_LIGHT, type TraxxBox, type TraxxLight } from "../../core/traxx/sit.ts";
import { applyObjectFields, objectFields, previewObject } from "../../core/edit/object-properties.ts";
import { groupPropertiesDialog, objectPropertiesDialog } from "../../ui/dialogs/object-dialogs.ts";
import { applyGroup, applyLook, groupStart } from "../../core/edit/group-properties.ts";
import { lightPoolLines } from "../../core/view/light-pool.ts";
import { arrowSegments, lightArrow } from "../../core/view/arrows.ts";
import { openDialog } from "../../ui/shell/dialog.ts";
import { el } from "../../shared/dom.ts";
import { devicePx } from "../../render/overlay.ts";

/* ObjectNudge.h: steps in thousandths of an ipos, hundredths of a step, hundredths of a degree. */
const nudgeMove = (shift: boolean, ctrl: boolean, sitUnits: boolean) => (shift && ctrl ? (sitUnits ? 200 : 100) : shift ? 100000 : 10000);
const nudgeRaise = (shift: boolean, ctrl: boolean) => (shift && ctrl ? 10 : shift ? 500 : 100);
const nudgeTurn = (shift: boolean, ctrl: boolean) => (shift && ctrl ? 1 : shift ? 1000 : ctrl ? 10 : 100);
const nudgeTilt = (shift: boolean, ctrl: boolean) => (shift && ctrl ? 1 : shift ? 10 : 100);
/* The size keys 1-6: Ctrl+Shift 25, Shift 10, plain 1 (OBJECTSIZE_*). */
const nudgeSize = (shift: boolean, ctrl: boolean) => (shift && ctrl ? 25 : shift ? 10 : 1);

export function objectsMode(ctx: ModeContext): ModeHandler {
  const { app, editor, view, registry } = ctx;
  const sel = editor.objects;
  let dragging: Recording | null = null;
  let lastX = 0;
  let collapseOnUp = false;
  let boxFrom: { x: number; y: number } | null = null;
  let boxTo: { x: number; y: number } | null = null;
  let menuPoint: [number, number, number] | null = null;

  const track = () => editor.doc!.track;
  const exists = (i: number) => i >= 0 && i < (editor.doc?.track.boxes.length ?? 0);
  const selected = () => sel.collect(exists);
  const boxes = () => selected().map((i) => track().boxes[i]);
  const touch = { objects: true };
  const fields = ["boxes"] as const;

  const screenPoints = () => track().boxes.map((b) => view.project(b.ipos[0] + b.fraction[0] / 256, b.ipos[1] + b.fraction[1] / 256, ALTITUDE_SCALE * (b.ipos[2] + b.fraction[2] / 256)));
  const nearest = (p: { x: number; y: number }) => nearestOnScreen(screenPoints(), p, OBJECT_LIMIT, view.size);
  const ground = (p: ViewPoint | null): [number, number, number] | null => {
    const hit = p ? view.pick(p.clientX, p.clientY) : null;
    return hit ? [Math.trunc(hit.point[0]), Math.trunc(hit.point[1]), Math.trunc(hit.point[2] / ALTITUDE_SCALE)] : null;
  };

  const edit = (label: string, change: () => unknown) => {
    if (!editor.doc) return;
    const rec = recordFields(track(), fields, label, touch);
    change();
    editor.commit(rec);
    editor.selectionChanged();
  };
  const nudge = (label: string, change: (b: TraxxBox[]) => void) => { if (selected().length) edit(label, () => change(boxes())); };

  /* Delete, asking first when there is more than one. */
  const remove = async () => {
    const list = selected();
    if (!list.length) return;
    if (list.length > 1 && !(await confirmDialog("Delete Objects", `Delete the ${list.length} selected objects?`, "Delete"))) return;
    edit(list.length > 1 ? `Delete ${list.length} Objects` : "Delete Object", () => { deleteObjects(track(), list); });
    sel.select(-1);
    sel.clear();
    editor.selectionChanged();
  };

  const insert = () => {
    const at = menuPoint ?? ground(editor.lastPoint);
    if (!at) return;
    if (track().boxes.length >= 4096) { void alertDialog("Insert", "Max. 4096 Objects!"); return; }
    let index: number | null = null;
    edit("Insert Object", () => { index = insertObject(track(), at); });
    sel.clear();
    sel.select(index ?? -1);
    editor.selectionChanged();
  };

  const copy = () => {
    const b = track().boxes[sel.anchor];
    if (!b) return;
    editor.clipboard.object = structuredClone(b);
    app.emit("commands", undefined);
  };
  const paste = (p: ViewPoint | null) => {
    const copyBox = editor.clipboard.object as TraxxBox | undefined;
    const at = menuPoint ?? ground(p);
    if (!copyBox || !at) return;
    let result: ReturnType<typeof pasteObject> = { index: null, refusal: null };
    edit("Paste Object", () => { result = pasteObject(track(), copyBox, at); });
    sel.clear();
    sel.select(result.index ?? -1);
    if (result.refusal) void alertDialog("Paste Object", result.refusal);
    editor.selectionChanged();
  };

  const setType = async (index: number) => {
    const list = selected();
    if (!list.length) return;
    let r: ReturnType<typeof setTypeOfObjects> | null = null;
    edit("Set Type", () => { r = setTypeOfObjects(track(), list, index); });
    const res = r as ReturnType<typeof setTypeOfObjects> | null;
    if (!res) return;
    sel.clear();
    sel.select(res.selection[0] ?? -1);
    sel.addAll(res.selection.slice(1), exists);
    editor.selectionChanged();
    if (res.refused) {
      await alertDialog("Set Type", res.group === 4
        ? `${res.refused} of the ${list.length} selected objects were left as they were: a track can have at most ${budgetCap(4)} Train and Moving objects between them.`
        : `${res.refused} of the ${list.length} selected objects were left as they were: a track can have at most ${budgetCap(res.group)} of type ${OBJECT_TYPE_NAMES[index]}.`);
    }
  };

  /* The Models window's Apply: the model onto every selected object. */
  editor.actions.applyModel = ((name: string) => {
    const geo = view.modelGeometry(name);
    if (!selected().length || !geo) return;
    const ups = function* () { for (let i = 2; i < geo.raw.length; i += 3) yield geo.raw[i]; };
    const title = name.toUpperCase().replace(/^MODELS\\/, "");
    nudge("Apply Model", (b) => applyModel(b, { title, keyframed: geo.frameNames.length > 0, baseZ: modelBaseZ(ups()) }));
  }) as (...args: never[]) => unknown;

  /* The light pool shown for a box while a dialog edits its light (SetLightPreview). */
  let lightPreview: { box: TraxxBox; light: TraxxLight; isLight: boolean } | null = null;

  const wavInput = el("input", { type: "file", accept: ".wav", hidden: true }) as HTMLInputElement;
  document.body.append(wavInput);
  const pickWav = () => new Promise<File | null>((resolve) => {
    wavInput.value = "";
    wavInput.onchange = () => resolve(wavInput.files?.[0] ?? null);
    wavInput.oncancel = () => resolve(null);
    wavInput.click();
  });

  /* A model of the track, from a list; resolves with its title, or null. */
  const chooseModel = async (title: string, message: string, names: string[]): Promise<string | null> => {
    if (!names.length) { await alertDialog(title, message); return null; }
    const list = el("select", { size: 12, class: "mod-files" }, ...names.map((n) => el("option", { value: n }, n))) as HTMLSelectElement;
    list.selectedIndex = 0;
    const r = await openDialog({ title, body: list, buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }] });
    return r === "ok" && list.value ? list.value.replace(/^MODELS\\/i, "").toUpperCase() : null;
  };

  /*
    OnObjectProperties: the dialog edits the anchor live; Cancel puts it back. The cab button
    picks a keyframed model the track holds (load it in the Models window first), and asks for
    a base as well when the object has none, as Traxx does.
  */
  const properties = async () => {
    const doc = editor.doc;
    const i = sel.anchor;
    if (!doc || !exists(i)) return;
    const t = doc.track;
    const box = t.boxes[i]!;
    const before = structuredClone(box);
    const rec = recordFields(t, ["boxes", "sounds"], "Object Properties", { objects: true });
    const geo = box.modelName ? view.modelGeometry(box.modelName) : null;
    const baseZ = geo ? modelBaseZ((function* () { for (let k = 2; k < geo.raw.length; k += 3) yield geo.raw[k]!; })()) : 0;
    const restFz = geo ? (-baseZ) >> 8 : 0;
    const resting = geo ? restFz + (-baseZ - 256 * restFz) / 256 : 0;
    let base = "";
    const refresh = () => { view.refresh({ objects: true }); editor.selectionChanged(); };
    const result = await objectPropertiesDialog({
      fields: objectFields(box),
      modelName: box.modelName ? `MODELS\\${box.modelName}` : "",
      crushName: box.crushName,
      sitUnits: app.settings.show_sit_units,
      restingHeight: resting,
      preview: (f) => { previewObject(box, t.heights, f); refresh(); },
      previewLight: (light, isLight) => { lightPreview = { box, light, isLight }; editor.selectionChanged(); },
      pickWav,
      chooseCab: async () => {
        const keyframed = t.models.filter((m) => (view.modelGeometry(m)?.frameNames.length ?? 0) > 0);
        const cab = await chooseModel("Select Top-Crush Cab (keyframed) Model", "The track holds no keyframed model.\n\nA top-crush cab has to be an animated (keyframed) BIN. Load one in the Models window first.", keyframed);
        if (cab && !box.modelName && !base) {
          await alertDialog("Top-Crush: base model", "Now choose the BASE model.\n\nA top-crush is two objects: this animated cab, and a static base drawn under it (the flattened remains). The track format cannot store one without the other, so both are required.");
          base = (await chooseModel("Select Top-Crush Base Model", "The track holds no other model.", t.models.filter((m) => !keyframed.includes(m)))) ?? "";
        }
        return cab;
      },
    });
    lightPreview = null;
    if (!result || !editor.canEdit) {
      Object.assign(box, before);
      refresh();
      return;
    }
    // The dialog's last preview is what is shown; start the real apply from the box as it was.
    Object.assign(box, structuredClone(before));
    box.crushName = result.crushName;
    if (base) box.modelName = base;
    const messages = applyObjectFields(t, i, result.fields, t.heights, result.wavs, before.heightAboveGround);
    if (box.type === 6) { sel.select(t.boxes.indexOf(box)); }
    editor.commit(rec);
    editor.selectionChanged();
    if (messages.length) await alertDialog("Object Properties", messages.join("\n\n"));
  };

  const can = () => editor.canEdit;
  const one = () => can() && sel.anchor >= 0 && exists(sel.anchor);
  registry.bind("ID_OBJECT_PROPERTIES", () => properties(), { enabled: () => sel.anchor >= 0 && exists(sel.anchor) });

  /* OnObjectGroupProperties: the look previews live; Cancel goes back; OK applies afresh. */
  registry.bind("ID_OBJECT_GROUPPROPERTIES", async () => {
    const list = selected();
    if (!editor.canEdit || !list.length) return;
    const t = track();
    const boxes = list.map((i) => t.boxes[i]!);
    const looks = boxes.map((b) => structuredClone(b));
    const restore = () => boxes.forEach((b, k) => Object.assign(b, structuredClone(looks[k]!)));
    const start = groupStart(boxes);
    const result = await groupPropertiesDialog(list.length, start, pickWav, (text) => {
      restore();
      for (const b of boxes) applyLook(b, text, start.text, t.heights);
      view.refresh({ objects: true });
      editor.selectionChanged();
    });
    restore();
    if (!result || !editor.canEdit) { view.refresh({ objects: true }); editor.selectionChanged(); return; }
    const rec = recordFields(t, ["boxes", "sounds"], "Group Properties", { objects: true });
    const out = applyGroup(t, list, result);
    editor.commit(rec);
    sel.clear();
    sel.select(out.selection[0] ?? -1);
    sel.addAll(out.selection.slice(1), exists);
    editor.selectionChanged();
    const notes = [...out.messages];
    if (out.refused) {
      const index = result.typeIndex;
      notes.unshift(out.group === 4
        ? `${out.refused} of the ${list.length} selected objects were left as they were: a track can have at most ${budgetCap(4)} Train and Moving objects between them.`
        : `${out.refused} of the ${list.length} selected objects were left as they were: a track can have at most ${budgetCap(out.group)} of type ${OBJECT_TYPE_NAMES[index]}.`);
    }
    if (notes.length) await alertDialog("Group Properties", notes.join("\n\n"));
  }, { enabled: () => can() && selected().length > 0 });
  registry.bind("ID_OBJECT_INSERT", insert, { enabled: can });
  registry.bind("ID_OBJECT_DELETE", remove, { enabled: one });
  registry.bind("ID_OBJECT_COPY", copy, { enabled: one });
  registry.bind("ID_OBJECT_PASTE", () => paste(editor.lastPoint), { enabled: () => can() && Boolean(editor.clipboard.object) });
  registry.bind("ID_OBJECT_PURGE", async () => {
    const doc = editor.doc;
    if (!doc) return;
    const frames = (n: string) => view.modelGeometry(n)?.frameNames ?? [];
    const unused = unusedModels(doc.track, frames);
    if (!unused.length) { await alertDialog("Purge Models", "There are no unused models."); return; }
    if (!(await confirmDialog("Purge Models", `There are ${unused.length} unused models.\nGo ahead and remove them?`, "Yes"))) return;
    const recs = [recordFields(doc.track, ["models"], "Purge Models", { models: true }), recordFields(doc, ["models"], "Purge Models", { models: true })];
    const gone = new Set(unused.map((m) => m.toUpperCase()));
    doc.track.models = doc.track.models.filter((m) => !gone.has(m.toUpperCase()));
    doc.models = doc.models.filter((m) => !gone.has(m.name.toUpperCase()));
    editor.commitAll("Purge Models", recs);
  }, { enabled: can });

  /* SortBoxes order, nearest last: Tab steps to the next nearer object, back to the farthest after the nearest. */
  const tabNext = () => {
    const order = view.objectsByDepth();
    if (!order.length) return;
    const at = order.indexOf(sel.anchor);
    const next = at < 0 || at === order.length - 1 ? order[0] : order[at + 1];
    sel.select(next);
    editor.selectionChanged();
  };

  return {
    deactivate() { boxFrom = boxTo = null; },
    down(p) {
      menuPoint = null;
      if (p.ctrl) { boxFrom = boxTo = { x: p.x, y: p.y }; collapseOnUp = false; return; }
      const hit = nearest(p);
      // A plain click on a member keeps the set (so it can be dragged); released without a drag it collapses.
      collapseOnUp = hit >= 0 && sel.active() && sel.has(hit);
      sel.select(hit);
      lastX = p.x;
      if (hit >= 0) dragging = recordFields(track(), fields, p.shift ? "Turn Objects" : "Move Objects", touch);
      editor.selectionChanged();
    },
    drag(p) {
      if (boxFrom) { boxTo = { x: p.x, y: p.y }; editor.selectionChanged(); return; }
      if (!dragging || sel.anchor < 0) return;
      // A drag, not a click: the set stays a set.
      collapseOnUp = false;
      if (p.shift) dragRotate(boxes(), p.x - lastX);
      else { const at = ground(p); if (at) dragObjects(track(), selected(), at); }
      lastX = p.x;
      editor.emit("changed", touch);
    },
    up(p) {
      if (boxFrom) {
        if (Math.abs(p.x - boxFrom.x) < 4 && Math.abs(p.y - boxFrom.y) < 4) sel.toggle(nearest(p), exists);
        else sel.addAll(insideRect(screenPoints(), boxFrom, { x: p.x, y: p.y }, view.size), exists);
        boxFrom = boxTo = null;
        editor.selectionChanged();
        return;
      }
      if (dragging) { editor.commit(dragging); dragging = null; }
      if (collapseOnUp && sel.active()) { sel.clear(); editor.selectionChanged(); }
      collapseOnUp = false;
    },
    dblclick(p) {
      sel.select(nearest(p));
      editor.selectionChanged();
      registry.exec("ID_OBJECT_PROPERTIES");
    },
    contextMenu(p) {
      menuPoint = ground(p);
      sel.select(nearest(p));
      editor.selectionChanged();
      const list = selected();
      const n = list.length;
      const types = list.map((i) => typeToIndex(track().boxes[i].type));
      const common = types.length && types.every((t) => t === types[0]) ? types[0] : -1;
      const items = CONTEXT_MENUS.Object.map((it) => (typeof it === "object" && "items" in it ? { label: n > 1 ? `Set &Type of ${n} Objects` : "Set &Type", items: it.items } : it));
      return {
        items,
        options: {
          labels: { ID_OBJECT_DELETE: n > 1 ? `Delete ${n} Objects` : "Delete", ID_OBJECT_GROUPPROPERTIES: n > 1 ? `Group &Properties of ${n} Objects...` : "Group &Properties..." },
          enabled: { ID_OBJECT_GROUPPROPERTIES: n > 1 && registry.isEnabled("ID_OBJECT_GROUPPROPERTIES") },
          slots: { types: OBJECT_TYPE_NAMES.map((label, i) => ({ label, checked: i === common, enabled: n > 0, run: () => void setType(i) })) },
        },
      };
    },
    keyDown(e) {
      if (e.altKey) return false;
      const shift = e.shiftKey, ctrl = e.ctrlKey || e.metaKey;
      // Ctrl alone on C and V is Copy and Paste, never a nudge.
      if (ctrl && !shift && (e.code === "KeyC" || e.code === "KeyV")) return false;
      const sit = app.settings.show_sit_units;
      const heights = () => track().heights;
      switch (e.code) {
        case "KeyR": nudge("Turn", (b) => rotateObjects(b, nudgeTurn(shift, ctrl))); return true;
        case "KeyT": nudge("Turn", (b) => rotateObjects(b, -nudgeTurn(shift, ctrl))); return true;
        case "KeyC": nudge("Move", (b) => moveObjects(b, heights(), -nudgeMove(shift, ctrl, sit), 0)); return true;
        case "KeyD": nudge("Move", (b) => moveObjects(b, heights(), nudgeMove(shift, ctrl, sit), 0)); return true;
        case "KeyV": nudge("Move", (b) => moveObjects(b, heights(), 0, -nudgeMove(shift, ctrl, sit))); return true;
        case "KeyF": nudge("Move", (b) => moveObjects(b, heights(), 0, nudgeMove(shift, ctrl, sit))); return true;
        case "KeyS": case "BracketRight": nudge("Raise", (b) => raiseObjects(b, heights(), nudgeRaise(shift, ctrl))); return true;
        case "KeyX": case "BracketLeft": nudge("Lower", (b) => raiseObjects(b, heights(), -nudgeRaise(shift, ctrl))); return true;
        case "KeyG": nudge("Tilt", (b) => tiltObjects(b, nudgeTilt(shift, ctrl), 0)); return true;
        case "KeyB": nudge("Tilt", (b) => tiltObjects(b, -nudgeTilt(shift, ctrl), 0)); return true;
        case "KeyH": nudge("Tilt", (b) => tiltObjects(b, 0, nudgeTilt(shift, ctrl))); return true;
        case "KeyN": nudge("Tilt", (b) => tiltObjects(b, 0, -nudgeTilt(shift, ctrl))); return true;
        case "Digit1": nudge("Size", (b) => sizeObjects(b, nudgeSize(shift, ctrl), 0, 0)); return true;
        case "Digit2": nudge("Size", (b) => sizeObjects(b, -nudgeSize(shift, ctrl), 0, 0)); return true;
        case "Digit3": nudge("Size", (b) => sizeObjects(b, 0, nudgeSize(shift, ctrl), 0)); return true;
        case "Digit4": nudge("Size", (b) => sizeObjects(b, 0, -nudgeSize(shift, ctrl), 0)); return true;
        case "Digit5": nudge("Size", (b) => sizeObjects(b, 0, 0, nudgeSize(shift, ctrl))); return true;
        case "Digit6": nudge("Size", (b) => sizeObjects(b, 0, 0, -nudgeSize(shift, ctrl))); return true;
        case "Tab": tabNext(); return true;
      }
      return false;
    },
    keyUp(e) {
      if (e.code === "Delete") { void remove(); return true; }
      if (e.code === "Enter" || e.code === "NumpadEnter") { registry.exec("ID_OBJECT_PROPERTIES"); return true; }
      return false;
    },
    copy,
    paste,
    canCopy: () => sel.anchor >= 0,
    canPaste: () => Boolean(editor.clipboard.object),
    drawOverlay(g, project) {
      const doc = editor.doc;
      if (!doc) return;
      g.strokeStyle = app.settings.colors[OBJ_COL];
      g.lineWidth = devicePx(g, 1);
      for (const i of selected()) outlineObject(g, project, doc.track.boxes[i], (n) => view.modelGeometry(n));
      // OverlayLightPool for the anchor: its light, or the one a dialog is previewing.
      const anchor = exists(sel.anchor) ? doc.track.boxes[sel.anchor]! : null;
      if (anchor) {
        const preview = lightPreview?.box === anchor ? lightPreview : null;
        const isLight = preview ? preview.isLight : anchor.type === TRAXX_BOX_LIGHT;
        if (isLight) {
          g.save();
          g.strokeStyle = "#00ffff";
          for (const [a, b] of lightPoolLines(anchor, preview?.light ?? anchor.light, doc.track.heights)) {
            const p = project(a![0], a![1], a![2]), q = project(b![0], b![1], b![2]);
            if (p && q) { g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); }
          }
          // OverlayLightDirection: the cone's aim, yellow.
          const arrow = lightArrow(preview?.light ?? anchor.light);
          if (arrow) {
            g.strokeStyle = "#ffff00";
            for (const [a, b] of arrowSegments(arrow, objectMatrix(anchor))) {
              const p = project(a[0], a[1], a[2]), q = project(b[0], b[1], b[2]);
              if (p && q) { g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); }
            }
          }
          g.restore();
        }
      }
      if (boxFrom && boxTo) g.strokeRect(Math.min(boxFrom.x, boxTo.x), Math.min(boxFrom.y, boxTo.y), Math.abs(boxTo.x - boxFrom.x), Math.abs(boxTo.y - boxFrom.y));
    },
    selectionText() {
      const list = selected();
      if (!list.length) return "";
      const b = track().boxes[list[0]];
      const name = b.modelName || OBJECT_TYPE_NAMES[typeToIndex(b.type)];
      return list.length > 1 ? `${list.length} objects` : `#${list[0]} ${name}`;
    },
  };
}

/* One object's outline: its model's faces, or the box's twelve edges (OverlayOneObject). */
function outlineObject(g: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => { x: number; y: number } | null, box: TraxxBox, geometryOf: (name: string) => { outlines: Float32Array } | null): void {
  const m = objectMatrix(box);
  const at = (x: number, y: number, z: number) => project(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
  const segment = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) => { if (a && b) { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); } };
  const geo = box.modelName ? geometryOf(box.modelName) : null;
  if (geo && geo.outlines.length) {
    const o = geo.outlines;
    for (let k = 0; k + 5 < o.length; k += 6) segment(at(o[k], o[k + 1], o[k + 2]), at(o[k + 3], o[k + 4], o[k + 5]));
    return;
  }
  const w = box.width, l = box.length, h = box.height;
  const c = [[-w, -l, -h], [-w, l, -h], [w, l, -h], [w, -l, -h], [-w, -l, h], [-w, l, h], [w, l, h], [w, -l, h]].map(([x, y, z]) => at(x, y, z));
  for (let k = 0; k < 4; k++) { segment(c[k], c[(k + 1) % 4]); segment(c[k + 4], c[((k + 1) % 4) + 4]); segment(c[k], c[k + 4]); }
}
