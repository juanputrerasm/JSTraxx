/*
  The file dialogs: picking files from the computer, Open (saved tracks), Select Track
  (IDD_SELECT_TRACK), the clone source, Save As, and "save changes?".
*/
import { el, clear } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import type { TrackListItem } from "../../app/document-service.ts";

/** A native file picker. Resolves with the chosen files, or [] when cancelled. */
export function pickFiles(options: { accept?: string; multiple?: boolean; directory?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = el("input", { type: "file", accept: options.accept, multiple: options.multiple || options.directory, webkitdirectory: options.directory, hidden: true });
    let done = false;
    const finish = (files: File[]) => { if (done) return; done = true; input.remove(); resolve(files); };
    input.addEventListener("change", () => finish([...(input.files ?? [])]));
    input.addEventListener("cancel", () => finish([]));
    document.body.append(input);
    input.click();
  });
}

/** A list of choices; resolves with the chosen index, or null. Double-click or Enter picks. */
function listDialog(title: string, prompt: string, items: { label: string; detail?: string }[], ok = "OK", extra: { label: string; value: string }[] = []): Promise<{ index: number | null; action: string | null }> {
  let selected = items.length ? 0 : -1;
  const list = el("ul", { class: "pick-list", role: "listbox", tabindex: "0", "aria-label": prompt });
  const rows = items.map((item, i) => el("li", {
    role: "option", "aria-selected": String(i === selected), class: "pick-row",
    onclick: () => select(i),
    ondblclick: () => { select(i); (dialogForm()?.querySelector("button.primary") as HTMLButtonElement | null)?.click(); },
  }, el("span", { class: "pick-label" }, item.label), item.detail ? el("span", { class: "pick-detail" }, item.detail) : null));
  if (rows.length) list.append(...rows);
  else list.append(el("li", { class: "pick-empty" }, "Nothing here yet."));
  const select = (i: number) => {
    selected = i;
    rows.forEach((r, j) => r.setAttribute("aria-selected", String(j === i)));
    rows[i]?.scrollIntoView({ block: "nearest" });
  };
  list.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { select(Math.min(items.length - 1, selected + 1)); e.preventDefault(); }
    if (e.key === "ArrowUp") { select(Math.max(0, selected - 1)); e.preventDefault(); }
  });
  const dialogForm = () => list.closest("form");
  return openDialog({
    title,
    className: "pick-dialog",
    body: [el("p", { class: "modal-text" }, prompt), list],
    buttons: [
      ...extra.map((x) => ({ label: x.label, value: x.value })),
      { label: ok, value: "ok", primary: true },
      { label: "Cancel", value: "cancel" },
    ],
    beforeClose: (v) => v !== "ok" || selected >= 0,
  }).then((value) => ({ index: value === "ok" ? selected : null, action: value }));
}

/** CSelectTrackDlg: which track of a POD. */
export async function selectTrack(names: string[]): Promise<number | null> {
  const r = await listDialog("Select Track", "This POD holds more than one track. Which one?", names.map((n) => ({ label: n || "(unnamed)" })));
  return r.index;
}

/** Which situation file of a TrackEd folder to clone. */
export async function selectSit(paths: string[]): Promise<string | null> {
  const r = await listDialog("Clone TrackEd Track", "Select the track to clone.", paths.map((p) => ({ label: p.replace(/^WORLD\\/, "") })), "Clone");
  return r.index === null ? null : paths[r.index];
}

/** Open: a saved track, or a .TXX from the computer. */
export async function openTrack(tracks: TrackListItem[]): Promise<{ path: string } | { file: true } | null> {
  const fmt = (t: TrackListItem) => `${Math.ceil(t.size / 1024)} KB, ${t.modified ? new Date(t.modified).toLocaleString() : ""}`;
  const r = await listDialog("Open", "Saved tracks:", tracks.map((t) => ({ label: t.name, detail: fmt(t) })), "Open",
    [{ label: "From Computer...", value: "file" }]);
  if (r.action === "file") return { file: true };
  return r.index === null ? null : { path: tracks[r.index].path };
}

/** Save As: a name for the .TXX. */
export async function saveAs(defaultName: string, existing: string[]): Promise<string | null> {
  const input = el("input", { type: "text", value: defaultName, class: "text-field", maxlength: 64, "aria-label": "Track file name", spellcheck: "false" });
  const note = el("p", { class: "opt-hint", "aria-live": "polite" });
  input.addEventListener("keydown", (e) => e.stopPropagation());
  const taken = () => existing.some((n) => n.toLowerCase() === `${input.value.trim()}.txx`.toLowerCase());
  input.addEventListener("input", () => { note.textContent = taken() ? "A saved track has this name; saving replaces it." : ""; });
  queueMicrotask(() => input.select());
  const v = await openDialog({
    title: "Save As",
    body: [el("label", { class: "field" }, el("span", {}, "File name"), input, el("span", { class: "field-suffix" }, ".txx")), note],
    buttons: [{ label: "Save", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
    beforeClose: (value) => value !== "ok" || input.value.trim().length > 0,
  });
  return v === "ok" ? input.value.trim() : null;
}

/** CDocument::SaveModified: "yes", "no" or "cancel". */
export async function askSaveChanges(name: string): Promise<"yes" | "no" | "cancel"> {
  const v = await openDialog({
    title: "JSTraxx",
    body: el("p", { class: "modal-text" }, `Save changes to ${name}?`),
    buttons: [{ label: "Yes", value: "yes", primary: true }, { label: "No", value: "no" }, { label: "Cancel", value: "cancel" }],
  });
  return v === "yes" || v === "no" ? v : "cancel";
}

/** A message with a scrolling list under it, for missing files and the like. */
export function listMessage(title: string, message: string, items: string[]): Promise<unknown> {
  const list = el("ul", { class: "message-list" });
  clear(list);
  list.append(...items.map((i) => el("li", {}, i)));
  const body: Node[] = [el("p", { class: "modal-text" }, message)];
  if (items.length) body.push(list);
  return openDialog({ title, body });
}
