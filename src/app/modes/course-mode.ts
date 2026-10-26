/*
  Course mode (EDIT_COURSE; Traxx/TraxxViewInteract.cpp, TraxxViewEdit.cpp):

    - moving the pointer picks the nearest segment end of the course being edited (within 20
      pixels at 640 x 480), else the nearest truck (within 64);
    - dragging moves it onto the ground (a truck 4 steps above it);
    - right-click: the Course menu on an anchor or open ground, the Truck menu on a truck.

  The course being edited and "Always show main" are the Course Tools bar's.
*/
import type { ModeHandler, ViewPoint } from "../editor.ts";
import type { ModeContext } from "./context.ts";
import { CONTEXT_MENUS } from "../../ui/shell/commands.ts";
import { recordFields, type Recording } from "../../core/edit/record.ts";
import { courseOf, deleteAllSegments, deleteSegment, generateFromMain, insertSegment, moveAnchor, moveTruck, reverseSegment, reverseTruck, setSpeedLimit } from "../../core/edit/course.ts";
import { COURSE_ANCHOR_LIMIT, TRUCK_LIMIT, nearestOnScreen } from "../../core/view/screen-pick.ts";
import { speedLimitDialog, truckPropertiesDialog } from "../../ui/dialogs/course-dialogs.ts";
import { ALTITUDE_SCALE } from "../../core/view/camera.ts";
import { EDIT_COURSE } from "../../core/settings.ts";

export function courseMode(ctx: ModeContext): ModeHandler {
  const { app, editor, view, registry } = ctx;
  let anchor = -1;
  let truck = -1;
  let dragging: Recording | null = null;
  /** Where the last right-click hit the ground, for inserting a course's first segment. */
  let menuPoint: [number, number, number] | null = null;

  const track = () => editor.doc!.track;
  const which = () => app.tools.course;
  const fields = ["course", "extendedCourses", "trucks"] as const;
  const touch = { course: true, trucks: true };

  const showTruck = () => { view.selectedTruck = truck; view.rebuildCourse(); };
  app.on("tools", () => { anchor = -1; truck = -1; if (app.mode === EDIT_COURSE) { showTruck(); editor.selectionChanged(); } });

  /* The ground under a point, as Traxx stores positions: whole ipos and whole steps. */
  const ground = (p: ViewPoint): [number, number, number] | null => {
    const hit = view.pick(p.clientX, p.clientY);
    return hit ? [Math.trunc(hit.point[0]), Math.trunc(hit.point[1]), Math.trunc(hit.point[2] / ALTITUDE_SCALE)] : null;
  };

  /* SelectCourseAnchor, then SelectTruck. */
  const pickAt = (p: ViewPoint) => {
    const course = courseOf(track(), which()) ?? [];
    const pts = course.flatMap((s) => [view.project(s.cstart[0], s.cstart[1], ALTITUDE_SCALE * s.cstart[2]), view.project(s.cend[0], s.cend[1], ALTITUDE_SCALE * s.cend[2])]);
    const a = nearestOnScreen(pts, p, COURSE_ANCHOR_LIMIT, view.size);
    let t = -1;
    if (a < 0) {
      const trucks = track().trucks.map((tr, i) => (i === 0 ? null : view.project(tr.ipos[0], tr.ipos[1], ALTITUDE_SCALE * tr.ipos[2])));
      t = nearestOnScreen(trucks, p, TRUCK_LIMIT, view.size);
    }
    if (a !== anchor || t !== truck) {
      anchor = a;
      truck = t;
      showTruck();
      editor.selectionChanged();
    }
  };

  const edit = (label: string, change: () => unknown) => {
    const rec = recordFields(track(), fields, label, touch);
    change();
    editor.commit(rec);
  };

  const can = () => editor.canEdit;
  registry.bind("ID_COURSE_INSERTSEGMENT", () => edit("Insert Segment", () => insertSegment(track(), which(), anchor, menuPoint)), {
    enabled: () => can() && (anchor >= 0 || ((courseOf(track(), which())?.length ?? 0) < 1 && menuPoint !== null)),
  });
  registry.bind("ID_COURSE_DELETESEGMENT", () => { edit("Delete Segment", () => deleteSegment(track(), which(), anchor)); anchor = -1; }, { enabled: () => can() && anchor >= 0 });
  registry.bind("ID_COURSE_REVERSE", () => edit("Reverse Segment", () => reverseSegment(track(), which(), anchor)), { enabled: () => can() && anchor >= 0 });
  registry.bind("ID_COURSE_SPEEDLIMIT", async () => {
    const seg = courseOf(track(), which())?.[anchor >> 1];
    if (!seg) return;
    const r = await speedLimitDialog(Math.trunc(seg.speedLimit / 2));
    if (r) edit("Speed Limit", () => setSpeedLimit(track(), which(), anchor, r.speed, r.all));
  }, { enabled: () => can() && anchor >= 0 });
  registry.bind("ID_COURSE_GENERATE", () => edit("Generate from Main", () => generateFromMain(track(), which())), { enabled: () => can() && which() > 0 });
  registry.bind("ID_COURSE_DELALLSEGMENTS", () => { edit("Delete All Segments", () => deleteAllSegments(track(), which())); anchor = -1; }, { enabled: () => can() });
  registry.bind("ID_TRUCK_REVERSE", () => edit("Reverse Truck", () => reverseTruck(track(), truck)), { enabled: () => can() && truck >= 0 });
  registry.bind("ID_TRUCK_PROPERTIES", async () => {
    const t = track().trucks[truck];
    if (!t) return;
    let angle = Math.trunc((180 * t.psi) / Math.PI);
    while (angle < 0) angle += 360;
    const r = await truckPropertiesDialog({ name: t.name, x: t.ipos[0], y: t.ipos[1], z: t.ipos[2], angle, course: t.course });
    if (!r || !editor.canEdit) return;
    edit("Truck Properties", () => {
      t.ipos = [r.x, r.y, r.z];
      t.psi = Math.fround(Math.fround(Math.PI * r.angle) / 180);
      t.course = r.course;
    });
  }, { enabled: () => Boolean(editor.doc) && truck >= 0 });

  return {
    deactivate() { anchor = -1; truck = -1; showTruck(); },
    hover: pickAt,
    down(p) {
      pickAt(p);
      if (anchor >= 0 || truck >= 0) dragging = recordFields(track(), fields, anchor >= 0 ? "Move Course Point" : "Move Truck", touch);
    },
    drag(p) {
      if (!dragging) return;
      const at = ground(p);
      if (!at) return;
      if (anchor >= 0) moveAnchor(track(), which(), anchor, at);
      else if (truck >= 0) moveTruck(track(), truck, at);
      // Redraws the course and the map as it goes; the undo step is taken on release.
      editor.emit("changed", touch);
    },
    up() {
      if (!dragging) return;
      editor.commit(dragging);
      dragging = null;
    },
    contextMenu(p) {
      pickAt(p);
      menuPoint = ground(p);
      if (truck >= 0 && anchor < 0) return { items: CONTEXT_MENUS.Truck };
      return { items: CONTEXT_MENUS.Course };
    },
    drawOverlay(g, project) {
      // The selected anchor: a filled circle, green for a start and dark red for an end, its number in black.
      const seg = anchor >= 0 ? courseOf(track(), which())?.[anchor >> 1] : null;
      if (!seg) return;
      const at = anchor & 1 ? seg.cend : seg.cstart;
      const q = project(at[0], at[1], ALTITUDE_SCALE * at[2]);
      if (!q) return;
      g.fillStyle = anchor & 1 ? "#800000" : "#00ff00";
      g.beginPath(); g.arc(q.x, q.y, 10, 0, 2 * Math.PI); g.fill();
      g.fillStyle = "#000000";
      g.font = "12px system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText(String(anchor >> 1), q.x, q.y + 5);
    },
    selectionText: () => (anchor >= 0 ? `Segment ${anchor >> 1} ${anchor & 1 ? "end" : "start"}` : truck >= 0 ? `Truck ${truck}` : ""),
  };
}
