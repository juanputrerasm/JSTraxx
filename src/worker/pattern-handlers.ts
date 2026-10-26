/*
  Pattern files (.TXP) for the Patterns window, kept in jstraxx/patterns. Traxx keeps one file
  path (TXP_file) and rewrites it after every change; so does JSTraxx, by name.
*/
import { transfer } from "../shared/worker-host.ts";
import { ROOT, listDirectory, readBytes, writeBytesToFile } from "../shared/opfs.ts";

export const PATTERNS_DIR = `${ROOT}/patterns`;

/** A file name kept to letters, digits, spaces and a few marks, ending .txp. */
export function patternFileName(name: string): string {
  const clean = name.replace(/\.txp$/i, "").replace(/[^A-Za-z0-9 _()-]/g, "").trim().slice(0, 64);
  return `${clean || "Patterns"}.txp`;
}

export function patternHandlers() {
  return {
    async "txp.list"(): Promise<string[]> {
      return (await listDirectory(PATTERNS_DIR)).filter((e) => e.kind === "file" && /\.txp$/i.test(e.name)).map((e) => e.name);
    },
    async "txp.read"(payload: { name: string }) {
      let bytes: Uint8Array;
      try { bytes = await readBytes(`${PATTERNS_DIR}/${patternFileName(payload.name)}`); } catch { return null; }
      return transfer(bytes, [bytes.buffer as ArrayBuffer]);
    },
    async "txp.write"(payload: { name: string; bytes: Uint8Array }): Promise<string> {
      const name = patternFileName(payload.name);
      await writeBytesToFile(`${PATTERNS_DIR}/${name}`, payload.bytes);
      return name;
    },
  };
}
