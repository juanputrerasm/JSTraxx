/*
  The File menu and the document commands, bound to the document service. The flows follow
  CTraxxDoc: SaveModified first, then the open, with the same warnings on the way in
  (ReportSITCounts, the missing art and models lists, the POD's stem warning).
*/
import type { CommandRegistry } from "../ui/shell/commands.ts";
import { EditThisTrackError, type DocumentService } from "./document-service.ts";
import { extractConflictMessage, extractReportText } from "../core/doc/extract-art.ts";
import { editThisTrackDone, editThisTrackQuestion } from "../core/doc/edit-this-track.ts";
import type { TrackDocument } from "../core/doc/document.ts";
import { alertDialog, confirmDialog, openDialog } from "../ui/shell/dialog.ts";
import { el } from "../shared/dom.ts";
import { askSaveChanges, listMessage, openTrack, pickFiles, saveAs, selectSit, selectTrack } from "../ui/dialogs/file-dialogs.ts";
import type { AppState } from "./state.ts";
import { TERRAINMODE_CLASSIC16 } from "../core/traxx/terrain16.ts";
import { objectLimit } from "../core/traxx/v6.ts";
import { decodeFileNewV6, FILE_NEW_V6_IDS, NEW_512_NO_MEMORY } from "../core/traxx/track-kind-ui.ts";

export function bindFileCommands(registry: CommandRegistry, docs: DocumentService, app: AppState): { openRecent: (path: string) => Promise<void> } {
  const hasDoc = () => docs.doc !== null;
  const editable = () => docs.doc !== null && !docs.doc.viewOnly;
  const viewing = () => docs.doc !== null && docs.doc.viewOnly;

  /* CDocument::SaveModified. False when the author cancelled. */
  async function saveModified(): Promise<boolean> {
    if (!docs.doc || !docs.modified) return true;
    const answer = await askSaveChanges(docs.savePath?.split("/").pop() ?? "Untitled");
    if (answer === "cancel") return false;
    if (answer === "yes") return save();
    return true;
  }

  async function save(): Promise<boolean> {
    if (!docs.savePath) return saveAsFlow();
    await docs.save();
    app.status(`Saved ${docs.savePath.split("/").pop()}`);
    return true;
  }

  async function saveAsFlow(): Promise<boolean> {
    if (!docs.doc) return false;
    const existing = (await docs.listTracks()).map((t) => t.name);
    const suggested = docs.savePath?.split("/").pop()?.replace(/\.txx$/i, "") ?? docs.doc.track.trackName;
    const name = await saveAs(suggested, existing);
    if (!name) return false;
    const path = await docs.save(name);
    app.status(`Saved ${path.split("/").pop()}`);
    return true;
  }

  /* What Traxx says on the way in: short or dropped records, then art and models it could not load. */
  async function report(doc: TrackDocument): Promise<void> {
    if (doc.objectsShort > 0 || doc.objectsDropped > 0) {
      const parts: string[] = [];
      if (doc.objectsShort > 0) {
        parts.push(`The track's situation file (.SIT / .SI2) says it holds ${doc.objectsShort} more object${doc.objectsShort === 1 ? "" : "s"} than it actually does - the file was written wrong, by whatever made it. JSTraxx has kept every object that is really there. The game reads that file strictly in order and trusts the count, so in game the sections after the objects - the courses, and with them the AI routes - are likely misread. Writing the track from JSTraxx writes the correct count.`);
      }
      if (doc.objectsDropped > 0) parts.push(`${doc.objectsDropped} object${doc.objectsDropped === 1 ? "" : "s"} could not be kept: the track holds more than the ${objectLimit(doc.track)} this editor supports.`);
      await alertDialog("Situation file problem", parts.join("\n\n"));
    }
    if (doc.groundBoxOverflow > 0) {
      await alertDialog("Ground boxes", `${doc.groundBoxOverflow} ground box${doc.groundBoxOverflow === 1 ? "" : "es"} could not be kept: the track holds more than the 2048 this editor supports.`);
    }
    if (doc.missingTextures.length) await listMessage("Error loading texture(s)", "These textures were not found in the ART folder or the game library:", doc.missingTextures);
    if (doc.missingModels.length) await listMessage("Error loading model(s)", "These models were not found in the MODELS folder or the game library:", doc.missingModels);
    // Traxx's open reports, once each: the heights ("Terrain heights"), the race rules note ("Race rules"), a stored lake map ("Lakes").
    for (const n of doc.notices ?? []) await alertDialog(n.caption, n.text);
    doc.notices = [];
    for (const w of doc.warnings.filter((x) => !/count \d+ and real/.test(x))) app.status(w);
  }

  const run = <T>(work: () => Promise<T>) => async () => {
    try { await work(); } catch (err) { await alertDialog("JSTraxx", err instanceof Error ? err.message : String(err)); }
  };

  registry.bind("ID_FILE_NEW", run(async () => {
    if (!(await saveModified())) return;
    await docs.newTrack();
    app.status("New track");
  }));
  /*
    File > New > Classic > Finer Heights 16-bit / Spline / Full Map (CTraxxApp::OnFileNewGrid): File > New,
    then the fresh track's terrain switched to that mode without a word and without marking it modified.
  */
  (["ID_FILE_NEW_CLASSIC16", "ID_FILE_NEW_SPLINE", "ID_FILE_NEW_FINE"] as const).forEach((id, i) => registry.bind(id, run(async () => {
    if (!(await saveModified())) return;
    await docs.newTrack(TERRAINMODE_CLASSIC16 + i);
    app.status("New track");
  })));

  /*
    File > New > World Size 256 / 512 > Standard V6 / Tall Heights V6 > grid (CTraxxApp::OnFileNewV6): File >
    New again, the grid, the kind and the world named up front, so no question follows. A 512 world that
    cannot be had leaves a 256 one of the same kind, and says so (CTraxxDoc::OnNewDocument).
  */
  for (const id of FILE_NEW_V6_IDS) {
    const d = decodeFileNewV6(id)!;
    registry.bind(id, run(async () => {
      if (!(await saveModified())) return;
      const { shrunk } = await docs.newTrack(d.mode, d.cells, d.kind);
      if (shrunk) await alertDialog("JSTraxx", NEW_512_NO_MEMORY);
      app.status("New track");
    }));
  }

  registry.bind("ID_FILE_OPEN", run(async () => {
    if (!(await saveModified())) return;
    const choice = await openTrack(await docs.listTracks());
    if (!choice) return;
    if ("path" in choice) { await report(await docs.openTxx(choice.path, choice.path.split("/").pop()!)); return; }
    const [file] = await pickFiles({ accept: ".txx,.TXX" });
    if (file) await report(await docs.openTxx(file, file.name));
  }));

  registry.bind("ID_FILE_SAVE", run(save), { enabled: editable });
  registry.bind("ID_FILE_SAVE_AS", run(saveAsFlow), { enabled: editable });
  registry.bind("ID_FILE_CLOSE", run(async () => { if (await saveModified()) docs.close(); }), { enabled: hasDoc });

  registry.bind("ID_FILE_VIEWPOD", run(async () => {
    const [file] = await pickFiles({ accept: ".pod,.POD" });
    if (!file || !(await saveModified())) return;
    const list = await docs.podTracks(file);
    if (list.warning) await alertDialog("Track naming warning", list.warning);
    if (list.names.length === 0) { await alertDialog("JSTraxx", "Cant find tracks in POD file!"); return; }
    const which = list.names.length === 1 ? 0 : await selectTrack(list.names);
    if (which === null) return;
    await report(await docs.viewPod(file, which));
  }));

  registry.bind("ID_FILE_CLONE", run(async () => {
    // A browser cannot open a .SIT's neighbours from the file alone, so the folder is picked:
    // the TrackEd folder (or any folder holding it), and the .SIT is chosen from what it holds.
    // The picker opens from the button's own click: browsers open one only for a click.
    let picking: Promise<File[]> | null = null;
    await openDialog({
      title: "Clone TrackEd Track",
      body: el("p", { class: "modal-text" }, "Choose the TrackEd folder: the one that holds WORLD, LEVELS, DATA and ART (or any folder above it).\n\nThe browser asks for a folder, not a file: select the folder and confirm. You then choose the .SIT from the tracks found in it."),
      buttons: [{ label: "Choose Folder...", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
      beforeClose: (value) => { if (value === "ok") picking = pickFiles({ directory: true }); return true; },
    });
    if (!picking) return;
    const files = await (picking as Promise<File[]>);
    if (!files.length || !(await saveModified())) return;
    const { sits, loose } = await docs.cloneList(files);
    if (!sits.length) {
      await alertDialog("Clone TrackEd Track", loose.length
        ? `Found ${loose.join(", ")}, but not inside a WORLD folder. It looks like the WORLD folder itself was chosen: choose the folder above it, the one that also holds LEVELS and DATA.`
        : "SIT not in proper location. No WORLD folder with a .SIT or .SI2 was found in the chosen folder. Choose the TrackEd folder that holds WORLD, LEVELS and DATA.");
      return;
    }
    const sit = sits.length === 1 ? sits[0] : await selectSit(sits);
    if (!sit) return;
    await report(await docs.clone(files, sit));
  }));

  // OnEditExtract (Traxx origin/main): the copy never replaces a file; what differs is listed.
  registry.bind("ID_EDIT_EXTRACT", run(async () => {
    if (!(await confirmDialog("Extract Components", "This will dump all models and textures from the\ncurrent file into the JSTraxx Art/Models folders.\nProceed?", "Yes"))) return;
    let r;
    try { r = await docs.extract(); } catch { await alertDialog("JSTraxx", "Cant access source POD file, or the Art or Models folder is missing!"); return; }
    app.status(`Extracted ${r.written} file${r.written === 1 ? "" : "s"}.`);
    const text = extractReportText(r.report);
    if (text) await alertDialog("Extract Components", text);
  }), { enabled: viewing });

  /*
    File > Edit This Track (Traxx origin/main CTraxxDoc::OnFileEditTrack, replacing JSTraxx's
    Import Viewed POD as Track). "Set your Art and Models folders first" does not arise: the
    browser's ART and MODELS folders always exist.
  */
  registry.bind("ID_FILE_EDITTRACK", run(async () => {
    const doc = docs.doc;
    if (!doc?.viewOnly) return;
    if (!(await confirmDialog("Edit This Track", editThisTrackQuestion(doc.track.trackName), "Yes"))) return;
    let r;
    try { r = await docs.editThisTrack(); } catch (err) {
      if (err instanceof EditThisTrackError) { await alertDialog("Edit This Track", err.message); return; }
      throw err;
    }
    await alertDialog("Edit This Track", editThisTrackDone(r.prefix, r.report.length ? extractConflictMessage(r.report) : ""));
  }), { enabled: viewing });

  registry.bind("ID_FILE_DOWNLOAD", run(async () => {
    const bytes = await docs.txxBytes();
    const name = docs.savePath?.split("/").pop() ?? `${docs.doc?.track.prefix ?? "TRACK"}.txx`;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }), { enabled: editable });

  // Leaving the page with unsaved changes asks first, as closing Traxx does.
  window.addEventListener("beforeunload", (e) => { if (docs.modified) e.preventDefault(); });

  return {
    openRecent: async (path: string) => {
      await run(async () => {
        // An open Object Properties window closes as OK first, as for File > Open.
        if (!(await registry.passGuard("ID_FILE_OPEN"))) return;
        if (!(await saveModified())) return;
        await report(await docs.openTxx(path, path.split("/").pop()!));
      })();
    },
  };
}
