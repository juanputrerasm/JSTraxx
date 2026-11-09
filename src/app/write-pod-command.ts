/*
  File > Write POD (CTraxxDoc::OnFileWritePOD):

    1. the integrity check; with problems, "Incomplete Track" lets the author go on or stop
    2. when HD art could stand in for legacy tiles, the fallback explained once (until "Don't
       explain this again"), with what it costs in the pod
    3. the export: file name and "Omit the legacy .RAW fallback", remembered with the track
    4. the pod built (core/traxx/pod-writer.ts) and saved: a save dialog where the browser has
       one, a download otherwise
    5. Traxx 1.7: the vegetation models the game will not instance, when a .VEG was written
       (CTrackPOD::Save's INSTANCING WARNING)

  The art beside each texture (HD sources and _N / _AO maps) is looked up in the ART folder and
  the library by the asset worker, as Traxx re-reads them from its ART folder.
*/
import { el } from "../shared/dom.ts";
import type { AppState } from "./state.ts";
import type { Editor } from "./editor.ts";
import type { DocumentService } from "./document-service.ts";
import type { WorkerClient } from "../shared/worker-client.ts";
import type { CommandRegistry } from "../ui/shell/commands.ts";
import { alertDialog, confirmDialog, openDialog } from "../ui/shell/dialog.ts";
import { findLostSurfaceSidecars, lostSurfaceMessage, LOST_SURFACE_TITLE } from "../core/doc/surface-sidecar.ts";
import { parsePod } from "../vendor/openphotex/pod/parse.js";
import { checkIntegrity } from "../core/doc/integrity.ts";
import { buildTrackPod, type TextureExtras } from "../core/traxx/pod-writer.ts";
import { recordFields } from "../core/edit/record.ts";
import { writePod1, PodWriteError } from "../vendor/openphotex/pod/write.js";
import type { TrackDocument } from "../core/doc/document.ts";
import { VEG_KIND_GROUND } from "../core/traxx/veg.ts";

/** LegacyFallbackBytes: what leaving the fallback out would save, by class. */
function fallbackBytes(doc: TrackDocument, extras: ReadonlyMap<string, TextureExtras>): { terrain: number; model: number } {
  const bytes = (list: readonly (import("../core/doc/document.ts").TextureAsset | null)[]) => list.reduce((sum, t) => {
    if (!t?.indices || !t.side) return sum;
    const hd = t.hd ?? extras.get(t.name.toUpperCase())?.hd;
    return hd ? sum + t.side * t.side + 768 : sum;
  }, 0);
  return { terrain: bytes(doc.textures), model: bytes(doc.modelTextures) };
}

export function bindWritePod(registry: CommandRegistry, app: AppState, editor: Editor, docs: DocumentService, worker: WorkerClient): void {
  registry.bind("ID_FILE_WRITEPOD", async () => {
    const doc = editor.doc;
    if (!doc || doc.viewOnly) return;

    const problems = checkIntegrity(doc);
    if (problems.length) {
      const r = await openDialog({
        title: "Incomplete Track",
        body: [
          el("p", { class: "modal-text" }, "The following errors were detected:"),
          el("textarea", { readonly: true, rows: 8, class: "integrity" }, problems.join("\n")),
          el("p", { class: "modal-text" }, "Click OK to create the POD file anyway.\nIt may not function correctly in MTM."),
        ],
        buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
      });
      if (r !== "ok") return;
    }

    app.status("Looking for the art beside each texture...");
    const all = [...doc.textures.filter((t): t is NonNullable<typeof t> => t !== null), ...doc.modelTextures];
    const extrasRecord = await worker.call<Record<string, TextureExtras>>("art.extras", { names: all.map((t) => t.name), needHd: all.map((t) => !t.hd) });
    const extras = new Map(Object.entries(extrasRecord));
    app.status("");

    const cost = fallbackBytes(doc, extras);
    const total = cost.terrain + cost.model;
    const kb = (n: number) => Math.trunc((n + 512) / 1024);
    if (total > 0 && !app.settings.pod_fallback_noask) {
      const dontAsk = el("input", { type: "checkbox" }) as HTMLInputElement;
      const r = await openDialog({
        title: "Legacy .RAW fallback",
        body: [
          el("p", { class: "modal-text" }, `This track's .RAW/.ACT fallback is ${kb(total)} KB of the pod you are about to write - ${kb(cost.model)} KB of model art and ${kb(cost.terrain)} KB of terrain.`),
          el("p", { class: "modal-text" }, "Ticking \"Omit the legacy .RAW fallback\" on the next dialog leaves those files out and makes the pod that much smaller.\n\nThe current engine is unaffected. It reads your PNG and TGA art directly on every renderer it still ships, and the HD sources are packed either way, so nothing you made is lost.\n\nWhat it does change is the original 1998 MTM2. That install will not see this track at all: it stays hidden rather than appearing and loading with broken textures. That is deliberate, and it is the reason to leave the fallback in if you are sharing the track with people running the original game.\n\nThe choice is remembered with the track, not as a program setting, because it is a property of the track's art rather than of whoever is exporting it."),
          el("label", { class: "opt-check" }, dontAsk, "Don't explain this again"),
        ],
        buttons: [{ label: "Continue", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
      });
      if (r !== "ok") return;
      if (dontAsk.checked) app.updateSettings((s) => { s.pod_fallback_noask = true; });
    }

    // The export options.
    const fileName = el("input", { type: "text", value: `${doc.track.prefix || "TRACK"}.POD`, class: "cmp-wide" }) as HTMLInputElement;
    fileName.addEventListener("keydown", (e) => e.stopPropagation());
    const omit = el("input", { type: "checkbox", checked: doc.track.omitRawFallback, disabled: total === 0 }) as HTMLInputElement;
    const r = await openDialog({
      title: "Write POD file",
      body: [
        el("label", { class: "opt-row" }, el("span", { class: "fld" }, "File name"), fileName),
        el("label", { class: "opt-check" }, omit, "Omit the legacy .RAW fallback"),
        ...(total === 0 ? [el("p", { class: "hint" }, "No texture has HD art beside it, so there is nothing to omit.")] : []),
      ],
      buttons: [{ label: "Write", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    });
    if (r !== "ok" || editor.doc !== doc) return;
    if (doc.track.omitRawFallback !== omit.checked) {
      const rec = recordFields(doc.track, ["omitRawFallback"], "Omit Legacy Fallback", {});
      doc.track.omitRawFallback = omit.checked;
      editor.commit(rec);
    }

    app.status("Building the pod...");
    let bytes: Uint8Array;
    let report: ReturnType<typeof buildTrackPod>;
    try {
      report = buildTrackPod(doc, { extras });
      bytes = writePod1(report.comment, report.entries);
    } catch (err) {
      app.status("");
      const msg = err instanceof PodWriteError ? `${err.message}${err.entryIndex !== null ? ` (entry ${err.entryIndex})` : ""}` : err instanceof Error ? err.message : String(err);
      await alertDialog("Cannot write the pod", `The pod could not be built: ${msg}\n\nNothing was written.`);
      return;
    }
    app.status("");
    let name = fileName.value.trim() || `${doc.track.prefix}.POD`;
    if (!/\.pod$/i.test(name)) name += ".POD";
    /*
      FindLostSurfaceSidecars (OnFileWritePOD): before a pod is overwritten, the MODELS\X.SRF it
      holds for a model the new pod still packs without one. Asked with No as the default.
    */
    const names = report.entries.map((e) => e.name.toUpperCase());
    const packed = names.filter((n) => n.startsWith("MODELS\\") && n.endsWith(".BIN")).map((n) => {
      const srf = `${n.slice(0, -4)}.SRF`;
      return { name: n, srf: names.includes(srf) ? new Uint8Array(1) : null };
    });
    const saved = await savePod(bytes, name, async (old) => {
      let oldNames: string[];
      try { oldNames = parsePod(old).entries.map((e: { name: string }) => e.name); } catch { return true; }
      const lost = findLostSurfaceSidecars(oldNames, packed);
      return lost.length === 0 || await confirmDialog(LOST_SURFACE_TITLE, lostSurfaceMessage(lost), "Yes");
    });
    if (!saved) return;

    /*
      INSTANCING WARNING (CTrackPOD::Save): once, with every vegetation model the game will not
      instance and the rule it broke. The pod is written all the same.
    */
    if (report.vegNotInstanced.length) {
      const lines = report.vegNotInstanced.map((i) => `${i.model} (${i.kind === VEG_KIND_GROUND ? "grass - not drawn" : "tree - nearest ~128 only"}): ${i.why}`);
      await alertDialog("Vegetation models will not instance", `The game cannot instance these vegetation models. A tree model that cannot be instanced draws only the nearest ~128 copies; a grass model that cannot be instanced is not drawn at all.\n\n${lines.join("\n")}`);
    }

    const notes: string[] = [];
    if (report.longFrames.length) notes.push(`These animation frame names are longer than 15 characters:\n\n${report.longFrames.join("\n")}\n\nThe engine stores each frame's name next to that frame's SOUND name, so a longer name overwrites the sound instead of truncating. Rename these to at most 15 characters including the extension (an 11-character stem with .RAW) and build again.`);
    if (report.badTextures.length) notes.push(`The pod was written, but these textures could not be packed properly:\n\n${report.badTextures.join("\n")}\n\nThe track will load, but these will be wrong or missing in game.`);
    notes.push(...report.warnings);
    if (notes.length) await alertDialog("Write POD", notes.join("\n\n"));
    else app.status(`Wrote ${name} (${Math.round(bytes.length / 1024)} KB, ${report.entries.length} entries${report.omittedAny ? ", .SI2" : ""})`);
  }, { enabled: () => Boolean(editor.doc && !editor.doc.viewOnly) });
  void docs;
}

/*
  The browser's save dialog when there is one; a download otherwise (which cannot read the pod it
  replaces, so `beforeOverwrite` is skipped there, as Traxx is silent when it cannot read the old
  pod). False when nothing was written.
*/
async function savePod(bytes: Uint8Array, name: string, beforeOverwrite: (old: Uint8Array) => Promise<boolean>): Promise<boolean> {
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name, types: [{ description: "POD archive", accept: { "application/octet-stream": [".pod"] } }] });
      let old: Uint8Array | null = null;
      try { const f = await handle.getFile(); if (f.size > 0) old = new Uint8Array(await f.arrayBuffer()); } catch { old = null; }
      if (old && !(await beforeOverwrite(old))) return false;
      const w = await (handle as unknown as { createWritable(): Promise<WritableStream & { write(d: BlobPart): Promise<void>; close(): Promise<void> }> }).createWritable();
      await w.write(bytes as BlobPart);
      await w.close();
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return false;
    }
  }
  const a = el("a", { href: URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}
