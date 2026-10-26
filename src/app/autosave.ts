/*
  Auto-Save (Options > Auto-Save; CTraxxFrame's timer 2): every N minutes, a modified track
  that has been saved once is written again, over its own file or to TraxxAuto.txx. The
  status bar says so while it saves.
*/
import type { AppState } from "./state.ts";
import type { DocumentService } from "./document-service.ts";

export function startAutosave(app: AppState, docs: DocumentService): void {
  let timer = 0;
  let current = "";
  const arm = () => {
    const a = app.settings.autosave;
    const key = a.enabled ? String(Math.max(1, Math.min(30, a.minutes))) : "";
    if (key === current) return;
    current = key;
    clearInterval(timer);
    timer = 0;
    if (!key) return;
    timer = window.setInterval(async () => {
      if (!docs.doc || !docs.modified || !docs.savePath) return;
      app.status("Saving file...");
      try { await docs.autosave(app.settings.autosave.specialFile); } catch (err) { console.error(err); }
      app.status("");
    }, 60000 * Number(key));
  };
  app.on("settings", arm);
  arm();
}
