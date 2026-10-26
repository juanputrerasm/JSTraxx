/*
  READSTRING (TrackPODFile.cpp): Traxx reads text files a line at a time, up to '\n', with a
  '\r' ending the string where it falls and lines capped at 1023 characters. Blank lines are
  lines, so positions in a .TEX or .TTY count them.
*/
export function traxxLines(bytes: Uint8Array): string[] {
  const text = new TextDecoder("windows-1252").decode(bytes);
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    let line = text.slice(start, Math.min(end, start + 1023));
    const cr = line.indexOf("\r");
    if (cr >= 0) line = line.slice(0, cr);
    out.push(line);
    start = end + 1;
  }
  return out;
}

/** C atoi: leading spaces, a sign, digits; 0 when there are none. */
export function atoi(text: string | undefined): number {
  const m = /^[ \t]*([+-]?\d+)/.exec(text ?? "");
  return m ? parseInt(m[1], 10) | 0 : 0;
}
