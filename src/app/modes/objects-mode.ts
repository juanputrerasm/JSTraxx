/*
  Objects mode (EDIT_OBJECTS; Traxx/TraxxViewInteract.cpp, TraxxViewEdit.cpp, TraxxFrame.cpp):

    click            select the object under the click by its outline (Traxx 1.8.2), else the
                     nearest base (within 128 pixels at 640 x 480; Traditional Traxx clicking)
    Ctrl+click/drag  add or remove one, or every object inside a box
    drag             move the selection on the ground; Shift+drag turns each one in place
    double-click     Properties
    keys             R / T turn, C D / V F move, X S raise, G B pitch, H N tilt, 1-6 size
                     (Shift faster, Ctrl+Shift finest; ObjectNudge.h), Tab next object,
                     Delete, Enter Properties
    right-click      the Object menu, with Set Type
*/
import { FILE_NEW_V6_IDS } from "../../core/traxx/track-kind-ui.ts";
import type { ModeHandler, ViewPoint } from "../editor.ts";
import type { ModeContext } from "./context.ts";
import { CONTEXT_MENUS } from "../../ui/shell/commands.ts";
import { recordFields, type Recording } from "../../core/edit/record.ts";
import { applyModel, deleteObjects, dragObjects, dragRotate, insertObject, modelBaseZ, moveObjects, objectHeightCap, OBJECT_TYPE_NAMES, pasteObject, raiseObjects, rotateObjects, setTypeOfObjects, sizeObjects, tiltObjects, typeToIndex, budgetCap, unusedModels } from "../../core/edit/objects.ts";
import { objectLimit } from "../../core/traxx/v6.ts";
import { insideRect, nearestOnScreen, OBJECT_LIMIT } from "../../core/view/screen-pick.ts";
import { objectMatrix } from "../../core/view/model-geometry.ts";
import { alertDialog, confirmDialog } from "../../ui/shell/dialog.ts";
import { ALTITUDE_SCALE } from "../../core/view/camera.ts";
import { OBJ_COL } from "../../core/settings.ts";
import { TRAXX_BOX_FOG, TRAXX_BOX_LIGHT, TRAXX_BOX_RAMP, type TraxxBox, type TraxxLight } from "../../core/traxx/sit.ts";
import { lightGuideContext } from "../../core/traxx/light-props.ts";
import { applyObjectFields, objectFields, previewObject } from "../../core/edit/object-properties.ts";
import { objectRaceContext } from "../../core/edit/race-edit.ts";
import { groupPropertiesDialog, objectPropertiesWindow, type ObjectPropertiesWindow } from "../../ui/dialogs/object-dialogs.ts";
import { takeViewFocusOnEnter } from "../../ui/input/view-focus.ts";
import { applyGroup, groupStart, previewGroup } from "../../core/edit/group-properties.ts";
import { LIGHTCORE_COLOUR, lightPoolDrawing } from "../../core/view/light-pool.ts";
import { cellsOf } from "../../core/traxx/world.ts";
import { copyForClipboard } from "../../core/traxx/box-ground.ts";

/** A ground point picked in the view: whole ipos / steps and the 1/256 left over. */
interface Spot { at: [number, number, number]; fraction: [number, number, number] }
import { effectiveFog, fogShapeLines, fogVolumeCentre, fogVolumeCorners, fogVolumeRing, type FogPreview } from "../../core/view/fog-volume.ts";
import { pickCandidateOf, pickChooseWinner, pickLocalCorners, pickModelBounds, pickResolve, PICK_MIN_DEPTH, type PickCandidate } from "../../core/view/object-pick-hull.ts";
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
  let menuPoint: Spot | null = null;

  const track = () => editor.doc!.track;
  /** 4096, or 16,384 on a version 6 track (spec 14). */
  const objectMax = () => objectLimit(editor.doc!.track);
  const exists = (i: number) => i >= 0 && i < (editor.doc?.track.boxes.length ?? 0);
  const selected = () => sel.collect(exists);
  const boxes = () => selected().map((i) => track().boxes[i]);
  const touch = { objects: true };
  const fields = ["boxes"] as const;

  // A Fog is picked at the middle of its volume, not at its origin (SelectNearestObject).
  const screenPoints = () => track().boxes.map((b) => {
    const { fog, isFog } = effectiveFog(b, fogPreview);
    const mid = isFog ? fogVolumeCentre(b, fog) : null;
    return mid ? view.project(mid[0], mid[1], mid[2]) : view.project(b.ipos[0] + b.fraction[0] / 256, b.ipos[1] + b.fraction[1] / 256, ALTITUDE_SCALE * (b.ipos[2] + b.fraction[2] / 256));
  });
  /*
    SelectObjectByOutline (Traxx 1.8.2, 2031ec1; TraxxViewDisplay.cpp): the object whose projected
    bounding box holds the click. A model box is bounded by its model's vertices, a model-less one
    by +-width / length / height, both through the object's matrix; a Fog by its world volume. Not
    a candidate: a corner behind the camera or at depth <= 10 (Traxx's units, 64 to a scene unit),
    or a collider hidden by Hide Collider Boxes. The front-most face at the click wins, a Fog only
    when nothing solid is hit. World-wrap border copies are not outline-pickable.
  */
  const outlinePick = (p: { x: number; y: number }): { winner: number; isFog: boolean } => {
    const px = Math.round(p.x), py = Math.round(p.y);
    const proj = (x: number, y: number, z: number) => {
      const q = view.projectDepth(x, y, z);
      return q ? { x: Math.round(q.x), y: Math.round(q.y), depth: Math.trunc(q.depth * 64) } : null;
    };
    const cands: PickCandidate[] = track().boxes.map((box) => {
      const none: PickCandidate = { hit: false, depth: 0, isFog: false };
      const geo = box.modelName ? view.modelGeometry(box.modelName) : null;
      const bounds = geo ? pickModelBounds(geo.vertices) : null;
      let corners: ({ x: number; y: number; depth: number } | null)[];
      let isFog = false;
      if (!bounds && box.type === TRAXX_BOX_FOG) {
        const { fog, isFog: fogOn } = effectiveFog(box, fogPreview);
        const fc = fogOn ? fogVolumeCorners(box, fog) : null;
        if (!fc) return none;
        isFog = true;
        corners = fc.map(([x, y, z]) => proj(x, y, z));
      } else {
        if (!bounds && app.settings.hide_colliders && box.type !== TRAXX_BOX_RAMP) return none;
        // CalculateBoxLocationsOpenGL < 10: the camera is at the box itself.
        const m = objectMatrix(box);
        const at = proj(m[12]!, m[13]!, m[14]!);
        if (!at || at.depth < PICK_MIN_DEPTH) return none;
        const lo = bounds ? bounds.lo : [-box.width, -box.length, -box.height];
        const hi = bounds ? bounds.hi : [box.width, box.length, box.height];
        corners = pickLocalCorners(lo, hi).map(([x, y, z]) => proj(
          m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!));
      }
      return pickCandidateOf(corners, px, py, isFog) ?? none;
    });
    const winner = pickChooseWinner(cands);
    return { winner, isFog: winner >= 0 && cands[winner]!.isFog };
  };
  /*
    SelectNearestObject (TraxxViewInteract.cpp): the outline pick unless Options > Advanced >
    Traditional Traxx clicking is on; a click inside no outline (or on a Fog) falls through to the
    nearest-base rule (Manhattan, within 128 pixels), which keeps tiny far objects easy to hit
    (PickResolve). Click, double-click, Ctrl+click and the right-click target all come here.
  */
  const nearest = (p: { x: number; y: number }) => {
    let pick = { winner: -1, isFog: false };
    if (!app.settings.traditional_clicking) {
      pick = outlinePick(p);
      if (pick.winner >= 0 && !pick.isFog) return pick.winner;
    }
    return pickResolve(pick.winner, pick.isFog, nearestOnScreen(screenPoints(), p, OBJECT_LIMIT, view.size));
  };
  /*
    The ground under a point as ScreenToTerrainPoint gives it: whole ipos and steps, and the
    1/256 fractions (0 on Classic 8-bit; the drive surface's own elsewhere, Traxx 1.7).
  */
  const ground = (p: ViewPoint | null): Spot | null => {
    const hit = p ? view.pick(p.clientX, p.clientY) : null;
    return hit ? { at: [...hit.ipos], fraction: [...hit.fraction] } : null;
  };

  const edit = (label: string, change: () => unknown) => {
    if (!editor.doc) return;
    const rec = recordFields(track(), fields, label, touch);
    change();
    editor.commit(rec);
    editor.selectionChanged();
  };
  // The nudge keys: with the Object Properties window open they move its object and its fields follow.
  const nudge = (label: string, change: (b: TraxxBox[]) => void) => { if (selected().length) { edit(label, () => change(boxes())); followWindow(); } };

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
    const spot = menuPoint ?? ground(editor.lastPoint);
    if (!spot) return;
    const max = objectMax();
    if (track().boxes.length >= max) { void alertDialog("Insert", `Max. ${max} Objects!`); return; }
    let index: number | null = null;
    edit("Insert Object", () => { index = insertObject(track(), spot.at, spot.fraction, max); });
    sel.clear();
    sel.select(index ?? -1);
    editor.selectionChanged();
  };

  const copy = () => {
    const b = track().boxes[sel.anchor];
    if (!b) return;
    // OnObjectCopy: on the drive surface the clipboard keeps the height pair (copyForClipboard).
    editor.clipboard.object = copyForClipboard(track(), b);
    app.emit("commands", undefined);
  };
  const paste = (p: ViewPoint | null) => {
    if (objWin) return;
    const copyBox = editor.clipboard.object as TraxxBox | undefined;
    const spot = menuPoint ?? ground(p);
    if (!copyBox || !spot) return;
    let result: ReturnType<typeof pasteObject> = { index: null, refusal: null };
    edit("Paste Object", () => { result = pasteObject(track(), copyBox, spot.at, spot.fraction, objectMax()); });
    sel.clear();
    sel.select(result.index ?? -1);
    if (result.refusal) void alertDialog("Paste Object", result.refusal);
    editor.selectionChanged();
  };

  const setType = async (index: number) => {
    const list = selected();
    if (!list.length || objWin) return;
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
    nudge("Apply Model", (b) => applyModel(b, { title, keyframed: geo.frameNames.length > 0, baseZ: modelBaseZ(ups()) }, track()));
    // An Object Properties window open on that object shows its new model and height.
    followWindow();
  }) as (...args: never[]) => unknown;

  /* The light pool shown for a box while a dialog edits its light (SetLightPreview). */
  let lightPreview: { box: TraxxBox; light: TraxxLight; isLight: boolean } | null = null;
  /* The fog volume shown for a box while a dialog edits its fog (SetFogPreview). */
  let fogPreview: FogPreview | null = null;
  const setFogPreview = (p: FogPreview | null) => { fogPreview = p; view.setFogPreview(p); editor.selectionChanged(); };

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
    OnObjectProperties (Traxx 1.8.2, 75cf23a, 90a876c; TraxxViewEdit.cpp OnObjectProperties ..
    ObjectDialogRefresh): a MODELESS window, one at a time, bound to its box by identity (a
    checkpoint renumber moves boxes between slots, so the slot is looked up when needed). It opens
    beside the view; a second request brings it forward; a multiselection ends here. While it is
    up the view reaches no other object (select, Ctrl+click, box select, Tab, Delete, Insert,
    Paste, Set Type and Group Properties are off; Copy works; Edit > Undo is greyed); its drag,
    turn and nudge keys move this one and the fields follow. Apply commits an undo step (the
    object from the last load, then every field, as OK always did); Cancel puts the live place,
    angles and size back. The cab button picks a keyframed model the track holds (load it in the
    Models window first), and asks for a base as well when the object has none, as Traxx does.
  */
  let objWin: { box: TraxxBox; win: ObjectPropertiesWindow; loaded: TraxxBox; dropFocus: () => void } | null = null;
  /** ObjectDialogIndex: the window's box's slot, or -1 when it is gone. */
  const winIndex = () => (objWin && editor.doc ? editor.doc.track.boxes.indexOf(objWin.box) : -1);
  /* Reset's resting height: the model's basez as a height above ground. */
  const restingOf = (box: TraxxBox) => {
    const geo = box.modelName ? view.modelGeometry(box.modelName) : null;
    const baseZ = geo ? modelBaseZ((function* () { for (let k = 2; k < geo.raw.length; k += 3) yield geo.raw[k]!; })()) : 0;
    const restFz = geo ? (-baseZ) >> 8 : 0;
    return geo ? restFz + (-baseZ - 256 * restFz) / 256 : 0;
  };
  /** ObjectDialogRefresh: the view moved the window's object; its fields follow (and Cancel goes back to here). */
  const followWindow = () => {
    if (!objWin || !editor.doc) return;
    if (winIndex() < 0) { objWin.win.abandon(); return; }
    const box = objWin.box;
    objWin.loaded = structuredClone(box);
    objWin.win.refreshFromBox(objectFields(box, editor.doc.track), box.modelName ? `MODELS\\${box.modelName}` : "", box.crushName, restingOf(box));
  };

  const properties = () => {
    // One at a time: a second request brings the open window forward.
    if (objWin) { objWin.win.raise(); return; }
    const doc = editor.doc;
    const i = sel.anchor;
    if (!doc || !exists(i)) return;
    // Only this object is reachable from the view while the window is open: a multiselection ends here.
    sel.clear();
    sel.select(i);
    boxFrom = boxTo = null;
    editor.selectionChanged();
    const t = doc.track;
    const box = t.boxes[i]!;
    let base = "";
    const refresh = () => { view.refresh({ objects: true }); editor.selectionChanged(); };
    const host = view.viewport.canvas.parentElement ?? view.viewport.canvas;
    const state = {
      box, loaded: structuredClone(box),
      // TakeViewFocus: the pointer over the view at open (the double-click, Enter or right-click was there) hands it the keys.
      dropFocus: takeViewFocusOnEnter(host, host.matches(":hover")),
    } as { box: TraxxBox; win: ObjectPropertiesWindow; loaded: TraxxBox; dropFocus: () => void };
    objWin = state;
    state.win = objectPropertiesWindow({
      fields: objectFields(box, t, t.raceRules.mode),
      modelName: box.modelName ? `MODELS\\${box.modelName}` : "",
      crushName: box.crushName,
      sitUnits: app.settings.show_sit_units,
      restingHeight: restingOf(box),
      preview: (f) => { if (winIndex() >= 0) { previewObject(box, t, f); refresh(); } },
      previewLight: (light, isLight) => { lightPreview = { box, light, isLight }; view.setLightPreview(lightPreview); editor.selectionChanged(); },
      lightContext: lightGuideContext(t),
      previewFog: (fog, isFog) => setFogPreview({ box, fog, isFog }),
      fogBox: () => box,
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
      // ObjectDialogContext: the rules, the other checkpoints' numbers, the Main route tick.
      raceContext: () => objectRaceContext(t.boxes, t.raceRules.mode, box),
    }, {
      // ObjectDialogApply / ApplyObjectProperties.
      apply: async (result) => {
        const index = t.boxes.indexOf(box);
        if (index < 0 || editor.doc?.track !== t) return null;
        if (!editor.canEdit) return objectFields(box, t, t.raceRules.mode);
        // The live preview is what is shown; the apply starts from the box as it was last loaded.
        Object.assign(box, structuredClone(state.loaded));
        const rec = recordFields(t, ["boxes", "sounds"], "Object Properties", { objects: true });
        box.crushName = result.crushName;
        if (base) box.modelName = base;
        base = "";
        const messages = applyObjectFields(t, index, result.fields, t, result.wavs, state.loaded.heightAboveGround);
        editor.commit(rec);
        // ...which may have moved the box to another slot (a checkpoint renumber).
        const now = t.boxes.indexOf(box);
        if (now < 0) return null;
        sel.select(now);
        state.loaded = structuredClone(box);
        editor.selectionChanged();
        if (messages.length) await alertDialog("Object Properties", messages.join("\n\n"));
        return objectFields(box, t, t.raceRules.mode);
      },
      restore: () => { if (t.boxes.includes(box)) { Object.assign(box, structuredClone(state.loaded)); refresh(); } },
      closed: () => {
        state.dropFocus();
        if (objWin === state) objWin = null;
        editor.modeless = null;
        lightPreview = null;
        view.setLightPreview(null);
        setFogPreview(null);
        refresh();
        app.emit("commands", undefined);
      },
    });
    editor.modeless = { close: (ok, modeSwitch) => state.win.close(ok, modeSwitch) };
    app.emit("commands", undefined);
  };
  /* TX_EDITMODE, Track Components: the window keeps its edit (it closes as OK); refused, it is cancelled instead. */
  const closeWindowForSwitch = async () => {
    if (objWin && !(await objWin.win.close(true, true))) await objWin?.win.close(false);
  };
  // CTraxxDoc's view loop: New, Open, Close, Save, Write POD... close the window as OK first; a refused Apply aborts them.
  registry.guard(["ID_FILE_NEW", "ID_FILE_NEW_CLASSIC16", "ID_FILE_NEW_SPLINE", "ID_FILE_NEW_FINE", ...FILE_NEW_V6_IDS, "ID_FILE_OPEN", "ID_FILE_SAVE",
    "ID_FILE_SAVE_AS", "ID_FILE_CLOSE", "ID_FILE_VIEWPOD", "ID_FILE_CLONE", "ID_FILE_EDITTRACK", "ID_FILE_WRITEPOD", "ID_FILE_DOWNLOAD",
    // OnSpecialEnlargeWorld: the window holds a copy of the 256 world, so it closes as OK first (ObjectDialogClose).
    "ID_SPECIAL_ENLARGEWORLD"],
  async () => (objWin ? objWin.win.close(true) : true));
  registry.guard(["ID_VIEW_COMPONENTS"], async () => { await closeWindowForSwitch(); return true; });
  // The document is closed or replaced: the window goes without a word; its object deleted some other way, the same (ObjectDialogCheck).
  ctx.docs.on("opened", () => objWin?.win.abandon());
  editor.on("changed", () => { if (objWin && winIndex() < 0) objWin.win.abandon(); });

  const can = () => editor.canEdit;
  /* While the Object Properties window is up only its object is reachable (Copy Object still works). */
  const free = () => can() && !objWin;
  const one = () => can() && sel.anchor >= 0 && exists(sel.anchor);
  registry.bind("ID_OBJECT_PROPERTIES", () => properties(), { enabled: () => sel.anchor >= 0 && exists(sel.anchor) });

  /* OnObjectGroupProperties: the look previews live; Cancel goes back; OK applies afresh. */
  registry.bind("ID_OBJECT_GROUPPROPERTIES", async () => {
    const list = selected();
    if (!editor.canEdit || objWin || !list.length) return;
    const t = track();
    const boxes = list.map((i) => t.boxes[i]!);
    const looks = boxes.map((b) => structuredClone(b));
    const restore = () => boxes.forEach((b, k) => Object.assign(b, structuredClone(looks[k]!)));
    const start = groupStart(boxes, t);
    // PreviewGroupProperties: RestoreGroupLook, the per-box look, then (Traxx 1.8.2) the rigid move.
    const result = await groupPropertiesDialog(list.length, start, pickWav, (text, asOne) => {
      restore();
      previewGroup(boxes, text, start.text, t, asOne);
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
  }, { enabled: () => free() && selected().length > 0 });
  registry.bind("ID_OBJECT_INSERT", insert, { enabled: free });
  registry.bind("ID_OBJECT_DELETE", remove, { enabled: () => free() && one() });
  registry.bind("ID_OBJECT_COPY", copy, { enabled: one });
  registry.bind("ID_OBJECT_PASTE", () => paste(editor.lastPoint), { enabled: () => free() && Boolean(editor.clipboard.object) });
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
    if (objWin) return;   // only the object in the window can be reached
    const order = view.objectsByDepth();
    if (!order.length) return;
    const at = order.indexOf(sel.anchor);
    const next = at < 0 || at === order.length - 1 ? order[0] : order[at + 1];
    sel.select(next);
    editor.selectionChanged();
  };

  return {
    deactivate() { boxFrom = boxTo = null; void closeWindowForSwitch(); },
    down(p) {
      menuPoint = null;
      /*
        With the Object Properties window open only ITS object can be reached: a click on it may
        start a drag; a click anywhere else, or a Ctrl+click (which would select), does nothing.
      */
      if (objWin) {
        const hit = p.ctrl ? -1 : nearest(p);
        collapseOnUp = false;
        if (hit >= 0 && hit === winIndex()) {
          lastX = p.x;
          dragging = recordFields(track(), fields, p.shift ? "Turn Objects" : "Move Objects", touch);
        }
        return;
      }
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
      else { const spot = ground(p); if (spot) dragObjects(track(), selected(), spot.at, spot.fraction); }
      lastX = p.x;
      editor.emit("changed", touch);
      followWindow();
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
      // The window is open already: it comes forward; nothing is picked.
      if (objWin) { properties(); return; }
      sel.select(nearest(p));
      editor.selectionChanged();
      registry.exec("ID_OBJECT_PROPERTIES");
    },
    contextMenu(p) {
      menuPoint = ground(p);
      // With the Object Properties window open the menu acts on ITS object: nothing new is picked.
      if (!objWin) sel.select(nearest(p));
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
          // The window being open, the rest of the menu is off (Set Type too); Copy Object works.
          enabled: (objWin
            ? { ID_OBJECT_GROUPPROPERTIES: false, ID_OBJECT_INSERT: false, ID_OBJECT_DELETE: false, ID_OBJECT_PROPERTIES: false, ID_OBJECT_PASTE: false }
            : { ID_OBJECT_GROUPPROPERTIES: n > 1 && registry.isEnabled("ID_OBJECT_GROUPPROPERTIES") }) as Record<string, boolean>,
          slots: { types: OBJECT_TYPE_NAMES.map((label, i) => ({ label, checked: i === common, enabled: n > 0 && !objWin, run: () => void setType(i) })) },
        },
      };
    },
    keyDown(e) {
      if (e.altKey) return false;
      const shift = e.shiftKey, ctrl = e.ctrlKey || e.metaKey;
      // Ctrl alone on C and V is Copy and Paste, never a nudge.
      if (ctrl && !shift && (e.code === "KeyC" || e.code === "KeyV")) return false;
      const sit = app.settings.show_sit_units;
      const heights = () => track();
      switch (e.code) {
        case "KeyR": nudge("Turn", (b) => rotateObjects(b, nudgeTurn(shift, ctrl))); return true;
        case "KeyT": nudge("Turn", (b) => rotateObjects(b, -nudgeTurn(shift, ctrl))); return true;
        case "KeyC": nudge("Move", (b) => moveObjects(b, heights(), -nudgeMove(shift, ctrl, sit), 0)); return true;
        case "KeyD": nudge("Move", (b) => moveObjects(b, heights(), nudgeMove(shift, ctrl, sit), 0)); return true;
        case "KeyV": nudge("Move", (b) => moveObjects(b, heights(), 0, -nudgeMove(shift, ctrl, sit))); return true;
        case "KeyF": nudge("Move", (b) => moveObjects(b, heights(), 0, nudgeMove(shift, ctrl, sit))); return true;
        // ObjectRaise: capped at ObjectHeightCap (500 steps, or the ceiling on a Tall Heights V6 track).
        case "KeyS": case "BracketRight": nudge("Raise", (b) => raiseObjects(b, heights(), nudgeRaise(shift, ctrl), objectHeightCap(track()))); return true;
        case "KeyX": case "BracketLeft": nudge("Lower", (b) => raiseObjects(b, heights(), -nudgeRaise(shift, ctrl), objectHeightCap(track()))); return true;
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
      if (e.code === "Delete") { if (!objWin) void remove(); return true; }
      if (e.code === "Enter" || e.code === "NumpadEnter") { registry.exec("ID_OBJECT_PROPERTIES"); return true; }
      return false;
    },
    copy,
    paste,
    canCopy: () => sel.anchor >= 0,
    canPaste: () => !objWin && Boolean(editor.clipboard.object),
    drawOverlay(g, project) {
      const doc = editor.doc;
      if (!doc) return;
      g.strokeStyle = app.settings.colors[OBJ_COL];
      g.lineWidth = devicePx(g, 1);
      for (const i of selected()) {
        const box = doc.track.boxes[i]!;
        // A Fog's outline and FOG label are on its volume, the box outline skipped (OverlayFogOutline).
        if (box.type === TRAXX_BOX_FOG) { outlineFog(g, project, box, fogPreview); continue; }
        outlineObject(g, project, box, (n) => view.modelGeometry(n));
      }
      // OverlayLightPool for the anchor: its light, or the one a dialog is previewing.
      const anchor = exists(sel.anchor) ? doc.track.boxes[sel.anchor]! : null;
      if (anchor) {
        const preview = lightPreview?.box === anchor ? lightPreview : null;
        const isLight = preview ? preview.isLight : anchor.type === TRAXX_BOX_LIGHT;
        if (isLight) {
          g.save();
          // Traxx 1.8.0: the engine's ring (dim without a pool weather), the light guide and its words.
          const pool = lightPoolDrawing(anchor, preview?.light ?? anchor.light, doc.track, { boxes: doc.track.groundBoxes, cells: cellsOf(doc.track) },
            lightGuideContext(doc.track), { show: app.settings.show_light_core, weather: app.settings.preview_weather });
          const stroke = (list: [number, number, number][][], colour: string) => {
            g.strokeStyle = colour;
            for (const [a, b] of list) {
              const p = project(a![0], a![1], a![2]), q = project(b![0], b![1], b![2]);
              if (p && q) { g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); }
            }
          };
          stroke(pool.lines, pool.ringColour);
          stroke(pool.guide, LIGHTCORE_COLOUR);
          const at = pool.labels.length ? project(pool.labelAt[0], pool.labelAt[1], pool.labelAt[2]) : null;
          if (at) {
            g.font = "12px system-ui, sans-serif";
            g.textAlign = "left";
            g.textBaseline = "alphabetic";
            pool.labels.forEach((l, i) => { g.fillStyle = l.colour; g.fillText(l.text, at.x + 8, at.y + 16 + i * 14); });
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

/* OverlayFogOutline: the volume in the selection colour (round-aware), "FOG" on its middle. */
function outlineFog(g: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => { x: number; y: number } | null, box: TraxxBox, preview: FogPreview | null): void {
  const { fog, isFog } = effectiveFog(box, preview);
  const ring = isFog ? fogVolumeRing(box, fog) : null;
  if (!ring) return;
  for (const [a, b] of fogShapeLines(ring)) {
    const p = project(a[0], a[1], a[2]), q = project(b[0], b[1], b[2]);
    if (p && q) { g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); }
  }
  const mid = fogVolumeCentre(box, fog);
  const at = mid ? project(mid[0], mid[1], mid[2]) : null;
  if (!at) return;
  g.save();
  g.font = "12px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = "#ffffff";
  g.fillText("FOG", at.x, at.y);
  g.restore();
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
