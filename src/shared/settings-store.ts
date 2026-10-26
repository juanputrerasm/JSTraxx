/* Settings persistence: jstraxx/settings.json in OPFS. */
import { mergeSettings, defaultSettings, type TraxxSettings } from "../core/settings.ts";
import { ROOT, readTextFile, writeBytesToFile } from "./opfs.ts";

const PATH = `${ROOT}/settings.json`;

export async function loadSettings(): Promise<TraxxSettings> {
  try {
    return mergeSettings(JSON.parse(await readTextFile(PATH)));
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(settings: TraxxSettings): Promise<void> {
  await writeBytesToFile(PATH, new TextEncoder().encode(JSON.stringify(settings, null, 2)));
}
