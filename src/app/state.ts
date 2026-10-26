/*
  The editor's state outside the track itself: settings, the edit mode, status text and the
  cursor read-out. The shell and the bars listen to it; nothing here touches the DOM.
*/
import { Emitter } from "../shared/emitter.ts";
import type { EditMode, TraxxSettings } from "../core/settings.ts";
import { saveSettings } from "../shared/settings-store.ts";

/** The status bar's panes: the message line, then Sel, X, Y, Z (CTraxxFrame indicators). */
export interface Indicators { sel: string; x: string; y: string; z: string }

/*
  Tool settings Traxx does not save between runs: the course being edited, "Always show
  main", and the ground-box bar (CTraxxFrame::OnCreate sets them fresh each start).
*/
export interface ToolState {
  /** Course 0..4; 0 is the main course. */
  course: number;
  alwaysMain: boolean;
  /** Ground-box paint: 0 off, 1 face, 2 sides, 3 top and bottom, 4 all faces (TX_BUILDINGPAINT). */
  gbPaint: 0 | 1 | 2 | 3 | 4;
  /** Ground-box top and bottom, 1..255 and 0..254. */
  gbTop: number;
  gbBottom: number;
}

export interface AppEvents extends Record<string, unknown> {
  tools: ToolState;
  settings: TraxxSettings;
  mode: EditMode;
  status: string;
  indicators: Indicators;
  /** Something changed that menus and toolbar buttons may show (enabled, checked). */
  commands: void;
}

export class AppState extends Emitter<AppEvents> {
  settings: TraxxSettings;
  mode: EditMode;
  indicators: Indicators = { sel: "", x: "", y: "", z: "" };
  tools: ToolState = { course: 0, alwaysMain: true, gbPaint: 0, gbTop: 128, gbBottom: 64 };
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(settings: TraxxSettings) {
    super();
    this.settings = settings;
    this.mode = settings.mode;
  }

  setMode(mode: EditMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.updateSettings((s) => { s.mode = mode; });
    this.emit("mode", mode);
    this.emit("commands", undefined);
  }

  /** Change settings in place, tell listeners, and save a moment later. */
  updateSettings(change: (s: TraxxSettings) => void): void {
    change(this.settings);
    this.emit("settings", this.settings);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      saveSettings(this.settings).catch((err) => console.warn("Settings not saved:", err));
    }, 400);
  }

  setTools(change: Partial<ToolState>): void {
    Object.assign(this.tools, change);
    this.emit("tools", this.tools);
  }

  status(message: string): void {
    this.emit("status", message);
  }

  setIndicators(change: Partial<Indicators>): void {
    Object.assign(this.indicators, change);
    this.emit("indicators", this.indicators);
  }
}
