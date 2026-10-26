/*
  About (IDD_ABOUTBOX). JSTraxx is the latest step of Traxx, so the credits read as its
  lineage, oldest first, then the libraries it is built with. As in Traxx, a button swaps the
  credits for the hidden picture of GuitarBill (IDB_BILL, CAboutDlg::OnBnClickedAbout) and back.
*/
import { el } from "../../shared/dom.ts";
import { openDialog } from "../shell/dialog.ts";

const LINEAGE: [string, string, string][] = [
  ["1997", "Traxx", "SoftParts"],
  ["2005", "Traxx 1.5", "Richard Borchard III"],
  ["v1.6", "GL update", "Juan Pablo Utreras \"Kmaster\""],
  ["v1.6", "CP3 updates", "Fila"],
  ["2026", "JSTraxx", "Kmaster"],
];

const REPO = "https://github.com/juanputrerasm/JSTraxx";
const LINKS = [REPO, "https://mtm2.com/~traxx/", "https://www.mtm2.com/", "https://www.malibu350.com/"];

export function showAbout(version: string, openphotex: string): Promise<unknown> {
  const link = (href: string, text = href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")) =>
    el("a", { href, target: "_blank", rel: "noopener" }, text);
  const row = (when: string, what: string | HTMLElement, who: string) =>
    [el("span", { class: "about-when" }, when), typeof what === "string" ? el("span", {}, what) : what, el("span", { class: "about-who" }, who)];

  const credits = el("div", { class: "about" },
    el("div", { class: "about-head" },
      el("img", { src: `${import.meta.env.BASE_URL}ui/traxxico.png`, alt: "", width: 32, height: 32 }),
      el("div", {},
        el("div", { class: "about-title" }, `JSTraxx ${version}`),
        el("div", { class: "about-sub" }, "A web implementation of Traxx, the classic Monster Truck Madness 2 track editor."))),
    el("h3", { class: "about-h" }, "Lineage"),
    el("div", { class: "about-table" }, ...LINEAGE.flatMap(([a, b, c]) => row(a, b, c))),
    el("h3", { class: "about-h" }, "Built with"),
    el("div", { class: "about-table" },
      ...row("", link("https://github.com/juanputrerasm/OpenPhotex", `OpenPhotex ${openphotex}`), "TRI file formats"),
      ...row("", link("https://github.com/juanputrerasm/JSTrackViewer", "JSTrackViewer"), "model rendering")),
    el("p", { class: "about-links" }, ...LINKS.flatMap((h, i) => (i ? [" · ", link(h)] : [link(h)]))),
    el("p", { class: "about-license" }, "Free for non-commercial use under the PolyForm Noncommercial License 1.0.0. See ", link(`${REPO}/blob/main/NOTICE.md`, "NOTICE"), "."));

  const bill = el("div", { class: "about-bill", hidden: true },
    el("img", { src: `${import.meta.env.BASE_URL}ui/guitarbill.bmp`, alt: "GuitarBill (1965-2004). Rest In Peace.", width: 181, height: 236 }));
  const toggle = el("button", { type: "button", class: "about-toggle" }, "GuitarBill") as HTMLButtonElement;
  toggle.addEventListener("click", () => {
    bill.hidden = !bill.hidden;
    credits.hidden = !bill.hidden;
    toggle.textContent = bill.hidden ? "GuitarBill" : "Credits";
  });
  return openDialog({
    title: "About JSTraxx",
    className: "about-dialog",
    body: [credits, bill, el("div", { class: "about-actions" }, toggle)],
  });
}
