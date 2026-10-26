/*
  View > Track Components (CTraxxView::OnViewComponents): the dialog over the open track, and
  its OK as one undo step. A POD opened with View POD shows the dialog and keeps nothing.

  The backdrop chooser lists the MODELS folder and the game library, first those named like
  backdrops ("*drop*; *drp*; *fixd*; arena*", Traxx's starting filter), with the Arena box of
  IDD_ARENALOAD; a .BIN can also come from disk.
*/
import { el } from "../shared/dom.ts";
import type { AppState } from "./state.ts";
import type { Editor } from "./editor.ts";
import type { DocumentService } from "./document-service.ts";
import type { WorkerClient } from "../shared/worker-client.ts";
import type { CommandRegistry } from "../ui/shell/commands.ts";
import { openDialog } from "../ui/shell/dialog.ts";
import { componentsDialog } from "../ui/dialogs/components-dialog.ts";
import { applyComponents, componentsOf } from "../core/doc/components.ts";
import { recordFields } from "../core/edit/record.ts";
import { uiInfoName, uiBitmapName } from "../core/traxx/terrain.ts";
import { wildcardMatch } from "../core/edit/art-folder.ts";
import type { ModelItem, ModelLoad } from "../worker/model-handlers.ts";

const BACKDROP_PATTERNS = ["*DROP*.BIN", "*DRP*.BIN", "*FIXD*.BIN", "ARENA*.BIN"];

const TRACK_FIELDS = ["comment", "trackName", "prefix", "trackType", "waterLevel4", "ambientSound", "logoBmp", "mapBmp", "infoBmp", "uiHd",
  "detailExt", "detailMap", "maskExt", "maskMap", "music", "infoText", "backdropName", "extraBackdrops", "arena", "palette", "fogMap"] as const;

export function bindComponents(registry: CommandRegistry, app: AppState, editor: Editor, docs: DocumentService, worker: WorkerClient): void {
  const chooseBackdrop = async (): Promise<{ load: ModelLoad; isArena: boolean } | null> => {
    const doc = editor.doc;
    if (!doc) return null;
    const all = await worker.call<ModelItem[]>("models.list", { filter: "" });
    const showAll = el("input", { type: "checkbox" }) as HTMLInputElement;
    const arena = el("input", { type: "checkbox" }) as HTMLInputElement;
    const list = el("select", { size: 14, class: "mod-files" }) as HTMLSelectElement;
    const fill = () => {
      const items = showAll.checked ? all : all.filter((it) => BACKDROP_PATTERNS.some((p) => wildcardMatch(p, it.file)));
      list.replaceChildren(...items.map((it) => el("option", { value: all.indexOf(it), class: it.source === "library" ? "from-library" : null }, it.source === "library" ? `${it.file}  (library)` : it.file)));
      if (list.options.length) list.selectedIndex = 0;
    };
    showAll.addEventListener("change", fill);
    fill();
    let fromDisk: File | null = null;
    const disk = el("input", { type: "file", accept: ".bin", hidden: true }) as HTMLInputElement;
    const diskButton = el("button", { type: "button", onclick: () => disk.click() }, "From disk...");
    disk.addEventListener("change", () => { fromDisk = disk.files?.[0] ?? null; if (fromDisk) diskButton.textContent = fromDisk.name; });
    const r = await openDialog({
      title: "Load backdrop BIN file",
      body: [list, el("div", { class: "opt-row" }, el("label", { class: "opt-check" }, showAll, "All models"), el("label", { class: "opt-check" }, arena, "Arena"), diskButton, disk)],
      buttons: [{ label: "Load", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    if (r !== "ok") return null;
    const have = doc.modelTextures.map((t) => t.name);
    const file = fromDisk as File | null;
    const loads = file
      ? await worker.call<ModelLoad[]>("models.import", { files: [file], have })
      : list.value ? await worker.call<ModelLoad[]>("models.load", { items: [all[Number(list.value)]!], have }) : [];
    return loads[0] ? { load: loads[0], isArena: arena.checked } : null;
  };

  registry.bind("ID_VIEW_COMPONENTS", async () => {
    const doc = editor.doc;
    if (!doc) return;
    const t = doc.track;
    const start = componentsOf(doc);
    const result = await componentsDialog(start, {
      app, registry,
      viewOnly: doc.viewOnly,
      infoName: uiInfoName(uiBitmapName(t.logoBmpName, t.prefix, "S")),
      prefix: t.prefix,
      detailFromPod: doc.carry.detailFromPod,
      maskFromPod: doc.carry.maskFromPod,
      chooseBackdrop,
    });
    if (!result || doc.viewOnly || editor.doc !== doc) return;
    const recs = [recordFields(t, TRACK_FIELDS, "Track Components", { track: true }), recordFields(doc, ["prefixAuto", "models", "modelTextures"], "Track Components", { track: true })];
    const touch = applyComponents(doc, result);
    const changes = recs.map((rec) => rec.finish()).filter((c) => c !== null);
    if (!changes.length) return;
    editor.commitAll("Track Components", changes.map((c) => ({ ...c, touch })));
  }, { enabled: () => Boolean(editor.doc) });
  void docs;
}
