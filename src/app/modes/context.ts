/* What an edit mode works with. */
import type { AppState } from "../state.ts";
import type { Editor } from "../editor.ts";
import type { DocumentService } from "../document-service.ts";
import type { CommandRegistry } from "../../ui/shell/commands.ts";
import type { TrackView } from "../../render/track-view.ts";

export interface ModeContext {
  app: AppState;
  editor: Editor;
  docs: DocumentService;
  registry: CommandRegistry;
  view: TrackView;
}
