/*
  Special > Track Type... (Traxx origin/main, IDD_TRACK_TYPE 290 x 112 and TrackTypeDlg.cpp CTrackTypeDlg): the
  three kinds as radios, the note under them following the checked one (ShowNote), Classic greyed on a world
  larger than 256 (OnInitDialog), OK and Cancel. Resolves with the chosen kind, or null on Cancel. Also the
  plain message boxes the kind commands use, their text kept line for line (MessageBox keeps "\n").
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";
import { TRACK_TYPE_CHOICES, trackTypeClassicEnabled, trackTypeDialogNote } from "../../core/traxx/track-kind-ui.ts";
import type { TrackKind } from "../../core/traxx/track-kind.ts";

const lines = (text: string) => el("p", { class: "modal-text", style: { whiteSpace: "pre-line" } }, text.replace(/\r\n/g, "\n"));

export async function trackTypeDialog(kind: TrackKind, cells: number): Promise<TrackKind | null> {
  const note = lines("");
  note.style.minHeight = "3.6em";
  const radios = TRACK_TYPE_CHOICES.map((c) => el("input", {
    type: "radio", name: "track-type", value: c.kind, checked: c.kind === kind,
    disabled: c.kind === "classic" && !trackTypeClassicEnabled(cells),
  }) as HTMLInputElement);
  const checked = (): TrackKind => (radios.find((r) => r.checked)?.value as TrackKind | undefined) ?? kind;
  const show = () => { note.textContent = trackTypeDialogNote(checked(), cells).replace(/\r\n/g, "\n"); };
  radios.forEach((r) => r.addEventListener("change", show));
  show();
  const r = await openDialog({
    title: "Track Type",
    body: el("div", { class: "opt-page" },
      ...TRACK_TYPE_CHOICES.map((c, i) => el("label", { class: "opt-check" }, radios[i], c.label)),
      note),
    buttons: [{ label: "OK", value: "ok", primary: true }, { label: "Cancel", value: "cancel" }],
  });
  return r === "ok" ? checked() : null;
}

/** MessageBox(MB_YESNO): true for Yes. `defaultNo` is MB_DEFBUTTON2 (No has the focus, Enter answers No). */
export async function yesNoDialog(title: string, text: string, defaultNo = false): Promise<boolean> {
  const r = await openDialog({
    title,
    body: lines(text),
    buttons: [{ label: "Yes", value: "yes", primary: !defaultNo }, { label: "No", value: "no", primary: defaultNo }],
  });
  return r === "yes";
}

/** MessageBox(MB_OK) with its lines kept. */
export async function messageDialog(title: string, text: string): Promise<void> {
  await openDialog({ title, body: lines(text) });
}
